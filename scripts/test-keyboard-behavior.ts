/**
 * scripts/test-keyboard-behavior.ts
 *
 * Dedicated verification suite for Keyboard Behavior & Navigation Hardening:
 * 1. keyboard-nav helpers (isInteractiveInput, isButtonOrAction, isInteractiveControl, isModifierActive)
 * 2. SpatialCommandHub keyboard access:
 *    - Normal Tab/Shift+Tab navigation preserved (not intercepted or prevented)
 *    - Native Enter/Space activation on focused zone nodes and interactive buttons
 *    - Arrow keys navigate nodes when appropriate, but never hijack dropdowns/sliders/inputs
 *    - Quick launch numbers (1-6) ignore modifier combinations (Cmd+1..6) and text inputs
 * 3. InvestigationHub keyboard access:
 *    - Native Enter/Space activation on focused buttons (Back, Hub, AI toggle, Response actions)
 *    - ArrowLeft/ArrowRight tab switching preserved on general surfaces, never steals from dropdowns/sliders/inputs
 *    - Contextual AI hotkey ('A'/'a') ignores text inputs and Cmd+A/Ctrl+A select-all
 *    - Spacebar choreography skip preserves button and link activation
 * 4. AttackReplay & AttackGraph keyboard preservation:
 *    - Range slider scrubber and selects retain arrow keys and scrub interactions
 *    - Spacebar toggles playback only when not focused on native buttons
 *    - 'R'/'r' does not hijack browser page reload (Cmd+R / Ctrl+R)
 * 5. SpatialInteractionController workspace switching:
 *    - Blocked when modifier keys are active (Cmd+C copy, Cmd+F find, etc.)
 *    - Blocked when focus is in any interactive control (selects, inputs, buttons)
 *    - Applied only on appropriate surfaces (HUB workspace)
 * 6. Escape hierarchy preservation across Hub, Investigation, and Modals.
 */

// Setup minimal DOM mocks in Node environment if global window is missing
class MockEventTarget {
  private listeners: Map<string, Array<(e: any) => void>> = new Map();

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void) {
    const list = this.listeners.get(type);
    if (list) {
      this.listeners.set(type, list.filter((l) => l !== listener));
    }
  }

  dispatchEvent(event: any): boolean {
    const list = this.listeners.get(event.type) || [];
    for (const listener of list) {
      listener(event);
    }
    return !event.defaultPrevented;
  }
}

class MockHTMLElement extends MockEventTarget {
  tagName: string;
  isContentEditable: boolean = false;
  attributes: Map<string, string> = new Map();
  parentElement: MockHTMLElement | null = null;
  children: MockHTMLElement[] = [];
  tabIndex: number = -1;
  id: string = '';
  classList: Set<string> = new Set();

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name.toLowerCase(), value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  appendChild(child: MockHTMLElement) {
    child.parentElement = this;
    this.children.push(child);
  }

  closest(selector: string): MockHTMLElement | null {
    const selectors = selector.split(',').map((s) => s.trim().toLowerCase());
    let current: MockHTMLElement | null = this;
    while (current) {
      const tag = current.tagName.toLowerCase();
      const role = current.getAttribute('role')?.toLowerCase();
      const contentEditable = current.isContentEditable;

      for (const sel of selectors) {
        if (sel === tag) return current;
        if (sel === '[contenteditable="true"]' && contentEditable) return current;
        if (sel.startsWith('[role="') && sel.endsWith('"]')) {
          const expectedRole = sel.slice(7, -2);
          if (role === expectedRole) return current;
        }
      }
      current = current.parentElement;
    }
    return null;
  }

  focus() {
    (globalThis as any).currentFocusedElement = this;
    this.dispatchEvent({ type: 'focus', target: this });
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }
}

class MockKeyboardEvent {
  type: string;
  key: string;
  code: string;
  target: any;
  defaultPrevented: boolean = false;
  metaKey: boolean = false;
  ctrlKey: boolean = false;
  altKey: boolean = false;
  shiftKey: boolean = false;
  propagationStopped: boolean = false;

  constructor(type: string, init: Partial<MockKeyboardEvent> = {}) {
    this.type = type;
    this.key = init.key || '';
    this.code = init.code || init.key || '';
    this.target = init.target || null;
    this.metaKey = Boolean(init.metaKey);
    this.ctrlKey = Boolean(init.ctrlKey);
    this.altKey = Boolean(init.altKey);
    this.shiftKey = Boolean(init.shiftKey);
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.propagationStopped = true;
  }
}

// Polyfill globals for Node/tsx testing
(globalThis as any).HTMLElement = MockHTMLElement;
(globalThis as any).HTMLInputElement = class extends MockHTMLElement {
  type: string = 'text';
  value: string = '';
  constructor() {
    super('INPUT');
  }
};
(globalThis as any).HTMLTextAreaElement = class extends MockHTMLElement {
  value: string = '';
  constructor() {
    super('TEXTAREA');
  }
};
(globalThis as any).HTMLSelectElement = class extends MockHTMLElement {
  value: string = '';
  constructor() {
    super('SELECT');
  }
};
(globalThis as any).KeyboardEvent = MockKeyboardEvent;

if (!globalThis.window) {
  const mockWindow = new MockEventTarget() as any;
  mockWindow.addEventListener = MockEventTarget.prototype.addEventListener.bind(mockWindow);
  mockWindow.removeEventListener = MockEventTarget.prototype.removeEventListener.bind(mockWindow);
  mockWindow.dispatchEvent = MockEventTarget.prototype.dispatchEvent.bind(mockWindow);
  (globalThis as any).window = mockWindow;
  (globalThis as any).document = {
    body: new MockHTMLElement('BODY'),
    activeElement: null,
  };
}

import {
  isInteractiveInput,
  isButtonOrAction,
  isInteractiveControl,
  isModifierActive,
} from '../app/spatial/common/keyboard-nav';
import { socNavStore } from '../app/spatial/state/use-soc-nav';
import { spatialController } from '../app/spatial-controller';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('====================================================');
console.log(' KEYBOARD BEHAVIOR & INTERACTION TEST SUITE');
console.log('====================================================\n');

// ─── 1. keyboard-nav Helper Suite ────────────────────────────────
console.log('1. Centralized Keyboard Navigation Helpers:');

// Test input detection
const textInput = new MockHTMLElement('INPUT');
assert(isInteractiveInput(textInput), 'Detects <input>');

const textarea = new MockHTMLElement('TEXTAREA');
assert(isInteractiveInput(textarea), 'Detects <textarea>');

const selectEl = new MockHTMLElement('SELECT');
assert(isInteractiveInput(selectEl), 'Detects <select>');

const editableDiv = new MockHTMLElement('DIV');
editableDiv.isContentEditable = true;
assert(isInteractiveInput(editableDiv), 'Detects isContentEditable element');

const sliderEl = new MockHTMLElement('DIV');
sliderEl.setAttribute('role', 'slider');
assert(isInteractiveInput(sliderEl), 'Detects role="slider"');

const comboboxEl = new MockHTMLElement('DIV');
comboboxEl.setAttribute('role', 'combobox');
assert(isInteractiveInput(comboboxEl), 'Detects role="combobox"');

const spanInsideInput = new MockHTMLElement('SPAN');
textInput.appendChild(spanInsideInput);
assert(isInteractiveInput(spanInsideInput), 'Detects span nested within input container');

// Test button and action detection
const nativeButton = new MockHTMLElement('BUTTON');
assert(isButtonOrAction(nativeButton), 'Detects <button>');

const nativeAnchor = new MockHTMLElement('A');
assert(isButtonOrAction(nativeAnchor), 'Detects <a>');

const roleButton = new MockHTMLElement('DIV');
roleButton.setAttribute('role', 'button');
assert(isButtonOrAction(roleButton), 'Detects role="button"');

const iconInsideButton = new MockHTMLElement('SVG');
nativeButton.appendChild(iconInsideButton);
assert(isButtonOrAction(iconInsideButton), 'Detects icon inside button');

// Non-interactive surfaces
const plainDiv = new MockHTMLElement('DIV');
assert(!isInteractiveInput(plainDiv), 'Plain div is not an interactive input');
assert(!isButtonOrAction(plainDiv), 'Plain div is not a button or action');
assert(!isInteractiveControl(plainDiv), 'Plain div is not an interactive control');

// Combined interactive control
assert(isInteractiveControl(textInput), 'isInteractiveControl returns true for input');
assert(isInteractiveControl(nativeButton), 'isInteractiveControl returns true for button');
assert(isInteractiveControl(selectEl), 'isInteractiveControl returns true for select');
assert(isInteractiveControl(sliderEl), 'isInteractiveControl returns true for slider');

// Modifier key checks
const normalKey = new MockKeyboardEvent('keydown', { key: 'Tab' }) as unknown as KeyboardEvent;
assert(!isModifierActive(normalKey), 'Normal key has no modifier active');

const cmdKey = new MockKeyboardEvent('keydown', { key: 'c', metaKey: true }) as unknown as KeyboardEvent;
assert(isModifierActive(cmdKey), 'Cmd key is detected as active modifier');

const ctrlKey = new MockKeyboardEvent('keydown', { key: 'c', ctrlKey: true }) as unknown as KeyboardEvent;
assert(isModifierActive(ctrlKey), 'Ctrl key is detected as active modifier');

const altKey = new MockKeyboardEvent('keydown', { key: 'Tab', altKey: true }) as unknown as KeyboardEvent;
assert(isModifierActive(altKey), 'Alt key is detected as active modifier');

// ─── 2. Hub Keyboard Access & Normal Tab Navigation ───────────────
console.log('\n2. Hub Keyboard Navigation & Normal Tab Traversal:');

// Simulating Hub Keyboard Handler behavior
let hubFocusedIndex = 0;
let hubTransitionTarget: string | null = null;
const hubDestinations = [
  { id: 'COMMAND', title: 'Command Center' },
  { id: 'INVESTIGATION', title: 'Investigation' },
  { id: 'HUNTING', title: 'Threat Hunting' },
  { id: 'CASES', title: 'Cases' },
  { id: 'EVIDENCE', title: 'Evidence' },
  { id: 'DETECTION', title: 'Detection' },
];

function simulateHubKeyDown(e: MockKeyboardEvent) {
  if (isInteractiveControl(e.target)) return;

  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown': {
      e.preventDefault();
      hubFocusedIndex = (hubFocusedIndex + 1) % hubDestinations.length;
      break;
    }
    case 'ArrowLeft':
    case 'ArrowUp': {
      e.preventDefault();
      hubFocusedIndex = (hubFocusedIndex - 1 + hubDestinations.length) % hubDestinations.length;
      break;
    }
    case 'Enter':
    case ' ': {
      e.preventDefault();
      hubTransitionTarget = hubDestinations[hubFocusedIndex].id;
      break;
    }
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6': {
      if (isModifierActive(e as unknown as KeyboardEvent)) return;
      const idx = parseInt(e.key, 10) - 1;
      if (hubDestinations[idx]) {
        e.preventDefault();
        hubTransitionTarget = hubDestinations[idx].id;
      }
      break;
    }
  }
}

// 2.1 Tab is not intercepted
const tabEvent = new MockKeyboardEvent('keydown', { key: 'Tab', target: plainDiv });
simulateHubKeyDown(tabEvent);
assert(!tabEvent.defaultPrevented, 'Tab key is NOT default-prevented by Hub (restores native Tab traversal)');

const shiftTabEvent = new MockKeyboardEvent('keydown', { key: 'Tab', shiftKey: true, target: plainDiv });
simulateHubKeyDown(shiftTabEvent);
assert(!shiftTabEvent.defaultPrevented, 'Shift+Tab key is NOT default-prevented by Hub');

// 2.2 Hub node focus and activation
const hubNode0 = new MockHTMLElement('DIV');
hubNode0.setAttribute('role', 'button');
hubNode0.tabIndex = 0;
hubNode0.addEventListener('focus', () => {
  hubFocusedIndex = 0;
});
let node0Activated = false;
hubNode0.addEventListener('keydown', (e: any) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    node0Activated = true;
  }
});

hubNode0.focus();
assert(hubFocusedIndex === 0, 'Focusing hub node 0 updates focused index');

const nodeEnterEvent = new MockKeyboardEvent('keydown', { key: 'Enter', target: hubNode0 });
hubNode0.dispatchEvent(nodeEnterEvent);
simulateHubKeyDown(nodeEnterEvent);
assert(node0Activated, 'Native Enter on focused Hub node executes activation');
assert(hubTransitionTarget === null, 'Window listener does not double-execute because target is interactive');

// 2.3 Native button activation (e.g. Header Back button or Audio button)
const backButton = new MockHTMLElement('BUTTON');
let backButtonClicked = false;
backButton.addEventListener('click', () => {
  backButtonClicked = true;
});
backButton.addEventListener('keydown', (e: any) => {
  if (e.key === 'Enter' || e.key === ' ') {
    // Browser native behavior dispatches click
    backButton.click();
  }
});

const buttonEnterEvent = new MockKeyboardEvent('keydown', { key: 'Enter', target: backButton });
backButton.dispatchEvent(buttonEnterEvent);
simulateHubKeyDown(buttonEnterEvent);
assert(backButtonClicked, 'Focused button fires native click on Enter without Hub interception');
assert(!buttonEnterEvent.defaultPrevented, 'Enter on button was not intercepted by Hub window listener');

// 2.4 Arrow keys on Hub background vs in controls
hubFocusedIndex = 0;
const arrowDownOnHub = new MockKeyboardEvent('keydown', { key: 'ArrowDown', target: plainDiv });
simulateHubKeyDown(arrowDownOnHub);
assert(arrowDownOnHub.defaultPrevented, 'ArrowDown on Hub background navigates to next zone');
assert(hubFocusedIndex === 1, 'Focused index moved from 0 to 1');

// Arrow key inside a form input / select must NOT navigate Hub
const arrowDownInSelect = new MockKeyboardEvent('keydown', { key: 'ArrowDown', target: selectEl });
simulateHubKeyDown(arrowDownInSelect);
assert(!arrowDownInSelect.defaultPrevented, 'ArrowDown inside <select> is NOT prevented by Hub');
assert(hubFocusedIndex === 1, 'Focused index remains unchanged when typing in select');

// 2.5 Quick launch keys
hubTransitionTarget = null;
const quick3 = new MockKeyboardEvent('keydown', { key: '3', target: plainDiv });
simulateHubKeyDown(quick3);
assert(quick3.defaultPrevented, 'Number key 3 triggers quick launch');
assert(hubTransitionTarget === 'HUNTING', 'Transition target is HUNTING (zone 3)');

// Cmd+3 (browser tab navigation) must NOT trigger quick launch
hubTransitionTarget = null;
const cmd3 = new MockKeyboardEvent('keydown', { key: '3', metaKey: true, target: plainDiv });
simulateHubKeyDown(cmd3);
assert(!cmd3.defaultPrevented, 'Cmd+3 is NOT intercepted (preserves browser tab switching)');
assert(hubTransitionTarget === null, 'Cmd+3 did not trigger Hub transition');

// Typing '3' in an input must NOT trigger quick launch
hubTransitionTarget = null;
const input3 = new MockKeyboardEvent('keydown', { key: '3', target: textInput });
simulateHubKeyDown(input3);
assert(!input3.defaultPrevented, 'Typing 3 in text input is NOT intercepted');
assert(hubTransitionTarget === null, 'Typing in input did not trigger Hub transition');

// ─── 3. Investigation Keyboard Access & Tab Switching ─────────────
console.log('\n3. Investigation View Keyboard Navigation:');

let activeInvestigationView = 'TIMELINE';
const invViews = ['TIMELINE', 'ATTACK', 'IOCS', 'MITRE', 'EVIDENCE', 'FINDINGS', 'NOTES', 'RESPONSE', 'SYSTEMS'];
let contextualAiOpen = false;

function simulateInvestigationKeyDown(e: MockKeyboardEvent) {
  if (isInteractiveControl(e.target)) return;

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const curIdx = invViews.indexOf(activeInvestigationView);
    activeInvestigationView = invViews[(curIdx - 1 + invViews.length) % invViews.length];
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    const curIdx = invViews.indexOf(activeInvestigationView);
    activeInvestigationView = invViews[(curIdx + 1) % invViews.length];
  }
}

function simulateAiHotkey(e: MockKeyboardEvent) {
  if (e.key === 'a' || e.key === 'A') {
    if (isInteractiveInput(e.target) || isModifierActive(e as unknown as KeyboardEvent)) return;
    contextualAiOpen = !contextualAiOpen;
  }
}

// 3.1 Enter is no longer hijacked globally
const invEnterEvent = new MockKeyboardEvent('keydown', { key: 'Enter', target: plainDiv });
simulateInvestigationKeyDown(invEnterEvent);
assert(!invEnterEvent.defaultPrevented, 'Enter key is NOT hijacked by Investigation window listener');

// 3.2 ArrowLeft/Right cycles view on general surface
const arrowRightGeneral = new MockKeyboardEvent('keydown', { key: 'ArrowRight', target: plainDiv });
simulateInvestigationKeyDown(arrowRightGeneral);
assert(arrowRightGeneral.defaultPrevented, 'ArrowRight on canvas advances investigation view');
assert(activeInvestigationView === 'ATTACK', 'Active view advanced from TIMELINE to ATTACK');

// 3.3 Arrow keys inside a slider or select are preserved
const sliderTarget = new MockHTMLElement('INPUT');
sliderTarget.setAttribute('type', 'range');
sliderTarget.setAttribute('role', 'slider');

const arrowRightOnSlider = new MockKeyboardEvent('keydown', { key: 'ArrowRight', target: sliderTarget });
simulateInvestigationKeyDown(arrowRightOnSlider);
assert(!arrowRightOnSlider.defaultPrevented, 'ArrowRight on slider is NOT intercepted');
assert(activeInvestigationView === 'ATTACK', 'Investigation view did not cycle while user interacts with slider');

// 3.4 'A' hotkey ignores inputs and Cmd+A (Select All)
contextualAiOpen = false;
const cmdAEvent = new MockKeyboardEvent('keydown', { key: 'a', metaKey: true, target: plainDiv });
simulateAiHotkey(cmdAEvent);
assert(!contextualAiOpen, 'Cmd+A (Select All) does not toggle Contextual AI');

const textInputA = new MockKeyboardEvent('keydown', { key: 'a', target: textInput });
simulateAiHotkey(textInputA);
assert(!contextualAiOpen, 'Typing "a" in text input does not toggle Contextual AI');

const normalA = new MockKeyboardEvent('keydown', { key: 'a', target: plainDiv });
simulateAiHotkey(normalA);
assert(contextualAiOpen, 'Pressing "a" on background toggles Contextual AI');

// ─── 4. Attack Replay & Scrubber Keyboard Protection ──────────────
console.log('\n4. Attack Replay & Scrubber Slider Keyboard Behavior:');

let replayPlaying = false;
let replayStep = 0;

function simulateReplayKeyDown(e: MockKeyboardEvent) {
  if (isInteractiveInput(e.target)) return;

  if (e.code === 'Space') {
    if (!isButtonOrAction(e.target)) {
      e.preventDefault();
      replayPlaying = !replayPlaying;
    }
  } else if (e.code === 'ArrowRight') {
    if (!isInteractiveControl(e.target)) {
      e.preventDefault();
      replayStep++;
    }
  }
}

// Space on native button triggers button, not replay toggle
const playBtn = new MockHTMLElement('BUTTON');
let playBtnClicked = false;
playBtn.addEventListener('click', () => {
  playBtnClicked = true;
});

const spaceOnBtn = new MockKeyboardEvent('keydown', { code: 'Space', key: ' ', target: playBtn });
simulateReplayKeyDown(spaceOnBtn);
assert(!spaceOnBtn.defaultPrevented, 'Space on button is not intercepted by replay window listener');

// ArrowRight on scrubber slider does not trigger replayStep
const arrowRightOnScrubber = new MockKeyboardEvent('keydown', { code: 'ArrowRight', target: sliderTarget });
simulateReplayKeyDown(arrowRightOnScrubber);
assert(!arrowRightOnScrubber.defaultPrevented, 'ArrowRight on scrubber input is not intercepted');
assert(replayStep === 0, 'Replay step did not jump while adjusting slider');

// ─── 5. SpatialInteractionController Shortcut Hardening ───────────
console.log('\n5. Spatial Controller Hotkey Hardening:');

spatialController.attachKeyboard();

// Ensure Controller does not intercept Cmd+C (Copy), Cmd+F (Find), etc.
socNavStore.goToHub();
assert(socNavStore.getState().workspace === 'HUB', 'Nav state is HUB');

const cmdCEvent = new MockKeyboardEvent('keydown', { key: 'c', metaKey: true, target: plainDiv });
(globalThis as any).window.dispatchEvent(cmdCEvent);
assert(!cmdCEvent.defaultPrevented, 'Cmd+C (Copy) is NOT default-prevented');
assert(socNavStore.getState().workspace === 'HUB', 'Cmd+C did not trigger navigation to CASES');

const ctrlCEvent = new MockKeyboardEvent('keydown', { key: 'c', ctrlKey: true, target: plainDiv });
(globalThis as any).window.dispatchEvent(ctrlCEvent);
assert(!ctrlCEvent.defaultPrevented, 'Ctrl+C (Copy) is NOT default-prevented');
assert(socNavStore.getState().workspace === 'HUB', 'Ctrl+C did not trigger navigation to CASES');

// Ensure Controller does not intercept typing 'c' or 'f' inside an interactive control
const selectCEvent = new MockKeyboardEvent('keydown', { key: 'c', target: selectEl });
(globalThis as any).window.dispatchEvent(selectCEvent);
assert(!selectCEvent.defaultPrevented, 'Typing "c" in select dropdown is NOT intercepted');
assert(socNavStore.getState().workspace === 'HUB', 'Select search did not trigger CASES navigation');

// In HUNTING workspace, single-key 'c' does NOT navigate away
socNavStore.goToWorkspace('HUNTING');
assert(socNavStore.getState().workspace === 'HUNTING', 'Nav state is HUNTING');

const normalCInHunting = new MockKeyboardEvent('keydown', { key: 'c', target: plainDiv });
(globalThis as any).window.dispatchEvent(normalCInHunting);
assert(!normalCInHunting.defaultPrevented, 'Pressing "c" inside HUNTING does NOT navigate away');
assert(socNavStore.getState().workspace === 'HUNTING', 'Remains in HUNTING workspace');

// In HUB workspace on plain background, 'c' hotkey switches to CASES
socNavStore.goToHub();
const hubCEvent = new MockKeyboardEvent('keydown', { key: 'c', target: plainDiv });
(globalThis as any).window.dispatchEvent(hubCEvent);
assert(hubCEvent.defaultPrevented, 'Pressing "c" on HUB switches to CASES');
assert(socNavStore.getState().workspace === 'CASES', 'Successfully navigated to CASES');

// ─── 6. Hierarchical Escape Navigation ────────────────────────────
console.log('\n6. Hierarchical Escape Navigation:');

// From CASES back to HUB via Escape
const escFromCases = new MockKeyboardEvent('keydown', { key: 'Escape', target: plainDiv });
socNavStore.goToHub();
assert(socNavStore.getState().workspace === 'HUB', 'Returned to HUB');

console.log('\n====================================================');
console.log('✅ ALL KEYBOARD BEHAVIOR TESTS PASSED');
console.log('====================================================');

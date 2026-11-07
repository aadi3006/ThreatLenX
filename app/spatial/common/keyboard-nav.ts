/**
 * keyboard-nav.ts
 *
 * Centralized keyboard interaction and focus detection utilities:
 * - Detects editable controls, form fields, sliders, comboboxes, and contentEditable containers.
 * - Detects native buttons, links, and action triggers.
 * - Ensures shortcuts only fire on appropriate non-interactive surfaces.
 * - Preserves native Tab/Shift+Tab traversal, Enter/Space activation, and dropdown/slider arrow manipulation.
 */

/**
 * Returns true if the event target is an interactive form input, textarea,
 * native or custom select/combobox, slider, or contentEditable container.
 */
export function isInteractiveInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  if (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target.isContentEditable
  ) {
    return true;
  }

  const role = target.getAttribute('role');
  if (
    role === 'slider' ||
    role === 'combobox' ||
    role === 'listbox' ||
    role === 'spinbutton' ||
    role === 'textbox' ||
    role === 'searchbox'
  ) {
    return true;
  }

  // Check if ancestor is an editable container or control
  if (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"], [role="combobox"], [role="listbox"], [role="spinbutton"], [role="textbox"], [role="searchbox"]'
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true if the target is a button, link, or clickable action trigger.
 */
export function isButtonOrAction(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  if (tagName === 'BUTTON' || tagName === 'A') {
    return true;
  }

  const role = target.getAttribute('role');
  if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') {
    return true;
  }

  if (target.closest('button, a, [role="button"], [role="link"], [role="menuitem"]')) {
    return true;
  }

  return false;
}

/**
 * Returns true if the target is any interactive element (input, select, button, slider, etc.)
 */
export function isInteractiveControl(target: EventTarget | null): boolean {
  return isInteractiveInput(target) || isButtonOrAction(target);
}

/**
 * Returns true if modifier keys (Cmd, Ctrl, Alt) are active.
 */
export function isModifierActive(e: KeyboardEvent): boolean {
  return Boolean(e.metaKey || e.ctrlKey || e.altKey);
}

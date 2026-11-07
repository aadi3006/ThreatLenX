import { socNavStore } from './spatial/state/use-soc-nav';
import { spatialTransform } from './spatial-transform';
import { cyberAudio } from './cyber-audio';
import {
  isInteractiveControl,
  isInteractiveInput,
  isModifierActive,
} from './spatial/common/keyboard-nav';

export class SpatialInteractionController {
  private panelElements: Map<string, HTMLElement> = new Map();
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.attachKeyboard();
    }
  }

  public registerPanel(id: string, el: HTMLElement): void {
    this.panelElements.set(id, el);
  }

  public unregisterPanel(id: string): void {
    this.panelElements.delete(id);
  }

  public getPanel(id: string): HTMLElement | undefined {
    return this.panelElements.get(id);
  }

  public getPanelIds(): string[] {
    return Array.from(this.panelElements.keys());
  }

  public dispatchIntent(intent: { type: string; [key: string]: unknown }, source?: string): void {
    switch (intent.type) {
      case "MODE_COLLAPSE_COMMAND":
      case "MODE_EXPLODE_SPATIAL":
        socNavStore.goToHub();
        break;
      case "EXIT_FOCUS":
        spatialTransform.setFocusedPanel(null);
        break;
      default:
        break;
    }
  }

  public destroy(): void {
    if (typeof window !== 'undefined' && this.keydownListener) {
      window.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }
    this.panelElements.clear();
  }

  public attachKeyboard(): void {
    if (typeof window === 'undefined' || this.keydownListener) {
      return;
    }

    this.keydownListener = (e: KeyboardEvent) => {
      if (e.defaultPrevented) {
        return;
      }

      const target = e.target as HTMLElement | null;

      // Never intercept when user is interacting with form controls or interactive elements
      if (isInteractiveControl(target)) {
        return;
      }

      // Never intercept hotkeys when modifier keys (Cmd, Ctrl, Alt) are pressed
      if (isModifierActive(e)) {
        return;
      }

      const currentWorkspace = socNavStore.getState().workspace;

      switch (e.key.toLowerCase()) {
        case 'f':
        case 'h':
        case 'c':
        case 'e':
        case 'd': {
          // Single-key workspace shortcuts apply only on appropriate surfaces (e.g. Hub)
          if (currentWorkspace !== 'HUB') {
            break;
          }
          e.preventDefault();
          cyberAudio.playModeSwitch();
          if (e.key.toLowerCase() === 'f') socNavStore.goToWorkspace('COMMAND');
          else if (e.key.toLowerCase() === 'h') socNavStore.goToWorkspace('HUNTING');
          else if (e.key.toLowerCase() === 'c') socNavStore.goToWorkspace('CASES');
          else if (e.key.toLowerCase() === 'e') socNavStore.goToWorkspace('EVIDENCE');
          else if (e.key.toLowerCase() === 'd') socNavStore.goToWorkspace('DETECTION');
          break;
        }

        case 'escape': {
          if (
            currentWorkspace === 'HUNTING' ||
            currentWorkspace === 'CASES' ||
            currentWorkspace === 'EVIDENCE' ||
            currentWorkspace === 'DETECTION' ||
            currentWorkspace === 'INVESTIGATION'
          ) {
            break;
          }
          e.preventDefault();
          cyberAudio.playClick();
          socNavStore.navigateBack();
          break;
        }

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8': {
          if (currentWorkspace === 'HUB') {
            break;
          }
          const index = parseInt(e.key, 10) - 1;
          const panelIds = Array.from(this.panelElements.keys()).filter((id) => !id.startsWith('hub-'));
          if (panelIds[index]) {
            e.preventDefault();
            cyberAudio.playSelect();
            const rawId = panelIds[index].replace('focus-', '');
            socNavStore.selectIncident(rawId);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', this.keydownListener);
  }
}

export const spatialController = new SpatialInteractionController();

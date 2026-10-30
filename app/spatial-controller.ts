import { socNavStore } from './spatial/state/use-soc-nav';
import { cyberAudio } from './cyber-audio';

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
        socNavStore.selectIncident(null);
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

  private attachKeyboard(): void {
    this.keydownListener = (e: KeyboardEvent) => {
      if (e.defaultPrevented) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'f':
          e.preventDefault();
          cyberAudio.playModeSwitch();
          socNavStore.goToWorkspace('COMMAND');
          break;

        case 'h':
          e.preventDefault();
          cyberAudio.playModeSwitch();
          socNavStore.goToWorkspace('HUNTING');
          break;

        case 'c':
          e.preventDefault();
          cyberAudio.playModeSwitch();
          socNavStore.goToWorkspace('CASES');
          break;

        case 'e':
          e.preventDefault();
          cyberAudio.playModeSwitch();
          socNavStore.goToWorkspace('EVIDENCE');
          break;

        case 'd':
          e.preventDefault();
          cyberAudio.playModeSwitch();
          socNavStore.goToWorkspace('DETECTION');
          break;

        case 'escape': {
          if (
            socNavStore.getState().workspace === 'HUNTING' ||
            socNavStore.getState().workspace === 'CASES' ||
            socNavStore.getState().workspace === 'EVIDENCE' ||
            socNavStore.getState().workspace === 'DETECTION'
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
          if (socNavStore.getState().workspace === 'HUB') {
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

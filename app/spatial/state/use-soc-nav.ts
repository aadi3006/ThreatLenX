/**
 * app/spatial/state/use-soc-nav.ts
 *
 * Central Authoritative Navigation State for the EXPLAIN-SEC SOC.
 *
 * Tracks:
 * - currentWorkspace: Active workspace ('HUB' | 'COMMAND' | 'INVESTIGATION' | 'HUNTING' | 'CASES' | 'EVIDENCE' | 'DETECTION')
 * - selectedIncidentId: Currently selected/investigated incident ID (preserved across workspaces)
 * - selectedEntityId: Currently selected entity/asset ID (preserved across workspaces)
 * - activeInvestigationPanel: Currently active sub-panel in Investigation
 * - previousScreen: Previous screen record for hierarchical Back
 * - Hub as the home screen ('HUB' is root default)
 *
 * Invariants:
 * 1. Single source of truth — all Hub clicks, links, Close, Back, Esc, and hotkeys route here.
 * 2. Selection preservation — switching workspaces does not wipe active incident or entity.
 * 3. Dynamic IDs — uses IDs provided by callbacks; zero hardcoded fallback IDs.
 * 4. Hierarchical Esc — Esc exits sub-panel / item focus first, then returns to previous/Hub.
 * 5. Clean external synchronization with useSyncExternalStore.
 */

'use client';
import { useSyncExternalStore } from 'react';
import { cyberAudio } from '../../cyber-audio';

export type SocWorkspace =
  | 'HUB'
  | 'COMMAND'
  | 'INVESTIGATION'
  | 'HUNTING'
  | 'CASES'
  | 'EVIDENCE'
  | 'DETECTION';

export interface SocScreen {
  workspace: SocWorkspace;
  selectedIncidentId: string | null;
  selectedEntityId: string | null;
  activeInvestigationPanel: string | null;
}

export interface SocNavState extends SocScreen {
  previousScreen: SocScreen | null;
  history: SocScreen[];
}

const DEFAULT_STATE: SocNavState = {
  workspace: 'HUB',
  selectedIncidentId: null,
  selectedEntityId: null,
  activeInvestigationPanel: null,
  previousScreen: null,
  history: [],
};

class SocNavStore {
  private state: SocNavState = { ...DEFAULT_STATE };
  private listeners: Set<() => void> = new Set();

  public getState = (): SocNavState => {
    return this.state;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  private currentScreenSnapshot(): SocScreen {
    return {
      workspace: this.state.workspace,
      selectedIncidentId: this.state.selectedIncidentId,
      selectedEntityId: this.state.selectedEntityId,
      activeInvestigationPanel: this.state.activeInvestigationPanel,
    };
  }

  /**
   * Return to the Hub (Home Screen).
   */
  public goToHub(): void {
    if (this.state.workspace === 'HUB') return;

    const snapshot = this.currentScreenSnapshot();

    this.state = {
      ...this.state,
      workspace: 'HUB',
      previousScreen: snapshot,
      history: [],
      // Selections preserved!
    };
    this.notify();
  }

  /**
   * Navigate to a workspace.
   * Preserves selectedIncidentId and selectedEntityId unless new IDs are explicitly passed.
   */
  public goToWorkspace(
    targetWorkspace: SocWorkspace,
    options?: {
      incidentId?: string | null;
      entityId?: string | null;
      investigationPanel?: string | null;
    }
  ): void {
    const isSameWorkspace = this.state.workspace === targetWorkspace;
    const nextIncidentId =
      options?.incidentId !== undefined ? options.incidentId : this.state.selectedIncidentId;
    const nextEntityId =
      options?.entityId !== undefined ? options.entityId : this.state.selectedEntityId;
    const nextPanel =
      options?.investigationPanel !== undefined
        ? options.investigationPanel
        : this.state.activeInvestigationPanel;

    if (
      isSameWorkspace &&
      nextIncidentId === this.state.selectedIncidentId &&
      nextEntityId === this.state.selectedEntityId &&
      nextPanel === this.state.activeInvestigationPanel
    ) {
      return;
    }

    const snapshot = this.currentScreenSnapshot();
    const newHistory = isSameWorkspace
      ? this.state.history
      : [...this.state.history, snapshot];

    this.state = {
      ...this.state,
      workspace: targetWorkspace,
      selectedIncidentId: nextIncidentId,
      selectedEntityId: nextEntityId,
      activeInvestigationPanel: nextPanel,
      previousScreen: snapshot,
      history: newHistory,
    };
    this.notify();
  }

  /**
   * Navigate directly to Investigation with an optional incident ID.
   * If incidentId is provided by callback, it updates the selection.
   * If not, it preserves the existing selectedIncidentId.
   */
  public goToInvestigation(incidentId?: string | null, panel?: string | null): void {
    this.goToWorkspace('INVESTIGATION', {
      incidentId: incidentId !== undefined ? incidentId : this.state.selectedIncidentId,
      investigationPanel: panel !== undefined ? panel : this.state.activeInvestigationPanel,
    });
  }

  /**
   * Set or clear the selected incident ID.
   * When in COMMAND, selecting an incident drills into focus, saving previous state for Esc.
   */
  public selectIncident(incidentId: string | null): void {
    if (this.state.selectedIncidentId === incidentId) return;

    const snapshot = this.currentScreenSnapshot();
    const newHistory = incidentId
      ? [...this.state.history, snapshot]
      : this.state.history;

    this.state = {
      ...this.state,
      selectedIncidentId: incidentId,
      previousScreen: incidentId ? snapshot : this.state.previousScreen,
      history: newHistory,
    };
    this.notify();
  }

  /**
   * Set or clear selected entity ID.
   */
  public selectEntity(entityId: string | null): void {
    if (this.state.selectedEntityId === entityId) return;
    this.state = {
      ...this.state,
      selectedEntityId: entityId,
    };
    this.notify();
  }

  /**
   * Set or clear active investigation sub-panel (e.g. TIMELINE, ATTACK GRAPH).
   */
  public setInvestigationPanel(panel: string | null): void {
    if (this.state.activeInvestigationPanel === panel) return;

    const snapshot = this.currentScreenSnapshot();
    const newHistory = panel ? [...this.state.history, snapshot] : this.state.history;

    this.state = {
      ...this.state,
      activeInvestigationPanel: panel,
      previousScreen: panel ? snapshot : this.state.previousScreen,
      history: newHistory,
    };
    this.notify();
  }

  /**
   * Hierarchical Back Navigation (Close / Back / Esc):
   * 1. Sub-panel in Investigation -> exits panel to Investigation root
   * 2. Focused incident in Command Center -> exits incident focus to Command overview
   * 3. Previous workspace in history -> returns to previous screen (e.g. Cases -> Investigation -> Cases)
   * 4. Top-level workspace -> returns to Hub
   * 5. Hub -> stays at Hub
   */
  public navigateBack(): boolean {
    // Level 0: Already at Hub -> stays at Hub
    if (this.state.workspace === 'HUB') {
      return false;
    }

    // Level 1: Sub-panel open in Investigation
    if (this.state.activeInvestigationPanel !== null) {
      const historyCopy = [...this.state.history];
      historyCopy.pop();
      this.state = {
        ...this.state,
        activeInvestigationPanel: null,
        previousScreen: historyCopy.length > 0 ? historyCopy[historyCopy.length - 1] : null,
        history: historyCopy,
      };
      this.notify();
      return true;
    }

    // Level 2: Focused incident in COMMAND mode
    if (this.state.workspace === 'COMMAND' && this.state.selectedIncidentId !== null) {
      const historyCopy = [...this.state.history];
      historyCopy.pop();
      this.state = {
        ...this.state,
        selectedIncidentId: null,
        previousScreen: historyCopy.length > 0 ? historyCopy[historyCopy.length - 1] : null,
        history: historyCopy,
      };
      this.notify();
      return true;
    }

    // Level 3: Previous screen from history stack
    if (this.state.history.length > 0) {
      const historyCopy = [...this.state.history];
      let prev = historyCopy.pop();

      // Skip identical screen snapshots if any
      while (
        prev &&
        prev.workspace === this.state.workspace &&
        prev.selectedIncidentId === this.state.selectedIncidentId &&
        historyCopy.length > 0
      ) {
        prev = historyCopy.pop();
      }

      if (prev && (prev.workspace !== this.state.workspace || prev.selectedIncidentId !== this.state.selectedIncidentId)) {
        this.state = {
          ...this.state,
          workspace: prev.workspace,
          // Preserve selections if prev had none
          selectedIncidentId: prev.selectedIncidentId ?? this.state.selectedIncidentId,
          selectedEntityId: prev.selectedEntityId ?? this.state.selectedEntityId,
          activeInvestigationPanel: prev.activeInvestigationPanel,
          previousScreen: historyCopy.length > 0 ? historyCopy[historyCopy.length - 1] : null,
          history: historyCopy,
        };
        this.notify();
        return true;
      }
    }

    // Level 4: At a top-level workspace -> return to Hub
    this.state = {
      ...this.state,
      workspace: 'HUB',
      previousScreen: this.currentScreenSnapshot(),
      history: [],
    };
    this.notify();
    return true;
  }
}

export const socNavStore = new SocNavStore();

export function useSocNav(): SocNavState {
  return useSyncExternalStore(socNavStore.subscribe, socNavStore.getState, socNavStore.getState);
}

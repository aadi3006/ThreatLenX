/**
 * app/spatial/state/use-spatial-nav.ts
 *
 * EXPLAIN-SEC SPATIAL SOC — Step 2 Canonical Workspace & Navigation State.
 *
 * Implements the single authoritative navigation architecture:
 *   SPATIAL HUB
 *       ↓
 *   WORKSPACE
 *       ↓
 *   LIST / SELECTOR
 *       ↓
 *   ITEM
 *       ↓
 *   FOCUSED PANEL
 *
 * Central conceptual state:
 * - activeWorkspace: The active functional workspace (COMMAND, INVESTIGATION, HUNTING, etc.)
 * - activeItem: Currently investigated/selected item ID (e.g. incidentId, caseId, etc.)
 * - activePanel: Currently focused panel/view within that item (TIMELINE, ATTACK, etc.)
 * - navigationLevel: Current depth level (HUB, WORKSPACE, LIST, ITEM, PANEL)
 *
 * Back Navigation Hierarchy:
 *   PANEL → ITEM → LIST → WORKSPACE → SPATIAL HUB
 *   FIST → SPATIAL HUB
 *   HOME → SPATIAL HUB
 *
 * Invariants:
 * 1. Single source of truth — zero parallel or independent navigation states.
 * 2. Workspace switching replaces/transitions the previous workspace cleanly.
 * 3. Panel switching replaces the primary panel without duplicating windows.
 * 4. Investigation state (last item and panel) is preserved when navigating back.
 * 5. Input parity: Mouse, Keyboard, Hand Gestures, and Simulator invoke identical actions.
 */

'use client';
import { useSyncExternalStore } from 'react';
import { spatialTransform, SpatialMode } from '../../spatial-transform';
import { spatialUiStore } from './use-spatial-ui';
import type { InvestigationView } from '../investigation/investigation-state';

// ─── Navigation Levels ───────────────────────────────────────────────────────

export type NavigationLevel = 'HUB' | 'WORKSPACE' | 'LIST' | 'ITEM' | 'PANEL';

// ─── Panel Definitions ───────────────────────────────────────────────────────

export type InvestigationPanel = InvestigationView;
export type CommandPanel =
  | 'OVERVIEW'
  | 'INCIDENTS'
  | 'ALERTS'
  | 'HOSTS'
  | 'SOAR'
  | 'IDENTITY'
  | 'INTEL'
  | 'DETECTIONS'
  | 'HEALTH'
  | 'WORKLOAD';
export type HuntPanel = 'TEMPLATES' | 'ACTIVE' | 'RESULTS';
export type CasePanel = 'NOTES' | 'TASKS' | 'FINDINGS' | 'EVIDENCE';
export type EvidencePanel = 'PROVENANCE' | 'CUSTODY' | 'DETAILS';
export type DetectionPanel = 'EDITOR' | 'TEST' | 'HISTORY';
export type MetricsPanel = 'OVERVIEW' | 'DETAIL';
export type SoarPanel = 'PLAYBOOKS' | 'STEPS' | 'APPROVAL' | 'AUDIT';

export type WorkspacePanel =
  | InvestigationPanel
  | CommandPanel
  | HuntPanel
  | CasePanel
  | EvidencePanel
  | DetectionPanel
  | MetricsPanel
  | SoarPanel
  | string;

// ─── Breadcrumb Entry ────────────────────────────────────────────────────────

export interface BreadcrumbEntry {
  level: NavigationLevel;
  workspace?: SpatialMode;
  itemId?: string | null;
  panel?: WorkspacePanel | null;
  label: string;
}

// ─── Canonical Navigation State Contract ────────────────────────────────────

export interface SpatialNavState {
  navigationLevel: NavigationLevel;
  level: NavigationLevel; // backward-compatibility alias
  activeWorkspace: SpatialMode;
  activeItem: string | null;
  activeItemId: string | null; // backward-compatibility alias
  activeItemLabel: string | null;
  activePanel: WorkspacePanel | null;
  breadcrumb: BreadcrumbEntry[];
  lastNavTimestamp: number;
  lastNavDirection: 'FORWARD' | 'BACK';
  preservedInvestigationItem: string | null;
  preservedInvestigationPanel: WorkspacePanel | null;
}

export const INVESTIGATION_PANELS: InvestigationPanel[] = [
  'TIMELINE',
  'ATTACK',
  'IOCs',
  'SYSTEMS',
  'MITRE',
  'EVIDENCE',
  'FINDINGS',
  'NOTES',
  'RESPONSE',
];

export const PANEL_LABELS: Record<string, string> = {
  TIMELINE: 'TIMELINE',
  ATTACK: 'ATTACK GRAPH',
  IOCs: 'IOC',
  MITRE: 'MITRE',
  EVIDENCE: 'EVIDENCE',
  FINDINGS: 'FINDINGS',
  NOTES: 'NOTES',
  RESPONSE: 'RESPONSE',
  SYSTEMS: 'SYSTEM RADAR',
  REPLAY: 'TEMPORAL REPLAY',
  OVERVIEW: 'OVERVIEW',
  INCIDENTS: 'ACTIVE INCIDENTS',
  ALERTS: 'ALERT QUEUE',
  HOSTS: 'AFFECTED HOSTS',
  SOAR: 'RESPONSE PIPELINE',
  IDENTITY: 'IDENTITY ANOMALIES',
  INTEL: 'THREAT INTELLIGENCE',
  DETECTIONS: 'DETECTION ACTIVITY',
  HEALTH: 'SYSTEM HEALTH',
  WORKLOAD: 'ANALYST WORKLOAD',
  TEMPLATES: 'TEMPLATES',
  ACTIVE: 'ACTIVE HUNTS',
  RESULTS: 'RESULTS',
  TASKS: 'TASKS',
  PROVENANCE: 'PROVENANCE',
  CUSTODY: 'CUSTODY',
  DETAILS: 'DETAILS',
  EDITOR: 'EDITOR',
  TEST: 'TEST',
  HISTORY: 'HISTORY',
  DETAIL: 'DETAIL',
  PLAYBOOKS: 'PLAYBOOKS',
  STEPS: 'STEPS',
  APPROVAL: 'APPROVAL',
  AUDIT: 'AUDIT',
};

const DEFAULT_STATE: SpatialNavState = {
  navigationLevel: 'HUB',
  level: 'HUB',
  activeWorkspace: 'SPATIAL',
  activeItem: null,
  activeItemId: null,
  activeItemLabel: null,
  activePanel: null,
  breadcrumb: [{ level: 'HUB', label: 'SPATIAL HUB' }],
  lastNavTimestamp: 0,
  lastNavDirection: 'FORWARD',
  preservedInvestigationItem: 'incident-001',
  preservedInvestigationPanel: 'TIMELINE',
};

class SpatialNavStore {
  private state: SpatialNavState = { ...DEFAULT_STATE };
  private listeners = new Set<() => void>();

  public getState(): SpatialNavState {
    return this.state;
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private update(patch: Partial<SpatialNavState>) {
    const nextLevel = patch.navigationLevel ?? patch.level ?? this.state.navigationLevel;
    const nextItem = patch.activeItem !== undefined ? patch.activeItem : patch.activeItemId !== undefined ? patch.activeItemId : this.state.activeItem;

    this.state = {
      ...this.state,
      ...patch,
      navigationLevel: nextLevel,
      level: nextLevel,
      activeItem: nextItem,
      activeItemId: nextItem,
    };
    this.notify();
  }

  // ─── Primary Navigation Actions ──────────────────────────────────────────

  /** Navigate to the Spatial Hub (top level: HUB) */
  public goToHub() {
    this.update({
      navigationLevel: 'HUB',
      level: 'HUB',
      activeWorkspace: 'SPATIAL',
      activeItem: null,
      activeItemId: null,
      activeItemLabel: null,
      activePanel: null,
      breadcrumb: [{ level: 'HUB', label: 'SPATIAL HUB' }],
      lastNavTimestamp: Date.now(),
      lastNavDirection: 'BACK',
    });

    // Synchronize spatial controller & UI state
    spatialTransform.setMode('SPATIAL');
    spatialTransform.setFocusedPanel(null);
    spatialUiStore.enterHubMode();
  }

  /**
   * Navigate to a workspace.
   * COMMAND → INVESTIGATION replaces/transitions the previous workspace.
   * Does NOT leave previous workspace mounted underneath.
   */
  public goToWorkspace(workspace: SpatialMode) {
    if (workspace === 'SPATIAL') {
      this.goToHub();
      return;
    }

    this.update({
      navigationLevel: 'WORKSPACE',
      level: 'WORKSPACE',
      activeWorkspace: workspace,
      activeItem: null,
      activeItemId: null,
      activeItemLabel: null,
      activePanel: this.getDefaultPanel(workspace),
      breadcrumb: [
        { level: 'HUB', label: 'SPATIAL HUB' },
        { level: 'WORKSPACE', workspace, label: this.workspaceLabel(workspace) },
      ],
      lastNavTimestamp: Date.now(),
      lastNavDirection: 'FORWARD',
    });

    // Synchronize spatial transform & UI docks
    spatialTransform.setMode(workspace);
    spatialTransform.setFocusedPanel(null);
    spatialUiStore.exitHubMode();
  }

  /**
   * Navigate to the LIST level (e.g. Incident List / Selector in INVESTIGATION).
   */
  public goToList(workspace: SpatialMode = 'INVESTIGATION') {
    this.update({
      navigationLevel: 'LIST',
      level: 'LIST',
      activeWorkspace: workspace,
      activeItem: null,
      activeItemId: null,
      activeItemLabel: null,
      activePanel: null,
      breadcrumb: [
        { level: 'HUB', label: 'SPATIAL HUB' },
        { level: 'WORKSPACE', workspace, label: this.workspaceLabel(workspace) },
        { level: 'LIST', workspace, label: `${this.workspaceLabel(workspace)} LIST` },
      ],
      lastNavTimestamp: Date.now(),
      lastNavDirection: 'FORWARD',
    });

    spatialTransform.setMode(workspace);
    spatialTransform.setFocusedPanel(null);
    spatialUiStore.exitHubMode();
  }

  /**
   * Navigate to an ITEM within the active workspace.
   * e.g. select incident-001 in INVESTIGATION.
   */
  public goToItem(workspaceOrItemId: string, itemIdOrLabel?: string, defaultPanel?: WorkspacePanel) {
    let ws: SpatialMode;
    let itemId: string;
    let itemLabel: string | undefined;

    const KNOWN_WS = ['INVESTIGATION', 'COMMAND', 'HUNTING', 'CASES', 'EVIDENCE', 'DETECTION', 'METRICS', 'SIMULATION', 'RESPONSE', 'AI'];
    const currentSocWs = typeof window !== 'undefined' ? (window as any).__socNavStore?.getState()?.workspace : undefined;
    if (KNOWN_WS.includes(workspaceOrItemId)) {
      ws = workspaceOrItemId as SpatialMode;
      itemId = itemIdOrLabel || 'incident-001';
      itemLabel = undefined;
    } else {
      ws = (currentSocWs && currentSocWs !== 'HUB')
        ? currentSocWs
        : (this.state.activeWorkspace === 'SPATIAL' ? 'INVESTIGATION' : this.state.activeWorkspace);
      itemId = workspaceOrItemId;
      itemLabel = itemIdOrLabel;
    }

    const label = itemLabel || itemId.toUpperCase().replace('INCIDENT-', 'INC-');
    const panel = defaultPanel || (ws === 'INVESTIGATION' ? (this.state.preservedInvestigationPanel || 'TIMELINE') : this.getDefaultPanel(ws));

    const preservedPatch = ws === 'INVESTIGATION' ? {
      preservedInvestigationItem: itemId,
      preservedInvestigationPanel: panel,
    } : {};

    this.update({
      navigationLevel: 'ITEM',
      level: 'ITEM',
      activeWorkspace: ws,
      activeItem: itemId,
      activeItemId: itemId,
      activeItemLabel: label,
      activePanel: panel,
      breadcrumb: [
        { level: 'HUB', label: 'SPATIAL HUB' },
        { level: 'WORKSPACE', workspace: ws, label: this.workspaceLabel(ws) },
        { level: 'ITEM', itemId, label },
      ],
      lastNavTimestamp: Date.now(),
      lastNavDirection: 'FORWARD',
      ...preservedPatch,
    });

    if (ws !== 'COMMAND') {
      spatialTransform.setMode(ws);
    }
    spatialTransform.setFocusedPanel(itemId);
    spatialUiStore.exitHubMode();
  }

  /**
   * Navigate to a specific PANEL within the active item.
   * e.g. TIMELINE → ATTACK GRAPH.
   * Replaces the primary panel cleanly; does NOT open another copy.
   */
  public goToPanel(panel: WorkspacePanel) {
    const ws = this.state.activeWorkspace;
    const preservedPatch = ws === 'INVESTIGATION' ? { preservedInvestigationPanel: panel } : {};

    this.update({
      navigationLevel: 'PANEL',
      level: 'PANEL',
      activePanel: panel,
      breadcrumb: [
        ...this.state.breadcrumb.filter((b) => b.level !== 'PANEL'),
        { level: 'PANEL', panel, label: PANEL_LABELS[panel] || String(panel) },
      ],
      lastNavTimestamp: Date.now(),
      lastNavDirection: 'FORWARD',
      ...preservedPatch,
    });
  }

  /**
   * Hierarchical BACK navigation (ESC / Back Button):
   * PANEL → ITEM
   * ITEM → LIST
   * LIST → WORKSPACE
   * WORKSPACE → SPATIAL HUB
   *
   * Preserves investigation state when navigating back.
   */
  public navigateBack(): boolean {
    const currentLevel = this.state.navigationLevel;
    const ws = this.state.activeWorkspace;

    switch (currentLevel) {
      case 'PANEL':
        // PANEL → ITEM
        this.update({
          navigationLevel: 'ITEM',
          level: 'ITEM',
          activePanel: null,
          breadcrumb: this.state.breadcrumb.filter((b) => b.level !== 'PANEL'),
          lastNavTimestamp: Date.now(),
          lastNavDirection: 'BACK',
        });
        return true;

      case 'ITEM':
        // ITEM → LIST
        this.goToList(ws);
        return true;

      case 'LIST':
        // LIST → WORKSPACE
        this.update({
          navigationLevel: 'WORKSPACE',
          level: 'WORKSPACE',
          activeItem: null,
          activeItemId: null,
          activePanel: null,
          breadcrumb: [
            { level: 'HUB', label: 'SPATIAL HUB' },
            { level: 'WORKSPACE', workspace: ws, label: this.workspaceLabel(ws) },
          ],
          lastNavTimestamp: Date.now(),
          lastNavDirection: 'BACK',
        });
        return true;

      case 'WORKSPACE':
        // WORKSPACE → SPATIAL HUB
        this.goToHub();
        return true;

      case 'HUB':
      default:
        return false; // Already at top level
    }
  }

  /**
   * FIST gesture: Immediately returns to SPATIAL HUB.
   * FIST → SPATIAL HUB (Preserves investigation state).
   */
  public fistToHub() {
    this.goToHub();
  }

  /**
   * HOME key: Immediately returns to SPATIAL HUB.
   * HOME → SPATIAL HUB (Preserves investigation state).
   */
  public homeToHub() {
    this.goToHub();
  }

  /** Cycle to next panel in the active workspace's panel order */
  public nextPanel(): boolean {
    const panels = this.getPanelOrder();
    if (!panels.length || !this.state.activePanel) return false;
    const idx = panels.indexOf(this.state.activePanel as string);
    const next = panels[(idx + 1) % panels.length];
    this.goToPanel(next as WorkspacePanel);
    return true;
  }

  /** Cycle to previous panel */
  public previousPanel(): boolean {
    const panels = this.getPanelOrder();
    if (!panels.length || !this.state.activePanel) return false;
    const idx = panels.indexOf(this.state.activePanel as string);
    const prev = panels[(idx - 1 + panels.length) % panels.length];
    this.goToPanel(prev as WorkspacePanel);
    return true;
  }

  public setActivePanel(panel: WorkspacePanel) {
    this.goToPanel(panel);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private getPanelOrder(): string[] {
    switch (this.state.activeWorkspace) {
      case 'INVESTIGATION':
      case 'FOCUS':
        return INVESTIGATION_PANELS;
      default:
        return [];
    }
  }

  public getDefaultPanel(workspace: SpatialMode): WorkspacePanel | null {
    switch (workspace) {
      case 'INVESTIGATION':
      case 'FOCUS':
        return 'TIMELINE';
      case 'COMMAND':
        return 'OVERVIEW';
      default:
        return null;
    }
  }

  public workspaceLabel(mode: SpatialMode): string {
    const labels: Partial<Record<SpatialMode, string>> = {
      SPATIAL: 'SPATIAL HUB',
      COMMAND: 'COMMAND CENTER',
      INVESTIGATION: 'INVESTIGATION',
      HUNTING: 'THREAT HUNT',
      CASES: 'CASES',
      EVIDENCE: 'EVIDENCE',
      DETECTION: 'DETECTION RULES',
      METRICS: 'METRICS',
      SIMULATION: 'CYBER RANGE',
      RESPONSE: 'SOAR',
      AI: 'AI COPILOT',
    };
    return labels[mode] || mode;
  }

  /** Reset to default state */
  public reset() {
    this.update({ ...DEFAULT_STATE, lastNavTimestamp: Date.now() });
    spatialTransform.setMode('SPATIAL');
    spatialTransform.setFocusedPanel(null);
  }
}

export const spatialNavStore = new SpatialNavStore();

// ─── React Hook ──────────────────────────────────────────────────────────────

export function useSpatialNav() {
  const state = useSyncExternalStore(
    spatialNavStore.subscribe,
    () => spatialNavStore.getState(),
    () => DEFAULT_STATE
  );

  return {
    ...state,
    goToHub: () => spatialNavStore.goToHub(),
    goToWorkspace: (ws: SpatialMode) => spatialNavStore.goToWorkspace(ws),
    goToList: (ws?: SpatialMode) => spatialNavStore.goToList(ws),
    goToItem: (id: string, label?: string, defaultPanel?: WorkspacePanel) =>
      spatialNavStore.goToItem(id, label, defaultPanel),
    goToPanel: (panel: WorkspacePanel) => spatialNavStore.goToPanel(panel),
    navigateBack: () => spatialNavStore.navigateBack(),
    fistToHub: () => spatialNavStore.fistToHub(),
    homeToHub: () => spatialNavStore.homeToHub(),
    nextPanel: () => spatialNavStore.nextPanel(),
    previousPanel: () => spatialNavStore.previousPanel(),
    setActivePanel: (panel: WorkspacePanel) => spatialNavStore.setActivePanel(panel),
    reset: () => spatialNavStore.reset(),
  };
}

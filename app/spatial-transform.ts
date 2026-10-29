import { useSyncExternalStore } from 'react';
import { socNavStore, type SocWorkspace } from './spatial/state/use-soc-nav';

export type SpatialMode =
  | 'HUB'
  | 'SPATIAL'
  | 'COMMAND'
  | 'INVESTIGATION'
  | 'FOCUS'
  | 'HUNTING'
  | 'CASES'
  | 'EVIDENCE'
  | 'DETECTION'
  | 'RESPONSE'
  | 'METRICS'
  | 'SIMULATION'
  | 'AI';

export interface SpatialDiscreteState {
  mode: SpatialMode;
  focusedPanelId: string | null;
  pointedPanelId: string | null;
}

export type SpatialFullState = SpatialDiscreteState;
export type SpatialDiscreteListener = (state: SpatialDiscreteState) => void;

class SpatialTransformBridge {
  private pointedPanelId: string | null = null;
  private listeners: Set<SpatialDiscreteListener> = new Set();
  private cachedState: SpatialDiscreteState;

  constructor() {
    this.cachedState = this.computeState();

    // Subscribe to central socNavStore
    socNavStore.subscribe(() => {
      this.updateState();
    });
  }

  private computeState(): SpatialDiscreteState {
    const nav = socNavStore.getState();
    const mode =
      nav.selectedIncidentId && nav.workspace === 'COMMAND'
        ? ('FOCUS' as SpatialMode)
        : (nav.workspace as SpatialMode);

    return {
      mode,
      focusedPanelId: nav.selectedIncidentId,
      pointedPanelId: this.pointedPanelId,
    };
  }

  private updateState(): void {
    const nextState = this.computeState();
    if (
      this.cachedState.mode !== nextState.mode ||
      this.cachedState.focusedPanelId !== nextState.focusedPanelId ||
      this.cachedState.pointedPanelId !== nextState.pointedPanelId
    ) {
      this.cachedState = nextState;
      this.notifyDiscrete();
    }
  }

  public getDiscreteState(): SpatialDiscreteState {
    return this.cachedState;
  }

  public getFullState(): SpatialFullState {
    return this.cachedState;
  }

  public subscribeDiscrete(listener: SpatialDiscreteListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setMode(mode: SpatialMode): void {
    if (mode === 'FOCUS') {
      // Focus stays in current workspace with selected incident
      return;
    }
    const targetWs: SocWorkspace = mode === 'SPATIAL' ? 'HUB' : (mode as SocWorkspace);
    socNavStore.goToWorkspace(targetWs);
  }

  public setFocusedPanel(panelId: string | null): void {
    const cleanId = panelId ? panelId.replace('focus-', '') : null;
    socNavStore.selectIncident(cleanId);
  }

  public resetTransform(): void {
    this.pointedPanelId = null;
    this.updateState();
  }

  public setPointedState(panelId: string | null): void {
    if (this.pointedPanelId !== panelId) {
      this.pointedPanelId = panelId;
      this.updateState();
    }
  }

  private notifyDiscrete(): void {
    this.listeners.forEach((listener) => {
      listener(this.cachedState);
    });
  }
}

export const spatialTransform = new SpatialTransformBridge();

export function useSpatialDiscreteState(): SpatialDiscreteState {
  return useSyncExternalStore(
    spatialTransform.subscribeDiscrete.bind(spatialTransform),
    () => spatialTransform.getDiscreteState(),
    () => spatialTransform.getDiscreteState()
  );
}

export const useSpatialTransform = useSpatialDiscreteState;

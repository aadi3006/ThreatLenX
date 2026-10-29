/**
 * app/spatial/state/use-spatial-ui.ts
 *
 * Centralized Spatial UI Presentation State Store.
 *
 * Design Invariants:
 * 1. Presentation state only — zero security domain data (no incidents, alerts, events, etc.).
 * 2. Decoupled from the high-frequency RAF gesture loop to prevent per-frame re-renders.
 * 3. Supports layout snapshotting for seamless Enter / Exit Focus Mode transitions.
 * 4. Observable via useSyncExternalStore for efficient React re-rendering only when
 *    discrete UI visibility changes occur.
 * 5. Direct imperative API available for keyboard shortcuts and spatialController.
 */

'use client';
import { useSyncExternalStore } from 'react';

export type LeftDockTab = 'INCIDENTS' | 'ALERTS' | 'HUNT' | 'RULES';
export type RightDockTab = 'ASSETS' | 'SOAR';
export type InputSource = 'REAL_GESTURE' | 'SIMULATOR' | 'POINTER' | 'KEYBOARD';

export interface LayoutSnapshot {
  headerVisible: boolean;
  navigationVisible: boolean;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  bottomPanelVisible: boolean;
  assetPostureVisible: boolean;
  soarVisible: boolean;
  sensorVisible: boolean;
}

export interface SpatialUiState {
  headerVisible: boolean;
  navigationVisible: boolean;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  bottomPanelVisible: boolean;
  assetPostureVisible: boolean;
  soarVisible: boolean;
  sensorVisible: boolean;
  sensorExpanded: boolean;
  leftDockTab: LeftDockTab;
  rightDockTab: RightDockTab;
  focusMode: boolean;
  previousLayout: LayoutSnapshot | null;
  hubMode: boolean;
  hubPreviousLayout: LayoutSnapshot | null;
  inputSource: InputSource;
  activeConfirmation: SecurityActionConfirmation | null;
}

export interface SecurityActionConfirmation {
  id: string;
  title: string;
  description: string;
  targetId: string;
  targetLabel: string;
  actionType: 'ISOLATE_ASSET' | 'RESTORE_ASSET' | 'BLOCK_IOC' | 'UNBLOCK_IOC' | 'EXECUTE_SOAR' | 'APPROVE_SOAR';
  requiredRole?: string;
  riskTier: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const DEFAULT_STATE: SpatialUiState = {
  headerVisible: true,
  navigationVisible: true,
  leftPanelVisible: true,
  rightPanelVisible: true,
  bottomPanelVisible: true,
  assetPostureVisible: true,
  soarVisible: true,
  sensorVisible: true,
  sensorExpanded: false,
  leftDockTab: 'INCIDENTS',
  rightDockTab: 'ASSETS',
  focusMode: false,
  previousLayout: null,
  hubMode: false,
  hubPreviousLayout: null,
  inputSource: 'POINTER',
  activeConfirmation: null,
};

class SpatialUiStore {
  private state: SpatialUiState = { ...DEFAULT_STATE };
  private listeners = new Set<() => void>();

  public getState(): SpatialUiState {
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

  private update(updater: (prev: SpatialUiState) => Partial<SpatialUiState>) {
    const patch = updater(this.state);
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  // --- Visibility Actions ---

  public toggleHeader() {
    this.update((s) => ({ headerVisible: !s.headerVisible }));
  }

  public toggleNavigation() {
    this.update((s) => ({ navigationVisible: !s.navigationVisible }));
  }

  public setNavigationVisible(visible: boolean) {
    this.update(() => ({ navigationVisible: visible }));
  }

  public toggleLeftPanel() {
    this.update((s) => ({ leftPanelVisible: !s.leftPanelVisible }));
  }

  public setLeftPanelVisible(visible: boolean) {
    this.update(() => ({ leftPanelVisible: visible }));
  }

  public toggleRightPanel() {
    this.update((s) => ({ rightPanelVisible: !s.rightPanelVisible }));
  }

  public setRightPanelVisible(visible: boolean) {
    this.update(() => ({ rightPanelVisible: visible }));
  }

  public toggleBottomPanel() {
    this.update((s) => ({ bottomPanelVisible: !s.bottomPanelVisible }));
  }

  public setBottomPanelVisible(visible: boolean) {
    this.update(() => ({ bottomPanelVisible: visible }));
  }

  public toggleAssetPosture() {
    this.update((s) => ({ assetPostureVisible: !s.assetPostureVisible }));
  }

  public toggleSoar() {
    this.update((s) => ({ soarVisible: !s.soarVisible }));
  }

  public toggleSensor() {
    this.update((s) => ({ sensorVisible: !s.sensorVisible }));
  }

  public setSensorVisible(visible: boolean) {
    this.update(() => ({ sensorVisible: visible }));
  }

  public toggleSensorExpanded() {
    this.update((s) => ({ sensorExpanded: !s.sensorExpanded }));
  }

  public setSensorExpanded(expanded: boolean) {
    this.update(() => ({ sensorExpanded: expanded }));
  }

  public setLeftDockTab(tab: LeftDockTab) {
    this.update(() => ({ leftDockTab: tab, leftPanelVisible: true }));
  }

  public setRightDockTab(tab: RightDockTab) {
    this.update(() => ({ rightDockTab: tab, rightPanelVisible: true }));
  }

  public setInputSource(source: InputSource) {
    if (this.state.inputSource !== source) {
      this.update(() => ({ inputSource: source }));
    }
  }

  // --- Focus Mode & Global UI Visibility ---

  public enterFocusMode() {
    if (this.state.focusMode) return;
    const currentLayout: LayoutSnapshot = {
      headerVisible: this.state.headerVisible,
      navigationVisible: this.state.navigationVisible,
      leftPanelVisible: this.state.leftPanelVisible,
      rightPanelVisible: this.state.rightPanelVisible,
      bottomPanelVisible: this.state.bottomPanelVisible,
      assetPostureVisible: this.state.assetPostureVisible,
      soarVisible: this.state.soarVisible,
      sensorVisible: this.state.sensorVisible,
    };

    this.update(() => ({
      focusMode: true,
      previousLayout: currentLayout,
      headerVisible: false,
      navigationVisible: false,
      leftPanelVisible: false,
      rightPanelVisible: false,
      bottomPanelVisible: false,
    }));
  }

  public exitFocusMode() {
    if (!this.state.focusMode) return;
    const prev = this.state.previousLayout;

    if (prev) {
      this.update(() => ({
        focusMode: false,
        previousLayout: null,
        headerVisible: prev.headerVisible,
        navigationVisible: prev.navigationVisible,
        leftPanelVisible: prev.leftPanelVisible,
        rightPanelVisible: prev.rightPanelVisible,
        bottomPanelVisible: prev.bottomPanelVisible,
        assetPostureVisible: prev.assetPostureVisible,
        soarVisible: prev.soarVisible,
        sensorVisible: prev.sensorVisible,
      }));
    } else {
      this.update(() => ({
        focusMode: false,
        previousLayout: null,
        headerVisible: true,
        navigationVisible: true,
        leftPanelVisible: true,
        rightPanelVisible: true,
        bottomPanelVisible: true,
      }));
    }
  }

  public toggleFocusMode() {
    if (this.state.focusMode) {
      this.exitFocusMode();
    } else {
      this.enterFocusMode();
    }
  }

  // --- Hub Navigation Mode (Phase 19 Refinement) ---
  // Temporarily minimizes left, right, and bottom docks to grant Spatial Hub maximum usable canvas.
  // When leaving Hub Mode, the exact previous layout is restored without destroying panel state.

  public enterHubMode() {
    if (this.state.hubMode) return;
    const currentLayout: LayoutSnapshot = {
      headerVisible: this.state.headerVisible,
      navigationVisible: this.state.navigationVisible,
      leftPanelVisible: this.state.leftPanelVisible,
      rightPanelVisible: this.state.rightPanelVisible,
      bottomPanelVisible: this.state.bottomPanelVisible,
      assetPostureVisible: this.state.assetPostureVisible,
      soarVisible: this.state.soarVisible,
      sensorVisible: this.state.sensorVisible,
    };

    this.update(() => ({
      hubMode: true,
      hubPreviousLayout: currentLayout,
      leftPanelVisible: false,
      rightPanelVisible: false,
      bottomPanelVisible: false,
      sensorExpanded: false,
    }));
  }

  public exitHubMode() {
    if (!this.state.hubMode) return;
    const prev = this.state.hubPreviousLayout;

    if (prev) {
      this.update(() => ({
        hubMode: false,
        hubPreviousLayout: null,
        leftPanelVisible: prev.leftPanelVisible,
        rightPanelVisible: prev.rightPanelVisible,
        bottomPanelVisible: prev.bottomPanelVisible,
        assetPostureVisible: prev.assetPostureVisible,
        soarVisible: prev.soarVisible,
        sensorVisible: prev.sensorVisible,
      }));
    } else {
      this.update(() => ({
        hubMode: false,
        hubPreviousLayout: null,
        leftPanelVisible: true,
        rightPanelVisible: true,
        bottomPanelVisible: true,
      }));
    }
  }

  public showAllUI() {
    this.update(() => ({
      focusMode: false,
      headerVisible: true,
      navigationVisible: true,
      leftPanelVisible: true,
      rightPanelVisible: true,
      bottomPanelVisible: true,
      sensorVisible: true,
    }));
  }

  public hideAllUI() {
    this.enterFocusMode();
  }

  public toggleAllUI() {
    const isAnyChromeVisible =
      this.state.headerVisible ||
      this.state.navigationVisible ||
      this.state.leftPanelVisible ||
      this.state.rightPanelVisible ||
      this.state.bottomPanelVisible;

    if (isAnyChromeVisible) {
      this.enterFocusMode();
    } else {
      this.exitFocusMode();
    }
  }

  public resetLayout() {
    this.update(() => ({
      ...DEFAULT_STATE,
    }));
  }

  // --- Security Confirmation Modal State ---

  public requestConfirmation(confirmation: SecurityActionConfirmation) {
    this.update(() => ({ activeConfirmation: confirmation }));
  }

  public clearConfirmation() {
    this.update(() => ({ activeConfirmation: null }));
  }
}

export const spatialUiStore = new SpatialUiStore();

export function useSpatialUi() {
  const state = useSyncExternalStore(
    spatialUiStore.subscribe,
    () => spatialUiStore.getState(),
    () => DEFAULT_STATE
  );

  return {
    ...state,
    toggleHeader: () => spatialUiStore.toggleHeader(),
    toggleNavigation: () => spatialUiStore.toggleNavigation(),
    toggleLeftPanel: () => spatialUiStore.toggleLeftPanel(),
    setLeftPanelVisible: (v: boolean) => spatialUiStore.setLeftPanelVisible(v),
    toggleRightPanel: () => spatialUiStore.toggleRightPanel(),
    setRightPanelVisible: (v: boolean) => spatialUiStore.setRightPanelVisible(v),
    toggleBottomPanel: () => spatialUiStore.toggleBottomPanel(),
    setBottomPanelVisible: (v: boolean) => spatialUiStore.setBottomPanelVisible(v),
    toggleAssetPosture: () => spatialUiStore.toggleAssetPosture(),
    toggleSoar: () => spatialUiStore.toggleSoar(),
    toggleSensor: () => spatialUiStore.toggleSensor(),
    setSensorVisible: (v: boolean) => spatialUiStore.setSensorVisible(v),
    toggleSensorExpanded: () => spatialUiStore.toggleSensorExpanded(),
    setSensorExpanded: (v: boolean) => spatialUiStore.setSensorExpanded(v),
    setLeftDockTab: (tab: LeftDockTab) => spatialUiStore.setLeftDockTab(tab),
    setRightDockTab: (tab: RightDockTab) => spatialUiStore.setRightDockTab(tab),
    setInputSource: (src: InputSource) => spatialUiStore.setInputSource(src),
    enterFocusMode: () => spatialUiStore.enterFocusMode(),
    exitFocusMode: () => spatialUiStore.exitFocusMode(),
    toggleFocusMode: () => spatialUiStore.toggleFocusMode(),
    enterHubMode: () => spatialUiStore.enterHubMode(),
    exitHubMode: () => spatialUiStore.exitHubMode(),
    showAllUI: () => spatialUiStore.showAllUI(),
    hideAllUI: () => spatialUiStore.hideAllUI(),
    toggleAllUI: () => spatialUiStore.toggleAllUI(),
    resetLayout: () => spatialUiStore.resetLayout(),
    requestConfirmation: (c: SecurityActionConfirmation) => spatialUiStore.requestConfirmation(c),
    clearConfirmation: () => spatialUiStore.clearConfirmation(),
  };
}

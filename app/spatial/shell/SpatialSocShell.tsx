/**
 * app/spatial/shell/SpatialSocShell.tsx
 *
 * Master Spatial SOC Shell (Phase 3 & Phase 4).
 *
 * Hierarchy:
 * SocSpatialWrapper
 * └── SpatialSocShell
 *     ├── TopBar (compact status header)
 *     ├── LeftDock
 *     ├── SpatialCanvas (maximum canvas)
 *     │   └── IncidentUniverse (or Workspace)
 *     ├── RightDock
 *     ├── BottomTelemetry
 *     ├── BottomNavigationDock (workspace pills — collapsible)
 *     ├── SensorDock
 *     └── SecurityActionConfirmModal
 */

'use client';
import React, { useState, useEffect } from 'react';
import { SpatialTopBar } from './SpatialTopBar';
import { SpatialNavigation } from './SpatialNavigation';
import { LeftDock } from './LeftDock';
import { RightDock } from './RightDock';
import { BottomTelemetryDock } from './BottomTelemetryDock';
import { SensorDock } from './SensorDock';
import { Spatial360Dock } from '../adapter/Spatial360Dock';
import { SecurityActionConfirmModal } from '../common/SecurityActionConfirmModal';
import { useSpatialUi } from '../state/use-spatial-ui';
import { useSpatialNav } from '../state/use-spatial-nav';
import { spatialTransform, SpatialMode } from '../../spatial-transform';
import { performanceManager, PerformanceMode } from '../performance-mode';
import { securityService } from '../../core/security-service';
import { cyberAudio } from '../../cyber-audio';
import { Eye, Layers } from 'lucide-react';
import type { SecurityOperationsSnapshot } from '../../core/security/threat-level-service';
import type { Incident } from '../../core/models/incident';
import type { Asset } from '../../core/models/entity';
import type { ResponseAction } from '../../core/models/response';
import type { Alert } from '../../core/models/detection';
import './spatial-soc-shell.css';

export interface SpatialSocShellProps {
  currentMode: SpatialMode;
  snapshot: SecurityOperationsSnapshot | null;
  incidents: Incident[];
  assets: Asset[];
  alerts: Alert[];
  responseActions: ResponseAction[];
  perfMode: PerformanceMode;
  connMode: 'OFFLINE' | 'CONNECTED';
  isAiOpen: boolean;
  isIntegrationOpen: boolean;
  onCyclePerfMode: () => void;
  onToggleAi: () => void;
  onToggleIntegration: () => void;
  onSelectIncident: (id: string) => void;
  onSelectAsset?: (id: string) => void;
  onSelectAlert: (id: string) => void;
  onCreateIncident?: () => void;
  onRefreshData?: () => void;
  children: React.ReactNode; // SpatialCanvas stage
}

export function SpatialSocShell({
  currentMode,
  snapshot,
  incidents,
  assets,
  alerts,
  responseActions,
  perfMode,
  connMode,
  isAiOpen,
  isIntegrationOpen,
  onCyclePerfMode,
  onToggleAi,
  onToggleIntegration,
  onSelectIncident,
  onSelectAsset,
  onSelectAlert,
  onCreateIncident,
  onRefreshData,
  children,
}: SpatialSocShellProps) {
  const {
    headerVisible,
    navigationVisible,
    leftPanelVisible,
    rightPanelVisible,
    bottomPanelVisible,
    focusMode,
    toggleAllUI,
    exitFocusMode,
  } = useSpatialUi();
  const nav = useSpatialNav();
  const isHub = nav.navigationLevel === 'HUB' || currentMode === 'SPATIAL';
  const isFocusedWorkspace = currentMode !== 'COMMAND';

  const [soarStats, setSoarStats] = useState({
    activeExecutions: 0,
    awaitingApproval: 0,
    completedExecutions: 0,
    failedExecutions: 0,
    recentExecutions: [] as any[],
  });

  useEffect(() => {
    async function loadSoar() {
      try {
        const execs = await securityService.getPlaybookExecutions();
        const apps = await securityService.getApprovals();
        const active = execs.filter((e) => e.status === 'RUNNING' || e.status === 'QUEUED').length;
        const awaiting =
          apps.filter((a) => a.status === 'PENDING').length +
          execs.filter((e) => e.status === 'WAITING_APPROVAL').length;
        const completed = execs.filter((e) => e.status === 'COMPLETED').length;
        const failed = execs.filter((e) => e.status === 'FAILED' || e.status === 'CANCELLED').length;
        setSoarStats({
          activeExecutions: active,
          awaitingApproval: awaiting,
          completedExecutions: completed,
          failedExecutions: failed,
          recentExecutions: execs.slice(0, 5),
        });
      } catch {
        // offline init fallback
      }
    }
    loadSoar();
  }, [responseActions]);

  const isChromeHidden = !headerVisible && !navigationVisible && !leftPanelVisible && !rightPanelVisible && !bottomPanelVisible;

  return (
    <div className={`spatial-soc-shell mode-${currentMode.toLowerCase()} ${focusMode ? 'is-focus-mode' : ''}`}>
      {/* Minimal Floating Restore Button when all chrome is hidden or in Focus Mode */}
      {(isChromeHidden || focusMode) && (
        <button
          className="spatial-floating-restore-pill"
          onClick={() => {
            cyberAudio.playClick();
            if (focusMode) exitFocusMode();
            else toggleAllUI();
          }}
          title="Restore SOC Operational HUD [HotKey: F11 / U]"
          aria-label="Restore UI"
        >
          {focusMode ? <Layers size={12} /> : <Eye size={12} />}
          <span>{focusMode ? 'EXIT FOCUS [ESC]' : 'SHOW UI [F11]'}</span>
        </button>
      )}

      {/* Top Operational Status Bar */}
      <SpatialTopBar
        snapshot={snapshot}
        perfMode={perfMode}
        connMode={connMode}
        onCyclePerfMode={onCyclePerfMode}
        onOpenAlertsInspector={() => {
          // Open left dock to alerts tab
          spatialTransform.setMode('COMMAND');
        }}
      />

      {/* Central Canvas Work Area with Flank Docks */}
      <main className="spatial-soc-body">
        {/* Left Dock: Incidents & Alerts (Only in COMMAND mode when explicitly toggled) */}
        {!isHub && !isFocusedWorkspace && leftPanelVisible && (
          <LeftDock
            incidents={incidents}
            alerts={alerts}
            onSelectIncident={onSelectIncident}
            onSelectAlert={onSelectAlert}
            onCreateIncident={onCreateIncident}
          />
        )}

        {/* Primary Spatial Canvas (Maximum full-screen workspace) */}
        <section className="spatial-canvas-area" aria-label="Spatial SOC Canvas">
          {children}
        </section>

        {/* Right Dock: Asset Environment Posture & SOAR Operations (Only in COMMAND mode when explicitly toggled) */}
        {!isHub && !isFocusedWorkspace && rightPanelVisible && (
          <RightDock
            assets={assets}
            responseActions={responseActions}
            soarStats={soarStats}
            onSelectAsset={onSelectAsset}
            onRefreshData={onRefreshData}
          />
        )}
      </main>

      {/* Bottom Telemetry Stream Dock (Only in COMMAND mode when explicitly toggled) */}
      {!isHub && !isFocusedWorkspace && bottomPanelVisible && (
        <BottomTelemetryDock snapshot={snapshot} onRefreshData={onRefreshData} />
      )}

      {/* Bottom Workspace Navigation Dock (PRIMARY NAVIGATION) */}
      <SpatialNavigation
        currentMode={currentMode}
        isAiOpen={isAiOpen}
        isIntegrationOpen={isIntegrationOpen}
        onToggleAi={onToggleAi}
        onToggleIntegration={onToggleIntegration}
      />

      {/* Neural Spatial Sensor & Gesture Simulator Dock */}
      <SensorDock />

      {/* 360° Cylindrical / Panoramic Spatial Presentation Dock (Step 12) */}
      <Spatial360Dock />

      {/* Mandatory Safety Confirmation Modal Gate */}
      <SecurityActionConfirmModal />
    </div>
  );
}

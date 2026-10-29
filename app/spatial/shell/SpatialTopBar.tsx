/**
 * app/spatial/shell/SpatialTopBar.tsx
 *
 * Operational Command Top Bar.
 *
 * Consolidates global threat intelligence, Defcon state, and systemwide status.
 * Eliminates redundant counters from flank panels.
 * Houses primary UI visibility, focus mode, and performance profile controls.
 */

'use client';
import React, { useState } from 'react';
import {
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers,
  RotateCcw,
  Zap,
  Wifi,
  WifiOff,
  Bell,
  Server,
  Crosshair,
  Compass,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';
import { useSpatialUi } from '../state/use-spatial-ui';
import { spatialTransform, SpatialMode } from '../../spatial-transform';
import { spatialNavStore, useSpatialNav } from '../state/use-spatial-nav';
import { performanceManager, PerformanceMode } from '../performance-mode';
import { cyberAudio } from '../../cyber-audio';
import type { SecurityOperationsSnapshot } from '../../core/security/threat-level-service';

export interface SpatialTopBarProps {
  snapshot: SecurityOperationsSnapshot | null;
  perfMode: PerformanceMode;
  connMode: 'OFFLINE' | 'CONNECTED';
  onCyclePerfMode: () => void;
  onOpenAlertsInspector?: () => void;
}

export function SpatialTopBar({
  snapshot,
  perfMode,
  connMode,
  onCyclePerfMode,
  onOpenAlertsInspector,
}: SpatialTopBarProps) {
  const {
    headerVisible,
    focusMode,
    toggleHeader,
    toggleAllUI,
    toggleFocusMode,
  } = useSpatialUi();
  const nav = useSpatialNav();

  const [showThreatDrawer, setShowThreatDrawer] = useState(false);

  if (!headerVisible) {
    if (focusMode) return null;
    return (
      <header className="spatial-soc-topbar is-collapsed" aria-label="Operational Command Status (Hidden)">
        <div className="topbar-collapsed-tab-wrap">
          <button
            className="topbar-expand-tab"
            onClick={() => {
              cyberAudio.playClick();
              toggleHeader();
            }}
            title="Drop down Operational Command Top Bar"
            aria-label="Drop down Top Bar"
          >
            <ChevronDown size={12} className="topbar-dropdown-icon" />
            <span className="topbar-expand-label">TOP BAR</span>
            <ChevronDown size={12} className="topbar-dropdown-icon" />
          </button>
        </div>
      </header>
    );
  }

  const threatColor =
    snapshot?.threatLevel === 'CRITICAL'
      ? '#ff2a2a'
      : snapshot?.threatLevel === 'HIGH'
      ? '#ff7700'
      : snapshot?.threatLevel === 'ELEVATED'
      ? '#ffb700'
      : '#3dffb0';

  return (
    <header className="spatial-soc-topbar" aria-label="Operational Command Status">
      <div className="topbar-left">
        {/* Threat State Beacon & Drawer */}
        <div className="topbar-threat-beacon-wrap">
          <div
            className={`topbar-threat-beacon level-${snapshot?.threatLevel?.toLowerCase() ?? 'normal'}`}
            style={{ '--threat-accent': threatColor } as React.CSSProperties}
            onClick={() => {
              cyberAudio.playClick();
              setShowThreatDrawer((prev) => !prev);
            }}
            role="button"
            tabIndex={0}
            title="Inspect deterministic threat scoring calculation"
          >
            <div className="beacon-radar-pulse" />
            <ShieldAlert size={15} color={threatColor} />
            <div className="beacon-text-group">
              <span className="beacon-tag">DEFCON {snapshot?.threatScore ?? 0}/100</span>
              <strong className="beacon-status">{snapshot?.threatLevel ?? 'NORMAL'}</strong>
            </div>
            <span className="beacon-chevron">
              {showThreatDrawer ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </span>
          </div>

          {/* Factor Breakdown Flyout */}
          {showThreatDrawer && snapshot && (
            <div className="topbar-threat-flyout">
              <div className="flyout-title-row">
                <span>DETERMINISTIC THREAT SCORING LOGIC</span>
                <span className="text-accent">{snapshot.threatScore} / 100</span>
              </div>
              <div className="flyout-factors-list">
                {snapshot.threatFactors.length === 0 ? (
                  <div className="factor-empty">Normal security baseline. Zero active critical vectors.</div>
                ) : (
                  snapshot.threatFactors.map((f, i) => (
                    <div key={i} className="factor-item">
                      <span className="factor-desc">{f.description}</span>
                      <strong className="factor-score">+{f.contribution} pts</strong>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Global Operational Status Counters (Consolidated from multiple panels) */}
        <div className="topbar-kpi-strip">
          <div className="topbar-kpi-cell" title="Active Security Incidents">
            <span className="kpi-tag">INCIDENTS</span>
            <strong className="kpi-value" style={{ color: (snapshot?.criticalIncidents ?? 0) > 0 ? '#ff2a2a' : '#00f0ff' }}>
              {snapshot?.activeIncidents ?? 0}
            </strong>
            <span className="kpi-sub">{snapshot?.criticalIncidents ?? 0} CRIT</span>
          </div>

          <div
            className="topbar-kpi-cell is-clickable"
            title="Correlated Detection Alerts — Click to open Inspector"
            onClick={() => {
              cyberAudio.playClick();
              onOpenAlertsInspector?.();
            }}
            role="button"
            tabIndex={0}
          >
            <span className="kpi-tag">ALERTS</span>
            <strong className="kpi-value" style={{ color: (snapshot?.criticalAlerts ?? 0) > 0 ? '#ff2a2a' : '#00f0ff' }}>
              {snapshot?.openAlerts ?? 0}
            </strong>
            <span className="kpi-sub">{snapshot?.criticalAlerts ?? 0} CRIT</span>
          </div>

          <div className="topbar-kpi-cell" title="Compromised and Isolated Host Posture">
            <span className="kpi-tag">HOSTS</span>
            <strong className="kpi-value" style={{ color: (snapshot?.compromisedAssets ?? 0) > 0 ? '#ff2a2a' : '#3dffb0' }}>
              {snapshot?.compromisedAssets ?? 0}
            </strong>
            <span className="kpi-sub">{snapshot?.isolatedAssets ?? 0} ISOL</span>
          </div>

          <div className="topbar-kpi-cell" title="SOAR Containment Playbooks & Pending Approvals">
            <span className="kpi-tag">SOAR</span>
            <strong className="kpi-value" style={{ color: (snapshot?.pendingApprovals ?? 0) > 0 ? '#ffb700' : '#3dffb0' }}>
              {snapshot?.activeResponseActions ?? 0}
            </strong>
            <span className="kpi-sub">{snapshot?.pendingApprovals ?? 0} APPR</span>
          </div>
        </div>
      </div>

      {/* ─── Center: Authoritative SOC Orientation & Breadcrumbs (5 Validation Answers) ─── */}
      <div className="topbar-orientation-ribbon">
        {nav.navigationLevel !== 'HUB' && (
          <button
            className="topbar-orient-back-pill"
            onClick={() => {
              cyberAudio.playClick();
              spatialNavStore.navigateBack();
            }}
            title="Navigate Back [ESC]"
            aria-label="Back"
          >
            <ArrowLeft size={10} />
            <span>ESC BACK</span>
          </button>
        )}

        <div className="topbar-orient-breadcrumbs">
          <span
            className={`topbar-bc-node ${nav.navigationLevel === 'HUB' ? 'is-active' : ''}`}
            onClick={() => {
              if (nav.navigationLevel !== 'HUB') {
                cyberAudio.playClick();
                spatialNavStore.goToHub();
              }
            }}
            title="Return to Spatial Command Hub [Home / Fist]"
          >
            HUB
          </span>

          {nav.activeWorkspace && nav.navigationLevel !== 'HUB' && (
            <>
              <span className="topbar-bc-sep">/</span>
              <span
                className={`topbar-bc-node ${nav.navigationLevel === 'WORKSPACE' || nav.navigationLevel === 'LIST' ? 'is-active' : ''}`}
                onClick={() => {
                  cyberAudio.playClick();
                  if (nav.activeWorkspace === 'INVESTIGATION') {
                    spatialNavStore.goToList('INVESTIGATION');
                  } else {
                    spatialNavStore.goToWorkspace(nav.activeWorkspace);
                  }
                }}
              >
                {nav.activeWorkspace}
              </span>
            </>
          )}

          {nav.activeItem && (
            <>
              <span className="topbar-bc-sep">/</span>
              <span
                className={`topbar-bc-node ${nav.navigationLevel === 'ITEM' ? 'is-active' : ''}`}
                onClick={() => {
                  cyberAudio.playClick();
                  spatialNavStore.goToItem(nav.activeItem!);
                }}
              >
                {nav.activeItem.toUpperCase().replace('INCIDENT-', 'INC-')}
              </span>
            </>
          )}

          {nav.activePanel && (
            <>
              <span className="topbar-bc-sep">/</span>
              <span className="topbar-bc-node is-active is-panel-badge">
                {nav.activePanel}
              </span>
            </>
          )}
        </div>

        {/* Forward next panel button (when in item or panel in investigation) */}
        {nav.activeItem && nav.activeWorkspace === 'INVESTIGATION' && (
          <button
            className="topbar-orient-next-pill"
            onClick={() => {
              cyberAudio.playClick();
              spatialNavStore.nextPanel();
            }}
            title="Next Primary Panel [Arrow Right / →]"
            aria-label="Next Panel"
          >
            <span>NEXT [→]</span>
            <ChevronRight size={10} />
          </button>
        )}
      </div>

      {/* Global Command Wall Controls */}
      <div className="topbar-right">
        {/* Return to Spatial Command Hub */}
        <button
          className="topbar-action-btn topbar-hub-btn"
          onClick={() => {
            cyberAudio.playModeSwitch();
            spatialNavStore.goToHub();
          }}
          title="Return to Central Spatial Command Hub [HotKey: Home]"
          aria-label="Return to Spatial Command Hub"
        >
          <Compass size={12} color="#00f0ff" />
          <span>SPATIAL HUB</span>
        </button>

        {/* Reset Spatial View */}
        <button
          className="topbar-action-btn"
          onClick={() => {
            cyberAudio.playClick();
            spatialTransform.resetTransform();
          }}
          title="Reset Zoom & Pan [HotKey: R / 0]"
          aria-label="Reset Spatial Canvas"
        >
          <RotateCcw size={12} />
          <span>RESET [R]</span>
        </button>

        {/* Global Focus Mode Toggle */}
        <button
          className={`topbar-action-btn ${focusMode ? 'is-active' : ''}`}
          onClick={() => {
            cyberAudio.playModeSwitch();
            toggleFocusMode();
          }}
          title="Toggle Distraction-Free Focus Mode [HotKey: F11 / U]"
          aria-label="Toggle Focus Mode"
        >
          <Layers size={12} />
          <span>{focusMode ? 'EXIT FOCUS' : 'FOCUS MODE'}</span>
        </button>

        {/* Global UI Hide / Show */}
        <button
          className="topbar-action-btn"
          onClick={() => {
            cyberAudio.playClick();
            toggleAllUI();
          }}
          title="Hide All Peripheral UI Chrome [HotKey: F11]"
          aria-label="Toggle UI Visibility"
        >
          {headerVisible ? <EyeOff size={12} /> : <Eye size={12} />}
          <span>{headerVisible ? 'HIDE UI' : 'SHOW UI'}</span>
        </button>

        {/* Toggle Top Bar Visibility */}
        <button
          className="topbar-action-btn topbar-collapse-btn"
          onClick={() => {
            cyberAudio.playClick();
            toggleHeader();
          }}
          title="Hide Operational Status Top Bar"
          aria-label="Hide Top Bar"
        >
          <ChevronUp size={12} />
          <span>HIDE BAR</span>
        </button>

        {/* Performance Governor Profile Switcher */}
        <button
          className="topbar-action-btn perf-toggle-btn"
          onClick={onCyclePerfMode}
          title={`Performance Profile: ${perfMode} (Click to cycle FULL -> REDUCED -> LOW)`}
          aria-label={`Performance Profile: ${perfMode}`}
        >
          <Zap
            size={12}
            color={perfMode === 'FULL' ? '#3dffb0' : perfMode === 'REDUCED' ? '#00f0ff' : '#ffb700'}
          />
          <span
            style={{
              color: perfMode === 'FULL' ? '#3dffb0' : perfMode === 'REDUCED' ? '#00f0ff' : '#ffb700',
              fontWeight: 700,
            }}
          >
            {perfMode}
          </span>
        </button>

        {/* External Seam Sync Status */}
        <div className="topbar-conn-badge" title={`Offline/Cloud Integration: ${connMode}`}>
          {connMode === 'CONNECTED' ? (
            <Wifi size={11} color="#00f0ff" />
          ) : (
            <WifiOff size={11} color="#34d399" />
          )}
          <span style={{ color: connMode === 'CONNECTED' ? '#00f0ff' : '#34d399' }}>
            {connMode}
          </span>
        </div>
      </div>

      {/* Center Bottom Dropdown / Collapse Arrow Tab */}
      <button
        className="topbar-edge-toggle"
        onClick={() => {
          cyberAudio.playClick();
          toggleHeader();
        }}
        title="Hide Operational Status Top Bar"
        aria-label="Hide Top Bar"
      >
        <ChevronUp size={11} className="topbar-edge-icon" />
      </button>
    </header>
  );
}

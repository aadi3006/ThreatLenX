/**
 * IncidentUniverse.tsx
 *
 * The flagship Stage 2 spatial experience.
 *
 * Architecture:
 * - Consumes SecurityService data via useSecuritySpatial() hook (React state, throttled)
 * - Maps incidents → spatial positions (deterministic, computed once on load)
 * - Each IncidentNode registers itself with spatialController for hit-testing
 * - Point + dwell → spatialTransform.setFocusedPanel() → focusedPanelId → IncidentFocusPanel
 * - No RAF or camera frame work happens inside this component tree
 * - All pan/zoom/cursor state is managed by spatial-transform.ts (direct DOM writes)
 *
 * Stage navigation contract:
 * COMMAND → Universe (all incidents visible)
 * Point + Dwell → Focused Incident (IncidentFocusPanel expands)
 * Fist / EXIT → back to Universe
 */

'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useSecuritySpatial } from '../state/use-security-spatial';
import IncidentNode from './IncidentNode';
import IncidentFocusPanel from './IncidentFocusPanel';
import CreateIncidentModal from './CreateIncidentModal';
import CommandCenter from '../command/CommandCenter';
import { performanceManager, type PerformanceMode } from '../performance-mode';
import { cyberAudio } from '../../cyber-audio';
import { spatialTransform, type SpatialMode } from '../../spatial-transform';

interface IncidentUniverseProps {
  mode: SpatialMode;
  focusedPanelId: string | null;
  pointedPanelId: string | null;
  onRegisterPanel: (id: string, el: HTMLElement | null) => void;
  onSelectPanel: (id: string) => void;
  onExitFocus: () => void;
  onClose?: () => void;
  renderFlanks?: boolean;
}

export default function IncidentUniverse({
  mode,
  focusedPanelId,
  pointedPanelId,
  onRegisterPanel,
  onSelectPanel,
  onExitFocus,
  onClose,
  renderFlanks = false,
}: IncidentUniverseProps) {
  const {
    isReady,
    spatialIncidents,
    incidents,
    assets,
    users,
    iocs,
    responseActions,
    auditLogs,
    snapshot,
    criticalCount,
    aggregateRisk,
  } = useSecuritySpatial();

  const [perfMode, setPerfMode] = useState<PerformanceMode>(() => performanceManager.getMode());
  useEffect(() => {
    return performanceManager.subscribe((m) => setPerfMode(m));
  }, []);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Determine which incident is focused (panel ID = incidentId for universe nodes)
  const focusedIncidentId = useMemo(() => {
    if (!focusedPanelId) return null;
    // Accept both bare incidentId and 'focus-<incidentId>'
    if (focusedPanelId.startsWith('focus-')) return focusedPanelId.replace('focus-', '');
    const hit = spatialIncidents.find((s) => s.incidentId === focusedPanelId);
    return hit ? hit.incidentId : null;
  }, [focusedPanelId, spatialIncidents]);

  const handleRegister = useCallback(
    (id: string, el: HTMLElement | null) => onRegisterPanel(id, el),
    [onRegisterPanel]
  );

  const handleSelect = useCallback(
    (id: string) => onSelectPanel(id),
    [onSelectPanel]
  );

  const handleSelectAsset = useCallback((assetId: string) => {
    // Connect asset directly into incident investigation
    const matching = incidents.find((i) => i.affectedAssets?.includes(assetId));
    if (matching) {
      handleSelect(matching.id);
    }
  }, [incidents, handleSelect]);

  // Loading state
  if (!isReady) {
    return (
      <div className="inc-universe inc-universe-loading" aria-live="polite">
        <div className="inc-universe-boot">
          <div className="inc-universe-boot-ring" />
          <span className="inc-universe-boot-text">INITIALIZING INCIDENT UNIVERSE</span>
          <span className="inc-universe-boot-sub">Loading security domain from local store…</span>
        </div>
      </div>
    );
  }

  if (spatialIncidents.length === 0) {
    return (
      <div className="inc-universe inc-universe-empty">
        <span className="inc-universe-empty-text">NO INCIDENTS IN SECURITY DOMAIN</span>
      </div>
    );
  }

  const isFocused = !!focusedIncidentId;

  return (
    <div
      className={`inc-universe${isFocused ? ' has-focus' : ''} mode-${mode.toLowerCase()}`}
      aria-label="Incident Universe — spatial security environment"
    >
      {/* SOC Spatial Command Center Layer (Optional legacy flank overlay) */}
      {renderFlanks && (
        <CommandCenter
          snapshot={snapshot}
          incidents={incidents}
          assets={assets}
          iocs={iocs}
          responseActions={responseActions}
          isFocused={isFocused}
          perfMode={perfMode}
          onSelectIncident={handleSelect}
          onSelectAsset={handleSelectAsset}
          onCreateIncident={() => setIsCreateModalOpen(true)}
          onOpenThreatHunting={() => {
            cyberAudio.playModeSwitch();
            spatialTransform.setMode('HUNTING');
          }}
          onOpenCases={() => {
            cyberAudio.playModeSwitch();
            spatialTransform.setMode('CASES');
          }}
          onClose={onClose}
        onOpenEvidence={() => {
            cyberAudio.playModeSwitch();
            spatialTransform.setMode('EVIDENCE');
          }}
          onOpenMetrics={() => {
            cyberAudio.playModeSwitch();
            spatialTransform.setMode('METRICS');
          }}
        />
      )}

      {/* Spatial field — incident nodes positioned absolutely */}
      <div className="inc-universe-field" aria-label="Spatial incident field">
        {/* Grid reference lines */}
        <div className="inc-field-grid" aria-hidden="true" />

        {/* Incident nodes - only rendered in un-focused overview / COMMAND mode */}
        {(!isFocused || mode === 'COMMAND') &&
          spatialIncidents.map((spatial) => (
            <IncidentNode
              key={spatial.incidentId}
              spatial={spatial}
              isFocused={focusedIncidentId === spatial.incidentId}
              isPointed={pointedPanelId === spatial.incidentId}
              onRegister={handleRegister}
              onSelect={handleSelect}
            />
          ))}

        {/* Relationship lines between incidents (static, from seed data) */}
        {(!isFocused || mode === 'COMMAND') && (
          <svg
            className="inc-universe-links"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            aria-hidden="true"
          >
            {/* Draw a faint link from each non-flagship incident toward the flagship */}
            {spatialIncidents.length > 1 && (() => {
              const flagship = spatialIncidents[0];
              return spatialIncidents.slice(1).map((s) => (
                <line
                  key={`link-${s.incidentId}`}
                  x1={`${flagship.position.x}%`} y1={`${flagship.position.y}%`}
                  x2={`${s.position.x}%`}    y2={`${s.position.y}%`}
                  stroke="#3dffb008"
                  strokeWidth="1"
                  strokeDasharray="6 10"
                />
              ));
            })()}
          </svg>
        )}
      </div>

      {/* Focused incident panel — slides in when an incident is focused */}
      {focusedIncidentId && (() => {
        const focusedSpatial = spatialIncidents.find((s) => s.incidentId === focusedIncidentId);
        return (
          <div
            className="inc-focus-overlay"
            style={{
              '--focus-origin-x': `${focusedSpatial?.position.x ?? 50}%`,
              '--focus-origin-y': `${focusedSpatial?.position.y ?? 50}%`,
            } as React.CSSProperties}
          >
            <IncidentFocusPanel
              incidentId={focusedIncidentId}
              allAssets={assets}
              allUsers={users}
              allIocs={iocs}
              onRegister={handleRegister}
              onExitFocus={onExitFocus}
            />
          </div>
        );
      })()}

      {/* Return to Hub Button */}
      {onClose && (
        <button
          className="wings-toggle-btn hub-return-btn"
          onClick={() => {
            cyberAudio.playClick();
            onClose();
          }}
          title="Return to Spatial Command Hub [ESC]"
          style={{
            position: 'absolute',
            top: '20px',
            left: '24px',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            background: 'rgba(5, 12, 24, 0.85)',
            border: '1px solid rgba(0, 240, 255, 0.4)',
            borderRadius: '4px',
            color: '#00f0ff',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: 'monospace',
            letterSpacing: '1px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 0 15px rgba(0, 240, 255, 0.15)',
          }}
        >
          <ArrowLeft size={14} />
          <span>HUB [ESC]</span>
        </button>
      )}

      {/* Keyboard hint (only in COMMAND mode, no focus) */}
      {mode === 'COMMAND' && !isFocused && (
        <div className="inc-universe-hint" aria-hidden="true">
          Click an incident to focus &nbsp;·&nbsp; [1–{Math.min(8, spatialIncidents.length)}] keyboard focus &nbsp;·&nbsp; [ESC] return to Hub
        </div>
      )}

      {/* Offline Incident Creation Modal */}
      <CreateIncidentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onIncidentCreated={(newIncidentId) => {
          handleSelect(newIncidentId);
        }}
      />
    </div>
  );
}

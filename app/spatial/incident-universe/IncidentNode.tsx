/**
 * IncidentNode.tsx
 *
 * Renders a single spatial incident entity in the Incident Universe.
 *
 * Visual language:
 * - Severity ring colour (CRITICAL=red, HIGH=amber, MEDIUM=cyan, LOW=green)
 * - Risk-scaled orbit ring
 * - Pulsing heartbeat tied to riskScore
 * - Dwell arc from spatial-controller (data-dwelling, --dwell-progress CSS vars)
 * - Status badge
 * - Fleet flag for flagship incidents
 *
 * Performance:
 * - No RAF inside this component
 * - dwell arc is driven by CSS custom property written by spatial-controller
 * - Selection is communicated upward via onSelectPanel → spatialController → spatialTransform
 */

'use client';
import { useRef, useEffect } from 'react';
import type { SpatialIncident } from '../state/use-security-spatial';

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#ff2a2a',
  HIGH:     '#ffb700',
  MEDIUM:   '#00f0ff',
  LOW:      '#3dffb0',
  INFO:     '#7b8ab8',
};

const STATUS_LABEL: Record<string, string> = {
  NEW:          'NEW',
  TRIAGED:      'TRIAGE',
  INVESTIGATING:'INVEST',
  CONTAINING:   'CONTAI',
  RESOLVED:     'RESOLVD',
  CLOSED:       'CLOSED',
  FALSE_POSITIVE:'FALSE+',
};

interface IncidentNodeProps {
  spatial: SpatialIncident;
  isFocused: boolean;
  isPointed: boolean;
  onRegister: (id: string, el: HTMLElement | null) => void;
  onSelect: (id: string) => void;
}

export default function IncidentNode({
  spatial,
  isFocused,
  isPointed,
  onRegister,
  onSelect,
}: IncidentNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const color = SEV_COLOR[spatial.severity] ?? '#7b8ab8';
  const size = spatial.isFleet ? 120 : Math.max(72, 60 + spatial.riskScore * 0.3);
  const orbitSize = spatial.orbitRadius * 2;

  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    onRegister(spatial.incidentId, el);
    return () => onRegister(spatial.incidentId, null);
  }, [spatial.incidentId, onRegister]);

  const shortId = spatial.incidentId.replace('incident-', 'INC-').toUpperCase();
  const statusLabel = STATUS_LABEL[spatial.status] ?? spatial.status.slice(0, 6);
  const riskPct = Math.round(spatial.riskScore);
  const confPct = Math.round(spatial.confidence * 100);

  const posX = Number.isFinite(spatial.position?.x) ? spatial.position.x : 50;
  const posY = Number.isFinite(spatial.position?.y) ? spatial.position.y : 50;

  return (
    <div
      ref={nodeRef}
      className={`inc-node${isFocused ? ' focused' : ''}${isPointed ? ' pointed' : ''}${spatial.isFleet ? ' fleet' : ''}`}
      style={{
        left: `${posX}%`,
        top: `${posY}%`,
        '--sev-color': color,
        '--node-size': `${size}px`,
        '--orbit-size': `${orbitSize}px`,
        '--pulse-speed': `${spatial.pulseSpeed}s`,
        '--glow': `${spatial.glowIntensity}`,
      } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`Incident: ${spatial.title}. Severity: ${spatial.severity}. Risk: ${riskPct}. Status: ${spatial.status}. Dwell to focus.`}
      onClick={() => onSelect(spatial.incidentId)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(spatial.incidentId); }}}
    >
      {/* Orbit ring */}
      <div className="inc-orbit-ring" />

      {/* Dwell progress SVG arc */}
      <svg className="inc-dwell-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="inc-dwell-track" cx="50" cy="50" r="44" />
        <circle className="inc-dwell-arc"   cx="50" cy="50" r="44" />
      </svg>

      {/* Core entity body */}
      <div className="inc-core">
        {/* Pulse rings */}
        <div className="inc-pulse-ring r1" />
        <div className="inc-pulse-ring r2" />

        {/* Severity icon hex */}
        <div className="inc-hex">
          <svg viewBox="0 0 40 46" fill="none" aria-hidden="true">
            <polygon
              points="20,2 38,12 38,34 20,44 2,34 2,12"
              stroke={color}
              strokeWidth="2"
              fill={`${color}18`}
            />
            {spatial.severity === 'CRITICAL' && (
              <text x="20" y="28" textAnchor="middle" fontSize="16" fill={color} fontFamily="monospace">!</text>
            )}
            {spatial.severity === 'HIGH' && (
              <text x="20" y="28" textAnchor="middle" fontSize="14" fill={color} fontFamily="monospace">▲</text>
            )}
            {spatial.severity === 'MEDIUM' && (
              <text x="20" y="28" textAnchor="middle" fontSize="14" fill={color} fontFamily="monospace">◆</text>
            )}
            {(spatial.severity === 'LOW' || spatial.severity === 'INFO') && (
              <text x="20" y="28" textAnchor="middle" fontSize="14" fill={color} fontFamily="monospace">●</text>
            )}
          </svg>
        </div>

        {/* Risk score */}
        <div className="inc-risk-score" style={{ color }}>
          {riskPct}
          <span className="inc-risk-unit">R</span>
        </div>
      </div>

      {/* Label strip */}
      <div className="inc-label-strip">
        <span className="inc-label-id">{shortId}</span>
        <span className="inc-label-title">{spatial.title.slice(0, 28)}{spatial.title.length > 28 ? '…' : ''}</span>
        <span className="inc-label-status" style={{ color }}>
          {statusLabel} · {confPct}%
        </span>
      </div>

      {/* Entity counts strip (only when pointed or focused) */}
      {(isPointed || isFocused) && (
        <div className="inc-entity-strip">
          <span title="Affected assets">🖥 {spatial.affectedAssetCount}</span>
          <span title="Affected users">👤 {spatial.affectedUserCount}</span>
          <span title="IOCs">⚠ {spatial.iocCount}</span>
          <span title="MITRE techniques">T {spatial.mitreTechniqueCount}</span>
        </div>
      )}

      {/* Fleet badge for flagship */}
      {spatial.isFleet && (
        <div className="inc-fleet-badge">FLAGSHIP</div>
      )}
    </div>
  );
}

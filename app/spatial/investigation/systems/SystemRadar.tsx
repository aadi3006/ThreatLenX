/**
 * SystemRadar.tsx
 *
 * SVG polar radar chart showing blast radius around the focused incident.
 * Derives data from InvestigationContext.data.systemRadar (SystemRadarData).
 *
 * Visual encoding:
 *   distance from center = hop count / proximity to incident
 *   angle = pre-computed from seed-data.ts
 *   color = blast radius level (DIRECT/POTENTIAL/AT_RISK/SAFE)
 *   size = asset criticality
 *
 * Sync:
 *   Clicking an asset node → setSelectedEntity({ id: assetId, type: 'ASSET' })
 *   selectedEntity of type ASSET → highlight matching node
 */

'use client';
import { useCallback } from 'react';
import { useInvestigation } from '../InvestigationContext';
import type { SystemRadarNode } from '../../../core/models/spatial-structures';
import type { AssetCriticality } from '../../../core/models/entity';

const BLAST_COLOR: Record<string, string> = {
  DIRECT:    '#ff2a2a',
  POTENTIAL: '#ffb700',
  AT_RISK:   '#00f0ff',
  SAFE:      '#3dffb0',
};

const CRIT_SIZE: Record<AssetCriticality, number> = {
  CRITICAL: 12,
  HIGH:     10,
  MEDIUM:   8,
  LOW:      6,
};

const STATUS_FILL: Record<string, string> = {
  COMPROMISED: '#ff2a2a',
  SUSPICIOUS:  '#ffb700',
  ISOLATED:    '#a78bfa',
  HEALTHY:     '#3dffb080',
  OFFLINE:     '#7b8ab840',
};

const W = 500;
const H = 500;
const CX = W / 2;
const CY = H / 2;
const MAX_R = 200;

// Polar → Cartesian
function polar(distance: number, angle: number): { x: number; y: number } {
  const r = distance * MAX_R;
  return {
    x: CX + r * Math.cos(angle),
    y: CY + r * Math.sin(angle),
  };
}

function AssetNode({
  node,
  isSelected,
  isReplayActive,
  onClick,
}: {
  node: SystemRadarNode;
  isSelected: boolean;
  isReplayActive: boolean;
  onClick: () => void;
}) {
  const { asset } = node;
  const pos   = polar(node.distance, node.angle);
  const color = BLAST_COLOR[node.blastRadiusLevel] ?? '#7b8ab8';
  const size  = CRIT_SIZE[asset.criticality] ?? 8;
  const fill  = STATUS_FILL[asset.status]    ?? '#7b8ab840';

  const isHighlighted = isSelected || isReplayActive;

  return (
    <g
      className={`radar-node${isHighlighted ? ' selected' : ''}`}
      transform={`translate(${pos.x}, ${pos.y})`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Asset: ${asset.name}. Status: ${asset.status}. Blast level: ${node.blastRadiusLevel}.`}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    >
      {/* Glow ring on highlight */}
      {isHighlighted && (
        <circle r={size * 2.5} fill={color} opacity="0.2" />
      )}

      {/* Synchronized Radar Blip Ping */}
      <circle
        className={`radar-blip-ping${isHighlighted ? ' blip-active' : ''}`}
        r={size}
        stroke={color}
        strokeWidth={isHighlighted ? 2 : 1.2}
        fill="none"
        style={{
          animationDelay: `${(Math.abs(node.angle) / (2 * Math.PI)) * 4}s`,
        }}
      />

      {/* Connection line to center */}
      <line x1={0} y1={0} x2={-pos.x + CX} y2={-pos.y + CY}
        stroke={color} strokeWidth={isHighlighted ? 1.5 : 0.5}
        opacity={isHighlighted ? 0.4 : 0.15}
        strokeDasharray="3 6"
        style={{ pointerEvents: 'none' }}
      />

      {/* Asset circle */}
      <circle
        r={size}
        fill={fill}
        stroke={color}
        strokeWidth={isHighlighted ? 2.2 : 1}
        filter={isHighlighted ? 'url(#radar-glow)' : undefined}
      />

      {/* Asset name label */}
      <text
        y={-size - 5}
        textAnchor="middle"
        fontSize="8"
        fill={isHighlighted ? color : 'rgba(180,200,230,0.75)'}
        fontFamily="'Chakra Petch', monospace"
        fontWeight={isHighlighted ? '700' : '400'}
      >
        {asset.name}
      </text>

      {/* Status badge */}
      <text
        y={size + 12}
        textAnchor="middle"
        fontSize="6.5"
        fill={color}
        fontFamily="'Chakra Petch', monospace"
        opacity="0.8"
      >
        {asset.status}
      </text>

      {/* Hop count */}
      {node.hopCount > 0 && (
        <text
          y={size + 22}
          textAnchor="middle"
          fontSize="6"
          fill="rgba(100,120,160,0.7)"
          fontFamily="monospace"
        >
          {node.hopCount} hop{node.hopCount !== 1 ? 's' : ''}
        </text>
      )}
    </g>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SystemRadar() {
  const { data, selectedEntity, setSelectedEntity, replay } = useInvestigation();
  const radar = data?.systemRadar;
  const incident = data?.incident;

  const handleAssetClick = useCallback((assetId: string) => {
    setSelectedEntity(
      selectedEntity?.id === assetId
        ? null
        : { id: assetId, type: 'ASSET' }
    );
  }, [selectedEntity, setSelectedEntity]);

  if (!radar || radar.assets.length === 0) {
    return (
      <div className="radar-empty">
        <span>No system radar data available for this incident.</span>
      </div>
    );
  }

  return (
    <div className="radar-container" aria-label="System radar blast radius">
      {/* Stats bar */}
      <div className="radar-stats">
        <div className="radar-stat">
          <span className="radar-stat-label">AT RISK</span>
          <span className="radar-stat-value" style={{ color: '#ffb700' }}>{radar.totalAssetsAtRisk}</span>
        </div>
        <div className="radar-stat">
          <span className="radar-stat-label">COMPROMISED</span>
          <span className="radar-stat-value" style={{ color: '#ff2a2a' }}>{radar.compromisedCount}</span>
        </div>
        <div className="radar-stat">
          <span className="radar-stat-label">ISOLATED</span>
          <span className="radar-stat-value" style={{ color: '#a78bfa' }}>{radar.isolatedCount}</span>
        </div>
      </div>

      <svg
        className="radar-svg"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id="radar-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="radar-center" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#ff2a2a" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#ff2a2a" stopOpacity="0"    />
          </radialGradient>
          <linearGradient id="radar-sweep-trail" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#3dffb0" stopOpacity="0.28" />
            <stop offset="60%"  stopColor="#3dffb0" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#3dffb0" stopOpacity="0"    />
          </linearGradient>
        </defs>

        {/* Rotating Sweep Arm & Phosphor Trail (Stage 6) */}
        <g className="radar-sweep-arm" style={{ transformOrigin: `${CX}px ${CY}px` }}>
          <path
            d={`M ${CX} ${CY} L ${CX} ${CY - MAX_R} A ${MAX_R} ${MAX_R} 0 0 0 ${CX - MAX_R * Math.sin(38 * Math.PI / 180)} ${CY - MAX_R * Math.cos(38 * Math.PI / 180)} Z`}
            fill="url(#radar-sweep-trail)"
            pointerEvents="none"
          />
          <line
            x1={CX} y1={CY}
            x2={CX} y2={CY - MAX_R}
            stroke="#3dffb0"
            strokeWidth="1.6"
            strokeLinecap="round"
            filter="url(#radar-glow)"
            pointerEvents="none"
          />
        </g>

        {/* Radar rings */}
        {[0.25, 0.5, 0.75, 1.0].map((r) => (
          <circle
            key={r}
            className="radar-ring"
            cx={CX} cy={CY}
            r={r * MAX_R}
            fill="none"
            stroke="rgba(61,255,176,0.08)"
            strokeWidth="1"
            strokeDasharray="4 8"
          />
        ))}

        {/* Cross-hairs */}
        <line x1={CX} y1={CY - MAX_R} x2={CX} y2={CY + MAX_R}
          stroke="rgba(61,255,176,0.06)" strokeWidth="1" />
        <line x1={CX - MAX_R} y1={CY} x2={CX + MAX_R} y2={CY}
          stroke="rgba(61,255,176,0.06)" strokeWidth="1" />

        {/* Center incident node */}
        <circle cx={CX} cy={CY} r={28} fill="url(#radar-center)" />
        <circle cx={CX} cy={CY} r={18} fill="#ff2a2a18" stroke="#ff2a2a" strokeWidth="1.5" />
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize="7" fill="#ff2a2a"
          fontFamily="'Chakra Petch', monospace" fontWeight="700">
          {incident?.id.toUpperCase().replace('INCIDENT-', 'INC-') ?? 'INCIDENT'}
        </text>
        <text x={CX} y={CY + 7} textAnchor="middle" fontSize="6" fill="#ff8888"
          fontFamily="'Chakra Petch', monospace">
          FOCAL
        </text>

        {/* Ring labels */}
        {['DIRECT', 'POTENTIAL', 'AT RISK', 'PERIMETER'].map((label, i) => (
          <text key={label}
            x={CX + (i + 1) * 0.25 * MAX_R + 4}
            y={CY - 4}
            fontSize="6"
            fill="rgba(100,120,160,0.5)"
            fontFamily="monospace"
          >
            {label}
          </text>
        ))}

        {/* Asset nodes */}
        {radar.assets.map((node) => {
          const isSelected    = selectedEntity?.id === node.asset.id;
          const isReplayActive =
            replay.status === 'PLAYING' &&
            data?.attackGraph.nodes.find(
              (n) => n.id === replay.currentNodeId && n.label === node.asset.name
            ) != null;

          return (
            <AssetNode
              key={node.asset.id}
              node={node}
              isSelected={isSelected}
              isReplayActive={isReplayActive}
              onClick={() => handleAssetClick(node.asset.id)}
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="radar-legend">
        {Object.entries(BLAST_COLOR).map(([level, color]) => (
          <span key={level} style={{ color }}>● {level}</span>
        ))}
      </div>
    </div>
  );
}

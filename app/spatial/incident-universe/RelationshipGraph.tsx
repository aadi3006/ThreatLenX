/**
 * RelationshipGraph.tsx
 *
 * Renders SVG relationship lines from a focused incident to its connected entities.
 * Layout: incident at center, entities arranged radially.
 *
 * Design principle: RELATIONSHIPS FIRST.
 * The graph communicates the security investigation context,
 * not just metadata about the incident.
 *
 * No animations driven by RAF — CSS transitions handle the reveal.
 */

'use client';
import type { Incident } from '../../core/models/incident';
import type { Asset } from '../../core/models/entity';
import type { SecurityUser } from '../../core/models/entity';
import type { IOC } from '../../core/models/entity';

interface EntityNode {
  id: string;
  label: string;
  sublabel: string;
  type: 'ASSET' | 'USER' | 'IOC' | 'TECHNIQUE';
  color: string;
  angle: number;   // radians
  radius: number;  // px from center
}

const TYPE_COLOR: Record<EntityNode['type'], string> = {
  ASSET:     '#00f0ff',
  USER:      '#ffb700',
  IOC:       '#ff2a2a',
  TECHNIQUE: '#a78bfa',
};

interface RelationshipGraphProps {
  incident: Incident;
  assets: Asset[];
  users: SecurityUser[];
  iocs: IOC[];
}

const W = 560;
const H = 400;
const CX = W / 2;
const CY = H / 2;

function polarToCartesian(angle: number, radius: number): { x: number; y: number } {
  return {
    x: CX + radius * Math.cos(angle),
    y: CY + radius * Math.sin(angle),
  };
}

export default function RelationshipGraph({ incident, assets, users, iocs }: RelationshipGraphProps) {
  const nodes: EntityNode[] = [];

  // Build entity nodes
  const affectedAssets = assets.filter((a) => incident.affectedAssets.includes(a.id));
  const affectedUsers  = users.filter((u) => incident.affectedUsers.includes(u.id));
  const relatedIocs    = iocs.filter((ioc) => incident.iocs.includes(ioc.id));
  const techniques     = incident.mitreTechniques.slice(0, 4); // show top 4

  const totalNodes = affectedAssets.length + affectedUsers.length + relatedIocs.length + techniques.length;
  const angleStep = totalNodes > 0 ? (2 * Math.PI) / Math.max(totalNodes, 1) : 0;
  let angleIdx = 0;

  // Assets — left-center quadrant
  affectedAssets.forEach((a) => {
    nodes.push({
      id: a.id,
      label: a.name,
      sublabel: `${a.type} · ${a.status}`,
      type: 'ASSET',
      color: TYPE_COLOR.ASSET,
      angle: -Math.PI / 2 + angleIdx * angleStep,
      radius: 140,
    });
    angleIdx++;
  });

  // Users — right-center quadrant
  affectedUsers.forEach((u) => {
    nodes.push({
      id: u.id,
      label: u.displayName,
      sublabel: `${u.status} · Risk ${u.riskScore}`,
      type: 'USER',
      color: TYPE_COLOR.USER,
      angle: -Math.PI / 2 + angleIdx * angleStep,
      radius: 155,
    });
    angleIdx++;
  });

  // IOCs — bottom
  relatedIocs.forEach((ioc) => {
    nodes.push({
      id: ioc.id,
      label: ioc.value.length > 22 ? ioc.value.slice(0, 20) + '…' : ioc.value,
      sublabel: ioc.type,
      type: 'IOC',
      color: TYPE_COLOR.IOC,
      angle: -Math.PI / 2 + angleIdx * angleStep,
      radius: 150,
    });
    angleIdx++;
  });

  // MITRE techniques — top
  techniques.forEach((tid) => {
    nodes.push({
      id: tid,
      label: tid,
      sublabel: 'MITRE ATT&CK',
      type: 'TECHNIQUE',
      color: TYPE_COLOR.TECHNIQUE,
      angle: -Math.PI / 2 + angleIdx * angleStep,
      radius: 145,
    });
    angleIdx++;
  });

  return (
    <div className="rel-graph-container" aria-label="Incident relationship graph">
      <svg
        className="rel-graph-svg"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id="rel-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="center-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#ff2a2a" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#ff2a2a" stopOpacity="0"   />
          </radialGradient>
        </defs>

        {/* Center glow */}
        <circle cx={CX} cy={CY} r="60" fill="url(#center-grad)" />

        {/* Relationship lines */}
        {nodes.map((node) => {
          const pos = polarToCartesian(node.angle, node.radius);
          return (
            <line
              key={`line-${node.id}`}
              x1={CX} y1={CY}
              x2={pos.x} y2={pos.y}
              stroke={node.color}
              strokeWidth="1"
              strokeOpacity="0.35"
              strokeDasharray="4 6"
              className="rel-line"
            />
          );
        })}

        {/* Center node (incident) */}
        <circle cx={CX} cy={CY} r="30" stroke="#ff2a2a" strokeWidth="1.5" fill="#ff2a2a18" filter="url(#rel-glow)" />
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize="9" fill="#ff2a2a" fontFamily="'Chakra Petch', monospace" fontWeight="600">
          {incident.id.toUpperCase().replace('INCIDENT-', 'INC-')}
        </text>
        <text x={CX} y={CY + 8} textAnchor="middle" fontSize="7" fill="#ff8888" fontFamily="'Chakra Petch', monospace">
          ● {incident.severity}
        </text>

        {/* Entity nodes */}
        {nodes.map((node) => {
          const pos = polarToCartesian(node.angle, node.radius);
          const labelLines = node.label.length > 16
            ? [node.label.slice(0, 16), node.label.slice(16, 30)]
            : [node.label];

          return (
            <g key={node.id} className={`rel-node rel-node-${node.type.toLowerCase()}`}>
              {/* Node dot */}
              <circle
                cx={pos.x} cy={pos.y}
                r="8"
                stroke={node.color}
                strokeWidth="1.5"
                fill={`${node.color}20`}
              />
              {/* Label */}
              <text
                x={pos.x}
                y={pos.y + (pos.y > CY ? 22 : -14)}
                textAnchor="middle"
                fontSize="8"
                fill={node.color}
                fontFamily="'Chakra Petch', monospace"
                fontWeight="600"
              >
                {labelLines[0]}
              </text>
              {labelLines[1] && (
                <text
                  x={pos.x}
                  y={pos.y + (pos.y > CY ? 32 : -4)}
                  textAnchor="middle"
                  fontSize="7"
                  fill={node.color}
                  fontFamily="'Chakra Petch', monospace"
                  opacity="0.7"
                >
                  {labelLines[1]}
                </text>
              )}
              {/* Type label */}
              <text
                x={pos.x}
                y={pos.y + (pos.y > CY ? 42 : 5)}
                textAnchor="middle"
                fontSize="6.5"
                fill={node.color}
                fontFamily="'Chakra Petch', monospace"
                opacity="0.55"
              >
                {node.sublabel.slice(0, 18)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="rel-legend" aria-label="Legend">
        {Object.entries(TYPE_COLOR).map(([type, color]) => (
          <span key={type} className="rel-legend-item" style={{ color }}>
            ● {type}
          </span>
        ))}
      </div>
    </div>
  );
}

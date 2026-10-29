/**
 * IOCConstellation.tsx
 *
 * SVG IOC relationship constellation.
 * IOC nodes at center-out, links connect to related assets/users/incident.
 * Derives from InvestigationContext.data.iocGraph (IocGraphData).
 *
 * Sync:
 *   Clicking IOC → setSelectedEntity({ id: ioc.id, type: 'IOC' })
 *   selectedEntity of type IOC or ASSET → highlights related nodes/links
 */

'use client';
import { useCallback, useMemo, useState } from 'react';
import { useInvestigation } from '../InvestigationContext';
import type { IOC } from '../../../core/models/entity';
import type { IocGraphLink } from '../../../core/models/spatial-structures';
import { ThreatIntelProfile } from '../../intel/ThreatIntelProfile';

const IOC_TYPE_COLOR: Record<string, string> = {
  HASH_SHA256:  '#ff2a2a',
  HASH_MD5:     '#ff6b35',
  IP:           '#00f0ff',
  DOMAIN:       '#ffb700',
  URL:          '#a78bfa',
  FILE_PATH:    '#3dffb0',
  MUTEX:        '#7b8ab8',
  REGISTRY_KEY: '#7b8ab8',
};

const W = 560;
const H = 420;
const CX = W / 2;
const CY = H / 2;

interface PlacedIOC {
  ioc: IOC;
  x: number;
  y: number;
  index: number;
}

interface PlacedEntity {
  id: string;
  label: string;
  type: 'ASSET' | 'USER' | 'INCIDENT';
  x: number;
  y: number;
  color: string;
  index: number;
}

function placeIOCs(iocs: IOC[]): PlacedIOC[] {
  return iocs.map((ioc, i) => {
    const angle = (i / Math.max(iocs.length, 1)) * 2 * Math.PI - Math.PI / 2;
    return {
      ioc,
      x: CX + 120 * Math.cos(angle),
      y: CY + 90  * Math.sin(angle),
      index: i,
    };
  });
}

function placeEntities(
  links: IocGraphLink[],
  assets: { id: string; name: string }[],
  users:  { id: string; displayName: string }[],
  incidentId: string,
): PlacedEntity[] {
  const seen = new Set<string>();
  const entities: PlacedEntity[] = [];

  links.forEach((link) => {
    if (seen.has(link.targetEntityId)) return;
    seen.add(link.targetEntityId);

    let label = link.targetEntityId;
    let color = '#7b8ab8';

    if (link.targetType === 'ASSET') {
      const a = assets.find((a) => a.id === link.targetEntityId);
      label = a?.name ?? link.targetEntityId;
      color = '#00f0ff';
    } else if (link.targetType === 'USER') {
      const u = users.find((u) => u.id === link.targetEntityId);
      label = u?.displayName ?? link.targetEntityId;
      color = '#ffb700';
    } else if (link.targetType === 'INCIDENT') {
      label = incidentId.toUpperCase().replace('INCIDENT-', 'INC-');
      color = '#ff2a2a';
    }

    // Place entities in an outer ring
    const totalUnique = [...new Set(links.map((l) => l.targetEntityId))].length;
    const idx = [...seen].indexOf(link.targetEntityId);
    const angle = (idx / Math.max(totalUnique, 1)) * 2 * Math.PI - Math.PI / 2;
    const r = 190;

    entities.push({
      id: link.targetEntityId,
      label,
      type: link.targetType,
      x: CX + r * Math.cos(angle),
      y: CY + r * Math.sin(angle) * 0.75,
      color,
      index: idx,
    });
  });

  return entities;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function IOCConstellation() {
  const { data, selectedEntity, setSelectedEntity, replay, choreography } = useInvestigation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedIntelIocId, setSelectedIntelIocId] = useState<string | null>(null);

  const iocGraph  = data?.iocGraph;
  const allAssets = data?.allAssets ?? [];
  const allUsers  = data?.allUsers  ?? [];

  const placedIOCs = useMemo(
    () => placeIOCs(iocGraph?.iocs ?? []),
    [iocGraph]
  );

  const placedEntities = useMemo(
    () => placeEntities(
      iocGraph?.links ?? [],
      allAssets,
      allUsers,
      data?.incidentId ?? '',
    ),
    [iocGraph, allAssets, allUsers, data]
  );

  const links = iocGraph?.links ?? [];

  // Active entity for relationship highlighting (selection takes precedence over hover)
  const activeEntityId = selectedEntity?.id || hoveredId;

  const { relatedIocIds, relatedEntityIds, activeLinkIndices } = useMemo(() => {
    if (!activeEntityId) {
      return {
        relatedIocIds: new Set<string>(),
        relatedEntityIds: new Set<string>(),
        activeLinkIndices: new Set<number>(),
      };
    }
    const rIoc = new Set<string>();
    const rEnt = new Set<string>();
    const aLinks = new Set<number>();

    // Check if activeEntityId is an IOC
    const isActiveIoc = placedIOCs.some((p) => p.ioc.id === activeEntityId);
    if (isActiveIoc) {
      rIoc.add(activeEntityId);
    } else {
      rEnt.add(activeEntityId);
    }

    links.forEach((link, idx) => {
      if (link.sourceIocId === activeEntityId) {
        rIoc.add(link.sourceIocId);
        rEnt.add(link.targetEntityId);
        aLinks.add(idx);
      } else if (link.targetEntityId === activeEntityId) {
        rIoc.add(link.sourceIocId);
        rEnt.add(link.targetEntityId);
        aLinks.add(idx);
      }
    });

    return { relatedIocIds: rIoc, relatedEntityIds: rEnt, activeLinkIndices: aLinks };
  }, [activeEntityId, placedIOCs, links]);

  const handleIOCClick = useCallback((iocId: string) => {
    setSelectedEntity(
      selectedEntity?.id === iocId
        ? null
        : { id: iocId, type: 'IOC' }
    );
  }, [selectedEntity, setSelectedEntity]);

  const handleEntityClick = useCallback((entityId: string, type: 'ASSET' | 'USER' | 'INCIDENT') => {
    const selType = type === 'ASSET' ? 'ASSET' : type === 'USER' ? 'USER' : 'INCIDENT';
    setSelectedEntity(
      selectedEntity?.id === entityId
        ? null
        : { id: entityId, type: selType }
    );
  }, [selectedEntity, setSelectedEntity]);

  if (!iocGraph || iocGraph.iocs.length === 0) {
    return (
      <div className="ioc-empty">
        <span>No IOC constellation data available for this incident.</span>
      </div>
    );
  }

  const hasActiveFocus = Boolean(activeEntityId);

  return (
    <div className="ioc-container" aria-label="IOC constellation visualization">
      <svg
        className="ioc-svg"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id="ioc-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="shield-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3dffb0" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#00f0ff" stopOpacity="0.8" />
          </linearGradient>
        </defs>

        {/* Relationship links */}
        {links.map((link, i) => {
          const fromIOC = placedIOCs.find((p) => p.ioc.id === link.sourceIocId);
          const toEnt   = placedEntities.find((e) => e.id === link.targetEntityId);
          if (!fromIOC || !toEnt) return null;

          const isDirectlyActive = activeLinkIndices.has(i);
          const isDimmed = hasActiveFocus && !isDirectlyActive;
          const iocColor = IOC_TYPE_COLOR[fromIOC.ioc.type] ?? '#7b8ab8';

          return (
            <line
              key={`link-${i}`}
              className={`ioc-link drawing${isDirectlyActive ? ' highlighted' : ''}${isDimmed ? ' dimmed' : ''}`}
              x1={fromIOC.x} y1={fromIOC.y}
              x2={toEnt.x}   y2={toEnt.y}
              stroke={isDirectlyActive ? '#00f0ff' : iocColor}
              strokeWidth={isDirectlyActive ? 2 : 0.8}
              strokeOpacity={isDirectlyActive ? 0.85 : 0.25}
              strokeDasharray={isDirectlyActive ? undefined : '4 6'}
              style={{
                animationDelay: `${(i % 12) * 55}ms`,
              }}
            />
          );
        })}

        {/* Entity nodes (outer ring) */}
        {placedEntities.map((ent) => {
          const isSelected = selectedEntity?.id === ent.id;
          const isRelated = relatedEntityIds.has(ent.id);
          const isDimmed = hasActiveFocus && !isRelated;

          return (
            <g
              key={ent.id}
              className={`ioc-entity${isSelected ? ' selected' : ''}${isRelated ? ' highlighted' : ''}${isDimmed ? ' dimmed' : ''}`}
              transform={`translate(${ent.x}, ${ent.y})`}
              onClick={() => handleEntityClick(ent.id, ent.type)}
              onMouseEnter={() => setHoveredId(ent.id)}
              onMouseLeave={() => setHoveredId(null)}
              role="button"
              tabIndex={0}
              aria-label={`${ent.type}: ${ent.label}`}
              onKeyDown={(e) => { if (e.key === 'Enter') handleEntityClick(ent.id, ent.type); }}
            >
              <g
                className="ioc-entity-content ioc-entity-enter"
                style={{
                  animationDelay: `${ent.index * 60 + 100}ms`,
                }}
              >
                <circle
                  r={isSelected || isRelated ? 9 : 7}
                  fill={`${ent.color}20`}
                  stroke={ent.color}
                  strokeWidth={isSelected || isRelated ? 2 : 1}
                  filter={isSelected || isRelated ? 'url(#ioc-glow)' : undefined}
                />
                <text y={-12} textAnchor="middle" fontSize="8"
                  fill={isSelected || isRelated ? ent.color : 'rgba(180,200,230,0.7)'}
                  fontFamily="'Chakra Petch', monospace" fontWeight={isSelected || isRelated ? '700' : '400'}>
                  {ent.label.length > 14 ? ent.label.slice(0, 12) + '…' : ent.label}
                </text>
                <text y={16} textAnchor="middle" fontSize="6.5"
                  fill={ent.color} opacity="0.7" fontFamily="monospace">
                  {ent.type}
                </text>
              </g>
            </g>
          );
        })}

        {/* IOC nodes (inner ring) */}
        {placedIOCs.map(({ ioc, x, y, index }) => {
          const color = IOC_TYPE_COLOR[ioc.type] ?? '#7b8ab8';
          const isSelected    = selectedEntity?.id === ioc.id;
          const isRelated     = relatedIocIds.has(ioc.id);
          const isDimmed      = hasActiveFocus && !isRelated;
          const isBlocked     = ioc.isBlocked;

          const isReplayActive =
            replay.status === 'PLAYING' &&
            data?.attackGraph.nodes.find(
              (n) => n.id === replay.currentNodeId && n.type === 'IOC' &&
                (n.label === ioc.value.slice(0, 20) || n.label.includes('IOC'))
            ) != null;

          return (
            <g
              key={ioc.id}
              className={`ioc-node${isSelected ? ' selected' : ''}${isRelated ? ' highlighted' : ''}${isDimmed ? ' dimmed' : ''}${isReplayActive ? ' replay-active' : ''}${isBlocked ? ' is-blocked' : ''}`}
              transform={`translate(${x}, ${y})`}
              onClick={() => handleIOCClick(ioc.id)}
              onDoubleClick={() => setSelectedIntelIocId(ioc.id)}
              onMouseEnter={() => setHoveredId(ioc.id)}
              onMouseLeave={() => setHoveredId(null)}
              role="button"
              tabIndex={0}
              aria-label={`IOC: ${ioc.type} — ${ioc.value} ${isBlocked ? '(Blocked)' : '(Active)'}`}
              onKeyDown={(e) => { if (e.key === 'Enter') handleIOCClick(ioc.id); }}
            >
              <g
                className="ioc-node-content ioc-node-enter"
                style={{
                  animationDelay: `${index * 70}ms`,
                }}
              >
                {/* Diamond shape */}
                <polygon
                  className="ioc-diamond"
                  points={`0,-14 10,0 0,14 -10,0`}
                  fill={isBlocked ? 'rgba(61,255,176,0.1)' : `${color}15`}
                  stroke={isBlocked ? '#3dffb0' : color}
                  strokeWidth={isSelected || isRelated || isReplayActive ? 2 : 1}
                  filter={isSelected || isRelated || isReplayActive ? 'url(#ioc-glow)' : undefined}
                />

                {/* Blocked shield outline overlay */}
                {isBlocked && (
                  <path
                    d="M -5,-5 L 5,-5 L 4,2 L 0,6 L -4,2 Z"
                    fill="none"
                    stroke="#3dffb0"
                    strokeWidth="1.2"
                    opacity="0.9"
                  />
                )}

                <text y={-18} textAnchor="middle" fontSize="7.5"
                  fill={isSelected || isRelated ? color : 'rgba(200,215,240,0.8)'}
                  fontFamily="'Chakra Petch', monospace" fontWeight="600">
                  {ioc.type}
                </text>

                <text y={26} textAnchor="middle" fontSize="6.5"
                  fill={isBlocked ? '#3dffb0' : color} opacity="0.8" fontFamily="monospace">
                  {isBlocked ? '🛡 BLOCKED' : `Rep: ${ioc.reputationScore}`}
                </text>

                {(isSelected || isRelated) && (
                  <text y={38} textAnchor="middle" fontSize="6"
                    fill={isBlocked ? '#3dffb0' : color} fontFamily="monospace">
                    {ioc.value.slice(0, 24)}{ioc.value.length > 24 ? '…' : ''}
                  </text>
                )}
              </g>
            </g>
          );
        })}
      </svg>

      {/* IOC detail strip */}
      {selectedEntity?.type === 'IOC' && (() => {
        const ioc = iocGraph.iocs.find((i) => i.id === selectedEntity.id);
        if (!ioc) return null;
        const color = IOC_TYPE_COLOR[ioc.type] ?? '#7b8ab8';
        return (
          <div className="ioc-detail-strip" style={{ borderColor: ioc.isBlocked ? '#3dffb0' : color }}>
            <span className="ioc-det-type" style={{ color }}>{ioc.type}</span>
            <span className="ioc-det-value">{ioc.value}</span>
            <span className="ioc-det-meta">{ioc.threatType}</span>
            <span className="ioc-det-rep" style={{ color }}>Rep: {ioc.reputationScore}</span>
            <span className="ioc-det-conf">Conf: {Math.round(ioc.confidence * 100)}%</span>
            <span className={`ioc-det-blocked ${ioc.isBlocked ? 'blocked' : 'active'}`}>
              {ioc.isBlocked ? 'SHIELDED / BLOCKED' : 'ACTIVE THREAT'}
            </span>
            <button
              className="ioc-det-intel-btn"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIntelIocId(ioc.id);
              }}
              aria-label={`Open Intelligence Profile for ${ioc.value}`}
            >
              ⚡ INTEL PROFILE
            </button>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="ioc-legend">
        {Object.entries(IOC_TYPE_COLOR).map(([type, color]) => (
          <span key={type} style={{ color }}>● {type}</span>
        ))}
        <span style={{ color: '#3dffb0', marginLeft: 8 }}>🛡 BLOCKED IOC</span>
      </div>

      {/* Threat Intelligence Profile Modal */}
      {selectedIntelIocId && (
        <ThreatIntelProfile
          indicatorId={selectedIntelIocId}
          onClose={() => setSelectedIntelIocId(null)}
          onPivot={(entityId, entityType) => {
            if (entityType === 'ASSET' || entityType === 'USER' || entityType === 'INCIDENT') {
              setSelectedEntity({ id: entityId, type: entityType as any });
              setSelectedIntelIocId(null);
            } else if (entityType === 'IOC') {
              setSelectedIntelIocId(entityId);
            }
          }}
        />
      )}
    </div>
  );
}

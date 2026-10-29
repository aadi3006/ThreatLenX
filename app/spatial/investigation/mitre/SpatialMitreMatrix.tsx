/**
 * SpatialMitreMatrix.tsx
 *
 * MITRE ATT&CK technique grid for the focused incident.
 * Shows ONLY techniques present in the incident — not the full 200+ technique matrix.
 * Grouped by tactic for readability.
 *
 * Sync:
 * - Clicking a technique: setSelectedEntity → syncs AttackGraph/Timeline.
 * - selectedEntity of type TECHNIQUE highlights the matching card.
 */

'use client';
import { useCallback, useMemo } from 'react';
import { useInvestigation } from '../InvestigationContext';
import type { MitreTechniqueCoverage } from '../../../core/models/mitre';
import type { TimelineEvent } from '../../../core/models/incident';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE:     '#ff2a2a',
  DETECTED:   '#ffb700',
  MITIGATED:  '#3dffb0',
  UNOBSERVED: '#7b8ab8',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE:     'ACTIVE',
  DETECTED:   'DETECTED',
  MITIGATED:  'MITIGATED',
  UNOBSERVED: 'UNOBSERVED',
};

// ─── Technique card ───────────────────────────────────────────────────────────

function TechniqueCard({
  coverage,
  isSelected,
  isFiring,
  isActivated,
  isUnreached,
  linkedEvent,
  index,
  onClick,
  onFocusEntity,
}: {
  coverage: MitreTechniqueCoverage;
  isSelected: boolean;
  isFiring: boolean;
  isActivated: boolean;
  isUnreached: boolean;
  linkedEvent?: TimelineEvent;
  index: number;
  onClick: () => void;
  onFocusEntity: (entityId: string) => void;
}) {
  const { technique, status } = coverage;
  const color = STATUS_COLOR[status] ?? '#7b8ab8';

  const cardClasses = [
    'mitre-card',
    'mitre-card-enter',
    isSelected ? 'selected' : '',
    isFiring ? 'firing' : '',
    isActivated && !isFiring ? 'activated' : '',
    isUnreached ? 'unreached' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClasses}
      style={{
        '--mitre-color': color,
        animationDelay: `${index * 45}ms`,
      } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`MITRE technique: ${technique.id} ${technique.name}. Status: ${status}.`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    >
      <div className="mitre-card-header">
        <span className="mitre-id" style={{ color }}>{technique.id}</span>
        <span className="mitre-status" style={{ color }}>
          {isFiring ? '⚡ FIRING NOW' : (STATUS_LABEL[status] ?? status)}
        </span>
      </div>
      <div className="mitre-name">{technique.name}</div>
      {technique.subTechniqueOf && (
        <div className="mitre-parent">Sub of {technique.subTechniqueOf}</div>
      )}
      <div className="mitre-platforms">
        {technique.platforms.slice(0, 3).map((p) => (
          <span key={p} className="mitre-platform-tag">{p}</span>
        ))}
      </div>

      {/* Linked timeline event badge */}
      {linkedEvent && (
        <div
          className="mitre-link-badge"
          onClick={(e) => {
            e.stopPropagation();
            onFocusEntity(linkedEvent.entityId || linkedEvent.id);
          }}
          title="Jump to linked entity / event"
        >
          <span>🔗 {linkedEvent.stage.replace(/_/g, ' ')}</span>
          <span style={{ fontFamily: 'monospace', opacity: 0.8 }}>
            {new Date(linkedEvent.timestamp).toTimeString().slice(0, 8)}
          </span>
        </div>
      )}

      {(isSelected || isFiring) && (
        <div className="mitre-detail">
          <p className="mitre-desc">{technique.description}</p>
          <p className="mitre-detect-label">DETECTION:</p>
          <p className="mitre-detect">{technique.detection}</p>
          {coverage.firstObserved && (
            <p className="mitre-obs">First: {new Date(coverage.firstObserved).toUTCString().slice(5, 22)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SpatialMitreMatrix() {
  const { data, selectedEntity, setSelectedEntity, replay } = useInvestigation();
  const coverage: MitreTechniqueCoverage[] = data?.mitreCoverage ?? [];
  const timelineEvents = data?.incident.timelineEvents ?? [];

  // Group by tactic
  const byTactic = useMemo(() => {
    return coverage.reduce<Record<string, MitreTechniqueCoverage[]>>((acc, c) => {
      const key = c.technique.tacticName;
      if (!acc[key]) acc[key] = [];
      acc[key].push(c);
      return acc;
    }, {});
  }, [coverage]);

  // Replay activation mapping: which techniques have occurred up to current replay step?
  const { activatedTechniqueIds, firingTechniqueId } = useMemo(() => {
    if (replay.status === 'IDLE') {
      return { activatedTechniqueIds: new Set<string>(), firingTechniqueId: null };
    }

    const activated = new Set<string>();
    let firingId: string | null = null;

    // Up to replay.currentStep
    const currentStepEvents = timelineEvents.slice(0, Math.max(1, replay.currentStep + 1));
    currentStepEvents.forEach((ev) => {
      if (ev.techniqueId) activated.add(ev.techniqueId);
    });

    // Check if currentNode in attack graph is a technique or correlates with one
    if (replay.currentNodeId && data?.attackGraph) {
      const node = data.attackGraph.nodes.find((n) => n.id === replay.currentNodeId);
      if (node?.type === 'TECHNIQUE') {
        const matchingCoverage = coverage.find((c) => c.technique.name === node.label || c.technique.id === node.label);
        if (matchingCoverage) {
          firingId = matchingCoverage.technique.id;
          activated.add(firingId);
        }
      }
    }

    // Check current timeline event technique
    const currentEvent = timelineEvents[replay.currentStep];
    if (currentEvent?.techniqueId) {
      firingId = currentEvent.techniqueId;
      activated.add(firingId);
    }

    return { activatedTechniqueIds: activated, firingTechniqueId: firingId };
  }, [replay.status, replay.currentStep, replay.currentNodeId, timelineEvents, data, coverage]);

  const handleClick = useCallback((techniqueId: string) => {
    setSelectedEntity(
      selectedEntity?.id === techniqueId
        ? null
        : { id: techniqueId, type: 'TECHNIQUE' }
    );
  }, [selectedEntity, setSelectedEntity]);

  const handleFocusEntity = useCallback((entityId: string) => {
    setSelectedEntity({ id: entityId, type: 'ASSET' });
  }, [setSelectedEntity]);

  if (coverage.length === 0) {
    return (
      <div className="mitre-empty">
        <span>No MITRE techniques associated with this incident.</span>
      </div>
    );
  }

  const isReplaying = replay.status === 'PLAYING' || replay.status === 'PAUSED';

  let globalCardIdx = 0;

  return (
    <div className="mitre-container" aria-label="MITRE ATT&CK technique matrix">
      <div className="mitre-header-bar">
        <span className="mitre-title">MITRE ATT&amp;CK — Incident Techniques</span>
        <div className="mitre-legend">
          {Object.entries(STATUS_COLOR).map(([s, c]) => (
            <span key={s} style={{ color: c }}>● {STATUS_LABEL[s]}</span>
          ))}
        </div>
      </div>

      {/* Tactic columns */}
      <div className="mitre-tactics-grid">
        {Object.entries(byTactic).map(([tactic, techniques]) => (
          <div key={tactic} className="mitre-tactic-col">
            <div className="mitre-tactic-header">{tactic}</div>
            {techniques.map((cov) => {
              const cardIdx = globalCardIdx++;
              const isSelected = selectedEntity?.id === cov.technique.id;
              const isFiring = firingTechniqueId === cov.technique.id;
              const isActivated = activatedTechniqueIds.has(cov.technique.id);
              const isUnreached = isReplaying && !isActivated && !isFiring;

              // Find primary linked timeline event
              const linkedEvent = timelineEvents.find((e) => e.techniqueId === cov.technique.id);

              return (
                <TechniqueCard
                  key={cov.technique.id}
                  coverage={cov}
                  isSelected={isSelected}
                  isFiring={isFiring}
                  isActivated={isActivated}
                  isUnreached={isUnreached}
                  linkedEvent={linkedEvent}
                  index={cardIdx}
                  onClick={() => handleClick(cov.technique.id)}
                  onFocusEntity={handleFocusEntity}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Summary bar */}
      <div className="mitre-summary">
        <span>{coverage.length} techniques ·</span>
        {Object.entries(STATUS_COLOR).map(([s, c]) => {
          const count = coverage.filter((c2) => c2.status === s).length;
          if (!count) return null;
          return <span key={s} style={{ color: c }}>{count} {STATUS_LABEL[s]}</span>;
        })}
        {isReplaying && (
          <span style={{ color: '#00f0ff', marginLeft: 'auto' }}>
            Replay Progress: {activatedTechniqueIds.size} / {coverage.length} activated
          </span>
        )}
      </div>
    </div>
  );
}


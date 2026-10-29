/**
 * SpatialTimeline.tsx
 *
 * Vertical spatial timeline for the focused incident.
 * Derives events from InvestigationContext.data.incident.timelineEvents.
 *
 * Synchronization:
 * - Clicking a timeline event: sets selectedEntity → syncs AttackGraph, MITRE.
 * - When replay.currentNodeId matches an event's entityId: event is highlighted.
 * - Replay step changes scroll the active event into view.
 */

'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useInvestigation } from '../InvestigationContext';
import type { TimelineEvent } from '../../../core/models/incident';

const STAGE_COLOR: Record<string, string> = {
  INITIAL_ACCESS:       '#00f0ff',
  EXECUTION:            '#ff2a2a',
  PERSISTENCE:          '#a78bfa',
  PRIVILEGE_ESCALATION: '#ffb700',
  DEFENSE_EVASION:      '#7b8ab8',
  CREDENTIAL_ACCESS:    '#ff6b35',
  DISCOVERY:            '#3dffb0',
  LATERAL_MOVEMENT:     '#ffb700',
  COLLECTION:           '#00f0ff',
  EXFILTRATION:         '#ff2a2a',
  IMPACT:               '#ff2a2a',
};

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#ff2a2a',
  HIGH:     '#ffb700',
  MEDIUM:   '#00f0ff',
  LOW:      '#3dffb0',
  INFO:     '#7b8ab8',
};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toUTCString().slice(5, 22);
  } catch { return ts; }
}

interface TimelineEventRowProps {
  event: TimelineEvent;
  index: number;
  isSelected: boolean;
  isReplayActive: boolean;
  isPast: boolean;
  isFuture: boolean;
  onClick: (e: TimelineEvent) => void;
  rowRef?: (el: HTMLDivElement | null) => void;
}

function TimelineEventRow({
  event, index, isSelected, isReplayActive, isPast, isFuture, onClick, rowRef,
}: TimelineEventRowProps) {
  const stageColor = STAGE_COLOR[event.stage] ?? '#7b8ab8';
  const sevColor   = SEV_COLOR[event.severity]   ?? '#7b8ab8';

  const rowClasses = [
    'tl-event',
    isSelected ? 'selected' : '',
    isReplayActive ? 'replay-active' : '',
    isPast && !isReplayActive ? 'past-executed' : '',
    isFuture ? 'future' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={rowRef}
      className={rowClasses}
      style={{
        '--tl-color': stageColor,
        '--event-index': index,
      } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`Timeline event: ${event.title}. ${event.stage}. ${event.severity}.`}
      onClick={() => onClick(event)}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(event); }}
    >
      {/* Stage spine dot */}
      <div className="tl-dot" style={{ borderColor: stageColor, background: isSelected || isReplayActive ? stageColor : 'transparent' }} />

      {/* Content */}
      <div className="tl-content">
        <div className="tl-header">
          <span className="tl-stage" style={{ color: stageColor }}>
            {event.stage.replace(/_/g, ' ')}
          </span>
          <span className="tl-sev" style={{ color: sevColor }}>
            {event.severity}
          </span>
          <span className="tl-time">{formatTimestamp(event.timestamp)}</span>
        </div>

        <div className="tl-title">{event.title}</div>

        {(isSelected || isReplayActive) && (
          <div className="tl-desc">{event.description}</div>
        )}

        <div className="tl-meta">
          {event.techniqueId && (
            <span className="tl-technique" style={{ color: '#a78bfa' }}>{event.techniqueId}</span>
          )}
          {event.entityId && (
            <span className="tl-entity">{event.entityType}: {event.entityId}</span>
          )}
        </div>
      </div>

      {/* Replay cursor indicator */}
      {isReplayActive && (
        <div className="tl-replay-cursor" aria-label="Current replay position">▶ ACTIVE</div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SpatialTimeline() {
  const { data, selectedEntity, setSelectedEntity, replay } = useInvestigation();
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs      = useRef<Map<string, HTMLDivElement>>(new Map());

  const events: TimelineEvent[] = data?.incident.timelineEvents ?? [];

  // Scroll active replay event into view
  useEffect(() => {
    if (!replay.currentNodeId) return;
    // Find event whose entityId matches the current replay node's associated asset
    const replayNode = data?.attackGraph.nodes.find((n) => n.id === replay.currentNodeId);
    const matchEvent = events.find(
      (e) =>
        e.entityId === replayNode?.id ||
        (replayNode?.data as Record<string, string> | undefined)?.entityId === e.entityId
    );
    if (matchEvent) {
      const el = rowRefs.current.get(matchEvent.id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [replay.currentNodeId, events, data]);

  const handleEventClick = useCallback((event: TimelineEvent) => {
    setSelectedEntity({ id: event.id, type: 'TIMELINE_EVENT' });
    // Also highlight related entity in graph
    if (event.entityId) {
      // Find graph node matching this entityId (assets/users map to node IDs)
      const graphNode = data?.attackGraph.nodes.find(
        (n) =>
          n.label === event.entityId ||
          (n.type === 'ASSET' && event.entityType === 'ASSET') ||
          (n.type === 'USER'  && event.entityType === 'USER')
      );
      if (graphNode) {
        setSelectedEntity({ id: graphNode.id, type: 'GRAPH_NODE' });
      }
    }
  }, [data, setSelectedEntity]);

  if (events.length === 0) {
    return (
      <div className="tl-empty">
        <span>No timeline events recorded for this incident.</span>
      </div>
    );
  }

  const isReplaying = replay.status === 'PLAYING' || replay.status === 'PAUSED';

  return (
    <div className="tl-container" aria-label="Incident timeline">
      {/* Spine line */}
      <div className="tl-spine" />

      {/* Header filter indicator */}
      <div className="tl-header-bar">
        <span className="tl-header-title">CHRONOLOGICAL EVENT CHAIN</span>
        {selectedEntity?.type === 'TIMELINE_EVENT' && (
          <button
            className="tl-clear-filter"
            onClick={() => setSelectedEntity(null)}
            aria-label="Clear event selection"
          >
            CLEAR SELECTION
          </button>
        )}
      </div>

      {/* Stage legend */}
      <div className="tl-legend">
        {['INITIAL_ACCESS', 'EXECUTION', 'LATERAL_MOVEMENT', 'IMPACT'].map((s) => (
          <span key={s} style={{ color: STAGE_COLOR[s] ?? '#7b8ab8' }}>
            ● {s.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Events */}
      <div className="tl-events" ref={containerRef} role="list">
        {events.map((event, index) => {
          const isSelected = selectedEntity?.id === event.id;
          const replayNode = data?.attackGraph.nodes.find((n) => n.id === replay.currentNodeId);
          const isReplayActive =
            isReplaying &&
            replayNode != null &&
            (event.entityId === replayNode.id ||
              event.techniqueId === replayNode.label ||
              event.stage.toLowerCase().includes(replayNode.label.toLowerCase().slice(0, 4)));

          const isPast = isReplaying && replay.currentTimestamp != null
            ? new Date(event.timestamp).getTime() <= new Date(replay.currentTimestamp).getTime()
            : isReplaying && index <= replay.currentStep;

          const isFuture = isReplaying && !isPast && !isReplayActive;

          return (
            <TimelineEventRow
              key={event.id}
              event={event}
              index={index}
              isSelected={isSelected}
              isReplayActive={isReplayActive}
              isPast={isPast}
              isFuture={isFuture}
              onClick={handleEventClick}
              rowRef={(el) => {
                if (el) rowRefs.current.set(event.id, el);
                else rowRefs.current.delete(event.id);
              }}
            />
          );
        })}
      </div>

      {/* Event count */}
      <div className="tl-footer">
        {events.length} events · {replay.status !== 'IDLE' ? `REPLAY ${replay.currentStep + 1}/${replay.totalSteps}` : 'SELECT EVENT TO FILTER GRAPH'}
      </div>
    </div>
  );
}

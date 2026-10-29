/**
 * AttackReplay.tsx
 *
 * Attack path replay controller and overlay.
 *
 * This component does NOT own the replay state machine.
 * The state machine lives in InvestigationContext (replay timer via useRef + setInterval).
 * This component only renders controls and the step visualization.
 *
 * Architecture:
 *   InvestigationContext.replay → { status, currentStep, totalSteps, currentNodeId }
 *   InvestigationContext.replayPlay/Pause/Reset/StepForward/StepBack/JumpTo
 *
 * The step visualization is a linear sequence of attack path nodes.
 * Clicking a step calls replayJumpTo(stepIndex).
 */

'use client';
import { useRef, useEffect, useCallback } from 'react';
import { useInvestigation } from '../InvestigationContext';
import { Play, Pause, RotateCcw, SkipForward, SkipBack } from 'lucide-react';

const STEP_TYPE_COLOR: Record<string, string> = {
  INCIDENT:  '#ff2a2a',
  ALERT:     '#ffb700',
  EVENT:     '#00f0ff',
  ASSET:     '#00f0ff',
  USER:      '#ffb700',
  IOC:       '#ff6b35',
  PROCESS:   '#a78bfa',
  TECHNIQUE: '#a78bfa',
  ACTION:    '#ff2a2a',
};

const SPEEDS = [0.5, 1, 2, 4];

export default function AttackReplay() {
  const {
    data, replay, replaySpeed, setReplaySpeed,
    replayPlay, replayPause, replayReset,
    replayStepForward, replayStepBack, replayJumpTo,
    setSelectedEntity,
  } = useInvestigation();

  const stepContainerRef = useRef<HTMLDivElement>(null);
  const activeStepRef    = useRef<HTMLDivElement | null>(null);

  const attackPath = data?.attackPath;
  const steps      = attackPath?.steps ?? [];

  // Scroll active step into view
  useEffect(() => {
    if (activeStepRef.current) {
      activeStepRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [replay.currentStep]);

  // Sync selected entity with replay step
  useEffect(() => {
    if (replay.currentNodeId) {
      setSelectedEntity({ id: replay.currentNodeId, type: 'GRAPH_NODE' });
    }
  }, [replay.currentNodeId, setSelectedEntity]);

  // Keyboard navigation for replay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (replay.status === 'PLAYING') replayPause();
        else replayPlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        replayStepForward();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        replayStepBack();
      } else if (e.key === 'r' || e.key === 'R') {
        replayReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [replay.status, replayPlay, replayPause, replayStepForward, replayStepBack, replayReset]);

  const handleScrubberChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    replayJumpTo(Number(e.target.value));
  }, [replayJumpTo]);

  if (!attackPath || steps.length === 0) {
    return (
      <div className="replay-empty">
        <span>No attack path available for replay.</span>
        <p>The attack graph has no ordered path nodes defined.</p>
      </div>
    );
  }

  const progressPct = replay.totalSteps > 1
    ? Math.round((replay.currentStep / (replay.totalSteps - 1)) * 100)
    : 0;

  const currentStep = steps[replay.currentStep];
  const isPlaying   = replay.status === 'PLAYING';
  const isCompleted = replay.status === 'COMPLETED';
  const isIdle      = replay.status === 'IDLE';

  return (
    <div className="replay-container" aria-label="Attack path replay">
      {/* Current event display */}
      <div className="replay-current-event">
        {(isIdle || isCompleted) ? (
          <div className="replay-idle-msg">
            {isCompleted ? '⬛ REPLAY COMPLETE' : '▶ ATTACK PATH READY — PRESS PLAY OR SCRUB TIMELINE'}
          </div>
        ) : (
          currentStep && (
            <div
              className="replay-event-detail"
              style={{ borderColor: STEP_TYPE_COLOR[currentStep.node.type] ?? '#3dffb0' }}
            >
              <div className="replay-step-count">
                STEP {replay.currentStep + 1} / {replay.totalSteps}
                {replay.currentTimestamp && (
                  <span style={{ marginLeft: 10, color: '#00f0ff' }}>
                    {new Date(replay.currentTimestamp).toUTCString().slice(5, 22)}
                  </span>
                )}
              </div>
              <div className="replay-node-type"
                style={{ color: STEP_TYPE_COLOR[currentStep.node.type] ?? '#3dffb0' }}>
                {currentStep.node.type}
              </div>
              <div className="replay-node-label">{currentStep.node.label}</div>
              {currentStep.incomingEdge && (
                <div className="replay-edge-relation">
                  ← {currentStep.incomingEdge.relation.replace(/_/g, ' ')}
                </div>
              )}
              {currentStep.techniqueId && (
                <div className="replay-technique" style={{ color: '#a78bfa' }}>
                  Technique: {currentStep.techniqueId}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Interactive scrubber bar */}
      <div className="replay-scrub-container">
        <div
          className="replay-progress-bar"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="replay-progress-fill" style={{ width: `${progressPct}%` }} />
          <input
            type="range"
            min={0}
            max={Math.max(0, replay.totalSteps - 1)}
            value={replay.currentStep}
            onChange={handleScrubberChange}
            className="replay-scrubber-slider"
            aria-label="Replay timeline scrubber slider"
          />
        </div>
      </div>

      {/* Controls toolbar */}
      <div className="replay-controls" role="toolbar" aria-label="Replay controls">
        <div className="replay-btn-group">
          <button
            className="replay-btn"
            onClick={replayStepBack}
            disabled={replay.currentStep === 0 && !isPlaying}
            title="Step back (Left Arrow)"
            aria-label="Step back"
          >
            <SkipBack size={14} />
          </button>

          {isPlaying ? (
            <button
              className="replay-btn replay-btn-primary"
              onClick={replayPause}
              title="Pause replay (Space)"
              aria-label="Pause replay"
            >
              <Pause size={16} />
              <span>PAUSE</span>
            </button>
          ) : (
            <button
              className="replay-btn replay-btn-primary"
              onClick={replayPlay}
              title={isCompleted ? 'Restart replay (Space)' : 'Play replay (Space)'}
              aria-label={isCompleted ? 'Restart replay' : 'Play replay'}
            >
              <Play size={16} />
              <span>{isCompleted ? 'RESTART' : 'PLAY'}</span>
            </button>
          )}

          <button
            className="replay-btn"
            onClick={replayStepForward}
            disabled={replay.currentStep >= replay.totalSteps - 1}
            title="Step forward (Right Arrow)"
            aria-label="Step forward"
          >
            <SkipForward size={14} />
          </button>

          <button
            className="replay-btn replay-btn-reset"
            onClick={replayReset}
            title="Reset replay (R)"
            aria-label="Reset replay"
          >
            <RotateCcw size={13} />
            <span>RESET</span>
          </button>
        </div>

        {/* Speed controls */}
        <div className="replay-speed-group" aria-label="Replay speed selection">
          <span style={{ fontSize: 7.5, color: '#7b8ab8', marginRight: 2, letterSpacing: '0.08em' }}>SPEED</span>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              className={`replay-speed-btn${replaySpeed === speed ? ' active' : ''}`}
              onClick={() => setReplaySpeed(speed)}
              aria-label={`Speed ${speed}x`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      {/* Step sequence */}
      <div className="replay-steps-label">ATTACK PATH SEQUENCE</div>
      <div className="replay-steps" ref={stepContainerRef} role="list">
        {steps.map((step, i) => {
          const isActive  = i === replay.currentStep && !isIdle;
          const isPast    = i < replay.currentStep;
          const color     = STEP_TYPE_COLOR[step.node.type] ?? '#7b8ab8';
          const isOnPath  = attackPath.criticalEdgeIds.includes(step.incomingEdge?.id ?? '');

          return (
            <div
              key={step.nodeId}
              ref={isActive ? (el) => { activeStepRef.current = el; } : undefined}
              className={`replay-step${isActive ? ' active' : ''}${isPast ? ' past' : ''}${isOnPath ? ' critical' : ''}`}
              style={{ '--step-color': color } as React.CSSProperties}
              role="listitem"
              onClick={() => replayJumpTo(i)}
              title={`${step.node.type}: ${step.node.label}`}
              aria-label={`Attack step ${i + 1}: ${step.node.label}`}
            >
              {/* Connector line */}
              {i > 0 && (
                <div className={`replay-connector${isPast || isActive ? ' done' : ''}`} />
              )}

              {/* Step dot */}
              <div className="replay-dot" style={{ borderColor: color, background: isActive ? color : isPast ? `${color}60` : 'transparent' }}>
                <span className="replay-step-num">{i + 1}</span>
              </div>

              {/* Step label */}
              <div className="replay-step-label">
                <span className="replay-step-type" style={{ color }}>{step.node.type}</span>
                <span className="replay-step-name">{step.node.label.slice(0, 14)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Status badge */}
      <div className="replay-status-bar">
        <span className={`replay-status-dot status-${replay.status.toLowerCase()}`} />
        <span className="replay-status-text">{replay.status}</span>
        {replay.currentTimestamp && (
          <span className="replay-timestamp">{new Date(replay.currentTimestamp).toUTCString().slice(5, 22)}</span>
        )}
        <span className="replay-note">Deterministic · Temporal Reconstruction · Hotkeys: Space, Arrows</span>
      </div>
    </div>
  );
}


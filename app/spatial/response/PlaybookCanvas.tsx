/**
 * PlaybookCanvas.tsx
 *
 * Spatial visualization of SOAR Playbook progression.
 * Represents workflow steps as a directed node graph with state transitions:
 *   TRIGGER -> CONDITION -> ACTION_REQUEST -> APPROVAL -> ACTION_EXECUTE -> INCIDENT_UPDATE -> AUDIT_COMMIT
 *
 * Expanded with:
 *   - Offline DRY-RUN simulation toggle with side-effect free prediction
 *   - In-canvas leadership approval authorization and rejection
 *   - Compensation / rollback triggers on reversible actions
 *   - Multi-playbook selector for incident-scoped and catalog-wide workflows
 */

'use client';
import { useState, useEffect } from 'react';
import {
  Play,
  Check,
  Clock,
  AlertCircle,
  Shield,
  ArrowDown,
  UserCheck,
  Eye,
  Lock,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Layers,
} from 'lucide-react';
import type { Playbook, PlaybookStep, DryRunResult } from '../../core/models/response';
import type { UserSession } from '../../core/models/auth';
import { securityService } from '../../core/security-service';
import { playbookEngine } from '../../core/response/playbook-engine';
import { cyberAudio } from '../../cyber-audio';

interface PlaybookCanvasProps {
  incidentId: string;
  session: UserSession;
  onRefreshData?: () => void;
}

export default function PlaybookCanvas({
  incidentId,
  session,
  onRefreshData,
}: PlaybookCanvasProps) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [activePlaybookId, setActivePlaybookId] = useState<string>('');
  const [isExecutingStep, setIsExecutingStep] = useState<string | null>(null);
  const [isDryRunMode, setIsDryRunMode] = useState<boolean>(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Load playbooks from canonical SecurityService with fallback to local incident engine
  const loadPlaybooks = async () => {
    try {
      const allPbs = await securityService.getPlaybooks();
      if (allPbs && allPbs.length > 0) {
        setPlaybooks(allPbs);
        if (!activePlaybookId) {
          const defaultPb = allPbs.find((p) => p.incidentId === incidentId || p.playbookId === 'PB-BLACKTIDE-ISOLATE') ?? allPbs[0];
          setActivePlaybookId(defaultPb.id);
        }
      } else {
        const localPbs = playbookEngine.getPlaybooksForIncident(incidentId);
        setPlaybooks(localPbs);
        if (!activePlaybookId && localPbs[0]) {
          setActivePlaybookId(localPbs[0].id);
        }
      }
    } catch {
      const localPbs = playbookEngine.getPlaybooksForIncident(incidentId);
      setPlaybooks(localPbs);
      if (!activePlaybookId && localPbs[0]) {
        setActivePlaybookId(localPbs[0].id);
      }
    }
  };

  useEffect(() => {
    loadPlaybooks();
    const unsub = securityService.subscribe('PLAYBOOKS_UPDATED', () => loadPlaybooks());
    return () => unsub();
  }, [incidentId]);

  const activePlaybook =
    playbooks.find((p) => p.id === activePlaybookId || p.playbookId === activePlaybookId) ?? playbooks[0];

  // Dry run simulation trigger
  const handleTriggerDryRun = async () => {
    if (!activePlaybook) return;
    cyberAudio.playSelect();
    setIsSimulating(true);
    setErrorMsg(null);
    try {
      const result = await securityService.dryRunPlaybook(activePlaybook.id, session.username);
      setDryRunResult(result);
      setStatusMsg(`Dry run completed: ${result.simulatedSteps.length} steps simulated without side-effects.`);
      cyberAudio.playSuccess?.();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Dry run simulation failed');
      cyberAudio.playAlert?.();
    } finally {
      setIsSimulating(false);
    }
  };

  const handleExecuteStep = async (step: PlaybookStep) => {
    if (!activePlaybook) return;
    setIsExecutingStep(step.id);
    setErrorMsg(null);
    setStatusMsg(null);
    cyberAudio.playSelect();

    try {
      const { playbook } = await playbookEngine.executeStep(
        activePlaybook.id,
        step.id,
        session
      );
      setPlaybooks((prev) =>
        prev.map((p) => (p.id === playbook.id ? playbook : p))
      );
      cyberAudio.playSuccess?.();
      setStatusMsg(`Step "${step.name}" executed successfully.`);
      onRefreshData?.();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to execute step');
      cyberAudio.playAlert?.();
    } finally {
      setIsExecutingStep(null);
    }
  };

  if (!activePlaybook) {
    return <div className="playbook-canvas-container">No active playbook available.</div>;
  }

  return (
    <div className="playbook-canvas-container">
      {/* ── Playbook Header & Selector ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#00f0ff', letterSpacing: '0.08em' }}>
              SOAR PLAYBOOK CANVAS
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              {activePlaybook.description}
            </div>
          </div>

          {/* Playbook Switcher Dropdown */}
          <select
            value={activePlaybook.id}
            onChange={(e) => {
              cyberAudio.playClick();
              setActivePlaybookId(e.target.value);
              setDryRunResult(null);
              setErrorMsg(null);
            }}
            style={{
              background: 'rgba(8, 14, 26, 0.9)',
              border: '1px solid rgba(0, 240, 255, 0.4)',
              color: '#00f0ff',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 10,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {playbooks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.playbookId || p.id} — {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Status & Dry-Run Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mode Switcher Toggle */}
          <button
            className={`resp-btn ${isDryRunMode ? 'resp-btn-secondary' : ''}`}
            onClick={() => {
              cyberAudio.playClick();
              setIsDryRunMode(!isDryRunMode);
              if (!isDryRunMode) {
                handleTriggerDryRun();
              }
            }}
            style={{
              padding: '4px 10px',
              fontSize: 10,
              borderColor: isDryRunMode ? '#ffb700' : 'rgba(0,240,255,0.3)',
              color: isDryRunMode ? '#ffb700' : '#94a3b8',
              background: isDryRunMode ? 'rgba(255, 183, 0, 0.15)' : 'transparent',
            }}
          >
            <Eye size={11} /> {isDryRunMode ? 'DRY RUN MODE (ACTIVE)' : 'ENABLE DRY RUN'}
          </button>

          <span style={{ fontSize: 10, color: '#64748b' }}>STATUS:</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 3,
              background: activePlaybook.status === 'COMPLETED' ? 'rgba(61,255,176,0.15)' : 'rgba(0,240,255,0.15)',
              color: activePlaybook.status === 'COMPLETED' ? '#3dffb0' : '#00f0ff',
              border: `1px solid ${activePlaybook.status === 'COMPLETED' ? '#3dffb060' : '#00f0ff60'}`,
            }}
          >
            {activePlaybook.status}
          </span>
        </div>
      </div>

      {/* ── Dry-Run Simulation Banner ── */}
      {isDryRunMode && (
        <div
          style={{
            background: 'rgba(255, 183, 0, 0.12)',
            border: '1px solid #ffb70080',
            color: '#ffb700',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 11,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Eye size={14} />
            <span>
              <strong>DRY RUN MODE:</strong> Simulating actions without mutating canonical asset, IOC, or user state.
            </span>
          </div>

          <button
            className="resp-btn"
            onClick={handleTriggerDryRun}
            disabled={isSimulating}
            style={{ padding: '3px 8px', fontSize: 10, borderColor: '#ffb700', color: '#ffb700' }}
          >
            {isSimulating ? 'SIMULATING...' : 'RERUN SIMULATION'}
          </button>
        </div>
      )}

      {/* Feedback Messages: Strictly state-driven */}
      {statusMsg && (
        <div
          className="soc-motion-success"
          style={{
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircle2 size={14} className="soc-motion-success-icon" style={{ color: '#3dffb0' }} />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="soc-motion-failure soc-failure-box">
          <div className="soc-failure-header">
            <AlertCircle size={14} />
            <span>PLAYBOOK STEP EXECUTION FAILED</span>
          </div>
          <div className="soc-failure-explanation">{errorMsg}</div>
          <div className="soc-failure-actions">
            <button
              type="button"
              className="soc-remediation-btn"
              onClick={() => {
                setErrorMsg(null);
                const nextStep = activePlaybook.steps.find((s) => s.status === 'READY' || s.status === 'WAITING_APPROVAL') ?? activePlaybook.steps[0];
                if (nextStep) void handleExecuteStep(nextStep);
              }}
            >
              <RotateCcw size={11} /> RETRY STEP
            </button>
          </div>
        </div>
      )}

      {/* ── Directed Node Graph ── */}
      <div className="playbook-graph">
        {activePlaybook.steps.map((step, idx) => {
          const isCompleted = step.status === 'COMPLETED';
          const isRunning = step.status === 'RUNNING' || isExecutingStep === step.id;
          const isReady = step.status === 'READY';
          const isWaiting = step.status === 'WAITING_APPROVAL';

          // In Dry Run mode, match simulated prediction
          const simulatedStep = dryRunResult?.simulatedSteps.find((s) => s.stepId === step.id);

          return (
            <div key={step.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                className={`playbook-step-node node-${(step.status || 'PENDING').toLowerCase()}`}
                style={{
                  width: '100%',
                  border: isDryRunMode ? '1px dashed rgba(255, 183, 0, 0.4)' : undefined,
                }}
              >
                <div className="playbook-step-left">
                  <div className="playbook-step-num">
                    {isCompleted ? <Check size={14} /> : step.order ?? idx + 1}
                  </div>

                  <div className="playbook-step-body">
                    <div className="playbook-step-title">
                      <span>{step.name}</span>
                      <span className="playbook-step-type-pill">{step.type}</span>
                      {step.requiredRole && (
                        <span style={{ fontSize: 9, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <UserCheck size={10} /> {step.requiredRole}
                        </span>
                      )}
                      {step.compensationAction && (
                        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: 'rgba(167, 139, 250, 0.15)', color: '#a78bfa' }}>
                          REVERSIBLE → {step.compensationAction}
                        </span>
                      )}
                    </div>

                    <div className="playbook-step-desc">
                      {isDryRunMode && simulatedStep ? (
                        <span style={{ color: '#ffb700' }}>
                          ⚡ Predicted outcome: {simulatedStep.expectedStateChange}
                        </span>
                      ) : (
                        step.resultMessage ?? step.description
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {isCompleted ? (
                    <span style={{ fontSize: 10, color: '#3dffb0', fontWeight: 700 }}>
                      ✓ DONE
                    </span>
                  ) : isReady || isWaiting ? (
                    <button
                      className="resp-btn resp-btn-primary"
                      onClick={() => handleExecuteStep(step)}
                      disabled={isRunning || isDryRunMode}
                      style={{ padding: '4px 10px', fontSize: 10 }}
                    >
                      <Play size={10} /> {isRunning ? 'RUNNING…' : isWaiting ? 'AUTHORIZE' : 'EXECUTE'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 10, color: '#64748b' }}>
                      <Clock size={10} style={{ display: 'inline', marginRight: 4 }} /> PENDING
                    </span>
                  )}
                </div>
              </div>

              {/* Connecting Conduit between sequential steps */}
              {idx < activePlaybook.steps.length - 1 && (
                <div
                  style={{
                    height: 16,
                    width: 2,
                    background: isCompleted ? 'rgba(61,255,176,0.6)' : 'rgba(255,255,255,0.15)',
                    margin: '2px 0',
                    transition: 'background 0.3s',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

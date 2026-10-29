/**
 * ExecutionHistoryView.tsx
 *
 * Spatial execution history tracking real SOAR runs, step timelines,
 * leadership approvals, error telemetry, and deterministic compensation / rollback.
 */

'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  History,
  CheckCircle,
  Clock,
  AlertCircle,
  RotateCcw,
  User,
  Shield,
  FileText,
  Lock,
  Layers,
  RefreshCw,
} from 'lucide-react';
import type { PlaybookExecution, ApprovalRecord } from '../../core/models/response';
import type { UserSession } from '../../core/models/auth';
import { securityService } from '../../core/security-service';
import { cyberAudio } from '../../cyber-audio';

interface ExecutionHistoryViewProps {
  session: UserSession | null;
  incidentId?: string;
}

export default function ExecutionHistoryView({
  session,
  incidentId,
}: ExecutionHistoryViewProps) {
  const [executions, setExecutions] = useState<PlaybookExecution[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isCompensating, setIsCompensating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadHistory = async () => {
    try {
      const execs = await securityService.getPlaybookExecutions(incidentId ? { incidentId } : undefined);
      const apps = await securityService.getApprovals();
      setExecutions(execs);
      setApprovals(apps);
      if (!selectedExecId && execs.length > 0) {
        setSelectedExecId(execs[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load executions:', err);
    }
  };

  useEffect(() => {
    loadHistory();
    const unsub1 = securityService.subscribe('PLAYBOOK_EXECUTION_CREATED', () => loadHistory());
    const unsub2 = securityService.subscribe('PLAYBOOK_EXECUTION_UPDATED', () => loadHistory());
    const unsub3 = securityService.subscribe('PLAYBOOK_APPROVAL_UPDATED', () => loadHistory());
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [incidentId]);

  const filteredExecutions = useMemo(() => {
    if (statusFilter === 'ALL') return executions;
    return executions.filter((e) => e.status === statusFilter);
  }, [executions, statusFilter]);

  const selectedExecution = useMemo(() => {
    return executions.find((e) => e.id === selectedExecId) ?? executions[0];
  }, [executions, selectedExecId]);

  const selectedApprovals = useMemo(() => {
    if (!selectedExecution) return [];
    return approvals.filter((a) => a.executionId === selectedExecution.id);
  }, [approvals, selectedExecution]);

  const handleRollback = async (executionId: string) => {
    cyberAudio.playClick();
    setIsCompensating(true);
    try {
      const res = await securityService.rollbackPlaybookExecution(executionId);
      setFeedback(`Execution compensated. Rolled back ${res.compensatedStepsCount} steps to prior state.`);
      cyberAudio.playSuccess?.();
      await loadHistory();
    } catch (err: any) {
      setFeedback(`Compensation failed: ${err.message}`);
      cyberAudio.playAlert?.();
    } finally {
      setIsCompensating(false);
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', gap: 16, padding: '12px 16px', overflow: 'hidden' }}>
      {/* ── Left Column: Execution Timeline Feed ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320, borderRight: '1px solid rgba(0, 240, 255, 0.15)', paddingRight: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#00f0ff', fontSize: 13, fontWeight: 700 }}>
            <History size={14} /> SOAR EXECUTION HISTORY ({filteredExecutions.length})
          </div>
          <button className="resp-btn" onClick={loadHistory} title="Refresh History" style={{ padding: '3px 6px' }}>
            <RefreshCw size={11} />
          </button>
        </div>

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['ALL', 'RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'CANCELLED', 'FAILED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 3,
                border: '1px solid',
                borderColor: statusFilter === st ? '#00f0ff' : 'rgba(255,255,255,0.1)',
                background: statusFilter === st ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                color: statusFilter === st ? '#00f0ff' : '#94a3b8',
                cursor: 'pointer',
              }}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Execution Items */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
          {filteredExecutions.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 11, padding: 20, textAlign: 'center' }}>
              No execution records match filter.
            </div>
          ) : (
            filteredExecutions.map((exec) => {
              const isSelected = selectedExecution?.id === exec.id;
              const isCompleted = exec.status === 'COMPLETED';
              const isWaiting = exec.status === 'WAITING_APPROVAL';
              const isFailed = exec.status === 'FAILED';
              const isCancelled = exec.status === 'CANCELLED';

              const statusColor = isCompleted
                ? '#3dffb0'
                : isWaiting
                ? '#ffb700'
                : isFailed
                ? '#ff4242'
                : isCancelled
                ? '#a78bfa'
                : '#00f0ff';

              return (
                <div
                  key={exec.id}
                  onClick={() => {
                    cyberAudio.playClick();
                    setSelectedExecId(exec.id);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: `1px solid ${isSelected ? '#00f0ff' : 'rgba(255,255,255,0.08)'}`,
                    background: isSelected ? 'rgba(0, 240, 255, 0.08)' : 'rgba(15, 23, 42, 0.6)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#00f0ff', fontWeight: 700 }}>
                      {exec.playbookName} · v{exec.playbookVersion}
                    </span>
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 800,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: `${statusColor}18`,
                        color: statusColor,
                        border: `1px solid ${statusColor}40`,
                      }}
                    >
                      {exec.status}
                    </span>
                  </div>

                  <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>
                    Exec: {exec.id.slice(0, 16)}... · Target: {exec.targetEntity?.label ?? exec.incidentId ?? 'Incident'}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b' }}>
                    <span>By: {exec.initiatedBy}</span>
                    <span>{new Date(exec.startedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Column: Execution Inspector & Rollback ── */}
      <div style={{ flex: 1.3, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', paddingLeft: 4 }}>
        {selectedExecution ? (
          <>
            {/* Header Inspector */}
            <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: 6, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#00f0ff' }}>
                      {selectedExecution.playbookName}
                    </span>
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'rgba(0,240,255,0.1)', color: '#00f0ff', border: '1px solid rgba(0,240,255,0.3)' }}>
                      v{selectedExecution.playbookVersion}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                    ID: {selectedExecution.id} · Trigger: {selectedExecution.triggerSource} · Actor: {selectedExecution.initiatedBy}
                  </div>
                </div>

                {/* Rollback / Compensate Button */}
                {(selectedExecution.status === 'COMPLETED' || selectedExecution.status === 'FAILED') && (
                  <button
                    className="resp-btn"
                    onClick={() => handleRollback(selectedExecution.id)}
                    disabled={isCompensating}
                    style={{
                      fontSize: 10,
                      padding: '4px 10px',
                      color: '#a78bfa',
                      borderColor: '#a78bfa60',
                    }}
                  >
                    <RotateCcw size={10} /> {isCompensating ? 'ROLLING BACK...' : 'COMPENSATE / ROLLBACK'}
                  </button>
                )}
              </div>

              {feedback && (
                <div style={{ fontSize: 10, color: '#3dffb0', background: 'rgba(61,255,176,0.1)', padding: '4px 8px', borderRadius: 4, marginTop: 6 }}>
                  {feedback}
                </div>
              )}
            </div>

            {/* Approval Decision Records (if any) */}
            {selectedApprovals.length > 0 && (
              <div style={{ background: 'rgba(255, 183, 0, 0.05)', border: '1px solid rgba(255, 183, 0, 0.3)', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#ffb700', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={12} /> LEADERSHIP APPROVAL AUDIT
                </div>
                {selectedApprovals.map((app) => (
                  <div
                    key={app.id}
                    style={{
                      fontSize: 10,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'rgba(0,0,0,0.3)',
                      padding: '6px 8px',
                      borderRadius: 4,
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 700, color: '#e2e8f0', marginRight: 6 }}>
                        {app.actionType}
                      </span>
                      <span style={{ color: '#94a3b8' }}>Target: {app.targetLabel}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ color: app.status === 'APPROVED' ? '#3dffb0' : '#ff6b6b', fontWeight: 700 }}>
                        {app.status}
                      </span>
                      <span style={{ color: '#64748b', fontSize: 9 }}>
                        by {app.approvedBy ?? app.rejectedBy ?? 'Pending'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Step Executions Detail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                STEP EXECUTION LOG ({selectedExecution.stepExecutions.length})
              </div>

              {selectedExecution.stepExecutions.map((step, idx) => {
                const isStepCompleted = step.status === 'COMPLETED';
                const isStepWaiting = step.status === 'WAITING_APPROVAL';
                const isStepFailed = step.status === 'FAILED';

                const stepBadgeColor = isStepCompleted
                  ? '#3dffb0'
                  : isStepWaiting
                  ? '#ffb700'
                  : isStepFailed
                  ? '#ff4242'
                  : '#64748b';

                return (
                  <div
                    key={step.stepId}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 4,
                      background: 'rgba(15, 23, 42, 0.4)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: '#00f0ff', fontWeight: 700 }}>
                          Step {idx + 1}: {step.name}
                        </span>
                        <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>
                          {step.actionType}
                        </span>
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: stepBadgeColor }}>
                        {step.status}
                      </span>
                    </div>

                    {step.resultMessage && (
                      <div style={{ fontSize: 10, color: '#cbd5e1' }}>
                        {step.resultMessage}
                      </div>
                    )}

                    {step.error && (
                      <div style={{ fontSize: 10, color: '#ff6b6b' }}>
                        Error: {step.error}
                      </div>
                    )}

                    {step.completedAt && (
                      <div style={{ fontSize: 8, color: '#64748b' }}>
                        Completed at: {new Date(step.completedAt).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ color: '#64748b', fontSize: 11, padding: 20, textAlign: 'center' }}>
            Select an execution from the timeline to view provenance.
          </div>
        )}
      </div>
    </div>
  );
}

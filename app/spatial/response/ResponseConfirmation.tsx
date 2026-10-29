/**
 * ResponseConfirmation.tsx
 *
 * Explicit confirmation surface for high-impact security response actions.
 * EXPLAIN-SEC SPATIAL — STEP 9: EVIDENCE + RBAC + RESPONSE UX.
 *
 * Sensitive operations expose:
 *   - RBAC check & role required
 *   - Approval status & actor
 *   - Dry run simulation option
 *   - Execution state lifecycle: PENDING -> EXECUTING -> SUCCESS | FAILED | DENIED
 *   - Rollback capability where supported
 *   - Audit ledger commitment
 *
 * ANIMATION: Do NOT show SUCCESS before actual success. Visual state matches actual operation state.
 */

'use client';
import { useState } from 'react';
import {
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Check,
  X,
  Sparkles,
  RotateCcw,
  Lock,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import type { ResponseAction } from '../../core/models/response';

export type OperationLifecycleState = 'PENDING' | 'EXECUTING' | 'SUCCESS' | 'FAILED' | 'DENIED';

interface ResponseConfirmationProps {
  action: ResponseAction;
  onConfirm: (isDryRun: boolean) => Promise<void>;
  onCancel: () => void;
  isExecuting?: boolean;
  operationState?: OperationLifecycleState;
  errorMessage?: string | null;
}

export default function ResponseConfirmation({
  action,
  onConfirm,
  onCancel,
  isExecuting = false,
  operationState = 'PENDING',
  errorMessage = null,
}: ResponseConfirmationProps) {
  const [isDryRun, setIsDryRun] = useState(false);

  const consequenceText =
    action.consequence ??
    (action.type === 'QUARANTINE_ASSET' || action.type === 'QUARANTINE_HOST' || action.type === 'ISOLATE_ASSET'
      ? `Host ${action.targetLabel} will be immediately disconnected from all corporate network segments. Only forensic telemetry will remain active.`
      : action.type === 'BLOCK_IOC' || action.type === 'BLOCK_DOMAIN'
      ? `Indicator ${action.targetLabel} will be added to perimeter drop rules across all active firewalls.`
      : action.type === 'DISABLE_USER' || action.type === 'DISABLE_ACCOUNT' || action.type === 'SUSPEND_USER'
      ? `User ${action.targetLabel} will be suspended in the directory, revoking active sessions and Kerberos tickets.`
      : action.type === 'KILL_PROCESS'
      ? `Process ${action.targetLabel} will be forcibly terminated on host endpoint via SIGKILL.`
      : action.type === 'COLLECT_EVIDENCE'
      ? `Cryptographically sealed forensic snapshot will be captured from live incident telemetry.`
      : `Operational response action ${action.type} will be executed on target ${action.targetLabel}.`);

  const isReversible =
    action.reversibility === 'FULL' ||
    action.reversibility === 'REVERSIBLE' ||
    action.type === 'QUARANTINE_ASSET' ||
    action.type === 'ISOLATE_ASSET' ||
    action.type === 'BLOCK_IOC' ||
    action.type === 'BLOCK_DOMAIN' ||
    action.type === 'DISABLE_ACCOUNT' ||
    action.type === 'DISABLE_USER';

  return (
    <div className="resp-modal-overlay" role="dialog" aria-modal="true">
      <div className="resp-modal-card">
        {/* Modal Title & State Badge */}
        <div className="resp-modal-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#ffb700" />
            <span>CONFIRM HIGH-IMPACT RESPONSE ACTION</span>
          </div>

          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 3,
              textTransform: 'uppercase',
              background:
                operationState === 'SUCCESS'
                  ? 'rgba(61,255,176,0.15)'
                  : operationState === 'EXECUTING'
                  ? 'rgba(0,240,255,0.15)'
                  : operationState === 'FAILED' || operationState === 'DENIED'
                  ? 'rgba(255,42,42,0.15)'
                  : 'rgba(255,183,0,0.15)',
              color:
                operationState === 'SUCCESS'
                  ? '#3dffb0'
                  : operationState === 'EXECUTING'
                  ? '#00f0ff'
                  : operationState === 'FAILED' || operationState === 'DENIED'
                  ? '#ff4444'
                  : '#ffb700',
              border: `1px solid ${
                operationState === 'SUCCESS'
                  ? '#3dffb050'
                  : operationState === 'EXECUTING'
                  ? '#00f0ff50'
                  : operationState === 'FAILED' || operationState === 'DENIED'
                  ? '#ff444450'
                  : '#ffb70050'
              }`,
            }}
          >
            STATE: {operationState}
          </span>
        </div>

        {/* Action Type */}
        <div className="resp-modal-row">
          <span className="resp-modal-label">ACTION TYPE</span>
          <span className="resp-modal-val" style={{ color: '#00f0ff', fontWeight: 700 }}>
            {action.type.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Target Entity */}
        <div className="resp-modal-row">
          <span className="resp-modal-label">TARGET ENTITY</span>
          <span className="resp-modal-val">
            {action.targetLabel} <span style={{ color: '#64748b' }}>({action.targetType} / {action.targetId})</span>
          </span>
        </div>

        {/* Correlated Incident */}
        <div className="resp-modal-row">
          <span className="resp-modal-label">CORRELATED INCIDENT</span>
          <span className="resp-modal-val font-mono">{action.incidentId}</span>
        </div>

        {/* Authorization & RBAC */}
        <div className="resp-modal-row">
          <span className="resp-modal-label">AUTHORIZATION (RBAC)</span>
          <span className="resp-modal-val" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={14} color="#3dffb0" />
            <span style={{ color: '#3dffb0', fontWeight: 700 }}>{action.status}</span>
            {action.approvedBy && (
              <span style={{ color: '#94a3b8' }}>by {action.approvedBy}</span>
            )}
            <span style={{ fontSize: 9, color: '#a78bfa', marginLeft: 6 }}>
              [REQUIRED: RESPONDER / SOAR_EXECUTE]
            </span>
          </span>
        </div>

        {/* Reversibility & Rollback */}
        <div className="resp-modal-row">
          <span className="resp-modal-label">REVERSIBILITY</span>
          <span className="resp-modal-val" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isReversible ? (
              <span style={{ color: '#3dffb0', fontWeight: 600 }}>
                FULL ROLLBACK SUPPORTED (Deterministic Inverse Compensation)
              </span>
            ) : (
              <span style={{ color: '#ff6b35', fontWeight: 600 }}>
                IRREVERSIBLE (NO ROLLBACK POSSIBLE)
              </span>
            )}
          </span>
        </div>

        {/* Operational Consequence */}
        <div className="resp-consequence-box">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>OPERATIONAL CONSEQUENCE:</div>
          <div>{consequenceText}</div>
        </div>

        {/* Dry Run Simulation Toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'rgba(167,139,250,0.08)',
            border: '1px solid rgba(167,139,250,0.3)',
            borderRadius: 4,
            margin: '8px 0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={14} color="#a78bfa" />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e0f2fe' }}>
                DRY RUN SIMULATION MODE
              </div>
              <div style={{ fontSize: 9, color: '#94a3b8' }}>
                Validate execution policy without modifying production host or network routing.
              </div>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: '#a78bfa' }}>
            <input
              type="checkbox"
              checked={isDryRun}
              onChange={(e) => setIsDryRun(e.target.checked)}
              disabled={isExecuting}
            />
            SIMULATE ONLY
          </label>
        </div>

        {/* Live Execution Progress Animation - Strict State Fidelity */}
        {isExecuting && (
          <div className="resp-executing-progress-box">
            <div className="resp-executing-label">
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#00f0ff' }}>
                <Activity size={12} className="spin" />
                {isDryRun
                  ? 'SIMULATING RESPONSE AGAINST LOCAL POLICIES...'
                  : 'TRANSMITTING CONTAINMENT COMMAND TO SWITCH / FIREWALL...'}
              </span>
              <span style={{ color: '#3dffb0' }}>COMMITTING TO LOCAL AUDIT</span>
            </div>
            <div className="resp-executing-bar">
              <div className="resp-executing-fill" />
            </div>
          </div>
        )}

        {/* Success confirmation pulse -> stable state */}
        {operationState === 'SUCCESS' && (
          <div className="soc-motion-success" style={{ padding: '10px 14px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <CheckCircle2 size={16} className="soc-motion-success-icon" style={{ color: '#3dffb0' }} />
            <span style={{ color: '#3dffb0', fontWeight: 700, fontSize: 11, letterSpacing: '0.05em' }}>
              {isDryRun ? 'DRY-RUN SIMULATION COMPLETED — LOCAL AUDIT LOGGED' : 'CONTAINMENT ACTION CONFIRMED — IMMUTABLE LEDGER COMMITTED'}
            </span>
          </div>
        )}

        {/* Error or Denied feedback: Controlled error state -> explanation -> remediation/retry */}
        {errorMessage && (operationState === 'FAILED' || operationState === 'DENIED') && (
          <div className="soc-motion-failure soc-failure-box" style={{ marginTop: 8 }}>
            <div className="soc-failure-header">
              <ShieldAlert size={14} />
              <span>{operationState === 'DENIED' ? 'AUTHORIZATION DENIED (RBAC GATE)' : 'OPERATIONAL EXECUTION FAILED'}</span>
            </div>
            <div className="soc-failure-explanation">{errorMessage}</div>
            <div className="soc-failure-actions">
              <button
                type="button"
                className="soc-remediation-btn"
                onClick={() => void onConfirm(isDryRun)}
                disabled={isExecuting || operationState === 'DENIED'}
              >
                <RotateCcw size={11} /> RETRY OPERATION
              </button>
            </div>
          </div>
        )}

        {/* Modal Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
          <button
            className="resp-btn"
            onClick={onCancel}
            disabled={isExecuting}
            style={{ background: 'rgba(255,255,255,0.08)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <X size={12} /> CANCEL
          </button>

          <button
            className="resp-btn resp-btn-primary"
            onClick={() => void onConfirm(isDryRun)}
            disabled={isExecuting || operationState === 'DENIED'}
            style={{
              background: isDryRun ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : undefined,
              borderColor: isDryRun ? '#a78bfa' : undefined,
            }}
          >
            {isExecuting ? (
              <>
                <Activity size={12} className="spin" />
                <span>EXECUTING…</span>
              </>
            ) : isDryRun ? (
              <>
                <Sparkles size={12} />
                <span>EXECUTE DRY RUN</span>
              </>
            ) : (
              <>
                <Check size={12} />
                <span>CONFIRM & EXECUTE</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

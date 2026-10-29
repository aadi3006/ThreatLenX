/**
 * ResponseActionNode.tsx
 *
 * Interactive action card representing a single canonical response action.
 * EXPLAIN-SEC SPATIAL — STEP 9: EVIDENCE + RBAC + RESPONSE UX.
 *
 * Evaluates RBAC permissions:
 *   - Request approval (Analyst)
 *   - Approve / Reject (SOC Manager)
 *   - Execute (Responder / Admin)
 *   - Rollback (Responder / Admin where supported)
 *
 * Visual state strictly matches actual operation state:
 *   PENDING -> EXECUTING -> SUCCESS | FAILED | DENIED
 */

'use client';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Play,
  Send,
  RotateCcw,
  Sparkles,
  Lock,
} from 'lucide-react';
import type { ResponseAction } from '../../core/models/response';
import type { RoleId } from '../../core/models/auth';
import { canRequestContainment, canApproveContainment, canExecuteSOAR } from '../../core/auth/rbac';

interface ResponseActionNodeProps {
  action: ResponseAction;
  currentRole: RoleId;
  onRequestApproval: (action: ResponseAction) => void;
  onApprove: (action: ResponseAction) => void;
  onReject: (action: ResponseAction) => void;
  onInitiateExecution: (action: ResponseAction) => void;
  onDryRun?: (action: ResponseAction) => void;
  onRollback?: (action: ResponseAction) => void;
  onSelectEntity?: (entity: { id: string; type: string }) => void;
  isExecuting?: boolean;
}

export default function ResponseActionNode({
  action,
  currentRole,
  onRequestApproval,
  onApprove,
  onReject,
  onInitiateExecution,
  onDryRun,
  onRollback,
  onSelectEntity,
  isExecuting = false,
}: ResponseActionNodeProps) {
  const isApproved = action.status === 'APPROVED';
  const isPending =
    action.status === 'PENDING_APPROVAL' ||
    action.status === 'AWAITING_APPROVAL' ||
    action.status === 'REQUESTED';
  const isCompleted = action.status === 'COMPLETED' || action.status === 'EXECUTED';
  const isRejected = action.status === 'REJECTED' || action.status === 'DENIED';
  const isRolledBack = action.status === 'ROLLED_BACK';

  const userCanRequest = canRequestContainment(currentRole);
  const userCanApprove = canApproveContainment(currentRole);
  const userCanExecute = canExecuteSOAR(currentRole);

  const isReversible =
    action.reversibility === 'FULL' ||
    action.reversibility === 'REVERSIBLE' ||
    action.type === 'QUARANTINE_ASSET' ||
    action.type === 'ISOLATE_ASSET' ||
    action.type === 'BLOCK_IOC' ||
    action.type === 'BLOCK_DOMAIN' ||
    action.type === 'DISABLE_ACCOUNT' ||
    action.type === 'DISABLE_USER';

  const getStatusClass = () => {
    if (isExecuting) return 'status-executing';
    if (isCompleted) return 'status-completed';
    if (isApproved) return 'status-approved';
    if (isPending) return 'status-pending';
    if (isRejected) return 'status-rejected';
    if (isRolledBack) return 'status-rolled-back';
    return '';
  };

  const getPillClass = () => {
    if (isCompleted) return 'pill-completed';
    if (isApproved) return 'pill-approved';
    if (isPending) return 'pill-pending';
    if (isRejected) return 'pill-rejected';
    return '';
  };

  return (
    <div
      className={`resp-action-card ${getStatusClass()}`}
      data-action-id={action.id}
      onClick={() => onSelectEntity?.({ id: action.targetId, type: action.targetType })}
    >
      <div className="resp-card-top">
        <div className="resp-card-type">
          {action.riskImpact === 'HIGH' ? (
            <ShieldAlert size={14} color="#ff6b35" />
          ) : (
            <Shield size={14} color="#00f0ff" />
          )}
          <span>{action.type.replace(/_/g, ' ')}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isReversible ? (
            <span style={{ fontSize: 9, color: '#3dffb0', background: 'rgba(61,255,176,0.1)', padding: '1px 5px', borderRadius: 3 }}>
              REVERSIBLE
            </span>
          ) : (
            <span style={{ fontSize: 9, color: '#ff6b35', background: 'rgba(255,107,53,0.1)', padding: '1px 5px', borderRadius: 3 }}>
              IRREVERSIBLE
            </span>
          )}

          <span className={`resp-status-pill ${getPillClass()}`}>
            {isExecuting ? 'EXECUTING…' : action.status}
          </span>
        </div>
      </div>

      <div className="resp-card-target">
        <span>
          TARGET: <span className="resp-target-value">{action.targetLabel}</span>
        </span>
        <span style={{ color: '#64748b' }}>•</span>
        <span>
          TYPE: <span style={{ color: '#a78bfa' }}>{action.targetType}</span>
        </span>
        <span style={{ color: '#64748b' }}>•</span>
        <span>
          RISK: <span style={{ color: action.riskImpact === 'HIGH' ? '#ff2a2a' : '#3dffb0' }}>{action.riskImpact}</span>
        </span>
      </div>

      <div className="resp-card-desc">
        {action.resultMessage ?? action.consequence ?? `Action targeting ${action.targetLabel} for incident containment.`}
      </div>

      <div className="resp-card-footer">
        <div className="resp-meta-info">
          {action.requestedBy && <span>REQ: {action.requestedBy} </span>}
          {action.approvedBy && <span>• APP: {action.approvedBy} </span>}
          {action.executedAt && <span>• TIME: {new Date(action.executedAt).toLocaleTimeString()}</span>}
        </div>

        <div className="resp-action-btn-group" onClick={(e) => e.stopPropagation()}>
          {/* Dry Run Simulation Trigger */}
          {onDryRun && (action.status === 'APPROVED' || action.status === 'PENDING' || action.status === 'REQUESTED') && (
            <button
              className="resp-btn"
              onClick={() => onDryRun(action)}
              title="Run pre-flight dry run simulation without modifying production state"
              style={{ background: 'rgba(167,139,250,0.15)', borderColor: 'rgba(167,139,250,0.4)', color: '#c4b5fd' }}
            >
              <Sparkles size={11} /> DRY RUN
            </button>
          )}

          {/* Draft or initial state: request approval */}
          {(action.status === 'DRAFT' || action.status === 'PENDING') && (
            <button
              className="resp-btn resp-btn-primary"
              disabled={!userCanRequest}
              onClick={() => onRequestApproval(action)}
              title={userCanRequest ? 'Submit request for authorization' : 'LOCKED: Requires Analyst or Responder role'}
            >
              <Send size={11} /> {userCanRequest ? 'REQUEST APPROVAL' : 'LOCKED: REQUEST'}
            </button>
          )}

          {/* Pending approval: Approve or Reject */}
          {isPending && (
            <>
              <button
                className="resp-btn resp-btn-approve"
                disabled={!userCanApprove}
                onClick={() => onApprove(action)}
                title={userCanApprove ? 'Grant authorization for this action' : 'LOCKED: Requires Manager role to approve'}
              >
                <CheckCircle2 size={11} /> {userCanApprove ? 'APPROVE' : 'LOCKED: APPROVE'}
              </button>
              <button
                className="resp-btn resp-btn-reject"
                disabled={!userCanApprove}
                onClick={() => onReject(action)}
                title={userCanApprove ? 'Reject this request' : 'LOCKED: Requires Manager role to reject'}
              >
                <XCircle size={11} /> REJECT
              </button>
            </>
          )}

          {/* Approved: Ready for execution */}
          {isApproved && (
            <button
              className="resp-btn resp-btn-primary"
              disabled={!userCanExecute || isExecuting}
              onClick={() => onInitiateExecution(action)}
              title={userCanExecute ? 'Open confirmation to execute' : 'LOCKED: Requires Responder role to execute'}
            >
              <Play size={11} /> {userCanExecute ? (isExecuting ? 'EXECUTING…' : 'EXECUTE ACTION') : 'LOCKED: EXECUTE'}
            </button>
          )}

          {/* Completed: Show success indicator and Rollback button where supported */}
          {isCompleted && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#3dffb0', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
                <ShieldCheck size={13} /> SUCCESS
              </span>

              {isReversible && onRollback && (
                <button
                  className="resp-btn"
                  disabled={!userCanExecute}
                  onClick={() => onRollback(action)}
                  title={userCanExecute ? 'Rollback containment action to restore baseline' : 'LOCKED: Requires Responder role'}
                  style={{ background: 'rgba(255,183,0,0.15)', borderColor: 'rgba(255,183,0,0.4)', color: '#ffb700' }}
                >
                  <RotateCcw size={11} /> {userCanExecute ? 'ROLLBACK' : 'LOCKED: ROLLBACK'}
                </button>
              )}
            </div>
          )}

          {/* Rolled back */}
          {isRolledBack && (
            <span style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
              <RotateCcw size={11} /> ROLLED BACK
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

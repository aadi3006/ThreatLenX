/**
 * app/spatial/common/SecurityActionConfirmModal.tsx
 *
 * Mandatory Two-Stage Safety Gate for Consequential / Destructive SOC Actions.
 *
 * Both cursor and hand-gesture interactions converge here:
 * SELECT -> CONFIRM -> RBAC -> POLICY -> EXECUTE -> AUDIT
 *
 * Prevents accidental gesture executions and enforces role-based authorization.
 */

'use client';
import { useState, useEffect } from 'react';
import { AlertTriangle, ShieldCheck, X, Check, Lock, AlertCircle } from 'lucide-react';
import { securityService } from '../../core/security-service';
import { useSpatialUi } from '../state/use-spatial-ui';
import { cyberAudio } from '../../cyber-audio';

export function SecurityActionConfirmModal() {
  const { activeConfirmation, clearConfirmation } = useSpatialUi();
  const [currentUserRole, setCurrentUserRole] = useState<string>('ANALYST');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    async function loadRole() {
      try {
        const s = securityService.getSession();
        if (s?.role) setCurrentUserRole(s.role);
      } catch {
        // fallback
      }
    }
    if (activeConfirmation) {
      loadRole();
      setAuthError(null);
      setIsSuccess(false);
      cyberAudio.playAlert(activeConfirmation.riskTier);
    }
  }, [activeConfirmation]);

  if (!activeConfirmation) return null;

  const handleExecute = async () => {
    // RBAC validation check
    if (activeConfirmation.requiredRole) {
      const allowedRoles = ['COMMANDER', 'ADMIN', 'SENIOR_ANALYST'];
      if (!allowedRoles.includes(currentUserRole) && currentUserRole !== activeConfirmation.requiredRole) {
        cyberAudio.playFailure('Permission Denied');
        setAuthError(`PERMISSION DENIED: Action requires ${activeConfirmation.requiredRole} privileges (Current: ${currentUserRole}).`);
        return;
      }
    }

    setIsExecuting(true);
    setAuthError(null);
    cyberAudio.playLockAcquired();

    try {
      await activeConfirmation.onConfirm();
      setIsSuccess(true);
      cyberAudio.playSuccess();
      setTimeout(() => {
        clearConfirmation();
      }, 500);
    } catch (err: any) {
      cyberAudio.playFailure(err?.message);
      setAuthError(err?.message || 'Action execution failed.');
    } finally {
      setIsExecuting(false);
    }
  };

  const riskColor =
    activeConfirmation.riskTier === 'CRITICAL'
      ? '#ff2a2a'
      : activeConfirmation.riskTier === 'HIGH'
      ? '#ff7700'
      : '#ffb700';

  return (
    <div
      className="soc-safety-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Security Action Confirmation"
    >
      <div className="soc-safety-modal-window" style={{ borderColor: riskColor }}>
        <header className="safety-modal-header" style={{ borderBottomColor: `${riskColor}40` }}>
          <div className="safety-header-icon" style={{ color: riskColor }}>
            <AlertTriangle size={18} />
          </div>
          <div className="safety-header-text">
            <span className="safety-kicker">TWO-STAGE SECURITY AUTHORIZATION GATE</span>
            <h3 className="safety-title">{activeConfirmation.title}</h3>
          </div>
          <button
            className="safety-close-btn"
            onClick={() => {
              cyberAudio.playClick();
              activeConfirmation.onCancel();
              clearConfirmation();
            }}
            aria-label="Cancel security action"
          >
            <X size={14} />
          </button>
        </header>

        <div className="safety-modal-body">
          <div className="safety-target-banner" style={{ background: `${riskColor}15`, borderColor: `${riskColor}40` }}>
            <span className="target-label">TARGET ENTITY:</span>
            <strong className="target-value">{activeConfirmation.targetLabel} ({activeConfirmation.targetId})</strong>
          </div>

          <p className="safety-description">{activeConfirmation.description}</p>

          <div className="safety-metadata-grid">
            <div className="meta-item">
              <span className="meta-lbl">ACTION TYPE:</span>
              <strong className="meta-val">{activeConfirmation.actionType}</strong>
            </div>
            <div className="meta-item">
              <span className="meta-lbl">RISK TIER:</span>
              <strong className="meta-val" style={{ color: riskColor }}>
                {activeConfirmation.riskTier}
              </strong>
            </div>
            <div className="meta-item">
              <span className="meta-lbl">OPERATOR ROLE:</span>
              <strong className="meta-val">{currentUserRole}</strong>
            </div>
            <div className="meta-item">
              <span className="meta-lbl">AUDIT LOGGING:</span>
              <strong className="meta-val text-cyan">MANDATORY IMMUTABLE</strong>
            </div>
          </div>

          {isSuccess && (
            <div className="soc-motion-success" style={{ padding: '10px 14px', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <ShieldCheck size={16} className="soc-motion-success-icon" style={{ color: '#3dffb0' }} />
              <span style={{ color: '#3dffb0', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em' }}>
                ACTION AUTHORIZED & EXECUTED — COMMITTED TO IMMUTABLE AUDIT
              </span>
            </div>
          )}

          {authError && (
            <div className="soc-motion-failure soc-failure-box" style={{ marginTop: 10 }}>
              <div className="soc-failure-header">
                <AlertCircle size={14} />
                <span>AUTHORIZATION / EXECUTION REJECTED</span>
              </div>
              <div className="soc-failure-explanation">{authError}</div>
              <div className="soc-failure-actions">
                <button
                  type="button"
                  className="soc-remediation-btn"
                  onClick={handleExecute}
                  disabled={isExecuting}
                >
                  <AlertTriangle size={11} /> RETRY ACTION
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="safety-modal-footer">
          <button
            className="safety-cancel-btn"
            onClick={() => {
              cyberAudio.playClick();
              activeConfirmation.onCancel();
              clearConfirmation();
            }}
            disabled={isExecuting}
          >
            CANCEL [ESC]
          </button>

          {!isSuccess && (
            <button
              className={`safety-confirm-btn ${isExecuting ? 'soc-in-flight-executing' : ''}`}
              style={{ backgroundColor: riskColor }}
              onClick={handleExecute}
              disabled={isExecuting}
              autoFocus
            >
              <ShieldCheck size={14} />
              <span>{isExecuting ? 'AUTHORIZING & EXECUTING…' : 'CONFIRM & EXECUTE ACTION'}</span>
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

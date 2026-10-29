/**
 * ResponseSpace.tsx
 *
 * Operational SOC Response Surface for EXPLAIN-SEC SPATIAL.
 * EXPLAIN-SEC SPATIAL — STEP 9: EVIDENCE + RBAC + RESPONSE UX.
 *
 * Architecture:
 * - Flow: INCIDENT -> RESPONSE -> AVAILABLE ACTIONS
 * - Actions: Isolate endpoint, Disable account, Block IP, Block domain, Kill process, Collect evidence, Execute playbook
 * - Sensitive operations expose:
 *     - RBAC (visible permissions, explicit disabled reasons)
 *     - Approval (request, approve, reject workflow)
 *     - Dry run (safe pre-flight simulation)
 *     - Execution state (PENDING -> EXECUTING -> SUCCESS | FAILED | DENIED)
 *     - Rollback where supported (deterministic inverse compensation)
 *     - Audit (immutable ledger records)
 * - Animation: Do not show SUCCESS before actual success. Visual state matches actual operation state.
 */

'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Zap,
  Activity,
  GitBranch,
  FileText,
  User,
  Plus,
  AlertOctagon,
  RefreshCw,
  BookOpen,
  History,
  Lock,
  Sparkles,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import type { ResponseAction, ResponseActionType } from '../../core/models/response';
import type { UserSession, RoleId } from '../../core/models/auth';
import type { IncidentDetail } from '../../core/models/incident';
import {
  canRequestContainment,
  canApproveContainment,
  canExecuteSOAR,
} from '../../core/auth/rbac';
import { securityService } from '../../core/security-service';
import ResponseActionNode from './ResponseActionNode';
import ResponseConfirmation from './ResponseConfirmation';
import type { OperationLifecycleState } from './ResponseConfirmation';
import PlaybookCanvas from './PlaybookCanvas';
import PlaybookLibraryView from './PlaybookLibraryView';
import ExecutionHistoryView from './ExecutionHistoryView';
import ResponseAuditStream from './ResponseAuditStream';
import RbacBanner from '../components/RbacBanner';
import { cyberAudio } from '../../cyber-audio';
import { useInvestigation } from '../investigation/InvestigationContext';
import './response.css';

type ResponseSubView = 'DECK' | 'PLAYBOOK' | 'LIBRARY' | 'HISTORY' | 'AUDIT';

interface ResponseSpaceProps {
  incidentId: string;
  onSelectEntity?: (entity: { id: string; type: string }) => void;
}

export default function ResponseSpace({
  incidentId,
  onSelectEntity,
}: ResponseSpaceProps) {
  const { selectedEntity } = useInvestigation();
  const [subView, setSubView] = useState<ResponseSubView>('DECK');
  const [session, setSession] = useState<UserSession | null>(() =>
    securityService.getSession()
  );
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [actions, setActions] = useState<ResponseAction[]>([]);
  const [confirmingAction, setConfirmingAction] = useState<ResponseAction | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [operationState, setOperationState] = useState<OperationLifecycleState>('PENDING');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  // Load canonical data
  const loadData = useCallback(async () => {
    try {
      const inc = await securityService.getIncidentById(incidentId);
      const acts = await securityService.getResponseActions(incidentId);
      setIncident(inc);
      setActions(acts);
    } catch (err) {
      console.error('[ResponseSpace] Error loading data:', err);
    }
  }, [incidentId]);

  useEffect(() => {
    void loadData();

    // Subscribe to canonical security mutations
    const unsubActions = securityService.subscribe('RESPONSE_ACTION_UPDATED', () => {
      void loadData();
    });
    const unsubIncident = securityService.subscribe('INCIDENT_DETAIL_UPDATED', () => {
      void loadData();
    });
    const unsubSession = securityService.subscribe('SESSION_CHANGED', () => {
      setSession(securityService.getSession());
    });

    return () => {
      unsubActions();
      unsubIncident();
      unsubSession();
    };
  }, [loadData]);

  // Role Switcher handler for deterministic RBAC demonstration
  const handleRoleChange = async (username: string) => {
    cyberAudio.playClick();
    try {
      const newSession = await securityService.login({ username });
      setSession(newSession);
      setStatusFeedback(`Switched to ${newSession.displayName} [${newSession.role}]`);
      setTimeout(() => setStatusFeedback(null), 3000);
    } catch (err: any) {
      setStatusFeedback(err?.message ?? 'Failed to switch role');
    }
  };

  const currentRole: RoleId = session?.role ?? 'L1_ANALYST';
  const userCanRequest = canRequestContainment(currentRole);
  const userCanApprove = canApproveContainment(currentRole);
  const userCanExecute = canExecuteSOAR(currentRole);

  // Action requests
  const handleRequestApproval = async (action: ResponseAction) => {
    if (!userCanRequest) {
      setStatusFeedback(`LOCKED: Requires Analyst role to request approval`);
      return;
    }
    cyberAudio.playSelect();
    try {
      await securityService.requestResponseAction({
        type: action.type,
        targetId: action.targetId,
        targetType: action.targetType,
        targetLabel: action.targetLabel,
        incidentId: action.incidentId,
        riskImpact: action.riskImpact,
        reversibility: action.reversibility,
        consequence: action.consequence,
      });
      setStatusFeedback(`Approval requested for ${action.type}`);
    } catch (err: any) {
      setStatusFeedback(err?.message ?? 'Request failed');
    }
  };

  // Approve action
  const handleApprove = async (action: ResponseAction) => {
    if (!userCanApprove) {
      setStatusFeedback(`LOCKED: Requires Manager role to approve`);
      return;
    }
    cyberAudio.playClick();
    try {
      await securityService.approveResponseAction(action.id);
      setStatusFeedback(`Approved ${action.targetLabel} containment`);
    } catch (err: any) {
      setStatusFeedback(err?.message ?? 'Approval failed');
    }
  };

  // Reject action
  const handleReject = async (action: ResponseAction) => {
    if (!userCanApprove) {
      setStatusFeedback(`LOCKED: Requires Manager role to reject`);
      return;
    }
    cyberAudio.playClick();
    try {
      await securityService.rejectResponseAction(action.id, 'Disapproved by SOC manager');
      setStatusFeedback(`Rejected ${action.targetLabel} containment`);
    } catch (err: any) {
      setStatusFeedback(err?.message ?? 'Rejection failed');
    }
  };

  // Execute Action (via confirmation modal)
  const handleInitiateExecution = (action: ResponseAction) => {
    cyberAudio.playSelect();
    setConfirmingAction(action);
    setOperationState('PENDING');
    setErrorMessage(null);
  };

  const handleConfirmExecution = async (isDryRun: boolean) => {
    if (!confirmingAction) return;

    // Strict state progression: PENDING -> EXECUTING
    setIsExecuting(true);
    setOperationState('EXECUTING');
    setErrorMessage(null);

    try {
      if (isDryRun) {
        // Pre-flight dry run simulation
        const result = await securityService.dryRunResponseAction(confirmingAction.id);
        // Only set SUCCESS after promise resolves
        setOperationState('SUCCESS');
        cyberAudio.playSuccess?.();
        setStatusFeedback(result.expectedStateChange);
        setTimeout(() => {
          setConfirmingAction(null);
          setIsExecuting(false);
          setOperationState('PENDING');
        }, 1800);
      } else {
        // Authoritative production mutation
        await securityService.executeResponseAction(confirmingAction.id);
        // Only set SUCCESS after backend confirmation
        setOperationState('SUCCESS');
        cyberAudio.playSuccess?.();
        setStatusFeedback(`Successfully executed ${confirmingAction.type} on ${confirmingAction.targetLabel}`);
        setTimeout(() => {
          setConfirmingAction(null);
          setIsExecuting(false);
          setOperationState('PENDING');
          void loadData();
        }, 1500);
      }
    } catch (err: any) {
      const isAuthError = err?.message?.toLowerCase().includes('unauthorized') || err?.message?.toLowerCase().includes('permission');
      setOperationState(isAuthError ? 'DENIED' : 'FAILED');
      setErrorMessage(err?.message ?? 'Execution failed');
      setIsExecuting(false);
    }
  };

  // Direct Dry-Run Trigger on Action Node
  const handleDryRunAction = async (action: ResponseAction) => {
    cyberAudio.playSelect();
    setStatusFeedback(`[DRY RUN] Simulating ${action.type}...`);
    try {
      const res = await securityService.dryRunResponseAction(action.id);
      cyberAudio.playSuccess?.();
      setStatusFeedback(res.expectedStateChange);
    } catch (err: any) {
      setStatusFeedback(`[DRY RUN ERROR] ${err?.message ?? 'Simulation failed'}`);
    }
  };

  // Rollback Action Handler
  const handleRollbackAction = async (action: ResponseAction) => {
    if (!userCanExecute) {
      setStatusFeedback(`LOCKED: Requires Responder role to perform rollback`);
      return;
    }
    cyberAudio.playClick();
    try {
      await securityService.rollbackResponseAction(action.id);
      cyberAudio.playSuccess?.();
      setStatusFeedback(`Rollback complete: Reverted ${action.type} on ${action.targetLabel}`);
      void loadData();
    } catch (err: any) {
      setStatusFeedback(`Rollback failed: ${err?.message ?? 'Error'}`);
    }
  };

  // Quick Action Creator
  const handleQuickAddAction = async (
    type: ResponseActionType,
    targetLabel: string,
    targetId: string,
    targetType: any,
    consequence?: string
  ) => {
    cyberAudio.playClick();
    try {
      await securityService.requestResponseAction({
        type,
        targetId,
        targetType,
        targetLabel,
        incidentId,
        riskImpact: type === 'QUARANTINE_ASSET' || type === 'ISOLATE_ASSET' || type === 'KILL_PROCESS' ? 'HIGH' : 'MEDIUM',
        reversibility: type === 'KILL_PROCESS' || type === 'COLLECT_EVIDENCE' ? 'IRREVERSIBLE' : 'FULL',
        consequence,
      });
      setStatusFeedback(`Action ${type} queued for authorization.`);
    } catch (err: any) {
      setStatusFeedback(err?.message ?? 'Action creation failed');
    }
  };

  // Blast radius counts
  const isolatedAssetsCount = incident?.assets.filter((a) => a.status === 'ISOLATED').length ?? 0;
  const blockedIocsCount = incident?.iocDetails.filter((i) => i.isBlocked).length ?? 0;

  return (
    <div className="resp-space" role="region" aria-label="Response Space">
      {/* ── Top Header Strip: Incident Context ── */}
      <div className="resp-header">
        <div className="resp-header-left">
          <span className="resp-pill-id">{incidentId.toUpperCase()}</span>
          {incident && (
            <span className={`resp-badge-sev sev-${incident.severity.toLowerCase()}`}>
              {incident.severity}
            </span>
          )}
          <span className="resp-mode-title">RESPONSE & SOAR CONTROL SURFACE</span>
        </div>

        {/* Center: RBAC Context Banner */}
        <div style={{ flex: 1, maxWidth: 580, margin: '0 8px' }}>
          <RbacBanner session={session} onRoleChange={handleRoleChange} compact={true} />
        </div>

        <div className="resp-header-right">
          {/* Status Feedback Toast */}
          {statusFeedback && (
            <span style={{ fontSize: 10, color: '#3dffb0', background: 'rgba(61,255,176,0.1)', padding: '3px 8px', borderRadius: 4 }}>
              {statusFeedback}
            </span>
          )}

          <button
            className="resp-btn"
            onClick={loadData}
            title="Refresh Canonical State"
            aria-label="Refresh Canonical State"
            style={{ padding: '4px 8px' }}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="resp-nav-strip">
        <button
          className={`resp-tab-btn ${subView === 'DECK' ? 'active' : ''}`}
          onClick={() => { cyberAudio.playClick(); setSubView('DECK'); }}
        >
          <Activity size={12} /> COMMAND DECK
        </button>

        <button
          className={`resp-tab-btn ${subView === 'PLAYBOOK' ? 'active' : ''}`}
          onClick={() => { cyberAudio.playClick(); setSubView('PLAYBOOK'); }}
        >
          <GitBranch size={12} /> SOAR CANVAS
        </button>

        <button
          className={`resp-tab-btn ${subView === 'LIBRARY' ? 'active' : ''}`}
          onClick={() => { cyberAudio.playClick(); setSubView('LIBRARY'); }}
        >
          <BookOpen size={12} /> PLAYBOOK LIBRARY
        </button>

        <button
          className={`resp-tab-btn ${subView === 'HISTORY' ? 'active' : ''}`}
          onClick={() => { cyberAudio.playClick(); setSubView('HISTORY'); }}
        >
          <History size={12} /> EXECUTION HISTORY
        </button>

        <button
          className={`resp-tab-btn ${subView === 'AUDIT' ? 'active' : ''}`}
          onClick={() => { cyberAudio.playClick(); setSubView('AUDIT'); }}
        >
          <FileText size={12} /> AUDIT LOG
        </button>
      </div>

      {/* ── Content Area ── */}
      <div className="resp-content-area">
        {subView === 'DECK' && (
          <div className="resp-deck-layout">
            {/* Left: Action Feed */}
            <div className="resp-action-feed">
              <div className="resp-section-heading">
                <span>AVAILABLE & ACTIVE RESPONSE ACTIONS ({actions.length})</span>
                <span style={{ fontSize: 10, color: '#64748b' }}>
                  ACTIVE ROLE: {currentRole}
                </span>
              </div>

              {actions.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                  No response actions initiated yet. Use rapid response injectors to queue actions.
                </div>
              ) : (
                actions.map((act) => (
                  <ResponseActionNode
                    key={act.id}
                    action={act}
                    currentRole={currentRole}
                    onRequestApproval={handleRequestApproval}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onInitiateExecution={handleInitiateExecution}
                    onDryRun={handleDryRunAction}
                    onRollback={handleRollbackAction}
                    onSelectEntity={onSelectEntity}
                    isExecuting={isExecuting && confirmingAction?.id === act.id}
                  />
                ))
              )}
            </div>

            {/* Right: 7 Canonical SOAR Available Actions & Telemetry */}
            <div className="resp-sidebar">
              {/* Quick Action Injectors */}
              <div className="resp-side-panel">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#00f0ff', marginBottom: 8, letterSpacing: '0.06em' }}>
                  SOAR AVAILABLE RESPONSE ACTIONS
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* 1. Isolate endpoint */}
                  {incident?.affectedAssets.map((assetId) => {
                    const asset = incident.assets.find((a) => a.id === assetId);
                    const isIsolated = asset?.status === 'ISOLATED';
                    return (
                      <button
                        key={`isolate-${assetId}`}
                        className="resp-btn"
                        style={{
                          justifyContent: 'space-between',
                          background: isIsolated ? 'rgba(61,255,176,0.1)' : 'rgba(255,42,42,0.1)',
                          border: `1px solid ${isIsolated ? '#3dffb050' : '#ff2a2a50'}`,
                          color: isIsolated ? '#3dffb0' : '#ff9999',
                        }}
                        onClick={() =>
                          handleQuickAddAction(
                            'ISOLATE_ASSET',
                            asset?.name ?? assetId,
                            assetId,
                            'ASSET',
                            `Disconnects host ${asset?.name ?? assetId} from production VLANs.`
                          )
                        }
                      >
                        <span>ISOLATE ENDPOINT ({asset?.name ?? assetId})</span>
                        <span style={{ fontSize: 9 }}>{asset?.status ?? 'ONLINE'}</span>
                      </button>
                    );
                  })}

                  {/* 2. Disable account */}
                  <button
                    className="resp-btn"
                    style={{
                      justifyContent: 'space-between',
                      background: 'rgba(255,183,0,0.1)',
                      border: '1px solid rgba(255,183,0,0.3)',
                      color: '#ffb700',
                    }}
                    onClick={() =>
                      handleQuickAddAction(
                        'DISABLE_ACCOUNT',
                        'usr-jdoe (Compromised Credential)',
                        'usr-jdoe',
                        'USER',
                        'Suspends Active Directory account and invalidates Kerberos tickets.'
                      )
                    }
                  >
                    <span>DISABLE ACCOUNT (usr-jdoe)</span>
                    <span style={{ fontSize: 9 }}>IDENTITY</span>
                  </button>

                  {/* 3. Block IP */}
                  {incident?.iocDetails.filter((i) => i.type === 'IP').slice(0, 1).map((ioc) => (
                    <button
                      key={`block-ip-${ioc.id}`}
                      className="resp-btn"
                      style={{
                        justifyContent: 'space-between',
                        background: ioc.isBlocked ? 'rgba(61,255,176,0.1)' : 'rgba(255,107,53,0.1)',
                        border: `1px solid ${ioc.isBlocked ? '#3dffb050' : '#ff6b3550'}`,
                        color: ioc.isBlocked ? '#3dffb0' : '#ffaa88',
                      }}
                      onClick={() =>
                        handleQuickAddAction('BLOCK_IOC', ioc.value, ioc.id, 'IOC', `Injects perimeter drop rule for ${ioc.value}.`)
                      }
                    >
                      <span>BLOCK IP ({ioc.value})</span>
                      <span style={{ fontSize: 9 }}>{ioc.isBlocked ? 'BLOCKED' : 'ACTIVE'}</span>
                    </button>
                  ))}

                  {/* 4. Block domain */}
                  {incident?.iocDetails.filter((i) => i.type === 'DOMAIN').slice(0, 1).map((ioc) => (
                    <button
                      key={`block-dom-${ioc.id}`}
                      className="resp-btn"
                      style={{
                        justifyContent: 'space-between',
                        background: ioc.isBlocked ? 'rgba(61,255,176,0.1)' : 'rgba(255,107,53,0.1)',
                        border: `1px solid ${ioc.isBlocked ? '#3dffb050' : '#ff6b3550'}`,
                        color: ioc.isBlocked ? '#3dffb0' : '#ffaa88',
                      }}
                      onClick={() =>
                        handleQuickAddAction('BLOCK_DOMAIN', ioc.value, ioc.id, 'IOC', `Applies DNS sinkhole rule for ${ioc.value}.`)
                      }
                    >
                      <span>BLOCK DOMAIN ({ioc.value})</span>
                      <span style={{ fontSize: 9 }}>{ioc.isBlocked ? 'BLOCKED' : 'ACTIVE'}</span>
                    </button>
                  ))}

                  {/* 5. Kill process */}
                  <button
                    className="resp-btn"
                    style={{
                      justifyContent: 'space-between',
                      background: 'rgba(255,42,42,0.1)',
                      border: '1px solid rgba(255,42,42,0.3)',
                      color: '#ff7777',
                    }}
                    onClick={() =>
                      handleQuickAddAction(
                        'KILL_PROCESS',
                        'mimikatz.exe [PID 4820]',
                        'proc-mimikatz-4820',
                        'ASSET',
                        'Sends SIGKILL to malicious process tree on target host.'
                      )
                    }
                  >
                    <span>KILL PROCESS (mimikatz.exe)</span>
                    <span style={{ fontSize: 9, color: '#ff4444' }}>IRREVERSIBLE</span>
                  </button>

                  {/* 6. Collect evidence */}
                  <button
                    className="resp-btn"
                    style={{
                      justifyContent: 'space-between',
                      background: 'rgba(61,255,176,0.1)',
                      border: '1px solid rgba(61,255,176,0.3)',
                      color: '#3dffb0',
                    }}
                    onClick={() =>
                      handleQuickAddAction(
                        'COLLECT_EVIDENCE',
                        `Volatile Memory Dump (${incidentId})`,
                        incidentId,
                        'INCIDENT',
                        'Acquires SHA-256 sealed memory and network packet capture.'
                      )
                    }
                  >
                    <span>COLLECT EVIDENCE SNAPSHOT</span>
                    <span style={{ fontSize: 9 }}>FORENSICS</span>
                  </button>

                  {/* 7. Execute playbook */}
                  <button
                    className="resp-btn"
                    style={{
                      justifyContent: 'space-between',
                      background: 'rgba(167,139,250,0.15)',
                      border: '1px solid rgba(167,139,250,0.4)',
                      color: '#a78bfa',
                    }}
                    onClick={() => setSubView('PLAYBOOK')}
                  >
                    <span>EXECUTE PLAYBOOK</span>
                    <span style={{ fontSize: 9 }}>SOAR CANVAS</span>
                  </button>
                </div>
              </div>

              {/* Blast Radius Live Counters */}
              <div className="resp-side-panel">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em' }}>
                  CONTAINMENT TELEMETRY
                </div>
                <div className="resp-stat-grid">
                  <div className="resp-stat-box">
                    <span className="resp-stat-num" style={{ color: '#3dffb0' }}>
                      {isolatedAssetsCount}
                    </span>
                    <span className="resp-stat-title">QUARANTINED ASSETS</span>
                  </div>

                  <div className="resp-stat-box">
                    <span className="resp-stat-num" style={{ color: '#00f0ff' }}>
                      {blockedIocsCount}
                    </span>
                    <span className="resp-stat-title">BLOCKED IOCs</span>
                  </div>

                  <div className="resp-stat-box">
                    <span className="resp-stat-num">
                      {incident?.status ?? '—'}
                    </span>
                    <span className="resp-stat-title">INCIDENT LIFECYCLE</span>
                  </div>

                  <div className="resp-stat-box">
                    <span className="resp-stat-num" style={{ color: '#a78bfa' }}>
                      {actions.filter((a) => a.status === 'COMPLETED' || a.status === 'EXECUTED').length} / {actions.length}
                    </span>
                    <span className="resp-stat-title">ACTIONS COMPLETED</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {subView === 'PLAYBOOK' && session && (
          <PlaybookCanvas
            incidentId={incidentId}
            session={session}
            onRefreshData={loadData}
          />
        )}

        {subView === 'LIBRARY' && (
          <PlaybookLibraryView
            session={session}
            incidentId={incidentId}
            onExecutePlaybook={(_pbId) => setSubView('PLAYBOOK')}
          />
        )}

        {subView === 'HISTORY' && (
          <ExecutionHistoryView
            session={session}
            incidentId={incidentId}
          />
        )}

        {subView === 'AUDIT' && (
          <ResponseAuditStream incidentId={incidentId} />
        )}
      </div>

      {/* ── High-Impact Confirmation Modal ── */}
      {confirmingAction && (
        <ResponseConfirmation
          action={confirmingAction}
          isExecuting={isExecuting}
          operationState={operationState}
          errorMessage={errorMessage}
          onConfirm={handleConfirmExecution}
          onCancel={() => {
            setConfirmingAction(null);
            setOperationState('PENDING');
            setErrorMessage(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * CaseWorkspace.tsx
 *
 * EXPLAIN-SEC SPATIAL — Step 6 Spatial Case Management Operating Environment.
 *
 * Operational container sitting above Incidents and Threat Hunts.
 * 5-zone spatial HUD:
 *   - TOP: Case selector, metadata, severity/priority/status badges, action triggers
 *   - LEFT: Canonical context (linked incidents, hunts, alerts, assets, users, IOCs)
 *   - CENTER: Investigation findings with provenance & spatial relationship hierarchy
 *   - RIGHT: Operations (status transitions, owner assignment, task checklist)
 *   - BOTTOM: Activity timeline & analyst collaboration notes
 *
 * 100% offline, zero fetch(), powered by SecurityService and IndexedDB.
 */

'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { PerformanceMode } from '../performance-mode';
import type {
  Case,
  CaseNote,
  CaseTask,
  CaseFinding,
  CaseStatus,
  CasePriority,
  CaseSeverity,
} from '../../core/models/case';
import type { Evidence } from '../../core/models/evidence';
import type { Incident } from '../../core/models/incident';
import type { ThreatHunt } from '../../core/models/hunting';
import type { Alert } from '../../core/models/detection';
import type { Asset, SecurityUser, IOC } from '../../core/models/entity';
import type { AuditRecord } from '../../core/models/audit';
import { securityService } from '../../core/security-service';
import { ThreatIntelProfile } from '../intel/ThreatIntelProfile';
import { cyberAudio } from '../../cyber-audio';
import {
  ArrowLeft,
  Briefcase,
  FolderPlus,
  Shield,
  AlertTriangle,
  Clock,
  User,
  Users,
  CheckCircle2,
  Circle,
  XCircle,
  Play,
  RotateCcw,
  Check,
  X,
  ExternalLink,
  Crosshair,
  FileText,
  FileCheck,
  GitPullRequest,
  Plus,
  Send,
  HelpCircle,
  Layers,
  Server,
  Terminal,
} from 'lucide-react';
import './case-workspace.css';

interface CaseWorkspaceProps {
  perfMode: PerformanceMode;
  onClose: () => void;
  onInvestigateIncident?: (incidentId: string) => void;
  onOpenThreatHunt?: () => void;
  onOpenEvidence?: (caseId?: string) => void;
}

const AVAILABLE_OWNERS = [
  { id: 'analyst1', name: 'Alex Romero (L1)' },
  { id: 'analyst2', name: 'Sam Okafor (L2)' },
  { id: 'responder', name: 'Jo Blackwood (Responder)' },
  { id: 'hunter', name: 'Morgan Vance (Hunter)' },
  { id: 'manager', name: 'Taylor Singh (Manager)' },
];

export default function CaseWorkspace({
  perfMode,
  onClose,
  onInvestigateIncident,
  onOpenThreatHunt,
  onOpenEvidence,
}: CaseWorkspaceProps) {
  // Case collection state
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('case-blacktide-001');

  // Resolved context state for active case
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [hunts, setHunts] = useState<ThreatHunt[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<SecurityUser[]>([]);
  const [iocs, setIocs] = useState<IOC[]>([]);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [findings, setFindings] = useState<CaseFinding[]>([]);
  const [activity, setActivity] = useState<AuditRecord[]>([]);
  const [caseEvidence, setCaseEvidence] = useState<Evidence[]>([]);
  const [selectedIntelIocId, setSelectedIntelIocId] = useState<string | null>(null);

  // UI view state
  const [centerTab, setCenterTab] = useState<'FINDINGS' | 'EVIDENCE' | 'RELATIONSHIPS'>('FINDINGS');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCaseDesc, setNewCaseDesc] = useState('');
  const [newCasePriority, setNewCasePriority] = useState<CasePriority>('HIGH');
  const [newCaseSeverity, setNewCaseSeverity] = useState<CaseSeverity>('HIGH');

  const [showFindingModal, setShowFindingModal] = useState(false);
  const [newFindingTitle, setNewFindingTitle] = useState('');
  const [newFindingDesc, setNewFindingDesc] = useState('');
  const [newFindingSeverity, setNewFindingSeverity] = useState<CaseSeverity>('HIGH');

  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState('');

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closureReason, setClosureReason] = useState('');

  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Active Case object
  const activeCase = useMemo(() => {
    return cases.find((c) => c.id === selectedCaseId || c.caseNumber === selectedCaseId) ?? cases[0] ?? null;
  }, [cases, selectedCaseId]);

  const activeCaseId = activeCase?.id ?? null;
  const activeCaseIdRef = useRef<string | null>(activeCaseId);
  useEffect(() => {
    activeCaseIdRef.current = activeCaseId;
  }, [activeCaseId]);

  // Load all cases stably
  const loadCases = useCallback(async () => {
    try {
      const allCases = await securityService.getCases();
      setCases(allCases);
      setSelectedCaseId((prev) => prev || (allCases[0]?.id ?? ''));
    } catch (err) {
      console.error('Failed to load cases', err);
    }
  }, []);

  // Load active case details by stable case ID
  const loadCaseDetails = useCallback(async (caseId: string) => {
    if (!caseId) return;
    try {
      const [
        loadedNotes,
        loadedTasks,
        loadedFindings,
        loadedActivity,
        caseInc,
        caseHunts,
        caseAlerts,
        caseAssets,
        caseUsers,
        caseIocs,
        caseEvd,
      ] = await Promise.all([
        securityService.getCaseNotes(caseId),
        securityService.getCaseTasks(caseId),
        securityService.getCaseFindings(caseId),
        securityService.getCaseActivity(caseId),
        securityService.getCaseIncidents(caseId),
        securityService.getCaseHunts(caseId),
        securityService.getCaseAlerts(caseId),
        securityService.getCaseAssets(caseId),
        securityService.getCaseUsers(caseId),
        securityService.getCaseIOCs(caseId),
        securityService.getEvidenceForCase(caseId),
      ]);

      setNotes(loadedNotes);
      setTasks(loadedTasks);
      setFindings(loadedFindings);
      setActivity(loadedActivity);
      setIncidents(caseInc);
      setHunts(caseHunts);
      setAlerts(caseAlerts);
      setAssets(caseAssets);
      setUsers(caseUsers);
      setIocs(caseIocs);
      setCaseEvidence(caseEvd);
    } catch (err) {
      console.error('Failed to load case details', err);
    }
  }, []);

  // Stable reactive event subscriptions: attached once on mount
  useEffect(() => {
    void loadCases();

    const reloadActiveCase = () => {
      if (activeCaseIdRef.current) {
        void loadCaseDetails(activeCaseIdRef.current);
      }
    };

    const unsubCases = securityService.subscribe('CASES_UPDATED', () => {
      void loadCases();
      reloadActiveCase();
    });
    const unsubAudit = securityService.subscribe('AUDIT_APPENDED', reloadActiveCase);
    const unsubEvd1 = securityService.subscribe('EVIDENCE_COLLECTED', reloadActiveCase);
    const unsubEvd2 = securityService.subscribe('EVIDENCE_UPDATED', reloadActiveCase);
    const unsubEvd3 = securityService.subscribe('EVIDENCE_VERIFIED', reloadActiveCase);

    return () => {
      unsubCases();
      unsubAudit();
      unsubEvd1();
      unsubEvd2();
      unsubEvd3();
    };
  }, [loadCases, loadCaseDetails]);

  // Load case details whenever the activeCase.id changes
  useEffect(() => {
    if (activeCaseId) {
      void loadCaseDetails(activeCaseId);
    }
  }, [activeCaseId, loadCaseDetails]);

  // Hierarchical Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        // Level 1: Close active threat intel modal
        if (selectedIntelIocId) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          cyberAudio.playClick();
          setSelectedIntelIocId(null);
          return;
        }

        // Level 2: Close open action modals
        if (showCreateModal || showFindingModal || showResolveModal || showCloseModal) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          cyberAudio.playClick();
          setShowCreateModal(false);
          setShowFindingModal(false);
          setShowResolveModal(false);
          setShowCloseModal(false);
          return;
        }

        // Level 3: Return to Hub
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cyberAudio.playClick();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    selectedIntelIocId,
    showCreateModal,
    showFindingModal,
    showResolveModal,
    showCloseModal,
    onClose,
  ]);

  const showToast = (msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => setStatusNotice(null), 3500);
  };

  // ─── Actions ───────────────────────────────────────────────────────────────

  const handleCreateCase = async () => {
    if (!newCaseTitle.trim()) return;
    try {
      cyberAudio.playClick();
      const created = await securityService.createCase({
        title: newCaseTitle,
        description: newCaseDesc,
        priority: newCasePriority,
        severity: newCaseSeverity,
      });
      setShowCreateModal(false);
      setNewCaseTitle('');
      setNewCaseDesc('');
      setSelectedCaseId(created.id);
      showToast(`Case ${created.caseNumber} initialized`);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleTransitionStatus = async (newStatus: CaseStatus) => {
    if (!activeCase) return;
    if (newStatus === 'RESOLVED') {
      setShowResolveModal(true);
      return;
    }
    if (newStatus === 'CLOSED') {
      setShowCloseModal(true);
      return;
    }
    try {
      cyberAudio.playSelect();
      await securityService.changeCaseStatus(activeCase.id, newStatus);
      showToast(`Status updated: ${newStatus}`);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleConfirmResolve = async () => {
    if (!activeCase) return;
    try {
      cyberAudio.playLockAcquired();
      await securityService.resolveCase(activeCase.id, resolutionSummary || 'Investigation concluded and remediated');
      setShowResolveModal(false);
      setResolutionSummary('');
      showToast(`Case ${activeCase.caseNumber} resolved`);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleConfirmClose = async () => {
    if (!activeCase) return;
    try {
      cyberAudio.playClick();
      await securityService.closeCase(activeCase.id, closureReason || 'Case closed after remediation');
      setShowCloseModal(false);
      setClosureReason('');
      showToast(`Case ${activeCase.caseNumber} closed`);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleReopen = async () => {
    if (!activeCase) return;
    try {
      cyberAudio.playSelect();
      await securityService.reopenCase(activeCase.id, 'Analyst requested case reopen');
      showToast(`Case ${activeCase.caseNumber} reopened`);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleOwnerChange = async (ownerId: string) => {
    if (!activeCase) return;
    try {
      cyberAudio.playClick();
      await securityService.assignCase(activeCase.id, ownerId);
      showToast(`Case assigned to ${ownerId}`);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handlePriorityChange = async (p: CasePriority) => {
    if (!activeCase) return;
    try {
      cyberAudio.playClick();
      await securityService.changeCasePriority(activeCase.id, p);
      showToast(`Priority adjusted: ${p}`);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleToggleTask = async (task: CaseTask) => {
    if (!activeCase) return;
    try {
      cyberAudio.playClick();
      const nextStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
      await securityService.updateCaseTask(activeCase.id, task.id, { status: nextStatus });
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleAddTask = async () => {
    if (!activeCase || !newTaskTitle.trim()) return;
    try {
      cyberAudio.playClick();
      await securityService.addCaseTask(activeCase.id, {
        title: newTaskTitle.trim(),
        priority: activeCase.priority,
      });
      setNewTaskTitle('');
      showToast('Task added');
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handlePostNote = async () => {
    if (!activeCase || !newNoteContent.trim()) return;
    try {
      cyberAudio.playClick();
      await securityService.addCaseNote(activeCase.id, {
        content: newNoteContent.trim(),
      });
      setNewNoteContent('');
      showToast('Analyst note saved');
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleAddFinding = async () => {
    if (!activeCase || !newFindingTitle.trim()) return;
    try {
      cyberAudio.playLockAcquired();
      await securityService.addCaseFinding(activeCase.id, {
        title: newFindingTitle.trim(),
        description: newFindingDesc.trim(),
        severity: newFindingSeverity,
        relatedIncidentIds: activeCase.incidentIds.slice(0, 1),
      });
      setShowFindingModal(false);
      setNewFindingTitle('');
      setNewFindingDesc('');
      showToast('Finding documented');
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  return (
    <div className="case-workspace">
      {/* Toast Notification */}
      {statusNotice && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            background: 'rgba(0, 240, 255, 0.15)',
            backdropFilter: 'blur(12px)',
            border: '1px solid #00f0ff',
            color: '#ffffff',
            padding: '6px 16px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            boxShadow: '0 0 16px rgba(0, 240, 255, 0.4)',
          }}
        >
          {statusNotice}
        </div>
      )}

      {/* ─── TOP BAR ──────────────────────────────────────────────────────── */}
      <div className="case-top-bar">
        <div className="case-top-left">
          <button
            className="case-back-btn"
            onClick={() => {
              cyberAudio.playClick();
              onClose();
            }}
            title="Return to Spatial Command Hub (Esc)"
          >
            <ArrowLeft size={13} />
            <span>HUB</span>
          </button>

          <Briefcase size={16} color="#00f0ff" style={{ flexShrink: 0 }} />

          {/* Case Selector Dropdown */}
          <select
            className="case-top-select"
            value={activeCase?.id ?? ''}
            onChange={(e) => {
              cyberAudio.playSelect();
              setSelectedCaseId(e.target.value);
            }}
            title={activeCase ? `${activeCase.caseNumber} — ${activeCase.title}` : 'Select Case'}
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id} title={c.title}>
                {c.caseNumber} — {c.title.length > 26 ? c.title.slice(0, 24) + '…' : c.title} ({c.status})
              </option>
            ))}
          </select>

          {activeCase && (
            <>
              <span className="case-number-badge">{activeCase.caseNumber}</span>
              <span className="case-title-text" title={activeCase.title}>
                {activeCase.title}
              </span>
            </>
          )}
        </div>

        <div className="case-top-right">
          {activeCase && (
            <>
              <span className={`badge-status status-${activeCase.status.toLowerCase().replace('_', '-')}`}>
                {activeCase.status}
              </span>
              <span className={`badge-severity sev-${activeCase.severity.toLowerCase()}`}>
                SEV: {activeCase.severity}
              </span>
              <span className={`badge-priority pri-${activeCase.priority.toLowerCase()}`}>
                PRI: {activeCase.priority}
              </span>
              <span className="case-owner-label">
                OWNER: <strong style={{ color: '#3dffb0' }}>{activeCase.ownerId ?? 'UNASSIGNED'}</strong>
              </span>
            </>
          )}

          <button
            className="case-btn case-btn-sm"
            onClick={() => {
              cyberAudio.playClick();
              setShowCreateModal(true);
            }}
            title="Create New Operational Case"
          >
            <FolderPlus size={12} />
            <span>NEW CASE</span>
          </button>

          <button
            className="case-btn case-btn-sm case-btn-danger"
            onClick={() => {
              cyberAudio.playClick();
              onClose();
            }}
            title="Exit Case Workspace"
          >
            <X size={12} />
            <span>EXIT</span>
          </button>
        </div>
      </div>

      {/* ─── LEFT COLUMN: CONTEXT STRIP ───────────────────────────────────── */}
      <div className="case-panel case-col-context">
        <div className="case-panel-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={13} />
            CASE CONTEXT
          </span>
          <span style={{ color: '#00f0ff', fontSize: 10 }}>
            {incidents.length} INC / {hunts.length} HUNTS
          </span>
        </div>

        <div className="case-panel-content">
          {/* Linked Incidents */}
          <div className="context-section-header">
            <span>LINKED INCIDENTS ({incidents.length})</span>
          </div>
          {incidents.length === 0 ? (
            <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', marginBottom: 12 }}>
              No incidents linked.
            </div>
          ) : (
            incidents.map((inc) => (
              <div key={inc.id} className="context-card">
                <div className="context-card-title">{inc.title}</div>
                <div className="context-card-meta">
                  <span className={`badge-severity sev-${inc.severity.toLowerCase()}`}>
                    {inc.severity}
                  </span>
                  <span>{inc.status}</span>
                  {onInvestigateIncident && (
                    <button
                      className="case-btn case-btn-sm"
                      style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: 9 }}
                      onClick={() => {
                        cyberAudio.playSelect();
                        onInvestigateIncident(inc.id);
                      }}
                      title="Investigate in Spatial Universe"
                    >
                      <ExternalLink size={10} />
                      <span>INVESTIGATE</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Linked Threat Hunts */}
          <div className="context-section-header">
            <span>LINKED THREAT HUNTS ({hunts.length})</span>
          </div>
          {hunts.length === 0 ? (
            <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', marginBottom: 12 }}>
              No threat hunts linked.
            </div>
          ) : (
            hunts.map((h) => (
              <div key={h.id} className="context-card">
                <div className="context-card-title">{h.name}</div>
                <div className="context-card-meta">
                  <span style={{ color: '#3dffb0' }}>{h.resultCount} MATCHES</span>
                  {onOpenThreatHunt && (
                    <button
                      className="case-btn case-btn-sm"
                      style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: 9 }}
                      onClick={() => {
                        cyberAudio.playSelect();
                        onOpenThreatHunt();
                      }}
                      title="Open Threat Hunting Workspace"
                    >
                      <Crosshair size={10} />
                      <span>HUNT</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Correlated Alerts */}
          <div className="context-section-header">
            <span>ALERTS ({alerts.length})</span>
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 12 }}>
            {alerts.length} alerts attached to active investigation scope.
          </div>

          {/* Affected Assets */}
          <div className="context-section-header">
            <span>AFFECTED ASSETS ({assets.length})</span>
          </div>
          <div className="entity-chip-list">
            {assets.length === 0 ? (
              <span style={{ fontSize: 10, color: '#64748b' }}>None</span>
            ) : (
              assets.map((a) => (
                <span key={a.id} className="entity-chip">
                  {a.name} ({a.type})
                </span>
              ))
            )}
          </div>

          {/* Enterprise Users */}
          <div className="context-section-header">
            <span>IMPACTED USERS ({users.length})</span>
          </div>
          <div className="entity-chip-list">
            {users.length === 0 ? (
              <span style={{ fontSize: 10, color: '#64748b' }}>None</span>
            ) : (
              users.map((u) => (
                <span key={u.id} className="entity-chip">
                  {u.displayName}
                </span>
              ))
            )}
          </div>

          {/* IOCs */}
          <div className="context-section-header">
            <span>RELATED IOCs ({iocs.length})</span>
          </div>
          <div className="entity-chip-list">
            {iocs.length === 0 ? (
              <span style={{ fontSize: 10, color: '#64748b' }}>None</span>
            ) : (
              iocs.map((ioc) => (
                <span
                  key={ioc.id}
                  className="entity-chip"
                  style={{ color: ioc.isBlocked ? '#ff3b5c' : '#ffd700', cursor: 'pointer' }}
                  onClick={() => setSelectedIntelIocId(ioc.id)}
                  title="Click to view Threat Intelligence Profile"
                >
                  ⚡ {ioc.value} {ioc.isBlocked ? '[BLOCKED]' : ''}
                </span>
              ))
            )}
          </div>

          {/* Preserved Evidence Artifacts */}
          <div className="context-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <span>EVIDENCE ARTIFACTS ({caseEvidence.length})</span>
            {onOpenEvidence && (
              <button
                className="case-btn case-btn-sm"
                style={{ padding: '1px 6px', fontSize: 9 }}
                onClick={() => {
                  cyberAudio.playClick();
                  onOpenEvidence(activeCase?.id);
                }}
                title="Launch Evidence Vault"
              >
                VAULT
              </button>
            )}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 12 }}>
            {caseEvidence.length} artifacts preserved with SHA-256 integrity metadata.
          </div>
        </div>
      </div>

      {/* ─── CENTER: INVESTIGATION SPACE ─────────────────────────────────── */}
      <div className="case-panel case-col-center">
        <div className="center-tabs">
          <button
            className={`center-tab-btn ${centerTab === 'FINDINGS' ? 'active' : ''}`}
            onClick={() => {
              cyberAudio.playClick();
              setCenterTab('FINDINGS');
            }}
          >
            FINDINGS ({findings.length})
          </button>
          <button
            className={`center-tab-btn ${centerTab === 'EVIDENCE' ? 'active' : ''}`}
            onClick={() => {
              cyberAudio.playClick();
              setCenterTab('EVIDENCE');
            }}
          >
            EVIDENCE ({caseEvidence.length})
          </button>
          <button
            className={`center-tab-btn ${centerTab === 'RELATIONSHIPS' ? 'active' : ''}`}
            onClick={() => {
              cyberAudio.playClick();
              setCenterTab('RELATIONSHIPS');
            }}
          >
            RELATIONSHIPS
          </button>
          <button
            className="case-btn case-btn-sm"
            style={{ marginLeft: 'auto', alignSelf: 'center', flexShrink: 0 }}
            onClick={() => {
              cyberAudio.playClick();
              setShowFindingModal(true);
            }}
          >
            <Plus size={11} />
            <span>ADD FINDING</span>
          </button>
        </div>

        <div className="case-panel-content">
          {centerTab === 'FINDINGS' ? (
            <div>
              {findings.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '36px 0' }}>
                  No investigation findings recorded yet. Click "ADD FINDING" to document verified evidence.
                </div>
              ) : (
                findings.map((f) => (
                  <div key={f.id} className="finding-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span className="finding-title">{f.title}</span>
                      {f.severity && (
                        <span className={`badge-severity sev-${f.severity.toLowerCase()}`}>
                          {f.severity}
                        </span>
                      )}
                    </div>
                    <div className="finding-desc">{f.description}</div>
                    <div className="provenance-tag-list">
                      <span style={{ fontSize: 9, color: '#64748b', alignSelf: 'center' }}>PROVENANCE:</span>
                      {f.relatedIncidentIds?.map((id) => (
                        <span key={id} className="provenance-tag">INC:{id}</span>
                      ))}
                      {f.relatedHuntIds?.map((id) => (
                        <span key={id} className="provenance-tag">HUNT:{id}</span>
                      ))}
                      {f.relatedAlertIds?.map((id) => (
                        <span key={id} className="provenance-tag">ALERT:{id}</span>
                      ))}
                      {f.relatedEventIds?.map((id) => (
                        <span key={id} className="provenance-tag">EVT:{id}</span>
                      ))}
                      {f.relatedEvidenceIds?.map((id) => (
                        <span
                          key={id}
                          className="provenance-tag"
                          style={{ borderColor: '#00f0ff', color: '#00f0ff', cursor: onOpenEvidence ? 'pointer' : 'default' }}
                          onClick={() => {
                            if (onOpenEvidence) {
                              cyberAudio.playClick();
                              onOpenEvidence(activeCase?.id);
                            }
                          }}
                          title="View evidence in Evidence Vault"
                        >
                          EVD:{id}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : centerTab === 'EVIDENCE' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'rgba(0, 240, 255, 0.06)',
                  border: '1px solid rgba(0, 240, 255, 0.2)',
                  borderRadius: 6,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#00f0ff' }}>
                    CASE EVIDENCE VAULT ({caseEvidence.length} ARTIFACTS)
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                    Preserved artifacts, cryptographic hashes, and chain of custody
                  </div>
                </div>
                {onOpenEvidence && (
                  <button
                    className="case-btn case-btn-sm"
                    onClick={() => {
                      cyberAudio.playClick();
                      onOpenEvidence(activeCase?.id);
                    }}
                  >
                    <ExternalLink size={12} />
                    <span>OPEN EVIDENCE WORKSPACE</span>
                  </button>
                )}
              </div>

              {caseEvidence.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '36px 0' }}>
                  No evidence artifacts collected for this case yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {caseEvidence.map((evd) => (
                    <div
                      key={evd.id}
                      style={{
                        padding: '10px 12px',
                        background: 'rgba(0, 240, 255, 0.03)',
                        border: '1px solid rgba(0, 240, 255, 0.15)',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: onOpenEvidence ? 'pointer' : 'default',
                      }}
                      onClick={() => {
                        if (onOpenEvidence) {
                          cyberAudio.playClick();
                          onOpenEvidence(activeCase?.id);
                        }
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#00f0ff' }}>
                            {evd.evidenceNumber}
                          </span>
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'rgba(0, 240, 255, 0.15)',
                              color: '#00f0ff',
                            }}
                          >
                            {evd.type}
                          </span>
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 10,
                              border: '1px solid',
                              borderColor:
                                evd.status === 'VALIDATED'
                                  ? '#3dffb0'
                                  : evd.status === 'UNDER_REVIEW'
                                  ? '#ffb700'
                                  : '#00f0ff',
                              color:
                                evd.status === 'VALIDATED'
                                  ? '#3dffb0'
                                  : evd.status === 'UNDER_REVIEW'
                                  ? '#ffb700'
                                  : '#00f0ff',
                            }}
                          >
                            {evd.status}
                          </span>
                          {evd.integrity.verified && (
                            <span style={{ fontSize: 9, color: '#3dffb0', display: 'flex', alignItems: 'center', gap: 2 }}>
                              <CheckCircle2 size={10} /> SHA-256 VERIFIED
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#e0f2fe', fontWeight: 600 }}>
                          {evd.title}
                        </div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                          Source: {evd.sourceType} ({evd.sourceId || 'DIRECT'}) • Collector: {evd.collectedBy}
                        </div>
                      </div>
                      {onOpenEvidence && (
                        <button
                          className="case-btn case-btn-sm"
                          style={{ padding: '4px 8px', fontSize: 10 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            cyberAudio.playClick();
                            onOpenEvidence(activeCase?.id);
                          }}
                        >
                          <ExternalLink size={11} />
                          <span>INSPECT</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="spatial-hierarchy-container">
              {/* Root Case Node */}
              <div className="hierarchy-node">
                <div className="hierarchy-node-header">
                  <Briefcase size={14} color="#00f0ff" />
                  <span>CASE CONTAINER: {activeCase?.caseNumber} — {activeCase?.title}</span>
                </div>

                <div className="hierarchy-branch">
                  {/* Incidents Branch */}
                  <div className="hierarchy-node">
                    <div className="hierarchy-node-header">
                      <Shield size={13} color="#ff3b5c" />
                      <span>CORRELATED INCIDENTS ({incidents.length})</span>
                    </div>
                    <div className="hierarchy-branch">
                      {incidents.map((inc) => (
                        <div key={inc.id} style={{ fontSize: 10, color: '#e0f2fe' }}>
                          • {inc.title} ({inc.severity}) — Assets: {inc.affectedAssets.join(', ') || 'N/A'}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Threat Hunts Branch */}
                  <div className="hierarchy-node">
                    <div className="hierarchy-node-header">
                      <Crosshair size={13} color="#3dffb0" />
                      <span>THREAT HUNTS ({hunts.length})</span>
                    </div>
                    <div className="hierarchy-branch">
                      {hunts.map((h) => (
                        <div key={h.id} style={{ fontSize: 10, color: '#e0f2fe' }}>
                          • {h.name} ({h.resultCount} events matched)
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Findings Branch */}
                  <div className="hierarchy-node">
                    <div className="hierarchy-node-header">
                      <FileText size={13} color="#ffd700" />
                      <span>VERIFIED FINDINGS ({findings.length})</span>
                    </div>
                    <div className="hierarchy-branch">
                      {findings.map((f) => (
                        <div key={f.id} style={{ fontSize: 10, color: '#e0f2fe' }}>
                          • {f.title} ({f.severity ?? 'MEDIUM'})
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tasks Branch */}
                  <div className="hierarchy-node">
                    <div className="hierarchy-node-header">
                      <CheckCircle2 size={13} color="#a5f3fc" />
                      <span>OPERATIONAL TASKS ({tasks.length})</span>
                    </div>
                    <div className="hierarchy-branch">
                      {tasks.map((t) => (
                        <div key={t.id} style={{ fontSize: 10, color: t.status === 'DONE' ? '#64748b' : '#e0f2fe' }}>
                          • [{t.status}] {t.title} (Assigned: {t.assigneeId ?? 'Unassigned'})
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── RIGHT: CASE OPERATIONS ───────────────────────────────────────── */}
      <div className="case-panel case-col-ops">
        <div className="case-panel-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <GitPullRequest size={13} />
            CASE OPERATIONS
          </span>
          <span style={{ color: '#00f0ff', fontSize: 10 }}>{activeCase?.status}</span>
        </div>

        <div className="case-panel-content">
          {/* Lifecycle State Transitions */}
          <div className="ops-section">
            <div className="ops-label">STATUS LIFECYCLE TRANSITION</div>
            <div className="status-transitions-grid">
              {activeCase?.status === 'OPEN' && (
                <>
                  <button className="case-btn case-btn-sm" onClick={() => handleTransitionStatus('IN_PROGRESS')}>
                    <Play size={10} /> IN_PROGRESS
                  </button>
                  <button className="case-btn case-btn-sm" onClick={() => handleTransitionStatus('PENDING')}>
                    PENDING
                  </button>
                  <button className="case-btn case-btn-sm case-btn-success" onClick={() => handleTransitionStatus('RESOLVED')}>
                    RESOLVE
                  </button>
                  <button className="case-btn case-btn-sm case-btn-danger" onClick={() => handleTransitionStatus('CLOSED')}>
                    CLOSE
                  </button>
                </>
              )}

              {activeCase?.status === 'IN_PROGRESS' && (
                <>
                  <button className="case-btn case-btn-sm" onClick={() => handleTransitionStatus('PENDING')}>
                    SET PENDING
                  </button>
                  <button className="case-btn case-btn-sm case-btn-success" onClick={() => handleTransitionStatus('RESOLVED')}>
                    RESOLVE
                  </button>
                  <button className="case-btn case-btn-sm case-btn-danger" onClick={() => handleTransitionStatus('CLOSED')}>
                    CLOSE
                  </button>
                </>
              )}

              {activeCase?.status === 'PENDING' && (
                <>
                  <button className="case-btn case-btn-sm" onClick={() => handleTransitionStatus('IN_PROGRESS')}>
                    RESUME WORK
                  </button>
                  <button className="case-btn case-btn-sm case-btn-success" onClick={() => handleTransitionStatus('RESOLVED')}>
                    RESOLVE
                  </button>
                  <button className="case-btn case-btn-sm case-btn-danger" onClick={() => handleTransitionStatus('CLOSED')}>
                    CLOSE
                  </button>
                </>
              )}

              {activeCase?.status === 'RESOLVED' && (
                <>
                  <button className="case-btn case-btn-sm" onClick={() => handleTransitionStatus('IN_PROGRESS')}>
                    REOPEN TO WORK
                  </button>
                  <button className="case-btn case-btn-sm case-btn-danger" onClick={() => handleTransitionStatus('CLOSED')}>
                    CLOSE CASE
                  </button>
                </>
              )}

              {activeCase?.status === 'CLOSED' && (
                <button className="case-btn case-btn-sm case-btn-success" onClick={handleReopen}>
                  <RotateCcw size={10} /> REOPEN CASE
                </button>
              )}
            </div>
          </div>

          {/* Ownership Assignment */}
          <div className="ops-section">
            <div className="ops-label">CASE OWNER / ASSIGNEE</div>
            <select
              className="case-modal-select"
              style={{ width: '100%' }}
              value={activeCase?.ownerId ?? ''}
              onChange={(e) => handleOwnerChange(e.target.value)}
            >
              <option value="">-- Unassigned --</option>
              {AVAILABLE_OWNERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          {/* Operational Priority */}
          <div className="ops-section">
            <div className="ops-label">OPERATIONAL PRIORITY</div>
            <select
              className="case-modal-select"
              style={{ width: '100%' }}
              value={activeCase?.priority ?? 'MEDIUM'}
              onChange={(e) => handlePriorityChange(e.target.value as CasePriority)}
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>

          {/* Tasks Checklist */}
          <div className="ops-section">
            <div className="ops-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ANALYST WORK ITEMS ({tasks.filter((t) => t.status === 'DONE').length}/{tasks.length})</span>
            </div>

            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
              {tasks.map((task) => (
                <div key={task.id} className={`task-item ${task.status === 'DONE' ? 'task-done' : ''}`}>
                  <input
                    type="checkbox"
                    className="task-checkbox"
                    checked={task.status === 'DONE'}
                    onChange={() => handleToggleTask(task)}
                  />
                  <div style={{ flex: 1 }}>
                    <div className="task-title">{task.title}</div>
                    <div className="task-meta">
                      PRI: {task.priority} • ASSIGNED: {task.assigneeId ?? 'None'}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Add Task */}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                className="case-modal-input"
                style={{ flex: 1, padding: '4px 8px', fontSize: 10 }}
                placeholder="New operational task..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTask();
                }}
              />
              <button className="case-btn case-btn-sm" onClick={handleAddTask}>
                <Plus size={11} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── BOTTOM ROW: ACTIVITY TIMELINE ───────────────────────────────── */}
      <div className="case-panel case-bottom-activity">
        <div className="case-panel-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={13} />
            CASE ACTIVITY AUDIT STREAM
          </span>
          <span style={{ color: '#00f0ff', fontSize: 10 }}>{activity.length} AUDIT RECORDS</span>
        </div>

        <div className="case-panel-content">
          <div className="activity-stream">
            {activity.length === 0 ? (
              <div style={{ color: '#64748b', fontStyle: 'italic', fontSize: 10 }}>
                No recorded audit events.
              </div>
            ) : (
              activity.slice(0, 20).map((record) => (
                <div key={record.id} className="activity-entry">
                  <span className="activity-time">
                    {new Date(record.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="activity-actor">{record.actor}</span>
                  <span className="activity-action">{record.action}</span>
                  {record.resultingState && (
                    <span style={{ color: '#94a3b8', fontSize: 9 }}>
                      &rarr; {record.resultingState}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── BOTTOM ROW: NOTES STREAM ────────────────────────────────────── */}
      <div className="case-panel case-bottom-notes">
        <div className="case-panel-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={13} />
            COLLABORATION NOTES ({notes.length})
          </span>
        </div>

        <div className="case-panel-content">
          <div className="notes-stream">
            {notes.map((note) => (
              <div key={note.id} className="note-bubble">
                <div className="note-header">
                  <span className="note-author">{note.authorName}</span>
                  <span>{new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="note-body">{note.content}</div>
              </div>
            ))}
          </div>

          {/* Quick Post Note */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              type="text"
              className="case-modal-input"
              style={{ flex: 1, padding: '4px 8px', fontSize: 10 }}
              placeholder="Add analyst note..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePostNote();
              }}
            />
            <button className="case-btn case-btn-sm" onClick={handlePostNote}>
              <Send size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── MODAL: CREATE CASE ───────────────────────────────────────────── */}
      {showCreateModal && (
        <div className="case-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="case-modal" onClick={(e) => e.stopPropagation()}>
            <div className="case-modal-header">
              <span>CREATE OPERATIONAL CASE</span>
              <button className="case-btn case-btn-sm" onClick={() => setShowCreateModal(false)}>
                <X size={12} />
              </button>
            </div>
            <div className="case-modal-body">
              <label style={{ fontSize: 10, color: '#94a3b8' }}>CASE TITLE</label>
              <input
                type="text"
                className="case-modal-input"
                placeholder="e.g. Operation RedSky — Phishing & Credential Harvest"
                value={newCaseTitle}
                onChange={(e) => setNewCaseTitle(e.target.value)}
              />

              <label style={{ fontSize: 10, color: '#94a3b8' }}>DESCRIPTION</label>
              <textarea
                className="case-modal-textarea"
                rows={3}
                placeholder="Operational scope, hypothesis, and immediate objectives..."
                value={newCaseDesc}
                onChange={(e) => setNewCaseDesc(e.target.value)}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: '#94a3b8' }}>PRIORITY</label>
                  <select
                    className="case-modal-select"
                    style={{ width: '100%' }}
                    value={newCasePriority}
                    onChange={(e) => setNewCasePriority(e.target.value as CasePriority)}
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#94a3b8' }}>SEVERITY</label>
                  <select
                    className="case-modal-select"
                    style={{ width: '100%' }}
                    value={newCaseSeverity}
                    onChange={(e) => setNewCaseSeverity(e.target.value as CaseSeverity)}
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="case-modal-footer">
              <button className="case-btn" onClick={() => setShowCreateModal(false)}>
                CANCEL
              </button>
              <button className="case-btn case-btn-success" onClick={handleCreateCase}>
                CREATE CASE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: ADD FINDING ───────────────────────────────────────────── */}
      {showFindingModal && (
        <div className="case-modal-overlay" onClick={() => setShowFindingModal(false)}>
          <div className="case-modal" onClick={(e) => e.stopPropagation()}>
            <div className="case-modal-header">
              <span>RECORD INVESTIGATION FINDING</span>
              <button className="case-btn case-btn-sm" onClick={() => setShowFindingModal(false)}>
                <X size={12} />
              </button>
            </div>
            <div className="case-modal-body">
              <label style={{ fontSize: 10, color: '#94a3b8' }}>FINDING TITLE</label>
              <input
                type="text"
                className="case-modal-input"
                placeholder="e.g. Lateral movement attempt to DC01 via PsExec"
                value={newFindingTitle}
                onChange={(e) => setNewFindingTitle(e.target.value)}
              />

              <label style={{ fontSize: 10, color: '#94a3b8' }}>DESCRIPTION & PROVENANCE DETAILS</label>
              <textarea
                className="case-modal-textarea"
                rows={3}
                placeholder="Observed activity, technique indicators, and compromised accounts..."
                value={newFindingDesc}
                onChange={(e) => setNewFindingDesc(e.target.value)}
              />

              <label style={{ fontSize: 10, color: '#94a3b8' }}>SEVERITY</label>
              <select
                className="case-modal-select"
                value={newFindingSeverity}
                onChange={(e) => setNewFindingSeverity(e.target.value as CaseSeverity)}
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
            <div className="case-modal-footer">
              <button className="case-btn" onClick={() => setShowFindingModal(false)}>
                CANCEL
              </button>
              <button className="case-btn case-btn-success" onClick={handleAddFinding}>
                RECORD FINDING
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: RESOLVE CASE ─────────────────────────────────────────── */}
      {showResolveModal && (
        <div className="case-modal-overlay" onClick={() => setShowResolveModal(false)}>
          <div className="case-modal" onClick={(e) => e.stopPropagation()}>
            <div className="case-modal-header">
              <span>RESOLVE CASE {activeCase?.caseNumber}</span>
              <button className="case-btn case-btn-sm" onClick={() => setShowResolveModal(false)}>
                <X size={12} />
              </button>
            </div>
            <div className="case-modal-body">
              <div style={{ fontSize: 11, color: '#cbd5e1' }}>
                Document the operational resolution summary before marking this case RESOLVED.
              </div>
              <textarea
                className="case-modal-textarea"
                rows={4}
                placeholder="Remediation actions taken, eradication details, lessons learned..."
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
              />
            </div>
            <div className="case-modal-footer">
              <button className="case-btn" onClick={() => setShowResolveModal(false)}>
                CANCEL
              </button>
              <button className="case-btn case-btn-success" onClick={handleConfirmResolve}>
                CONFIRM RESOLUTION
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: CLOSE CASE ───────────────────────────────────────────── */}
      {showCloseModal && (
        <div className="case-modal-overlay" onClick={() => setShowCloseModal(false)}>
          <div className="case-modal" onClick={(e) => e.stopPropagation()}>
            <div className="case-modal-header">
              <span>CLOSE CASE {activeCase?.caseNumber}</span>
              <button className="case-btn case-btn-sm" onClick={() => setShowCloseModal(false)}>
                <X size={12} />
              </button>
            </div>
            <div className="case-modal-body">
              <div style={{ fontSize: 11, color: '#cbd5e1' }}>
                Specify the formal closure reason. Direct modifications are locked once closed.
              </div>
              <textarea
                className="case-modal-textarea"
                rows={3}
                placeholder="Reason for closure (e.g. Completed remediation, false positive, transferred to legal)..."
                value={closureReason}
                onChange={(e) => setClosureReason(e.target.value)}
              />
            </div>
            <div className="case-modal-footer">
              <button className="case-btn" onClick={() => setShowCloseModal(false)}>
                CANCEL
              </button>
              <button className="case-btn case-btn-danger" onClick={handleConfirmClose}>
                CONFIRM CLOSURE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Threat Intelligence Profile Modal */}
      {selectedIntelIocId && (
        <ThreatIntelProfile
          indicatorId={selectedIntelIocId}
          onClose={() => setSelectedIntelIocId(null)}
          onPivot={(entityId, entityType) => {
            if (entityType === 'IOC') {
              setSelectedIntelIocId(entityId);
            }
          }}
        />
      )}
    </div>
  );
}

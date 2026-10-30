/**
 * EvidenceWorkspace.tsx
 *
 * EXPLAIN-SEC SPATIAL — STEP 9: EVIDENCE + RBAC + RESPONSE UX
 *
 * Clean Single Primary Evidence Detail Panel Operating Environment:
 *   EVIDENCE -> EVIDENCE LIST -> SELECT EVIDENCE -> EVIDENCE DETAIL -> PROVENANCE / CUSTODY / RELATED CONTEXT
 *
 * All 12 mandatory properties exposed:
 *   1. evidence ID
 *   2. source
 *   3. timestamp
 *   4. collector
 *   5. hash/integrity
 *   6. incident
 *   7. case
 *   8. entity
 *   9. chain of custody
 *   10. notes
 *   11. analyst actions
 *   12. provenance
 *
 * Only ONE primary evidence detail panel visible at a time.
 * Visibly communicates RBAC permissions and disables unauthorized actions with clear reasons.
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { PerformanceMode } from '../performance-mode';
import type {
  Evidence,
  EvidenceType,
  EvidenceStatus,
  EvidenceSourceType,
  EvidenceCustodyEntry,
  EvidenceAnnotation,
  CreateEvidenceInput,
} from '../../core/models/evidence';
import { isValidEvidenceStatusTransition } from '../../core/models/evidence';
import type { Case, CaseFinding } from '../../core/models/case';
import type { Incident } from '../../core/models/incident';
import type { ThreatHunt } from '../../core/models/hunting';
import type { Alert } from '../../core/models/detection';
import type { SecurityEvent } from '../../core/models/event';
import type { IOC } from '../../core/models/entity';
import type { UserSession, RoleId } from '../../core/models/auth';
import {
  canCollectEvidence,
  canAnnotateEvidence,
  canVerifyEvidence,
  canManageEvidence,
  canApproveSensitiveAction,
} from '../../core/auth/rbac';
import { securityService } from '../../core/security-service';
import { ThreatIntelProfile } from '../intel/ThreatIntelProfile';
import RbacBanner from '../components/RbacBanner';
import { cyberAudio } from '../../cyber-audio';
import {
  ArrowLeft,
  FileCheck,
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  User,
  CheckCircle2,
  RotateCcw,
  Check,
  X,
  ExternalLink,
  FileText,
  Plus,
  Send,
  Lock,
  Search,
  Archive,
  Layers,
  Fingerprint,
  Link2,
  Hash,
  Activity,
  GitBranch,
} from 'lucide-react';
import './evidence-workspace.css';

interface EvidenceWorkspaceProps {
  perfMode: PerformanceMode;
  onClose: () => void;
  caseId?: string;
  evidenceId?: string;
  onNavigateToCase?: (caseId: string) => void;
  onInvestigateIncident?: (incidentId: string) => void;
  onOpenThreatHunt?: (huntId?: string) => void;
}

type EvidenceDetailTab = 'PROVENANCE' | 'CUSTODY' | 'CONTEXT' | 'NOTES';

export default function EvidenceWorkspace({
  perfMode,
  onClose,
  caseId: initialCaseId,
  evidenceId: initialEvidenceId,
  onNavigateToCase,
  onInvestigateIncident,
  onOpenThreatHunt,
}: EvidenceWorkspaceProps) {
  // Session & RBAC
  const [session, setSession] = useState<UserSession | null>(() => securityService.getSession());

  // Collections state
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(initialCaseId || 'all');
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(initialEvidenceId || null);

  // Active detail sub-tab
  const [activeTab, setActiveTab] = useState<EvidenceDetailTab>('PROVENANCE');

  // Active evidence state
  const [custodyLog, setCustodyLog] = useState<EvidenceCustodyEntry[]>([]);
  const [annotations, setAnnotations] = useState<EvidenceAnnotation[]>([]);
  const [caseFindings, setCaseFindings] = useState<CaseFinding[]>([]);
  const [previewBlobContent, setPreviewBlobContent] = useState<string | null>(null);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Input state
  const [newAnnotationText, setNewAnnotationText] = useState<string>('');
  const [integrityStatus, setIntegrityStatus] = useState<{
    verifying: boolean;
    result?: { verified: boolean; message: string; calculatedHash?: string };
  }>({ verifying: false });

  // Modals
  const [showCollectModal, setShowCollectModal] = useState<boolean>(false);
  const [showLinkFindingModal, setShowLinkFindingModal] = useState<boolean>(false);

  // Modal Form State
  const [formCaseId, setFormCaseId] = useState<string>(initialCaseId || 'case-blacktide-001');
  const [formType, setFormType] = useState<EvidenceType>('EVENT_REFERENCE');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formTags, setFormTags] = useState<string>('');
  const [formSourceType, setFormSourceType] = useState<EvidenceSourceType>('SECURITY_EVENT');
  const [formSourceId, setFormSourceId] = useState<string>('');
  const [formTextContent, setFormTextContent] = useState<string>('');
  const [formFileName, setFormFileName] = useState<string>('');
  const [formFileMime, setFormFileMime] = useState<string>('text/plain');
  const [formFileContent, setFormFileContent] = useState<string>('');

  // Available source reference suggestions
  const [availableIncidents, setAvailableIncidents] = useState<Incident[]>([]);
  const [availableHunts, setAvailableHunts] = useState<ThreatHunt[]>([]);
  const [availableAlerts, setAvailableAlerts] = useState<Alert[]>([]);
  const [availableEvents, setAvailableEvents] = useState<SecurityEvent[]>([]);
  const [availableIocs, setAvailableIocs] = useState<IOC[]>([]);
  const [selectedIntelIocId, setSelectedIntelIocId] = useState<string | null>(null);

  // RBAC Permission derivation
  const currentRole: RoleId = session?.role ?? 'L1_ANALYST';
  const userCanCollect = canCollectEvidence(currentRole);
  const userCanAnnotate = canAnnotateEvidence(currentRole);
  const userCanVerify = canVerifyEvidence(currentRole);
  const userCanManage = canManageEvidence(currentRole);
  const userCanApprove = canApproveSensitiveAction(currentRole);

  // Switch role handler for deterministic RBAC demonstration
  const handleRoleChange = async (username: string) => {
    cyberAudio.playClick();
    try {
      const newSession = await securityService.login({ username });
      setSession(newSession);
    } catch (err) {
      console.error('[EvidenceWorkspace] Role change failed:', err);
    }
  };

  // 1. Initial Load of Cases & Reference Context
  useEffect(() => {
    async function loadInitial() {
      try {
        const loadedCases = await securityService.getCases();
        setCases(loadedCases);
        if (initialCaseId && loadedCases.some((c) => c.id === initialCaseId)) {
          setSelectedCaseId(initialCaseId);
        }

        const [incList, huntList, alertList, evtList, iocList] = await Promise.all([
          securityService.getIncidents(),
          securityService.getThreatHunts(),
          securityService.getAlerts(),
          securityService.getEvents({ limit: 50 }),
          securityService.getIOCs(),
        ]);
        setAvailableIncidents(incList);
        setAvailableHunts(huntList);
        setAvailableAlerts(alertList);
        setAvailableEvents(evtList);
        setAvailableIocs(iocList);
      } catch (err) {
        console.error('[EvidenceWorkspace] Failed to load initial data:', err);
      }
    }
    void loadInitial();

    const unsubSession = securityService.subscribe('SESSION_CHANGED', () => {
      setSession(securityService.getSession());
    });
    return () => {
      unsubSession();
    };
  }, [initialCaseId]);

  // 2. Load Evidence List on case/filter change
  const refreshEvidenceList = useCallback(async () => {
    try {
      const filter: Record<string, unknown> = {};
      if (selectedCaseId && selectedCaseId !== 'all') {
        filter.caseId = selectedCaseId;
      }
      if (filterType !== 'ALL') {
        filter.type = filterType as EvidenceType;
      }
      if (filterStatus !== 'ALL') {
        filter.status = filterStatus as EvidenceStatus;
      }

      const items = await securityService.getEvidence(filter);
      setEvidenceList(items);

      if (items.length > 0) {
        setSelectedEvidenceId((prev) => {
          if (prev && items.some((e) => e.id === prev)) return prev;
          return items[0].id;
        });
      } else {
        setSelectedEvidenceId(null);
      }
    } catch (err) {
      console.error('[EvidenceWorkspace] Failed to refresh evidence list:', err);
    }
  }, [selectedCaseId, filterType, filterStatus]);

  useEffect(() => {
    void refreshEvidenceList();
  }, [refreshEvidenceList]);

  // Subscribe to service events
  useEffect(() => {
    const unsubCollected = securityService.on('EVIDENCE_COLLECTED', () => { void refreshEvidenceList(); });
    const unsubUpdated = securityService.on('EVIDENCE_UPDATED', () => { void refreshEvidenceList(); });
    const unsubVerified = securityService.on('EVIDENCE_VERIFIED', () => { void refreshEvidenceList(); });

    return () => {
      unsubCollected();
      unsubUpdated();
      unsubVerified();
    };
  }, [refreshEvidenceList]);

  // 3. Load Details for Selected Evidence
  const selectedEvidence = useMemo(() => {
    return evidenceList.find((e) => e.id === selectedEvidenceId) || null;
  }, [evidenceList, selectedEvidenceId]);

  const prevEvidenceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedEvidence) {
      setCustodyLog([]);
      setAnnotations([]);
      setPreviewBlobContent(null);
      setIntegrityStatus({ verifying: false });
      prevEvidenceIdRef.current = null;
      return;
    }

    if (prevEvidenceIdRef.current !== selectedEvidence.id) {
      setIntegrityStatus({ verifying: false });
      prevEvidenceIdRef.current = selectedEvidence.id;
    }

    async function loadEvidenceDetails() {
      if (!selectedEvidence) return;
      try {
        const [custody, annos, findings] = await Promise.all([
          securityService.getEvidenceCustody(selectedEvidence.id),
          securityService.getEvidenceAnnotations(selectedEvidence.id),
          securityService.getCaseFindings(selectedEvidence.caseId),
        ]);
        setCustodyLog(custody);
        setAnnotations(annos);
        setCaseFindings(findings);

        // Restore verification feedback from latest custody history if present
        const latestVerify = custody
          .filter((c) => c.action === 'INTEGRITY_VERIFIED')
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

        if (latestVerify) {
          const isVerified = (latestVerify.metadata?.verified as boolean) ?? false;
          setIntegrityStatus({
            verifying: false,
            result: {
              verified: isVerified,
              message:
                latestVerify.reason ||
                (isVerified
                  ? 'SHA-256 integrity verified against stored payload'
                  : 'INTEGRITY MISMATCH: computed hash does not match stored hash'),
              calculatedHash:
                (latestVerify.metadata?.computedHash as string) ||
                (latestVerify.metadata?.storedHash as string) ||
                undefined,
            },
          });
        } else if (selectedEvidence.integrity?.verifiedAt && selectedEvidence.integrity?.verified !== undefined) {
          setIntegrityStatus({
            verifying: false,
            result: {
              verified: selectedEvidence.integrity.verified,
              message: selectedEvidence.integrity.verified
                ? `Cryptographic seal verified by ${selectedEvidence.integrity.verifiedBy || 'system'} (${new Date(selectedEvidence.integrity.verifiedAt).toLocaleDateString()})`
                : 'Cryptographic seal mismatch recorded',
              calculatedHash: selectedEvidence.integrity.hash,
            },
          });
        }

        if (selectedEvidence.type === 'FILE' && selectedEvidence.storageReference) {
          const blob = await securityService.getEvidenceBlob(selectedEvidence.storageReference);
          const mime = selectedEvidence.mimeType || '';
          if (blob && (mime.startsWith('text/') || mime.includes('json') || mime.includes('log') || mime.includes('csv'))) {
            try {
              const text = new TextDecoder().decode(blob);
              setPreviewBlobContent(text.slice(0, 4000));
            } catch {
              setPreviewBlobContent('(Binary preview unavailable)');
            }
          } else {
            setPreviewBlobContent(null);
          }
        } else {
          setPreviewBlobContent(null);
        }
      } catch (err) {
        console.error('[EvidenceWorkspace] Failed to load details:', err);
      }
    }

    void loadEvidenceDetails();
  }, [selectedEvidence]);

  // Filtered evidence items by search query
  const filteredEvidence = useMemo(() => {
    if (!searchQuery.trim()) return evidenceList;
    const q = searchQuery.toLowerCase();
    return evidenceList.filter((e) =>
      e.evidenceNumber.toLowerCase().includes(q) ||
      e.title.toLowerCase().includes(q) ||
      (e.description && e.description.toLowerCase().includes(q)) ||
      (e.sourceId && e.sourceId.toLowerCase().includes(q)) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [evidenceList, searchQuery]);

  // Inventory stats
  const inventoryStats = useMemo(() => {
    const total = evidenceList.length;
    const underReview = evidenceList.filter((e) => e.status === 'UNDER_REVIEW').length;
    const validated = evidenceList.filter((e) => e.status === 'VALIDATED').length;
    return { total, underReview, validated };
  }, [evidenceList]);

  // 4. Actions: Verify Integrity
  const handleVerifyIntegrity = async () => {
    if (!selectedEvidence) return;
    if (!userCanVerify) {
      alert(`Unauthorized: Current role "${currentRole}" lacks EVIDENCE_VERIFY permission.`);
      return;
    }
    cyberAudio.playClick();
    setIntegrityStatus({ verifying: true });

    try {
      const result = await securityService.verifyEvidenceIntegrity(selectedEvidence.id);
      setIntegrityStatus({ verifying: false, result });
      await refreshEvidenceList();
      const updatedCustody = await securityService.getEvidenceCustody(selectedEvidence.id);
      setCustodyLog(updatedCustody);
    } catch (err) {
      console.error('[EvidenceWorkspace] Integrity check error:', err);
      setIntegrityStatus({
        verifying: false,
        result: {
          verified: false,
          message: err instanceof Error ? err.message : 'Verification failed',
        },
      });
    }
  };

  // 5. Actions: Lifecycle State Transition
  const handleTransitionStatus = async (targetStatus: EvidenceStatus) => {
    if (!selectedEvidence) return;

    // RBAC validation
    if (targetStatus === 'VALIDATED' || targetStatus === 'ARCHIVED') {
      if (!userCanManage) {
        alert(`Unauthorized: Role "${currentRole}" cannot transition evidence to "${targetStatus}". Requires Manager or Administrator.`);
        return;
      }
    }

    if (!isValidEvidenceStatusTransition(selectedEvidence.status, targetStatus)) {
      alert(`Invalid transition from ${selectedEvidence.status} to ${targetStatus}`);
      return;
    }

    cyberAudio.playClick();
    const reason = prompt(`Reason for moving ${selectedEvidence.evidenceNumber} to ${targetStatus}:`, `Analyst operational review`);
    if (reason === null) return;

    try {
      await securityService.updateEvidenceStatus(selectedEvidence.id, targetStatus, reason || undefined);
      await refreshEvidenceList();
      const updatedCustody = await securityService.getEvidenceCustody(selectedEvidence.id);
      setCustodyLog(updatedCustody);
    } catch (err) {
      console.error('[EvidenceWorkspace] Transition error:', err);
      alert(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  // 6. Actions: Add Annotation
  const handleAddAnnotation = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!selectedEvidence || !newAnnotationText.trim()) return;

    if (!userCanAnnotate) {
      alert(`Unauthorized: Current role "${currentRole}" lacks EVIDENCE_ANNOTATE permission.`);
      return;
    }

    cyberAudio.playClick();
    try {
      await securityService.addEvidenceAnnotation(selectedEvidence.id, {
        content: newAnnotationText.trim(),
      });
      setNewAnnotationText('');
      const updatedAnnos = await securityService.getEvidenceAnnotations(selectedEvidence.id);
      setAnnotations(updatedAnnos);
      const updatedCustody = await securityService.getEvidenceCustody(selectedEvidence.id);
      setCustodyLog(updatedCustody);
    } catch (err) {
      console.error('[EvidenceWorkspace] Add annotation error:', err);
      alert(err instanceof Error ? err.message : 'Failed to add annotation');
    }
  };

  // 7. Actions: Link to Case Finding
  const handleLinkToFinding = async (findingId: string) => {
    if (!selectedEvidence) return;
    cyberAudio.playClick();
    try {
      const finding = caseFindings.find((f) => f.id === findingId);
      if (!finding) return;

      const existingEvidenceIds = finding.relatedEvidenceIds || [];
      if (!existingEvidenceIds.includes(selectedEvidence.id)) {
        const updatedEvidenceIds = [...existingEvidenceIds, selectedEvidence.id];
        await securityService.updateCaseFinding(selectedEvidence.caseId, findingId, {
          relatedEvidenceIds: updatedEvidenceIds,
        });
        const updatedFindings = await securityService.getCaseFindings(selectedEvidence.caseId);
        setCaseFindings(updatedFindings);
        alert(`Linked ${selectedEvidence.evidenceNumber} to finding: ${finding.title}`);
      } else {
        alert(`${selectedEvidence.evidenceNumber} is already linked to this finding.`);
      }
      setShowLinkFindingModal(false);
    } catch (err) {
      console.error('[EvidenceWorkspace] Link to finding error:', err);
    }
  };

  // 8. Actions: Create/Collect Evidence Submit
  const handleCollectSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!userCanCollect) {
      alert(`Unauthorized: Role "${currentRole}" cannot collect evidence.`);
      return;
    }

    if (!formTitle.trim()) {
      alert('Please enter an evidence title');
      return;
    }

    cyberAudio.playClick();
    try {
      const tags = formTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const input: CreateEvidenceInput = {
        caseId: formCaseId,
        type: formType,
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        tags: tags.length > 0 ? tags : ['evidence'],
        sourceType: formSourceType,
        sourceId: formSourceId.trim() || undefined,
        notes: formTextContent.trim() || undefined,
      };

      if (formType === 'TEXT_NOTE') {
        input.notes = formTextContent.trim();
        input.sourceType = 'ANALYST';
      } else if (formType === 'FILE') {
        const fileContent = formFileContent.trim() || 'EXPLAIN-SEC SYNTHETIC EVIDENCE BUFFER';
        const encoder = new TextEncoder();
        const fileBytes = encoder.encode(fileContent);

        input.fileBytes = fileBytes.buffer;
        input.fileName = formFileName.trim() || 'artifact.log';
        input.mimeType = formFileMime || 'text/plain';
        input.sourceType = 'FILE';
      }

      const created = await securityService.createEvidence(input);
      setShowCollectModal(false);
      resetCollectForm();
      await refreshEvidenceList();
      setSelectedEvidenceId(created.id);
    } catch (err) {
      console.error('[EvidenceWorkspace] Evidence creation failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to collect evidence');
    }
  };

  const resetCollectForm = () => {
    setFormTitle('');
    setFormDescription('');
    setFormTags('');
    setFormSourceId('');
    setFormTextContent('');
    setFormFileName('');
    setFormFileContent('');
  };

  const handleSelectQuickSource = (type: EvidenceType, sourceType: EvidenceSourceType, sourceId: string, defaultTitle: string) => {
    setFormType(type);
    setFormSourceType(sourceType);
    setFormSourceId(sourceId);
    if (!formTitle) {
      setFormTitle(`Evidence: ${defaultTitle}`);
    }
  };

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
        if (showCollectModal || showLinkFindingModal) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          cyberAudio.playClick();
          setShowCollectModal(false);
          setShowLinkFindingModal(false);
          return;
        }

        // Level 3: Return to Spatial Command Hub
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cyberAudio.playClick();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedIntelIocId, showCollectModal, showLinkFindingModal, onClose]);

  return (
    <div className="evidence-workspace" role="region" aria-label="Evidence Management Workspace">
      {/* ─── ZONE 1: TOP BAR (HEADER & RBAC STATUS) ─────────────────────────── */}
      <header className="evidence-top-bar">
        <div className="evidence-top-left">
          <button
            className="evidence-back-btn"
            onClick={() => {
              cyberAudio.playClick();
              onClose();
            }}
            title="Return to Spatial Command Hub (Esc)"
          >
            <ArrowLeft size={14} />
            <span>HUB</span>
          </button>
          <FileCheck size={18} color="#00f0ff" />
          <span className="evidence-hub-heading">
            EVIDENCE VAULT
          </span>

          {/* Scope filter: Case selector */}
          <select
            className="evidence-case-select"
            value={selectedCaseId}
            onChange={(e) => {
              cyberAudio.playClick();
              setSelectedCaseId(e.target.value);
            }}
            aria-label="Filter Evidence by Case"
            title="Filter evidence artifacts by assigned case"
          >
            <option value="all">ALL CASES ({evidenceList.length} ARTIFACTS)</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.caseNumber}: {c.title}
              </option>
            ))}
          </select>
        </div>

        {/* Center: RBAC Context Banner */}
        <div className="evidence-rbac-wrap">
          <RbacBanner session={session} onRoleChange={handleRoleChange} compact={true} />
        </div>

        <div className="evidence-top-right">
          {/* Close HUD button */}
          <button
            className="evidence-btn-action"
            onClick={() => {
              cyberAudio.playClick();
              onClose();
            }}
            title="Exit Evidence Workspace (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* ─── ZONE 2: LEFT PANEL (EVIDENCE LIST) ─────────────────────────────── */}
      <aside className="evidence-panel">
        <div className="evidence-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={13} />
            <span>EVIDENCE INVENTORY</span>
          </div>
          <button
            className="evidence-btn-action evidence-btn-primary"
            style={{ padding: '2px 8px', fontSize: 10 }}
            disabled={!userCanCollect}
            onClick={() => {
              cyberAudio.playClick();
              setShowCollectModal(true);
            }}
            title={userCanCollect ? 'Collect new forensic evidence artifact' : 'Requires Analyst or Responder role to collect'}
          >
            <Plus size={10} />
            <span>COLLECT</span>
          </button>
        </div>

        <div className="evidence-panel-content">
          {/* Quick Metrics */}
          <div className="evidence-inventory-stats">
            <div className="inventory-stat-box">
              <div className="inventory-stat-val">{inventoryStats.total}</div>
              <div className="inventory-stat-lbl">Total</div>
            </div>
            <div className="inventory-stat-box">
              <div className="inventory-stat-val" style={{ color: '#ffb700' }}>
                {inventoryStats.underReview}
              </div>
              <div className="inventory-stat-lbl">Reviewing</div>
            </div>
            <div className="inventory-stat-box">
              <div className="inventory-stat-val" style={{ color: '#3dffb0' }}>
                {inventoryStats.validated}
              </div>
              <div className="inventory-stat-lbl">Validated</div>
            </div>
          </div>

          {/* Search Box */}
          <div className="evidence-search-box">
            <Search size={12} color="#64748b" />
            <input
              type="text"
              placeholder="Search ID, title, tags, or hashes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="evidence-search-input"
            />
          </div>

          {/* Filters */}
          <div className="evidence-filter-row">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="evidence-filter-select"
            >
              <option value="ALL">ALL TYPES</option>
              <option value="EVENT_REFERENCE">EVENT</option>
              <option value="ALERT_REFERENCE">ALERT</option>
              <option value="INCIDENT_REFERENCE">INCIDENT</option>
              <option value="IOC_REFERENCE">IOC</option>
              <option value="FILE">FILE</option>
              <option value="TEXT_NOTE">NOTE</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="evidence-filter-select"
            >
              <option value="ALL">ALL STATUSES</option>
              <option value="COLLECTED">COLLECTED</option>
              <option value="UNDER_REVIEW">UNDER REVIEW</option>
              <option value="VALIDATED">VALIDATED</option>
              <option value="DISPUTED">DISPUTED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </div>

          {/* List of Evidence Cards */}
          {filteredEvidence.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b', fontSize: 11 }}>
              NO EVIDENCE ARTIFACTS RECORDED
            </div>
          ) : (
            filteredEvidence.map((evd) => {
              const isActive = evd.id === selectedEvidenceId;
              return (
                <div
                  key={evd.id}
                  className={`evidence-item-card ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    cyberAudio.playClick();
                    setSelectedEvidenceId(evd.id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="evidence-item-top">
                    <span className="evidence-item-id">{evd.evidenceNumber}</span>
                    <span className={`evidence-status-pill status-${evd.status}`} style={{ fontSize: 8 }}>
                      {evd.status}
                    </span>
                  </div>
                  <div className="evidence-item-title">{evd.title}</div>
                  <div className="evidence-item-footer">
                    <span className={`evidence-type-badge evidence-type-${evd.type}`} style={{ fontSize: 8, padding: '1px 4px' }}>
                      {evd.type.replace('_REFERENCE', '')}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ShieldCheck size={10} color={evd.integrity.verified ? '#3dffb0' : '#64748b'} />
                      <span>{new Date(evd.collectedAt).toLocaleDateString()}</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ─── ZONE 3: SINGLE PRIMARY EVIDENCE DETAIL PANEL ────────────────────── */}
      <main className="evidence-detail-panel" role="region" aria-label="Evidence Detail Panel">
        {selectedEvidence ? (
          <>
            {/* Top Detail Header Strip */}
            <div className="evidence-panel-header evidence-detail-header">
              <div className="evidence-detail-header-left">
                <span className="evidence-badge-id">
                  {selectedEvidence.evidenceNumber}
                </span>
                <span
                  className="evidence-title-banner"
                  title={selectedEvidence.title}
                >
                  {selectedEvidence.title}
                </span>
                <span className={`evidence-status-pill status-${selectedEvidence.status}`}>
                  {selectedEvidence.status}
                </span>
              </div>

              {/* Analyst Actions & RBAC Controls */}
              <div className="evidence-detail-actions">
                {/* 1. Verify Integrity Button */}
                <button
                  className="evidence-btn-action"
                  onClick={handleVerifyIntegrity}
                  disabled={integrityStatus.verifying || !userCanVerify}
                  title={userCanVerify ? 'Verify SHA-256 integrity hash' : 'Requires EVIDENCE_VERIFY permission'}
                >
                  {integrityStatus.verifying ? (
                    <RotateCcw size={11} className="spin" />
                  ) : (
                    <Fingerprint size={11} />
                  )}
                  <span>{integrityStatus.verifying ? 'VERIFYING…' : 'VERIFY INTEGRITY'}</span>
                </button>

                {/* 2. Status Transitions */}
                {selectedEvidence.status === 'COLLECTED' && (
                  <button
                    className="evidence-btn-action"
                    onClick={() => handleTransitionStatus('UNDER_REVIEW')}
                    title="Move to Under Review"
                  >
                    <Clock size={11} />
                    <span>START REVIEW</span>
                  </button>
                )}

                {selectedEvidence.status === 'UNDER_REVIEW' && (
                  <>
                    <button
                      className="evidence-btn-action evidence-btn-primary"
                      onClick={() => handleTransitionStatus('VALIDATED')}
                      disabled={!userCanManage}
                      title={userCanManage ? 'Validate evidence authenticity' : 'LOCKED: Requires Manager role'}
                    >
                      <Check size={11} />
                      <span>VALIDATE</span>
                    </button>
                    <button
                      className="evidence-btn-action evidence-btn-danger"
                      onClick={() => handleTransitionStatus('DISPUTED')}
                      disabled={!userCanManage}
                      title={userCanManage ? 'Dispute evidence integrity' : 'LOCKED: Requires Manager role'}
                    >
                      <AlertTriangle size={11} />
                      <span>DISPUTE</span>
                    </button>
                  </>
                )}

                {selectedEvidence.status === 'VALIDATED' && (
                  <button
                    className="evidence-btn-action"
                    onClick={() => handleTransitionStatus('ARCHIVED')}
                    disabled={!userCanManage}
                    title={userCanManage ? 'Archive evidence record' : 'LOCKED: Requires Manager role'}
                  >
                    <Archive size={11} />
                    <span>ARCHIVE</span>
                  </button>
                )}

                {/* 3. Link to Case Finding */}
                <button
                  className="evidence-btn-action"
                  onClick={() => setShowLinkFindingModal(true)}
                  title="Link this artifact to a case finding"
                >
                  <Link2 size={11} />
                  <span>LINK FINDING</span>
                </button>
              </div>
            </div>

            {/* Sub-Navigation Tabs */}
            <div className="evidence-detail-nav">
              <button
                className={`evidence-detail-tab-btn ${activeTab === 'PROVENANCE' ? 'active' : ''}`}
                onClick={() => { cyberAudio.playClick(); setActiveTab('PROVENANCE'); }}
              >
                <Hash size={12} /> PROVENANCE & INTEGRITY
              </button>
              <button
                className={`evidence-detail-tab-btn ${activeTab === 'CUSTODY' ? 'active' : ''}`}
                onClick={() => { cyberAudio.playClick(); setActiveTab('CUSTODY'); }}
              >
                <Lock size={12} /> CHAIN OF CUSTODY ({custodyLog.length})
              </button>
              <button
                className={`evidence-detail-tab-btn ${activeTab === 'CONTEXT' ? 'active' : ''}`}
                onClick={() => { cyberAudio.playClick(); setActiveTab('CONTEXT'); }}
              >
                <GitBranch size={12} /> RELATED CONTEXT & ENTITIES
              </button>
              <button
                className={`evidence-detail-tab-btn ${activeTab === 'NOTES' ? 'active' : ''}`}
                onClick={() => { cyberAudio.playClick(); setActiveTab('NOTES'); }}
              >
                <FileText size={12} /> NOTES & ANNOTATIONS ({annotations.length})
              </button>
            </div>

            {/* Detail Tab Content Area */}
            <div className="evidence-panel-content">
              {/* TAB 1: PROVENANCE & INTEGRITY */}
              {activeTab === 'PROVENANCE' && (
                <div>
                  {/* Primary 12-Field Matrix Grid */}
                  <div className="evidence-12field-grid">
                    {/* 1. Evidence ID */}
                    <div className="evidence-12field-cell">
                      <span className="evidence-field-label">1. EVIDENCE ID</span>
                      <span className="evidence-field-val font-mono text-cyan" style={{ fontWeight: 700 }}>
                        {selectedEvidence.evidenceNumber} ({selectedEvidence.id})
                      </span>
                    </div>

                    {/* 2. Source */}
                    <div className="evidence-12field-cell">
                      <span className="evidence-field-label">2. SOURCE</span>
                      <span className="evidence-field-val">
                        <span className="evidence-source-tag">{selectedEvidence.sourceType}</span>
                        <span className="font-mono" style={{ marginLeft: 6, color: '#94a3b8' }}>
                          {selectedEvidence.sourceId || 'DIRECT_INGEST'}
                        </span>
                      </span>
                    </div>

                    {/* 3. Timestamp */}
                    <div className="evidence-12field-cell">
                      <span className="evidence-field-label">3. TIMESTAMP</span>
                      <span className="evidence-field-val">
                        {new Date(selectedEvidence.collectedAt).toLocaleString()}
                        <span style={{ color: '#64748b', fontSize: 10, marginLeft: 6 }}>({selectedEvidence.collectedAt})</span>
                      </span>
                    </div>

                    {/* 4. Collector */}
                    <div className="evidence-12field-cell">
                      <span className="evidence-field-label">4. COLLECTOR</span>
                      <span className="evidence-field-val">
                        {selectedEvidence.collectedBy}
                      </span>
                    </div>

                    {/* 5. Hash / Integrity */}
                    <div className="evidence-12field-cell" style={{ gridColumn: 'span 2' }}>
                      <span className="evidence-field-label">5. HASH & INTEGRITY SEAL</span>
                      <div className="evidence-hash-container">
                        <span className="evidence-hash-algo">{selectedEvidence.integrity?.algorithm || 'SHA-256'}</span>
                        <code className="evidence-hash-val">
                          {selectedEvidence.integrity?.hash || 'PENDING_RECALCULATION'}
                        </code>
                      </div>
                    </div>

                    {/* 6. Incident */}
                    <div className="evidence-12field-cell">
                      <span className="evidence-field-label">6. LINKED INCIDENT</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="evidence-field-val font-mono">
                          {selectedEvidence.relatedIncidentIds?.[0] || '—'}
                        </span>
                        {onInvestigateIncident && selectedEvidence.relatedIncidentIds?.[0] && (
                          <button
                            className="evidence-btn-action"
                            style={{ padding: '1px 5px', fontSize: 9 }}
                            onClick={() => onInvestigateIncident(selectedEvidence.relatedIncidentIds![0])}
                          >
                            <ExternalLink size={9} /> INVESTIGATE
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 7. Case */}
                    <div className="evidence-12field-cell">
                      <span className="evidence-field-label">7. LINKED CASE</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="evidence-field-val font-mono">{selectedEvidence.caseId}</span>
                        {onNavigateToCase && (
                          <button
                            className="evidence-btn-action"
                            style={{ padding: '1px 5px', fontSize: 9 }}
                            onClick={() => onNavigateToCase(selectedEvidence.caseId)}
                          >
                            <ExternalLink size={9} /> VIEW CASE
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 8. Entity */}
                    <div className="evidence-12field-cell" style={{ gridColumn: 'span 2' }}>
                      <span className="evidence-field-label">8. ASSOCIATED SECURITY ENTITIES</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                        {selectedEvidence.relatedAssetIds?.map((id) => (
                          <span key={id} className="evidence-entity-badge asset">ASSET: {id}</span>
                        ))}
                        {selectedEvidence.relatedUserIds?.map((id) => (
                          <span key={id} className="evidence-entity-badge user">USER: {id}</span>
                        ))}
                        {selectedEvidence.relatedIocIds?.map((id) => (
                          <span key={id} className="evidence-entity-badge ioc">IOC: {id}</span>
                        ))}
                        {(!selectedEvidence.relatedAssetIds?.length && !selectedEvidence.relatedUserIds?.length && !selectedEvidence.relatedIocIds?.length) && (
                          <span style={{ color: '#64748b', fontSize: 10 }}>Correlated directly with incident root scope</span>
                        )}
                      </div>
                    </div>

                    {/* 12. Provenance */}
                    <div className="evidence-12field-cell" style={{ gridColumn: 'span 2' }}>
                      <span className="evidence-field-label">12. PROVENANCE & VERIFICATION METADATA</span>
                      <div className="evidence-provenance-meta">
                        <span><strong style={{ color: '#00f0ff' }}>Origin:</strong> {selectedEvidence.sourceType}</span>
                        <span><strong style={{ color: '#00f0ff' }}>Pipeline:</strong> Local Cryptographic IndexedDB</span>
                        <span><strong style={{ color: '#00f0ff' }}>Algorithm:</strong> {selectedEvidence.integrity?.algorithm || 'SHA-256'}</span>
                        <span><strong style={{ color: '#00f0ff' }}>Ledger ID:</strong> <span className="font-mono">{selectedEvidence.chainOfCustodyId || selectedEvidence.id}</span></span>
                      </div>
                    </div>
                  </div>

                  {/* Live Integrity Feedback Box */}
                  {integrityStatus.result && (
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 6,
                        background: integrityStatus.result.verified
                          ? 'rgba(61, 255, 176, 0.1)'
                          : 'rgba(255, 75, 75, 0.15)',
                        border: `1px solid ${integrityStatus.result.verified ? '#3dffb0' : '#ff5555'}`,
                        color: integrityStatus.result.verified ? '#3dffb0' : '#ff5555',
                        fontSize: 11,
                        marginBottom: 14,
                      }}
                    >
                      <strong>{integrityStatus.result.verified ? '✓ INTEGRITY MATCH:' : '⚠ MISMATCH DETECTED:'}</strong>{' '}
                      {integrityStatus.result.message}
                      {integrityStatus.result.calculatedHash && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ color: '#94a3b8' }}>Recalculated:</span>
                          <code className="evidence-hash-val" style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 3 }}>
                            {integrityStatus.result.calculatedHash}
                          </code>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Payload Preview */}
                  {selectedEvidence.type === 'TEXT_NOTE' && (
                    <div style={{ marginTop: 10 }}>
                      <span className="evidence-field-label">INVESTIGATIVE TEXT NOTE CONTENT</span>
                      <div className="text-evidence-viewer" style={{ marginTop: 4 }}>
                        {selectedEvidence.notes || '(Empty text note)'}
                      </div>
                    </div>
                  )}

                  {selectedEvidence.type === 'FILE' && (
                    <div style={{ marginTop: 10 }}>
                      <span className="evidence-field-label">SANDBOXED LOCAL BUFFER PREVIEW</span>
                      <div className="text-evidence-viewer" style={{ marginTop: 4 }}>
                        {previewBlobContent || 'File stored in offline indexed vault. Execution is strictly blocked.'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CHAIN OF CUSTODY (Field 9) */}
              {activeTab === 'CUSTODY' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span className="evidence-field-label">9. APPEND-ONLY IMMUTABLE CHAIN OF CUSTODY TIMELINE</span>
                    <span style={{ fontSize: 9, color: '#3dffb0' }}>VERIFIED CHRONOLOGICAL AUDIT</span>
                  </div>

                  {custodyLog.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b' }}>
                      Initial acquisition recorded. Zero external transfers.
                    </div>
                  ) : (
                    <div className="custody-timeline">
                      {custodyLog.map((entry) => (
                        <div key={entry.id} className="custody-entry-card">
                          <div className="custody-dot" />
                          <div className="custody-entry-header">
                            <span className={`custody-action-badge custody-${entry.action}`}>
                              {entry.action.replace(/_/g, ' ')}
                            </span>
                            <span className="custody-time">
                              {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <div className="custody-actor">
                            Actor: <span style={{ color: '#00f0ff' }}>{entry.actorId}</span>
                            {entry.actorRole && <span style={{ color: '#94a3b8' }}> [{entry.actorRole}]</span>}
                          </div>
                          {entry.fromStatus && entry.toStatus && (
                            <div style={{ fontSize: 10, color: '#ffb700', marginBottom: 2 }}>
                              Transition: {entry.fromStatus} → {entry.toStatus}
                            </div>
                          )}
                          {entry.reason && <div className="custody-reason">"{entry.reason}"</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: RELATED CONTEXT & ENTITIES (Fields 6, 7, 8) */}
              {activeTab === 'CONTEXT' && (
                <div>
                  <div style={{ marginBottom: 14 }}>
                    <span className="evidence-field-label">CASE FINDINGS CITING THIS ARTIFACT</span>
                    {caseFindings.filter((f) => f.relatedEvidenceIds?.includes(selectedEvidence.id)).length === 0 ? (
                      <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 4 }}>
                        Not yet cited in any case findings. Click "LINK FINDING" to connect this artifact to an investigation conclusion.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                        {caseFindings
                          .filter((f) => f.relatedEvidenceIds?.includes(selectedEvidence.id))
                          .map((finding) => (
                            <div
                              key={finding.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 12px',
                                borderRadius: 4,
                                background: 'rgba(0, 240, 255, 0.05)',
                                border: '1px solid rgba(0, 240, 255, 0.2)',
                                fontSize: 11,
                              }}
                            >
                              <span style={{ color: '#e0f2fe', fontWeight: 600 }}>{finding.title}</span>
                              <span style={{ color: '#3dffb0', fontSize: 9 }}>CITED IN FINDING</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Threat Intel Profile Trigger */}
                  {(selectedEvidence.type === 'IOC_REFERENCE' || selectedEvidence.sourceType === 'IOC' || selectedEvidence.sourceId?.startsWith('ioc-')) && (
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="reference-jump-btn"
                        style={{ borderColor: '#00f0ff', color: '#00f0ff' }}
                        onClick={() => {
                          cyberAudio.playClick();
                          setSelectedIntelIocId(selectedEvidence.sourceId || 'ioc-001');
                        }}
                      >
                        <ExternalLink size={12} />
                        <span>INSPECT THREAT INTEL PROFILE FOR {selectedEvidence.sourceId}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: NOTES & ANNOTATIONS (Field 10) */}
              {activeTab === 'NOTES' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span className="evidence-field-label">10. ANALYST INVESTIGATIVE NOTES & COMMENTARY</span>
                    <span style={{ fontSize: 9, color: '#94a3b8' }}>{annotations.length} RECORDED</span>
                  </div>

                  {/* Primary Note */}
                  {selectedEvidence.notes && (
                    <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(0, 240, 255, 0.04)', borderRadius: 4, border: '1px solid rgba(0, 240, 255, 0.15)' }}>
                      <span style={{ fontSize: 9, color: '#00f0ff', fontWeight: 700 }}>COLLECTION NOTE:</span>
                      <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>{selectedEvidence.notes}</div>
                    </div>
                  )}

                  {/* Annotation Log */}
                  <div className="annotations-list" style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
                    {annotations.length === 0 ? (
                      <div style={{ color: '#64748b', fontSize: 11, padding: 8 }}>
                        No annotations entered yet. Add notes regarding relevance or provenance anomalies below.
                      </div>
                    ) : (
                      annotations.map((anno) => (
                        <div key={anno.id} className="annotation-bubble">
                          <div className="annotation-meta">
                            <span className="annotation-author">{anno.authorId}</span>
                            <span className="annotation-time">{new Date(anno.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="annotation-text">{anno.content}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* New Annotation Form */}
                  <form className="annotation-form" onSubmit={handleAddAnnotation}>
                    <textarea
                      className="annotation-textarea"
                      placeholder={userCanAnnotate ? 'Enter investigative analysis or annotation...' : 'Requires Analyst role to annotate'}
                      value={newAnnotationText}
                      onChange={(e) => setNewAnnotationText(e.target.value)}
                      disabled={!userCanAnnotate}
                    />
                    <button
                      type="submit"
                      className="evidence-btn-action evidence-btn-primary"
                      disabled={!userCanAnnotate || !newAnnotationText.trim()}
                      style={{ justifyContent: 'center' }}
                      title={userCanAnnotate ? 'Post annotation to immutable evidence log' : 'Requires EVIDENCE_ANNOTATE permission'}
                    >
                      <Send size={12} />
                      <span>POST ANNOTATION</span>
                    </button>
                  </form>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', gap: 10 }}>
            <FileText size={32} />
            <span style={{ fontSize: 12 }}>SELECT AN EVIDENCE ARTIFACT FROM THE LIST TO INSPECT FORENSIC DOSSIER</span>
          </div>
        )}
      </main>

      {/* ─── MODAL: COLLECT NEW EVIDENCE ──────────────────────────────────────── */}
      {showCollectModal && (
        <div className="evidence-modal-backdrop">
          <div className="evidence-modal-box">
            <div className="evidence-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={14} color="#00f0ff" />
                <span style={{ fontSize: 12, fontWeight: 700 }}>COLLECT FORENSIC EVIDENCE ARTIFACT</span>
              </div>
              <button className="evidence-modal-close" onClick={() => setShowCollectModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCollectSubmit} className="evidence-modal-form">
              <div className="form-group">
                <label className="form-label">ASSOCIATED CASE</label>
                <select
                  value={formCaseId}
                  onChange={(e) => setFormCaseId(e.target.value)}
                  className="form-input"
                >
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.caseNumber}: {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">EVIDENCE TYPE</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as EvidenceType)}
                  className="form-input"
                >
                  <option value="EVENT_REFERENCE">EVENT REFERENCE</option>
                  <option value="ALERT_REFERENCE">ALERT REFERENCE</option>
                  <option value="INCIDENT_REFERENCE">INCIDENT REFERENCE</option>
                  <option value="HUNT_REFERENCE">THREAT HUNT REFERENCE</option>
                  <option value="IOC_REFERENCE">IOC REFERENCE</option>
                  <option value="TEXT_NOTE">INVESTIGATIVE TEXT NOTE</option>
                  <option value="FILE">LOCAL FILE ARTIFACT</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">EVIDENCE TITLE</label>
                <input
                  type="text"
                  placeholder="e.g. Memory Dump ws-finance-04 / Cobalt Strike Beacon"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">DESCRIPTION / PROVENANCE NOTES</label>
                <textarea
                  placeholder="Technical acquisition notes, integrity parameters, or relevance..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="form-input"
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label className="form-label">TAGS (COMMA SEPARATED)</label>
                <input
                  type="text"
                  placeholder="forensics, memory, persistence, blacktide"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  className="form-input"
                />
              </div>

              {/* Source suggestions */}
              <div className="quick-suggestions-box">
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 4 }}>
                  QUICK BIND TO LIVE INVESTIGATION TELEMETRY:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {availableIncidents.slice(0, 2).map((inc) => (
                    <button
                      type="button"
                      key={inc.id}
                      className="suggestion-chip"
                      onClick={() => handleSelectQuickSource('INCIDENT_REFERENCE', 'INCIDENT', inc.id, inc.title)}
                    >
                      Inc: {inc.id}
                    </button>
                  ))}
                  {availableAlerts.slice(0, 2).map((alt) => (
                    <button
                      type="button"
                      key={alt.id}
                      className="suggestion-chip"
                      onClick={() => handleSelectQuickSource('ALERT_REFERENCE', 'ALERT', alt.id, alt.title)}
                    >
                      Alert: {alt.title.slice(0, 16)}…
                    </button>
                  ))}
                  {availableIocs.slice(0, 2).map((ioc) => (
                    <button
                      type="button"
                      key={ioc.id}
                      className="suggestion-chip"
                      onClick={() => handleSelectQuickSource('IOC_REFERENCE', 'IOC', ioc.id, ioc.value)}
                    >
                      IOC: {ioc.value}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="evidence-btn-action"
                  onClick={() => setShowCollectModal(false)}
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="evidence-btn-action evidence-btn-primary"
                >
                  <Plus size={11} /> SEAL & COLLECT ARTIFACT
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: LINK TO CASE FINDING ──────────────────────────────────────── */}
      {showLinkFindingModal && selectedEvidence && (
        <div className="evidence-modal-backdrop">
          <div className="evidence-modal-box">
            <div className="evidence-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Link2 size={14} color="#00f0ff" />
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  LINK {selectedEvidence.evidenceNumber} TO CASE FINDING
                </span>
              </div>
              <button className="evidence-modal-close" onClick={() => setShowLinkFindingModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
                Select an investigative finding to cite this artifact as supporting evidence:
              </div>

              {caseFindings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                  No findings created in case {selectedEvidence.caseId}. Create findings in the Case Workspace first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {caseFindings.map((finding) => (
                    <button
                      key={finding.id}
                      className="evidence-btn-action"
                      style={{ justifyContent: 'space-between', padding: '8px 12px' }}
                      onClick={() => handleLinkToFinding(finding.id)}
                    >
                      <span style={{ fontWeight: 600 }}>{finding.title}</span>
                      <span style={{ fontSize: 9, color: '#3dffb0' }}>
                        {finding.relatedEvidenceIds?.includes(selectedEvidence.id) ? 'ALREADY LINKED' : '+ LINK'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Threat Intel Profile Drawer/Modal */}
      {selectedIntelIocId && (
        <ThreatIntelProfile
          indicatorId={selectedIntelIocId}
          onClose={() => setSelectedIntelIocId(null)}
          onPivot={(id, type) => {
            if (type === 'INCIDENT' && onInvestigateIncident) {
              onInvestigateIncident(id);
            }
          }}
        />
      )}
    </div>
  );
}

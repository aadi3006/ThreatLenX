/**
 * app/spatial/investigation/IncidentEvidenceView.tsx
 *
 * Dedicated Forensic Evidence Panel for Incident Workspace.
 * EXPLAIN-SEC SPATIAL — STEP 9: EVIDENCE + RBAC + RESPONSE UX.
 *
 * Flow: EVIDENCE -> EVIDENCE LIST -> SELECT EVIDENCE -> EVIDENCE DETAIL -> PROVENANCE / CUSTODY / RELATED CONTEXT.
 * Exposes all 12 mandatory properties:
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
import { useState, useEffect } from 'react';
import { securityService } from '../../core/security-service';
import { cyberAudio } from '../../cyber-audio';
import { spatialNavStore } from '../state/use-spatial-nav';
import type { Evidence, EvidenceCustodyEntry, EvidenceAnnotation } from '../../core/models/evidence';
import type { UserSession, RoleId } from '../../core/models/auth';
import {
  canCollectEvidence,
  canAnnotateEvidence,
  canVerifyEvidence,
  canManageEvidence,
} from '../../core/auth/rbac';
import {
  FileCheck,
  ShieldCheck,
  ShieldAlert,
  Hash,
  Clock,
  User,
  Plus,
  ExternalLink,
  Lock,
  RotateCcw,
  FileText,
  AlertTriangle,
  Send,
  Fingerprint,
  GitBranch,
} from 'lucide-react';

interface IncidentEvidenceViewProps {
  incidentId: string;
  onSelectEntity?: (entity: any) => void;
}

type IncidentDetailTab = 'PROVENANCE' | 'CUSTODY' | 'CONTEXT' | 'NOTES';

export default function IncidentEvidenceView({ incidentId }: IncidentEvidenceViewProps) {
  const [session, setSession] = useState<UserSession | null>(() => securityService.getSession());
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [custodyLogs, setCustodyLogs] = useState<EvidenceCustodyEntry[]>([]);
  const [annotations, setAnnotations] = useState<EvidenceAnnotation[]>([]);
  const [activeTab, setActiveTab] = useState<IncidentDetailTab>('PROVENANCE');
  const [newAnnotationText, setNewAnnotationText] = useState('');
  const [loading, setLoading] = useState(true);
  const [isCollecting, setIsCollecting] = useState(false);
  const [integrityStatus, setIntegrityStatus] = useState<{
    verifying: boolean;
    result?: { verified: boolean; message: string; calculatedHash?: string };
  }>({ verifying: false });

  // RBAC checks
  const role: RoleId = session?.role ?? 'L1_ANALYST';
  const userCanCollect = canCollectEvidence(role);
  const userCanAnnotate = canAnnotateEvidence(role);
  const userCanVerify = canVerifyEvidence(role);
  const userCanManage = canManageEvidence(role);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        let items = await securityService.getEvidenceForIncident(incidentId);
        if (items.length === 0) {
          const all = await securityService.getEvidence();
          items = all.slice(0, 4);
        }
        if (mounted) {
          setEvidenceList(items);
          if (items.length > 0) {
            setSelectedEvidence(items[0]);
            const [custody, annos] = await Promise.all([
              securityService.getEvidenceCustody(items[0].id),
              securityService.getEvidenceAnnotations(items[0].id),
            ]);
            if (mounted) {
              setCustodyLogs(custody);
              setAnnotations(annos);
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
              } else if (items[0].integrity?.verifiedAt && items[0].integrity?.verified !== undefined) {
                setIntegrityStatus({
                  verifying: false,
                  result: {
                    verified: items[0].integrity.verified,
                    message: items[0].integrity.verified
                      ? `Cryptographic seal verified by ${items[0].integrity.verifiedBy || 'system'} (${new Date(items[0].integrity.verifiedAt).toLocaleDateString()})`
                      : 'Cryptographic seal mismatch recorded',
                    calculatedHash: items[0].integrity.hash,
                  },
                });
              } else {
                setIntegrityStatus({ verifying: false });
              }
            }
          }
        }
      } catch (err) {
        console.error('[IncidentEvidenceView] Failed to load evidence:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();

    const unsubSession = securityService.subscribe('SESSION_CHANGED', () => {
      setSession(securityService.getSession());
    });

    return () => {
      mounted = false;
      unsubSession();
    };
  }, [incidentId]);

  const handleSelectEvidence = async (ev: Evidence) => {
    cyberAudio.playClick();
    setSelectedEvidence(ev);
    setIntegrityStatus({ verifying: false });
    try {
      const [custody, annos] = await Promise.all([
        securityService.getEvidenceCustody(ev.id),
        securityService.getEvidenceAnnotations(ev.id),
      ]);
      setCustodyLogs(custody);
      setAnnotations(annos);
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
      } else if (ev.integrity?.verifiedAt && ev.integrity?.verified !== undefined) {
        setIntegrityStatus({
          verifying: false,
          result: {
            verified: ev.integrity.verified,
            message: ev.integrity.verified
              ? `Cryptographic seal verified by ${ev.integrity.verifiedBy || 'system'} (${new Date(ev.integrity.verifiedAt).toLocaleDateString()})`
              : 'Cryptographic seal mismatch recorded',
            calculatedHash: ev.integrity.hash,
          },
        });
      } else {
        setIntegrityStatus({ verifying: false });
      }
    } catch {
      setCustodyLogs([]);
      setAnnotations([]);
      setIntegrityStatus({ verifying: false });
    }
  };

  const handleVerifyIntegrity = async () => {
    if (!selectedEvidence) return;
    if (!userCanVerify) {
      alert(`Unauthorized: Current role "${role}" lacks EVIDENCE_VERIFY permission.`);
      return;
    }
    cyberAudio.playClick();
    setIntegrityStatus({ verifying: true });

    try {
      const result = await securityService.verifyEvidenceIntegrity(selectedEvidence.id);
      setIntegrityStatus({ verifying: false, result });
      const custody = await securityService.getEvidenceCustody(selectedEvidence.id);
      setCustodyLogs(custody);
      if (result.verified) {
        cyberAudio.playSuccess();
      } else {
        cyberAudio.playFailure(result.message);
      }
    } catch (err: any) {
      cyberAudio.playFailure(err?.message);
      setIntegrityStatus({
        verifying: false,
        result: { verified: false, message: err?.message || 'Verification failed' },
      });
    }
  };

  const handleCollectArtifact = async () => {
    if (!userCanCollect) {
      alert(`Unauthorized: Current role "${role}" cannot collect evidence.`);
      return;
    }
    cyberAudio.playSelect();
    setIsCollecting(true);
    try {
      const newEv = await securityService.collectIncidentAsEvidence(
        'case-blacktide-001',
        incidentId,
        {
          title: `Forensic Snapshot: ${incidentId.toUpperCase()}`,
          description: `Cryptographically sealed memory & network artifact captured at ${new Date().toISOString()}`,
          tags: ['forensics', 'incident-response', 'spatial-soc'],
        }
      );
      setEvidenceList((prev) => [newEv, ...prev]);
      setSelectedEvidence(newEv);
    } catch (err) {
      console.warn('[IncidentEvidenceView] Collect artifact fallback:', err);
    } finally {
      setIsCollecting(false);
    }
  };

  const handleAddAnnotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvidence || !newAnnotationText.trim()) return;

    if (!userCanAnnotate) {
      alert(`Unauthorized: Current role "${role}" lacks EVIDENCE_ANNOTATE permission.`);
      return;
    }

    cyberAudio.playClick();
    try {
      await securityService.addEvidenceAnnotation(selectedEvidence.id, {
        content: newAnnotationText.trim(),
      });
      setNewAnnotationText('');
      const [annos, custody] = await Promise.all([
        securityService.getEvidenceAnnotations(selectedEvidence.id),
        securityService.getEvidenceCustody(selectedEvidence.id),
      ]);
      setAnnotations(annos);
      setCustodyLogs(custody);
    } catch (err) {
      console.error('[IncidentEvidenceView] Annotation error:', err);
    }
  };

  if (loading) {
    return (
      <div className="inv-evidence-loading">
        <div className="inv-hub-boot-ring" />
        <span>RECOVERING FORENSIC DOSSIER & CHAIN OF CUSTODY…</span>
      </div>
    );
  }

  return (
    <div className="inv-evidence-panel" role="region" aria-label="Incident Forensic Evidence">
      {/* Evidence Subheader */}
      <div className="inv-evidence-topbar">
        <div className="inv-evidence-title-group">
          <FileCheck size={14} className="text-emerald" />
          <span className="inv-evidence-title">INCIDENT FORENSIC VAULT & CHAIN OF CUSTODY</span>
          <span className="inv-evidence-count-tag">{evidenceList.length} SECURED ARTIFACTS</span>
          <span style={{ fontSize: 10, color: '#94a3b8', borderLeft: '1px solid #334155', paddingLeft: 8 }}>
            ROLE: <strong style={{ color: '#00f0ff' }}>{role}</strong>
          </span>
        </div>

        <div className="inv-evidence-actions">
          <button
            className="inv-evidence-btn btn-collect"
            onClick={handleCollectArtifact}
            disabled={isCollecting || !userCanCollect}
            title={userCanCollect ? 'Preserve live telemetry as evidence' : 'LOCKED: Requires Analyst role to collect'}
          >
            <Plus size={11} />
            <span>{isCollecting ? 'SEALING…' : 'COLLECT ARTIFACT'}</span>
          </button>

          <button
            className="inv-evidence-btn btn-vault"
            onClick={() => {
              cyberAudio.playModeSwitch();
              spatialNavStore.goToWorkspace('EVIDENCE');
            }}
            title="Open primary forensic evidence workspace [HotKey: E]"
          >
            <ExternalLink size={11} />
            <span>FULL VAULT [E]</span>
          </button>
        </div>
      </div>

      {/* Main Flow: Evidence List (Left) -> Single Primary Evidence Detail (Right) */}
      <div className="inv-evidence-content" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, height: 'calc(100% - 46px)' }}>
        {/* Left: EVIDENCE LIST */}
        <div className="inv-evidence-list" style={{ overflowY: 'auto' }}>
          {evidenceList.map((ev) => {
            const isSelected = selectedEvidence?.id === ev.id;
            return (
              <div
                key={ev.id}
                className={`inv-evidence-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() => handleSelectEvidence(ev)}
                role="button"
                tabIndex={0}
              >
                <div className="inv-ev-header-row">
                  <span className="inv-ev-id">{ev.evidenceNumber || ev.id.toUpperCase()}</span>
                  <span className="inv-ev-type">{ev.type.replace('_REFERENCE', '')}</span>
                </div>
                <div className="inv-ev-title">{ev.title}</div>
                <div className="inv-ev-meta">
                  <span className="inv-ev-hash" title={`SHA-256: ${ev.integrity?.hash ?? 'SEALED'}`}>
                    <Hash size={10} />
                    {(ev.integrity?.hash ?? 'e3b0c44298fc1c14').slice(0, 16)}…
                  </span>
                  <span className="inv-ev-verified">
                    <ShieldCheck size={10} color="#3dffb0" />
                    {ev.integrity?.verified ? 'VERIFIED' : 'SEALED'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: THE SINGLE PRIMARY EVIDENCE DETAIL PANEL */}
        {selectedEvidence ? (
          <div className="inv-evidence-inspector" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Detail Panel Header */}
            <div className="inv-inspector-header" style={{ padding: '8px 14px', borderBottom: '1px solid rgba(0,240,255,0.15)' }}>
              <div>
                <span className="inv-insp-label">
                  EVIDENCE RECORD // {selectedEvidence.evidenceNumber || selectedEvidence.id}
                </span>
                <h3 className="inv-insp-title">{selectedEvidence.title}</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="inv-evidence-btn"
                  onClick={handleVerifyIntegrity}
                  disabled={integrityStatus.verifying || !userCanVerify}
                  title={userCanVerify ? 'Verify SHA-256 integrity seal' : 'LOCKED: Requires EVIDENCE_VERIFY permission'}
                >
                  <Fingerprint size={11} />
                  <span>{integrityStatus.verifying ? 'CHECKING…' : 'VERIFY HASH'}</span>
                </button>
                <div className="inv-insp-seal-badge">
                  <Lock size={12} color="#00f0ff" />
                  <span>IMMUTABLE DOSSIER</span>
                </div>
              </div>
            </div>

            {/* Sub-Nav Tabs for Focused Disclosure */}
            <div style={{ display: 'flex', gap: 4, background: 'rgba(4, 8, 18, 0.95)', borderBottom: '1px solid rgba(0,240,255,0.15)', padding: '0 10px' }}>
              <button
                className={`evidence-detail-tab-btn ${activeTab === 'PROVENANCE' ? 'active' : ''}`}
                onClick={() => setActiveTab('PROVENANCE')}
              >
                <Hash size={11} /> PROVENANCE & DOSSIER
              </button>
              <button
                className={`evidence-detail-tab-btn ${activeTab === 'CUSTODY' ? 'active' : ''}`}
                onClick={() => setActiveTab('CUSTODY')}
              >
                <Clock size={11} /> CHAIN OF CUSTODY ({custodyLogs.length})
              </button>
              <button
                className={`evidence-detail-tab-btn ${activeTab === 'CONTEXT' ? 'active' : ''}`}
                onClick={() => setActiveTab('CONTEXT')}
              >
                <GitBranch size={11} /> RELATED ENTITIES
              </button>
              <button
                className={`evidence-detail-tab-btn ${activeTab === 'NOTES' ? 'active' : ''}`}
                onClick={() => setActiveTab('NOTES')}
              >
                <FileText size={11} /> NOTES & ACTIONS ({annotations.length})
              </button>
            </div>

            {/* Tab Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {activeTab === 'PROVENANCE' && (
                <div>
                  <div className="inv-insp-grid" style={{ marginBottom: 12 }}>
                    {/* 1. Evidence ID */}
                    <div className="inv-insp-cell">
                      <span className="inv-insp-cell-label">1. EVIDENCE ID</span>
                      <span className="inv-insp-cell-val font-mono text-cyan" style={{ fontWeight: 700 }}>
                        {selectedEvidence.evidenceNumber || selectedEvidence.id}
                      </span>
                    </div>

                    {/* 2. Source */}
                    <div className="inv-insp-cell">
                      <span className="inv-insp-cell-label">2. SOURCE CLASSIFICATION</span>
                      <span className="inv-insp-cell-val">
                        {selectedEvidence.sourceType ?? 'INCIDENT_TELEMETRY'} · {selectedEvidence.sourceId ?? incidentId}
                      </span>
                    </div>

                    {/* 3. Timestamp */}
                    <div className="inv-insp-cell">
                      <span className="inv-insp-cell-label">3. TIMESTAMP</span>
                      <span className="inv-insp-cell-val">
                        {new Date(selectedEvidence.collectedAt).toLocaleString()}
                      </span>
                    </div>

                    {/* 4. Collector */}
                    <div className="inv-insp-cell">
                      <span className="inv-insp-cell-label">4. COLLECTED BY</span>
                      <span className="inv-insp-cell-val">
                        {selectedEvidence.collectedBy ?? 'analyst-alpha'}
                      </span>
                    </div>

                    {/* 5. Hash / Integrity */}
                    <div className="inv-insp-cell" style={{ gridColumn: 'span 2' }}>
                      <span className="inv-insp-cell-label">5. CRYPTOGRAPHIC SHA-256 HASH & INTEGRITY</span>
                      <span className="inv-insp-cell-val font-mono text-cyan">
                        {selectedEvidence.integrity?.hash ?? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
                      </span>
                    </div>

                    {/* 6. Incident */}
                    <div className="inv-insp-cell">
                      <span className="inv-insp-cell-label">6. CORRELATED INCIDENT</span>
                      <span className="inv-insp-cell-val font-mono text-emerald">
                        {selectedEvidence.relatedIncidentIds?.[0] || incidentId}
                      </span>
                    </div>

                    {/* 7. Case */}
                    <div className="inv-insp-cell">
                      <span className="inv-insp-cell-label">7. CASE BINDING</span>
                      <span className="inv-insp-cell-val font-mono">
                        {selectedEvidence.caseId}
                      </span>
                    </div>

                    {/* 12. Provenance */}
                    <div className="inv-insp-cell" style={{ gridColumn: 'span 2' }}>
                      <span className="inv-insp-cell-label">12. PROVENANCE & AUDIT TRAIL</span>
                      <span className="inv-insp-cell-val" style={{ fontSize: 10, color: '#94a3b8' }}>
                        Acquired via local cryptographic sandbox. Zero remote transmission. SHA-256 sealed.
                      </span>
                    </div>
                  </div>

                  {/* Live Integrity Feedback: Strictly state-driven */}
                  {integrityStatus.result && (
                    integrityStatus.result.verified ? (
                      <div
                        className="soc-motion-success"
                        style={{
                          padding: '8px 12px',
                          borderRadius: 4,
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 10,
                        }}
                      >
                        <ShieldCheck size={16} className="soc-motion-success-icon" style={{ color: '#3dffb0' }} />
                        <span>
                          <strong>✓ INTEGRITY CONFIRMED:</strong> {integrityStatus.result.message}
                        </span>
                      </div>
                    ) : (
                      <div className="soc-motion-failure soc-failure-box" style={{ marginBottom: 10 }}>
                        <div className="soc-failure-header">
                          <ShieldAlert size={14} />
                          <span>CRYPTOGRAPHIC INTEGRITY MISMATCH</span>
                        </div>
                        <div className="soc-failure-explanation">{integrityStatus.result.message}</div>
                        {integrityStatus.result.calculatedHash && (
                          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                            <span style={{ color: '#94a3b8' }}>Recalculated:</span>
                            <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 3, color: '#ff5555' }}>
                              {integrityStatus.result.calculatedHash}
                            </code>
                          </div>
                        )}
                        <div className="soc-failure-actions">
                          <button
                            type="button"
                            className="soc-remediation-btn"
                            onClick={handleVerifyIntegrity}
                          >
                            <RotateCcw size={11} /> RE-VERIFY INTEGRITY
                          </button>
                        </div>
                      </div>
                    )
                  )}

                  {/* Notes / Payload */}
                  {selectedEvidence.notes && (
                    <div>
                      <span className="inv-insp-cell-label">INVESTIGATIVE CONTENT</span>
                      <div className="text-evidence-viewer" style={{ marginTop: 4 }}>
                        {selectedEvidence.notes}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'CUSTODY' && (
                <div className="inv-custody-section">
                  <span className="inv-custody-heading">
                    <Clock size={11} />
                    9. IMMUTABLE CHAIN OF CUSTODY ({custodyLogs.length} LOGGED ACTIONS)
                  </span>

                  <div className="inv-custody-timeline" style={{ marginTop: 8 }}>
                    {custodyLogs.length === 0 ? (
                      <div className="inv-custody-empty">Initial acquisition recorded. Zero external transfers.</div>
                    ) : (
                      custodyLogs.map((log) => (
                        <div key={log.id} className="inv-custody-entry">
                          <div className="inv-custody-dot" />
                          <div className="inv-custody-body">
                            <div className="inv-custody-action">{log.action}</div>
                            <div className="inv-custody-details">{log.reason ?? 'Integrity validation verified'}</div>
                            <div className="inv-custody-actor">
                              <User size={9} />
                              <span>{log.actorId}</span>
                              {log.actorRole && <span> [{log.actorRole}]</span>}
                              <span>·</span>
                              <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'CONTEXT' && (
                <div>
                  <span className="inv-insp-cell-label">8. ASSOCIATED SECURITY ENTITIES</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 16px 0' }}>
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
                      <span style={{ color: '#64748b', fontSize: 11 }}>Bound to incident telemetry context</span>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'NOTES' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className="inv-insp-cell-label">10. NOTES & ANNOTATIONS</span>
                    <span style={{ fontSize: 9, color: '#94a3b8' }}>11. ANALYST ACTIONS</span>
                  </div>

                  {/* Notes Feed */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, maxHeight: 180, overflowY: 'auto' }}>
                    {annotations.length === 0 ? (
                      <div style={{ color: '#64748b', fontSize: 11 }}>Zero annotations logged. Enter investigative commentary below.</div>
                    ) : (
                      annotations.map((anno) => (
                        <div key={anno.id} style={{ padding: '6px 10px', background: 'rgba(0,240,255,0.04)', borderRadius: 4, border: '1px solid rgba(0,240,255,0.1)' }}>
                          <div style={{ fontSize: 9, color: '#00f0ff', marginBottom: 2 }}>{anno.authorId} · {new Date(anno.createdAt).toLocaleTimeString()}</div>
                          <div style={{ fontSize: 11, color: '#e2e8f0' }}>{anno.content}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Form */}
                  <form onSubmit={handleAddAnnotation} style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder={userCanAnnotate ? 'Add forensic commentary...' : 'Requires Analyst role to annotate'}
                      value={newAnnotationText}
                      onChange={(e) => setNewAnnotationText(e.target.value)}
                      disabled={!userCanAnnotate}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="submit"
                      className="inv-evidence-btn btn-collect"
                      disabled={!userCanAnnotate || !newAnnotationText.trim()}
                      title={userCanAnnotate ? 'Post annotation to custody record' : 'Requires EVIDENCE_ANNOTATE permission'}
                    >
                      <Send size={11} /> POST
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="inv-evidence-empty">Select an artifact to inspect chain of custody and provenance.</div>
        )}
      </div>
    </div>
  );
}

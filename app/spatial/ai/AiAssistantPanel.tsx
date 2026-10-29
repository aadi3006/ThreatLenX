/**
 * AiAssistantPanel.tsx
 *
 * Real Offline AI Investigation Assistant (Analyst Copilot) embedded in EXPLAIN-SEC Spatial.
 * 100% offline, zero network egress, fully grounded in canonical SecurityService data.
 * Adheres strictly to the OBSERVED / DERIVED / HYPOTHESIS / UNKNOWN classification,
 * explicit uncertainty states, and human-in-the-loop Action Proposal boundaries.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Brain,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  Layers,
  Crosshair,
  Search,
  RefreshCw,
  X,
  Lock,
  Activity,
  Cpu,
} from 'lucide-react';
import { securityService } from '../../core/security-service';
import {
  InvestigationContext,
  AIInvestigationResponse,
  AIActionProposal,
  ClaimCategory,
  TargetEntityType,
  AIResponseType,
} from '../../core/models/ai';
import { cyberAudio } from '../../cyber-audio';
import { PerformanceMode } from '../performance-mode';
import './ai-assistant.css';

export interface AiAssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  targetIncidentId?: string | null;
  targetEntity?: {
    id: string;
    type: TargetEntityType;
  } | null;
  perfMode?: PerformanceMode;
  onNavigateToIncident?: (incidentId: string) => void;
  onNavigateToHunt?: (huntId?: string) => void;
  onNavigateToCases?: () => void;
  onNavigateToEvidence?: () => void;
}

type TabKey = 'SUMMARY' | 'FINDINGS' | 'PROPOSALS' | 'HUNT' | 'QUESTIONS' | 'PROVENANCE';

export const AiAssistantPanel: React.FC<AiAssistantPanelProps> = ({
  isOpen,
  onClose,
  targetIncidentId,
  targetEntity,
  perfMode = 'FULL',
  onNavigateToIncident,
  onNavigateToHunt,
  onNavigateToCases,
  onNavigateToEvidence,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('SUMMARY');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<InvestigationContext | null>(null);
  const [analysis, setAnalysis] = useState<AIInvestigationResponse | null>(null);
  const [proposals, setProposals] = useState<AIActionProposal[]>([]);
  const [analystQuery, setAnalystQuery] = useState<string>('');
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<ClaimCategory | 'ALL'>('ALL');
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  const prevTargetRef = useRef<string>('');

  // Determine active context target ID & type
  const activeTargetId = targetEntity?.id || targetIncidentId || 'SOC-GLOBAL';
  const activeTargetType: TargetEntityType = targetEntity?.type || (targetIncidentId ? 'INCIDENT' : 'GENERAL');

  // Load context and generate baseline analysis
  const refreshAnalysis = useCallback(async (customPrompt?: string, forcedType?: AIResponseType) => {
    setIsLoading(true);
    setError(null);
    setActionSuccessMsg(null);

    try {
      // 1. Build canonical RBAC-filtered bounded context
      const builtContext = await securityService.buildInvestigationContext(
        activeTargetType,
        activeTargetId,
        {
          maxEvents: perfMode === 'LOW' ? 20 : 50,
        }
      );
      setContext(builtContext);

      // Determine response type based on target & prompt
      let resolvedType: AIResponseType = forcedType || 'GENERAL_INVESTIGATION';
      if (!forcedType) {
        if (builtContext.targetType === 'INCIDENT') resolvedType = 'INCIDENT_SUMMARY';
        else if (builtContext.targetType === 'ALERT') resolvedType = 'DETECTION_EXPLANATION';
        else if (builtContext.targetType === 'IOC') resolvedType = 'THREAT_INTEL_SUMMARY';
        else if (builtContext.targetType === 'SIMULATION') resolvedType = 'SIMULATION_ANALYSIS';
        else if (builtContext.targetType === 'ASSET' || builtContext.targetType === 'USER') resolvedType = 'ENTITY_EXPLANATION';
        else if (builtContext.targetType === 'RULE') resolvedType = 'DETECTION_EXPLANATION';
        else if (builtContext.targetType === 'EVIDENCE') resolvedType = 'EVIDENCE_SUMMARY';
        else if (builtContext.targetType === 'CASE') resolvedType = 'CASE_SUMMARY';
      }

      // 2. Generate deterministic grounded analysis
      const generated = await securityService.generateAiAnalysis(
        builtContext,
        resolvedType,
        customPrompt
      );
      setAnalysis(generated);

      // 3. Load active action proposals for this context
      const contextProposals = await securityService.getAiActionProposals({
        contextId: builtContext.contextId,
      });
      setProposals(contextProposals);

      cyberAudio.playScan();
    } catch (err: any) {
      console.error('[AiAssistantPanel] Analysis failure:', err);
      setError(err?.message || 'Failed to generate offline AI analysis.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTargetId, activeTargetType, perfMode]);

  // Context transition: refresh when target entity or incident changes
  useEffect(() => {
    const key = `${activeTargetType}:${activeTargetId}`;
    if (isOpen && key !== prevTargetRef.current) {
      prevTargetRef.current = key;
      refreshAnalysis();
    }
  }, [isOpen, activeTargetId, activeTargetType, refreshAnalysis]);

  // Handle analyst prompt submission
  const handleQuerySubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!analystQuery.trim()) return;

    cyberAudio.playClick();
    const query = analystQuery.trim().toLowerCase();

    let forcedType: AIResponseType | undefined;
    if (query.includes('timeline') || query.includes('when')) forcedType = 'TIMELINE_SUMMARY';
    else if (query.includes('hunt') || query.includes('search')) forcedType = 'HUNT_GUIDANCE';
    else if (query.includes('correlation') || query.includes('why grouped')) forcedType = 'CORRELATION_EXPLANATION';
    else if (query.includes('detection') || query.includes('rule') || query.includes('alert')) forcedType = 'DETECTION_EXPLANATION';
    else if (query.includes('intel') || query.includes('reputation') || query.includes('ioc')) forcedType = 'THREAT_INTEL_SUMMARY';
    else if (query.includes('response') || query.includes('isolate') || query.includes('soar')) forcedType = 'RESPONSE_EXPLANATION';
    else if (query.includes('simulation') || query.includes('range')) forcedType = 'SIMULATION_ANALYSIS';

    await refreshAnalysis(analystQuery, forcedType);
    setAnalystQuery('');
  };

  // Handle action proposal acceptance (Routes into SOAR)
  const handleAcceptProposal = async (proposalId: string) => {
    cyberAudio.playSelect();
    try {
      const res = await securityService.acceptAiActionProposal(proposalId);
      setActionSuccessMsg(`Proposal accepted: Action dispatched to SOAR automation pipeline.`);
      setProposals(prev => prev.map(p => p.proposalId === proposalId ? res.proposal : p));
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(`Failed to execute proposed action: ${err?.message}`);
    }
  };

  // Handle action proposal rejection
  const handleRejectProposal = async (proposalId: string) => {
    cyberAudio.playClick();
    try {
      const updated = await securityService.rejectAiActionProposal(proposalId, 'Rejected by SOC analyst during review');
      setProposals(prev => prev.map(p => p.proposalId === proposalId ? updated : p));
    } catch (err: any) {
      setError(`Failed to reject proposal: ${err?.message}`);
    }
  };

  // Handle Hunt Copilot: formulate and create threat hunt
  const handleExecuteProposedHunt = async () => {
    if (!context) return;
    cyberAudio.playModeSwitch();
    try {
      const assetIds = (context.relatedAssets as any[]).map(a => a?.id).filter(Boolean);
      const iocValues = (context.relatedIOCs as any[]).map(i => i?.value).filter(Boolean);

      const createdHunt = await securityService.createThreatHunt({
        name: `AI Hunt: ${context.title.slice(0, 32)}`,
        description: `Evidence-grounded threat hunt formulated by Offline AI Copilot for ${context.targetId}`,
        notes: `Correlated anomalous behavior across ${assetIds.length} assets and ${iocValues.length} IOCs`,
        query: {
          text: iocValues.join(' '),
          assetIds: assetIds.length > 0 ? assetIds : undefined,
          eventTypes: ['PROCESS_LAUNCH', 'NETWORK_CONNECT', 'AUTHENTICATION'],
          startTime: new Date(Date.now() - 86400000).toISOString(),
          endTime: new Date().toISOString(),
        },
        tags: ['ai-copilot', 'step-13'],
      });

      setActionSuccessMsg(`Hunt "${createdHunt.name}" initialized and ready for execution in Hunt Workspace.`);
      if (onNavigateToHunt) {
        onNavigateToHunt(createdHunt.id);
      }
    } catch (err: any) {
      setError(`Failed to formulate hunt: ${err?.message}`);
    }
  };

  const totalFindingsCount = useMemo(() => {
    if (!analysis) return 0;
    return (
      analysis.findings.observed.length +
      analysis.findings.derived.length +
      analysis.findings.hypotheses.length +
      analysis.findings.unknown.length
    );
  }, [analysis]);

  if (!isOpen) return null;

  return (
    <aside
      className={`ai-assistant-drawer ${!isOpen ? 'collapsed' : ''}`}
      role="region"
      aria-label="AI Investigation Assistant"
    >
      {/* ─── Header ───────────────────────────────────────────────────────────── */}
      <div className="ai-header">
        <div className="ai-header-left">
          <div className="ai-icon-beacon">
            <Brain size={16} />
          </div>
          <div className="ai-title-wrap">
            <span className="ai-title">INVESTIGATION COPILOT</span>
            <span className="ai-subtitle">DETERMINISTIC LOCAL ENGINE · OFFLINE</span>
          </div>
        </div>

        <div className="ai-header-right">
          <button
            className="ai-close-btn"
            onClick={() => refreshAnalysis()}
            disabled={isLoading}
            title="Re-run Grounded Analysis"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button className="ai-close-btn" onClick={onClose} title="Close Assistant [A]">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ─── Context Ribbon ───────────────────────────────────────────────────── */}
      <div className="ai-context-ribbon">
        <div className="ai-context-target">
          <span className="ai-tag-type">{context?.targetType || activeTargetType}</span>
          <span className="ai-target-title">
            {context?.title || activeTargetId}
          </span>
        </div>

        {analysis && (
          <span className={`ai-uncertainty-pill ${analysis.uncertainty.toLowerCase()}`}>
            {analysis.uncertainty.replace('_', ' ')} ({analysis.supportingEvidence.length} REFS)
          </span>
        )}
      </div>

      {/* ─── Feedback / Alert Banners ─────────────────────────────────────────── */}
      {actionSuccessMsg && (
        <div style={{ background: 'rgba(61, 255, 176, 0.15)', borderBottom: '1px solid #3dffb0', color: '#3dffb0', padding: '6px 16px', fontSize: 10 }}>
          {actionSuccessMsg}
        </div>
      )}
      {error && (
        <div style={{ background: 'rgba(255, 42, 42, 0.15)', borderBottom: '1px solid #ff2a2a', color: '#ff2a2a', padding: '6px 16px', fontSize: 10 }}>
          {error}
        </div>
      )}

      {/* ─── Tabs ─────────────────────────────────────────────────────────────── */}
      <nav className="ai-tabs">
        <button
          className={`ai-tab ${activeTab === 'SUMMARY' ? 'active' : ''}`}
          onClick={() => setActiveTab('SUMMARY')}
        >
          SUMMARY
        </button>
        <button
          className={`ai-tab ${activeTab === 'FINDINGS' ? 'active' : ''}`}
          onClick={() => setActiveTab('FINDINGS')}
        >
          FINDINGS ({totalFindingsCount})
        </button>
        <button
          className={`ai-tab ${activeTab === 'PROPOSALS' ? 'active' : ''}`}
          onClick={() => setActiveTab('PROPOSALS')}
        >
          PROPOSALS ({proposals.length})
        </button>
        <button
          className={`ai-tab ${activeTab === 'HUNT' ? 'active' : ''}`}
          onClick={() => setActiveTab('HUNT')}
        >
          HUNT COPILOT
        </button>
        <button
          className={`ai-tab ${activeTab === 'QUESTIONS' ? 'active' : ''}`}
          onClick={() => setActiveTab('QUESTIONS')}
        >
          QUESTIONS ({analysis?.questions.length || 0})
        </button>
        <button
          className={`ai-tab ${activeTab === 'PROVENANCE' ? 'active' : ''}`}
          onClick={() => setActiveTab('PROVENANCE')}
        >
          PROVENANCE
        </button>
      </nav>

      {/* ─── Main Content Scroll Area ─────────────────────────────────────────── */}
      <div className="ai-body">
        {isLoading && !analysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#00f0ff' }}>
            <Cpu size={28} className="animate-spin" />
            <span style={{ fontSize: 11, letterSpacing: 1 }}>ASSEMBLING CANONICAL CONTEXT…</span>
          </div>
        ) : null}

        {/* ── Tab: SUMMARY ────────────────────────────────────────────────────── */}
        {activeTab === 'SUMMARY' && analysis && (
          <>
            <div className="ai-summary-card">
              <div className="ai-summary-lead">Executive Investigation Summary</div>
              <p>{analysis.summary}</p>
            </div>

            {/* Context Highlights */}
            {context && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 10 }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ color: '#94a3b8', display: 'block', fontSize: 9 }}>CORRELATED EVENTS</span>
                  <strong style={{ color: '#00f0ff' }}>{context.relatedEvents.length} Observed</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ color: '#94a3b8', display: 'block', fontSize: 9 }}>CORRELATED ALERTS</span>
                  <strong style={{ color: '#ffb700' }}>{context.relatedAlerts.length} Active</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ color: '#94a3b8', display: 'block', fontSize: 9 }}>ASSETS AT RISK</span>
                  <strong style={{ color: '#3dffb0' }}>{context.relatedAssets.length} Systems</strong>
                </div>
              </div>
            )}

            {/* Next Step Recommendations */}
            <div className="ai-findings-category">
              <div className="ai-category-header" style={{ color: '#00f0ff' }}>
                <Activity size={12} />
                <span>RECOMMENDED INVESTIGATION STEPS (NON-DESTRUCTIVE)</span>
              </div>
              {analysis.recommendedNextSteps.map((step, idx) => (
                <div key={idx} className="ai-finding-item derived" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{step.title}</span>
                    <span style={{ fontSize: 9, color: step.isDestructive ? '#ff2a2a' : '#3dffb0' }}>
                      {step.isDestructive ? 'ACTION REQUIRED' : 'INVESTIGATE'}
                    </span>
                  </div>
                  <span style={{ color: '#94a3b8', fontSize: 10 }}>{step.description}</span>
                  <span style={{ color: '#64748b', fontSize: 9, fontStyle: 'italic' }}>Rationale: {step.rationale}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Tab: FINDINGS (OBSERVED / DERIVED / HYPOTHESIS / UNKNOWN) ────────── */}
        {activeTab === 'FINDINGS' && analysis && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Filter pills */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {(['ALL', 'OBSERVED', 'DERIVED', 'HYPOTHESIS', 'UNKNOWN'] as const).map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedFilterCategory(cat)}
                  style={{
                    background: selectedFilterCategory === cat ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${selectedFilterCategory === cat ? '#00f0ff' : 'rgba(255,255,255,0.1)'}`,
                    color: selectedFilterCategory === cat ? '#00f0ff' : '#94a3b8',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 9,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* OBSERVED */}
            {(selectedFilterCategory === 'ALL' || selectedFilterCategory === 'OBSERVED') && (
              <div className="ai-findings-category">
                <div className="ai-category-header observed">
                  <CheckCircle size={12} />
                  <span>OBSERVED (CANONICAL FACTS)</span>
                </div>
                {analysis.findings.observed.length === 0 ? (
                  <span style={{ fontSize: 10, color: '#64748b' }}>No observed facts recorded.</span>
                ) : (
                  analysis.findings.observed.map(f => (
                    <div key={f.id} className="ai-finding-item observed">
                      <div>{f.text}</div>
                      <div className="ai-finding-meta">
                        <span>CONFIDENCE: {f.confidenceExplanation}</span>
                        {f.groundingRefs?.map((ref, idx) => (
                          <span key={idx} className="ai-ref-tag" title={ref.summary}>
                            {ref.entityType}:{ref.entityId.slice(0, 10)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* DERIVED */}
            {(selectedFilterCategory === 'ALL' || selectedFilterCategory === 'DERIVED') && (
              <div className="ai-findings-category">
                <div className="ai-category-header derived">
                  <Layers size={12} />
                  <span>DERIVED (ENGINE INFERENCES)</span>
                </div>
                {analysis.findings.derived.length === 0 ? (
                  <span style={{ fontSize: 10, color: '#64748b' }}>No derived inferences recorded.</span>
                ) : (
                  analysis.findings.derived.map(f => (
                    <div key={f.id} className="ai-finding-item derived">
                      <div>{f.text}</div>
                      <div className="ai-finding-meta">
                        <span>CONFIDENCE: {f.confidenceExplanation}</span>
                        {f.groundingRefs?.map((ref, idx) => (
                          <span key={idx} className="ai-ref-tag">
                            {ref.entityType}:{ref.entityId.slice(0, 10)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* HYPOTHESIS */}
            {(selectedFilterCategory === 'ALL' || selectedFilterCategory === 'HYPOTHESIS') && (
              <div className="ai-findings-category">
                <div className="ai-category-header hypothesis">
                  <AlertTriangle size={12} />
                  <span>HYPOTHESES (THREAT MODELING / MITRE)</span>
                </div>
                {analysis.findings.hypotheses.length === 0 ? (
                  <span style={{ fontSize: 10, color: '#64748b' }}>No working hypotheses active.</span>
                ) : (
                  analysis.findings.hypotheses.map(f => (
                    <div key={f.id} className="ai-finding-item hypothesis">
                      <div>{f.text}</div>
                      <div className="ai-finding-meta">
                        <span>CONFIDENCE: {f.confidenceExplanation}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* UNKNOWN */}
            {(selectedFilterCategory === 'ALL' || selectedFilterCategory === 'UNKNOWN') && (
              <div className="ai-findings-category">
                <div className="ai-category-header unknown">
                  <HelpCircle size={12} />
                  <span>UNKNOWN (MISSING TELEMETRY & ATTRIBUTION GAPS)</span>
                </div>
                {analysis.findings.unknown.length === 0 ? (
                  <span style={{ fontSize: 10, color: '#64748b' }}>No unknown gaps reported.</span>
                ) : (
                  analysis.findings.unknown.map(f => (
                    <div key={f.id} className="ai-finding-item unknown">
                      <div>{f.text}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: PROPOSALS (ACTION BOUNDARY) ─────────────────────────────────── */}
        {activeTab === 'PROPOSALS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'rgba(0, 240, 255, 0.05)', border: '1px dashed rgba(0, 240, 255, 0.25)', padding: 10, borderRadius: 6, fontSize: 10, color: '#94a3b8' }}>
              <strong style={{ color: '#00f0ff' }}>HUMAN-IN-THE-LOOP CONTROL BOUNDARY:</strong>
              <p style={{ margin: '4px 0 0 0' }}>
                The AI Copilot operates strictly in advisory mode. Actions proposed here are queued with status <code>PROPOSED</code> and require explicit SOC analyst authorization before dispatch to SOAR.
              </p>
            </div>

            {proposals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#64748b', fontSize: 11 }}>
                No active response actions proposed for this context.
              </div>
            ) : (
              proposals.map(prop => (
                <div key={prop.proposalId} className="ai-proposal-card">
                  <div className="ai-proposal-header">
                    <div className="ai-proposal-action">
                      <Lock size={12} />
                      <span>{prop.actionType}: {prop.target.displayName || prop.target.id}</span>
                    </div>
                    <span className={`ai-risk-badge ${prop.riskLevel.toLowerCase()}`}>
                      {prop.riskLevel} RISK
                    </span>
                  </div>

                  <div className="ai-proposal-reason">
                    {prop.reason}
                  </div>

                  <div style={{ fontSize: 9, color: '#64748b', display: 'flex', gap: 12 }}>
                    <span>STATUS: <strong style={{ color: prop.status === 'ACCEPTED' ? '#3dffb0' : prop.status === 'REJECTED' ? '#ff2a2a' : '#00f0ff' }}>{prop.status}</strong></span>
                    <span>PERM: {prop.requiredPermission}</span>
                  </div>

                  {prop.status === 'PROPOSED' && (
                    <div className="ai-proposal-actions-row">
                      <button
                        className="ai-btn-accept"
                        onClick={() => handleAcceptProposal(prop.proposalId)}
                      >
                        <CheckCircle size={12} /> ACCEPT & DISPATCH (SOAR)
                      </button>
                      <button
                        className="ai-btn-reject"
                        onClick={() => handleRejectProposal(prop.proposalId)}
                      >
                        REJECT
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Tab: HUNT COPILOT ───────────────────────────────────────────────── */}
        {activeTab === 'HUNT' && context && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="ai-summary-card">
              <div className="ai-summary-lead" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Crosshair size={14} color="#00f0ff" />
                <span>Evidence-Grounded Threat Hunt Formulation</span>
              </div>
              <p>
                Based on canonical entities associated with <strong>{context.title}</strong>, the copilot has formulated a structured query across suspicious process executions, inbound/outbound network beacons, and host authentication logs.
              </p>
            </div>

            <div style={{ background: 'rgba(13, 22, 38, 0.7)', border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: 6, padding: 12, fontSize: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ color: '#00f0ff', fontWeight: 700 }}>STRUCTURED QUERY SPECIFICATION:</div>
              <div>
                <span style={{ color: '#94a3b8' }}>TARGET ASSETS: </span>
                <span style={{ color: '#e2e8f0' }}>{(context.relatedAssets as any[]).map(a => a?.id).join(', ') || 'Global scope'}</span>
              </div>
              <div>
                <span style={{ color: '#94a3b8' }}>TARGET IOCs: </span>
                <span style={{ color: '#e2e8f0' }}>{(context.relatedIOCs as any[]).map(i => i?.value).join(', ') || 'None identified'}</span>
              </div>
              <div>
                <span style={{ color: '#94a3b8' }}>EVENT TYPES: </span>
                <span style={{ color: '#3dffb0' }}>PROCESS_LAUNCH, NETWORK_CONNECT, AUTHENTICATION</span>
              </div>
              <div>
                <span style={{ color: '#94a3b8' }}>LOOKBACK WINDOW: </span>
                <span style={{ color: '#e2e8f0' }}>LAST 24 HOURS (CANONICAL TIME)</span>
              </div>
            </div>

            <button
              className="ai-btn-accept"
              style={{ padding: '10px 14px', fontSize: 11 }}
              onClick={handleExecuteProposedHunt}
            >
              <Crosshair size={14} /> INITIALIZE & LAUNCH HUNT IN WORKSPACE
            </button>
          </div>
        )}

        {/* ── Tab: QUESTIONS ──────────────────────────────────────────────────── */}
        {activeTab === 'QUESTIONS' && analysis && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>
              Evidence-based open questions generated deterministically from observed gaps in telemetry:
            </div>

            {analysis.questions.map((q, idx) => (
              <div
                key={idx}
                style={{
                  background: 'rgba(13, 22, 38, 0.6)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  padding: 10,
                  fontSize: 11,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{q.question}</span>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: q.category === 'ANSWERABLE_FROM_CURRENT_DATA' ? 'rgba(61,255,176,0.15)' : 'rgba(255,183,0,0.15)',
                      color: q.category === 'ANSWERABLE_FROM_CURRENT_DATA' ? '#3dffb0' : '#ffb700',
                    }}
                  >
                    {q.category.replace(/_/g, ' ')}
                  </span>
                </div>
                {q.rationale && (
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                    Rationale: {q.rationale}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: PROVENANCE ─────────────────────────────────────────────────── */}
        {activeTab === 'PROVENANCE' && analysis && context && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 10 }}>
            <div style={{ background: 'rgba(13, 22, 38, 0.7)', padding: 12, borderRadius: 6, border: '1px solid rgba(0, 240, 255, 0.2)' }}>
              <div style={{ color: '#00f0ff', fontWeight: 700, marginBottom: 6 }}>OFFLINE ENGINE METADATA</div>
              <div>ENGINE: <strong>{analysis.engine}</strong></div>
              <div>VERSION: <strong>{analysis.engineVersion}</strong></div>
              <div>CONTEXT ID: <code>{analysis.contextId}</code></div>
              <div>TIMESTAMP: {new Date(analysis.generatedAt).toLocaleString()}</div>
              <div>NETWORK EGRESS: <strong style={{ color: '#3dffb0' }}>0 BYTES (AIRGAPPED / OFFLINE)</strong></div>
            </div>

            <div style={{ color: '#00f0ff', fontWeight: 700 }}>CANONICAL ENTITY PROVENANCE ({analysis.supportingEvidence.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
              {analysis.supportingEvidence.map((ev, idx) => (
                <div key={idx} style={{ padding: 6, background: 'rgba(255,255,255,0.03)', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{ev.summary}</span>
                  <span style={{ color: '#94a3b8' }}>{ev.entityType}:{ev.entityId.slice(0, 12)}</span>
                </div>
              ))}
            </div>

            <div style={{ color: '#ffb700', fontWeight: 700, marginTop: 8 }}>ENGINE LIMITATIONS</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#94a3b8', lineHeight: 1.5 }}>
              {analysis.limitations.map((lim, idx) => (
                <li key={idx}>{lim}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ─── Footer: Query & Quick Intent Prompt Bar ──────────────────────────── */}
      <form className="ai-footer" onSubmit={handleQuerySubmit}>
        <input
          type="text"
          className="ai-query-input"
          placeholder="Ask Copilot (e.g. 'explain attack path', 'why did alert fire?', 'suggest hunt')…"
          value={analystQuery}
          onChange={e => setAnalystQuery(e.target.value)}
          disabled={isLoading}
        />
        <button
          type="submit"
          className="ai-submit-btn"
          disabled={isLoading || !analystQuery.trim()}
        >
          <Search size={12} /> ASK
        </button>
      </form>
    </aside>
  );
};

export default AiAssistantPanel;

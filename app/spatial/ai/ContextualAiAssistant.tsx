/**
 * ContextualAiAssistant.tsx
 *
 * EXPLAIN-SEC SPATIAL SOC — STEP 10: CONTEXTUAL AI ASSISTANT
 *
 * Architectural Invariants:
 * 1. AI is an assistant, NOT the source of truth.
 *    - All claims grounded in canonical stores via EvidenceGroundingRef.
 *    - Strict epistemic tagging: OBSERVED / DERIVED / HYPOTHESIS / UNKNOWN.
 * 2. Strict Action Proposal Guardrails:
 *    - RBAC check (validates session role before enabling approval button).
 *    - Policy check (ensures reversible containment and dual-control compliance).
 *    - Human Approval gate (operator MUST click Approve & Execute; zero autonomous/silent execution).
 *    - Immutable Audit commit (signed into audit trail upon execution).
 * 3. Contextual, Non-Intrusive UX:
 *    - Appears in-situ for:
 *      - INCIDENT → AI explanation
 *      - ATTACK GRAPH → AI attack-path explanation
 *      - HUNT RESULT → AI summary
 *    - NEVER a giant permanent chatbot covering the SOC.
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Brain,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  X,
  Lock,
  ArrowRight,
  Zap,
  Activity,
  Send,
  Sliders,
  Terminal,
} from 'lucide-react';
import { securityService } from '../../core/security-service';
import type {
  InvestigationContext,
  AIInvestigationResponse,
  AIActionProposal,
  ClaimCategory,
  AIResponseType,
  TargetEntityType,
} from '../../core/models/ai';
import { cyberAudio } from '../../cyber-audio';
import type { PerformanceMode } from '../performance-mode';
import './contextual-ai.css';

export type ContextualAiMode = 'INCIDENT' | 'ATTACK_GRAPH' | 'HUNT_RESULT';

export interface ContextualAiAssistantProps {
  mode: ContextualAiMode;
  targetId: string;
  isOpen: boolean;
  onClose: () => void;
  perfMode?: PerformanceMode;
  onPivotToHunt?: (queryText: string) => void;
  onPivotToIncident?: (incidentId: string) => void;
}

export function ContextualAiAssistant({
  mode,
  targetId,
  isOpen,
  onClose,
  perfMode = 'FULL',
  onPivotToHunt,
  onPivotToIncident,
}: ContextualAiAssistantProps) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<InvestigationContext | null>(null);
  const [analysis, setAnalysis] = useState<AIInvestigationResponse | null>(null);
  const [proposals, setProposals] = useState<AIActionProposal[]>([]);
  const [analystPrompt, setAnalystPrompt] = useState<string>('');
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [activeFilterCategory, setActiveFilterCategory] = useState<ClaimCategory | 'ALL'>('ALL');

  // Resolve target entity type and forced response type based on mode
  const { targetType, responseType, titleLabel } = useMemo(() => {
    switch (mode) {
      case 'ATTACK_GRAPH':
        return {
          targetType: 'INCIDENT' as TargetEntityType,
          responseType: 'ATTACK_PATH_EXPLANATION' as AIResponseType,
          titleLabel: 'ATTACK-PATH EXPLANATION',
        };
      case 'HUNT_RESULT':
        return {
          targetType: 'HUNT' as TargetEntityType,
          responseType: 'HUNT_SUMMARY' as AIResponseType,
          titleLabel: 'HUNT RESULT SUMMARY',
        };
      case 'INCIDENT':
      default:
        return {
          targetType: 'INCIDENT' as TargetEntityType,
          responseType: 'INCIDENT_SUMMARY' as AIResponseType,
          titleLabel: 'INCIDENT EXPLANATION',
        };
    }
  }, [mode]);

  // Load grounded context and generate analysis
  const runAnalysis = useCallback(
    async (customPrompt?: string) => {
      if (!targetId) return;
      setIsLoading(true);
      setError(null);
      setActionSuccessMsg(null);

      try {
        // 1. Build bounded, canonical context
        const builtContext = await securityService.buildInvestigationContext(
          targetType,
          targetId,
          { maxEvents: perfMode === 'LOW' ? 20 : 50 }
        );
        setContext(builtContext);

        // 2. Generate grounded deterministic response
        const generated = await securityService.generateAiAnalysis(
          builtContext,
          responseType,
          customPrompt
        );
        setAnalysis(generated);

        // 3. Load action proposals associated with this context
        const contextProposals = await securityService.getAiActionProposals({
          contextId: builtContext.contextId,
        });
        setProposals(contextProposals);

        cyberAudio.playScan();
      } catch (err: any) {
        console.error('[ContextualAiAssistant] Analysis failed:', err);
        setError(err?.message || 'Failed to generate contextual AI analysis.');
      } finally {
        setIsLoading(false);
      }
    },
    [targetId, targetType, responseType, perfMode]
  );

  useEffect(() => {
    if (isOpen) {
      runAnalysis();
    }
  }, [isOpen, runAnalysis]);

  // Human Approval gate for AI Action Proposals
  const handleApproveProposal = async (proposalId: string) => {
    cyberAudio.playSelect();
    try {
      const res = await securityService.acceptAiActionProposal(proposalId);
      setActionSuccessMsg('Action approved and committed to immutable audit trail.');
      cyberAudio.playSuccess();
      setProposals((prev) =>
        prev.map((p) => (p.proposalId === proposalId ? res.proposal : p))
      );
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } catch (err: any) {
      cyberAudio.playFailure(err?.message);
      setError(`Approval failed: ${err?.message}`);
    }
  };

  // Rejection gate for AI Action Proposals
  const handleRejectProposal = async (proposalId: string) => {
    cyberAudio.playClick();
    try {
      const updated = await securityService.rejectAiActionProposal(
        proposalId,
        'Rejected by analyst during contextual review'
      );
      setProposals((prev) =>
        prev.map((p) => (p.proposalId === proposalId ? updated : p))
      );
    } catch (err: any) {
      setError(`Rejection failed: ${err?.message}`);
    }
  };

  // Natural Language query submission
  const handleSubmitPrompt = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!analystPrompt.trim()) return;

    cyberAudio.playClick();
    const p = analystPrompt.trim();
    setAnalystPrompt('');
    await runAnalysis(p);
  };

  // Current session role for RBAC validation display
  const session = securityService.getSession();
  const currentRole = session?.role || 'L1_ANALYST';

  if (!isOpen) return null;

  // Flattened findings list
  const findingsList = analysis
    ? [
        ...analysis.findings.observed.map((f) => ({ ...f, type: 'OBS' })),
        ...analysis.findings.derived.map((f) => ({ ...f, type: 'DER' })),
        ...analysis.findings.hypotheses.map((f) => ({ ...f, type: 'HYP' })),
        ...analysis.findings.unknown.map((f) => ({ ...f, type: 'UNK' })),
      ]
    : [];

  const filteredFindings =
    activeFilterCategory === 'ALL'
      ? findingsList
      : findingsList.filter((f) => f.category === activeFilterCategory);

  return (
    <aside
      className="contextual-ai-drawer"
      aria-label={`Contextual AI ${titleLabel}`}
      role="complementary"
    >
      {/* Header */}
      <div className="cai-header">
        <div className="cai-title-wrap">
          <div className="cai-title">
            <Brain size={14} color="#00f0ff" />
            <span>⚡ AI // {titleLabel}</span>
          </div>
          <span className="cai-safety-badge">ASSISTANT ONLY // NOT SOURCE OF TRUTH</span>
        </div>

        <button
          className="cai-close-btn"
          onClick={() => {
            cyberAudio.playClick();
            onClose();
          }}
          title="Dismiss contextual AI assistant"
        >
          <X size={15} />
        </button>
      </div>

      {/* Body Content */}
      <div className="cai-body">
        {/* Status / Success / Error Notices: State-driven */}
        {actionSuccessMsg && (
          <div
            className="soc-motion-success"
            style={{
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle size={14} className="soc-motion-success-icon" style={{ color: '#3dffb0' }} />
            <span>{actionSuccessMsg}</span>
          </div>
        )}

        {error && (
          <div className="soc-motion-failure soc-failure-box">
            <div className="soc-failure-header">
              <AlertTriangle size={13} />
              <span>AI OPERATION FAILED</span>
            </div>
            <div className="soc-failure-explanation">{error}</div>
            <div className="soc-failure-actions">
              <button
                type="button"
                className="soc-remediation-btn"
                onClick={() => {
                  setError(null);
                  void runAnalysis();
                }}
              >
                RETRY ANALYSIS
              </button>
            </div>
          </div>
        )}

        {/* Loading Spinner */}
        {isLoading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              color: '#00f0ff',
              padding: 12,
              background: 'rgba(0, 240, 255, 0.05)',
              borderRadius: 6,
            }}
          >
            <Activity size={16} className="animate-spin" />
            <span>Synthesizing canonical security telemetry...</span>
          </div>
        )}

        {/* AI Summary Card */}
        {analysis && (
          <div className="cai-summary-card">
            <div className="cai-section-label">
              <span>CANONICAL INTERPRETATION</span>
              <span style={{ fontSize: 8, color: '#3dffb0' }}>
                CONFIDENCE: {analysis.uncertainty}
              </span>
            </div>
            <div className="cai-summary-text">{analysis.summary}</div>
          </div>
        )}

        {/* Epistemic Findings Classification */}
        {analysis && (
          <div>
            <div className="cai-section-label">
              <span>EPISTEMIC FINDINGS</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['ALL', 'OBSERVED', 'DERIVED', 'HYPOTHESIS', 'UNKNOWN'] as const).map(
                  (cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        cyberAudio.playClick();
                        setActiveFilterCategory(cat);
                      }}
                      style={{
                        background: activeFilterCategory === cat ? '#00f0ff' : 'transparent',
                        color: activeFilterCategory === cat ? '#050b14' : '#8899aa',
                        border: 'none',
                        fontSize: 8,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 2,
                        cursor: 'pointer',
                      }}
                    >
                      {cat}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="cai-findings-group">
              {filteredFindings.map((f) => (
                <div
                  key={f.id}
                  className={`cai-claim-item ${
                    f.category === 'OBSERVED'
                      ? 'obs'
                      : f.category === 'DERIVED'
                      ? 'der'
                      : f.category === 'HYPOTHESIS'
                      ? 'hyp'
                      : 'unk'
                  }`}
                >
                  <span
                    className={`cai-claim-tag ${
                      f.category === 'OBSERVED'
                        ? 'claim-tag-obs'
                        : f.category === 'DERIVED'
                        ? 'claim-tag-der'
                        : f.category === 'HYPOTHESIS'
                        ? 'claim-tag-hyp'
                        : 'claim-tag-unk'
                    }`}
                  >
                    {f.category}
                  </span>
                  <span>{f.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Proposals Boundary (RBAC + Policy + Approval + Audit) */}
        {proposals.length > 0 && (
          <div className="cai-proposals-section">
            <div className="cai-section-label">
              <span>ACTION PROPOSALS // REQUIRES OPERATOR APPROVAL</span>
              <span style={{ fontSize: 8, color: '#ff3366' }}>ZERO SILENT ACTIONS</span>
            </div>

            {proposals.map((prop) => {
              const isExecuted = prop.status === 'ACCEPTED' || prop.status === 'EXECUTED';
              const isRejected = prop.status === 'REJECTED';
              return (
                <div key={prop.proposalId} className="cai-proposal-card">
                  <div className="cai-proposal-header">
                    <span className="cai-proposal-title">
                      {prop.actionType}: {prop.target.displayName || prop.target.id}
                    </span>
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 800,
                        color:
                          prop.riskLevel === 'HIGH' || prop.riskLevel === 'CRITICAL'
                            ? '#ff3366'
                            : '#ffaa00',
                      }}
                    >
                      RISK: {prop.riskLevel}
                    </span>
                  </div>

                  <div className="cai-guardrail-pills">
                    <span className="cai-pill pill-rbac">
                      RBAC: {prop.requiredPermission} (You: {currentRole})
                    </span>
                    <span className="cai-pill pill-policy">
                      POLICY: Reversible Containment
                    </span>
                    <span className="cai-pill pill-audit">
                      AUDIT: Logged on Approval
                    </span>
                  </div>

                  <div className="cai-proposal-reason">{prop.reason}</div>

                  {/* Operator Approval Gate */}
                  <div className="cai-action-btn-row">
                    {isExecuted ? (
                      <span style={{ fontSize: 9.5, color: '#3dffb0', fontWeight: 800 }}>
                        ✓ APPROVED & DISPATCHED
                      </span>
                    ) : isRejected ? (
                      <span style={{ fontSize: 9.5, color: '#ffaa00', fontWeight: 800 }}>
                        ✕ REJECTED BY ANALYST
                      </span>
                    ) : (
                      <>
                        <button
                          className="cai-reject-btn"
                          onClick={() => handleRejectProposal(prop.proposalId)}
                        >
                          REJECT
                        </button>
                        <button
                          className="cai-approve-btn"
                          onClick={() => handleApproveProposal(prop.proposalId)}
                        >
                          <Zap size={11} />
                          APPROVE & EXECUTE
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Analyst Question Input Bar */}
      <form className="cai-query-bar" onSubmit={handleSubmitPrompt}>
        <input
          type="text"
          className="cai-query-input"
          placeholder="Ask contextual investigation question..."
          value={analystPrompt}
          onChange={(e) => setAnalystPrompt(e.target.value)}
        />
        <button
          type="submit"
          className="cai-query-submit"
          disabled={isLoading || !analystPrompt.trim()}
          title="Submit question to local offline AI assistant"
        >
          <Send size={11} />
        </button>
      </form>
    </aside>
  );
}

export default ContextualAiAssistant;

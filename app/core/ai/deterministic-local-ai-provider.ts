/**
 * deterministic-local-ai-provider.ts
 *
 * Deterministic Local AI Provider for Step 13.
 *
 * Implements ExplainSecAIProvider using:
 * - InvestigationContextBuilder (canonical data gathering + RBAC filter + bounding)
 * - DeterministicLocalAIEngine (OBSERVED / DERIVED / HYPOTHESIS / UNKNOWN reasoning)
 *
 * Safety Invariant:
 * 100% offline. Zero network calls. Engine provenance explicitly 'DETERMINISTIC_LOCAL_ENGINE'.
 */

import type { ISecurityProvider } from '../providers/provider-interface';
import type { RoleId } from '../models/auth';
import type {
  InvestigationContext,
  AIInvestigationResponse,
  AIResponseType,
  TargetEntityType,
  AIActionProposal,
} from '../models/ai';
import {
  InvestigationContextBuilder,
  type ContextBuilderOptions,
} from './investigation-context-builder';
import {
  DeterministicLocalAIEngine,
  DETERMINISTIC_ENGINE_NAME,
} from './deterministic-local-ai-engine';
import type {
  ExplainSecAIProvider,
  AISummaryResponse,
  AINarrativeResponse,
  AIRootCauseResponse,
  AIAttackPathExplanation,
  AIResponseRecommendation,
  AIIocExplanation,
} from './ai-provider';

export class DeterministicLocalAIProvider implements ExplainSecAIProvider {
  public readonly providerName = 'ExplainSec Deterministic Local AI Engine';
  public readonly provenance = DETERMINISTIC_ENGINE_NAME;

  private contextBuilder: InvestigationContextBuilder;
  private engine: DeterministicLocalAIEngine;

  constructor(private securityProvider: ISecurityProvider) {
    this.contextBuilder = new InvestigationContextBuilder(securityProvider);
    this.engine = new DeterministicLocalAIEngine();
  }

  /**
   * Build canonical investigation context for an entity.
   */
  public async buildContext(
    targetType: TargetEntityType,
    targetId: string,
    roleId?: RoleId,
    options?: ContextBuilderOptions
  ): Promise<InvestigationContext> {
    return this.contextBuilder.buildContext(targetType, targetId, roleId, options);
  }

  /**
   * Primary Step 13 reasoning method: Generates structured, evidence-grounded analysis.
   */
  public async generateAnalysis(
    context: InvestigationContext,
    responseType?: AIResponseType,
    analystQuery?: string
  ): Promise<AIInvestigationResponse> {
    return this.engine.generateResponse(context, responseType, analystQuery);
  }

  // ── Backward-compatible helper methods delegating to canonical context ───

  public async generateIncidentSummary(incidentId: string): Promise<AISummaryResponse> {
    const ctx = await this.buildContext('INCIDENT', incidentId);
    const resp = this.engine.generateIncidentSummary(ctx);

    const inc = ctx.primaryEntity as Record<string, any> | null;
    return {
      summary: resp.summary,
      threatLevel: (inc?.severity as any) || 'CRITICAL',
      attackStage: ctx.relatedMITRETechniques[0] || 'LATERAL_MOVEMENT',
      confidence: resp.uncertainty === 'HIGH_CONFIDENCE' ? 0.95 : 0.85,
      provenance: 'DETERMINISTIC_LOCAL_ENGINE',
      generatedAt: resp.generatedAt,
    };
  }

  public async generateAttackNarrative(incidentId: string): Promise<AINarrativeResponse> {
    const ctx = await this.buildContext('INCIDENT', incidentId);
    const resp = this.engine.generateIncidentSummary(ctx);

    const inc = ctx.primaryEntity as Record<string, any> | null;
    const chronology = resp.findings.observed.map((o) => o.text);

    return {
      headline: `${inc?.title || incidentId} — Multi-Stage Intrusion Assessment`,
      chronologyParagraphs: chronology.length > 0 ? chronology : [resp.summary],
      primaryAttackerVector: ctx.relatedMITRETechniques.join(' -> ') || 'Unknown Vector',
      compromisedAssets: ctx.relatedAssets.map((a) => String(a.name || a.id)),
      provenance: 'DETERMINISTIC_LOCAL_ENGINE',
      generatedAt: resp.generatedAt,
    };
  }

  public async explainRootCause(incidentId: string): Promise<AIRootCauseResponse> {
    const ctx = await this.buildContext('INCIDENT', incidentId);
    const primaryAsset = ctx.relatedAssets[0];
    const primaryRule = ctx.detectionRules[0];

    return {
      rootCause: `Suspected initial compromise on host ${primaryAsset?.name || primaryAsset?.id || 'UNKNOWN'} matching rule ${primaryRule?.name || 'UNSPECIFIED'}.`,
      patientZeroAsset: String(primaryAsset?.name || primaryAsset?.id || 'UNKNOWN'),
      entryTechniqueId: ctx.relatedMITRETechniques[0] || 'T1059.001',
      entryTechniqueName: 'PowerShell / Script Execution',
      evidenceSnippets: ctx.relatedEvents.slice(0, 3).map((e) => `${(e as any).category}: ${(e as any).summary || (e as any).id}`),
      provenance: 'DETERMINISTIC_LOCAL_ENGINE',
      generatedAt: new Date().toISOString(),
    };
  }

  public async explainAttackPath(incidentId: string): Promise<AIAttackPathExplanation> {
    const ctx = await this.buildContext('INCIDENT', incidentId);
    const steps = ctx.timeline.map((t, idx) => ({
      step: idx + 1,
      description: t.description,
      causality: t.type,
    }));

    return {
      pathSteps: steps.length > 0 ? steps : [
        { step: 1, description: 'Initial foothold observed', causality: 'Initial Access' },
      ],
      criticalChokepoints: ctx.relatedAssets.map((a) => `Asset isolation: ${a.name || a.id}`),
      provenance: 'DETERMINISTIC_LOCAL_ENGINE',
      generatedAt: new Date().toISOString(),
    };
  }

  public async recommendResponse(incidentId: string): Promise<AIResponseRecommendation> {
    const ctx = await this.buildContext('INCIDENT', incidentId);
    const resp = this.engine.generateIncidentSummary(ctx);
    const primaryProposal = resp.actionProposals[0];
    const primaryAsset = ctx.relatedAssets[0];

    return {
      recommendedAction: primaryProposal ? primaryProposal.actionType : 'CONTAIN_HOST',
      targetId: primaryProposal ? primaryProposal.target.id : (primaryAsset?.id as string || incidentId),
      targetType: (primaryProposal?.target.type as any) || 'ASSET',
      justification: primaryProposal ? primaryProposal.reason : 'Mitigate lateral movement risk.',
      blastRadiusAssessment: 'Host-level containment isolates single system while preserving production network uptime.',
      urgency: 'HIGH',
      provenance: 'DETERMINISTIC_LOCAL_ENGINE',
      generatedAt: new Date().toISOString(),
    };
  }

  public async explainIOC(iocId: string): Promise<AIIocExplanation> {
    const ctx = await this.buildContext('IOC', iocId);
    const resp = this.engine.generateThreatIntelSummary(ctx);
    const intel = ctx.threatIntel[0];

    return {
      iocValue: iocId,
      threatFamily: (intel as any)?.threatActor || 'SUSPICIOUS_INDICATOR',
      reputationVerdict: intel ? `CONFIRMED_MALICIOUS (Confidence ${(intel as any).confidence}/100)` : 'NO LOCAL INTEL RECORD',
      recommendedRule: 'Add perimeter block rule and search endpoint telemetry for matching hashes/IPs.',
      provenance: 'DETERMINISTIC_LOCAL_ENGINE',
      generatedAt: resp.generatedAt,
    };
  }
}

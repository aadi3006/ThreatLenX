/**
 * ai-provider.ts
 *
 * Clean AI connector abstraction for EXPLAIN-SEC SPATIAL.
 *
 * Architecture seam:
 *   Offline Deterministic Intelligence (active default - Step 13)
 *       ↓
 *   Local AI Provider (WebLLM / ONNX future seam - LocalModelAIProvider)
 *       ↓
 *   Future ExplainSec AI Provider (Enterprise)
 *
 * CRITICAL RULE:
 * Deterministic local generators explicitly declare their provenance
 * as 'DETERMINISTIC_LOCAL_ENGINE'. Never pretend a deterministic function is cloud AI.
 * 100% offline. No fetch(). No external network access.
 */

import type { RoleId } from '../models/auth';
import type {
  InvestigationContext,
  AIInvestigationResponse,
  AIResponseType,
  TargetEntityType,
  AIProvenanceEngine,
} from '../models/ai';
import type { ContextBuilderOptions } from './investigation-context-builder';

export type AIProvenance = AIProvenanceEngine | 'EXPLAIN_SEC_CLOUD_API';

export interface AISummaryResponse {
  summary: string;
  threatLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  attackStage: string;
  confidence: number;
  provenance: AIProvenance;
  generatedAt: string;
}

export interface AINarrativeResponse {
  headline: string;
  chronologyParagraphs: string[];
  primaryAttackerVector: string;
  compromisedAssets: string[];
  provenance: AIProvenance;
  generatedAt: string;
}

export interface AIRootCauseResponse {
  rootCause: string;
  patientZeroAsset: string;
  entryTechniqueId?: string;
  entryTechniqueName?: string;
  evidenceSnippets: string[];
  provenance: AIProvenance;
  generatedAt: string;
}

export interface AIAttackPathExplanation {
  pathSteps: Array<{
    step: number;
    description: string;
    causality: string;
  }>;
  criticalChokepoints: string[];
  provenance: AIProvenance;
  generatedAt: string;
}

export interface AIResponseRecommendation {
  recommendedAction: string;
  targetId: string;
  targetType: 'ASSET' | 'IOC' | 'USER';
  justification: string;
  blastRadiusAssessment: string;
  urgency: 'IMMEDIATE' | 'HIGH' | 'STANDARD';
  provenance: AIProvenance;
  generatedAt: string;
}

export interface AIIocExplanation {
  iocValue: string;
  threatFamily: string;
  reputationVerdict: string;
  recommendedRule: string;
  provenance: AIProvenance;
  generatedAt: string;
}

/**
 * Standard interface that all AI providers must satisfy.
 */
export interface ExplainSecAIProvider {
  readonly providerName: string;
  readonly provenance: AIProvenance;

  // Step 13 Canonical Copilot APIs
  buildContext?(
    targetType: TargetEntityType,
    targetId: string,
    roleId?: RoleId,
    options?: ContextBuilderOptions
  ): Promise<InvestigationContext>;

  generateAnalysis?(
    context: InvestigationContext,
    responseType?: AIResponseType,
    analystQuery?: string
  ): Promise<AIInvestigationResponse>;

  // Legacy helper signatures (maintained for backward compatibility)
  generateIncidentSummary(incidentId: string): Promise<AISummaryResponse>;
  generateAttackNarrative(incidentId: string): Promise<AINarrativeResponse>;
  explainRootCause(incidentId: string): Promise<AIRootCauseResponse>;
  explainAttackPath(incidentId: string): Promise<AIAttackPathExplanation>;
  recommendResponse(incidentId: string): Promise<AIResponseRecommendation>;
  explainIOC(iocId: string): Promise<AIIocExplanation>;
}

/**
 * Future seam interface for local on-device neural models (e.g. WebLLM / ONNX Runtime).
 * Strictly offline — zero remote model downloads at runtime without pre-packaging.
 */
export interface LocalModelAIProvider extends ExplainSecAIProvider {
  readonly modelId: string;
  readonly executionBackend: 'WASM' | 'WEBGPU' | 'CPU';
  isModelLoaded(): boolean;
  loadModel(): Promise<void>;
  unloadModel(): Promise<void>;
}

/**
 * Fallback static offline provider for bootstrap initialization before LocalProvider attaches.
 */
export class DeterministicOfflineIntelligenceProvider implements ExplainSecAIProvider {
  public readonly providerName = 'ExplainSec Baseline Static Provider';
  public readonly provenance: AIProvenance = 'DETERMINISTIC_LOCAL_ENGINE';

  public async generateIncidentSummary(incidentId: string): Promise<AISummaryResponse> {
    return {
      summary: `Baseline evaluation for ${incidentId}: Multi-stage adversary campaign targeting endpoints with lateral movement.`,
      threatLevel: 'CRITICAL',
      attackStage: 'LATERAL_MOVEMENT',
      confidence: 0.90,
      provenance: this.provenance,
      generatedAt: new Date().toISOString(),
    };
  }

  public async generateAttackNarrative(incidentId: string): Promise<AINarrativeResponse> {
    return {
      headline: `Incident ${incidentId} — Suspicious intrusion activity sequence`,
      chronologyParagraphs: ['Initial suspicious telemetry detected on host endpoint.'],
      primaryAttackerVector: 'Suspicious script execution',
      compromisedAssets: ['FINWS-027'],
      provenance: this.provenance,
      generatedAt: new Date().toISOString(),
    };
  }

  public async explainRootCause(incidentId: string): Promise<AIRootCauseResponse> {
    return {
      rootCause: 'Compromised admin credentials harvested following suspicious execution.',
      patientZeroAsset: 'FINWS-027',
      entryTechniqueId: 'T1059.001',
      entryTechniqueName: 'PowerShell Execution',
      evidenceSnippets: ['Suspicious PowerShell process invocation'],
      provenance: this.provenance,
      generatedAt: new Date().toISOString(),
    };
  }

  public async explainAttackPath(incidentId: string): Promise<AIAttackPathExplanation> {
    return {
      pathSteps: [
        { step: 1, description: 'Initial foothold established', causality: 'Initial Access' },
      ],
      criticalChokepoints: ['FINWS-027 network isolation'],
      provenance: this.provenance,
      generatedAt: new Date().toISOString(),
    };
  }

  public async recommendResponse(incidentId: string): Promise<AIResponseRecommendation> {
    return {
      recommendedAction: 'CONTAIN_HOST',
      targetId: 'FINWS-027',
      targetType: 'ASSET',
      justification: 'Isolate host to prevent lateral movement.',
      blastRadiusAssessment: 'Single endpoint affected.',
      urgency: 'HIGH',
      provenance: this.provenance,
      generatedAt: new Date().toISOString(),
    };
  }

  public async explainIOC(iocId: string): Promise<AIIocExplanation> {
    return {
      iocValue: iocId,
      threatFamily: 'SUSPICIOUS_INDICATOR',
      reputationVerdict: 'UNVERIFIED',
      recommendedRule: 'Add firewall block rule.',
      provenance: this.provenance,
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * AI Service facade.
 */
class AIService {
  private provider: ExplainSecAIProvider = new DeterministicOfflineIntelligenceProvider();

  public setProvider(provider: ExplainSecAIProvider): void {
    this.provider = provider;
  }

  public getProvider(): ExplainSecAIProvider {
    return this.provider;
  }

  public async buildContext(
    targetType: TargetEntityType,
    targetId: string,
    roleId?: RoleId,
    options?: ContextBuilderOptions
  ): Promise<InvestigationContext> {
    if (this.provider.buildContext) {
      return this.provider.buildContext(targetType, targetId, roleId, options);
    }
    throw new Error('Active AI provider does not implement buildContext');
  }

  public async generateAnalysis(
    context: InvestigationContext,
    responseType?: AIResponseType,
    analystQuery?: string
  ): Promise<AIInvestigationResponse> {
    if (this.provider.generateAnalysis) {
      return this.provider.generateAnalysis(context, responseType, analystQuery);
    }
    throw new Error('Active AI provider does not implement generateAnalysis');
  }

  public async generateIncidentSummary(incidentId: string): Promise<AISummaryResponse> {
    return this.provider.generateIncidentSummary(incidentId);
  }

  public async generateAttackNarrative(incidentId: string): Promise<AINarrativeResponse> {
    return this.provider.generateAttackNarrative(incidentId);
  }

  public async explainRootCause(incidentId: string): Promise<AIRootCauseResponse> {
    return this.provider.explainRootCause(incidentId);
  }

  public async explainAttackPath(incidentId: string): Promise<AIAttackPathExplanation> {
    return this.provider.explainAttackPath(incidentId);
  }

  public async recommendResponse(incidentId: string): Promise<AIResponseRecommendation> {
    return this.provider.recommendResponse(incidentId);
  }

  public async explainIOC(iocId: string): Promise<AIIocExplanation> {
    return this.provider.explainIOC(iocId);
  }
}

export const aiService = new AIService();

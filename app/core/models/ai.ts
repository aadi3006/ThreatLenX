/**
 * ai.ts
 *
 * Domain models for Step 13: Offline AI Investigation Assistant (Analyst Copilot).
 *
 * Core Principles:
 * - AI is an interpretation layer over canonical security data.
 * - Categorization strictly differentiates: OBSERVED, DERIVED, HYPOTHESIS, UNKNOWN.
 * - Uncertainty is explicit: HIGH_CONFIDENCE, SUPPORTED, PARTIAL, INSUFFICIENT_DATA.
 * - Action Proposal Boundary: AI can propose actions (AIActionProposal), but NEVER
 *   autonomously executes them. Human analyst acceptance is mandatory.
 */

import type { Permission } from './auth';
import type { ThreatHuntQuery } from './hunting';

export type AIProvenanceEngine =
  | 'DETERMINISTIC_LOCAL_ENGINE'
  | 'LOCAL_ONNX_MODEL'
  | 'LOCAL_WEBLANG_MODEL';

export type ClaimCategory = 'OBSERVED' | 'DERIVED' | 'HYPOTHESIS' | 'UNKNOWN';

export type UncertaintyLevel =
  | 'HIGH_CONFIDENCE'
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'INSUFFICIENT_DATA';

export type AIResponseType =
  | 'INCIDENT_SUMMARY'
  | 'TIMELINE_SUMMARY'
  | 'ENTITY_EXPLANATION'
  | 'CORRELATION_EXPLANATION'
  | 'DETECTION_EXPLANATION'
  | 'HUNT_GUIDANCE'
  | 'HUNT_SUMMARY'
  | 'ATTACK_PATH_EXPLANATION'
  | 'THREAT_INTEL_SUMMARY'
  | 'CASE_SUMMARY'
  | 'EVIDENCE_SUMMARY'
  | 'RESPONSE_EXPLANATION'
  | 'SIMULATION_ANALYSIS'
  | 'GENERAL_INVESTIGATION';

export type TargetEntityType =
  | 'INCIDENT'
  | 'ALERT'
  | 'EVENT'
  | 'ASSET'
  | 'USER'
  | 'IOC'
  | 'RULE'
  | 'HUNT'
  | 'CASE'
  | 'EVIDENCE'
  | 'PLAYBOOK_EXECUTION'
  | 'SIMULATION'
  | 'GENERAL';

/**
 * Direct reference linking a factual statement back to an authoritative store record.
 */
export interface EvidenceGroundingRef {
  entityType: TargetEntityType;
  entityId: string;
  store: string;
  summary: string;
  field?: string;
}

/**
 * Individual finding item with strict categorization.
 */
export interface AIFindingItem {
  id: string;
  category: ClaimCategory;
  text: string;
  sourceEntityIds: string[];
  groundingRefs?: EvidenceGroundingRef[];
  confidenceExplanation: string;
}

/**
 * Formulated non-destructive or actionable investigation next step.
 */
export interface AINextStep {
  stepNumber: number;
  title: string;
  description: string;
  actionType?: string;
  isDestructive: boolean;
  rationale: string;
  targetId?: string;
}

/**
 * Structured investigation question derived from missing evidence.
 */
export interface AIInvestigationQuestion {
  id: string;
  question: string;
  category: 'ANSWERABLE_FROM_CURRENT_DATA' | 'REQUIRES_MORE_DATA' | 'UNKNOWN';
  rationale: string;
  candidateEntities?: string[];
}

/**
 * Status of an AI action proposal.
 */
export type AIActionProposalStatus =
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXECUTED';

/**
 * AI Action Proposal.
 * Governs the Action Proposal Boundary:
 * AI formulates, analyst approves, SecurityService executes via SOAR.
 */
export interface AIActionProposal {
  proposalId: string;
  contextId: string;
  actionType:
    | 'CONTAIN_HOST'
    | 'UNCONTAIN_HOST'
    | 'BLOCK_IOC'
    | 'UNBLOCK_IOC'
    | 'REVOKE_USER_SESSION'
    | 'QUARANTINE_FILE'
    | 'EXECUTE_THREAT_HUNT'
    | 'CREATE_CASE_TASK'
    | 'PRESERVE_EVIDENCE';
  target: {
    id: string;
    type: 'ASSET' | 'IOC' | 'USER' | 'FILE' | 'QUERY';
    displayName?: string;
  };
  reason: string;
  supportingEvidence: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiredPermission: Permission;
  requiresApproval: boolean;
  suggestedPlaybookId?: string;
  createdAt: string;
  status: AIActionProposalStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  executionId?: string;
}

/**
 * Provenance metadata stamped on all assistant outputs.
 */
export interface AIProvenanceMetadata {
  engine: AIProvenanceEngine;
  engineVersion: string;
  contextId: string;
  contextVersion: number;
  generatedAt: string;
  recordsScanned: number;
  offlineGuaranteed: boolean;
}

/**
 * Standardized canonical context container assembled for AI reasoning.
 */
export interface InvestigationContext {
  contextId: string;
  targetType: TargetEntityType;
  targetId: string;
  title: string;
  assembledAt: string;
  contextVersion: number;

  // Canonical security entities (RBAC-filtered & size-bounded)
  primaryEntity: Record<string, unknown> | null;
  relatedEvents: Array<Record<string, unknown>>;
  relatedAlerts: Array<Record<string, unknown>>;
  relatedIncidents: Array<Record<string, unknown>>;
  relatedAssets: Array<Record<string, unknown>>;
  relatedUsers: Array<Record<string, unknown>>;
  relatedIOCs: Array<Record<string, unknown>>;
  relatedMITRETechniques: string[];
  correlationReasons: string[];
  timeline: Array<{
    id: string;
    timestamp: string;
    description: string;
    type: string;
    entityId?: string;
  }>;
  detectionRules: Array<Record<string, unknown>>;
  threatIntel: Array<Record<string, unknown>>;
  cases: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  responseExecutions: Array<Record<string, unknown>>;
  simulationProvenance?: {
    isSimulation: boolean;
    simulationId?: string;
    scenarioId?: string;
    runId?: string;
    seed?: number;
  };

  // Integrity & limits
  truncated: boolean;
  truncationReason?: string;
}

/**
 * Structured response produced by the AI assistant.
 */
export interface AIInvestigationResponse {
  id: string;
  generatedAt: string;
  engine: AIProvenanceEngine;
  engineVersion: string;
  contextId: string;
  contextVersion: number;
  responseType: AIResponseType;

  // Core structured content
  summary: string;
  findings: {
    observed: AIFindingItem[];
    derived: AIFindingItem[];
    hypotheses: AIFindingItem[];
    unknown: AIFindingItem[];
  };

  // Evidence grounding & uncertainty
  uncertainty: UncertaintyLevel;
  uncertaintyReason: string;
  supportingEvidence: EvidenceGroundingRef[];

  // Guidance & questions
  questions: AIInvestigationQuestion[];
  recommendedNextSteps: AINextStep[];
  actionProposals: AIActionProposal[];
  proposedHuntQuery?: ThreatHuntQuery;

  // Metadata & transparency
  relatedEntities: string[];
  provenance: AIProvenanceMetadata;
  limitations: string[];
}

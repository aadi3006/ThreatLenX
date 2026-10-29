/**
 * simulation.ts
 *
 * Canonical Attack Simulation & Cyber Range data models for EXPLAIN-SEC SPATIAL.
 *
 * Rules:
 * - 100% offline, local schema.
 * - Telemetry only; no actual attacks, network connections, or shell execution.
 * - Deterministic, seed-reproducible simulation model.
 * - Provenance tracking so simulated telemetry never contaminates live SOC reporting.
 */

import type { EventCategory, EventSeverity, EventSourceType } from './event';
import type { Severity } from './incident';

// ─── Scenario Models ─────────────────────────────────────────────────────────

export type SimulationScenarioStatus =
  | 'DRAFT'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'ARCHIVED';

export type SimulationDifficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export type SimulationCategory =
  | 'RANSOMWARE'
  | 'CREDENTIAL_ACCESS'
  | 'LATERAL_MOVEMENT'
  | 'DATA_EXFILTRATION'
  | 'ENDPOINT_COMPROMISE'
  | 'SUPPLY_CHAIN';

export type SimulationPhaseName =
  | 'RECONNAISSANCE'
  | 'INITIAL_ACCESS'
  | 'EXECUTION'
  | 'PERSISTENCE'
  | 'PRIVILEGE_ESCALATION'
  | 'DEFENSE_EVASION'
  | 'CREDENTIAL_ACCESS'
  | 'DISCOVERY'
  | 'LATERAL_MOVEMENT'
  | 'COMMAND_AND_CONTROL'
  | 'EXFILTRATION'
  | 'IMPACT';

export interface SimulationEntityRef {
  id: string;
  type: 'ASSET' | 'USER' | 'IOC';
  name: string;
  roleInScenario: string;
}

export interface SimulationEventTemplate {
  id: string;
  name: string;
  category: EventCategory;
  eventType: string;
  severity: EventSeverity;
  source: string;
  sourceType?: EventSourceType;
  assetId?: string;
  userId?: string;
  processName?: string;
  parentProcessName?: string;
  commandLine?: string;
  filePath?: string;
  fileHash?: string;
  srcIp?: string;
  dstIp?: string;
  srcPort?: number;
  dstPort?: number;
  protocol?: string;
  domain?: string;
  url?: string;
  httpMethod?: string;
  httpStatus?: number;
  message: string;
  offsetSeconds: number; // Delay from scenario start in virtual seconds
  mitreTechniqueId?: string;
  iocIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface SimulationPhase {
  id: string;
  phaseIndex: number;
  name: SimulationPhaseName;
  description: string;
  offsetSeconds: number;
  mitreTechniqueId?: string;
  eventTemplateIds: string[];
}

export interface ExpectedDetection {
  ruleId: string;
  ruleName: string;
  expectedAlert: boolean; // true = should alert, false = expected negative
  category: EventCategory;
  mitreTechniqueId?: string;
}

export interface ExpectedIncident {
  title: string;
  severity: Severity;
  targetAssetId?: string;
  targetUserId?: string;
}

export interface SimulationScenario {
  id: string;
  scenarioId: string;
  version: number;
  name: string;
  description: string;
  objective: string;
  difficulty: SimulationDifficulty;
  category: SimulationCategory;
  status: SimulationScenarioStatus;
  durationSeconds: number;
  phases: SimulationPhase[];
  entities: SimulationEntityRef[];
  eventTemplates: SimulationEventTemplate[];
  expectedDetections: ExpectedDetection[];
  expectedIncidents: ExpectedIncident[];
  expectedResponses: string[]; // playbook IDs or response action names
  mitreTechniques: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Simulation Run Models ──────────────────────────────────────────────────

export type SimulationRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface SimulationProvenance {
  simulationId: string;
  scenarioId: string;
  runId: string;
  generatedBy: 'LOCAL_SIMULATION_ENGINE';
  seed: number;
  phaseName?: SimulationPhaseName;
  virtualTimestamp: string;
}

export interface SimulationRun {
  id: string; // runId
  runId: string;
  scenarioId: string;
  scenarioVersion: number;
  scenarioName: string;
  status: SimulationRunStatus;
  seed: number;
  speed: number; // 0.5, 1, 2, 4
  startedAt: string;
  pausedAt?: string;
  completedAt?: string;
  currentPhaseIndex: number;
  currentPhaseName?: SimulationPhaseName;
  currentStepIndex: number;
  totalSteps: number;
  virtualTimeSeconds: number; // T+00:00
  generatedEventCount: number;
  generatedAlertCount: number;
  generatedIncidentCount: number;
  generatedCaseCount: number;
  generatedResponseCount: number;
  resultId?: string;
  error?: string;
}

// ─── Simulation Results & After-Action Report ───────────────────────────────

export interface DetectionValidationItem {
  ruleId: string;
  ruleName: string;
  expectedAlert: boolean;
  actualMatched: boolean;
  alertId?: string;
  verdict: 'EXPECTED_MATCH' | 'EXPECTED_NEGATIVE' | 'MISSED_DETECTION' | 'UNEXPECTED_MATCH';
  details: string;
}

export interface CorrelationValidationItem {
  alertId: string;
  alertTitle: string;
  correlatedIncidentId?: string;
  correlatedIncidentTitle?: string;
  score: number;
  reasons: string[];
  verdict: 'CORRELATED_SUCCESSFULLY' | 'ORPHANED_ALERT';
}

export interface SoarValidationItem {
  playbookId: string;
  playbookName: string;
  dryRunSuccess: boolean;
  targetIncidentId: string;
  simulatedActionCount: number;
  expectedMitigationObserved: boolean;
  details: string;
}

export interface SimulationResult {
  id: string; // resultId
  runId: string;
  scenarioId: string;
  scenarioName: string;
  seed: number;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  generatedEventCount: number;
  generatedAlertCount: number;
  generatedIncidentCount: number;
  generatedEventIds: string[];
  generatedAlertIds: string[];
  generatedIncidentIds: string[];

  // Detection Validation
  detectionValidation: DetectionValidationItem[];
  expectedDetectionCount: number;
  actualDetectionCount: number;
  missedDetectionCount: number;
  unexpectedDetectionCount: number;
  detectionCoverageRatio: string; // e.g. "5/8"
  detectionCoveragePercent: number; // e.g. 62.5

  // Correlation Validation
  correlationValidation: CorrelationValidationItem[];
  correlationSuccessCount: number;

  // SOAR Response Validation
  soarValidation: SoarValidationItem[];

  failures: string[];
  notes?: string;
}

export interface StartSimulationOptions {
  seed?: number;
  speed?: number;
  dryRunSoar?: boolean;
}

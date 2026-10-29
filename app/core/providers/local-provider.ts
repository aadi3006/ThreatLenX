/**
 * LocalProvider — Offline-first ISecurityProvider implementation.
 *
 * Persistence layer: IndexedDB via idb-store.ts
 *   - initialize() hydrates in-memory state from IDB.
 *   - If IDB is empty (first run or after reset), seed data is written.
 *   - Every mutation persists the affected record(s) back to IDB before returning.
 *   - Scenario state (activeScenarioId, activeScenarioStep) is persisted in
 *     the 'meta' store so it survives page reloads and browser restarts.
 *
 * Static/computed data (attack graphs, system radar, IOC graphs, MITRE coverage)
 * is synchronized with live canonical state (assets, IOCs, incidents) at query time.
 *
 * Auth session intentionally stays in sessionStorage (ephemeral by design).
 */

import type { ISecurityProvider } from './provider-interface';
import type {
  Incident,
  IncidentDetail,
  IncidentStatus,
  IncidentPriority,
  IncidentQuery,
  CreateIncidentInput,
  TimelineEvent,
  IncidentEvidence,
} from '../models/incident';
import type { AttackGraph, AttackGraphNode, AttackGraphEdge } from '../models/attack-graph';
import type { SystemRadarData, SystemRadarNode, IocGraphData, ScenarioDefinition } from '../models/spatial-structures';
import type { MitreTechniqueCoverage } from '../models/mitre';
import type { AuditRecord } from '../models/audit';
import type { ResponseAction } from '../models/response';
import type { UserSession, UserCredentials, RoleDefinition, RoleId } from '../models/auth';
import type { Asset, SecurityUser, IOC } from '../models/entity';
import type {
  SecurityEvent,
  SecurityEventInput,
  SecurityEventQuery,
  SecurityEventStats,
  IngestEventResult,
} from '../models/event';

import {
  authenticate as localAuthenticate,
  getCurrentSession,
  logout as localLogout,
  getLocalRoles,
} from '../auth/local-auth-service';

import {
  canCreateIncident,
  canRequestContainment,
  canApproveContainment,
  canExecuteSOAR,
  canIngestEvents,
  canAcknowledgeAlert,
  canResolveAlert,
  canReadDetectionRules,
  canTestDetectionRules,
  canAuthorDetectionRules,
  canManageDetectionRules,
  canCorrelate,
  canExecuteThreatHunt,
  canSaveThreatHunt,
  canReadCases,
  canCreateCase,
  canUpdateCase,
  canManageCase,
  canReadEvidence,
  canCollectEvidence,
  canAnnotateEvidence,
  canVerifyEvidence,
  canManageEvidence,
  canReadThreatIntel,
  canEnrichThreatIntel,
  canManageThreatIntel,
  canReadPlaybooks,
  canAuthorPlaybooks,
  canManagePlaybooks,
  canExecutePlaybooks,
  canApprovePlaybooks,
  canCancelPlaybooks,
  canViewSimulations,
  canCreateSimulation,
  canRunSimulation,
  canCancelSimulation,
  canDeleteSimulationData,
  canViewSimulationResults,
  canViewAiAssistant,
  canGenerateAiAnalysis,
  canProposeResponseAction,
} from '../auth/rbac';

import type {
  InvestigationContext,
  AIInvestigationResponse,
  AIResponseType,
  TargetEntityType,
  AIActionProposal,
  AIActionProposalStatus,
} from '../models/ai';
import { DeterministicLocalAIProvider } from '../ai/deterministic-local-ai-provider';
import { aiService } from '../ai/ai-provider';
import type { ContextBuilderOptions } from '../ai/investigation-context-builder';
import type {
  ConnectivityState,
  ConnectivityMode,
  SyncOperation,
  SyncConflict,
  ExternalActionExecutionResult,
} from '../models/integration';
import { normalizeExternalEvent } from '../integration/event-normalizer';

import { SEED_PLAYBOOKS } from '../data/seed-playbooks';
import { ACTION_CATALOG, getAllActionDefinitions } from '../response/action-catalog';
import { validatePlaybook as validatePlaybookStructure } from '../response/playbook-validator';
import { playbookExecutionEngine } from '../response/playbook-execution-engine';

import type {
  Case,
  CaseNote,
  CaseTask,
  CaseFinding,
  CaseStatus,
  CasePriority,
  CaseSeverity,
  CaseTaskStatus,
  CreateCaseInput,
  UpdateCaseInput,
  CreateCaseNoteInput,
  UpdateCaseNoteInput,
  CreateCaseTaskInput,
  CreateCaseFindingInput,
  CaseQueryFilter,
} from '../models/case';
import { isValidCaseStatusTransition } from '../models/case';

import type {
  Evidence,
  EvidenceStatus,
  EvidenceType,
  EvidenceSourceType,
  EvidenceCustodyEntry,
  EvidenceAnnotation,
  CreateEvidenceInput,
  UpdateEvidenceMetadataInput,
  CreateEvidenceAnnotationInput,
  EvidenceQueryFilter,
} from '../models/evidence';
import { isValidEvidenceStatusTransition } from '../models/evidence';
import { computeSha256, computeStringSha256 } from '../security/evidence-crypto';

import type {
  ThreatHunt,
  ThreatHuntQuery,
  ThreatHuntExecutionResult,
  CreateThreatHuntInput,
  CreateIncidentFromHuntInput,
  ThreatHuntTemplate,
} from '../models/hunting';

import {
  executeHuntQuery,
  BLACKTIDE_HUNT_TEMPLATES,
} from '../hunting/threat-hunt-engine';

import {
  SEED_ASSETS,
  SEED_USERS,
  SEED_IOCS,
  SEED_INCIDENT,
  SEED_INCIDENT_2,
  SEED_ATTACK_GRAPH,
  SEED_SYSTEM_RADAR,
  SEED_IOC_GRAPH,
  SEED_MITRE_COVERAGE,
  SEED_AUDIT_RECORDS,
  SEED_RESPONSE_ACTIONS,
  SEED_SCENARIOS,
} from '../data/seed-data';
import { SEED_SECURITY_EVENTS } from '../data/seed-events';
import { SEED_DETECTION_RULES } from '../security/detection-rules';

import {
  validateSecurityEvent,
  normalizeSecurityEvent,
  querySecurityEvents,
  computeEventStats,
  simpleHash,
} from '../security/event-engine';

import {
  evaluateRule,
  generateAlertFingerprint,
  buildAlertFromMatch,
  queryAlerts,
  computeAlertStats,
} from '../security/detection-engine';

import {
  findBestMatchingIncident,
  evaluateAlertAgainstIncident,
  deriveIncidentSeverity,
  deriveIncidentPriority,
  computeIncidentRiskScore,
  buildTimelineFromEvents,
  buildCorrelationChainFromAlerts,
  queryIncidents,
  AUTOMATIC_CORRELATION_THRESHOLD,
  CANDIDATE_CORRELATION_THRESHOLD,
} from '../security/correlation-engine';

import type {
  Alert,
  AlertQuery,
  AlertStats,
  DetectionRule,
  DetectionRuleVersion,
  CreateDetectionRuleInput,
  UpdateDetectionRuleInput,
  RuleValidationResult,
  TestRunOptions,
  DetectionTestRun,
  DetectionTestRunResult,
  RuleDiffResult,
} from '../models/detection';
import { validateRule } from '../security/rule-validator';
import { simulateRule, diffRuleVersions } from '../security/detection-engine';

import {
  getAll,
  getMeta,
  setMeta,
  put,
  putMany,
  META_SEEDED,
  META_EVENTS_SEEDED,
  META_ALERTS_SEEDED,
  META_CORRELATION_SEEDED,
  META_HUNTS_SEEDED,
  META_CASES_SEEDED,
  META_CASE_SEQUENCE,
  META_EVIDENCE_SEEDED,
  META_EVIDENCE_SEQUENCE,
  META_THREAT_INTEL_SEEDED,
  META_RULES_SEEDED,
  META_PLAYBOOKS_SEEDED,
  META_SIMULATIONS_SEEDED,
  META_SCENARIO,
  META_DB_VERSION,
  DB_VERSION,
  getNextCaseNumber,
  getNextEvidenceNumber,
  deleteRecord,
  openDb,
} from '../storage/idb-store';
import type { ScenarioMeta } from '../storage/idb-store';
import type {
  SimulationScenario,
  SimulationRun,
  SimulationResult,
  StartSimulationOptions,
} from '../models/simulation';
import { SimulationEngine } from '../simulation/simulation-engine';
import { SEED_SIMULATION_SCENARIOS } from '../simulation/simulation-scenarios';
import { checkReferentialIntegrity, type ReferentialIntegrityReport } from '../security/integrity-checker';

import type {
  ThreatIntelRecord,
  ThreatIntelRelationship,
  CreateThreatIntelInput,
  UpdateThreatIntelInput,
  ThreatIntelQueryFilter,
  IndicatorObservations,
} from '../models/threat-intel';
import type { IocType } from '../models/entity';
import { ThreatIntelEngine } from '../security/threat-intel-engine';
import type {
  Playbook,
  PlaybookVersion,
  PlaybookExecution,
  PlaybookStepExecution,
  ApprovalRecord,
  ResponsePolicy,
  DryRunResult,
  PlaybookValidationResult,
  ActionDefinition,
} from '../models/response';
import type {
  TimeWindowFilter,
  SocOperationalSnapshot,
  KpiResult,
  TimeSeriesBucket,
  DistributionBucket,
  TopEntityItem,
  SocActivityTimelineItem,
  MetricProvenance,
} from '../models/metrics';
import { metricsEngine, type CanonicalSocData } from '../metrics/metrics-engine';

// ─── Utilities ────────────────────────────────────────────────────────────────

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function uid(): string {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── LocalProvider ────────────────────────────────────────────────────────────

export class LocalProvider implements ISecurityProvider {
  readonly id = 'local-v1';
  readonly isOffline = true;

  // In-memory working copy — always in sync with IDB
  private _incidents: Incident[] = [];
  private _assets: Asset[] = [];
  private _users: SecurityUser[] = [];
  private _iocs: IOC[] = [];
  private _auditRecords: AuditRecord[] = [];
  private _responseActions: ResponseAction[] = [];
  private _events: SecurityEvent[] = [];
  private _alerts: Alert[] = [];
  private _threatHunts: ThreatHunt[] = [];
  private _cases: Case[] = [];
  private _caseNotes: CaseNote[] = [];
  private _caseTasks: CaseTask[] = [];
  private _caseFindings: CaseFinding[] = [];
  private _evidence: Evidence[] = [];
  private _evidenceAnnotations: EvidenceAnnotation[] = [];
  private _evidenceCustody: EvidenceCustodyEntry[] = [];
  private _threatIntel: ThreatIntelRecord[] = [];
  private _threatIntelRelationships: ThreatIntelRelationship[] = [];
  private _detectionRules: DetectionRule[] = clone(SEED_DETECTION_RULES);
  private _detectionRuleVersions: DetectionRuleVersion[] = [];
  private _detectionTestRuns: DetectionTestRun[] = [];
  private _playbooks: Playbook[] = clone(SEED_PLAYBOOKS);
  private _playbookVersions: PlaybookVersion[] = [];
  private _playbookExecutions: PlaybookExecution[] = [];
  private _approvals: ApprovalRecord[] = [];
  private _responsePolicies: ResponsePolicy[] = [];

  // Scenario engine state — persisted in IDB meta store
  private _activeScenarioId: string | null = null;
  private _activeScenarioStep = 0;

  // Attack Simulation & Cyber Range Engine (Step 12)
  private _simulationEngine: SimulationEngine = new SimulationEngine(this);

  // AI Investigation Assistant (Step 13)
  private _aiProvider: DeterministicLocalAIProvider = new DeterministicLocalAIProvider(this);
  private _aiActionProposals: AIActionProposal[] = [];
  private _aiResponses: AIInvestigationResponse[] = [];

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // 1. Check if the DB has been seeded before
    const seeded = await getMeta<boolean>(META_SEEDED);

    if (!seeded) {
      // First run (or after resetLocalData()) — write seed data to IDB
      await this._writeSeedToIdb();
    }

    // 1b. Check if security events store has been seeded (handles schema v1 -> v2 upgrade)
    const eventsSeeded = await getMeta<boolean>(META_EVENTS_SEEDED);
    if (!eventsSeeded) {
      await putMany<SecurityEvent>('events', clone(SEED_SECURITY_EVENTS));
      await setMeta(META_EVENTS_SEEDED, true);
    }

    // 2. Hydrate in-memory state from IDB (always — even after seeding)
    await this._hydrateFromIdb();

    // 2b. Check if alerts store has been seeded (handles schema v2 -> v3 upgrade)
    const alertsSeeded = await getMeta<boolean>(META_ALERTS_SEEDED);
    if (!alertsSeeded) {
      await this._evaluateDetectionRulesOverEvents(this._events);
      await setMeta(META_ALERTS_SEEDED, true);
      this._alerts = await getAll<Alert>('alerts');
    }

    // 2c. Check if correlation has been seeded (handles schema v3 -> v4 upgrade)
    const correlationSeeded = await getMeta<boolean>(META_CORRELATION_SEEDED);
    if (!correlationSeeded) {
      await this._seedCorrelation();
      await setMeta(META_CORRELATION_SEEDED, true);
      this._incidents = await getAll<Incident>('incidents');
      this._alerts    = await getAll<Alert>('alerts');
      this._events    = await getAll<SecurityEvent>('events');
    }

    // 2d. Check if threat hunts store has been seeded (handles schema v4 -> v5 upgrade)
    const huntsSeeded = await getMeta<boolean>(META_HUNTS_SEEDED);
    if (!huntsSeeded) {
      await this._seedThreatHunts();
      await setMeta(META_HUNTS_SEEDED, true);
      this._threatHunts = await getAll<ThreatHunt>('threat_hunts');
    }

    // 2e. Check if cases store has been seeded (handles schema v5 -> v6 upgrade)
    const casesSeeded = await getMeta<boolean>(META_CASES_SEEDED);
    if (!casesSeeded) {
      await this._seedCases();
      await setMeta(META_CASES_SEEDED, true);
      this._cases = await getAll<Case>('cases');
      this._caseNotes = await getAll<CaseNote>('case_notes');
      this._caseTasks = await getAll<CaseTask>('case_tasks');
      this._caseFindings = await getAll<CaseFinding>('case_findings');
    }

    // 2f. Check if evidence store has been seeded (handles schema v6 -> v7 upgrade)
    const evidenceSeeded = await getMeta<boolean>(META_EVIDENCE_SEEDED);
    if (!evidenceSeeded) {
      await this._seedEvidence();
      await setMeta(META_EVIDENCE_SEEDED, true);
      this._evidence = await getAll<Evidence>('evidence');
      this._evidenceAnnotations = await getAll<EvidenceAnnotation>('evidence_annotations');
      this._evidenceCustody = await getAll<EvidenceCustodyEntry>('evidence_custody');
    }

    // 2g. Check if threat intelligence store has been seeded (handles schema v7 -> v8 upgrade)
    const threatIntelSeeded = await getMeta<boolean>(META_THREAT_INTEL_SEEDED);
    if (!threatIntelSeeded) {
      await this._seedThreatIntel();
      await setMeta(META_THREAT_INTEL_SEEDED, true);
      this._threatIntel = await getAll<ThreatIntelRecord>('threat_intel');
      this._threatIntelRelationships = await getAll<ThreatIntelRelationship>('threat_intel_relationships');
    }

    // 2h. Check if detection rules store has been seeded (handles schema v8 -> v9 upgrade)
    const rulesSeeded = await getMeta<boolean>(META_RULES_SEEDED);
    if (!rulesSeeded) {
      await this._seedDetectionRules();
      await setMeta(META_RULES_SEEDED, true);
    }
    this._detectionRules = await getAll<DetectionRule>('detection_rules');
    this._detectionRuleVersions = await getAll<DetectionRuleVersion>('detection_rule_versions');
    this._detectionTestRuns = await getAll<DetectionTestRun>('detection_test_runs');

    // 2i. Check if SOAR playbooks store has been seeded (handles schema v9 -> v10 upgrade)
    const playbooksSeeded = await getMeta<boolean>(META_PLAYBOOKS_SEEDED);
    if (!playbooksSeeded) {
      await this._seedPlaybooks();
      await setMeta(META_PLAYBOOKS_SEEDED, true);
    }
    this._playbooks = await getAll<Playbook>('playbooks');
    this._playbookVersions = await getAll<PlaybookVersion>('playbook_versions');
    this._playbookExecutions = await getAll<PlaybookExecution>('playbook_executions');
    this._approvals = await getAll<ApprovalRecord>('approvals');
    this._responsePolicies = await getAll<ResponsePolicy>('response_policies');

    // 2j. Check if simulation scenarios have been seeded (handles schema v10 -> v11 upgrade)
    const simulationsSeeded = await getMeta<boolean>(META_SIMULATIONS_SEEDED);
    if (!simulationsSeeded) {
      for (const scen of SEED_SIMULATION_SCENARIOS) {
        await this._simulationEngine.registerScenario(scen);
      }
      await setMeta(META_SIMULATIONS_SEEDED, true);
    }
    await this._simulationEngine.recoverPersistedRuns();

    // 2k. Load AI action proposals and investigation responses (Step 13)
    try {
      this._aiActionProposals = await getAll<AIActionProposal>('ai_action_proposals');
      this._aiResponses = await getAll<AIInvestigationResponse>('ai_investigation_responses');
    } catch {
      // Stores empty or freshly created
    }
    aiService.setProvider(this._aiProvider);

    // 3. Restore scenario state
    const scenarioMeta = await getMeta<ScenarioMeta>(META_SCENARIO);
    if (scenarioMeta) {
      this._activeScenarioId   = scenarioMeta.activeScenarioId;
      this._activeScenarioStep = scenarioMeta.activeScenarioStep;
    }

    // 4. Record schema version in meta (useful for future migrations)
    await setMeta(META_DB_VERSION, DB_VERSION);
  }

  // ─── Authentication & Session ───────────────────────────────────────────────

  async authenticate(credentials: UserCredentials): Promise<UserSession> {
    return localAuthenticate(credentials);
  }

  getCurrentSession(): UserSession | null {
    return getCurrentSession();
  }

  async logout(): Promise<void> {
    localLogout();
  }

  getRoles(): RoleDefinition[] {
    return getLocalRoles();
  }

  // ─── Core Data Queries ──────────────────────────────────────────────────────

  async getIncidents(query?: IncidentQuery): Promise<Incident[]> {
    if (!query) {
      return clone(this._incidents);
    }
    return clone(queryIncidents(this._incidents, query));
  }

  async getIncidentById(id: string): Promise<IncidentDetail | null> {
    const incident = this._incidents.find((i) => i.id === id);
    if (!incident) return null;

    const assets       = this._assets.filter((a) => incident.affectedAssets.includes(a.id));
    const users        = this._users.filter((u) => incident.affectedUsers.includes(u.id));
    const iocDetails   = this._iocs.filter((ioc) => incident.iocs.includes(ioc.id));
    const mitreCov     = SEED_MITRE_COVERAGE.filter((c) => incident.mitreTechniques.includes(c.technique.id));
    const techniques   = mitreCov.map((c) => c.technique);
    const attackGraph  = id === 'incident-001' ? clone(SEED_ATTACK_GRAPH) : this._buildFallbackAttackGraph(incident);
    const responseActions = this._responseActions.filter((a) => a.incidentId === id);

    return clone({ ...incident, assets, users, iocDetails, techniques, attackGraph, responseActions });
  }

  async getAttackGraph(incidentId: string): Promise<AttackGraph | null> {
    if (incidentId === 'incident-001') return clone(SEED_ATTACK_GRAPH);
    const inc = this._incidents.find((i) => i.id === incidentId);
    if (inc) return clone(this._buildFallbackAttackGraph(inc));
    return null;
  }

  async getSystemRadar(incidentId: string): Promise<SystemRadarData | null> {
    const incident = this._incidents.find((i) => i.id === incidentId);
    if (!incident) return null;

    let baseRadar: SystemRadarData;
    if (incidentId === 'incident-001') {
      baseRadar = clone(SEED_SYSTEM_RADAR);
    } else {
      const focalAssetId = incident.affectedAssets[0] ?? (this._assets[0]?.id ?? 'asset-001');
      const nodes: SystemRadarNode[] = this._assets
        .filter((a) => incident.affectedAssets.includes(a.id))
        .map((a, idx) => ({
          asset: a,
          blastRadiusLevel: a.status === 'ISOLATED' ? 'SAFE' : (a.blastRadiusLevel ?? 'POTENTIAL'),
          distance: 0.3 + idx * 0.18,
          angle: (idx * 2 * Math.PI) / Math.max(1, incident.affectedAssets.length),
          hopCount: idx + 1,
        }));

      baseRadar = {
        incidentId,
        focalAssetId,
        totalAssetsAtRisk: nodes.filter((n) => n.blastRadiusLevel === 'AT_RISK' || n.blastRadiusLevel === 'POTENTIAL').length,
        compromisedCount: nodes.filter((n) => n.asset.status === 'COMPROMISED').length,
        isolatedCount: nodes.filter((n) => n.asset.status === 'ISOLATED').length,
        assets: nodes,
      };
    }

    // Always overlay authoritative asset status from canonical state
    baseRadar.assets = baseRadar.assets.map((node) => {
      const liveAsset = this._assets.find((a) => a.id === node.asset.id);
      if (liveAsset) {
        return {
          ...node,
          asset: clone(liveAsset),
          blastRadiusLevel: liveAsset.status === 'ISOLATED' ? 'SAFE' : (liveAsset.blastRadiusLevel ?? node.blastRadiusLevel),
        };
      }
      return node;
    });

    baseRadar.isolatedCount = baseRadar.assets.filter((n) => n.asset.status === 'ISOLATED').length;
    baseRadar.compromisedCount = baseRadar.assets.filter((n) => n.asset.status === 'COMPROMISED').length;
    baseRadar.totalAssetsAtRisk = baseRadar.assets.filter((n) => n.asset.status !== 'ISOLATED' && n.blastRadiusLevel !== 'SAFE').length;

    return baseRadar;
  }

  async getTimeline(incidentId: string): Promise<TimelineEvent[]> {
    const incident = this._incidents.find((i) => i.id === incidentId);
    return incident ? clone(incident.timelineEvents) : [];
  }

  async getIocConstellation(incidentId: string): Promise<IocGraphData | null> {
    const incident = this._incidents.find((i) => i.id === incidentId);
    if (!incident) return null;

    let baseGraph: IocGraphData;
    if (incidentId === 'incident-001') {
      baseGraph = clone(SEED_IOC_GRAPH);
    } else {
      const relevantIocs = this._iocs.filter((ioc) => incident.iocs.includes(ioc.id));
      const links = relevantIocs.map((ioc) => ({
        sourceIocId: ioc.id,
        targetEntityId: incident.affectedAssets[0] ?? incidentId,
        targetType: incident.affectedAssets[0] ? ('ASSET' as const) : ('INCIDENT' as const),
        relation: 'CORRELATED_WITH',
      }));
      baseGraph = { incidentId, iocs: relevantIocs, links };
    }

    // Always overlay canonical isBlocked from this._iocs
    baseGraph.iocs = baseGraph.iocs.map((ioc) => {
      const liveIoc = this._iocs.find((i) => i.id === ioc.id);
      return liveIoc ? clone(liveIoc) : ioc;
    });

    return baseGraph;
  }

  async getMitreMatrix(): Promise<MitreTechniqueCoverage[]> {
    return clone(SEED_MITRE_COVERAGE);
  }

  async getAuditLogs(): Promise<AuditRecord[]> {
    return clone(this._auditRecords);
  }

  async getAssets(): Promise<Asset[]> {
    return clone(this._assets);
  }

  async getUsers(): Promise<SecurityUser[]> {
    return clone(this._users);
  }

  async getIOCs(): Promise<IOC[]> {
    return clone(this._iocs);
  }

  async getResponseActions(incidentId?: string): Promise<ResponseAction[]> {
    if (incidentId) {
      return clone(this._responseActions.filter((a) => a.incidentId === incidentId));
    }
    return clone(this._responseActions);
  }

  // ─── Security Event Engine ──────────────────────────────────────────────────

  async getEvents(query?: SecurityEventQuery): Promise<SecurityEvent[]> {
    return querySecurityEvents(this._events, query);
  }

  async getEventById(id: string): Promise<SecurityEvent | null> {
    const hit = this._events.find((e) => e.id === id);
    return hit ? clone(hit) : null;
  }

  async getEventStats(): Promise<SecurityEventStats> {
    return computeEventStats(this._events);
  }

  async ingestEvent(
    eventInput: SecurityEventInput,
    actor?: string,
    actorRole?: RoleId
  ): Promise<IngestEventResult> {
    // 1. RBAC authorization validation
    if (actorRole && !canIngestEvents(actorRole)) {
      return {
        success: false,
        isDuplicate: false,
        error: `Unauthorized: Role "${actorRole}" does not have telemetry ingestion privileges`,
      };
    }

    // 2. Referential integrity context
    const knownAssets = new Set(this._assets.map((a) => a.id));
    const knownUsers = new Set(this._users.map((u) => u.id));
    const knownIncidents = new Set(this._incidents.map((i) => i.id));
    const knownIocs = new Set(this._iocs.map((ioc) => ioc.id));

    // 3. Validation
    const validation = validateSecurityEvent(eventInput, {
      knownAssets,
      knownUsers,
      knownIncidents,
      knownIocs,
    });

    if (!validation.valid) {
      return {
        success: false,
        isDuplicate: false,
        error: `Validation failed: ${validation.errors.join('; ')}`,
      };
    }

    // 4. Normalization
    const normalized = normalizeSecurityEvent(eventInput);

    // 5. Deduplication check
    const existing = this._events.find(
      (e) => e.id === normalized.id || (e.signature && e.signature === normalized.signature)
    );
    if (existing) {
      return {
        success: true,
        event: clone(existing),
        isDuplicate: true,
      };
    }

    // 6. Persistence to IndexedDB 'events' store before in-memory state update
    await put<SecurityEvent>('events', normalized);

    // 7. In-memory update (newest first)
    this._events.unshift(normalized);

    // 8. Trigger Detection Engine pipeline
    await this._processEventForDetections(normalized, actor, actorRole);

    return {
      success: true,
      event: clone(normalized),
      isDuplicate: false,
    };
  }

  async ingestEvents(
    eventsInput: SecurityEventInput[],
    actor?: string,
    actorRole?: RoleId
  ): Promise<IngestEventResult[]> {
    const results: IngestEventResult[] = [];
    for (const input of eventsInput) {
      const res = await this.ingestEvent(input, actor, actorRole);
      results.push(res);
    }
    return results;
  }

  // ─── Detection & Alert Engine APIs ──────────────────────────────────────────

  async getAlerts(query?: AlertQuery): Promise<Alert[]> {
    return queryAlerts(this._alerts, query);
  }

  async getAlertById(id: string): Promise<Alert | null> {
    const alert = this._alerts.find((a) => a.id === id);
    return alert ? clone(alert) : null;
  }

  async getOpenAlerts(): Promise<Alert[]> {
    return queryAlerts(this._alerts, { status: ['NEW', 'ACKNOWLEDGED'] });
  }

  async getAlertsForRule(ruleId: string): Promise<Alert[]> {
    return queryAlerts(this._alerts, { ruleId });
  }

  async getAlertsForEvent(eventId: string): Promise<Alert[]> {
    return clone(this._alerts.filter((a) => a.sourceEventIds.includes(eventId)));
  }

  async getAlertsForAsset(assetId: string): Promise<Alert[]> {
    return queryAlerts(this._alerts, { assetId });
  }

  async getAlertsForIncident(incidentId: string): Promise<Alert[]> {
    return queryAlerts(this._alerts, { incidentId });
  }

  async getAlertStats(): Promise<AlertStats> {
    return computeAlertStats(this._alerts);
  }

  async acknowledgeAlert(
    alertId: string,
    actor: string,
    actorRole: RoleId,
    notes?: string
  ): Promise<Alert> {
    if (!canAcknowledgeAlert(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" does not have alert triage privileges`);
    }

    const alert = this._alerts.find((a) => a.id === alertId);
    if (!alert) throw new Error(`Alert "${alertId}" not found`);

    if (alert.status === 'RESOLVED') {
      throw new Error(`Invalid state transition: Cannot acknowledge already RESOLVED alert "${alertId}"`);
    }

    const previousStatus = alert.status;
    alert.status = 'ACKNOWLEDGED';
    alert.acknowledgedAt = new Date().toISOString();
    alert.acknowledgedBy = actor;
    if (notes) {
      alert.analystNotes = alert.analystNotes ? `${alert.analystNotes}\n[${actor}]: ${notes}` : `[${actor}]: ${notes}`;
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'ALERT_ACKNOWLEDGED',
      target: alertId,
      previousState: previousStatus,
      resultingState: 'ACKNOWLEDGED',
      authorization: 'INCIDENT_TRIAGE',
      outcome: 'SUCCESS',
      details: { ruleId: alert.ruleId, notes },
    });
    this._auditRecords.push(auditEntry);

    await put<Alert>('alerts', alert);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(alert);
  }

  async resolveAlert(
    alertId: string,
    actor: string,
    actorRole: RoleId,
    notes?: string
  ): Promise<Alert> {
    if (!canResolveAlert(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" does not have alert resolution privileges`);
    }

    const alert = this._alerts.find((a) => a.id === alertId);
    if (!alert) throw new Error(`Alert "${alertId}" not found`);

    const previousStatus = alert.status;
    alert.status = 'RESOLVED';
    alert.resolvedBy = actor;
    alert.resolvedAt = new Date().toISOString();
    if (notes) {
      alert.analystNotes = alert.analystNotes ? `${alert.analystNotes}\n[${actor}]: ${notes}` : `[${actor}]: ${notes}`;
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'ALERT_RESOLVED',
      target: alertId,
      previousState: previousStatus,
      resultingState: 'RESOLVED',
      authorization: 'INCIDENT_TRIAGE',
      outcome: 'SUCCESS',
      details: { ruleId: alert.ruleId, notes },
    });
    this._auditRecords.push(auditEntry);

    await put<Alert>('alerts', alert);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(alert);
  }

  async getDetectionRules(): Promise<DetectionRule[]> {
    return clone(this._detectionRules);
  }

  async getDetectionRule(id: string): Promise<DetectionRule | null> {
    const rule = this._detectionRules.find((r) => r.id === id || r.ruleId === id);
    return rule ? clone(rule) : null;
  }

  async getDetectionRuleByRuleId(ruleId: string): Promise<DetectionRule | null> {
    const rule = this._detectionRules.find((r) => r.ruleId === ruleId || r.id === ruleId);
    return rule ? clone(rule) : null;
  }

  async getDetectionRuleVersions(ruleId: string): Promise<DetectionRuleVersion[]> {
    const versions = this._detectionRuleVersions
      .filter((v) => v.ruleId === ruleId)
      .sort((a, b) => b.version - a.version);
    return clone(versions);
  }

  async createDetectionRuleDraft(
    input: CreateDetectionRuleInput,
    actor: string,
    actorRole: RoleId
  ): Promise<DetectionRule> {
    if (!canAuthorDetectionRules(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot author detection rules`);
    }

    const now = new Date().toISOString();
    const id = `rule-${Date.now()}-${simpleHash(input.name).slice(0, 6)}`;
    const ruleId = input.ruleId || `DET-CUST-${simpleHash(input.name).slice(0, 4).toUpperCase()}`;

    const newRule: DetectionRule = {
      id,
      ruleId,
      version: 1,
      name: input.name,
      description: input.description,
      status: 'DRAFT',
      enabled: false,
      severity: input.severity,
      category: input.category,
      eventTypes: input.eventTypes,
      conditions: input.conditions,
      threshold: input.threshold ?? 1,
      timeWindowMs: input.timeWindowMs ?? 900000,
      mitreTechniqueId: input.mitreTechniqueId,
      mitreTechniqueIds: input.mitreTechniqueIds,
      mitreTactic: input.mitreTactic,
      tags: input.tags ?? [],
      author: actor,
      authorId: actor,
      versionStatus: 'ACTIVE',
      changeDescription: input.changeDescription || 'Initial draft creation',
      createdAt: now,
      updatedAt: now,
    };

    this._detectionRules.push(newRule);
    await put<DetectionRule>('detection_rules', newRule);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RULE_CREATED',
      target: newRule.id,
      previousState: undefined,
      resultingState: 'DRAFT',
      authorization: 'DETECTION_RULE_AUTHOR',
      outcome: 'SUCCESS',
      details: {
        ruleId: newRule.ruleId,
        version: newRule.version,
        name: newRule.name,
        category: newRule.category,
        severity: newRule.severity,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newRule);
  }

  async updateDetectionRuleDraft(
    id: string,
    patch: UpdateDetectionRuleInput,
    actor: string,
    actorRole: RoleId
  ): Promise<DetectionRule> {
    if (!canAuthorDetectionRules(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot edit detection rules`);
    }

    const ruleIndex = this._detectionRules.findIndex((r) => r.id === id || r.ruleId === id);
    if (ruleIndex === -1) {
      throw new Error(`Detection rule with ID "${id}" not found`);
    }

    const rule = this._detectionRules[ruleIndex];
    const now = new Date().toISOString();
    const prevStatus = rule.status;

    // If the rule is already published or enabled, editing creates a new DRAFT version!
    if (rule.status === 'PUBLISHED' || rule.status === 'ENABLED' || rule.status === 'DISABLED') {
      rule.version = (rule.version ?? 1) + 1;
      rule.status = 'DRAFT';
      rule.enabled = false;
      rule.disabledAt = undefined;
    }

    if (patch.name !== undefined) rule.name = patch.name;
    if (patch.description !== undefined) rule.description = patch.description;
    if (patch.severity !== undefined) rule.severity = patch.severity;
    if (patch.category !== undefined) rule.category = patch.category;
    if (patch.eventTypes !== undefined) rule.eventTypes = patch.eventTypes;
    if (patch.conditions !== undefined) rule.conditions = patch.conditions;
    if (patch.threshold !== undefined) rule.threshold = patch.threshold;
    if (patch.timeWindowMs !== undefined) rule.timeWindowMs = patch.timeWindowMs;
    if (patch.mitreTechniqueId !== undefined) rule.mitreTechniqueId = patch.mitreTechniqueId;
    if (patch.mitreTechniqueIds !== undefined) rule.mitreTechniqueIds = patch.mitreTechniqueIds;
    if (patch.mitreTactic !== undefined) rule.mitreTactic = patch.mitreTactic;
    if (patch.tags !== undefined) rule.tags = patch.tags;
    if (patch.changeDescription !== undefined) rule.changeDescription = patch.changeDescription;
    rule.updatedAt = now;

    this._detectionRules[ruleIndex] = rule;
    await put<DetectionRule>('detection_rules', rule);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RULE_EDITED',
      target: rule.id,
      previousState: prevStatus,
      resultingState: rule.status,
      authorization: 'DETECTION_RULE_AUTHOR',
      outcome: 'SUCCESS',
      details: {
        ruleId: rule.ruleId,
        version: rule.version,
        changeDescription: rule.changeDescription,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(rule);
  }

  async validateDetectionRule(idOrRule: string | DetectionRule): Promise<RuleValidationResult> {
    let rule: DetectionRule;
    if (typeof idOrRule === 'string') {
      const found = this._detectionRules.find((r) => r.id === idOrRule || r.ruleId === idOrRule);
      if (!found) throw new Error(`Detection rule "${idOrRule}" not found`);
      rule = found;
    } else {
      rule = idOrRule;
    }

    const validation = validateRule(rule);

    // If valid and currently in DRAFT, transition to VALIDATING
    if (validation.valid && rule.id) {
      const idx = this._detectionRules.findIndex((r) => r.id === rule.id);
      if (idx !== -1 && this._detectionRules[idx].status === 'DRAFT') {
        this._detectionRules[idx].status = 'VALIDATING';
        this._detectionRules[idx].updatedAt = new Date().toISOString();
        await put<DetectionRule>('detection_rules', this._detectionRules[idx]);
      }
    }

    return validation;
  }

  async testDetectionRule(
    ruleIdOrRule: string | DetectionRule,
    options?: TestRunOptions,
    actor: string = 'ANALYST',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<DetectionTestRunResult> {
    if (!canTestDetectionRules(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot test detection rules`);
    }

    let rule: DetectionRule;
    if (typeof ruleIdOrRule === 'string') {
      const found = this._detectionRules.find((r) => r.id === ruleIdOrRule || r.ruleId === ruleIdOrRule);
      if (!found) throw new Error(`Detection rule "${ruleIdOrRule}" not found`);
      rule = found;
    } else {
      rule = ruleIdOrRule;
    }

    // Side-effect free simulation testing against canonical events
    const simResult = simulateRule(rule, this._events, options);

    // Persist test run telemetry
    this._detectionTestRuns.push(simResult.testRun);
    await put<DetectionTestRun>('detection_test_runs', simResult.testRun);

    // Advance lifecycle to TESTING if in DRAFT or VALIDATING
    if (rule.id) {
      const idx = this._detectionRules.findIndex((r) => r.id === rule.id);
      if (idx !== -1 && (this._detectionRules[idx].status === 'DRAFT' || this._detectionRules[idx].status === 'VALIDATING')) {
        this._detectionRules[idx].status = 'TESTING';
        this._detectionRules[idx].updatedAt = new Date().toISOString();
        await put<DetectionRule>('detection_rules', this._detectionRules[idx]);
      }
    }

    // Log test execution audit
    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RULE_TEST_EXECUTED',
      target: rule.ruleId ?? rule.id,
      previousState: undefined,
      resultingState: 'TESTED',
      authorization: 'DETECTION_RULE_TEST',
      outcome: 'SUCCESS',
      details: {
        ruleId: rule.ruleId ?? rule.id,
        version: rule.version ?? 1,
        eventsEvaluated: simResult.testRun.eventsEvaluated,
        eventsMatched: simResult.testRun.eventsMatched,
        executionTimeMs: simResult.testRun.executionTimeMs,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return simResult;
  }

  async publishDetectionRule(
    id: string,
    changeDescription: string,
    actor: string,
    actorRole: RoleId
  ): Promise<DetectionRule> {
    if (!canManageDetectionRules(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" does not have authority to publish detection rules`);
    }

    const ruleIndex = this._detectionRules.findIndex((r) => r.id === id || r.ruleId === id);
    if (ruleIndex === -1) {
      throw new Error(`Detection rule with ID "${id}" not found`);
    }

    const rule = this._detectionRules[ruleIndex];

    // Must be validated before publishing
    const validation = validateRule(rule);
    if (!validation.valid) {
      throw new Error(
        `Cannot publish invalid rule: ${validation.errors.map((e) => e.message).join('; ')}`
      );
    }

    const now = new Date().toISOString();
    const versionNum = rule.version ?? 1;

    // Create immutable historical version snapshot
    const verSnapshot: DetectionRuleVersion = {
      id: `${rule.ruleId ?? rule.id}-v${versionNum}`,
      ruleId: rule.ruleId ?? rule.id,
      version: versionNum,
      rule: clone(rule),
      author: actor,
      authorId: actor,
      changeDescription: changeDescription || rule.changeDescription || `Version ${versionNum} published`,
      publishedAt: now,
      createdAt: rule.createdAt,
    };

    // Store version
    this._detectionRuleVersions = this._detectionRuleVersions.filter((v) => v.id !== verSnapshot.id);
    this._detectionRuleVersions.push(verSnapshot);
    await put<DetectionRuleVersion>('detection_rule_versions', verSnapshot);

    // Update active rule status
    rule.status = 'PUBLISHED';
    rule.publishedAt = now;
    rule.versionStatus = 'ACTIVE';
    rule.changeDescription = changeDescription || rule.changeDescription;
    rule.updatedAt = now;

    this._detectionRules[ruleIndex] = rule;
    await put<DetectionRule>('detection_rules', rule);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RULE_PUBLISHED',
      target: rule.id,
      previousState: 'TESTING',
      resultingState: 'PUBLISHED',
      authorization: 'DETECTION_RULE_MANAGE',
      outcome: 'SUCCESS',
      details: {
        ruleId: rule.ruleId,
        version: rule.version,
        changeDescription: verSnapshot.changeDescription,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(rule);
  }

  async enableDetectionRule(id: string, actor: string, actorRole: RoleId): Promise<DetectionRule> {
    if (!canManageDetectionRules(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot enable detection rules`);
    }

    const ruleIndex = this._detectionRules.findIndex((r) => r.id === id || r.ruleId === id);
    if (ruleIndex === -1) {
      throw new Error(`Detection rule with ID "${id}" not found`);
    }

    const rule = this._detectionRules[ruleIndex];
    if (rule.status === 'DRAFT' || rule.status === 'VALIDATING') {
      const v = validateRule(rule);
      if (!v.valid) {
        throw new Error('Cannot enable unvalidated detection rule');
      }
    }

    const prevStatus = rule.status;
    rule.status = 'ENABLED';
    rule.enabled = true;
    rule.disabledAt = undefined;
    rule.updatedAt = new Date().toISOString();

    this._detectionRules[ruleIndex] = rule;
    await put<DetectionRule>('detection_rules', rule);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RULE_ENABLED',
      target: rule.id,
      previousState: prevStatus,
      resultingState: 'ENABLED',
      authorization: 'DETECTION_RULE_MANAGE',
      outcome: 'SUCCESS',
      details: { ruleId: rule.ruleId, version: rule.version },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(rule);
  }

  async disableDetectionRule(id: string, actor: string, actorRole: RoleId): Promise<DetectionRule> {
    if (!canManageDetectionRules(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot disable detection rules`);
    }

    const ruleIndex = this._detectionRules.findIndex((r) => r.id === id || r.ruleId === id);
    if (ruleIndex === -1) {
      throw new Error(`Detection rule with ID "${id}" not found`);
    }

    const rule = this._detectionRules[ruleIndex];
    const prevStatus = rule.status;
    rule.status = 'DISABLED';
    rule.enabled = false;
    rule.disabledAt = new Date().toISOString();
    rule.updatedAt = new Date().toISOString();

    this._detectionRules[ruleIndex] = rule;
    await put<DetectionRule>('detection_rules', rule);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RULE_DISABLED',
      target: rule.id,
      previousState: prevStatus,
      resultingState: 'DISABLED',
      authorization: 'DETECTION_RULE_MANAGE',
      outcome: 'SUCCESS',
      details: { ruleId: rule.ruleId, version: rule.version },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(rule);
  }

  async deprecateDetectionRule(id: string, actor: string, actorRole: RoleId): Promise<DetectionRule> {
    if (!canManageDetectionRules(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot deprecate detection rules`);
    }

    const ruleIndex = this._detectionRules.findIndex((r) => r.id === id || r.ruleId === id);
    if (ruleIndex === -1) {
      throw new Error(`Detection rule with ID "${id}" not found`);
    }

    const rule = this._detectionRules[ruleIndex];
    const prevStatus = rule.status;
    rule.status = 'DEPRECATED';
    rule.enabled = false;
    rule.versionStatus = 'ARCHIVED';
    rule.deprecatedAt = new Date().toISOString();
    rule.updatedAt = new Date().toISOString();

    this._detectionRules[ruleIndex] = rule;
    await put<DetectionRule>('detection_rules', rule);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RULE_DEPRECATED',
      target: rule.id,
      previousState: prevStatus,
      resultingState: 'DEPRECATED',
      authorization: 'DETECTION_RULE_MANAGE',
      outcome: 'SUCCESS',
      details: { ruleId: rule.ruleId, version: rule.version },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(rule);
  }

  async diffRuleVersions(ruleId: string, v1: number, v2: number): Promise<RuleDiffResult> {
    const ver1 = this._detectionRuleVersions.find((v) => v.ruleId === ruleId && v.version === v1);
    const ver2 = this._detectionRuleVersions.find((v) => v.ruleId === ruleId && v.version === v2);

    let rule1 = ver1?.rule;
    let rule2 = ver2?.rule;

    // Fallback to active rule if version matches
    const active = this._detectionRules.find((r) => r.ruleId === ruleId || r.id === ruleId);
    if (active) {
      if (!rule1 && active.version === v1) rule1 = active;
      if (!rule2 && active.version === v2) rule2 = active;
    }

    if (!rule1 || !rule2) {
      throw new Error(`Cannot diff versions for rule "${ruleId}": v${v1} or v${v2} not found`);
    }

    return diffRuleVersions(rule1, rule2);
  }

  private async _evaluateDetectionRulesOverEvents(events: SecurityEvent[]): Promise<void> {
    const sorted = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    for (const ev of sorted) {
      await this._processEventForDetections(ev);
    }
  }

  private async _processEventForDetections(
    event: SecurityEvent,
    actor?: string,
    actorRole?: RoleId
  ): Promise<Alert[]> {
    const matchedAlerts: Alert[] = [];
    const enabledRules = this._detectionRules.filter(
      (r) => r.enabled && (r.status === undefined || r.status === 'ENABLED')
    );

    for (const rule of enabledRules) {
      const evalResult = evaluateRule(rule, event);
      if (evalResult === 'MATCH') {
        const fingerprint = generateAlertFingerprint(rule, event, rule.timeWindowMs);
        const existing = this._alerts.find(
          (a) => (a.status === 'NEW' || a.status === 'ACKNOWLEDGED') && a.fingerprint === fingerprint
        );

        if (existing) {
          existing.lastSeenAt = event.timestamp;
          existing.occurrenceCount += 1;
          if (!existing.sourceEventIds.includes(event.id)) {
            existing.sourceEventIds.push(event.id);
          }
          if (event.metadata?.simulation && !existing.metadata?.simulation) {
            existing.metadata = {
              ...(existing.metadata ?? {}),
              simulation: event.metadata.simulation,
              isSimulated: true,
            };
          }
          await put<Alert>('alerts', existing);
          matchedAlerts.push(existing);
        } else {
          const newAlert = buildAlertFromMatch(rule, event, fingerprint);
          if (event.metadata?.simulation) {
            newAlert.metadata = {
              ...(newAlert.metadata ?? {}),
              simulation: event.metadata.simulation,
              isSimulated: true,
            };
          }
          this._alerts.unshift(newAlert);
          await put<Alert>('alerts', newAlert);

          const auditEntry = this._buildAudit({
            actor: actor ?? 'DETECTION_ENGINE',
            actorRole: actorRole ?? 'L1_ANALYST',
            action: 'ALERT_GENERATED',
            target: newAlert.id,
            previousState: undefined,
            resultingState: 'NEW',
            authorization: 'DETECTION_ENGINE',
            outcome: 'SUCCESS',
            details: {
              ruleId: rule.id,
              ruleName: rule.name,
              severity: newAlert.severity,
              primaryEventId: event.id,
              assetId: newAlert.assetId,
            },
          });
          this._auditRecords.push(auditEntry);
          await put<AuditRecord>('audit_records', auditEntry);

          matchedAlerts.push(newAlert);
        }
      }
    }

    // 3. Trigger Correlation Engine for all matched alerts
    for (const alert of matchedAlerts) {
      await this._correlateAlert(alert, event);
    }

    return matchedAlerts;
  }

  // ─── Incident Lifecycle & Offline Creation ──────────────────────────────────

  async createIncident(
    input: CreateIncidentInput,
    actor: string,
    actorRole: RoleId
  ): Promise<Incident> {
    // 1. RBAC validation
    if (!canCreateIncident(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" does not have INCIDENT_CREATE permission`);
    }

    const now = new Date().toISOString();
    const id = `incident-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // 2. Initial timeline event
    const initialTimelineEvent: TimelineEvent = {
      id: uid(),
      timestamp: now,
      title: `Incident Ingested: ${input.title}`,
      stage: 'INITIAL_ACCESS',
      severity: input.severity,
      description: input.initialDetectionDescription ?? input.summary ?? `Incident ${input.title} created by ${actor} (${actorRole})`,
    };

    const newIncident: Incident = {
      id,
      title: input.title,
      description: input.description,
      severity: input.severity,
      priority: input.priority ?? (input.severity === 'CRITICAL' ? 'P1' : input.severity === 'HIGH' ? 'P2' : input.severity === 'MEDIUM' ? 'P3' : 'P4'),
      riskScore: input.riskScore ?? (input.severity === 'CRITICAL' ? 95 : input.severity === 'HIGH' ? 80 : 50),
      status: 'NEW', // canonical initial status
      confidence: 0.88,
      source: input.source ?? 'MANUAL',
      createdAt: now,
      updatedAt: now,
      firstSeenAt: input.firstSeenAt ?? now,
      lastSeenAt: input.lastSeenAt ?? now,
      assignedTo: actor,
      assignedRole: actorRole,
      affectedAssets: input.affectedAssets ?? [],
      affectedUsers: input.affectedUsers ?? [],
      iocs: input.iocs ?? [],
      mitreTechniques: input.mitreTechniques ?? ['T1078.002'],
      eventIds: input.eventIds ?? [],
      alertIds: input.alertIds ?? [],
      correlationScore: input.correlationScore,
      correlationReasons: input.correlationReasons ?? [],
      tags: input.tags ?? [],
      timelineEvents: [initialTimelineEvent],
      correlationChain: [],
      evidence: [],
      summary: input.summary ?? `Offline incident ${input.title} logged for triage.`,
    };

    // 3. Commit to memory and IndexedDB
    this._incidents.push(newIncident);
    await put<Incident>('incidents', newIncident);

    // 4. Audit trail
    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'INCIDENT_CREATED',
      target: newIncident.id,
      previousState: 'NONE',
      resultingState: 'NEW',
      authorization: 'INCIDENT_CREATE',
      outcome: 'SUCCESS',
      details: {
        title: newIncident.title,
        severity: newIncident.severity,
        assignedRole: actorRole,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newIncident);
  }

  async escalateIncident(
    incidentId: string,
    toRole: RoleId,
    reason: string,
    actor: string,
    actorRole: RoleId
  ): Promise<Incident> {
    const incident = this._incidents.find((i) => i.id === incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);

    incident.assignedRole = toRole;
    incident.updatedAt    = new Date().toISOString();

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'INCIDENT_ESCALATED',
      target: incidentId,
      previousState: incident.status,
      resultingState: `Escalated to ${toRole}`,
      authorization: 'INCIDENT_ESCALATE',
      outcome: 'SUCCESS',
      details: { toRole, reason },
    });
    this._auditRecords.push(auditEntry);

    await put<Incident>('incidents', incident);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(incident);
  }

  async updateIncidentStatus(
    incidentId: string,
    status: IncidentStatus,
    actor: string,
    actorRole: RoleId,
    reason?: string
  ): Promise<Incident> {
    const incident = this._incidents.find((i) => i.id === incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);

    const previousStatus  = incident.status;
    incident.status       = status;
    incident.updatedAt    = new Date().toISOString();
    if (status === 'CLOSED' || status === 'RESOLVED') {
      incident.closedAt = incident.closedAt || new Date().toISOString();
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'INCIDENT_STATUS_UPDATED',
      target: incidentId,
      previousState: previousStatus,
      resultingState: status,
      authorization: 'INCIDENT_INVESTIGATE',
      outcome: 'SUCCESS',
      details: { reason: reason ?? 'No reason given' },
    });
    this._auditRecords.push(auditEntry);

    await put<Incident>('incidents', incident);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(incident);
  }

  async addEvidence(
    incidentId: string,
    evidence: Omit<IncidentEvidence, 'id' | 'collectedAt'>,
    actor: string
  ): Promise<IncidentEvidence> {
    const incident = this._incidents.find((i) => i.id === incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);

    const newEvidence: IncidentEvidence = {
      ...evidence,
      id: uid(),
      incidentId,
      collectedAt: new Date().toISOString(),
      collectedBy: actor,
    };
    incident.evidence.push(newEvidence);

    const auditEntry = this._buildAudit({
      actor,
      actorRole: 'L2_ANALYST',
      action: 'EVIDENCE_COLLECTED',
      target: incidentId,
      resultingState: `Evidence ${newEvidence.id} added`,
      authorization: 'INCIDENT_INVESTIGATE',
      outcome: 'SUCCESS',
      details: { evidenceType: newEvidence.type },
    });
    this._auditRecords.push(auditEntry);

    await put<Incident>('incidents', incident);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newEvidence);
  }

  // ─── Correlation & Incident Creation Engine ─────────────────────────────────

  async attachAlertToIncident(
    incidentId: string,
    alertId: string,
    actor = 'SYSTEM',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<Incident> {
    if (!canCorrelate(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot correlate alerts to incidents`);
    }

    const inc = this._incidents.find((i) => i.id === incidentId);
    if (!inc) throw new Error(`Incident "${incidentId}" not found`);

    const alert = this._alerts.find((a) => a.id === alertId);
    if (!alert) throw new Error(`Alert "${alertId}" not found`);

    alert.incidentId = incidentId;
    await put<Alert>('alerts', alert);

    if (!inc.alertIds) inc.alertIds = [];
    if (!inc.alertIds.includes(alert.id)) inc.alertIds.push(alert.id);

    if (!inc.eventIds) inc.eventIds = [];
    for (const eid of alert.sourceEventIds) {
      if (!inc.eventIds.includes(eid)) inc.eventIds.push(eid);
      const ev = this._events.find((e) => e.id === eid);
      if (ev && ev.incidentId !== incidentId) {
        ev.incidentId = incidentId;
        await put<SecurityEvent>('events', ev);
      }
    }

    if (alert.assetId && !inc.affectedAssets.includes(alert.assetId)) {
      inc.affectedAssets.push(alert.assetId);
    }
    if (alert.userId && !inc.affectedUsers.includes(alert.userId)) {
      inc.affectedUsers.push(alert.userId);
    }
    if (alert.iocIds) {
      for (const ioc of alert.iocIds) {
        if (!inc.iocs.includes(ioc)) {
          inc.iocs.push(ioc);
        }
      }
    }
    if (alert.mitreTechniqueId && !inc.mitreTechniques.includes(alert.mitreTechniqueId)) {
      inc.mitreTechniques.push(alert.mitreTechniqueId);
    }

    if (!inc.firstSeenAt || alert.createdAt < inc.firstSeenAt) {
      inc.firstSeenAt = alert.createdAt;
    }
    if (!inc.lastSeenAt || alert.createdAt > inc.lastSeenAt) {
      inc.lastSeenAt = alert.createdAt;
    }
    inc.updatedAt = new Date().toISOString();

    // Re-derive severity & priority
    const incAlerts = this._alerts.filter((a) => inc.alertIds?.includes(a.id));
    inc.severity = deriveIncidentSeverity(incAlerts);
    inc.priority = deriveIncidentPriority(inc.severity, inc.affectedAssets.length, incAlerts.length);
    inc.riskScore = computeIncidentRiskScore(inc.severity, inc.priority, inc.affectedAssets.length, incAlerts.length, inc.confidence);

    await put<Incident>('incidents', inc);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'INCIDENT_ALERT_ATTACHED',
      target: incidentId,
      resultingState: inc.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: {
        alertId,
        alertTitle: alert.title,
        severity: inc.severity,
        priority: inc.priority,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(inc);
  }

  async attachEventToIncident(
    incidentId: string,
    eventId: string,
    actor = 'SYSTEM',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<Incident> {
    if (!canCorrelate(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot attach events to incidents`);
    }

    const inc = this._incidents.find((i) => i.id === incidentId);
    if (!inc) throw new Error(`Incident "${incidentId}" not found`);

    const ev = this._events.find((e) => e.id === eventId);
    if (!ev) throw new Error(`Event "${eventId}" not found`);

    ev.incidentId = incidentId;
    await put<SecurityEvent>('events', ev);

    if (!inc.eventIds) inc.eventIds = [];
    if (!inc.eventIds.includes(eventId)) inc.eventIds.push(eventId);

    if (ev.assetId && !inc.affectedAssets.includes(ev.assetId)) {
      inc.affectedAssets.push(ev.assetId);
    }
    if (ev.userId && !inc.affectedUsers.includes(ev.userId)) {
      inc.affectedUsers.push(ev.userId);
    }

    if (!inc.firstSeenAt || ev.timestamp < inc.firstSeenAt) {
      inc.firstSeenAt = ev.timestamp;
    }
    if (!inc.lastSeenAt || ev.timestamp > inc.lastSeenAt) {
      inc.lastSeenAt = ev.timestamp;
    }
    inc.updatedAt = new Date().toISOString();

    await put<Incident>('incidents', inc);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'INCIDENT_EVENT_ATTACHED',
      target: incidentId,
      resultingState: inc.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: {
        eventId,
        category: ev.category,
        eventType: ev.eventType,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(inc);
  }

  async runCorrelation(): Promise<{ correlatedCount: number; newIncidentCount: number; updatedIncidentCount: number }> {
    let correlatedCount = 0;
    let newIncidentCount = 0;
    let updatedIncidentCount = 0;

    const unassignedAlerts = this._alerts.filter((a) => !a.incidentId);

    for (const alert of unassignedAlerts) {
      const openIncidents = this._incidents.filter((i) => i.status !== 'CLOSED');
      const bestMatch = findBestMatchingIncident(alert, openIncidents);

      if (bestMatch && bestMatch.matched && bestMatch.incidentId && bestMatch.score >= AUTOMATIC_CORRELATION_THRESHOLD) {
        await this.attachAlertToIncident(bestMatch.incidentId, alert.id, 'CORRELATION_ENGINE', 'L2_ANALYST');
        correlatedCount++;
        updatedIncidentCount++;
      } else if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
        const newInc = await this._correlateAlert(alert);
        if (newInc) {
          correlatedCount++;
          newIncidentCount++;
        }
      }
    }

    return { correlatedCount, newIncidentCount, updatedIncidentCount };
  }

  private async _correlateAlert(alert: Alert, sourceEvent?: SecurityEvent): Promise<Incident | null> {
    // 1. If alert already has an incident, sync and update
    if (alert.incidentId) {
      const existingInc = this._incidents.find((i) => i.id === alert.incidentId);
      if (existingInc) {
        let dirty = false;
        if (!existingInc.alertIds) existingInc.alertIds = [];
        if (!existingInc.alertIds.includes(alert.id)) {
          existingInc.alertIds.push(alert.id);
          dirty = true;
        }
        if (sourceEvent) {
          if (!existingInc.eventIds) existingInc.eventIds = [];
          if (!existingInc.eventIds.includes(sourceEvent.id)) {
            existingInc.eventIds.push(sourceEvent.id);
            dirty = true;
          }
          if (sourceEvent.incidentId !== existingInc.id) {
            sourceEvent.incidentId = existingInc.id;
            await put<SecurityEvent>('events', sourceEvent);
          }
        }
        if (alert.createdAt > (existingInc.lastSeenAt ?? '')) {
          existingInc.lastSeenAt = alert.createdAt;
          existingInc.updatedAt = new Date().toISOString();
          dirty = true;
        }
        if (dirty) {
          await put<Incident>('incidents', existingInc);
        }
        return existingInc;
      }
    }

    // 2. Try to match to an open incident with strict simulation isolation
    const isSimAlert = Boolean(alert.metadata?.simulation);
    const simRunId = (alert.metadata?.simulation as any)?.runId;

    const openIncidents = this._incidents.filter((i) => {
      if (i.status === 'CLOSED') return false;
      const isSimInc = Boolean(i.metadata?.simulation || (i.metadata as any)?.isSimulated);
      if (isSimAlert) {
        // Simulation alerts only correlate into incidents from the exact same simulation run
        const incRunId = (i.metadata?.simulation as any)?.runId;
        return isSimInc && incRunId === simRunId;
      } else {
        // Operational alerts never correlate into simulated incidents
        return !isSimInc;
      }
    });
    const bestMatch = findBestMatchingIncident(alert, openIncidents);

    if (bestMatch && bestMatch.matched && bestMatch.incidentId && bestMatch.score >= AUTOMATIC_CORRELATION_THRESHOLD) {
      const inc = bestMatch.incident ?? this._incidents.find((i) => i.id === bestMatch.incidentId);
      if (!inc) return null;
      alert.incidentId = inc.id;
      await put<Alert>('alerts', alert);

      if (!inc.alertIds) inc.alertIds = [];
      if (!inc.alertIds.includes(alert.id)) {
        inc.alertIds.push(alert.id);
      }

      if (!inc.eventIds) inc.eventIds = [];
      for (const eid of alert.sourceEventIds) {
        if (!inc.eventIds.includes(eid)) inc.eventIds.push(eid);
        const ev = this._events.find((e) => e.id === eid);
        if (ev && ev.incidentId !== inc.id) {
          ev.incidentId = inc.id;
          await put<SecurityEvent>('events', ev);
        }
      }

      if (sourceEvent) {
        if (!inc.eventIds.includes(sourceEvent.id)) inc.eventIds.push(sourceEvent.id);
        if (sourceEvent.incidentId !== inc.id) {
          sourceEvent.incidentId = inc.id;
          await put<SecurityEvent>('events', sourceEvent);
        }
      }

      if (alert.assetId && !inc.affectedAssets.includes(alert.assetId)) {
        inc.affectedAssets.push(alert.assetId);
      }
      if (alert.userId && !inc.affectedUsers.includes(alert.userId)) {
        inc.affectedUsers.push(alert.userId);
      }
      if (alert.iocIds) {
        for (const ioc of alert.iocIds) {
          if (!inc.iocs.includes(ioc)) inc.iocs.push(ioc);
        }
      }
      if (alert.mitreTechniqueId && !inc.mitreTechniques.includes(alert.mitreTechniqueId)) {
        inc.mitreTechniques.push(alert.mitreTechniqueId);
      }

      if (!inc.correlationReasons) inc.correlationReasons = [];
      for (const r of bestMatch.reasons) {
        if (!inc.correlationReasons.includes(r)) inc.correlationReasons.push(r);
      }
      inc.correlationScore = Math.max(inc.correlationScore ?? 0, bestMatch.score);

      if (alert.metadata?.simulation && !inc.metadata?.simulation) {
        inc.metadata = {
          ...(inc.metadata ?? {}),
          simulation: alert.metadata.simulation,
          isSimulated: true,
        };
      }

      const incAlerts = this._alerts.filter((a) => inc.alertIds?.includes(a.id));
      inc.severity = deriveIncidentSeverity(incAlerts);
      inc.priority = deriveIncidentPriority(inc.severity, inc.affectedAssets.length, incAlerts.length);
      inc.riskScore = computeIncidentRiskScore(inc.severity, inc.priority, inc.affectedAssets.length, incAlerts.length, inc.confidence);

      if (!inc.firstSeenAt || alert.createdAt < inc.firstSeenAt) {
        inc.firstSeenAt = alert.createdAt;
      }
      if (!inc.lastSeenAt || alert.createdAt > inc.lastSeenAt) {
        inc.lastSeenAt = alert.createdAt;
      }
      inc.updatedAt = new Date().toISOString();

      const newTimelineEvt: TimelineEvent = {
        id: `tl-${alert.id}`,
        timestamp: alert.createdAt,
        title: alert.title,
        stage: alert.mitreTechniqueId ? 'EXECUTION' : 'INITIAL_ACCESS',
        severity: alert.severity,
        description: alert.description,
        entityId: alert.assetId ?? alert.userId,
        entityType: alert.assetId ? 'ASSET' : alert.userId ? 'USER' : undefined,
        techniqueId: alert.mitreTechniqueId,
      };
      if (!inc.timelineEvents.some((t: TimelineEvent) => t.id === newTimelineEvt.id || t.title === newTimelineEvt.title)) {
        inc.timelineEvents.push(newTimelineEvt);
        inc.timelineEvents.sort((a: TimelineEvent, b: TimelineEvent) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }

      await put<Incident>('incidents', inc);

      const auditEntry = this._buildAudit({
        actor: 'CORRELATION_ENGINE',
        actorRole: 'L2_ANALYST',
        action: 'INCIDENT_CORRELATION_UPDATED',
        target: inc.id,
        resultingState: inc.status,
        authorization: 'CORRELATION_ENGINE',
        outcome: 'SUCCESS',
        details: {
          attachedAlertId: alert.id,
          correlationScore: bestMatch.score,
          reasons: bestMatch.reasons,
          severity: inc.severity,
          priority: inc.priority,
        },
      });
      this._auditRecords.push(auditEntry);
      await put<AuditRecord>('audit_records', auditEntry);

      return inc;
    }

    // 3. Auto-create incident for CRITICAL or HIGH alert if no match
    if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
      const now = new Date().toISOString();
      const newIncId = `inc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const newInc: Incident = {
        id: newIncId,
        title: `Correlated Incident: ${alert.title}`,
        severity: alert.severity,
        priority: alert.severity === 'CRITICAL' ? 'P1' : 'P2',
        riskScore: alert.severity === 'CRITICAL' ? 88.0 : 65.0,
        status: 'NEW',
        confidence: 0.85,
        source: 'CORRELATION_ENGINE',
        createdAt: now,
        updatedAt: now,
        firstSeenAt: alert.createdAt,
        lastSeenAt: alert.createdAt,
        affectedAssets: alert.assetId ? [alert.assetId] : [],
        affectedUsers: alert.userId ? [alert.userId] : [],
        iocs: alert.iocIds ? [...alert.iocIds] : [],
        mitreTechniques: alert.mitreTechniqueId ? [alert.mitreTechniqueId] : [],
        eventIds: [...alert.sourceEventIds],
        alertIds: [alert.id],
        correlationScore: 75,
        correlationReasons: [
          `Automatic incident creation from ${alert.severity} alert "${alert.title}"`,
          ...(alert.assetId ? [`Primary asset: ${alert.assetId}`] : []),
          ...(alert.userId ? [`User context: ${alert.userId}`] : []),
          ...(alert.mitreTechniqueId ? [`MITRE technique: ${alert.mitreTechniqueId}`] : []),
        ],
        tags: ['correlated', alert.severity.toLowerCase()],
        timelineEvents: [
          {
            id: `tl-${alert.id}`,
            timestamp: alert.createdAt,
            title: alert.title,
            stage: 'INITIAL_ACCESS',
            severity: alert.severity,
            description: alert.description,
            entityId: alert.assetId ?? alert.userId,
            entityType: alert.assetId ? 'ASSET' : alert.userId ? 'USER' : undefined,
            techniqueId: alert.mitreTechniqueId,
          },
        ],
        correlationChain: [
          {
            id: `corr-${alert.id}`,
            alertId: alert.id,
            title: alert.title,
            ruleName: alert.ruleId,
            timestamp: alert.createdAt,
            confidence: 0.9,
            evidenceSummary: alert.description,
          },
        ],
        evidence: [],
        summary: `Automated incident created by Correlation Engine for alert "${alert.title}" affecting ${alert.assetId ?? 'unassigned asset'}.`,
        metadata: alert.metadata?.simulation
          ? {
              simulation: alert.metadata.simulation,
              isSimulated: true,
            }
          : undefined,
      };

      if (sourceEvent) {
        if (!newInc.eventIds!.includes(sourceEvent.id)) {
          newInc.eventIds!.push(sourceEvent.id);
        }
        sourceEvent.incidentId = newIncId;
        await put<SecurityEvent>('events', sourceEvent);
      }

      alert.incidentId = newIncId;
      await put<Alert>('alerts', alert);

      this._incidents.unshift(newInc);
      await put<Incident>('incidents', newInc);

      const audit = this._buildAudit({
        actor: 'CORRELATION_ENGINE',
        actorRole: 'L2_ANALYST',
        action: 'INCIDENT_AUTOMATICALLY_CORRELATED',
        target: newIncId,
        resultingState: 'NEW',
        authorization: 'CORRELATION_ENGINE',
        outcome: 'SUCCESS',
        details: {
          triggerAlertId: alert.id,
          severity: newInc.severity,
          priority: newInc.priority,
          reasons: newInc.correlationReasons,
        },
      });
      this._auditRecords.push(audit);
      await put<AuditRecord>('audit_records', audit);

      return newInc;
    }

    return null;
  }

  private async _seedCorrelation(): Promise<void> {
    // 1. Associate BlackTide alerts & events
    const blackTide = this._incidents.find((i) => i.id === 'incident-001');
    if (blackTide) {
      if (!blackTide.alertIds) blackTide.alertIds = [];
      if (!blackTide.eventIds) blackTide.eventIds = [];

      const btAssets = ['asset-001', 'asset-002', 'asset-004'];
      for (const alert of this._alerts) {
        const matchesAsset = alert.assetId && btAssets.includes(alert.assetId);
        const matchesEvent = alert.sourceEventIds.some((eid) => blackTide.eventIds?.includes(eid));
        if (matchesAsset || matchesEvent) {
          alert.incidentId = blackTide.id;
          await put<Alert>('alerts', alert);
          if (!blackTide.alertIds.includes(alert.id)) {
            blackTide.alertIds.push(alert.id);
          }
        }
      }

      for (const ev of this._events) {
        if (ev.incidentId === 'incident-001') {
          if (!blackTide.eventIds.includes(ev.id)) {
            blackTide.eventIds.push(ev.id);
          }
        }
      }

      blackTide.priority = 'P1';
      blackTide.severity = 'CRITICAL';
      blackTide.source = 'CORRELATION_ENGINE';
      blackTide.firstSeenAt = '2024-11-13T22:04:00Z';
      blackTide.lastSeenAt = '2024-11-14T04:12:00Z';
      await put<Incident>('incidents', blackTide);
    }

    // 2. Associate VPN Gateway Brute Force alerts & events
    const vpnIncident = this._incidents.find((i) => i.id === 'incident-002');
    if (vpnIncident) {
      if (!vpnIncident.alertIds) vpnIncident.alertIds = [];
      if (!vpnIncident.eventIds) vpnIncident.eventIds = [];

      for (const alert of this._alerts) {
        if (alert.assetId === 'asset-005' || alert.sourceEventIds.includes('evt-raw-013')) {
          alert.incidentId = vpnIncident.id;
          await put<Alert>('alerts', alert);
          if (!vpnIncident.alertIds.includes(alert.id)) {
            vpnIncident.alertIds.push(alert.id);
          }
        }
      }

      for (const ev of this._events) {
        if (ev.id === 'evt-raw-013') {
          ev.incidentId = vpnIncident.id;
          await put<SecurityEvent>('events', ev);
          if (!vpnIncident.eventIds.includes(ev.id)) {
            vpnIncident.eventIds.push(ev.id);
          }
        }
      }

      vpnIncident.priority = 'P3';
      vpnIncident.severity = 'MEDIUM';
      vpnIncident.source = 'DETECTION_ENGINE';
      vpnIncident.firstSeenAt = '2024-11-14T01:00:00Z';
      vpnIncident.lastSeenAt = '2024-11-14T01:08:00Z';
      await put<Incident>('incidents', vpnIncident);
    }
  }

  // ─── Response Actions & State Machine ───────────────────────────────────────

  async requestResponseAction(
    action: Omit<ResponseAction, 'id' | 'status' | 'requestedAt' | 'requestedBy'>,
    actor: string
  ): Promise<ResponseAction> {
    const session = this.getCurrentSession();
    const actorRole = session?.role ?? 'L2_ANALYST';

    if (!canRequestContainment(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot request response actions`);
    }

    const newAction: ResponseAction = {
      ...action,
      id: uid(),
      status: 'PENDING_APPROVAL',
      requestedAt: new Date().toISOString(),
      requestedBy: actor,
      consequence: action.consequence ?? `Action ${action.type} will be executed on ${action.targetLabel} upon authorization.`,
    };
    this._responseActions.push(newAction);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'CONTAINMENT_REQUEST',
      target: newAction.id,
      previousState: 'DRAFT',
      resultingState: 'PENDING_APPROVAL',
      authorization: 'CONTAINMENT_REQUEST',
      outcome: 'SUCCESS',
      details: { actionType: newAction.type, targetId: newAction.targetId, targetLabel: newAction.targetLabel },
    });
    this._auditRecords.push(auditEntry);

    await put<ResponseAction>('response_actions', newAction);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newAction);
  }

  async approveResponseAction(actionId: string, approver: string): Promise<ResponseAction> {
    const action = this._responseActions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Response action ${actionId} not found`);

    const session = this.getCurrentSession();
    const approverRole = session?.role ?? 'SOC_MANAGER';

    if (!canApproveContainment(approverRole)) {
      throw new Error(`Unauthorized: Role "${approverRole}" cannot approve response actions`);
    }

    if (action.status === 'COMPLETED' || action.status === 'EXECUTED') {
      return clone(action); // Idempotent
    }

    const previousState = action.status;
    action.status     = 'APPROVED';
    action.approvedBy = approver;
    action.approvedAt = new Date().toISOString();

    const auditEntry = this._buildAudit({
      actor: approver,
      actorRole: approverRole,
      action: 'CONTAINMENT_APPROVED',
      target: actionId,
      previousState,
      resultingState: 'APPROVED',
      authorization: 'CONTAINMENT_APPROVE',
      outcome: 'SUCCESS',
      details: { actionType: action.type, targetId: action.targetId, targetLabel: action.targetLabel },
    });
    this._auditRecords.push(auditEntry);

    await put<ResponseAction>('response_actions', action);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(action);
  }

  async rejectResponseAction(actionId: string, rejector: string, reason: string): Promise<ResponseAction> {
    const action = this._responseActions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Response action ${actionId} not found`);

    const session = this.getCurrentSession();
    const rejectorRole = session?.role ?? 'SOC_MANAGER';

    if (!canApproveContainment(rejectorRole)) {
      throw new Error(`Unauthorized: Role "${rejectorRole}" cannot reject response actions`);
    }

    const previousState = action.status;
    action.status          = 'REJECTED';
    action.rejectedBy      = rejector;
    action.rejectedAt      = new Date().toISOString();
    action.rejectionReason = reason;

    const auditEntry = this._buildAudit({
      actor: rejector,
      actorRole: rejectorRole,
      action: 'CONTAINMENT_REJECTED',
      target: actionId,
      previousState,
      resultingState: 'REJECTED',
      authorization: 'CONTAINMENT_APPROVE',
      outcome: 'SUCCESS',
      details: { actionType: action.type, targetId: action.targetId, reason },
    });
    this._auditRecords.push(auditEntry);

    await put<ResponseAction>('response_actions', action);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(action);
  }

  async cancelResponseAction(actionId: string, canceller: string, reason: string): Promise<ResponseAction> {
    const action = this._responseActions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Response action ${actionId} not found`);

    const previousState = action.status;
    action.status             = 'CANCELLED';
    action.cancelledBy        = canceller;
    action.cancelledAt        = new Date().toISOString();
    action.cancellationReason = reason;

    const auditEntry = this._buildAudit({
      actor: canceller,
      actorRole: 'ANALYST',
      action: 'CONTAINMENT_CANCELLED',
      target: actionId,
      previousState,
      resultingState: 'CANCELLED',
      authorization: 'CONTAINMENT_REQUEST',
      outcome: 'SUCCESS',
      details: { actionType: action.type, targetId: action.targetId, reason },
    });
    this._auditRecords.push(auditEntry);

    await put<ResponseAction>('response_actions', action);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(action);
  }

  async executeResponseAction(
    actionId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<ResponseAction> {
    const action = this._responseActions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Response action ${actionId} not found`);

    // 1. RBAC Check
    if (!canExecuteSOAR(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" does not have SOAR_EXECUTE permission`);
    }

    // 2. Idempotency check: already completed
    if (action.status === 'COMPLETED' || action.status === 'EXECUTED') {
      return clone(action);
    }

    // 3. State machine validation
    if (action.status !== 'APPROVED' && action.status !== 'REQUESTED') {
      throw new Error(`Invalid state transition: Cannot execute action in status "${action.status}". Must be APPROVED.`);
    }

    const previousState = action.status;
    action.status        = 'COMPLETED';
    action.executedAt    = new Date().toISOString();
    action.resultMessage = `Action executed successfully by ${actor} (${actorRole})`;

    // 4. Authoritative Canonical State Mutations
    if (action.type === 'QUARANTINE_HOST' || action.type === 'QUARANTINE_ASSET' || action.type === 'ISOLATE_ASSET') {
      const asset = this._assets.find((a) => a.id === action.targetId || a.name === action.targetId);
      if (asset) {
        asset.status = 'ISOLATED';
        asset.blastRadiusLevel = 'SAFE';
        await put<Asset>('assets', asset);
      }
    } else if (action.type === 'UNQUARANTINE_HOST' || action.type === 'RESTORE_ASSET') {
      const asset = this._assets.find((a) => a.id === action.targetId || a.name === action.targetId);
      if (asset) {
        asset.status = 'HEALTHY';
        await put<Asset>('assets', asset);
      }
    } else if (action.type === 'BLOCK_IOC' || action.type === 'BLOCK_DOMAIN') {
      const ioc = this._iocs.find((i) => i.id === action.targetId || i.value === action.targetId);
      if (ioc) {
        ioc.isBlocked = true;
        await put<IOC>('iocs', ioc);
      }
    } else if (action.type === 'UNBLOCK_IOC') {
      const ioc = this._iocs.find((i) => i.id === action.targetId || i.value === action.targetId);
      if (ioc) {
        ioc.isBlocked = false;
        await put<IOC>('iocs', ioc);
      }
    } else if (action.type === 'DISABLE_ACCOUNT' || action.type === 'DISABLE_USER' || action.type === 'SUSPEND_USER') {
      const user = this._users.find((u) => u.id === action.targetId || u.username === action.targetId);
      if (user) {
        user.status = 'SUSPENDED';
        await put<SecurityUser>('users', user);
      }
    } else if (action.type === 'ENABLE_ACCOUNT' || action.type === 'RESTORE_USER') {
      const user = this._users.find((u) => u.id === action.targetId || u.username === action.targetId);
      if (user) {
        user.status = 'ACTIVE';
        await put<SecurityUser>('users', user);
      }
    } else if (action.type === 'KILL_PROCESS') {
      action.resultMessage = `SIGKILL terminated process ${action.targetLabel}.`;
    } else if (action.type === 'COLLECT_EVIDENCE') {
      action.resultMessage = `Forensic snapshot ${action.targetLabel} sealed and hashed with SHA-256.`;
    }

    // 5. Update correlated incident state & append response TimelineEvent
    const incident = this._incidents.find((i) => i.id === action.incidentId);
    if (incident) {
      const timelineEntry: TimelineEvent = {
        id: uid(),
        timestamp: action.executedAt,
        title: `[RESPONSE] ${action.type.replace(/_/g, ' ')}: ${action.targetLabel}`,
        stage: 'DEFENSE_EVASION',
        severity: 'INFO',
        description: `Operational response executed: ${action.type} applied to ${action.targetLabel} (${action.targetType}) by ${actor} [${actorRole}]`,
        entityId: action.targetId,
        entityType: action.targetType === 'ASSET' ? 'ASSET' : action.targetType === 'IOC' ? 'IOC' : action.targetType === 'USER' ? 'USER' : undefined,
      };
      incident.timelineEvents.push(timelineEntry);

      if (incident.status === 'NEW' || incident.status === 'INVESTIGATING' || incident.status === 'TRIAGED') {
        incident.status = 'CONTAINING';
      }
      incident.updatedAt = action.executedAt;
      await put<Incident>('incidents', incident);
    }

    // 6. Audit trail
    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RESPONSE_ACTION_EXECUTED',
      target: actionId,
      previousState,
      resultingState: 'COMPLETED',
      authorization: 'SOAR_EXECUTE',
      outcome: 'SUCCESS',
      details: {
        actionType: action.type,
        targetId: action.targetId,
        targetLabel: action.targetLabel,
        incidentId: action.incidentId,
      },
    });
    this._auditRecords.push(auditEntry);

    // Persist action and audit record
    await put<ResponseAction>('response_actions', action);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(action);
  }

  async dryRunResponseAction(
    actionId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<{ action: ResponseAction; wouldModify: boolean; expectedStateChange: string }> {
    const action = this._responseActions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Response action ${actionId} not found`);

    if (!canRequestContainment(actorRole) && !canExecuteSOAR(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" does not have permission to simulate response actions`);
    }

    let expectedStateChange = '';
    if (action.type === 'QUARANTINE_HOST' || action.type === 'QUARANTINE_ASSET' || action.type === 'ISOLATE_ASSET') {
      expectedStateChange = `[DRY RUN] Would isolate host ${action.targetLabel} from network routing and set blast radius to SAFE. 0 packets dropped.`;
    } else if (action.type === 'BLOCK_IOC' || action.type === 'BLOCK_DOMAIN') {
      expectedStateChange = `[DRY RUN] Would inject firewall drop rule for indicator ${action.targetLabel}. Zero disruption to production routes.`;
    } else if (action.type === 'DISABLE_ACCOUNT' || action.type === 'DISABLE_USER' || action.type === 'SUSPEND_USER') {
      expectedStateChange = `[DRY RUN] Would suspend account ${action.targetLabel} and revoke active session tokens.`;
    } else if (action.type === 'KILL_PROCESS') {
      expectedStateChange = `[DRY RUN] Would send SIGKILL to process ${action.targetLabel} on target host.`;
    } else if (action.type === 'COLLECT_EVIDENCE') {
      expectedStateChange = `[DRY RUN] Would acquire memory snapshot of ${action.targetLabel} into cryptographic evidence vault.`;
    } else if (action.type === 'EXECUTE_PLAYBOOK') {
      expectedStateChange = `[DRY RUN] Would initiate SOAR playbook workflow for ${action.targetLabel}.`;
    } else {
      expectedStateChange = `[DRY RUN] Would execute ${action.type} against ${action.targetLabel}.`;
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RESPONSE_ACTION_DRY_RUN',
      target: actionId,
      previousState: action.status,
      resultingState: action.status,
      authorization: 'DRY_RUN',
      outcome: 'SUCCESS',
      details: {
        actionType: action.type,
        targetId: action.targetId,
        targetLabel: action.targetLabel,
        expectedStateChange,
        isDryRun: true,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return {
      action: clone(action),
      wouldModify: true,
      expectedStateChange,
    };
  }

  async rollbackResponseAction(
    actionId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<ResponseAction> {
    const action = this._responseActions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Response action ${actionId} not found`);

    if (!canExecuteSOAR(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" does not have SOAR_EXECUTE permission to perform rollback`);
    }

    if (
      action.reversibility === 'IRREVERSIBLE' ||
      action.reversibility === 'NON_REVERSIBLE' ||
      action.type === 'KILL_PROCESS' ||
      action.type === 'COLLECT_EVIDENCE'
    ) {
      throw new Error(`Action ${action.type} is irreversible and cannot be rolled back.`);
    }

    if (action.status !== 'COMPLETED' && action.status !== 'EXECUTED') {
      throw new Error(`Cannot rollback action in status "${action.status}". Must be COMPLETED.`);
    }

    const previousState = action.status;
    action.status = 'ROLLED_BACK';
    action.resultMessage = `Action rolled back by ${actor} (${actorRole})`;

    // Inverse mutations
    if (action.type === 'QUARANTINE_HOST' || action.type === 'QUARANTINE_ASSET' || action.type === 'ISOLATE_ASSET') {
      const asset = this._assets.find((a) => a.id === action.targetId || a.name === action.targetId);
      if (asset) {
        asset.status = 'HEALTHY';
        asset.blastRadiusLevel = 'SAFE';
        await put<Asset>('assets', asset);
      }
    } else if (action.type === 'BLOCK_IOC' || action.type === 'BLOCK_DOMAIN') {
      const ioc = this._iocs.find((i) => i.id === action.targetId || i.value === action.targetId);
      if (ioc) {
        ioc.isBlocked = false;
        await put<IOC>('iocs', ioc);
      }
    } else if (action.type === 'DISABLE_ACCOUNT' || action.type === 'DISABLE_USER' || action.type === 'SUSPEND_USER') {
      const user = this._users.find((u) => u.id === action.targetId || u.username === action.targetId);
      if (user) {
        user.status = 'ACTIVE';
        await put<SecurityUser>('users', user);
      }
    }

    // Incident timeline update
    const incident = this._incidents.find((i) => i.id === action.incidentId);
    if (incident) {
      const timelineEntry: TimelineEvent = {
        id: uid(),
        timestamp: new Date().toISOString(),
        title: `[ROLLBACK] ${action.type.replace(/_/g, ' ')}: ${action.targetLabel}`,
        stage: 'DEFENSE_EVASION',
        severity: 'INFO',
        description: `Operational rollback: ${action.type} reverted on ${action.targetLabel} by ${actor} [${actorRole}]`,
        entityId: action.targetId,
        entityType: action.targetType === 'ASSET' ? 'ASSET' : action.targetType === 'IOC' ? 'IOC' : action.targetType === 'USER' ? 'USER' : undefined,
      };
      incident.timelineEvents.push(timelineEntry);
      incident.updatedAt = new Date().toISOString();
      await put<Incident>('incidents', incident);
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'RESPONSE_ACTION_ROLLED_BACK',
      target: actionId,
      previousState,
      resultingState: 'ROLLED_BACK',
      authorization: 'SOAR_EXECUTE',
      outcome: 'SUCCESS',
      details: {
        actionType: action.type,
        targetId: action.targetId,
        targetLabel: action.targetLabel,
      },
    });
    this._auditRecords.push(auditEntry);

    await put<ResponseAction>('response_actions', action);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(action);
  }

  // ─── Offline Scenario Engine ────────────────────────────────────────────────

  async getAvailableScenarios(): Promise<ScenarioDefinition[]> {
    return clone(SEED_SCENARIOS);
  }

  async loadScenario(scenarioId: string): Promise<Incident> {
    const scenario = SEED_SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

    this._activeScenarioId   = scenarioId;
    this._activeScenarioStep = 0;

    const baseIncident = scenarioId === 'scenario-blacktide'
      ? clone(SEED_INCIDENT)
      : clone(SEED_INCIDENT_2);

    // Truncate timeline — caller drives progression via stepScenario()
    baseIncident.timelineEvents = [];
    baseIncident.status = 'NEW';

    const existingIdx = this._incidents.findIndex((i) => i.id === baseIncident.id);
    if (existingIdx >= 0) {
      this._incidents[existingIdx] = baseIncident;
    } else {
      this._incidents.push(baseIncident);
    }

    await put<Incident>('incidents', baseIncident);
    await this._persistScenarioMeta();

    return clone(baseIncident);
  }

  async stepScenario(stepIndex: number): Promise<TimelineEvent | null> {
    if (!this._activeScenarioId) return null;

    const fullTimeline = this._activeScenarioId === 'scenario-blacktide'
      ? SEED_INCIDENT.timelineEvents
      : SEED_INCIDENT_2.timelineEvents;

    const event = fullTimeline[stepIndex] ?? null;
    if (!event) return null;

    const targetIncidentId = this._activeScenarioId === 'scenario-blacktide'
      ? 'incident-001'
      : 'incident-002';

    const incident = this._incidents.find((i) => i.id === targetIncidentId);
    if (incident) {
      incident.timelineEvents.push(clone(event));
      incident.status    = 'INVESTIGATING';
      incident.updatedAt = new Date().toISOString();
      await put<Incident>('incidents', incident);
    }

    this._activeScenarioStep = stepIndex + 1;
    await this._persistScenarioMeta();

    return clone(event);
  }

  async resetScenario(): Promise<void> {
    if (!this._activeScenarioId) return;
    await this.loadScenario(this._activeScenarioId);
  }

  // ─── Threat Hunting Engine ──────────────────────────────────────────────────

  async runThreatHunt(query: ThreatHuntQuery): Promise<ThreatHuntExecutionResult> {
    const session = this.getCurrentSession();
    const actor = session?.username ?? 'SYSTEM';
    const actorRole = session?.role ?? 'THREAT_HUNTER';

    if (!canExecuteThreatHunt(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot execute threat hunts`);
    }

    const execResult = executeHuntQuery(this._events, query, this._alerts, this._incidents);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'THREAT_HUNT_EXECUTED',
      target: 'query_session',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: {
        totalMatches: execResult.totalMatches,
        executionTimeMs: execResult.executionTimeMs,
        knownCount: execResult.aggregations.knownCount,
        unknownCount: execResult.aggregations.unknownCount,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return execResult;
  }

  async getThreatHunts(): Promise<ThreatHunt[]> {
    return clone(this._threatHunts);
  }

  async getThreatHuntById(id: string): Promise<ThreatHunt | null> {
    const hunt = this._threatHunts.find((h) => h.id === id);
    return hunt ? clone(hunt) : null;
  }

  async createThreatHunt(
    input: CreateThreatHuntInput,
    actor: string,
    actorRole: RoleId
  ): Promise<ThreatHunt> {
    if (!canSaveThreatHunt(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot save threat hunts`);
    }

    const execResult = executeHuntQuery(this._events, input.query, this._alerts, this._incidents);

    const newHunt: ThreatHunt = {
      id: `hunt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: input.name,
      description: input.description,
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: actor,
      query: input.query,
      resultCount: execResult.totalMatches,
      matchedEventIds: execResult.matchedEventIds,
      relatedAlertIds: execResult.relatedAlertIds,
      relatedIncidentIds: execResult.relatedIncidentIds,
      tags: input.tags ?? ['custom-hunt'],
      notes: input.notes,
      lastExecutedAt: new Date().toISOString(),
    };

    this._threatHunts.push(newHunt);
    await put<ThreatHunt>('threat_hunts', newHunt);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'THREAT_HUNT_CREATED',
      target: newHunt.id,
      resultingState: newHunt.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { name: newHunt.name, resultCount: newHunt.resultCount },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newHunt);
  }

  async updateThreatHunt(
    id: string,
    updates: Partial<ThreatHunt>,
    actor: string,
    actorRole: RoleId
  ): Promise<ThreatHunt> {
    if (!canSaveThreatHunt(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot update threat hunts`);
    }

    const hunt = this._threatHunts.find((h) => h.id === id);
    if (!hunt) throw new Error(`Threat hunt "${id}" not found`);

    if (updates.name !== undefined) hunt.name = updates.name;
    if (updates.description !== undefined) hunt.description = updates.description;
    if (updates.notes !== undefined) hunt.notes = updates.notes;
    if (updates.tags !== undefined) hunt.tags = updates.tags;
    if (updates.status !== undefined) hunt.status = updates.status;

    if (updates.query !== undefined) {
      hunt.query = updates.query;
      const exec = executeHuntQuery(this._events, hunt.query, this._alerts, this._incidents);
      hunt.resultCount = exec.totalMatches;
      hunt.matchedEventIds = exec.matchedEventIds;
      hunt.relatedAlertIds = exec.relatedAlertIds;
      hunt.relatedIncidentIds = exec.relatedIncidentIds;
      hunt.lastExecutedAt = new Date().toISOString();
    }

    hunt.updatedAt = new Date().toISOString();
    await put<ThreatHunt>('threat_hunts', hunt);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'THREAT_HUNT_UPDATED',
      target: id,
      resultingState: hunt.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { name: hunt.name },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(hunt);
  }

  async archiveThreatHunt(
    id: string,
    actor: string,
    actorRole: RoleId
  ): Promise<ThreatHunt> {
    if (!canSaveThreatHunt(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot archive threat hunts`);
    }

    const hunt = this._threatHunts.find((h) => h.id === id);
    if (!hunt) throw new Error(`Threat hunt "${id}" not found`);

    const previousState = hunt.status;
    hunt.status = 'ARCHIVED';
    hunt.updatedAt = new Date().toISOString();

    await put<ThreatHunt>('threat_hunts', hunt);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'THREAT_HUNT_ARCHIVED',
      target: id,
      previousState,
      resultingState: 'ARCHIVED',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { name: hunt.name },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(hunt);
  }

  async linkHuntEventsToIncident(
    incidentId: string,
    eventIds: string[],
    actor: string,
    actorRole: RoleId
  ): Promise<Incident> {
    let incident = this._incidents.find((i) => i.id === incidentId);
    if (!incident) throw new Error(`Incident "${incidentId}" not found`);

    for (const eventId of eventIds) {
      incident = await this.attachEventToIncident(incidentId, eventId, actor, actorRole);
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'THREAT_HUNT_EVIDENCE_LINKED',
      target: incidentId,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { linkedEventCount: eventIds.length, eventIds },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(incident);
  }

  async createIncidentFromHunt(
    input: CreateIncidentFromHuntInput,
    actor: string,
    actorRole: RoleId
  ): Promise<Incident> {
    const created = await this.createIncident(
      {
        title: input.title,
        severity: input.severity,
        summary: input.summary,
        assignedTo: input.assignedTo,
      },
      actor,
      actorRole
    );

    let incident = created;
    if (input.eventIds && input.eventIds.length > 0) {
      for (const eventId of input.eventIds) {
        incident = await this.attachEventToIncident(created.id, eventId, actor, actorRole);
      }
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'THREAT_HUNT_INCIDENT_CREATED',
      target: created.id,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { title: input.title, eventCount: input.eventIds?.length ?? 0 },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(incident);
  }

  getThreatHuntTemplates(): ThreatHuntTemplate[] {
    return clone(BLACKTIDE_HUNT_TEMPLATES);
  }

  // ─── Case Management ────────────────────────────────────────────────────────

  async getCases(filter?: CaseQueryFilter): Promise<Case[]> {
    let result = [...this._cases];

    if (!filter) {
      return clone(result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    }

    if (filter.query) {
      const q = filter.query.toLowerCase();
      result = result.filter(
        (c) =>
          c.caseNumber.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      result = result.filter((c) => statuses.includes(c.status));
    }

    if (filter.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      result = result.filter((c) => priorities.includes(c.priority));
    }

    if (filter.severity) {
      const severities = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
      result = result.filter((c) => severities.includes(c.severity));
    }

    if (filter.ownerId) {
      result = result.filter((c) => c.ownerId === filter.ownerId);
    }

    if (filter.createdBy) {
      result = result.filter((c) => c.createdBy === filter.createdBy);
    }

    if (filter.incidentId) {
      result = result.filter((c) => c.incidentIds.includes(filter.incidentId!));
    }

    if (filter.huntId) {
      result = result.filter((c) => c.huntIds.includes(filter.huntId!));
    }

    if (filter.assetId) {
      result = result.filter((c) => c.assetIds.includes(filter.assetId!));
    }

    if (filter.userId) {
      result = result.filter((c) => c.userIds.includes(filter.userId!));
    }

    if (filter.iocId) {
      result = result.filter((c) => c.iocIds.includes(filter.iocId!));
    }

    if (filter.tag) {
      const tagLower = filter.tag.toLowerCase();
      result = result.filter((c) => c.tags.some((t) => t.toLowerCase() === tagLower));
    }

    if (filter.dateFrom) {
      const fromTime = new Date(filter.dateFrom).getTime();
      result = result.filter((c) => new Date(c.createdAt).getTime() >= fromTime);
    }

    if (filter.dateTo) {
      const toTime = new Date(filter.dateTo).getTime();
      result = result.filter((c) => new Date(c.createdAt).getTime() <= toTime);
    }

    result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (filter.offset !== undefined && filter.offset > 0) {
      result = result.slice(filter.offset);
    }

    if (filter.limit !== undefined && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return clone(result);
  }

  async getCaseById(id: string): Promise<Case | null> {
    const found = this._cases.find((c) => c.id === id || c.caseNumber === id);
    return found ? clone(found) : null;
  }

  async createCase(
    input: CreateCaseInput,
    actor: string,
    actorRole: RoleId
  ): Promise<Case> {
    if (!canCreateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot create cases`);
    }

    const caseNumber = await getNextCaseNumber();
    const now = new Date().toISOString();

    const newCase: Case = {
      id: `case-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      caseNumber,
      title: input.title,
      description: input.description,
      status: 'OPEN',
      priority: input.priority ?? 'MEDIUM',
      severity: input.severity ?? 'MEDIUM',
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      ownerId: input.ownerId,
      participantIds: [actor, ...(input.ownerId && input.ownerId !== actor ? [input.ownerId] : [])],
      incidentIds: input.incidentIds ? [...input.incidentIds] : [],
      huntIds: input.huntIds ? [...input.huntIds] : [],
      alertIds: input.alertIds ? [...input.alertIds] : [],
      eventIds: input.eventIds ? [...input.eventIds] : [],
      assetIds: input.assetIds ? [...input.assetIds] : [],
      userIds: input.userIds ? [...input.userIds] : [],
      iocIds: input.iocIds ? [...input.iocIds] : [],
      tags: input.tags ? [...input.tags] : [],
      metadata: input.metadata ? clone(input.metadata) : undefined,
    };

    if (newCase.incidentIds.length > 0) {
      for (const incId of newCase.incidentIds) {
        const inc = this._incidents.find((i) => i.id === incId);
        if (inc) {
          inc.affectedAssets.forEach((a) => { if (!newCase.assetIds.includes(a)) newCase.assetIds.push(a); });
          inc.affectedUsers.forEach((u) => { if (!newCase.userIds.includes(u)) newCase.userIds.push(u); });
          inc.iocs.forEach((ioc) => { if (!newCase.iocIds.includes(ioc)) newCase.iocIds.push(ioc); });
        }
      }
    }

    this._cases.push(newCase);
    await put<Case>('cases', newCase);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_CREATED',
      target: newCase.id,
      resultingState: newCase.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: {
        caseNumber: newCase.caseNumber,
        title: newCase.title,
        priority: newCase.priority,
        severity: newCase.severity,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newCase);
  }

  async updateCase(
    id: string,
    patch: UpdateCaseInput,
    actor: string,
    actorRole: RoleId
  ): Promise<Case> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot update cases`);
    }

    const c = this._cases.find((item) => item.id === id || item.caseNumber === id);
    if (!c) throw new Error(`Case "${id}" not found`);

    if (patch.priority && patch.priority !== c.priority) {
      if (!canManageCase(actorRole) && actorRole !== 'L2_ANALYST') {
        throw new Error(`Unauthorized: Role "${actorRole}" cannot change case priority`);
      }
      const prevPriority = c.priority;
      c.priority = patch.priority;
      const audit = this._buildAudit({
        actor,
        actorRole,
        action: 'CASE_PRIORITY_CHANGED',
        target: c.id,
        resultingState: c.priority,
        authorization: actorRole,
        outcome: 'SUCCESS',
        details: { from: prevPriority, to: c.priority },
      });
      this._auditRecords.push(audit);
      await put<AuditRecord>('audit_records', audit);
    }

    if (patch.ownerId !== undefined && patch.ownerId !== c.ownerId) {
      if (!canManageCase(actorRole)) {
        throw new Error(`Unauthorized: Role "${actorRole}" cannot assign or reassign cases`);
      }
      const prevOwner = c.ownerId;
      c.ownerId = patch.ownerId;
      if (c.ownerId && !c.participantIds?.includes(c.ownerId)) {
        c.participantIds = [...(c.participantIds ?? []), c.ownerId];
      }
      const audit = this._buildAudit({
        actor,
        actorRole,
        action: prevOwner ? 'CASE_REASSIGNED' : 'CASE_ASSIGNED',
        target: c.id,
        resultingState: c.ownerId ?? 'UNASSIGNED',
        authorization: actorRole,
        outcome: 'SUCCESS',
        details: { from: prevOwner, to: c.ownerId },
      });
      this._auditRecords.push(audit);
      await put<AuditRecord>('audit_records', audit);
    }

    if (patch.status !== undefined && patch.status !== c.status) {
      if (!isValidCaseStatusTransition(c.status, patch.status)) {
        throw new Error(`Invalid status transition from "${c.status}" to "${patch.status}"`);
      }
      if (['RESOLVED', 'CLOSED'].includes(patch.status) && !canManageCase(actorRole) && actorRole !== 'L2_ANALYST' && actorRole !== 'INCIDENT_RESPONDER') {
        throw new Error(`Unauthorized: Role "${actorRole}" cannot resolve or close cases`);
      }
      const prevStatus = c.status;
      c.status = patch.status;
      if (c.status === 'RESOLVED') {
        c.resolvedAt = patch.resolvedAt ?? new Date().toISOString();
      } else if (c.status === 'CLOSED') {
        c.closedAt = patch.closedAt ?? new Date().toISOString();
      } else if (c.status === 'IN_PROGRESS' && prevStatus === 'CLOSED') {
        c.closedAt = undefined;
      }

      let auditAction: AuditRecord['action'] = 'CASE_STATUS_CHANGED';
      if (c.status === 'RESOLVED') auditAction = 'CASE_RESOLVED';
      else if (c.status === 'CLOSED') auditAction = 'CASE_CLOSED';
      else if (prevStatus === 'CLOSED') auditAction = 'CASE_REOPENED';

      const audit = this._buildAudit({
        actor,
        actorRole,
        action: auditAction,
        target: c.id,
        resultingState: c.status,
        authorization: actorRole,
        outcome: 'SUCCESS',
        details: { from: prevStatus, to: c.status, resolution: patch.resolution, closureReason: patch.closureReason },
      });
      this._auditRecords.push(audit);
      await put<AuditRecord>('audit_records', audit);
    }

    if (patch.title !== undefined) c.title = patch.title;
    if (patch.description !== undefined) c.description = patch.description;
    if (patch.severity !== undefined) c.severity = patch.severity;
    if (patch.tags !== undefined) c.tags = patch.tags;
    if (patch.resolution !== undefined) c.resolution = patch.resolution;
    if (patch.closureReason !== undefined) c.closureReason = patch.closureReason;
    if (patch.metadata !== undefined) c.metadata = patch.metadata;
    if (patch.participantIds !== undefined) c.participantIds = patch.participantIds;

    c.updatedAt = new Date().toISOString();
    await put<Case>('cases', c);

    return clone(c);
  }

  async closeCase(
    id: string,
    closureReason: string,
    actor: string,
    actorRole: RoleId
  ): Promise<Case> {
    if (!canManageCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot close cases`);
    }
    const c = this._cases.find((item) => item.id === id || item.caseNumber === id);
    if (!c) throw new Error(`Case "${id}" not found`);

    const prevStatus = c.status;
    c.status = 'CLOSED';
    c.closureReason = closureReason;
    c.closedAt = new Date().toISOString();
    c.updatedAt = new Date().toISOString();

    await put<Case>('cases', c);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_CLOSED',
      target: c.id,
      resultingState: 'CLOSED',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { from: prevStatus, closureReason },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(c);
  }

  async reopenCase(
    id: string,
    reason: string | undefined,
    actor: string,
    actorRole: RoleId
  ): Promise<Case> {
    if (!canManageCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot reopen cases`);
    }
    const c = this._cases.find((item) => item.id === id || item.caseNumber === id);
    if (!c) throw new Error(`Case "${id}" not found`);

    if (c.status !== 'CLOSED' && c.status !== 'RESOLVED') {
      throw new Error(`Case is already active (status: ${c.status})`);
    }

    const prevStatus = c.status;
    c.status = 'IN_PROGRESS';
    c.closedAt = undefined;
    c.updatedAt = new Date().toISOString();

    await put<Case>('cases', c);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_REOPENED',
      target: c.id,
      resultingState: 'IN_PROGRESS',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { from: prevStatus, reason: reason ?? 'Explicit reopen workflow' },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(c);
  }

  async getCaseNotes(caseId: string): Promise<CaseNote[]> {
    return clone(
      this._caseNotes
        .filter((n) => n.caseId === caseId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    );
  }

  async addCaseNote(
    caseId: string,
    input: CreateCaseNoteInput,
    actor: string,
    actorRole: RoleId
  ): Promise<CaseNote> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot add case notes`);
    }
    const c = this._cases.find((item) => item.id === caseId || item.caseNumber === caseId);
    if (!c) throw new Error(`Case "${caseId}" not found`);

    const now = new Date().toISOString();
    const note: CaseNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      caseId: c.id,
      authorId: input.authorId ?? actor,
      authorName: input.authorName ?? actor,
      createdAt: now,
      updatedAt: now,
      content: input.content,
    };

    this._caseNotes.push(note);
    await put<CaseNote>('case_notes', note);

    c.updatedAt = now;
    await put<Case>('cases', c);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_NOTE_ADDED',
      target: c.id,
      resultingState: 'NOTE_RECORDED',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { noteId: note.id, preview: note.content.slice(0, 80) },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(note);
  }

  async updateCaseNote(
    caseId: string,
    noteId: string,
    input: UpdateCaseNoteInput,
    actor: string,
    actorRole: RoleId
  ): Promise<CaseNote> {
    const note = this._caseNotes.find((n) => n.id === noteId && n.caseId === caseId);
    if (!note) throw new Error(`Case note "${noteId}" not found`);

    if (note.authorId !== actor && !canManageCase(actorRole)) {
      throw new Error(`Unauthorized: Only note author or manager may edit notes`);
    }

    const prevContent = note.content;
    note.content = input.content;
    note.updatedAt = new Date().toISOString();
    note.isEdited = true;

    await put<CaseNote>('case_notes', note);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_NOTE_UPDATED',
      target: caseId,
      resultingState: 'NOTE_MODIFIED',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { noteId, prevLength: prevContent.length, newLength: note.content.length },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(note);
  }

  async getCaseTasks(caseId: string): Promise<CaseTask[]> {
    return clone(
      this._caseTasks
        .filter((t) => t.caseId === caseId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    );
  }

  async addCaseTask(
    caseId: string,
    input: CreateCaseTaskInput,
    actor: string,
    actorRole: RoleId
  ): Promise<CaseTask> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot create case tasks`);
    }
    const c = this._cases.find((item) => item.id === caseId || item.caseNumber === caseId);
    if (!c) throw new Error(`Case "${caseId}" not found`);

    const now = new Date().toISOString();
    const task: CaseTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      caseId: c.id,
      title: input.title,
      description: input.description,
      status: 'TODO',
      priority: input.priority ?? c.priority,
      assigneeId: input.assigneeId,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      dueAt: input.dueAt,
    };

    this._caseTasks.push(task);
    await put<CaseTask>('case_tasks', task);

    c.updatedAt = now;
    await put<Case>('cases', c);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_TASK_ADDED',
      target: c.id,
      resultingState: task.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { taskId: task.id, title: task.title, priority: task.priority },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(task);
  }

  async updateCaseTask(
    caseId: string,
    taskId: string,
    patch: Partial<CaseTask>,
    actor: string,
    actorRole: RoleId
  ): Promise<CaseTask> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot update case tasks`);
    }
    const task = this._caseTasks.find((t) => t.id === taskId && t.caseId === caseId);
    if (!task) throw new Error(`Task "${taskId}" not found`);

    if (patch.title !== undefined) task.title = patch.title;
    if (patch.description !== undefined) task.description = patch.description;
    if (patch.priority !== undefined) task.priority = patch.priority;
    if (patch.assigneeId !== undefined) task.assigneeId = patch.assigneeId;
    if (patch.dueAt !== undefined) task.dueAt = patch.dueAt;

    if (patch.status !== undefined && patch.status !== task.status) {
      const prevStatus = task.status;
      task.status = patch.status;
      if (task.status === 'DONE') {
        task.completedAt = new Date().toISOString();
      } else if (prevStatus === 'DONE') {
        task.completedAt = undefined;
      }
    }

    task.updatedAt = new Date().toISOString();
    await put<CaseTask>('case_tasks', task);

    const c = this._cases.find((item) => item.id === caseId);
    if (c) {
      c.updatedAt = task.updatedAt;
      await put<Case>('cases', c);
    }

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_TASK_UPDATED',
      target: caseId,
      resultingState: task.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { taskId: task.id, title: task.title, status: task.status },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(task);
  }

  async getCaseFindings(caseId: string): Promise<CaseFinding[]> {
    return clone(
      this._caseFindings
        .filter((f) => f.caseId === caseId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    );
  }

  async addCaseFinding(
    caseId: string,
    input: CreateCaseFindingInput,
    actor: string,
    actorRole: RoleId
  ): Promise<CaseFinding> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot add case findings`);
    }
    const c = this._cases.find((item) => item.id === caseId || item.caseNumber === caseId);
    if (!c) throw new Error(`Case "${caseId}" not found`);

    const now = new Date().toISOString();
    const finding: CaseFinding = {
      id: `finding-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      caseId: c.id,
      title: input.title,
      description: input.description,
      severity: input.severity ?? c.severity,
      authorId: actor,
      createdAt: now,
      updatedAt: now,
      relatedEventIds: input.relatedEventIds ? [...input.relatedEventIds] : [],
      relatedAlertIds: input.relatedAlertIds ? [...input.relatedAlertIds] : [],
      relatedIncidentIds: input.relatedIncidentIds ? [...input.relatedIncidentIds] : [],
      relatedHuntIds: input.relatedHuntIds ? [...input.relatedHuntIds] : [],
    };

    finding.relatedEventIds?.forEach((eId) => { if (!c.eventIds.includes(eId)) c.eventIds.push(eId); });
    finding.relatedAlertIds?.forEach((aId) => { if (!c.alertIds.includes(aId)) c.alertIds.push(aId); });
    finding.relatedIncidentIds?.forEach((iId) => { if (!c.incidentIds.includes(iId)) c.incidentIds.push(iId); });
    finding.relatedHuntIds?.forEach((hId) => { if (!c.huntIds.includes(hId)) c.huntIds.push(hId); });

    this._caseFindings.push(finding);
    await put<CaseFinding>('case_findings', finding);

    c.updatedAt = now;
    await put<Case>('cases', c);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_FINDING_ADDED',
      target: c.id,
      resultingState: 'FINDING_DOCUMENTED',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { findingId: finding.id, title: finding.title, severity: finding.severity },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(finding);
  }

  async updateCaseFinding(
    caseId: string,
    findingId: string,
    patch: Partial<CaseFinding>,
    actor: string,
    actorRole: RoleId
  ): Promise<CaseFinding> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot update findings`);
    }
    const finding = this._caseFindings.find((f) => f.id === findingId && f.caseId === caseId);
    if (!finding) throw new Error(`Finding "${findingId}" not found`);

    if (patch.title !== undefined) finding.title = patch.title;
    if (patch.description !== undefined) finding.description = patch.description;
    if (patch.severity !== undefined) finding.severity = patch.severity;
    if (patch.relatedEventIds !== undefined) finding.relatedEventIds = patch.relatedEventIds;
    if (patch.relatedAlertIds !== undefined) finding.relatedAlertIds = patch.relatedAlertIds;
    if (patch.relatedIncidentIds !== undefined) finding.relatedIncidentIds = patch.relatedIncidentIds;
    if (patch.relatedHuntIds !== undefined) finding.relatedHuntIds = patch.relatedHuntIds;

    finding.updatedAt = new Date().toISOString();
    await put<CaseFinding>('case_findings', finding);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_FINDING_UPDATED',
      target: caseId,
      resultingState: 'FINDING_UPDATED',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { findingId, title: finding.title },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(finding);
  }

  async linkIncidentToCase(
    caseId: string,
    incidentId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<Case> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot link incidents to cases`);
    }
    const c = this._cases.find((item) => item.id === caseId || item.caseNumber === caseId);
    if (!c) throw new Error(`Case "${caseId}" not found`);

    const inc = this._incidents.find((i) => i.id === incidentId);
    if (!inc) throw new Error(`Incident "${incidentId}" not found`);

    if (!c.incidentIds.includes(inc.id)) {
      c.incidentIds.push(inc.id);

      inc.affectedAssets.forEach((a) => { if (!c.assetIds.includes(a)) c.assetIds.push(a); });
      inc.affectedUsers.forEach((u) => { if (!c.userIds.includes(u)) c.userIds.push(u); });
      inc.iocs.forEach((ioc) => { if (!c.iocIds.includes(ioc)) c.iocIds.push(ioc); });

      c.updatedAt = new Date().toISOString();
      await put<Case>('cases', c);

      const audit = this._buildAudit({
        actor,
        actorRole,
        action: 'CASE_INCIDENT_LINKED',
        target: c.id,
        resultingState: c.status,
        authorization: actorRole,
        outcome: 'SUCCESS',
        details: { incidentId: inc.id, incidentTitle: inc.title },
      });
      this._auditRecords.push(audit);
      await put<AuditRecord>('audit_records', audit);
    }

    return clone(c);
  }

  async unlinkIncidentFromCase(
    caseId: string,
    incidentId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<Case> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot unlink incidents from cases`);
    }
    const c = this._cases.find((item) => item.id === caseId || item.caseNumber === caseId);
    if (!c) throw new Error(`Case "${caseId}" not found`);

    c.incidentIds = c.incidentIds.filter((id) => id !== incidentId);
    c.updatedAt = new Date().toISOString();
    await put<Case>('cases', c);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_INCIDENT_UNLINKED',
      target: c.id,
      resultingState: c.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { incidentId },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(c);
  }

  async linkHuntToCase(
    caseId: string,
    huntId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<Case> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot link threat hunts to cases`);
    }
    const c = this._cases.find((item) => item.id === caseId || item.caseNumber === caseId);
    if (!c) throw new Error(`Case "${caseId}" not found`);

    const hunt = this._threatHunts.find((h) => h.id === huntId);
    if (!hunt) throw new Error(`Threat hunt "${huntId}" not found`);

    if (!c.huntIds.includes(hunt.id)) {
      c.huntIds.push(hunt.id);
      hunt.matchedEventIds.forEach((eId) => { if (!c.eventIds.includes(eId)) c.eventIds.push(eId); });

      c.updatedAt = new Date().toISOString();
      await put<Case>('cases', c);

      const audit = this._buildAudit({
        actor,
        actorRole,
        action: 'CASE_HUNT_LINKED',
        target: c.id,
        resultingState: c.status,
        authorization: actorRole,
        outcome: 'SUCCESS',
        details: { huntId: hunt.id, huntName: hunt.name },
      });
      this._auditRecords.push(audit);
      await put<AuditRecord>('audit_records', audit);
    }

    return clone(c);
  }

  async unlinkHuntFromCase(
    caseId: string,
    huntId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<Case> {
    if (!canUpdateCase(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot unlink threat hunts from cases`);
    }
    const c = this._cases.find((item) => item.id === caseId || item.caseNumber === caseId);
    if (!c) throw new Error(`Case "${caseId}" not found`);

    c.huntIds = c.huntIds.filter((id) => id !== huntId);
    c.updatedAt = new Date().toISOString();
    await put<Case>('cases', c);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'CASE_HUNT_UNLINKED',
      target: c.id,
      resultingState: c.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { huntId },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(c);
  }

  // ─── Evidence Management ────────────────────────────────────────────────────

  async getEvidence(filter?: EvidenceQueryFilter): Promise<Evidence[]> {
    let result = [...this._evidence];

    if (!filter) {
      return clone(result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }

    if (filter.query) {
      const q = filter.query.toLowerCase();
      result = result.filter(
        (e) =>
          e.evidenceNumber.toLowerCase().includes(q) ||
          e.title.toLowerCase().includes(q) ||
          (e.description && e.description.toLowerCase().includes(q)) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (filter.caseId) {
      result = result.filter((e) => e.caseId === filter.caseId);
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      result = result.filter((e) => statuses.includes(e.status));
    }

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      result = result.filter((e) => types.includes(e.type));
    }

    if (filter.sourceType) {
      const sourceTypes = Array.isArray(filter.sourceType) ? filter.sourceType : [filter.sourceType];
      result = result.filter((e) => sourceTypes.includes(e.sourceType));
    }

    if (filter.sourceId) {
      result = result.filter((e) => e.sourceId === filter.sourceId);
    }

    if (filter.collectedBy) {
      result = result.filter((e) => e.collectedBy === filter.collectedBy);
    }

    if (filter.tag) {
      const tagLower = filter.tag.toLowerCase();
      result = result.filter((e) => e.tags.some((t) => t.toLowerCase() === tagLower));
    }

    if (filter.incidentId) {
      result = result.filter((e) => (e.sourceType === 'INCIDENT' && e.sourceId === filter.incidentId) || e.relatedIncidentIds?.includes(filter.incidentId!));
    }

    if (filter.eventId) {
      result = result.filter((e) => (e.sourceType === 'SECURITY_EVENT' && e.sourceId === filter.eventId) || e.relatedEventIds?.includes(filter.eventId!));
    }

    if (filter.huntId) {
      result = result.filter((e) => (e.sourceType === 'THREAT_HUNT' && e.sourceId === filter.huntId) || e.relatedHuntIds?.includes(filter.huntId!));
    }

    if (filter.iocId) {
      result = result.filter((e) => (e.sourceType === 'IOC' && e.sourceId === filter.iocId) || e.relatedIocIds?.includes(filter.iocId!));
    }

    if (filter.assetId) {
      result = result.filter((e) => (e.sourceType === 'ASSET' && e.sourceId === filter.assetId) || e.relatedAssetIds?.includes(filter.assetId!));
    }

    if (filter.userId) {
      result = result.filter((e) => (e.sourceType === 'USER' && e.sourceId === filter.userId) || e.relatedUserIds?.includes(filter.userId!));
    }

    if (filter.dateFrom) {
      const fromTime = new Date(filter.dateFrom).getTime();
      result = result.filter((e) => new Date(e.createdAt).getTime() >= fromTime);
    }

    if (filter.dateTo) {
      const toTime = new Date(filter.dateTo).getTime();
      result = result.filter((e) => new Date(e.createdAt).getTime() <= toTime);
    }

    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filter.offset !== undefined && filter.offset > 0) {
      result = result.slice(filter.offset);
    }

    if (filter.limit !== undefined && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return clone(result);
  }

  async getEvidenceById(id: string): Promise<Evidence | null> {
    const found = this._evidence.find((e) => e.id === id || e.evidenceNumber === id);
    return found ? clone(found) : null;
  }

  async createEvidence(
    input: CreateEvidenceInput,
    actor: string,
    actorRole: RoleId
  ): Promise<Evidence> {
    if (!canCollectEvidence(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot collect evidence`);
    }

    // Mandatory case relationship: verify parent case exists
    const parentCase = this._cases.find((c) => c.id === input.caseId || c.caseNumber === input.caseId);
    if (!parentCase) {
      throw new Error(`Invalid case: Evidence must be associated with an existing case (caseId: "${input.caseId}")`);
    }

    const evidenceNumber = await getNextEvidenceNumber();
    const now = new Date().toISOString();
    const evidenceId = `evd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    let computedHash: string | undefined;
    let storageReference: string | undefined;
    let sizeBytes: number | undefined;

    // File evidence handling with strict size limit & offline storage
    if (input.fileBytes) {
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
      sizeBytes = input.fileBytes.byteLength;
      if (sizeBytes > MAX_FILE_SIZE) {
        throw new Error(`File evidence size exceeds maximum allowable offline limit (10MB, received: ${(sizeBytes / (1024 * 1024)).toFixed(2)}MB)`);
      }
      computedHash = await computeSha256(input.fileBytes);
      storageReference = `blob-${evidenceId}`;

      // Persist binary bytes in evidence_blobs store
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('evidence_blobs', 'readwrite');
        tx.objectStore('evidence_blobs').put({
          id: storageReference,
          evidenceId,
          fileName: input.fileName,
          mimeType: input.mimeType ?? 'application/octet-stream',
          sizeBytes,
          hash: computedHash,
          data: input.fileBytes,
          createdAt: now,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else if (input.textContent !== undefined) {
      computedHash = await computeStringSha256(input.textContent);
      sizeBytes = new TextEncoder().encode(input.textContent).length;
    } else if (input.sourceType && input.sourceId) {
      // Reference evidence: deterministic fingerprint based on canonical source reference
      computedHash = await computeStringSha256(`${input.sourceType}:${input.sourceId}:${input.title}`);
    }

    const newEvidence: Evidence = {
      id: evidenceId,
      evidenceNumber,
      caseId: parentCase.id,
      type: input.type,
      title: input.title,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      collectedAt: now,
      collectedBy: actor,
      createdAt: now,
      updatedAt: now,
      status: input.status ?? 'COLLECTED',
      integrity: {
        algorithm: 'SHA-256',
        hash: computedHash,
        verified: true,
        verifiedAt: now,
        verifiedBy: actor,
      },
      metadata: input.metadata ? clone(input.metadata) : {},
      tags: input.tags ? [...input.tags] : [],
      notes: input.notes,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes,
      storageReference,
      textContent: input.textContent,
      relatedEventIds: input.relatedEventIds ? [...input.relatedEventIds] : [],
      relatedAlertIds: input.relatedAlertIds ? [...input.relatedAlertIds] : [],
      relatedIncidentIds: input.relatedIncidentIds ? [...input.relatedIncidentIds] : [],
      relatedHuntIds: input.relatedHuntIds ? [...input.relatedHuntIds] : [],
      relatedAssetIds: input.relatedAssetIds ? [...input.relatedAssetIds] : [],
      relatedUserIds: input.relatedUserIds ? [...input.relatedUserIds] : [],
      relatedIocIds: input.relatedIocIds ? [...input.relatedIocIds] : [],
    };

    // Append initial custody record
    const custodyEntry: EvidenceCustodyEntry = {
      id: `custody-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      evidenceId: newEvidence.id,
      action: 'COLLECTED',
      actorId: actor,
      actorRole,
      timestamp: now,
      toStatus: newEvidence.status,
      source: input.sourceType,
      reason: 'Initial evidence collection preserved for case investigation',
      metadata: { evidenceNumber: newEvidence.evidenceNumber, type: newEvidence.type, hash: computedHash },
    };

    this._evidence.push(newEvidence);
    this._evidenceCustody.push(custodyEntry);

    await put<Evidence>('evidence', newEvidence);
    await put<EvidenceCustodyEntry>('evidence_custody', custodyEntry);

    // Refresh parent case updatedAt and link any canonical entity IDs
    let caseModified = false;
    newEvidence.relatedEventIds?.forEach((eId) => { if (!parentCase.eventIds.includes(eId)) { parentCase.eventIds.push(eId); caseModified = true; } });
    newEvidence.relatedAlertIds?.forEach((aId) => { if (!parentCase.alertIds.includes(aId)) { parentCase.alertIds.push(aId); caseModified = true; } });
    newEvidence.relatedIncidentIds?.forEach((iId) => { if (!parentCase.incidentIds.includes(iId)) { parentCase.incidentIds.push(iId); caseModified = true; } });
    newEvidence.relatedHuntIds?.forEach((hId) => { if (!parentCase.huntIds.includes(hId)) { parentCase.huntIds.push(hId); caseModified = true; } });
    newEvidence.relatedAssetIds?.forEach((asId) => { if (!parentCase.assetIds.includes(asId)) { parentCase.assetIds.push(asId); caseModified = true; } });
    newEvidence.relatedUserIds?.forEach((uId) => { if (!parentCase.userIds.includes(uId)) { parentCase.userIds.push(uId); caseModified = true; } });
    newEvidence.relatedIocIds?.forEach((iocId) => { if (!parentCase.iocIds.includes(iocId)) { parentCase.iocIds.push(iocId); caseModified = true; } });

    parentCase.updatedAt = now;
    await put<Case>('cases', parentCase);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'EVIDENCE_COLLECTED',
      target: newEvidence.id,
      resultingState: newEvidence.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: {
        evidenceNumber: newEvidence.evidenceNumber,
        caseId: newEvidence.caseId,
        type: newEvidence.type,
        sourceType: newEvidence.sourceType,
        sourceId: newEvidence.sourceId,
        hash: computedHash,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newEvidence);
  }

  async updateEvidenceMetadata(
    id: string,
    patch: UpdateEvidenceMetadataInput,
    actor: string,
    actorRole: RoleId
  ): Promise<Evidence> {
    if (!canAnnotateEvidence(actorRole) && !canManageEvidence(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot update evidence metadata`);
    }

    const evd = this._evidence.find((e) => e.id === id || e.evidenceNumber === id);
    if (!evd) throw new Error(`Evidence "${id}" not found`);

    // Core provenance fields are strictly IMMUTABLE:
    // id, evidenceNumber, caseId, collectedAt, collectedBy, sourceType, sourceId, integrity.hash CANNOT be altered.

    if (patch.title !== undefined) evd.title = patch.title;
    if (patch.description !== undefined) evd.description = patch.description;
    if (patch.notes !== undefined) evd.notes = patch.notes;
    if (patch.tags !== undefined) evd.tags = [...patch.tags];
    if (patch.metadata !== undefined) evd.metadata = clone(patch.metadata);
    if (patch.relatedEventIds !== undefined) evd.relatedEventIds = [...patch.relatedEventIds];
    if (patch.relatedAlertIds !== undefined) evd.relatedAlertIds = [...patch.relatedAlertIds];
    if (patch.relatedIncidentIds !== undefined) evd.relatedIncidentIds = [...patch.relatedIncidentIds];
    if (patch.relatedHuntIds !== undefined) evd.relatedHuntIds = [...patch.relatedHuntIds];
    if (patch.relatedAssetIds !== undefined) evd.relatedAssetIds = [...patch.relatedAssetIds];
    if (patch.relatedUserIds !== undefined) evd.relatedUserIds = [...patch.relatedUserIds];
    if (patch.relatedIocIds !== undefined) evd.relatedIocIds = [...patch.relatedIocIds];

    const now = new Date().toISOString();
    evd.updatedAt = now;

    await put<Evidence>('evidence', evd);

    const custodyEntry: EvidenceCustodyEntry = {
      id: `custody-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      evidenceId: evd.id,
      action: 'ANNOTATED',
      actorId: actor,
      actorRole,
      timestamp: now,
      reason: 'Evidence metadata updated by analyst',
      metadata: { fieldsUpdated: Object.keys(patch) },
    };
    this._evidenceCustody.push(custodyEntry);
    await put<EvidenceCustodyEntry>('evidence_custody', custodyEntry);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'EVIDENCE_METADATA_UPDATED',
      target: evd.id,
      resultingState: evd.status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { evidenceNumber: evd.evidenceNumber, fieldsUpdated: Object.keys(patch) },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(evd);
  }

  async updateEvidenceStatus(
    id: string,
    status: EvidenceStatus,
    reason: string | undefined,
    actor: string,
    actorRole: RoleId
  ): Promise<Evidence> {
    if (!canManageEvidence(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot change evidence status`);
    }

    const evd = this._evidence.find((e) => e.id === id || e.evidenceNumber === id);
    if (!evd) throw new Error(`Evidence "${id}" not found`);

    if (evd.status === status) return clone(evd);

    if (!isValidEvidenceStatusTransition(evd.status, status)) {
      throw new Error(`Invalid lifecycle transition from ${evd.status} to ${status}`);
    }

    const prevStatus = evd.status;
    evd.status = status;
    const now = new Date().toISOString();
    evd.updatedAt = now;

    await put<Evidence>('evidence', evd);

    const custodyEntry: EvidenceCustodyEntry = {
      id: `custody-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      evidenceId: evd.id,
      action: status === 'ARCHIVED' ? 'ARCHIVED' : 'STATUS_CHANGED',
      actorId: actor,
      actorRole,
      timestamp: now,
      fromStatus: prevStatus,
      toStatus: status,
      reason: reason ?? `Status changed from ${prevStatus} to ${status}`,
    };
    this._evidenceCustody.push(custodyEntry);
    await put<EvidenceCustodyEntry>('evidence_custody', custodyEntry);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'EVIDENCE_STATUS_CHANGED',
      target: evd.id,
      previousState: prevStatus,
      resultingState: status,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { evidenceNumber: evd.evidenceNumber, from: prevStatus, to: status, reason },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(evd);
  }

  async archiveEvidence(
    id: string,
    reason: string | undefined,
    actor: string,
    actorRole: RoleId
  ): Promise<Evidence> {
    return this.updateEvidenceStatus(id, 'ARCHIVED', reason ?? 'Evidence archived by analyst', actor, actorRole);
  }

  async verifyEvidenceIntegrity(
    id: string,
    actor: string,
    actorRole: RoleId
  ): Promise<{ verified: boolean; storedHash?: string; computedHash?: string; message: string }> {
    if (!canVerifyEvidence(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot verify evidence integrity`);
    }

    const evd = this._evidence.find((e) => e.id === id || e.evidenceNumber === id);
    if (!evd) throw new Error(`Evidence "${id}" not found`);

    const storedHash = evd.integrity.hash;
    let computedHash: string | undefined;
    let isMatch = false;
    let message = '';

    if (evd.storageReference) {
      // File evidence: read stored bytes from evidence_blobs store
      const blobRecord = await (async () => {
        try {
          const db = await openDb();
          const req = db.transaction('evidence_blobs', 'readonly').objectStore('evidence_blobs').get(evd.storageReference!);
          return new Promise<any>((res, rej) => {
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
          });
        } catch {
          return null;
        }
      })();

      if (!blobRecord || !blobRecord.data) {
        isMatch = false;
        message = `Integrity verification failed: binary blob for "${evd.storageReference}" not found in storage`;
      } else {
        computedHash = await computeSha256(blobRecord.data);
        isMatch = (computedHash === storedHash);
        message = isMatch ? 'SHA-256 integrity verified against stored binary payload' : 'INTEGRITY MISMATCH: computed file hash does not match stored hash';
      }
    } else if (evd.textContent !== undefined) {
      computedHash = await computeStringSha256(evd.textContent);
      isMatch = (computedHash === storedHash);
      message = isMatch ? 'SHA-256 integrity verified against text payload' : 'INTEGRITY MISMATCH: computed text hash does not match stored hash';
    } else if (evd.sourceId) {
      // Canonical reference evidence: verify the referenced security object exists and is authentic
      let exists = false;
      switch (evd.sourceType) {
        case 'SECURITY_EVENT':
          exists = this._events.some((ev) => ev.id === evd.sourceId);
          break;
        case 'ALERT':
          exists = this._alerts.some((al) => al.id === evd.sourceId);
          break;
        case 'INCIDENT':
          exists = this._incidents.some((inc) => inc.id === evd.sourceId);
          break;
        case 'THREAT_HUNT':
          exists = this._threatHunts.some((h) => h.id === evd.sourceId);
          break;
        case 'IOC':
          exists = this._iocs.some((ioc) => ioc.id === evd.sourceId);
          break;
        case 'ASSET':
          exists = this._assets.some((a) => a.id === evd.sourceId);
          break;
        case 'USER':
          exists = this._users.some((u) => u.id === evd.sourceId);
          break;
        default:
          exists = true;
          break;
      }
      isMatch = exists;
      computedHash = storedHash;
      message = exists
        ? `Provenance verified: canonical ${evd.sourceType} "${evd.sourceId}" is present and authentic in SOC repository`
        : `INTEGRITY MISMATCH: canonical source ${evd.sourceType} "${evd.sourceId}" not found in local security store`;
    } else {
      isMatch = true;
      computedHash = storedHash;
      message = 'Integrity verification complete for analyst observation';
    }

    const now = new Date().toISOString();
    evd.integrity.verified = isMatch;
    evd.integrity.verifiedAt = now;
    evd.integrity.verifiedBy = actor;
    evd.updatedAt = now;
    await put<Evidence>('evidence', evd);

    const custodyEntry: EvidenceCustodyEntry = {
      id: `custody-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      evidenceId: evd.id,
      action: 'INTEGRITY_VERIFIED',
      actorId: actor,
      actorRole,
      timestamp: now,
      reason: message,
      metadata: { verified: isMatch, storedHash, computedHash },
    };
    this._evidenceCustody.push(custodyEntry);
    await put<EvidenceCustodyEntry>('evidence_custody', custodyEntry);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: isMatch ? 'EVIDENCE_INTEGRITY_VERIFIED' : 'EVIDENCE_INTEGRITY_MISMATCH',
      target: evd.id,
      resultingState: isMatch ? 'VERIFIED' : 'INTEGRITY_MISMATCH',
      authorization: actorRole,
      outcome: isMatch ? 'SUCCESS' : 'FAILURE',
      details: {
        evidenceNumber: evd.evidenceNumber,
        verified: isMatch,
        storedHash,
        computedHash,
        message,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return {
      verified: isMatch,
      storedHash,
      computedHash,
      message,
    };
  }

  async getEvidenceCustody(evidenceId: string): Promise<EvidenceCustodyEntry[]> {
    return clone(
      this._evidenceCustody
        .filter((c) => c.evidenceId === evidenceId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    );
  }

  async getEvidenceAnnotations(evidenceId: string): Promise<EvidenceAnnotation[]> {
    return clone(
      this._evidenceAnnotations
        .filter((a) => a.evidenceId === evidenceId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    );
  }

  async addEvidenceAnnotation(
    evidenceId: string,
    input: CreateEvidenceAnnotationInput,
    actor: string,
    actorRole: RoleId
  ): Promise<EvidenceAnnotation> {
    if (!canAnnotateEvidence(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot annotate evidence`);
    }

    const evd = this._evidence.find((e) => e.id === evidenceId || e.evidenceNumber === evidenceId);
    if (!evd) throw new Error(`Evidence "${evidenceId}" not found`);

    const now = new Date().toISOString();
    const annotation: EvidenceAnnotation = {
      id: `anno-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      evidenceId: evd.id,
      authorId: input.authorId ?? actor,
      authorName: input.authorName ?? actor,
      createdAt: now,
      updatedAt: now,
      content: input.content,
    };

    this._evidenceAnnotations.push(annotation);
    await put<EvidenceAnnotation>('evidence_annotations', annotation);

    const custodyEntry: EvidenceCustodyEntry = {
      id: `custody-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      evidenceId: evd.id,
      action: 'ANNOTATED',
      actorId: actor,
      actorRole,
      timestamp: now,
      reason: `Analyst annotation added: "${input.content.slice(0, 40)}${input.content.length > 40 ? '...' : ''}"`,
      metadata: { annotationId: annotation.id },
    };
    this._evidenceCustody.push(custodyEntry);
    await put<EvidenceCustodyEntry>('evidence_custody', custodyEntry);

    const audit = this._buildAudit({
      actor,
      actorRole,
      action: 'EVIDENCE_ANNOTATION_ADDED',
      target: evd.id,
      resultingState: 'ANNOTATED',
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { annotationId: annotation.id, evidenceNumber: evd.evidenceNumber },
    });
    this._auditRecords.push(audit);
    await put<AuditRecord>('audit_records', audit);

    return clone(annotation);
  }

  async collectEventAsEvidence(
    caseId: string,
    eventId: string,
    input: Partial<CreateEvidenceInput>,
    actor: string,
    actorRole: RoleId
  ): Promise<Evidence> {
    const event = this._events.find((e) => e.id === eventId);
    if (!event) throw new Error(`SecurityEvent "${eventId}" not found`);

    return this.createEvidence(
      {
        caseId,
        type: 'EVENT_REFERENCE',
        title: input.title ?? `Event Observation: ${event.eventType} on ${event.source}`,
        description: input.description ?? event.message ?? `Telemetry captured from ${event.sourceType} (${event.category})`,
        sourceType: 'SECURITY_EVENT',
        sourceId: event.id,
        tags: input.tags ?? [event.category.toLowerCase(), event.sourceType.toLowerCase(), 'telemetry'],
        metadata: {
          ...input.metadata,
          eventType: event.eventType,
          category: event.category,
          severity: event.severity,
          source: event.source,
          assetId: event.assetId,
          userId: event.userId,
          rawPayload: event.rawPayload,
        },
        relatedEventIds: [event.id, ...(input.relatedEventIds ?? [])],
        relatedAssetIds: event.assetId ? [event.assetId, ...(input.relatedAssetIds ?? [])] : input.relatedAssetIds,
        relatedUserIds: event.userId ? [event.userId, ...(input.relatedUserIds ?? [])] : input.relatedUserIds,
        relatedIncidentIds: event.incidentId ? [event.incidentId, ...(input.relatedIncidentIds ?? [])] : input.relatedIncidentIds,
      },
      actor,
      actorRole
    );
  }

  async collectAlertAsEvidence(
    caseId: string,
    alertId: string,
    input: Partial<CreateEvidenceInput>,
    actor: string,
    actorRole: RoleId
  ): Promise<Evidence> {
    const alert = this._alerts.find((a) => a.id === alertId);
    if (!alert) throw new Error(`Alert "${alertId}" not found`);

    return this.createEvidence(
      {
        caseId,
        type: 'ALERT_REFERENCE',
        title: input.title ?? `Alert Detection: ${alert.title}`,
        description: input.description ?? alert.description,
        sourceType: 'ALERT',
        sourceId: alert.id,
        tags: input.tags ?? ['alert', alert.severity.toLowerCase(), alert.ruleId.toLowerCase()],
        metadata: {
          ...input.metadata,
          ruleId: alert.ruleId,
          severity: alert.severity,
          status: alert.status,
          assetId: alert.assetId,
          incidentId: alert.incidentId,
          sourceEventIds: alert.sourceEventIds,
          primaryEventId: alert.primaryEventId,
        },
        relatedAlertIds: [alert.id, ...(input.relatedAlertIds ?? [])],
        relatedEventIds: [...(alert.sourceEventIds ?? []), ...(input.relatedEventIds ?? [])],
        relatedAssetIds: alert.assetId ? [alert.assetId, ...(input.relatedAssetIds ?? [])] : input.relatedAssetIds,
        relatedIncidentIds: alert.incidentId ? [alert.incidentId, ...(input.relatedIncidentIds ?? [])] : input.relatedIncidentIds,
      },
      actor,
      actorRole
    );
  }

  async collectIncidentAsEvidence(
    caseId: string,
    incidentId: string,
    input: Partial<CreateEvidenceInput>,
    actor: string,
    actorRole: RoleId
  ): Promise<Evidence> {
    const inc = this._incidents.find((i) => i.id === incidentId);
    if (!inc) throw new Error(`Incident "${incidentId}" not found`);

    return this.createEvidence(
      {
        caseId,
        type: 'INCIDENT_REFERENCE',
        title: input.title ?? `Incident Correlation: ${inc.title}`,
        description: input.description ?? inc.description ?? inc.summary ?? `Correlated incident with risk score ${inc.riskScore}`,
        sourceType: 'INCIDENT',
        sourceId: inc.id,
        tags: input.tags ?? ['incident', inc.severity.toLowerCase(), inc.status.toLowerCase()],
        metadata: {
          ...input.metadata,
          incidentTitle: inc.title,
          severity: inc.severity,
          status: inc.status,
          riskScore: inc.riskScore,
          affectedAssets: inc.affectedAssets,
          affectedUsers: inc.affectedUsers,
          iocs: inc.iocs,
        },
        relatedIncidentIds: [inc.id, ...(input.relatedIncidentIds ?? [])],
        relatedAssetIds: [...inc.affectedAssets, ...(input.relatedAssetIds ?? [])],
        relatedUserIds: [...inc.affectedUsers, ...(input.relatedUserIds ?? [])],
        relatedIocIds: [...inc.iocs, ...(input.relatedIocIds ?? [])],
      },
      actor,
      actorRole
    );
  }

  async collectHuntAsEvidence(
    caseId: string,
    huntId: string,
    input: Partial<CreateEvidenceInput>,
    actor: string,
    actorRole: RoleId
  ): Promise<Evidence> {
    const hunt = this._threatHunts.find((h) => h.id === huntId);
    if (!hunt) throw new Error(`Threat hunt "${huntId}" not found`);

    return this.createEvidence(
      {
        caseId,
        type: 'HUNT_REFERENCE',
        title: input.title ?? `Threat Hunt Finding: ${hunt.name}`,
        description: input.description ?? hunt.description ?? `Threat hunt executed by ${hunt.createdBy}, matching ${hunt.resultCount} events`,
        sourceType: 'THREAT_HUNT',
        sourceId: hunt.id,
        tags: input.tags ?? ['threat-hunt', ...(hunt.tags ?? [])],
        metadata: {
          ...input.metadata,
          huntName: hunt.name,
          resultCount: hunt.resultCount,
          matchedEventIds: hunt.matchedEventIds,
          relatedAlertIds: hunt.relatedAlertIds,
          relatedIncidentIds: hunt.relatedIncidentIds,
        },
        relatedHuntIds: [hunt.id, ...(input.relatedHuntIds ?? [])],
        relatedEventIds: [...(hunt.matchedEventIds ?? []), ...(input.relatedEventIds ?? [])],
        relatedAlertIds: [...(hunt.relatedAlertIds ?? []), ...(input.relatedAlertIds ?? [])],
        relatedIncidentIds: [...(hunt.relatedIncidentIds ?? []), ...(input.relatedIncidentIds ?? [])],
      },
      actor,
      actorRole
    );
  }

  async getEvidenceBlob(storageReference: string): Promise<ArrayBuffer | null> {
    try {
      const db = await openDb();
      const req = db.transaction('evidence_blobs', 'readonly').objectStore('evidence_blobs').get(storageReference);
      const row = await new Promise<any>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return row && row.data ? row.data : null;
    } catch {
      return null;
    }
  }

  // ─── Threat Intelligence Engine ───────────────────────────────────────────

  async getThreatIntel(indicatorId: string): Promise<ThreatIntelRecord | null> {
    const idLower = indicatorId.toLowerCase().trim();
    const existing = this._threatIntel.find(
      (r) => r.indicatorId === indicatorId || r.id === indicatorId || r.indicatorValue.toLowerCase().trim() === idLower
    );
    if (existing) return clone(existing);

    // If record not yet cached in threat_intel, check if canonical IOC exists
    let ioc = this._iocs.find((i) => i.id === indicatorId || i.value.toLowerCase().trim() === idLower);
    if (!ioc) {
      // Check if indicator can be auto-registered from local events
      const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(indicatorId);
      const isHash = /^[a-fA-F0-9]{32,64}$/.test(indicatorId);
      const isDomain = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(indicatorId);
      if (isIp || isHash || isDomain) {
        const newIoc: IOC = {
          id: `ioc-dyn-${indicatorId.replace(/[^a-zA-Z0-9]/g, '-')}`,
          type: isIp ? 'IP' : isHash ? 'HASH_SHA256' : 'DOMAIN',
          value: indicatorId,
          threatType: 'Observed Telemetry Indicator',
          confidence: 0.6,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          reputationScore: 50,
          isBlocked: false,
          relatedIncidents: [],
          relatedAssets: [],
        };
        this._iocs.push(newIoc);
        await put<IOC>('iocs', newIoc);
        ioc = newIoc;
      } else {
        return null;
      }
    }

    // Dynamically derive and enrich for this IOC
    const { record, relationships } = ThreatIntelEngine.enrichLocally(
      ioc,
      undefined,
      this._events,
      this._alerts,
      this._incidents,
      this._threatHunts,
      this._cases,
      this._evidence,
      this._iocs
    );

    this._threatIntel.push(record);
    this._threatIntelRelationships.push(...relationships);
    await put<ThreatIntelRecord>('threat_intel', record);
    await putMany<ThreatIntelRelationship>('threat_intel_relationships', relationships);

    return clone(record);
  }

  async getThreatIntelByIndicator(indicatorType: IocType, value: string): Promise<ThreatIntelRecord | null> {
    const valLower = value.toLowerCase().trim();
    const existing = this._threatIntel.find(
      (r) => r.indicatorType === indicatorType && r.indicatorValue.toLowerCase().trim() === valLower
    );
    if (existing) return clone(existing);

    const ioc = this._iocs.find(
      (i) => i.type === indicatorType && i.value.toLowerCase().trim() === valLower
    );
    if (!ioc) return null;

    return this.getThreatIntel(ioc.id);
  }

  async getThreatIntelRecords(filters?: ThreatIntelQueryFilter): Promise<ThreatIntelRecord[]> {
    let results = [...this._threatIntel];

    if (filters) {
      if (filters.indicatorType) {
        results = results.filter((r) => r.indicatorType === filters.indicatorType);
      }
      if (filters.confidence) {
        results = results.filter((r) => r.confidence === filters.confidence);
      }
      if (filters.sourceType) {
        results = results.filter((r) => r.sourceType === filters.sourceType);
      }
      if (filters.classification) {
        results = results.filter((r) => r.classification === filters.classification);
      }
      if (filters.threatType) {
        const tt = filters.threatType.toLowerCase();
        results = results.filter((r) => r.threatTypes?.some((t) => t.toLowerCase().includes(tt)));
      }
      if (filters.malwareFamily) {
        const mf = filters.malwareFamily.toLowerCase();
        results = results.filter((r) => r.malwareFamilies?.some((f) => f.toLowerCase().includes(mf)));
      }
      if (filters.campaign) {
        const camp = filters.campaign.toLowerCase();
        results = results.filter((r) => r.campaigns?.some((c) => c.toLowerCase().includes(camp)));
      }
      if (filters.mitreTechniqueId) {
        results = results.filter((r) => r.mitreTechniqueIds?.includes(filters.mitreTechniqueId!));
      }
      if (filters.tag) {
        results = results.filter((r) => r.tags?.includes(filters.tag!));
      }
      if (filters.search) {
        const q = filters.search.toLowerCase().trim();
        results = results.filter(
          (r) =>
            r.indicatorValue.toLowerCase().includes(q) ||
            r.title?.toLowerCase().includes(q) ||
            r.description?.toLowerCase().includes(q) ||
            r.tags?.some((t) => t.toLowerCase().includes(q)) ||
            r.malwareFamilies?.some((f) => f.toLowerCase().includes(q)) ||
            r.campaigns?.some((c) => c.toLowerCase().includes(q))
        );
      }
    }

    return clone(results);
  }

  async createThreatIntelRecord(
    input: CreateThreatIntelInput,
    actor: string,
    actorRole: RoleId
  ): Promise<ThreatIntelRecord> {
    if (!canManageThreatIntel(actorRole)) {
      throw new Error(`Role "${actorRole}" is not authorized to create threat intelligence records.`);
    }

    // Verify or register canonical IOC
    let ioc: IOC | undefined;
    if (input.indicatorId) {
      ioc = this._iocs.find((i) => i.id === input.indicatorId);
    }
    if (!ioc && input.indicatorType && input.indicatorValue) {
      const valLower = input.indicatorValue.toLowerCase();
      ioc = this._iocs.find((i) => i.type === input.indicatorType && i.value.toLowerCase() === valLower);
    }

    const now = new Date().toISOString();

    if (!ioc) {
      if (!input.indicatorType || !input.indicatorValue) {
        throw new Error('Either a valid indicatorId or both indicatorType and indicatorValue must be provided.');
      }
      ioc = {
        id: input.indicatorId || `ioc-${Date.now().toString(36)}`,
        type: input.indicatorType,
        value: input.indicatorValue,
        threatType: input.threatTypes?.[0] || 'Unknown Threat',
        confidence: input.confidence === 'HIGH' ? 0.9 : input.confidence === 'MEDIUM' ? 0.7 : 0.4,
        firstSeen: now,
        lastSeen: now,
        reputationScore: input.severity === 'CRITICAL' ? 95 : input.severity === 'HIGH' ? 80 : 50,
        isBlocked: false,
        relatedIncidents: [],
        relatedAssets: [],
      };
      this._iocs.push(ioc);
      await put<IOC>('iocs', ioc);
    }

    const targetIoc = ioc;

    const { record: enriched, relationships } = ThreatIntelEngine.enrichLocally(
      targetIoc,
      undefined,
      this._events,
      this._alerts,
      this._incidents,
      this._threatHunts,
      this._cases,
      this._evidence,
      this._iocs
    );

    const newRecord: ThreatIntelRecord = {
      ...enriched,
      id: `intel-${targetIoc.id}`,
      title: input.title ?? enriched.title,
      description: input.description ?? enriched.description,
      confidence: input.confidence ?? enriched.confidence,
      severity: input.severity ?? enriched.severity,
      classification: input.classification ?? enriched.classification,
      sourceType: input.sourceType ?? 'LOCAL_ANALYST',
      sourceName: input.sourceName ?? `Analyst: ${actor}`,
      tags: Array.from(new Set([...enriched.tags, ...(input.tags ?? [])])),
      threatTypes: input.threatTypes ?? enriched.threatTypes,
      malwareFamilies: input.malwareFamilies ?? enriched.malwareFamilies,
      campaigns: input.campaigns ?? enriched.campaigns,
      actors: input.actors ?? enriched.actors,
      mitreTechniqueIds: Array.from(new Set([...(enriched.mitreTechniqueIds ?? []), ...(input.mitreTechniqueIds ?? [])])),
      relatedIndicatorIds: Array.from(new Set([...(enriched.relatedIndicatorIds ?? []), ...(input.relatedIndicatorIds ?? [])])),
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? enriched.metadata,
    };

    const existingIdx = this._threatIntel.findIndex((r) => r.id === newRecord.id || r.indicatorId === targetIoc.id);
    if (existingIdx >= 0) {
      this._threatIntel[existingIdx] = newRecord;
    } else {
      this._threatIntel.push(newRecord);
    }

    // Upsert relationships
    for (const rel of relationships) {
      if (!this._threatIntelRelationships.some((r) => r.id === rel.id)) {
        this._threatIntelRelationships.push(rel);
      }
    }

    await put<ThreatIntelRecord>('threat_intel', newRecord);
    await putMany<ThreatIntelRelationship>('threat_intel_relationships', relationships);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'THREAT_INTEL_CREATED',
      target: newRecord.id,
      resultingState: newRecord.confidence,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { indicatorId: targetIoc.id, indicatorValue: targetIoc.value, sourceType: newRecord.sourceType },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newRecord);
  }

  async updateThreatIntelRecord(
    id: string,
    patch: UpdateThreatIntelInput,
    actor: string,
    actorRole: RoleId
  ): Promise<ThreatIntelRecord> {
    if (!canManageThreatIntel(actorRole)) {
      throw new Error(`Role "${actorRole}" is not authorized to update threat intelligence records.`);
    }

    const idx = this._threatIntel.findIndex((r) => r.id === id || r.indicatorId === id);
    if (idx < 0) {
      throw new Error(`Threat intelligence record "${id}" not found.`);
    }

    const existing = this._threatIntel[idx];
    const confidenceChanged = patch.confidence && patch.confidence !== existing.confidence;
    const now = new Date().toISOString();

    const updated: ThreatIntelRecord = {
      ...existing,
      ...patch,
      tags: patch.tags ? Array.from(new Set([...existing.tags, ...patch.tags])) : existing.tags,
      mitreTechniqueIds: patch.mitreTechniqueIds
        ? Array.from(new Set([...(existing.mitreTechniqueIds ?? []), ...patch.mitreTechniqueIds]))
        : existing.mitreTechniqueIds,
      updatedAt: now,
      metadata: { ...existing.metadata, ...patch.metadata },
    };

    this._threatIntel[idx] = updated;
    await put<ThreatIntelRecord>('threat_intel', updated);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: confidenceChanged ? 'CONFIDENCE_CHANGED' : 'THREAT_INTEL_UPDATED',
      target: updated.id,
      resultingState: updated.confidence,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: { patch },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(updated);
  }

  async getThreatIntelRelationships(indicatorId: string): Promise<ThreatIntelRelationship[]> {
    const idLower = indicatorId.toLowerCase().trim();
    const matchRecord = this._threatIntel.find(
      (r) => r.indicatorId === indicatorId || r.id === indicatorId || r.indicatorValue.toLowerCase().trim() === idLower
    );
    const resolvedIds = new Set<string>([indicatorId]);
    if (matchRecord) {
      resolvedIds.add(matchRecord.id);
      resolvedIds.add(matchRecord.indicatorId);
      resolvedIds.add(matchRecord.indicatorValue);
    }
    const matchIoc = this._iocs.find((i) => i.id === indicatorId || i.value.toLowerCase().trim() === idLower);
    if (matchIoc) {
      resolvedIds.add(matchIoc.id);
      resolvedIds.add(matchIoc.value);
    }

    const rels = this._threatIntelRelationships.filter(
      (r) => resolvedIds.has(r.sourceId) || resolvedIds.has(r.targetId)
    );
    return clone(rels);
  }

  async getRelatedIndicators(indicatorId: string): Promise<IOC[]> {
    const rels = this._threatIntelRelationships.filter(
      (r) => (r.sourceId === indicatorId && r.targetType === 'IOC') || (r.targetId === indicatorId && r.sourceType === 'IOC')
    );
    const relatedIds = new Set<string>();
    rels.forEach((r) => {
      if (r.sourceId === indicatorId && r.targetType === 'IOC') relatedIds.add(r.targetId);
      if (r.targetId === indicatorId && r.sourceType === 'IOC') relatedIds.add(r.sourceId);
    });

    const iocs = this._iocs.filter((i) => relatedIds.has(i.id));
    return clone(iocs);
  }

  async getIndicatorObservations(indicatorId: string): Promise<IndicatorObservations | null> {
    const ioc = this._iocs.find((i) => i.id === indicatorId);
    if (!ioc) return null;

    const obs = ThreatIntelEngine.deriveObservations(
      ioc,
      this._events,
      this._alerts,
      this._incidents,
      this._threatHunts,
      this._cases,
      this._evidence
    );

    return clone(obs);
  }

  async enrichIndicatorLocally(
    indicatorId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<{ record: ThreatIntelRecord; relationships: ThreatIntelRelationship[] }> {
    if (!canEnrichThreatIntel(actorRole)) {
      throw new Error(`Role "${actorRole}" is not authorized to execute local intelligence enrichment.`);
    }

    const ioc = this._iocs.find((i) => i.id === indicatorId);
    if (!ioc) {
      throw new Error(`Indicator "${indicatorId}" not found in canonical IOC store.`);
    }

    const existing = this._threatIntel.find((r) => r.indicatorId === indicatorId);
    const { record, relationships } = ThreatIntelEngine.enrichLocally(
      ioc,
      existing,
      this._events,
      this._alerts,
      this._incidents,
      this._threatHunts,
      this._cases,
      this._evidence,
      this._iocs
    );

    // Update in-memory state
    const existingIdx = this._threatIntel.findIndex((r) => r.id === record.id || r.indicatorId === ioc.id);
    if (existingIdx >= 0) {
      this._threatIntel[existingIdx] = record;
    } else {
      this._threatIntel.push(record);
    }

    // Filter out old relationships for this indicator and add newly synthesized ones
    this._threatIntelRelationships = this._threatIntelRelationships.filter((r) => r.sourceId !== indicatorId);
    this._threatIntelRelationships.push(...relationships);

    await put<ThreatIntelRecord>('threat_intel', record);
    await putMany<ThreatIntelRelationship>('threat_intel_relationships', relationships);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'LOCAL_ENRICHMENT_EXECUTED',
      target: record.id,
      resultingState: record.confidence,
      authorization: actorRole,
      outcome: 'SUCCESS',
      details: {
        indicatorId: ioc.id,
        indicatorValue: ioc.value,
        observationsCount: record.observationsCount,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
      },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return { record: clone(record), relationships: clone(relationships) };
  }

  // ─── Private: IDB hydration & seeding ───────────────────────────────────────

  private async _writeSeedToIdb(): Promise<void> {
    await putMany<Incident>('incidents', [clone(SEED_INCIDENT), clone(SEED_INCIDENT_2)]);
    await putMany<Asset>('assets', clone(SEED_ASSETS));
    await putMany<SecurityUser>('users', clone(SEED_USERS));
    await putMany<IOC>('iocs', clone(SEED_IOCS));
    await putMany<AuditRecord>('audit_records', clone(SEED_AUDIT_RECORDS));
    await putMany<ResponseAction>('response_actions', clone(SEED_RESPONSE_ACTIONS));
    await putMany<SecurityEvent>('events', clone(SEED_SECURITY_EVENTS));
    await setMeta(META_SEEDED, true);
    await setMeta(META_EVENTS_SEEDED, true);
    await setMeta(META_SCENARIO, { activeScenarioId: null, activeScenarioStep: 0 } as ScenarioMeta);
  }

  private async _hydrateFromIdb(): Promise<void> {
    this._incidents       = await getAll<Incident>('incidents');
    this._assets          = await getAll<Asset>('assets');
    this._users           = await getAll<SecurityUser>('users');
    this._iocs            = await getAll<IOC>('iocs');
    this._auditRecords    = await getAll<AuditRecord>('audit_records');
    this._responseActions = await getAll<ResponseAction>('response_actions');
    this._events          = await getAll<SecurityEvent>('events');
    this._alerts          = await getAll<Alert>('alerts');
    this._threatHunts     = await getAll<ThreatHunt>('threat_hunts');
    this._cases           = await getAll<Case>('cases');
    this._caseNotes       = await getAll<CaseNote>('case_notes');
    this._caseTasks       = await getAll<CaseTask>('case_tasks');
    this._caseFindings    = await getAll<CaseFinding>('case_findings');
    this._evidence            = await getAll<Evidence>('evidence');
    this._evidenceAnnotations = await getAll<EvidenceAnnotation>('evidence_annotations');
    this._evidenceCustody     = await getAll<EvidenceCustodyEntry>('evidence_custody');
    this._threatIntel             = await getAll<ThreatIntelRecord>('threat_intel');
    this._threatIntelRelationships = await getAll<ThreatIntelRelationship>('threat_intel_relationships');
  }

  private async _seedThreatHunts(): Promise<void> {
    const defaultTemplates = BLACKTIDE_HUNT_TEMPLATES.slice(0, 3);
    const initialHunts: ThreatHunt[] = defaultTemplates.map((tpl, i) => {
      const exec = executeHuntQuery(this._events, tpl.query, this._alerts, this._incidents);
      return {
        id: `hunt-seed-00${i + 1}`,
        name: tpl.name,
        description: tpl.description,
        status: 'COMPLETED' as const,
        createdAt: new Date(Date.now() - 3600000 * (3 - i)).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * (3 - i)).toISOString(),
        createdBy: 'm.chen',
        query: tpl.query,
        resultCount: exec.totalMatches,
        matchedEventIds: exec.matchedEventIds,
        relatedAlertIds: exec.relatedAlertIds,
        relatedIncidentIds: exec.relatedIncidentIds,
        tags: [tpl.category, 'baseline', 'blacktide'],
        notes: `Baseline hunt initialized from template: ${tpl.name}. Hypothesis: ${tpl.hypothesis}`,
        lastExecutedAt: new Date().toISOString(),
      };
    });

    await putMany<ThreatHunt>('threat_hunts', initialHunts);
  }

  private async _seedCases(): Promise<void> {
    const baselineCase: Case = {
      id: 'case-blacktide-001',
      caseNumber: 'CASE-000001',
      title: 'Operation BlackTide — Enterprise Intrusion & C2 Campaign',
      description: 'Operational coordination container for APT intrusion targeting FINWS-027, PowerShell beaconing, privilege escalation, and lateral movement.',
      status: 'IN_PROGRESS',
      priority: 'CRITICAL',
      severity: 'CRITICAL',
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'analyst1',
      ownerId: 'analyst2',
      participantIds: ['analyst1', 'analyst2', 'responder', 'hunter'],
      incidentIds: ['incident-001'],
      huntIds: ['hunt-seed-001', 'hunt-seed-002'],
      alertIds: ['alert-seed-001', 'alert-seed-002'],
      eventIds: ['evt-001', 'evt-002', 'evt-003'],
      assetIds: ['asset-001', 'asset-002', 'asset-003'],
      userIds: ['user-001', 'user-002'],
      iocIds: ['ioc-001', 'ioc-002', 'ioc-003'],
      tags: ['apt', 'blacktide', 'powershell', 'c2', 'financial-sector'],
    };

    const baselineFinding: CaseFinding = {
      id: 'finding-blacktide-001',
      caseId: 'case-blacktide-001',
      title: 'Observed Encoded PowerShell Execution on FINWS-027',
      description: 'Base64 encoded payload executed via powershell.exe establishing outbound beaconing to malicious C2 198.51.100.45.',
      severity: 'CRITICAL',
      authorId: 'analyst2',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
      relatedEventIds: ['evt-001'],
      relatedAlertIds: ['alert-seed-001'],
      relatedIncidentIds: ['incident-001'],
      relatedHuntIds: ['hunt-seed-001'],
    };

    const baselineTasks: CaseTask[] = [
      {
        id: 'task-blacktide-001',
        caseId: 'case-blacktide-001',
        title: 'Isolate FINWS-027 Host Network Interface',
        description: 'Enforce immediate host network containment via EDR to halt outbound C2 beaconing.',
        status: 'DONE',
        priority: 'CRITICAL',
        assigneeId: 'responder',
        createdBy: 'analyst1',
        createdAt: new Date(Date.now() - 5400000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        completedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'task-blacktide-002',
        caseId: 'case-blacktide-001',
        title: 'Extract Memory Dump & Volatility Triage for FINWS-027',
        description: 'Acquire memory snapshot for injected thread analysis and credential harvesting remnants.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assigneeId: 'analyst2',
        createdBy: 'analyst1',
        createdAt: new Date(Date.now() - 5000000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'task-blacktide-003',
        caseId: 'case-blacktide-001',
        title: 'Execute Threat Hunt for Secondary Outbound Beacons',
        description: 'Run hunting query across perimeter firewall logs for communication to 198.51.100.0/24.',
        status: 'TODO',
        priority: 'HIGH',
        assigneeId: 'hunter',
        createdBy: 'analyst2',
        createdAt: new Date(Date.now() - 4000000).toISOString(),
        updatedAt: new Date(Date.now() - 4000000).toISOString(),
      },
    ];

    const baselineNote: CaseNote = {
      id: 'note-blacktide-001',
      caseId: 'case-blacktide-001',
      authorId: 'analyst2',
      authorName: 'Sam Okafor',
      createdAt: new Date(Date.now() - 3500000).toISOString(),
      updatedAt: new Date(Date.now() - 3500000).toISOString(),
      content: 'Initial triage complete. C2 connection verified against IOC database. Host isolated and forensic triage task assigned. Threat hunting team engaged for lateral movement sweep.',
    };

    await setMeta<number>(META_CASE_SEQUENCE, 1);
    await putMany<Case>('cases', [baselineCase]);
    await putMany<CaseFinding>('case_findings', [baselineFinding]);
    await putMany<CaseTask>('case_tasks', baselineTasks);
    await putMany<CaseNote>('case_notes', [baselineNote]);
  }

  private async _persistScenarioMeta(): Promise<void> {
    await setMeta<ScenarioMeta>(META_SCENARIO, {
      activeScenarioId:   this._activeScenarioId,
      activeScenarioStep: this._activeScenarioStep,
    });
  }

  // ─── Private: audit record builder ──────────────────────────────────────────

  private _buildAudit(record: Omit<AuditRecord, 'id' | 'timestamp'>): AuditRecord {
    return {
      ...record,
      id:        uid(),
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Private: Attack graph generator for custom incidents ───────────────────

  private _buildFallbackAttackGraph(incident: Incident): AttackGraph {
    const rootId = `node-root-${incident.id}`;
    const nodes: AttackGraphNode[] = [
      {
        id: rootId,
        label: incident.title,
        type: 'TECHNIQUE',
        severity: incident.severity,
        x: 0,
        y: 0,
        z: 0,
        data: { description: incident.summary ?? '' },
      },
    ];
    const edges: AttackGraphEdge[] = [];
    const attackPathNodeIds: string[] = [rootId];

    incident.affectedAssets.forEach((assetId, i) => {
      const asset = this._assets.find((a) => a.id === assetId);
      const nodeId = `node-asset-${assetId}`;
      nodes.push({
        id: nodeId,
        label: asset ? asset.name : assetId,
        type: 'ASSET',
        severity: asset?.status === 'COMPROMISED' ? 'CRITICAL' : 'HIGH',
        x: 120 * (i + 1),
        y: 50 * (i % 2 === 0 ? 1 : -1),
        z: 0,
        data: { assetId },
      });
      edges.push({
        id: `edge-${rootId}-${nodeId}`,
        source: rootId,
        target: nodeId,
        relation: 'TARGETS',
        label: 'TARGETS',
        isCriticalPath: true,
      });
      attackPathNodeIds.push(nodeId);
    });

    return {
      incidentId: incident.id,
      rootNodeId: rootId,
      nodes,
      edges,
      attackPathNodeIds,
    };
  }

  private async _seedEvidence(): Promise<void> {
    const now = new Date().toISOString();

    const baselineEvidence: Evidence[] = [
      {
        id: 'evd-blacktide-001',
        evidenceNumber: 'EVD-000001',
        caseId: 'case-blacktide-001',
        type: 'EVENT_REFERENCE',
        title: 'Encoded PowerShell Execution on FINWS-027',
        description: 'Sysmon telemetry Event ID 1 capturing powershell.exe executing base64-encoded stager with execution policy bypass.',
        sourceType: 'SECURITY_EVENT',
        sourceId: 'evt-raw-004',
        collectedAt: new Date(Date.now() - 5000000).toISOString(),
        collectedBy: 'analyst1',
        createdAt: new Date(Date.now() - 5000000).toISOString(),
        updatedAt: now,
        status: 'VALIDATED',
        integrity: {
          algorithm: 'SHA-256',
          hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          verified: true,
          verifiedAt: now,
          verifiedBy: 'analyst2',
        },
        metadata: {
          process: 'powershell.exe',
          ppid: 1420,
          commandLine: 'powershell.exe -NonI -W Hidden -Exec Bypass -Enc aW52b2tlLW1pbWlrYXR6...',
          hash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
        },
        tags: ['powershell', 'execution', 'blacktide', 'sysmon'],
        notes: 'Primary initial execution artifact for BlackTide campaign.',
        relatedEventIds: ['evt-raw-004'],
        relatedAlertIds: ['alert-seed-001'],
        relatedIncidentIds: ['incident-001'],
        relatedAssetIds: ['asset-001'],
      },
      {
        id: 'evd-blacktide-002',
        evidenceNumber: 'EVD-000002',
        caseId: 'case-blacktide-001',
        type: 'HUNT_REFERENCE',
        title: 'Threat Hunt Output: C2 Outbound Beaconing 198.51.100.45',
        description: 'Correlated network beaconing sweep isolating persistent HTTPS outbound sessions to adversary IP 198.51.100.45.',
        sourceType: 'THREAT_HUNT',
        sourceId: 'hunt-seed-001',
        collectedAt: new Date(Date.now() - 4000000).toISOString(),
        collectedBy: 'hunter',
        createdAt: new Date(Date.now() - 4000000).toISOString(),
        updatedAt: now,
        status: 'UNDER_REVIEW',
        integrity: {
          algorithm: 'SHA-256',
          hash: '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
          verified: true,
          verifiedAt: now,
          verifiedBy: 'hunter',
        },
        metadata: {
          queryName: 'C2 Outbound Beacons',
          targetIp: '198.51.100.45',
          matchCount: 5,
        },
        tags: ['c2', 'threat-hunt', 'beaconing', 'blacktide'],
        notes: 'Identified beaconing periodicity of 60s jittered by 15%.',
        relatedHuntIds: ['hunt-seed-001'],
        relatedIncidentIds: ['incident-001'],
        relatedIocIds: ['ioc-001'],
      },
      {
        id: 'evd-blacktide-003',
        evidenceNumber: 'EVD-000003',
        caseId: 'case-blacktide-001',
        type: 'TEXT_NOTE',
        title: 'Analyst Triage Memory Analysis Summary',
        description: 'Forensic volatile memory extraction notes confirming injected threads and socket handles prior to isolation.',
        sourceType: 'ANALYST',
        collectedAt: new Date(Date.now() - 3000000).toISOString(),
        collectedBy: 'analyst2',
        createdAt: new Date(Date.now() - 3000000).toISOString(),
        updatedAt: now,
        status: 'VALIDATED',
        textContent: 'Volatile memory triage of FINWS-027 verified injected thread in spoolsv.exe originating from powershell.exe (PID 4828). Outbound connection handles to 198.51.100.45:443 were active prior to network containment.',
        integrity: {
          algorithm: 'SHA-256',
          hash: 'd5a0c7760fa8ee8cb77148a3064c5d2e032599b50b5550c608f6583959828d0c',
          verified: true,
          verifiedAt: now,
          verifiedBy: 'analyst2',
        },
        metadata: {
          analyst: 'Sam Okafor',
          targetHost: 'FINWS-027',
          memorySnapshotSize: '16GB',
        },
        tags: ['memory-dump', 'injected-thread', 'forensics', 'triage'],
        notes: 'Snapshot taken immediately upon EDR containment alert.',
        relatedAssetIds: ['asset-001'],
      },
    ];

    const baselineCustody: EvidenceCustodyEntry[] = [
      {
        id: 'custody-seed-001',
        evidenceId: 'evd-blacktide-001',
        action: 'COLLECTED',
        actorId: 'analyst1',
        actorRole: 'L1_ANALYST',
        timestamp: new Date(Date.now() - 5000000).toISOString(),
        toStatus: 'COLLECTED',
        source: 'SECURITY_EVENT',
        reason: 'Collected from Sysmon Event Stream during initial triage',
      },
      {
        id: 'custody-seed-002',
        evidenceId: 'evd-blacktide-001',
        action: 'STATUS_CHANGED',
        actorId: 'analyst2',
        actorRole: 'L2_ANALYST',
        timestamp: new Date(Date.now() - 4500000).toISOString(),
        fromStatus: 'COLLECTED',
        toStatus: 'VALIDATED',
        reason: 'Verified execution telemetry against EDR timeline and commandline decoding',
      },
      {
        id: 'custody-seed-003',
        evidenceId: 'evd-blacktide-002',
        action: 'COLLECTED',
        actorId: 'hunter',
        actorRole: 'THREAT_HUNTER',
        timestamp: new Date(Date.now() - 4000000).toISOString(),
        toStatus: 'UNDER_REVIEW',
        source: 'THREAT_HUNT',
        reason: 'Aggregated hunt query results preserved into case repository',
      },
      {
        id: 'custody-seed-004',
        evidenceId: 'evd-blacktide-003',
        action: 'COLLECTED',
        actorId: 'analyst2',
        actorRole: 'L2_ANALYST',
        timestamp: new Date(Date.now() - 3000000).toISOString(),
        toStatus: 'VALIDATED',
        source: 'ANALYST',
        reason: 'Memory extraction and volatility analysis documentation',
      },
    ];

    const baselineAnnotations: EvidenceAnnotation[] = [
      {
        id: 'anno-seed-001',
        evidenceId: 'evd-blacktide-001',
        authorId: 'analyst2',
        authorName: 'Sam Okafor',
        createdAt: new Date(Date.now() - 4400000).toISOString(),
        updatedAt: new Date(Date.now() - 4400000).toISOString(),
        content: 'Correlated with Alert ALT-001 and verified parent process was cmd.exe spawned by scheduled task.',
      },
      {
        id: 'anno-seed-002',
        evidenceId: 'evd-blacktide-002',
        authorId: 'hunter',
        authorName: 'Morgan Vance',
        createdAt: new Date(Date.now() - 3800000).toISOString(),
        updatedAt: new Date(Date.now() - 3800000).toISOString(),
        content: 'Threat hunt verified that 3 additional hosts also exhibited DNS lookup queries for the C2 domain.',
      },
    ];

    await setMeta<number>(META_EVIDENCE_SEQUENCE, 3);
    await putMany<Evidence>('evidence', baselineEvidence);
    await putMany<EvidenceCustodyEntry>('evidence_custody', baselineCustody);
    await putMany<EvidenceAnnotation>('evidence_annotations', baselineAnnotations);

    // Link seeded evidence to the existing baseline finding
    const existingFindings = await getAll<CaseFinding>('case_findings');
    const blacktideFinding = existingFindings.find((f) => f.id === 'finding-blacktide-001');
    if (blacktideFinding) {
      blacktideFinding.relatedEvidenceIds = ['evd-blacktide-001', 'evd-blacktide-002'];
      await put<CaseFinding>('case_findings', blacktideFinding);
    }
  }

  private async _seedThreatIntel(): Promise<void> {
    const records: ThreatIntelRecord[] = [];
    const allRelationships: ThreatIntelRelationship[] = [];

    const iocsToSeed = this._iocs.length > 0 ? this._iocs : clone(SEED_IOCS);

    for (const ioc of iocsToSeed) {
      const { record, relationships } = ThreatIntelEngine.enrichLocally(
        ioc,
        undefined,
        this._events,
        this._alerts,
        this._incidents,
        this._threatHunts,
        this._cases,
        this._evidence,
        iocsToSeed
      );
      records.push(record);
      allRelationships.push(...relationships);
    }

    this._threatIntel = records;
    this._threatIntelRelationships = allRelationships;

    await putMany<ThreatIntelRecord>('threat_intel', records);
    await putMany<ThreatIntelRelationship>('threat_intel_relationships', allRelationships);
  }

  private async _seedDetectionRules(): Promise<void> {
    const rulesToSeed: DetectionRule[] = [];
    const versionsToSeed: DetectionRuleVersion[] = [];

    for (const seed of SEED_DETECTION_RULES) {
      const rule: DetectionRule = {
        ...clone(seed),
        ruleId: seed.id,
        version: 1,
        status: 'ENABLED',
        enabled: seed.enabled,
        author: seed.author || 'EXPLAIN-SEC Detection Engineering',
        authorId: 'EXPLAIN_SEC_ENG',
        versionStatus: 'ACTIVE',
        changeDescription: 'Initial baseline Operation BlackTide detection rule',
        publishedAt: seed.createdAt || '2024-11-01T00:00:00Z',
      };
      rulesToSeed.push(rule);

      versionsToSeed.push({
        id: `${rule.ruleId}-v1`,
        ruleId: rule.ruleId!,
        version: 1,
        rule: clone(rule),
        author: rule.author,
        authorId: rule.authorId,
        changeDescription: 'Initial baseline Operation BlackTide detection rule',
        publishedAt: rule.publishedAt!,
        createdAt: rule.createdAt,
      });
    }

    this._detectionRules = rulesToSeed;
    this._detectionRuleVersions = versionsToSeed;

    await putMany<DetectionRule>('detection_rules', rulesToSeed);
    await putMany<DetectionRuleVersion>('detection_rule_versions', versionsToSeed);
  }

  private async _seedPlaybooks(): Promise<void> {
    const playbooksToSeed: Playbook[] = clone(SEED_PLAYBOOKS);
    const versionsToSeed: PlaybookVersion[] = [];

    for (const pb of playbooksToSeed) {
      versionsToSeed.push({
        id: `${pb.playbookId || pb.id}:v1`,
        playbookId: pb.playbookId || pb.id,
        version: pb.version || 1,
        name: pb.name,
        description: pb.description,
        category: pb.category,
        steps: clone(pb.steps),
        triggerTypes: clone(pb.triggerTypes),
        supportedEntityTypes: clone(pb.supportedEntityTypes),
        author: pb.author,
        publishedAt: pb.publishedAt || pb.createdAt || Date.now(),
        changeDescription: 'Initial baseline Operation BlackTide response playbook',
      });
    }

    this._playbooks = playbooksToSeed;
    this._playbookVersions = versionsToSeed;

    await putMany<Playbook>('playbooks', playbooksToSeed);
    await putMany<PlaybookVersion>('playbook_versions', versionsToSeed);
  }

  // ─── Reusable Offline SOAR Methods ──────────────────────────────────────────

  async getPlaybooks(filter?: { category?: string; status?: string; enabled?: boolean }): Promise<Playbook[]> {
    let result = this._playbooks;
    if (filter?.category) {
      result = result.filter((p) => p.category === filter.category);
    }
    if (filter?.status) {
      result = result.filter((p) => p.status === filter.status);
    }
    if (filter?.enabled !== undefined) {
      result = result.filter((p) => p.enabled === filter.enabled);
    }
    return clone(result);
  }

  async getPlaybookById(id: string): Promise<Playbook | null> {
    const pb = this._playbooks.find((p) => p.id === id || p.playbookId === id);
    return pb ? clone(pb) : null;
  }

  async createPlaybook(playbook: Partial<Playbook>, actor: string, actorRole: RoleId): Promise<Playbook> {
    if (!canAuthorPlaybooks(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot author playbooks`);
    }

    const playbookId = `PB-${Date.now().toString(36).toUpperCase()}`;
    const newPlaybook: Playbook = {
      id: playbookId,
      playbookId,
      version: 1,
      name: playbook.name?.trim() || 'Untitled Playbook',
      description: playbook.description?.trim() || '',
      category: playbook.category || 'CONTAINMENT',
      status: 'DRAFT',
      enabled: false,
      triggerTypes: playbook.triggerTypes?.length ? playbook.triggerTypes : ['MANUAL'],
      triggerConditions: playbook.triggerConditions || {},
      supportedEntityTypes: playbook.supportedEntityTypes || ['INCIDENT'],
      steps: playbook.steps || [],
      approvalPolicy: playbook.approvalPolicy,
      tags: playbook.tags || [],
      author: actor,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._playbooks.push(newPlaybook);
    await put<Playbook>('playbooks', newPlaybook);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'PLAYBOOK_CREATED',
      target: newPlaybook.id,
      resultingState: 'DRAFT',
      authorization: 'PLAYBOOK_AUTHOR',
      outcome: 'SUCCESS',
      details: { name: newPlaybook.name, category: newPlaybook.category },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(newPlaybook);
  }

  async updatePlaybook(id: string, updates: Partial<Playbook>, actor: string, actorRole: RoleId): Promise<Playbook> {
    if (!canAuthorPlaybooks(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot edit playbooks`);
    }

    const pbIndex = this._playbooks.findIndex((p) => p.id === id || p.playbookId === id);
    if (pbIndex === -1) throw new Error(`Playbook "${id}" not found`);

    const existing = this._playbooks[pbIndex];

    // If already published and active, editing increments version and creates snapshot
    if (existing.status === 'PUBLISHED' || existing.status === 'ENABLED') {
      const newVersion = existing.version + 1;
      const updated: Playbook = {
        ...existing,
        ...updates,
        id: existing.id,
        playbookId: existing.playbookId,
        version: newVersion,
        status: 'DRAFT',
        enabled: false,
        updatedAt: new Date().toISOString(),
      };
      this._playbooks[pbIndex] = updated;
      await put<Playbook>('playbooks', updated);

      const auditEntry = this._buildAudit({
        actor,
        actorRole,
        action: 'PLAYBOOK_UPDATED',
        target: updated.id,
        resultingState: `v${newVersion} (DRAFT)`,
        authorization: 'PLAYBOOK_AUTHOR',
        outcome: 'SUCCESS',
        details: { version: newVersion },
      });
      this._auditRecords.push(auditEntry);
      await put<AuditRecord>('audit_records', auditEntry);

      return clone(updated);
    }

    const updated: Playbook = {
      ...existing,
      ...updates,
      id: existing.id,
      playbookId: existing.playbookId,
      version: existing.version,
      updatedAt: new Date().toISOString(),
    };
    this._playbooks[pbIndex] = updated;
    await put<Playbook>('playbooks', updated);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'PLAYBOOK_UPDATED',
      target: updated.id,
      resultingState: updated.status,
      authorization: 'PLAYBOOK_AUTHOR',
      outcome: 'SUCCESS',
      details: { version: updated.version, status: updated.status },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(updated);
  }

  async validatePlaybook(playbook: Partial<Playbook>): Promise<PlaybookValidationResult> {
    const result = validatePlaybookStructure(playbook);
    return result;
  }

  async publishPlaybook(id: string, actor: string, actorRole: RoleId, changeDescription?: string): Promise<Playbook> {
    if (!canManagePlaybooks(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot publish playbooks`);
    }

    const pb = this._playbooks.find((p) => p.id === id || p.playbookId === id);
    if (!pb) throw new Error(`Playbook "${id}" not found`);

    const validation = validatePlaybookStructure(pb);
    if (!validation.valid) {
      throw new Error(`Cannot publish playbook: validation failed with errors: ${validation.errors.join('; ')}`);
    }

    pb.status = 'PUBLISHED';
    pb.publishedAt = new Date().toISOString();
    pb.updatedAt = new Date().toISOString();

    const versionSnapshot: PlaybookVersion = {
      id: `${pb.playbookId || pb.id}:v${pb.version}`,
      playbookId: pb.playbookId || pb.id,
      version: pb.version,
      name: pb.name,
      description: pb.description,
      category: pb.category,
      steps: clone(pb.steps),
      triggerTypes: clone(pb.triggerTypes),
      supportedEntityTypes: clone(pb.supportedEntityTypes),
      author: actor,
      publishedAt: pb.publishedAt,
      changeDescription: changeDescription || `Version ${pb.version} published by ${actor}`,
    };

    this._playbookVersions.push(versionSnapshot);
    await put<Playbook>('playbooks', pb);
    await put<PlaybookVersion>('playbook_versions', versionSnapshot);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'PLAYBOOK_PUBLISHED',
      target: pb.id,
      resultingState: 'PUBLISHED',
      authorization: 'PLAYBOOK_MANAGE',
      outcome: 'SUCCESS',
      details: { version: pb.version, changeDescription },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(pb);
  }

  async enablePlaybook(id: string, actor: string, actorRole: RoleId): Promise<Playbook> {
    if (!canManagePlaybooks(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot enable playbooks`);
    }

    const pb = this._playbooks.find((p) => p.id === id || p.playbookId === id);
    if (!pb) throw new Error(`Playbook "${id}" not found`);

    if (pb.status !== 'PUBLISHED' && pb.status !== 'DISABLED') {
      const validation = validatePlaybookStructure(pb);
      if (!validation.valid) {
        throw new Error(`Cannot enable unvalidated playbook. Errors: ${validation.errors.join('; ')}`);
      }
    }

    pb.enabled = true;
    pb.status = 'ENABLED';
    pb.updatedAt = new Date().toISOString();

    await put<Playbook>('playbooks', pb);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'PLAYBOOK_ENABLED',
      target: pb.id,
      resultingState: 'ENABLED',
      authorization: 'PLAYBOOK_MANAGE',
      outcome: 'SUCCESS',
      details: { playbookId: pb.id, version: pb.version },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(pb);
  }

  async disablePlaybook(id: string, actor: string, actorRole: RoleId): Promise<Playbook> {
    if (!canManagePlaybooks(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot disable playbooks`);
    }

    const pb = this._playbooks.find((p) => p.id === id || p.playbookId === id);
    if (!pb) throw new Error(`Playbook "${id}" not found`);

    pb.enabled = false;
    pb.status = 'DISABLED';
    pb.updatedAt = new Date().toISOString();

    await put<Playbook>('playbooks', pb);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'PLAYBOOK_DISABLED',
      target: pb.id,
      resultingState: 'DISABLED',
      authorization: 'PLAYBOOK_MANAGE',
      outcome: 'SUCCESS',
      details: { playbookId: pb.id, version: pb.version },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(pb);
  }

  async deprecatePlaybook(id: string, actor: string, actorRole: RoleId): Promise<Playbook> {
    if (!canManagePlaybooks(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot deprecate playbooks`);
    }

    const pb = this._playbooks.find((p) => p.id === id || p.playbookId === id);
    if (!pb) throw new Error(`Playbook "${id}" not found`);

    pb.enabled = false;
    pb.status = 'DEPRECATED';
    pb.deprecatedAt = new Date().toISOString();
    pb.updatedAt = new Date().toISOString();

    await put<Playbook>('playbooks', pb);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'PLAYBOOK_DEPRECATED',
      target: pb.id,
      resultingState: 'DEPRECATED',
      authorization: 'PLAYBOOK_MANAGE',
      outcome: 'SUCCESS',
      details: { playbookId: pb.id, version: pb.version },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(pb);
  }

  async getPlaybookVersions(playbookId: string): Promise<PlaybookVersion[]> {
    const list = this._playbookVersions.filter((v) => v.playbookId === playbookId);
    return clone(list);
  }

  getActionCatalog(): ActionDefinition[] {
    return getAllActionDefinitions();
  }

  async createPlaybookExecution(
    playbookId: string,
    actor: string,
    actorRole: RoleId,
    options?: {
      incidentId?: string;
      alertId?: string;
      caseId?: string;
      targetEntity?: { id: string; type: any; label: string };
      isDryRun?: boolean;
    }
  ): Promise<PlaybookExecution> {
    if (!canExecutePlaybooks(actorRole) && !options?.isDryRun) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot execute playbooks`);
    }

    const pb = this._playbooks.find((p) => p.id === playbookId || p.playbookId === playbookId);
    if (!pb) throw new Error(`Playbook "${playbookId}" not found`);

    const execution = playbookExecutionEngine.createExecution(
      pb,
      'MANUAL',
      actor,
      actorRole,
      options
    );

    if (!options?.isDryRun) {
      this._playbookExecutions.push(execution);
      await put<PlaybookExecution>('playbook_executions', execution);

      const auditEntry = this._buildAudit({
        actor,
        actorRole,
        action: 'PLAYBOOK_EXECUTION_CREATED',
        target: execution.id,
        resultingState: 'QUEUED',
        authorization: 'PLAYBOOK_EXECUTE',
        outcome: 'SUCCESS',
        details: { playbookId: pb.id, playbookName: pb.name, incidentId: options?.incidentId },
      });
      this._auditRecords.push(auditEntry);
      await put<AuditRecord>('audit_records', auditEntry);
    }

    return clone(execution);
  }

  async getPlaybookExecution(executionId: string): Promise<PlaybookExecution | null> {
    const exec = this._playbookExecutions.find((e) => e.id === executionId);
    return exec ? clone(exec) : null;
  }

  async getPlaybookExecutions(filter?: { playbookId?: string; incidentId?: string; status?: string }): Promise<PlaybookExecution[]> {
    let list = this._playbookExecutions;
    if (filter?.playbookId) list = list.filter((e) => e.playbookId === filter.playbookId);
    if (filter?.incidentId) list = list.filter((e) => e.incidentId === filter.incidentId);
    if (filter?.status) list = list.filter((e) => e.status === filter.status);
    return clone(list);
  }

  async executePlaybookStep(
    executionId: string,
    stepId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<{ execution: PlaybookExecution; message: string }> {
    if (!canExecuteSOAR(actorRole) && !canExecutePlaybooks(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot execute SOAR steps`);
    }

    const execIndex = this._playbookExecutions.findIndex((e) => e.id === executionId);
    if (execIndex === -1) throw new Error(`Playbook execution "${executionId}" not found`);

    const execution = this._playbookExecutions[execIndex];

    const stores = {
      assets: this._assets,
      users: this._users,
      iocs: this._iocs,
      incidents: this._incidents,
      alerts: this._alerts,
      cases: this._cases,
      evidence: this._evidence,
      events: this._events,
      audit_records: this._auditRecords,
    };

    const { execution: updatedExec, message } = await playbookExecutionEngine.executeStep(
      execution,
      stepId,
      actor,
      actorRole,
      stores,
      async (approval) => {
        this._approvals.push(approval);
        await put<ApprovalRecord>('approvals', approval);
        const audit = this._buildAudit({
          actor,
          actorRole,
          action: 'PLAYBOOK_APPROVAL_REQUESTED',
          target: approval.id,
          resultingState: 'PENDING',
          authorization: 'PLAYBOOK_EXECUTE',
          outcome: 'SUCCESS',
          details: { executionId, stepId, actionType: approval.actionType, targetLabel: approval.targetLabel },
        });
        this._auditRecords.push(audit);
        await put<AuditRecord>('audit_records', audit);
      }
    );

    this._playbookExecutions[execIndex] = updatedExec;
    await put<PlaybookExecution>('playbook_executions', updatedExec);

    // Persist mutated entities
    await putMany<Asset>('assets', this._assets);
    await putMany<IOC>('iocs', this._iocs);
    await putMany<SecurityUser>('users', this._users);
    await putMany<Incident>('incidents', this._incidents);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: updatedExec.status === 'COMPLETED' ? 'PLAYBOOK_COMPLETED' : 'PLAYBOOK_STEP_COMPLETED',
      target: executionId,
      resultingState: updatedExec.status,
      authorization: 'PLAYBOOK_EXECUTE',
      outcome: 'SUCCESS',
      details: { stepId, message },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return { execution: clone(updatedExec), message };
  }

  async cancelPlaybookExecution(
    executionId: string,
    actor: string,
    actorRole: RoleId,
    reason?: string
  ): Promise<PlaybookExecution> {
    if (!canCancelPlaybooks(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot cancel playbook executions`);
    }

    const execIndex = this._playbookExecutions.findIndex((e) => e.id === executionId);
    if (execIndex === -1) throw new Error(`Execution "${executionId}" not found`);

    const execution = this._playbookExecutions[execIndex];
    execution.status = 'CANCELLED';
    execution.error = reason || 'Execution cancelled by operator';
    execution.completedAt = new Date().toISOString();

    await put<PlaybookExecution>('playbook_executions', execution);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'PLAYBOOK_CANCELLED',
      target: execution.id,
      resultingState: 'CANCELLED',
      authorization: 'PLAYBOOK_CANCEL',
      outcome: 'SUCCESS',
      details: { reason },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(execution);
  }

  async rollbackPlaybookExecution(
    executionId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<{ execution: PlaybookExecution; compensatedStepsCount: number }> {
    if (!canExecuteSOAR(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot rollback response executions`);
    }

    const execIndex = this._playbookExecutions.findIndex((e) => e.id === executionId);
    if (execIndex === -1) throw new Error(`Execution "${executionId}" not found`);

    const execution = this._playbookExecutions[execIndex];
    const stores = {
      assets: this._assets,
      users: this._users,
      iocs: this._iocs,
      incidents: this._incidents,
      alerts: this._alerts,
      cases: this._cases,
      evidence: this._evidence,
      events: this._events,
      audit_records: this._auditRecords,
    };

    const result = await playbookExecutionEngine.rollbackExecution(
      execution,
      actor,
      actorRole,
      stores
    );

    this._playbookExecutions[execIndex] = result.execution;
    await put<PlaybookExecution>('playbook_executions', result.execution);

    await putMany<Asset>('assets', this._assets);
    await putMany<IOC>('iocs', this._iocs);
    await putMany<SecurityUser>('users', this._users);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'PLAYBOOK_COMPENSATED',
      target: execution.id,
      resultingState: 'CANCELLED',
      authorization: 'PLAYBOOK_EXECUTE',
      outcome: 'SUCCESS',
      details: { compensatedStepsCount: result.compensatedStepsCount },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return { execution: clone(result.execution), compensatedStepsCount: result.compensatedStepsCount };
  }

  async getApprovals(executionId?: string): Promise<ApprovalRecord[]> {
    if (executionId) {
      return clone(this._approvals.filter((a) => a.executionId === executionId));
    }
    return clone(this._approvals);
  }

  async resolveApproval(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    actor: string,
    actorRole: RoleId,
    reason?: string
  ): Promise<ApprovalRecord> {
    if (!canApprovePlaybooks(actorRole) && !canApproveContainment(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot approve or reject response requests`);
    }

    const appIndex = this._approvals.findIndex((a) => a.id === approvalId);
    if (appIndex === -1) throw new Error(`Approval "${approvalId}" not found`);

    const approval = this._approvals[appIndex];
    approval.status = decision;
    if (decision === 'APPROVED') {
      approval.approvedBy = actor;
      approval.approvedByRole = actorRole;
      approval.approvedAt = new Date().toISOString();
    } else {
      approval.rejectedBy = actor;
      approval.rejectedByRole = actorRole;
      approval.rejectedAt = new Date().toISOString();
      approval.reason = reason;
    }

    await put<ApprovalRecord>('approvals', approval);

    // If corresponding execution exists, update the step state
    const execution = this._playbookExecutions.find((e) => e.id === approval.executionId);
    if (execution) {
      const step = execution.stepExecutions.find((s) => s.stepId === approval.stepId);
      if (step) {
        if (decision === 'APPROVED') {
          step.status = 'READY';
          if (execution.status === 'WAITING_APPROVAL') {
            execution.status = 'RUNNING';
          }
        } else {
          step.status = 'FAILED';
          step.error = reason || 'Approval rejected by leadership';
          execution.status = 'FAILED';
          execution.error = step.error;
        }
        await put<PlaybookExecution>('playbook_executions', execution);
      }
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: decision === 'APPROVED' ? 'PLAYBOOK_APPROVED' : 'PLAYBOOK_REJECTED',
      target: approval.id,
      resultingState: decision,
      authorization: 'PLAYBOOK_APPROVE',
      outcome: 'SUCCESS',
      details: { executionId: approval.executionId, actionType: approval.actionType, reason },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return clone(approval);
  }

  async dryRunPlaybook(playbookId: string, actor: string, targetOverride?: any): Promise<DryRunResult> {
    const pb = this._playbooks.find((p) => p.id === playbookId || p.playbookId === playbookId);
    if (!pb) throw new Error(`Playbook "${playbookId}" not found`);

    const stores = {
      assets: this._assets,
      users: this._users,
      iocs: this._iocs,
      incidents: this._incidents,
      alerts: this._alerts,
      cases: this._cases,
      evidence: this._evidence,
      events: this._events,
      audit_records: this._auditRecords,
    };

    return playbookExecutionEngine.dryRunPlaybook(pb, stores, actor, targetOverride);
  }

  // ─── SOC Metrics & Operational Analytics ───────────────────────────────────

  private _getCanonicalData(): CanonicalSocData {
    return {
      events: this._events,
      alerts: this._alerts,
      incidents: this._incidents,
      cases: this._cases,
      hunts: this._threatHunts,
      evidence: this._evidence,
      iocs: this._iocs,
      assets: this._assets,
      users: this._users,
      detectionRules: this._detectionRules,
      playbooks: this._playbooks,
      playbookExecutions: this._playbookExecutions,
      auditRecords: this._auditRecords,
    };
  }

  async getSocOperationalSnapshot(filter?: TimeWindowFilter): Promise<SocOperationalSnapshot> {
    return metricsEngine.computeOperationalSnapshot(this._getCanonicalData(), filter);
  }

  async getKpis(filter?: TimeWindowFilter): Promise<KpiResult[]> {
    const snap = await this.getSocOperationalSnapshot(filter);
    return [
      snap.mttd,
      snap.mtta,
      snap.alertMttr,
      snap.incidentMttr,
      snap.responseSuccessRate,
    ];
  }

  async getTimeSeries(
    metricId: 'EVENTS' | 'ALERTS' | 'INCIDENTS' | 'RESPONSE' | 'AUDIT',
    filter?: TimeWindowFilter,
    bucketCount?: number
  ): Promise<TimeSeriesBucket[]> {
    return metricsEngine.computeTimeSeries(this._getCanonicalData(), metricId, filter, bucketCount);
  }

  async getDistributions(
    category:
      | 'EVENTS_BY_SEVERITY'
      | 'EVENTS_BY_CATEGORY'
      | 'ALERTS_BY_SEVERITY'
      | 'ALERTS_BY_STATUS'
      | 'INCIDENTS_BY_SEVERITY'
      | 'INCIDENTS_BY_STATUS'
      | 'CASES_BY_STATUS'
      | 'PLAYBOOKS_BY_STATUS'
      | 'EVIDENCE_BY_STATUS',
    filter?: TimeWindowFilter
  ): Promise<DistributionBucket[]> {
    return metricsEngine.computeDistributions(this._getCanonicalData(), category, filter);
  }

  async getTopEntities(
    type: 'TOP_AFFECTED_ASSETS' | 'TOP_TARGETED_USERS' | 'TOP_TRIGGERED_RULES' | 'TOP_IOCS' | 'TOP_MITRE_TECHNIQUES',
    filter?: TimeWindowFilter,
    limit?: number
  ): Promise<TopEntityItem[]> {
    return metricsEngine.computeTopEntities(this._getCanonicalData(), type, filter, limit);
  }

  async getSocActivityTimeline(filter?: TimeWindowFilter, limit?: number): Promise<SocActivityTimelineItem[]> {
    return metricsEngine.computeActivityTimeline(this._getCanonicalData(), filter, limit);
  }

  async getMetricProvenance(metricId: string, filter?: TimeWindowFilter): Promise<MetricProvenance> {
    return metricsEngine.getMetricProvenance(metricId, filter, this._getCanonicalData());
  }

  // ─── Simulation Deletion Helpers ─────────────────────────────────────────────

  async deleteEventById(id: string): Promise<boolean> {
    const idx = this._events.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this._events.splice(idx, 1);
      await deleteRecord('events', id);
      return true;
    }
    return false;
  }

  async deleteAlertById(id: string): Promise<boolean> {
    const idx = this._alerts.findIndex((a) => a.id === id);
    if (idx !== -1) {
      this._alerts.splice(idx, 1);
      await deleteRecord('alerts', id);
      return true;
    }
    return false;
  }

  async deleteIncidentById(id: string): Promise<boolean> {
    const idx = this._incidents.findIndex((i) => i.id === id);
    if (idx !== -1) {
      this._incidents.splice(idx, 1);
      await deleteRecord('incidents', id);
      return true;
    }
    return false;
  }

  // ─── Attack Simulation & Cyber Range Engine (Step 12) ────────────────────────

  async getSimulationScenarios(): Promise<SimulationScenario[]> {
    return this._simulationEngine.getScenarios();
  }

  async getSimulationScenario(id: string): Promise<SimulationScenario | null> {
    return this._simulationEngine.getScenario(id);
  }

  async startSimulation(
    scenarioId: string,
    options: StartSimulationOptions = {},
    actor: string = 'analyst',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<SimulationRun> {
    if (actorRole && !canRunSimulation(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot run simulations`);
    }

    const run = await this._simulationEngine.startSimulation(scenarioId, options, actor, actorRole);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'SIMULATION_STARTED',
      target: run.id,
      resultingState: 'RUNNING',
      authorization: 'RUN_SIMULATION',
      outcome: 'SUCCESS',
      details: { scenarioId, seed: run.seed, speed: run.speed },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return run;
  }

  async pauseSimulation(
    runId: string,
    actor: string = 'analyst',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<SimulationRun> {
    if (actorRole && !canRunSimulation(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot pause simulations`);
    }

    const run = await this._simulationEngine.pauseSimulation(runId);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'SIMULATION_PAUSED',
      target: runId,
      resultingState: 'PAUSED',
      authorization: 'RUN_SIMULATION',
      outcome: 'SUCCESS',
      details: { runId },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return run;
  }

  async resumeSimulation(
    runId: string,
    actor: string = 'analyst',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<SimulationRun> {
    if (actorRole && !canRunSimulation(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot resume simulations`);
    }

    const run = await this._simulationEngine.resumeSimulation(runId);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'SIMULATION_RESUMED',
      target: runId,
      resultingState: 'RUNNING',
      authorization: 'RUN_SIMULATION',
      outcome: 'SUCCESS',
      details: { runId },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return run;
  }

  async stepSimulation(
    runId: string,
    actor: string = 'analyst',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<SimulationRun> {
    if (actorRole && !canRunSimulation(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot step simulations`);
    }

    return this._simulationEngine.stepSimulation(runId, actor, actorRole);
  }

  async cancelSimulation(
    runId: string,
    actor: string = 'analyst',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<SimulationRun> {
    if (actorRole && !canCancelSimulation(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot cancel simulations`);
    }

    const run = await this._simulationEngine.cancelSimulation(runId);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'SIMULATION_CANCELLED',
      target: runId,
      resultingState: 'CANCELLED',
      authorization: 'CANCEL_SIMULATION',
      outcome: 'SUCCESS',
      details: { runId },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return run;
  }

  async setSimulationSpeed(
    runId: string,
    speed: number,
    actor: string = 'analyst',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<SimulationRun> {
    if (actorRole && !canRunSimulation(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot modify simulation parameters`);
    }
    return this._simulationEngine.setSpeed(runId, speed as any);
  }

  async getSimulationRun(runId: string): Promise<SimulationRun | null> {
    return this._simulationEngine.getSimulationRun(runId);
  }

  async getSimulationRuns(): Promise<SimulationRun[]> {
    return this._simulationEngine.getSimulationRuns();
  }

  async getSimulationResult(runId: string): Promise<SimulationResult | null> {
    return this._simulationEngine.getSimulationResult(runId);
  }

  async cleanupSimulationData(
    runId: string,
    options: { keepResults?: boolean } = { keepResults: true },
    actor: string = 'analyst',
    actorRole: RoleId = 'SOC_MANAGER'
  ): Promise<{ deletedEvents: number; deletedAlerts: number; deletedIncidents: number }> {
    if (actorRole && !canDeleteSimulationData(actorRole)) {
      throw new Error(`Unauthorized: Role "${actorRole}" cannot delete simulation data`);
    }

    const res = await this._simulationEngine.cleanupSimulationData(runId, options);

    const auditEntry = this._buildAudit({
      actor,
      actorRole,
      action: 'SIMULATION_DATA_DELETED',
      target: runId,
      resultingState: 'CLEANED',
      authorization: 'DELETE_SIMULATION_DATA',
      outcome: 'SUCCESS',
      details: { runId, ...res },
    });
    this._auditRecords.push(auditEntry);
    await put<AuditRecord>('audit_records', auditEntry);

    return res;
  }

  // ─── AI Investigation Assistant (Step 13) ──────────────────────────────────

  async buildInvestigationContext(
    targetType: TargetEntityType,
    targetId: string,
    roleId?: RoleId,
    options?: ContextBuilderOptions
  ): Promise<InvestigationContext> {
    return this._aiProvider.buildContext(targetType, targetId, roleId, options);
  }

  async generateAiAnalysis(
    context: InvestigationContext,
    responseType?: AIResponseType,
    analystQuery?: string
  ): Promise<AIInvestigationResponse> {
    const response = await this._aiProvider.generateAnalysis(context, responseType, analystQuery);

    this._aiResponses.unshift(response);
    if (this._aiResponses.length > 50) this._aiResponses.pop();
    try {
      await put<AIInvestigationResponse>('ai_investigation_responses', response);
    } catch {
      // Non-fatal if IDB transaction busy
    }

    if (response.actionProposals?.length) {
      for (const p of response.actionProposals) {
        await this.createAiActionProposal(p);
      }
    }

    return response;
  }

  async getAiActionProposals(filter?: { contextId?: string; status?: AIActionProposalStatus }): Promise<AIActionProposal[]> {
    let list = clone(this._aiActionProposals);
    if (filter?.contextId) {
      list = list.filter((p) => p.contextId === filter.contextId);
    }
    if (filter?.status) {
      list = list.filter((p) => p.status === filter.status);
    }
    return list;
  }

  async createAiActionProposal(proposal: AIActionProposal): Promise<AIActionProposal> {
    const existingIdx = this._aiActionProposals.findIndex((p) => p.proposalId === proposal.proposalId);
    if (existingIdx >= 0) {
      return clone(this._aiActionProposals[existingIdx]);
    }

    this._aiActionProposals.unshift(clone(proposal));
    try {
      await put<AIActionProposal>('ai_action_proposals', proposal);
    } catch {
      // Non-fatal
    }
    return clone(proposal);
  }

  async acceptAiActionProposal(
    proposalId: string,
    actor: string = 'analyst',
    role: RoleId = 'L2_ANALYST'
  ): Promise<{ proposal: AIActionProposal; executionResult?: unknown }> {
    const proposal = this._aiActionProposals.find((p) => p.proposalId === proposalId);
    if (!proposal) {
      throw new Error(`AIActionProposal ${proposalId} not found`);
    }
    if (proposal.status !== 'PROPOSED') {
      throw new Error(`Cannot accept proposal in status '${proposal.status}' (must be 'PROPOSED')`);
    }

    if (role && !canProposeResponseAction(role)) {
      throw new Error(`Unauthorized: Role "${role}" cannot accept AI response proposals`);
    }

    proposal.status = 'ACCEPTED';
    proposal.reviewedBy = actor;
    proposal.reviewedAt = new Date().toISOString();

    let executionResult: unknown = undefined;

    if (proposal.actionType === 'CONTAIN_HOST') {
      const assetId = proposal.target.id;
      try {
        const action = await this.requestResponseAction({
          incidentId: 'incident-001',
          type: 'ISOLATE_ASSET',
          targetId: assetId,
          targetType: 'ASSET',
          targetLabel: `Host ${assetId}`,
          riskImpact: 'HIGH',
          reversibility: 'REVERSIBLE',
        }, actor);
        executionResult = action;
        proposal.executionId = action.id;
      } catch (err) {
        executionResult = { error: String(err) };
      }
    } else if (proposal.actionType === 'BLOCK_IOC') {
      const iocVal = proposal.target.id;
      try {
        const action = await this.requestResponseAction({
          incidentId: 'incident-001',
          type: 'BLOCK_IOC',
          targetId: iocVal,
          targetType: 'IOC',
          targetLabel: `IOC ${iocVal}`,
          riskImpact: 'MEDIUM',
          reversibility: 'REVERSIBLE',
        }, actor);
        executionResult = action;
        proposal.executionId = action.id;
      } catch (err) {
        executionResult = { error: String(err) };
      }
    } else if (proposal.actionType === 'EXECUTE_THREAT_HUNT') {
      try {
        const hunt = await this.createThreatHunt({
          name: `AI Guided Hunt: ${proposal.target.displayName || proposal.target.id}`,
          description: proposal.reason,
          query: {
            assetIds: proposal.target.type === 'ASSET' ? [proposal.target.id] : undefined,
            text: proposal.target.type === 'IOC' ? proposal.target.id : undefined,
          },
        }, actor, role);
        executionResult = hunt;
        proposal.executionId = hunt.id;
      } catch (err) {
        executionResult = { error: String(err) };
      }
    }

    try {
      await put<AIActionProposal>('ai_action_proposals', proposal);
    } catch {
      // Non-fatal
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole: role,
      action: 'AI_ACTION_ACCEPTED',
      target: proposalId,
      resultingState: 'ACCEPTED',
      authorization: 'PROPOSE_RESPONSE_ACTION',
      outcome: 'SUCCESS',
      details: {
        proposalId,
        actionType: proposal.actionType,
        target: proposal.target,
        executionId: proposal.executionId,
      },
    });
    this._auditRecords.push(auditEntry);
    try {
      await put<AuditRecord>('audit_records', auditEntry);
    } catch {
      // Non-fatal
    }

    return { proposal: clone(proposal), executionResult };
  }

  async rejectAiActionProposal(
    proposalId: string,
    actor: string = 'analyst',
    role: RoleId = 'L2_ANALYST',
    reason?: string
  ): Promise<AIActionProposal> {
    const proposal = this._aiActionProposals.find((p) => p.proposalId === proposalId);
    if (!proposal) {
      throw new Error(`AIActionProposal ${proposalId} not found`);
    }
    if (proposal.status !== 'PROPOSED') {
      throw new Error(`Cannot reject proposal in status '${proposal.status}' (must be 'PROPOSED')`);
    }

    if (role && !canProposeResponseAction(role)) {
      throw new Error(`Unauthorized: Role "${role}" cannot reject AI response proposals`);
    }

    proposal.status = 'REJECTED';
    proposal.reviewedBy = actor;
    proposal.reviewedAt = new Date().toISOString();
    proposal.rejectionReason = reason || 'Rejected by analyst';

    try {
      await put<AIActionProposal>('ai_action_proposals', proposal);
    } catch {
      // Non-fatal
    }

    const auditEntry = this._buildAudit({
      actor,
      actorRole: role,
      action: 'AI_ACTION_REJECTED',
      target: proposalId,
      resultingState: 'REJECTED',
      authorization: 'PROPOSE_RESPONSE_ACTION',
      outcome: 'SUCCESS',
      details: {
        proposalId,
        rejectionReason: proposal.rejectionReason,
      },
    });
    this._auditRecords.push(auditEntry);
    try {
      await put<AuditRecord>('audit_records', auditEntry);
    } catch {
      // Non-fatal
    }

    return clone(proposal);
  }

  // ─── External Integrations (Step 14) ────────────────────────────────────────

  getConnectivityState(): ConnectivityState {
    return {
      mode: 'OFFLINE',
      status: 'OFFLINE',
      activeProviderId: 'LOCAL_ONLY',
      isAirgapped: true,
      pendingChangesCount: 0,
      activeConflictsCount: 0,
      availableAdapters: ['LOCAL_PROVIDER'],
    };
  }

  async setConnectivityMode(mode: ConnectivityMode): Promise<ConnectivityState> {
    return this.getConnectivityState();
  }

  getSyncQueue(status?: SyncOperation['status']): SyncOperation[] {
    return [];
  }

  getSyncConflicts(unresolvedOnly = false): SyncConflict[] {
    return [];
  }

  async resolveSyncConflict(
    conflictId: string,
    resolution: 'LOCAL_WINS' | 'REMOTE_WINS',
    actor = 'analyst'
  ): Promise<SyncConflict> {
    throw new Error('No active sync conflicts in offline local provider.');
  }

  async ingestExternalEvent(
    rawEvent: Record<string, unknown>,
    sourceProvider: string
  ): Promise<IngestEventResult> {
    const norm = normalizeExternalEvent(rawEvent, sourceProvider);
    if (!norm.valid || !norm.event) {
      throw new Error(`External event normalization failed: ${norm.error || 'Invalid payload'}`);
    }
    return this.ingestEvent(norm.event);
  }

  async executeExternalAction(
    actionType: string,
    target: Record<string, unknown>,
    params?: Record<string, unknown>
  ): Promise<ExternalActionExecutionResult> {
    return {
      executionId: `local-exec-${Date.now()}`,
      adapterId: 'LOCAL_SIMULATED_ADAPTER',
      actionType,
      targetId: String(target.id || 'TARGET'),
      status: 'SUCCESS',
      executedAt: new Date().toISOString(),
      details: {
        actionType,
        simulated: true,
        note: 'Executed via local provider simulated response gate',
      },
    };
  }

  // ─── Step 15 Referential Integrity Audit ──────────────────────────────────

  async auditReferentialIntegrity(): Promise<ReferentialIntegrityReport> {
    const scenarios = await this._simulationEngine.getScenarios();
    const runs = await this.getSimulationRuns();
    return checkReferentialIntegrity({
      incidents: this._incidents,
      alerts: this._alerts,
      events: this._events,
      assets: this._assets,
      users: this._users,
      iocs: this._iocs,
      cases: this._cases,
      evidence: this._evidence,
      threatHunts: this._threatHunts,
      detectionRules: this._detectionRules,
      playbooks: this._playbooks,
      playbookExecutions: this._playbookExecutions,
      simulationScenarios: scenarios,
      simulationRuns: runs,
    });
  }
}



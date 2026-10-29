import type {
  Incident,
  IncidentDetail,
  IncidentStatus,
  IncidentQuery,
  CreateIncidentInput,
  AttackGraph,
  SystemRadarData,
  TimelineEvent,
  IocGraphData,
  MitreTechniqueCoverage,
  AuditRecord,
  ResponseAction,
  UserSession,
  UserCredentials,
  RoleDefinition,
  RoleId,
  IncidentEvidence,
  Evidence,
  Asset,
  SecurityUser,
  IOC,
  ScenarioDefinition,
  SecurityEvent,
  SecurityEventInput,
  SecurityEventQuery,
  SecurityEventStats,
  IngestEventResult,
  Alert,
  AlertQuery,
  AlertStats,
  DetectionRule,
  DetectionRuleVersion,
  CreateDetectionRuleInput,
  UpdateDetectionRuleInput,
  RuleValidationResult,
  TestRunOptions,
  DetectionTestRunResult,
  RuleDiffResult,
  ThreatHunt,
  ThreatHuntQuery,
  ThreatHuntExecutionResult,
  CreateThreatHuntInput,
  CreateIncidentFromHuntInput,
  ThreatHuntTemplate,
  Case,
  CaseNote,
  CaseTask,
  CaseFinding,
  CaseStatus,
  CasePriority,
  CreateCaseInput,
  UpdateCaseInput,
  CreateCaseNoteInput,
  UpdateCaseNoteInput,
  CreateCaseTaskInput,
  CreateCaseFindingInput,
  CaseQueryFilter,
  EvidenceStatus,
  EvidenceType,
  EvidenceSourceType,
  EvidenceCustodyEntry,
  EvidenceAnnotation,
  CreateEvidenceInput,
  UpdateEvidenceMetadataInput,
  CreateEvidenceAnnotationInput,
  EvidenceQueryFilter,
  ThreatIntelRecord,
  ThreatIntelRelationship,
  CreateThreatIntelInput,
  UpdateThreatIntelInput,
  ThreatIntelQueryFilter,
  IndicatorObservations,
  IocType,
  Playbook,
  PlaybookVersion,
  PlaybookExecution,
  ApprovalRecord,
  DryRunResult,
  PlaybookValidationResult,
  ActionDefinition,
  TimeWindowFilter,
  SocOperationalSnapshot,
  KpiResult,
  TimeSeriesBucket,
  DistributionBucket,
  TopEntityItem,
  SocActivityTimelineItem,
  MetricProvenance,
} from '../models';
import type {
  SimulationScenario,
  SimulationRun,
  SimulationResult,
  StartSimulationOptions,
} from '../models/simulation';
import type {
  InvestigationContext,
  AIInvestigationResponse,
  AIResponseType,
  TargetEntityType,
  AIActionProposal,
  AIActionProposalStatus,
} from '../models/ai';
import type { ContextBuilderOptions } from '../ai/investigation-context-builder';
import type {
  ConnectivityState,
  ConnectivityMode,
  SyncOperation,
  SyncConflict,
  ExternalActionExecutionResult,
} from '../models/integration';
import type { ReferentialIntegrityReport } from '../security/integrity-checker';

export interface ISecurityProvider {
  readonly id: string;
  readonly isOffline: boolean;

  // Lifecycle
  initialize(): Promise<void>;

  // Authentication & Session
  authenticate(credentials: UserCredentials): Promise<UserSession>;
  getCurrentSession(): UserSession | null;
  logout(): Promise<void>;
  getRoles(): RoleDefinition[];

  // Core Data Queries
  getIncidents(query?: IncidentQuery): Promise<Incident[]>;
  getIncidentById(id: string): Promise<IncidentDetail | null>;
  getAttackGraph(incidentId: string): Promise<AttackGraph | null>;
  getSystemRadar(incidentId: string): Promise<SystemRadarData | null>;
  getTimeline(incidentId: string): Promise<TimelineEvent[]>;
  getIocConstellation(incidentId: string): Promise<IocGraphData | null>;
  getMitreMatrix(): Promise<MitreTechniqueCoverage[]>;
  getAuditLogs(): Promise<AuditRecord[]>;
  getAssets(): Promise<Asset[]>;
  getUsers(): Promise<SecurityUser[]>;
  getIOCs(): Promise<IOC[]>;
  getResponseActions(incidentId?: string): Promise<ResponseAction[]>;

  // Security Event Engine
  getEvents(query?: SecurityEventQuery): Promise<SecurityEvent[]>;
  getEventById(id: string): Promise<SecurityEvent | null>;
  ingestEvent(event: SecurityEventInput, actor?: string, actorRole?: RoleId): Promise<IngestEventResult>;
  ingestEvents(events: SecurityEventInput[], actor?: string, actorRole?: RoleId): Promise<IngestEventResult[]>;
  getEventStats(): Promise<SecurityEventStats>;

  // Detection & Alert Engine
  getAlerts(query?: AlertQuery): Promise<Alert[]>;
  getAlertById(id: string): Promise<Alert | null>;
  getOpenAlerts(): Promise<Alert[]>;
  getAlertsForRule(ruleId: string): Promise<Alert[]>;
  getAlertsForEvent(eventId: string): Promise<Alert[]>;
  getAlertsForAsset(assetId: string): Promise<Alert[]>;
  getAlertsForIncident(incidentId: string): Promise<Alert[]>;
  getAlertStats(): Promise<AlertStats>;
  acknowledgeAlert(alertId: string, actor: string, actorRole: RoleId, notes?: string): Promise<Alert>;
  resolveAlert(alertId: string, actor: string, actorRole: RoleId, notes?: string): Promise<Alert>;
  getDetectionRules(): Promise<DetectionRule[]>;
  getDetectionRule(id: string): Promise<DetectionRule | null>;
  getDetectionRuleByRuleId(ruleId: string): Promise<DetectionRule | null>;
  getDetectionRuleVersions(ruleId: string): Promise<DetectionRuleVersion[]>;
  createDetectionRuleDraft(input: CreateDetectionRuleInput, actor: string, actorRole: RoleId): Promise<DetectionRule>;
  updateDetectionRuleDraft(id: string, patch: UpdateDetectionRuleInput, actor: string, actorRole: RoleId): Promise<DetectionRule>;
  validateDetectionRule(idOrRule: string | DetectionRule): Promise<RuleValidationResult>;
  testDetectionRule(ruleIdOrRule: string | DetectionRule, options?: TestRunOptions, actor?: string, actorRole?: RoleId): Promise<DetectionTestRunResult>;
  publishDetectionRule(id: string, changeDescription: string, actor: string, actorRole: RoleId): Promise<DetectionRule>;
  enableDetectionRule(id: string, actor: string, actorRole: RoleId): Promise<DetectionRule>;
  disableDetectionRule(id: string, actor: string, actorRole: RoleId): Promise<DetectionRule>;
  deprecateDetectionRule(id: string, actor: string, actorRole: RoleId): Promise<DetectionRule>;
  diffRuleVersions(ruleId: string, v1: number, v2: number): Promise<RuleDiffResult>;

  // Correlation & Incident Creation Engine
  runCorrelation(): Promise<{ correlatedCount: number; newIncidentCount: number; updatedIncidentCount: number }>;
  attachAlertToIncident(incidentId: string, alertId: string, actor?: string, actorRole?: RoleId): Promise<Incident>;
  attachEventToIncident(incidentId: string, eventId: string, actor?: string, actorRole?: RoleId): Promise<Incident>;

  // Incident Lifecycle & Creation
  createIncident(
    input: CreateIncidentInput,
    actor: string,
    actorRole: RoleId
  ): Promise<Incident>;
  updateIncidentStatus(
    incidentId: string,
    status: IncidentStatus,
    actor: string,
    actorRole: RoleId,
    reason?: string
  ): Promise<Incident>;
  escalateIncident(
    incidentId: string,
    toRole: RoleId,
    reason: string,
    actor: string,
    actorRole: RoleId
  ): Promise<Incident>;
  addEvidence(
    incidentId: string,
    evidence: Omit<IncidentEvidence, 'id' | 'collectedAt'>,
    actor: string
  ): Promise<IncidentEvidence>;

  // Threat Hunting Engine
  runThreatHunt(query: ThreatHuntQuery): Promise<ThreatHuntExecutionResult>;
  getThreatHunts(): Promise<ThreatHunt[]>;
  getThreatHuntById(id: string): Promise<ThreatHunt | null>;
  createThreatHunt(input: CreateThreatHuntInput, actor: string, actorRole: RoleId): Promise<ThreatHunt>;
  updateThreatHunt(id: string, updates: Partial<ThreatHunt>, actor: string, actorRole: RoleId): Promise<ThreatHunt>;
  archiveThreatHunt(id: string, actor: string, actorRole: RoleId): Promise<ThreatHunt>;
  linkHuntEventsToIncident(incidentId: string, eventIds: string[], actor: string, actorRole: RoleId): Promise<Incident>;
  createIncidentFromHunt(input: CreateIncidentFromHuntInput, actor: string, actorRole: RoleId): Promise<Incident>;
  getThreatHuntTemplates(): ThreatHuntTemplate[];

  // Case Management
  getCases(filter?: CaseQueryFilter): Promise<Case[]>;
  getCaseById(id: string): Promise<Case | null>;
  createCase(input: CreateCaseInput, actor: string, actorRole: RoleId): Promise<Case>;
  updateCase(id: string, patch: UpdateCaseInput, actor: string, actorRole: RoleId): Promise<Case>;
  getCaseNotes(caseId: string): Promise<CaseNote[]>;
  addCaseNote(caseId: string, input: CreateCaseNoteInput, actor: string, actorRole: RoleId): Promise<CaseNote>;
  updateCaseNote(caseId: string, noteId: string, input: UpdateCaseNoteInput, actor: string, actorRole: RoleId): Promise<CaseNote>;
  getCaseTasks(caseId: string): Promise<CaseTask[]>;
  addCaseTask(caseId: string, input: CreateCaseTaskInput, actor: string, actorRole: RoleId): Promise<CaseTask>;
  updateCaseTask(caseId: string, taskId: string, patch: Partial<CaseTask>, actor: string, actorRole: RoleId): Promise<CaseTask>;
  getCaseFindings(caseId: string): Promise<CaseFinding[]>;
  addCaseFinding(caseId: string, input: CreateCaseFindingInput, actor: string, actorRole: RoleId): Promise<CaseFinding>;
  updateCaseFinding(caseId: string, findingId: string, patch: Partial<CaseFinding>, actor: string, actorRole: RoleId): Promise<CaseFinding>;
  linkIncidentToCase(caseId: string, incidentId: string, actor: string, actorRole: RoleId): Promise<Case>;
  unlinkIncidentFromCase(caseId: string, incidentId: string, actor: string, actorRole: RoleId): Promise<Case>;
  linkHuntToCase(caseId: string, huntId: string, actor: string, actorRole: RoleId): Promise<Case>;
  unlinkHuntFromCase(caseId: string, huntId: string, actor: string, actorRole: RoleId): Promise<Case>;
  closeCase(id: string, closureReason: string, actor: string, actorRole: RoleId): Promise<Case>;
  reopenCase(id: string, reason: string | undefined, actor: string, actorRole: RoleId): Promise<Case>;

  // Evidence Management
  getEvidence(filter?: EvidenceQueryFilter): Promise<Evidence[]>;
  getEvidenceById(id: string): Promise<Evidence | null>;
  createEvidence(input: CreateEvidenceInput, actor: string, actorRole: RoleId): Promise<Evidence>;
  updateEvidenceMetadata(id: string, patch: UpdateEvidenceMetadataInput, actor: string, actorRole: RoleId): Promise<Evidence>;
  updateEvidenceStatus(id: string, status: EvidenceStatus, reason: string | undefined, actor: string, actorRole: RoleId): Promise<Evidence>;
  archiveEvidence(id: string, reason: string | undefined, actor: string, actorRole: RoleId): Promise<Evidence>;
  verifyEvidenceIntegrity(id: string, actor: string, actorRole: RoleId): Promise<{ verified: boolean; storedHash?: string; computedHash?: string; message: string }>;
  getEvidenceCustody(evidenceId: string): Promise<EvidenceCustodyEntry[]>;
  getEvidenceAnnotations(evidenceId: string): Promise<EvidenceAnnotation[]>;
  addEvidenceAnnotation(evidenceId: string, input: CreateEvidenceAnnotationInput, actor: string, actorRole: RoleId): Promise<EvidenceAnnotation>;
  collectEventAsEvidence(caseId: string, eventId: string, input: Partial<CreateEvidenceInput>, actor: string, actorRole: RoleId): Promise<Evidence>;
  collectAlertAsEvidence(caseId: string, alertId: string, input: Partial<CreateEvidenceInput>, actor: string, actorRole: RoleId): Promise<Evidence>;
  collectIncidentAsEvidence(caseId: string, incidentId: string, input: Partial<CreateEvidenceInput>, actor: string, actorRole: RoleId): Promise<Evidence>;
  collectHuntAsEvidence(caseId: string, huntId: string, input: Partial<CreateEvidenceInput>, actor: string, actorRole: RoleId): Promise<Evidence>;
  getEvidenceBlob(storageReference: string): Promise<ArrayBuffer | null>;

  // Response Actions & Reusable SOAR Platform
  requestResponseAction(
    action: Omit<ResponseAction, 'id' | 'status' | 'requestedAt' | 'requestedBy'>,
    actor: string
  ): Promise<ResponseAction>;
  approveResponseAction(actionId: string, approver: string): Promise<ResponseAction>;
  rejectResponseAction(actionId: string, rejector: string, reason: string): Promise<ResponseAction>;
  cancelResponseAction(actionId: string, canceller: string, reason: string): Promise<ResponseAction>;
  executeResponseAction(actionId: string, actor: string, actorRole: RoleId): Promise<ResponseAction>;
  rollbackResponseAction(actionId: string, actor: string, actorRole: RoleId): Promise<ResponseAction>;
  dryRunResponseAction(
    actionId: string,
    actor: string,
    actorRole: RoleId
  ): Promise<{ action: ResponseAction; wouldModify: boolean; expectedStateChange: string }>;

  // SOAR Playbook Management
  getPlaybooks(filter?: { category?: string; status?: string; enabled?: boolean }): Promise<Playbook[]>;
  getPlaybookById(id: string): Promise<Playbook | null>;
  createPlaybook(playbook: Partial<Playbook>, actor: string, actorRole: RoleId): Promise<Playbook>;
  updatePlaybook(id: string, updates: Partial<Playbook>, actor: string, actorRole: RoleId): Promise<Playbook>;
  validatePlaybook(playbook: Partial<Playbook>): Promise<PlaybookValidationResult>;
  publishPlaybook(id: string, actor: string, actorRole: RoleId, changeDescription?: string): Promise<Playbook>;
  enablePlaybook(id: string, actor: string, actorRole: RoleId): Promise<Playbook>;
  disablePlaybook(id: string, actor: string, actorRole: RoleId): Promise<Playbook>;
  deprecatePlaybook(id: string, actor: string, actorRole: RoleId): Promise<Playbook>;
  getPlaybookVersions(playbookId: string): Promise<PlaybookVersion[]>;
  getActionCatalog(): ActionDefinition[];

  // SOAR Playbook Execution
  createPlaybookExecution(
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
  ): Promise<PlaybookExecution>;
  getPlaybookExecution(executionId: string): Promise<PlaybookExecution | null>;
  getPlaybookExecutions(filter?: { playbookId?: string; incidentId?: string; status?: string }): Promise<PlaybookExecution[]>;
  executePlaybookStep(executionId: string, stepId: string, actor: string, actorRole: RoleId): Promise<{ execution: PlaybookExecution; message: string }>;
  cancelPlaybookExecution(executionId: string, actor: string, actorRole: RoleId, reason?: string): Promise<PlaybookExecution>;
  rollbackPlaybookExecution(executionId: string, actor: string, actorRole: RoleId): Promise<{ execution: PlaybookExecution; compensatedStepsCount: number }>;

  // Approvals & Dry-Run
  getApprovals(executionId?: string): Promise<ApprovalRecord[]>;
  resolveApproval(approvalId: string, decision: 'APPROVED' | 'REJECTED', actor: string, actorRole: RoleId, reason?: string): Promise<ApprovalRecord>;
  dryRunPlaybook(playbookId: string, actor: string, targetOverride?: any): Promise<DryRunResult>;

  // Threat Intelligence Engine
  getThreatIntel(indicatorId: string): Promise<ThreatIntelRecord | null>;
  getThreatIntelByIndicator(indicatorType: IocType, value: string): Promise<ThreatIntelRecord | null>;
  getThreatIntelRecords(filters?: ThreatIntelQueryFilter): Promise<ThreatIntelRecord[]>;
  createThreatIntelRecord(input: CreateThreatIntelInput, actor: string, actorRole: RoleId): Promise<ThreatIntelRecord>;
  updateThreatIntelRecord(id: string, patch: UpdateThreatIntelInput, actor: string, actorRole: RoleId): Promise<ThreatIntelRecord>;
  getThreatIntelRelationships(indicatorId: string): Promise<ThreatIntelRelationship[]>;
  getRelatedIndicators(indicatorId: string): Promise<IOC[]>;
  getIndicatorObservations(indicatorId: string): Promise<IndicatorObservations | null>;
  enrichIndicatorLocally(indicatorId: string, actor: string, actorRole: RoleId): Promise<{ record: ThreatIntelRecord; relationships: ThreatIntelRelationship[] }>;

  // Offline Scenario Engine
  getAvailableScenarios(): Promise<ScenarioDefinition[]>;
  loadScenario(scenarioId: string): Promise<Incident>;
  stepScenario(stepIndex: number): Promise<TimelineEvent | null>;
  resetScenario(): Promise<void>;

  // SOC Metrics & Operational Analytics
  getSocOperationalSnapshot(filter?: TimeWindowFilter): Promise<SocOperationalSnapshot>;
  getKpis(filter?: TimeWindowFilter): Promise<KpiResult[]>;
  getTimeSeries(
    metricId: 'EVENTS' | 'ALERTS' | 'INCIDENTS' | 'RESPONSE' | 'AUDIT',
    filter?: TimeWindowFilter,
    bucketCount?: number
  ): Promise<TimeSeriesBucket[]>;
  getDistributions(
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
  ): Promise<DistributionBucket[]>;
  getTopEntities(
    type: 'TOP_AFFECTED_ASSETS' | 'TOP_TARGETED_USERS' | 'TOP_TRIGGERED_RULES' | 'TOP_IOCS' | 'TOP_MITRE_TECHNIQUES',
    filter?: TimeWindowFilter,
    limit?: number
  ): Promise<TopEntityItem[]>;
  getSocActivityTimeline(filter?: TimeWindowFilter, limit?: number): Promise<SocActivityTimelineItem[]>;
  getMetricProvenance(metricId: string, filter?: TimeWindowFilter): Promise<MetricProvenance>;

  // Attack Simulation & Cyber Range Engine (Step 12)
  getSimulationScenarios(): Promise<SimulationScenario[]>;
  getSimulationScenario(id: string): Promise<SimulationScenario | null>;
  startSimulation(scenarioId: string, options?: StartSimulationOptions, actor?: string, actorRole?: RoleId): Promise<SimulationRun>;
  pauseSimulation(runId: string, actor?: string, actorRole?: RoleId): Promise<SimulationRun>;
  resumeSimulation(runId: string, actor?: string, actorRole?: RoleId): Promise<SimulationRun>;
  stepSimulation(runId: string, actor?: string, actorRole?: RoleId): Promise<SimulationRun>;
  cancelSimulation(runId: string, actor?: string, actorRole?: RoleId): Promise<SimulationRun>;
  setSimulationSpeed(runId: string, speed: number, actor?: string, actorRole?: RoleId): Promise<SimulationRun>;
  getSimulationRun(runId: string): Promise<SimulationRun | null>;
  getSimulationRuns(): Promise<SimulationRun[]>;
  getSimulationResult(runId: string): Promise<SimulationResult | null>;
  cleanupSimulationData(runId: string, options?: { keepResults?: boolean }, actor?: string, actorRole?: RoleId): Promise<{ deletedEvents: number; deletedAlerts: number; deletedIncidents: number }>;

  // AI Investigation Assistant (Step 13)
  buildInvestigationContext(targetType: TargetEntityType, targetId: string, roleId?: RoleId, options?: ContextBuilderOptions): Promise<InvestigationContext>;
  generateAiAnalysis(context: InvestigationContext, responseType?: AIResponseType, analystQuery?: string): Promise<AIInvestigationResponse>;
  getAiActionProposals(filter?: { contextId?: string; status?: AIActionProposalStatus }): Promise<AIActionProposal[]>;
  createAiActionProposal(proposal: AIActionProposal): Promise<AIActionProposal>;
  acceptAiActionProposal(proposalId: string, actor: string, role?: RoleId): Promise<{ proposal: AIActionProposal; executionResult?: unknown }>;
  rejectAiActionProposal(proposalId: string, actor: string, role?: RoleId, reason?: string): Promise<AIActionProposal>;

  // External & Cloud Integrations (Step 14)
  getConnectivityState?(): ConnectivityState;
  setConnectivityMode?(mode: ConnectivityMode, remoteProvider?: any): Promise<ConnectivityState>;
  getSyncQueue?(status?: SyncOperation['status']): Promise<SyncOperation[]> | SyncOperation[];
  getSyncConflicts?(unresolvedOnly?: boolean): Promise<SyncConflict[]> | SyncConflict[];
  resolveSyncConflict?(conflictId: string, resolution: 'LOCAL_WINS' | 'REMOTE_WINS', actor?: string): Promise<SyncConflict>;
  ingestExternalEvent?(rawEvent: Record<string, unknown>, sourceProvider: string): Promise<IngestEventResult>;
  executeExternalAction?(actionType: string, target: Record<string, unknown>, params?: Record<string, unknown>): Promise<ExternalActionExecutionResult>;

  // System Validation & Hardening (Step 15)
  auditReferentialIntegrity?(): Promise<ReferentialIntegrityReport>;
}



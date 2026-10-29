/**
 * SecurityService — Application-level facade over ISecurityProvider.
 *
 * Rules:
 * - This is the ONLY object UI components should interact with for security data.
 * - Spatial components MUST NOT import LocalProvider or any concrete provider directly.
 * - State subscribers are notified via lightweight EventEmitter (no React inside).
 * - All methods are async and provider-agnostic.
 */

import type { ISecurityProvider } from './providers/provider-interface';
import type {
  Incident,
  IncidentDetail,
  IncidentStatus,
  IncidentQuery,
  CreateIncidentInput,
  TimelineEvent,
  IncidentEvidence,
} from './models/incident';
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
} from './models/evidence';
import type { AttackGraph } from './models/attack-graph';
import type { SystemRadarData, IocGraphData, ScenarioDefinition } from './models/spatial-structures';
import type { MitreTechniqueCoverage } from './models/mitre';
import type { AuditRecord } from './models/audit';
import type { ResponseAction } from './models/response';
import type { UserSession, UserCredentials, RoleDefinition, RoleId } from './models/auth';
import type { Asset, SecurityUser, IOC } from './models/entity';
import type {
  SecurityEvent,
  SecurityEventInput,
  SecurityEventQuery,
  SecurityEventStats,
  IngestEventResult,
} from './models/event';
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
  DetectionTestRunResult,
  RuleDiffResult,
} from './models/detection';
import type {
  ThreatHunt,
  ThreatHuntQuery,
  ThreatHuntExecutionResult,
  CreateThreatHuntInput,
  CreateIncidentFromHuntInput,
  ThreatHuntTemplate,
} from './models/hunting';
import type {
  Case,
  CaseNote,
  CaseTask,
  CaseFinding,
  CaseStatus,
  CasePriority,
  CaseSeverity,
  CreateCaseInput,
  UpdateCaseInput,
  CreateCaseNoteInput,
  UpdateCaseNoteInput,
  CreateCaseTaskInput,
  CreateCaseFindingInput,
  CaseQueryFilter,
} from './models/case';
import { isValidCaseStatusTransition } from './models/case';
import type {
  ThreatIntelRecord,
  ThreatIntelRelationship,
  CreateThreatIntelInput,
  UpdateThreatIntelInput,
  ThreatIntelQueryFilter,
  IndicatorObservations,
} from './models/threat-intel';
import type { IocType } from './models/entity';
import type {
  Playbook,
  PlaybookVersion,
  PlaybookExecution,
  ApprovalRecord,
  ResponsePolicy,
  DryRunResult,
  PlaybookValidationResult,
  ActionDefinition,
} from './models/response';
import type {
  TimeWindowFilter,
  SocOperationalSnapshot,
  KpiResult,
  TimeSeriesBucket,
  DistributionBucket,
  TopEntityItem,
  SocActivityTimelineItem,
  MetricProvenance,
} from './models/metrics';
import { canViewSocMetrics, canViewOperationalData } from './auth/rbac';
import {
  canViewSimulations,
  canRunSimulation,
  canCancelSimulation,
  canDeleteSimulationData,
  canViewSimulationResults,
  canViewAiAssistant,
  canGenerateAiAnalysis,
  canProposeResponseAction,
  canViewIntegrations,
  canManageIntegrations,
  canSyncData,
  canViewSyncStatus,
  canResolveSyncConflict,
  canUseExternalResponse,
  canUseExternalEnrichment,
} from './auth/rbac';
import type {
  SimulationScenario,
  SimulationRun,
  SimulationResult,
  StartSimulationOptions,
} from './models/simulation';
import type {
  InvestigationContext,
  AIInvestigationResponse,
  AIResponseType,
  TargetEntityType,
  AIActionProposal,
  AIActionProposalStatus,
} from './models/ai';
import type { ContextBuilderOptions } from './ai/investigation-context-builder';
import type {
  ConnectivityMode,
  ConnectivityState,
  SyncOperation,
  SyncConflict,
  ExternalActionExecutionResult,
} from './models/integration';
import type { ReferentialIntegrityReport } from './security/integrity-checker';
import { metricsEngine } from './metrics/metrics-engine';
import { wazuhService } from './wazuh';

// ─── Subscriber types ─────────────────────────────────────────────────────────

export type SecurityEventType =
  | 'SESSION_CHANGED'
  | 'INCIDENTS_UPDATED'
  | 'INCIDENT_CREATED'
  | 'INCIDENT_UPDATED'
  | 'CORRELATION_COMPLETED'
  | 'INCIDENT_DETAIL_UPDATED'
  | 'RESPONSE_ACTION_UPDATED'
  | 'AUDIT_APPENDED'
  | 'EVENT_INGESTED'
  | 'ALERT_CREATED'
  | 'ALERT_UPDATED'
  | 'THREAT_HUNT_CREATED'
  | 'THREAT_HUNT_UPDATED'
  | 'THREAT_HUNT_EXECUTED'
  | 'CASES_UPDATED'
  | 'CASE_CREATED'
  | 'CASE_UPDATED'
  | 'CASE_CLOSED'
  | 'EVIDENCE_UPDATED'
  | 'EVIDENCE_COLLECTED'
  | 'EVIDENCE_VERIFIED'
  | 'THREAT_INTEL_CREATED'
  | 'THREAT_INTEL_UPDATED'
  | 'THREAT_INTEL_ENRICHED'
  | 'DETECTION_RULES_UPDATED'
  | 'DETECTION_RULE_CREATED'
  | 'DETECTION_RULE_UPDATED'
  | 'DETECTION_RULE_TESTED'
  | 'DETECTION_RULE_PUBLISHED'
  | 'PLAYBOOKS_UPDATED'
  | 'PLAYBOOK_CREATED'
  | 'PLAYBOOK_UPDATED'
  | 'PLAYBOOK_EXECUTION_CREATED'
  | 'PLAYBOOK_EXECUTION_UPDATED'
  | 'PLAYBOOK_APPROVAL_UPDATED'
  | 'METRICS_UPDATED'
  | 'SIMULATION_STARTED'
  | 'SIMULATION_UPDATED'
  | 'SIMULATION_COMPLETED'
  | 'AI_ANALYSIS_GENERATED'
  | 'AI_ACTION_PROPOSED'
  | 'AI_ACTION_UPDATED'
  | 'CONNECTIVITY_CHANGED'
  | 'SYNC_STARTED'
  | 'SYNC_COMPLETED'
  | 'SYNC_CONFLICT_DETECTED'
  | 'INTEGRATION_CONFIG_UPDATED';

type Listener = () => void;
type EventListener = (event: SecurityEvent) => void;
type AlertListener = (alert: Alert) => void;

// ─── SecurityService ─────────────────────────────────────────────────────────

export class SecurityService {
  private _provider: ISecurityProvider | null = null;
  private _initialized = false;
  private _listeners: Map<SecurityEventType, Set<Listener>> = new Map();
  private _eventListeners: Set<EventListener> = new Set();
  private _alertListeners: Set<AlertListener> = new Set();

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  async bootstrap(provider: ISecurityProvider): Promise<void> {
    if (this._initialized) return;
    this._provider = provider;
    await provider.initialize();
    this._initialized = true;
  }

  isInitialized(): boolean {
    return this._initialized;
  }

  get isReady(): boolean {
    return this._initialized;
  }

  // ─── Event Subscription ─────────────────────────────────────────────────────

  subscribe(event: SecurityEventType, listener: Listener): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(listener);
    return () => {
      this._listeners.get(event)?.delete(listener);
    };
  }

  on(event: SecurityEventType, listener: Listener): () => void {
    return this.subscribe(event, listener);
  }

  subscribeToEvents(listener: EventListener): () => void {
    this._eventListeners.add(listener);
    return () => {
      this._eventListeners.delete(listener);
    };
  }

  private _emit(event: SecurityEventType): void {
    if (event !== 'METRICS_UPDATED' && event !== 'SESSION_CHANGED') {
      metricsEngine.invalidateCache();
    }
    const set = this._listeners.get(event);
    if (set) {
      set.forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.error(`[SecurityService] Listener error on event "${event}":`, err);
        }
      });
    }
    if (event !== 'METRICS_UPDATED' && event !== 'SESSION_CHANGED') {
      const metricsListeners = this._listeners.get('METRICS_UPDATED');
      if (metricsListeners) {
        metricsListeners.forEach((fn) => {
          try {
            fn();
          } catch (err) {
            console.error('[SecurityService] Listener error on event "METRICS_UPDATED":', err);
          }
        });
      }
    }
  }

  // ─── Authentication & Session ───────────────────────────────────────────────

  async login(credentials: UserCredentials): Promise<UserSession> {
    const session = await this._requireProvider().authenticate(credentials);
    this._emit('SESSION_CHANGED');
    return session;
  }

  getSession(): UserSession | null {
    return this._provider?.getCurrentSession() ?? null;
  }

  async logout(): Promise<void> {
    await this._requireProvider().logout();
    this._emit('SESSION_CHANGED');
  }

  getRoles(): RoleDefinition[] {
    return this._provider?.getRoles() ?? [];
  }

  // ─── Incident Queries ───────────────────────────────────────────────────────

  async getIncidents(query?: IncidentQuery): Promise<Incident[]> {
    return this._requireProvider().getIncidents(query);
  }

  async getOpenIncidents(): Promise<Incident[]> {
    return this.getIncidents({ status: ['NEW', 'TRIAGED', 'INVESTIGATING', 'CONTAINING'] });
  }

  async getIncidentsForAsset(assetId: string): Promise<Incident[]> {
    return this.getIncidents({ assetId });
  }

  async getIncidentsForUser(userId: string): Promise<Incident[]> {
    return this.getIncidents({ userId });
  }

  async getIncidentById(id: string): Promise<IncidentDetail | null> {
    return this._requireProvider().getIncidentById(id);
  }

  async getAttackGraph(incidentId: string): Promise<AttackGraph | null> {
    return this._requireProvider().getAttackGraph(incidentId);
  }

  async getSystemRadar(incidentId: string): Promise<SystemRadarData | null> {
    return this._requireProvider().getSystemRadar(incidentId);
  }

  async getTimeline(incidentId: string): Promise<TimelineEvent[]> {
    return this._requireProvider().getTimeline(incidentId);
  }

  async getIocConstellation(incidentId: string): Promise<IocGraphData | null> {
    return this._requireProvider().getIocConstellation(incidentId);
  }

  async getMitreMatrix(): Promise<MitreTechniqueCoverage[]> {
    return this._requireProvider().getMitreMatrix();
  }

  async getAuditLogs(): Promise<AuditRecord[]> {
    return this._requireProvider().getAuditLogs();
  }

  async getAuditRecords(): Promise<AuditRecord[]> {
    return this.getAuditLogs();
  }

  async getAssets(): Promise<Asset[]> {
    return this._requireProvider().getAssets();
  }

  async getUsers(): Promise<SecurityUser[]> {
    return this._requireProvider().getUsers();
  }

  async getIOCs(): Promise<IOC[]> {
    return this._requireProvider().getIOCs();
  }

  async getResponseActions(incidentId?: string): Promise<ResponseAction[]> {
    return this._requireProvider().getResponseActions(incidentId);
  }

  // ─── Security Event Engine ──────────────────────────────────────────────────

  async getEvents(query?: SecurityEventQuery): Promise<SecurityEvent[]> {
    return this._requireProvider().getEvents(query);
  }

  async getEventById(id: string): Promise<SecurityEvent | null> {
    return this._requireProvider().getEventById(id);
  }

  async getEventsForIncident(incidentId: string): Promise<SecurityEvent[]> {
    return this._requireProvider().getEvents({ incidentId });
  }

  async getEventsForAsset(assetId: string): Promise<SecurityEvent[]> {
    return this._requireProvider().getEvents({ assetId });
  }

  async getEventsForUser(userId: string): Promise<SecurityEvent[]> {
    return this._requireProvider().getEvents({ userId });
  }

  async getEventsForIOC(iocId: string): Promise<SecurityEvent[]> {
    return this._requireProvider().getEvents({ iocId });
  }

  async queryEvents(criteria: SecurityEventQuery): Promise<SecurityEvent[]> {
    return this._requireProvider().getEvents(criteria);
  }

  async getRecentEvents(limit = 50): Promise<SecurityEvent[]> {
    return this._requireProvider().getEvents({ limit });
  }

  async getEventsBetween(startTime: string, endTime: string): Promise<SecurityEvent[]> {
    return this._requireProvider().getEvents({ startTime, endTime });
  }

  async getEventStats(): Promise<SecurityEventStats> {
    return this._requireProvider().getEventStats();
  }

  async ingestEvent(event: SecurityEventInput): Promise<IngestEventResult> {
    const session = this.getSession();
    const result = await this._requireProvider().ingestEvent(
      event,
      session?.username ?? 'SYSTEM',
      session?.role
    );
    if (result.success && !result.isDuplicate && result.event) {
      this._emit('EVENT_INGESTED');
      this._emit('ALERT_CREATED');
      this._emit('INCIDENTS_UPDATED');
      this._eventListeners.forEach((fn) => {
        try {
          fn(result.event!);
        } catch (err) {
          console.error('[SecurityService] Event listener error:', err);
        }
      });
    }
    return result;
  }

  async ingestEvents(events: SecurityEventInput[]): Promise<IngestEventResult[]> {
    const session = this.getSession();
    const results = await this._requireProvider().ingestEvents(
      events,
      session?.username ?? 'SYSTEM',
      session?.role
    );
    const newEvents = results.filter((r) => r.success && !r.isDuplicate && r.event).map((r) => r.event!);
    if (newEvents.length > 0) {
      this._emit('EVENT_INGESTED');
      this._emit('ALERT_CREATED');
      this._emit('INCIDENTS_UPDATED');
      for (const ev of newEvents) {
        this._eventListeners.forEach((fn) => {
          try {
            fn(ev);
          } catch (err) {
            console.error('[SecurityService] Event listener error:', err);
          }
        });
      }
    }
    return results;
  }

  // ─── Wazuh Integration Facade ──────────────────────────────────────────────
  async getWazuhAlerts(limit?: number) {
    return wazuhService.getNormalizedAlerts(limit);
  }

  async getWazuhAgents(limit?: number) {
    return wazuhService.getAgents(limit);
  }

  async getWazuhStatus() {
    return wazuhService.testConnection();
  }

  // ─── Detection & Alert Engine ───────────────────────────────────────────────

  async getAlerts(query?: AlertQuery): Promise<Alert[]> {
    const baseAlerts = await this._requireProvider().getAlerts(query);
    try {
      const wazuhAlerts = await wazuhService.getCanonicalSocAlerts(query?.limit ?? 50);
      const seen = new Set(baseAlerts.map((a) => a.id));
      const merged = [...baseAlerts];
      for (const wa of wazuhAlerts) {
        if (!seen.has(wa.id)) {
          seen.add(wa.id);
          merged.push(wa);
        }
      }
      return merged;
    } catch {
      return baseAlerts;
    }
  }

  async getAlertById(id: string): Promise<Alert | null> {
    return this._requireProvider().getAlertById(id);
  }

  async getOpenAlerts(): Promise<Alert[]> {
    return this._requireProvider().getOpenAlerts();
  }

  async getAlertsForRule(ruleId: string): Promise<Alert[]> {
    return this._requireProvider().getAlertsForRule(ruleId);
  }

  async getAlertsForEvent(eventId: string): Promise<Alert[]> {
    return this._requireProvider().getAlertsForEvent(eventId);
  }

  async getAlertsForAsset(assetId: string): Promise<Alert[]> {
    return this._requireProvider().getAlertsForAsset(assetId);
  }

  async getAlertsForIncident(incidentId: string): Promise<Alert[]> {
    return this._requireProvider().getAlertsForIncident(incidentId);
  }

  async getAlertStats(): Promise<AlertStats> {
    return this._requireProvider().getAlertStats();
  }

  async acknowledgeAlert(alertId: string, notes?: string): Promise<Alert> {
    const session = this._assertSession();
    const updated = await this._requireProvider().acknowledgeAlert(
      alertId,
      session.username,
      session.role,
      notes
    );
    this._emit('ALERT_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async resolveAlert(alertId: string, notes?: string): Promise<Alert> {
    const session = this._assertSession();
    const updated = await this._requireProvider().resolveAlert(
      alertId,
      session.username,
      session.role,
      notes
    );
    this._emit('ALERT_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async getDetectionRules(): Promise<DetectionRule[]> {
    return this._requireProvider().getDetectionRules();
  }

  async getDetectionRule(id: string): Promise<DetectionRule | null> {
    return this._requireProvider().getDetectionRule(id);
  }

  async getDetectionRuleByRuleId(ruleId: string): Promise<DetectionRule | null> {
    return this._requireProvider().getDetectionRuleByRuleId(ruleId);
  }

  async getDetectionRuleVersions(ruleId: string): Promise<DetectionRuleVersion[]> {
    return this._requireProvider().getDetectionRuleVersions(ruleId);
  }

  async createDetectionRuleDraft(input: CreateDetectionRuleInput): Promise<DetectionRule> {
    const session = this._assertSession();
    const rule = await this._requireProvider().createDetectionRuleDraft(
      input,
      session.username,
      session.role
    );
    this._emit('DETECTION_RULES_UPDATED');
    this._emit('DETECTION_RULE_CREATED');
    this._emit('AUDIT_APPENDED');
    return rule;
  }

  async updateDetectionRuleDraft(id: string, patch: UpdateDetectionRuleInput): Promise<DetectionRule> {
    const session = this._assertSession();
    const rule = await this._requireProvider().updateDetectionRuleDraft(
      id,
      patch,
      session.username,
      session.role
    );
    this._emit('DETECTION_RULES_UPDATED');
    this._emit('DETECTION_RULE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return rule;
  }

  async validateDetectionRule(idOrRule: string | DetectionRule): Promise<RuleValidationResult> {
    return this._requireProvider().validateDetectionRule(idOrRule);
  }

  async testDetectionRule(
    ruleIdOrRule: string | DetectionRule,
    options?: TestRunOptions
  ): Promise<DetectionTestRunResult> {
    const session = this._assertSession();
    const result = await this._requireProvider().testDetectionRule(
      ruleIdOrRule,
      options,
      session.username,
      session.role
    );
    this._emit('DETECTION_RULE_TESTED');
    this._emit('AUDIT_APPENDED');
    return result;
  }

  async publishDetectionRule(id: string, changeDescription: string): Promise<DetectionRule> {
    const session = this._assertSession();
    const rule = await this._requireProvider().publishDetectionRule(
      id,
      changeDescription,
      session.username,
      session.role
    );
    this._emit('DETECTION_RULES_UPDATED');
    this._emit('DETECTION_RULE_PUBLISHED');
    this._emit('AUDIT_APPENDED');
    return rule;
  }

  async enableDetectionRule(id: string): Promise<DetectionRule> {
    const session = this._assertSession();
    const rule = await this._requireProvider().enableDetectionRule(
      id,
      session.username,
      session.role
    );
    this._emit('DETECTION_RULES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return rule;
  }

  async disableDetectionRule(id: string): Promise<DetectionRule> {
    const session = this._assertSession();
    const rule = await this._requireProvider().disableDetectionRule(
      id,
      session.username,
      session.role
    );
    this._emit('DETECTION_RULES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return rule;
  }

  async deprecateDetectionRule(id: string): Promise<DetectionRule> {
    const session = this._assertSession();
    const rule = await this._requireProvider().deprecateDetectionRule(
      id,
      session.username,
      session.role
    );
    this._emit('DETECTION_RULES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return rule;
  }

  async diffRuleVersions(ruleId: string, v1: number, v2: number): Promise<RuleDiffResult> {
    return this._requireProvider().diffRuleVersions(ruleId, v1, v2);
  }

  subscribeToAlerts(listener: AlertListener): () => void {
    this._alertListeners.add(listener);
    return () => {
      this._alertListeners.delete(listener);
    };
  }

  // ─── Incident Lifecycle & Creation ──────────────────────────────────────────

  async createIncident(input: CreateIncidentInput): Promise<Incident> {
    const session = this._assertSession();
    const incident = await this._requireProvider().createIncident(
      input,
      session.username,
      session.role
    );
    this._emit('INCIDENTS_UPDATED');
    this._emit('AUDIT_APPENDED');
    return incident;
  }

  async updateIncidentStatus(
    incidentId: string,
    status: IncidentStatus,
    reason?: string
  ): Promise<Incident> {
    const session = this._assertSession();
    const updated = await this._requireProvider().updateIncidentStatus(
      incidentId, status, session.username, session.role, reason
    );
    this._emit('INCIDENTS_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    return updated;
  }

  async escalateIncident(incidentId: string, toRole: RoleId, reason: string): Promise<Incident> {
    const session = this._assertSession();
    const updated = await this._requireProvider().escalateIncident(
      incidentId, toRole, reason, session.username, session.role
    );
    this._emit('INCIDENTS_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    return updated;
  }

  async addEvidence(
    incidentId: string,
    evidence: Omit<IncidentEvidence, 'id' | 'collectedAt'>
  ): Promise<IncidentEvidence> {
    const session = this._assertSession();
    const ev = await this._requireProvider().addEvidence(incidentId, evidence, session.username);
    this._emit('INCIDENT_DETAIL_UPDATED');
    return ev;
  }

  // ─── Correlation & Incident Creation Engine ─────────────────────────────────

  async runCorrelation(): Promise<{ correlatedCount: number; newIncidentCount: number; updatedIncidentCount: number }> {
    const res = await this._requireProvider().runCorrelation();
    if (res.newIncidentCount > 0 || res.updatedIncidentCount > 0) {
      this._emit('INCIDENTS_UPDATED');
    }
    this._emit('CORRELATION_COMPLETED');
    return res;
  }

  async attachAlertToIncident(incidentId: string, alertId: string): Promise<Incident> {
    const session = this._assertSession();
    const inc = await this._requireProvider().attachAlertToIncident(
      incidentId,
      alertId,
      session.username,
      session.role
    );
    this._emit('INCIDENT_UPDATED');
    this._emit('INCIDENTS_UPDATED');
    this._emit('ALERT_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    return inc;
  }

  async attachEventToIncident(incidentId: string, eventId: string): Promise<Incident> {
    const session = this._assertSession();
    const inc = await this._requireProvider().attachEventToIncident(
      incidentId,
      eventId,
      session.username,
      session.role
    );
    this._emit('INCIDENT_UPDATED');
    this._emit('INCIDENTS_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    return inc;
  }

  // ─── Threat Hunting Engine ──────────────────────────────────────────────────

  async runThreatHunt(query: ThreatHuntQuery): Promise<ThreatHuntExecutionResult> {
    const res = await this._requireProvider().runThreatHunt(query);
    this._emit('THREAT_HUNT_EXECUTED');
    this._emit('AUDIT_APPENDED');
    return res;
  }

  async getThreatHunts(): Promise<ThreatHunt[]> {
    return this._requireProvider().getThreatHunts();
  }

  async getThreatHuntById(id: string): Promise<ThreatHunt | null> {
    return this._requireProvider().getThreatHuntById(id);
  }

  async createThreatHunt(input: CreateThreatHuntInput): Promise<ThreatHunt> {
    const session = this._assertSession();
    const created = await this._requireProvider().createThreatHunt(
      input,
      session.username,
      session.role
    );
    this._emit('THREAT_HUNT_CREATED');
    this._emit('AUDIT_APPENDED');
    return created;
  }

  async updateThreatHunt(id: string, updates: Partial<ThreatHunt>): Promise<ThreatHunt> {
    const session = this._assertSession();
    const updated = await this._requireProvider().updateThreatHunt(
      id,
      updates,
      session.username,
      session.role
    );
    this._emit('THREAT_HUNT_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async archiveThreatHunt(id: string): Promise<ThreatHunt> {
    const session = this._assertSession();
    const archived = await this._requireProvider().archiveThreatHunt(
      id,
      session.username,
      session.role
    );
    this._emit('THREAT_HUNT_UPDATED');
    this._emit('AUDIT_APPENDED');
    return archived;
  }

  async linkHuntEventsToIncident(incidentId: string, eventIds: string[]): Promise<Incident> {
    const session = this._assertSession();
    const incident = await this._requireProvider().linkHuntEventsToIncident(
      incidentId,
      eventIds,
      session.username,
      session.role
    );
    this._emit('INCIDENT_UPDATED');
    this._emit('INCIDENTS_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    this._emit('AUDIT_APPENDED');
    return incident;
  }

  async createIncidentFromHunt(input: CreateIncidentFromHuntInput): Promise<Incident> {
    const session = this._assertSession();
    const incident = await this._requireProvider().createIncidentFromHunt(
      input,
      session.username,
      session.role
    );
    this._emit('INCIDENT_CREATED');
    this._emit('INCIDENTS_UPDATED');
    this._emit('AUDIT_APPENDED');
    return incident;
  }

  getThreatHuntTemplates(): ThreatHuntTemplate[] {
    return this._requireProvider().getThreatHuntTemplates();
  }

  // ─── Case Management ────────────────────────────────────────────────────────

  async getCases(filter?: CaseQueryFilter): Promise<Case[]> {
    return this._requireProvider().getCases(filter);
  }

  async getCase(id: string): Promise<Case | null> {
    return this._requireProvider().getCaseById(id);
  }

  async createCase(input: CreateCaseInput): Promise<Case> {
    const session = this._assertSession();
    const created = await this._requireProvider().createCase(input, session.username, session.role);
    this._emit('CASE_CREATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return created;
  }

  async updateCase(id: string, patch: UpdateCaseInput): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().updateCase(id, patch, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async assignCase(id: string, ownerId: string): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().updateCase(id, { ownerId }, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async unassignCase(id: string): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().updateCase(id, { ownerId: undefined }, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async changeCasePriority(id: string, priority: CasePriority): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().updateCase(id, { priority }, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async changeCaseStatus(id: string, newStatus: CaseStatus): Promise<Case> {
    const session = this._assertSession();
    const existing = await this._requireProvider().getCaseById(id);
    if (!existing) throw new Error(`Case "${id}" not found`);

    if (existing.status === 'CLOSED' && newStatus !== 'CLOSED') {
      throw new Error(`Invalid transition: Cannot transition directly from CLOSED to ${newStatus}. Use reopenCase().`);
    }

    if (!isValidCaseStatusTransition(existing.status, newStatus)) {
      throw new Error(`Invalid status transition from "${existing.status}" to "${newStatus}"`);
    }

    const updated = await this._requireProvider().updateCase(
      id,
      { status: newStatus },
      session.username,
      session.role
    );
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async resolveCase(id: string, resolution: string): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().updateCase(
      id,
      { status: 'RESOLVED', resolution, resolvedAt: new Date().toISOString() },
      session.username,
      session.role
    );
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async closeCase(id: string, closureReason: string): Promise<Case> {
    const session = this._assertSession();
    const closed = await this._requireProvider().closeCase(id, closureReason, session.username, session.role);
    this._emit('CASE_CLOSED');
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return closed;
  }

  async reopenCase(id: string, reason?: string): Promise<Case> {
    const session = this._assertSession();
    const reopened = await this._requireProvider().reopenCase(id, reason, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return reopened;
  }

  async linkIncidentToCase(caseId: string, incidentId: string): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().linkIncidentToCase(caseId, incidentId, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async unlinkIncidentFromCase(caseId: string, incidentId: string): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().unlinkIncidentFromCase(caseId, incidentId, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async linkHuntToCase(caseId: string, huntId: string): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().linkHuntToCase(caseId, huntId, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async unlinkHuntFromCase(caseId: string, huntId: string): Promise<Case> {
    const session = this._assertSession();
    const updated = await this._requireProvider().unlinkHuntFromCase(caseId, huntId, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return updated;
  }

  async getCaseNotes(caseId: string): Promise<CaseNote[]> {
    return this._requireProvider().getCaseNotes(caseId);
  }

  async addCaseNote(caseId: string, input: CreateCaseNoteInput): Promise<CaseNote> {
    const session = this._assertSession();
    const note = await this._requireProvider().addCaseNote(caseId, input, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return note;
  }

  async updateCaseNote(caseId: string, noteId: string, input: UpdateCaseNoteInput): Promise<CaseNote> {
    const session = this._assertSession();
    const note = await this._requireProvider().updateCaseNote(caseId, noteId, input, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return note;
  }

  async getCaseTasks(caseId: string): Promise<CaseTask[]> {
    return this._requireProvider().getCaseTasks(caseId);
  }

  async addCaseTask(caseId: string, input: CreateCaseTaskInput): Promise<CaseTask> {
    const session = this._assertSession();
    const task = await this._requireProvider().addCaseTask(caseId, input, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return task;
  }

  async updateCaseTask(caseId: string, taskId: string, patch: Partial<CaseTask>): Promise<CaseTask> {
    const session = this._assertSession();
    const task = await this._requireProvider().updateCaseTask(caseId, taskId, patch, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return task;
  }

  async getCaseFindings(caseId: string): Promise<CaseFinding[]> {
    return this._requireProvider().getCaseFindings(caseId);
  }

  async addCaseFinding(caseId: string, input: CreateCaseFindingInput): Promise<CaseFinding> {
    const session = this._assertSession();
    const finding = await this._requireProvider().addCaseFinding(caseId, input, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return finding;
  }

  async updateCaseFinding(caseId: string, findingId: string, patch: Partial<CaseFinding>): Promise<CaseFinding> {
    const session = this._assertSession();
    const finding = await this._requireProvider().updateCaseFinding(caseId, findingId, patch, session.username, session.role);
    this._emit('CASE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return finding;
  }

  async getCaseActivity(caseId: string): Promise<AuditRecord[]> {
    const allAudit = await this._requireProvider().getAuditLogs();
    const c = await this._requireProvider().getCaseById(caseId);
    if (!c) return [];

    return allAudit
      .filter((a) => a.target === c.id || a.target === c.caseNumber || (a.details && (a.details as Record<string, unknown>).caseId === c.id))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // ─── Case Context Resolution ────────────────────────────────────────────────

  async getCaseIncidents(caseId: string): Promise<Incident[]> {
    const c = await this._requireProvider().getCaseById(caseId);
    if (!c || c.incidentIds.length === 0) return [];
    const allInc = await this._requireProvider().getIncidents();
    return allInc.filter((i) => c.incidentIds.includes(i.id));
  }

  async getCaseHunts(caseId: string): Promise<ThreatHunt[]> {
    const c = await this._requireProvider().getCaseById(caseId);
    if (!c || c.huntIds.length === 0) return [];
    const allHunts = await this._requireProvider().getThreatHunts();
    return allHunts.filter((h) => c.huntIds.includes(h.id));
  }

  async getCaseAlerts(caseId: string): Promise<Alert[]> {
    const c = await this._requireProvider().getCaseById(caseId);
    if (!c) return [];
    const allAlerts = await this._requireProvider().getAlerts();
    return allAlerts.filter((a) => c.alertIds.includes(a.id) || (a.incidentId && c.incidentIds.includes(a.incidentId)));
  }

  async getCaseEvents(caseId: string): Promise<SecurityEvent[]> {
    const c = await this._requireProvider().getCaseById(caseId);
    if (!c) return [];
    const allEvents = await this._requireProvider().getEvents();
    return allEvents.filter((e) => c.eventIds.includes(e.id) || (e.incidentId && c.incidentIds.includes(e.incidentId)));
  }

  async getCaseAssets(caseId: string): Promise<Asset[]> {
    const c = await this._requireProvider().getCaseById(caseId);
    if (!c || c.assetIds.length === 0) return [];
    const allAssets = await this._requireProvider().getAssets();
    return allAssets.filter((a) => c.assetIds.includes(a.id));
  }

  async getCaseUsers(caseId: string): Promise<SecurityUser[]> {
    const c = await this._requireProvider().getCaseById(caseId);
    if (!c || c.userIds.length === 0) return [];
    const allUsers = await this._requireProvider().getUsers();
    return allUsers.filter((u) => c.userIds.includes(u.id));
  }

  async getCaseIOCs(caseId: string): Promise<IOC[]> {
    const c = await this._requireProvider().getCaseById(caseId);
    if (!c || c.iocIds.length === 0) return [];
    const allIOCs = await this._requireProvider().getIOCs();
    return allIOCs.filter((ioc) => c.iocIds.includes(ioc.id));
  }

  async getCaseEvidence(caseId: string): Promise<Evidence[]> {
    return this._requireProvider().getEvidence({ caseId });
  }

  // ─── Evidence Management Facade ─────────────────────────────────────────────

  async getEvidence(filter?: EvidenceQueryFilter): Promise<Evidence[]> {
    return this._requireProvider().getEvidence(filter);
  }

  async getEvidenceById(id: string): Promise<Evidence | null> {
    return this._requireProvider().getEvidenceById(id);
  }

  async getEvidenceForCase(caseId: string): Promise<Evidence[]> {
    return this._requireProvider().getEvidence({ caseId });
  }

  async getEvidenceForIncident(incidentId: string): Promise<Evidence[]> {
    return this._requireProvider().getEvidence({ incidentId });
  }

  async getEvidenceForEvent(eventId: string): Promise<Evidence[]> {
    return this._requireProvider().getEvidence({ eventId });
  }

  async getEvidenceForHunt(huntId: string): Promise<Evidence[]> {
    return this._requireProvider().getEvidence({ huntId });
  }

  async getEvidenceForIOC(iocId: string): Promise<Evidence[]> {
    return this._requireProvider().getEvidence({ iocId });
  }

  async createEvidence(input: CreateEvidenceInput): Promise<Evidence> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const evd = await this._requireProvider().createEvidence(input, actor, role);
    this._emit('EVIDENCE_COLLECTED');
    this._emit('EVIDENCE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return evd;
  }

  async updateEvidenceMetadata(id: string, patch: UpdateEvidenceMetadataInput): Promise<Evidence> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const evd = await this._requireProvider().updateEvidenceMetadata(id, patch, actor, role);
    this._emit('EVIDENCE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return evd;
  }

  async updateEvidenceStatus(id: string, status: EvidenceStatus, reason?: string): Promise<Evidence> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'SOC_MANAGER';
    const evd = await this._requireProvider().updateEvidenceStatus(id, status, reason, actor, role);
    this._emit('EVIDENCE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return evd;
  }

  async archiveEvidence(id: string, reason?: string): Promise<Evidence> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'SOC_MANAGER';
    const evd = await this._requireProvider().archiveEvidence(id, reason, actor, role);
    this._emit('EVIDENCE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return evd;
  }

  async verifyEvidenceIntegrity(id: string): Promise<{ verified: boolean; storedHash?: string; computedHash?: string; message: string }> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const result = await this._requireProvider().verifyEvidenceIntegrity(id, actor, role);
    this._emit('EVIDENCE_VERIFIED');
    this._emit('EVIDENCE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return result;
  }

  async getEvidenceCustody(evidenceId: string): Promise<EvidenceCustodyEntry[]> {
    return this._requireProvider().getEvidenceCustody(evidenceId);
  }

  async getEvidenceAnnotations(evidenceId: string): Promise<EvidenceAnnotation[]> {
    return this._requireProvider().getEvidenceAnnotations(evidenceId);
  }

  async addEvidenceAnnotation(evidenceId: string, input: CreateEvidenceAnnotationInput): Promise<EvidenceAnnotation> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const anno = await this._requireProvider().addEvidenceAnnotation(evidenceId, input, actor, role);
    this._emit('EVIDENCE_UPDATED');
    this._emit('AUDIT_APPENDED');
    return anno;
  }

  async collectEventAsEvidence(caseId: string, eventId: string, input: Partial<CreateEvidenceInput> = {}): Promise<Evidence> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const evd = await this._requireProvider().collectEventAsEvidence(caseId, eventId, input, actor, role);
    this._emit('EVIDENCE_COLLECTED');
    this._emit('EVIDENCE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return evd;
  }

  async collectAlertAsEvidence(caseId: string, alertId: string, input: Partial<CreateEvidenceInput> = {}): Promise<Evidence> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const evd = await this._requireProvider().collectAlertAsEvidence(caseId, alertId, input, actor, role);
    this._emit('EVIDENCE_COLLECTED');
    this._emit('EVIDENCE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return evd;
  }

  async collectIncidentAsEvidence(caseId: string, incidentId: string, input: Partial<CreateEvidenceInput> = {}): Promise<Evidence> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const evd = await this._requireProvider().collectIncidentAsEvidence(caseId, incidentId, input, actor, role);
    this._emit('EVIDENCE_COLLECTED');
    this._emit('EVIDENCE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return evd;
  }

  async collectHuntAsEvidence(caseId: string, huntId: string, input: Partial<CreateEvidenceInput> = {}): Promise<Evidence> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const evd = await this._requireProvider().collectHuntAsEvidence(caseId, huntId, input, actor, role);
    this._emit('EVIDENCE_COLLECTED');
    this._emit('EVIDENCE_UPDATED');
    this._emit('CASES_UPDATED');
    this._emit('AUDIT_APPENDED');
    return evd;
  }

  async getEvidenceBlob(storageReference: string): Promise<ArrayBuffer | null> {
    return this._requireProvider().getEvidenceBlob(storageReference);
  }

  // ─── Threat Intelligence Engine ───────────────────────────────────────────

  async getThreatIntel(indicatorId: string): Promise<ThreatIntelRecord | null> {
    return this._requireProvider().getThreatIntel(indicatorId);
  }

  async getThreatIntelByIndicator(indicatorType: IocType, value: string): Promise<ThreatIntelRecord | null> {
    return this._requireProvider().getThreatIntelByIndicator(indicatorType, value);
  }

  async getThreatIntelRecords(filters?: ThreatIntelQueryFilter): Promise<ThreatIntelRecord[]> {
    return this._requireProvider().getThreatIntelRecords(filters);
  }

  async createThreatIntelRecord(input: CreateThreatIntelInput): Promise<ThreatIntelRecord> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const rec = await this._requireProvider().createThreatIntelRecord(input, actor, role);
    this._emit('THREAT_INTEL_CREATED');
    this._emit('AUDIT_APPENDED');
    return rec;
  }

  async updateThreatIntelRecord(id: string, patch: UpdateThreatIntelInput): Promise<ThreatIntelRecord> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const rec = await this._requireProvider().updateThreatIntelRecord(id, patch, actor, role);
    this._emit('THREAT_INTEL_UPDATED');
    this._emit('AUDIT_APPENDED');
    return rec;
  }

  async getThreatIntelRelationships(indicatorId: string): Promise<ThreatIntelRelationship[]> {
    return this._requireProvider().getThreatIntelRelationships(indicatorId);
  }

  async getRelatedIndicators(indicatorId: string): Promise<IOC[]> {
    return this._requireProvider().getRelatedIndicators(indicatorId);
  }

  async getIndicatorObservations(indicatorId: string): Promise<IndicatorObservations | null> {
    return this._requireProvider().getIndicatorObservations(indicatorId);
  }

  async enrichIndicatorLocally(indicatorId: string): Promise<{ record: ThreatIntelRecord; relationships: ThreatIntelRelationship[] }> {
    const session = this.getSession();
    const actor = session?.username ?? 'analyst1';
    const role = session?.role ?? 'L2_ANALYST';
    const result = await this._requireProvider().enrichIndicatorLocally(indicatorId, actor, role);
    this._emit('THREAT_INTEL_ENRICHED');
    this._emit('THREAT_INTEL_UPDATED');
    this._emit('AUDIT_APPENDED');
    return result;
  }

  // ─── Response Actions ───────────────────────────────────────────────────────

  async requestResponseAction(
    action: Omit<ResponseAction, 'id' | 'status' | 'requestedAt' | 'requestedBy'>
  ): Promise<ResponseAction> {
    const session = this._assertSession();
    const ra = await this._requireProvider().requestResponseAction(action, session.username);
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('AUDIT_APPENDED');
    return ra;
  }

  async approveResponseAction(actionId: string): Promise<ResponseAction> {
    const session = this._assertSession();
    const ra = await this._requireProvider().approveResponseAction(actionId, session.username);
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('AUDIT_APPENDED');
    return ra;
  }

  async rejectResponseAction(actionId: string, reason: string): Promise<ResponseAction> {
    const session = this._assertSession();
    const ra = await this._requireProvider().rejectResponseAction(actionId, session.username, reason);
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('AUDIT_APPENDED');
    return ra;
  }

  async cancelResponseAction(actionId: string, reason: string): Promise<ResponseAction> {
    const session = this._assertSession();
    const ra = await this._requireProvider().cancelResponseAction(actionId, session.username, reason);
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('AUDIT_APPENDED');
    return ra;
  }

  async executeResponseAction(actionId: string): Promise<ResponseAction> {
    const session = this._assertSession();
    const ra = await this._requireProvider().executeResponseAction(
      actionId, session.username, session.role
    );
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    this._emit('INCIDENTS_UPDATED');
    this._emit('AUDIT_APPENDED');
    return ra;
  }

  async rollbackResponseAction(actionId: string): Promise<ResponseAction> {
    const session = this._assertSession();
    const ra = await this._requireProvider().rollbackResponseAction(
      actionId, session.username, session.role
    );
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    this._emit('INCIDENTS_UPDATED');
    this._emit('AUDIT_APPENDED');
    return ra;
  }

  async dryRunResponseAction(
    actionId: string
  ): Promise<{ action: ResponseAction; wouldModify: boolean; expectedStateChange: string }> {
    const session = this._assertSession();
    const res = await this._requireProvider().dryRunResponseAction(
      actionId, session.username, session.role
    );
    this._emit('AUDIT_APPENDED');
    return res;
  }

  // ─── Reusable SOAR Playbook Management ──────────────────────────────────────

  async getPlaybooks(filter?: { category?: string; status?: string; enabled?: boolean }): Promise<Playbook[]> {
    return this._requireProvider().getPlaybooks(filter);
  }

  async getPlaybookById(id: string): Promise<Playbook | null> {
    return this._requireProvider().getPlaybookById(id);
  }

  async createPlaybook(playbook: Partial<Playbook>): Promise<Playbook> {
    const session = this._assertSession();
    const pb = await this._requireProvider().createPlaybook(playbook, session.username, session.role);
    this._emit('PLAYBOOKS_UPDATED');
    this._emit('PLAYBOOK_CREATED');
    this._emit('AUDIT_APPENDED');
    return pb;
  }

  async updatePlaybook(id: string, updates: Partial<Playbook>): Promise<Playbook> {
    const session = this._assertSession();
    const pb = await this._requireProvider().updatePlaybook(id, updates, session.username, session.role);
    this._emit('PLAYBOOKS_UPDATED');
    this._emit('PLAYBOOK_UPDATED');
    this._emit('AUDIT_APPENDED');
    return pb;
  }

  async validatePlaybook(playbook: Partial<Playbook>): Promise<PlaybookValidationResult> {
    return this._requireProvider().validatePlaybook(playbook);
  }

  async publishPlaybook(id: string, changeDescription?: string): Promise<Playbook> {
    const session = this._assertSession();
    const pb = await this._requireProvider().publishPlaybook(id, session.username, session.role, changeDescription);
    this._emit('PLAYBOOKS_UPDATED');
    this._emit('PLAYBOOK_UPDATED');
    this._emit('AUDIT_APPENDED');
    return pb;
  }

  async enablePlaybook(id: string): Promise<Playbook> {
    const session = this._assertSession();
    const pb = await this._requireProvider().enablePlaybook(id, session.username, session.role);
    this._emit('PLAYBOOKS_UPDATED');
    this._emit('PLAYBOOK_UPDATED');
    this._emit('AUDIT_APPENDED');
    return pb;
  }

  async disablePlaybook(id: string): Promise<Playbook> {
    const session = this._assertSession();
    const pb = await this._requireProvider().disablePlaybook(id, session.username, session.role);
    this._emit('PLAYBOOKS_UPDATED');
    this._emit('PLAYBOOK_UPDATED');
    this._emit('AUDIT_APPENDED');
    return pb;
  }

  async deprecatePlaybook(id: string): Promise<Playbook> {
    const session = this._assertSession();
    const pb = await this._requireProvider().deprecatePlaybook(id, session.username, session.role);
    this._emit('PLAYBOOKS_UPDATED');
    this._emit('PLAYBOOK_UPDATED');
    this._emit('AUDIT_APPENDED');
    return pb;
  }

  async getPlaybookVersions(playbookId: string): Promise<PlaybookVersion[]> {
    return this._requireProvider().getPlaybookVersions(playbookId);
  }

  getActionCatalog(): ActionDefinition[] {
    return this._requireProvider().getActionCatalog();
  }

  async createPlaybookExecution(
    playbookId: string,
    options?: {
      incidentId?: string;
      alertId?: string;
      caseId?: string;
      targetEntity?: { id: string; type: any; label: string };
      isDryRun?: boolean;
    }
  ): Promise<PlaybookExecution> {
    const session = this._assertSession();
    const exec = await this._requireProvider().createPlaybookExecution(
      playbookId,
      session.username,
      session.role,
      options
    );
    if (!options?.isDryRun) {
      this._emit('PLAYBOOK_EXECUTION_CREATED');
      this._emit('AUDIT_APPENDED');
    }
    return exec;
  }

  async getPlaybookExecution(executionId: string): Promise<PlaybookExecution | null> {
    return this._requireProvider().getPlaybookExecution(executionId);
  }

  async getPlaybookExecutions(filter?: { playbookId?: string; incidentId?: string; status?: string }): Promise<PlaybookExecution[]> {
    return this._requireProvider().getPlaybookExecutions(filter);
  }

  async executePlaybookStep(
    executionId: string,
    stepId: string
  ): Promise<{ execution: PlaybookExecution; message: string }> {
    const session = this._assertSession();
    const result = await this._requireProvider().executePlaybookStep(
      executionId,
      stepId,
      session.username,
      session.role
    );
    this._emit('PLAYBOOK_EXECUTION_UPDATED');
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    this._emit('AUDIT_APPENDED');
    return result;
  }

  async cancelPlaybookExecution(executionId: string, reason?: string): Promise<PlaybookExecution> {
    const session = this._assertSession();
    const exec = await this._requireProvider().cancelPlaybookExecution(
      executionId,
      session.username,
      session.role,
      reason
    );
    this._emit('PLAYBOOK_EXECUTION_UPDATED');
    this._emit('AUDIT_APPENDED');
    return exec;
  }

  async rollbackPlaybookExecution(executionId: string): Promise<{ execution: PlaybookExecution; compensatedStepsCount: number }> {
    const session = this._assertSession();
    const result = await this._requireProvider().rollbackPlaybookExecution(
      executionId,
      session.username,
      session.role
    );
    this._emit('PLAYBOOK_EXECUTION_UPDATED');
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('INCIDENT_DETAIL_UPDATED');
    this._emit('AUDIT_APPENDED');
    return result;
  }

  async getApprovals(executionId?: string): Promise<ApprovalRecord[]> {
    return this._requireProvider().getApprovals(executionId);
  }

  async resolveApproval(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string
  ): Promise<ApprovalRecord> {
    const session = this._assertSession();
    const appr = await this._requireProvider().resolveApproval(
      approvalId,
      decision,
      session.username,
      session.role,
      reason
    );
    this._emit('PLAYBOOK_APPROVAL_UPDATED');
    this._emit('PLAYBOOK_EXECUTION_UPDATED');
    this._emit('AUDIT_APPENDED');
    return appr;
  }

  async dryRunPlaybook(playbookId: string, targetOverride?: any): Promise<DryRunResult> {
    const session = this._assertSession();
    return this._requireProvider().dryRunPlaybook(playbookId, session.username, targetOverride);
  }

  // ─── SOC Metrics & Operational Analytics ───────────────────────────────────

  async getSocOperationalSnapshot(filter?: TimeWindowFilter): Promise<SocOperationalSnapshot> {
    const session = this.getSession();
    if (session && !canViewSocMetrics(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SOC_METRICS permission.`);
    }
    return this._requireProvider().getSocOperationalSnapshot(filter);
  }

  async getKpis(filter?: TimeWindowFilter): Promise<KpiResult[]> {
    const session = this.getSession();
    if (session && !canViewSocMetrics(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SOC_METRICS permission.`);
    }
    return this._requireProvider().getKpis(filter);
  }

  async getTimeSeries(
    metricId: 'EVENTS' | 'ALERTS' | 'INCIDENTS' | 'RESPONSE' | 'AUDIT',
    filter?: TimeWindowFilter,
    bucketCount?: number
  ): Promise<TimeSeriesBucket[]> {
    const session = this.getSession();
    if (session && !canViewSocMetrics(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SOC_METRICS permission.`);
    }
    return this._requireProvider().getTimeSeries(metricId, filter, bucketCount);
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
    const session = this.getSession();
    if (session && !canViewSocMetrics(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SOC_METRICS permission.`);
    }
    return this._requireProvider().getDistributions(category, filter);
  }

  async getTopEntities(
    type: 'TOP_AFFECTED_ASSETS' | 'TOP_TARGETED_USERS' | 'TOP_TRIGGERED_RULES' | 'TOP_IOCS' | 'TOP_MITRE_TECHNIQUES',
    filter?: TimeWindowFilter,
    limit?: number
  ): Promise<TopEntityItem[]> {
    const session = this.getSession();
    if (session && !canViewSocMetrics(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SOC_METRICS permission.`);
    }
    return this._requireProvider().getTopEntities(type, filter, limit);
  }

  async getSocActivityTimeline(filter?: TimeWindowFilter, limit?: number): Promise<SocActivityTimelineItem[]> {
    const session = this.getSession();
    if (session && !canViewOperationalData(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_OPERATIONAL_DATA permission.`);
    }
    return this._requireProvider().getSocActivityTimeline(filter, limit);
  }

  async getMetricProvenance(metricId: string, filter?: TimeWindowFilter): Promise<MetricProvenance> {
    const session = this.getSession();
    if (session && !canViewSocMetrics(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SOC_METRICS permission.`);
    }
    return this._requireProvider().getMetricProvenance(metricId, filter);
  }

  // ─── Scenario Engine ─────────────────────────────────────────────────────────

  async getAvailableScenarios(): Promise<ScenarioDefinition[]> {
    return this._requireProvider().getAvailableScenarios();
  }

  async loadScenario(scenarioId: string): Promise<Incident> {
    const incident = await this._requireProvider().loadScenario(scenarioId);
    this._emit('INCIDENTS_UPDATED');
    return incident;
  }

  async stepScenario(stepIndex: number): Promise<TimelineEvent | null> {
    const event = await this._requireProvider().stepScenario(stepIndex);
    if (event) this._emit('INCIDENT_DETAIL_UPDATED');
    return event;
  }

  async resetScenario(): Promise<void> {
    await this._requireProvider().resetScenario();
    this._emit('INCIDENTS_UPDATED');
  }

  // ─── Attack Simulation & Cyber Range Engine (Step 12) ────────────────────────

  async getSimulationScenarios(): Promise<SimulationScenario[]> {
    const session = this.getSession();
    if (session && !canViewSimulations(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SIMULATIONS permission.`);
    }
    return this._requireProvider().getSimulationScenarios();
  }

  async getSimulationScenario(id: string): Promise<SimulationScenario | null> {
    const session = this.getSession();
    if (session && !canViewSimulations(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SIMULATIONS permission.`);
    }
    return this._requireProvider().getSimulationScenario(id);
  }

  async startSimulation(
    scenarioId: string,
    options: StartSimulationOptions = {}
  ): Promise<SimulationRun> {
    const session = this._assertSession();
    if (!canRunSimulation(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks RUN_SIMULATION permission.`);
    }
    const run = await this._requireProvider().startSimulation(
      scenarioId,
      options,
      session.username,
      session.role
    );
    this._emit('SIMULATION_STARTED');
    return run;
  }

  async pauseSimulation(runId: string): Promise<SimulationRun> {
    const session = this._assertSession();
    if (!canRunSimulation(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks RUN_SIMULATION permission.`);
    }
    const run = await this._requireProvider().pauseSimulation(runId, session.username, session.role);
    this._emit('SIMULATION_UPDATED');
    return run;
  }

  async resumeSimulation(runId: string): Promise<SimulationRun> {
    const session = this._assertSession();
    if (!canRunSimulation(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks RUN_SIMULATION permission.`);
    }
    const run = await this._requireProvider().resumeSimulation(runId, session.username, session.role);
    this._emit('SIMULATION_UPDATED');
    return run;
  }

  async stepSimulation(runId: string): Promise<SimulationRun> {
    const session = this._assertSession();
    if (!canRunSimulation(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks RUN_SIMULATION permission.`);
    }
    const run = await this._requireProvider().stepSimulation(runId, session.username, session.role);
    this._emit('SIMULATION_UPDATED');
    if (run.status === 'COMPLETED') {
      this._emit('SIMULATION_COMPLETED');
    }
    return run;
  }

  async cancelSimulation(runId: string): Promise<SimulationRun> {
    const session = this._assertSession();
    if (!canCancelSimulation(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks CANCEL_SIMULATION permission.`);
    }
    const run = await this._requireProvider().cancelSimulation(runId, session.username, session.role);
    this._emit('SIMULATION_UPDATED');
    return run;
  }

  async setSimulationSpeed(runId: string, speed: number): Promise<SimulationRun> {
    const session = this._assertSession();
    if (!canRunSimulation(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks RUN_SIMULATION permission.`);
    }
    const run = await this._requireProvider().setSimulationSpeed(runId, speed, session.username, session.role);
    this._emit('SIMULATION_UPDATED');
    return run;
  }

  async getSimulationRun(runId: string): Promise<SimulationRun | null> {
    const session = this.getSession();
    if (session && !canViewSimulations(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SIMULATIONS permission.`);
    }
    return this._requireProvider().getSimulationRun(runId);
  }

  async getSimulationRuns(): Promise<SimulationRun[]> {
    const session = this.getSession();
    if (session && !canViewSimulations(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SIMULATIONS permission.`);
    }
    return this._requireProvider().getSimulationRuns();
  }

  async getSimulationResult(runId: string): Promise<SimulationResult | null> {
    const session = this.getSession();
    if (session && !canViewSimulationResults(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SIMULATION_RESULTS permission.`);
    }
    return this._requireProvider().getSimulationResult(runId);
  }

  async cleanupSimulationData(
    runId: string,
    options: { keepResults?: boolean } = { keepResults: true }
  ): Promise<{ deletedEvents: number; deletedAlerts: number; deletedIncidents: number }> {
    const session = this._assertSession();
    if (!canDeleteSimulationData(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks DELETE_SIMULATION_DATA permission.`);
    }
    const res = await this._requireProvider().cleanupSimulationData(
      runId,
      options,
      session.username,
      session.role
    );
    this._emit('SIMULATION_UPDATED');
    this._emit('INCIDENTS_UPDATED');
    this._emit('METRICS_UPDATED');
    return res;
  }

  // ─── AI Investigation Assistant (Step 13) ──────────────────────────────────

  async buildInvestigationContext(
    targetType: TargetEntityType,
    targetId: string,
    options?: ContextBuilderOptions
  ): Promise<InvestigationContext> {
    const session = this.getSession();
    if (session && !canViewAiAssistant(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_AI_ASSISTANT permission.`);
    }
    return this._requireProvider().buildInvestigationContext(
      targetType,
      targetId,
      session?.role,
      options
    );
  }

  async generateAiAnalysis(
    context: InvestigationContext,
    responseType?: AIResponseType,
    analystQuery?: string
  ): Promise<AIInvestigationResponse> {
    const session = this.getSession();
    if (session && !canGenerateAiAnalysis(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks GENERATE_AI_ANALYSIS permission.`);
    }
    const res = await this._requireProvider().generateAiAnalysis(context, responseType, analystQuery);
    this._emit('AI_ANALYSIS_GENERATED');
    return res;
  }

  async getAiActionProposals(filter?: { contextId?: string; status?: AIActionProposalStatus }): Promise<AIActionProposal[]> {
    const session = this.getSession();
    if (session && !canViewAiAssistant(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_AI_ASSISTANT permission.`);
    }
    return this._requireProvider().getAiActionProposals(filter);
  }

  async createAiActionProposal(proposal: AIActionProposal): Promise<AIActionProposal> {
    const session = this.getSession();
    if (session && !canGenerateAiAnalysis(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks GENERATE_AI_ANALYSIS permission.`);
    }
    const created = await this._requireProvider().createAiActionProposal(proposal);
    this._emit('AI_ACTION_PROPOSED');
    return created;
  }

  async acceptAiActionProposal(
    proposalId: string
  ): Promise<{ proposal: AIActionProposal; executionResult?: unknown }> {
    const session = this._assertSession();
    if (!canProposeResponseAction(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks PROPOSE_RESPONSE_ACTION permission.`);
    }
    const res = await this._requireProvider().acceptAiActionProposal(
      proposalId,
      session.username,
      session.role
    );
    this._emit('AI_ACTION_UPDATED');
    this._emit('RESPONSE_ACTION_UPDATED');
    return res;
  }

  async rejectAiActionProposal(
    proposalId: string,
    reason?: string
  ): Promise<AIActionProposal> {
    const session = this._assertSession();
    if (!canProposeResponseAction(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks PROPOSE_RESPONSE_ACTION permission.`);
    }
    const res = await this._requireProvider().rejectAiActionProposal(
      proposalId,
      session.username,
      session.role,
      reason
    );
    this._emit('AI_ACTION_UPDATED');
    return res;
  }

  // ─── Step 14: Integration & Synchronization ─────────────────────────────────

  async getConnectivityState(): Promise<ConnectivityState> {
    const session = this.getSession();
    if (session && !canViewIntegrations(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_INTEGRATIONS permission.`);
    }
    const provider = this._requireProvider();
    if (provider.getConnectivityState) {
      return provider.getConnectivityState();
    }
    return {
      mode: 'OFFLINE',
      status: 'OFFLINE',
      activeProviderId: 'LOCAL_PROVIDER',
      isAirgapped: true,
      pendingChangesCount: 0,
      activeConflictsCount: 0,
      availableAdapters: [],
    };
  }

  async setConnectivityMode(mode: ConnectivityMode, remoteProvider?: any): Promise<ConnectivityState> {
    const session = this._assertSession();
    if (!canManageIntegrations(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks MANAGE_INTEGRATIONS permission.`);
    }
    const provider = this._requireProvider();
    if (!provider.setConnectivityMode) {
      throw new Error('[SecurityService] Active provider does not support connectivity switching.');
    }
    const state = await provider.setConnectivityMode(mode, remoteProvider);
    this._emit('CONNECTIVITY_CHANGED');
    return state;
  }

  async getSyncQueue(status?: SyncOperation['status']): Promise<SyncOperation[]> {
    const session = this.getSession();
    if (session && !canViewSyncStatus(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SYNC_STATUS permission.`);
    }
    const provider = this._requireProvider();
    if (!provider.getSyncQueue) return [];
    return provider.getSyncQueue(status);
  }

  async getSyncConflicts(unresolvedOnly = false): Promise<SyncConflict[]> {
    const session = this.getSession();
    if (session && !canViewSyncStatus(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks VIEW_SYNC_STATUS permission.`);
    }
    const provider = this._requireProvider();
    if (!provider.getSyncConflicts) return [];
    return provider.getSyncConflicts(unresolvedOnly);
  }

  async resolveSyncConflict(
    conflictId: string,
    resolution: 'LOCAL_WINS' | 'REMOTE_WINS'
  ): Promise<SyncConflict> {
    const session = this._assertSession();
    if (!canResolveSyncConflict(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks RESOLVE_SYNC_CONFLICT permission.`);
    }
    const provider = this._requireProvider();
    if (!provider.resolveSyncConflict) {
      throw new Error('[SecurityService] Active provider does not support conflict resolution.');
    }
    const res = await provider.resolveSyncConflict(conflictId, resolution, session.username);
    this._emit('SYNC_COMPLETED');
    return res;
  }

  async ingestExternalEvent(
    rawEvent: Record<string, unknown>,
    sourceProvider: string
  ): Promise<IngestEventResult> {
    const provider = this._requireProvider();
    if (!provider.ingestExternalEvent) {
      throw new Error('[SecurityService] Active provider does not support external event ingestion.');
    }
    const res = await provider.ingestExternalEvent(rawEvent, sourceProvider);
    if (res.success && res.event) {
      this._emit('EVENT_INGESTED');
    }
    return res;
  }

  async executeExternalResponseAction(
    actionType: string,
    target: Record<string, unknown>,
    params?: Record<string, unknown>
  ): Promise<ExternalActionExecutionResult> {
    const session = this._assertSession();
    if (!canUseExternalResponse(session.role)) {
      throw new Error(`[SecurityService] Role ${session.role} lacks USE_EXTERNAL_RESPONSE permission.`);
    }
    const provider = this._requireProvider();
    if (!provider.executeExternalAction) {
      throw new Error('[SecurityService] Active provider does not support external response action execution.');
    }
    const res = await provider.executeExternalAction(actionType, target, params);
    this._emit('RESPONSE_ACTION_UPDATED');
    this._emit('AUDIT_APPENDED');
    return res;
  }

  // ─── Step 15 Referential Integrity Audit ──────────────────────────────────

  async auditReferentialIntegrity(): Promise<ReferentialIntegrityReport> {
    const provider = this._requireProvider();
    if (provider.auditReferentialIntegrity) {
      return provider.auditReferentialIntegrity();
    }
    throw new Error('[SecurityService] Active provider does not implement auditReferentialIntegrity.');
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private _requireProvider(): ISecurityProvider {
    if (!this._provider) {
      throw new Error('[SecurityService] Provider not initialized. Call bootstrap() first.');
    }
    return this._provider;
  }

  private _assertSession(): UserSession {
    const session = this.getSession();
    if (!session) {
      throw new Error('[SecurityService] Operation requires an active session.');
    }
    return session;
  }
}

// Singleton export
export const securityService = new SecurityService();

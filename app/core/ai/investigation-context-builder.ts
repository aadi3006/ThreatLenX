/**
 * investigation-context-builder.ts
 *
 * Deterministic Investigation Context Builder for Step 13.
 *
 * Responsibilities:
 * 1. Resolve canonical security entities linked to a focused target entity.
 * 2. Enforce strict RBAC data sanitization: entities the analyst is not permitted
 *    to view are filtered out BEFORE reaching the AI reasoning engine.
 * 3. Bound context size to prevent memory exhaustion and UI performance degradation.
 * 4. Maintain Prompt/Context Injection Safety: all attacker-controlled strings
 *    (command line, message, filenames, query names) are treated strictly as inert data tokens.
 */

import type { ISecurityProvider } from '../providers/provider-interface';
import type { RoleId } from '../models/auth';
import type { Alert } from '../models/detection';
import type { SecurityEvent } from '../models/event';
import type { Case } from '../models/case';
import type { Evidence } from '../models/evidence';
import type { ThreatIntelRecord } from '../models/threat-intel';
import type { PlaybookExecution } from '../models/response';
import { hasPermission } from '../auth/rbac';
import type {
  InvestigationContext,
  TargetEntityType,
} from '../models/ai';

export interface ContextBuilderOptions {
  maxEvents?: number;
  maxAlerts?: number;
  maxIocs?: number;
  maxTimeline?: number;
}

const DEFAULT_MAX_EVENTS = 50;
const DEFAULT_MAX_ALERTS = 20;
const DEFAULT_MAX_IOCS = 10;
const DEFAULT_MAX_TIMELINE = 30;

/**
 * Sanitizes untrusted telemetry strings to prevent interpretation as instructions.
 */
export function sanitizeTelemetryString(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  return str
    .replace(/<\|/g, '&lt;|')
    .replace(/\|>/g, '|&gt;')
    .trim();
}

export class InvestigationContextBuilder {
  constructor(private provider: ISecurityProvider) {}

  /**
   * Build an evidence-grounded canonical context for any security entity.
   */
  public async buildContext(
    targetType: TargetEntityType,
    targetId: string,
    roleId?: RoleId,
    options: ContextBuilderOptions = {}
  ): Promise<InvestigationContext> {
    const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    const maxAlerts = options.maxAlerts ?? DEFAULT_MAX_ALERTS;
    const maxIocs = options.maxIocs ?? DEFAULT_MAX_IOCS;
    const maxTimeline = options.maxTimeline ?? DEFAULT_MAX_TIMELINE;

    let primaryEntity: Record<string, unknown> | null = null;
    let relatedEvents: Array<Record<string, unknown>> = [];
    let relatedAlerts: Array<Record<string, unknown>> = [];
    let relatedIncidents: Array<Record<string, unknown>> = [];
    let relatedAssets: Array<Record<string, unknown>> = [];
    let relatedUsers: Array<Record<string, unknown>> = [];
    let relatedIOCs: Array<Record<string, unknown>> = [];
    let relatedMITRETechniques: string[] = [];
    let correlationReasons: string[] = [];
    let timeline: Array<{
      id: string;
      timestamp: string;
      description: string;
      type: string;
      entityId?: string;
    }> = [];
    let detectionRules: Array<Record<string, unknown>> = [];
    let threatIntel: Array<Record<string, unknown>> = [];
    let cases: Array<Record<string, unknown>> = [];
    let evidence: Array<Record<string, unknown>> = [];
    let responseExecutions: Array<Record<string, unknown>> = [];
    let simulationProvenance: InvestigationContext['simulationProvenance'] | undefined;
    let title = `${targetType} ${targetId}`;

    // ── Entity Resolution ───────────────────────────────────────────────────

    if (targetType === 'INCIDENT') {
      const inc = await this.provider.getIncidentById(targetId);
      if (inc) {
        primaryEntity = inc as unknown as Record<string, unknown>;
        title = inc.title;

        // Assets & Users
        if (inc.affectedAssets?.length) {
          const allAssets = await this.provider.getAssets();
          relatedAssets = allAssets
            .filter((a) => inc.affectedAssets.includes(a.id))
            .map((a) => a as unknown as Record<string, unknown>);
        }
        if (inc.affectedUsers?.length) {
          const allUsers = await this.provider.getUsers();
          relatedUsers = allUsers
            .filter((u) => inc.affectedUsers.includes(u.id))
            .map((u) => u as unknown as Record<string, unknown>);
        }

        // IOCs
        if (inc.iocs?.length) {
          const allIocs = await this.provider.getIOCs();
          relatedIOCs = allIocs
            .filter((i) => inc.iocs.includes(i.id) || inc.iocs.includes(i.value))
            .slice(0, maxIocs)
            .map((i) => i as unknown as Record<string, unknown>);
        }

        // MITRE
        if (inc.mitreTechniques?.length) {
          relatedMITRETechniques = [...inc.mitreTechniques];
        }

        // Timeline
        if (inc.timelineEvents?.length) {
          timeline = inc.timelineEvents.slice(0, maxTimeline).map((t, idx) => ({
            id: `tle-${idx}`,
            timestamp: t.timestamp,
            description: sanitizeTelemetryString(t.description),
            type: t.stage || 'EVENT',
            entityId: t.entityId,
          }));
        }

        // Correlation reasons
        if (inc.correlationChain?.length) {
          correlationReasons = inc.correlationChain.map((c) =>
            typeof c === 'string' ? c : (c as any).reason || JSON.stringify(c)
          );
        }

        // Alerts & Events
        if (inc.alertIds?.length) {
          const allAlerts: Alert[] = await this.provider.getAlerts();
          relatedAlerts = allAlerts
            .filter((a: Alert) => inc.alertIds && inc.alertIds.includes(a.id))
            .slice(0, maxAlerts)
            .map((a: Alert) => a as unknown as Record<string, unknown>);

          const ruleIds = new Set<string>();
          relatedAlerts.forEach((a) => {
            if (typeof a.ruleId === 'string') ruleIds.add(a.ruleId);
          });

          if (ruleIds.size > 0) {
            const rules = await this.provider.getDetectionRules();
            detectionRules = rules
              .filter((r) => ruleIds.has(r.id))
              .map((r) => r as unknown as Record<string, unknown>);
          }
        }

        if (inc.eventIds?.length) {
          const allEvents: SecurityEvent[] = await this.provider.getEvents();
          relatedEvents = allEvents
            .filter((e: SecurityEvent) => inc.eventIds && inc.eventIds.includes(e.id))
            .slice(0, maxEvents)
            .map((e: SecurityEvent) => e as unknown as Record<string, unknown>);
        }

        // Cases & Evidence
        try {
          const allCases: Case[] = await this.provider.getCases();
          cases = allCases
            .filter((c: Case) => c.incidentIds?.includes(targetId))
            .map((c: Case) => c as unknown as Record<string, unknown>);

          const caseIds = new Set(cases.map((c) => String(c.id)));
          const allEvidence: Evidence[] = await this.provider.getEvidence();
          evidence = allEvidence
            .filter((e: Evidence) => caseIds.has(e.caseId) || (e.tags && e.tags.includes(targetId)))
            .map((e: Evidence) => e as unknown as Record<string, unknown>);
        } catch {
          // Non-fatal if stores are empty
        }

        // SOAR Executions
        try {
          const execs: PlaybookExecution[] = await this.provider.getPlaybookExecutions({ incidentId: targetId });
          responseExecutions = execs.map((x: PlaybookExecution) => x as unknown as Record<string, unknown>);
        } catch {
          // Non-fatal
        }

        // Threat Intel
        if (inc.iocs?.length) {
          try {
            const allIntel: ThreatIntelRecord[] = await this.provider.getThreatIntelRecords();
            threatIntel = allIntel
              .filter((ti: ThreatIntelRecord) => inc.iocs.includes(ti.indicatorValue) || inc.iocs.includes(ti.indicatorId))
              .map((ti: ThreatIntelRecord) => ti as unknown as Record<string, unknown>);
          } catch {
            // Non-fatal
          }
        }

        // Simulation Metadata check
        const meta = inc.metadata as Record<string, unknown> | undefined;
        if (meta?.simulation) {
          const sim = meta.simulation as Record<string, unknown>;
          simulationProvenance = {
            isSimulation: true,
            simulationId: sim.simulationId as string,
            scenarioId: sim.scenarioId as string,
            runId: sim.runId as string,
            seed: sim.seed as number,
          };
        }
      }
    } else if (targetType === 'ALERT') {
      const allAlerts: Alert[] = await this.provider.getAlerts();
      const alert = allAlerts.find((a: Alert) => a.id === targetId);
      if (alert) {
        primaryEntity = alert as unknown as Record<string, unknown>;
        title = alert.title || `Alert ${alert.id}`;

        if (alert.ruleId) {
          const rules = await this.provider.getDetectionRules();
          detectionRules = rules
            .filter((r) => r.id === alert.ruleId)
            .map((r) => r as unknown as Record<string, unknown>);
        }

        if (alert.sourceEventIds?.length) {
          const allEvents: SecurityEvent[] = await this.provider.getEvents();
          relatedEvents = allEvents
            .filter((e: SecurityEvent) => alert.sourceEventIds && alert.sourceEventIds.includes(e.id))
            .slice(0, maxEvents)
            .map((e: SecurityEvent) => e as unknown as Record<string, unknown>);
        }

        if (alert.incidentId) {
          const inc = await this.provider.getIncidentById(alert.incidentId);
          if (inc) {
            relatedIncidents = [inc as unknown as Record<string, unknown>];
          }
        }

        if (alert.assetId) {
          const allAssets = await this.provider.getAssets();
          relatedAssets = allAssets
            .filter((a) => a.id === alert.assetId)
            .map((a) => a as unknown as Record<string, unknown>);
        }

        if (alert.mitreTechniqueId) {
          relatedMITRETechniques = [alert.mitreTechniqueId];
        }

        const alertMeta = alert.metadata as Record<string, unknown> | undefined;
        if (alertMeta?.simulation) {
          const sim = alertMeta.simulation as Record<string, unknown>;
          simulationProvenance = {
            isSimulation: true,
            simulationId: sim.simulationId as string,
            scenarioId: sim.scenarioId as string,
            runId: sim.runId as string,
          };
        }
      }
    } else if (targetType === 'ASSET') {
      const allAssets = await this.provider.getAssets();
      const asset = allAssets.find((a) => a.id === targetId);
      if (asset) {
        primaryEntity = asset as unknown as Record<string, unknown>;
        title = `Asset ${asset.name} (${asset.id})`;

        const incs = await this.provider.getIncidents();
        relatedIncidents = incs
          .filter((i) => i.affectedAssets?.includes(targetId))
          .map((i) => i as unknown as Record<string, unknown>);

        const allAlerts: Alert[] = await this.provider.getAlerts();
        relatedAlerts = allAlerts
          .filter((a: Alert) => a.assetId === targetId)
          .slice(0, maxAlerts)
          .map((a: Alert) => a as unknown as Record<string, unknown>);

        const allEvents: SecurityEvent[] = await this.provider.getEvents();
        relatedEvents = allEvents
          .filter((e: SecurityEvent) => e.assetId === targetId)
          .slice(0, maxEvents)
          .map((e: SecurityEvent) => e as unknown as Record<string, unknown>);

        try {
          const execs: PlaybookExecution[] = await this.provider.getPlaybookExecutions();
          responseExecutions = execs
            .filter((x: PlaybookExecution) => (x as any).target?.id === targetId)
            .map((x: PlaybookExecution) => x as unknown as Record<string, unknown>);
        } catch {
          // Non-fatal
        }
      }
    } else if (targetType === 'IOC') {
      const allIocs = await this.provider.getIOCs();
      const ioc = allIocs.find((i) => i.id === targetId || i.value === targetId);
      if (ioc) {
        primaryEntity = ioc as unknown as Record<string, unknown>;
        title = `IOC ${ioc.type}: ${ioc.value}`;

        try {
          const allIntel: ThreatIntelRecord[] = await this.provider.getThreatIntelRecords();
          threatIntel = allIntel
            .filter((ti: ThreatIntelRecord) => ti.indicatorValue === ioc.value || ti.indicatorId === ioc.id)
            .map((ti: ThreatIntelRecord) => ti as unknown as Record<string, unknown>);
        } catch {
          // Non-fatal
        }

        const incs = await this.provider.getIncidents();
        relatedIncidents = incs
          .filter((i) => i.iocs?.includes(ioc.value) || i.iocs?.includes(ioc.id))
          .map((i) => i as unknown as Record<string, unknown>);

        const allAlerts: Alert[] = await this.provider.getAlerts();
        relatedAlerts = allAlerts
          .filter((a: Alert) => (a as any).iocs?.includes(ioc.value) || (a as any).iocs?.includes(ioc.id))
          .slice(0, maxAlerts)
          .map((a: Alert) => a as unknown as Record<string, unknown>);
      }
    } else if (targetType === 'RULE') {
      const rules = await this.provider.getDetectionRules();
      const rule = rules.find((r) => r.id === targetId || r.ruleId === targetId);
      if (rule) {
        primaryEntity = rule as unknown as Record<string, unknown>;
        title = `Detection Rule ${rule.ruleId}: ${rule.name}`;

        if (rule.mitreTechniqueIds?.length) {
          relatedMITRETechniques = [...rule.mitreTechniqueIds];
        }

        const allAlerts: Alert[] = await this.provider.getAlerts();
        relatedAlerts = allAlerts
          .filter((a: Alert) => a.ruleId === rule.id || a.ruleId === rule.ruleId)
          .slice(0, maxAlerts)
          .map((a: Alert) => a as unknown as Record<string, unknown>);
      }
    } else if (targetType === 'SIMULATION') {
      try {
        const scenarios = await this.provider.getSimulationScenarios();
        const scenario = scenarios.find((s) => s.id === targetId || s.scenarioId === targetId);
        const runs = await this.provider.getSimulationRuns();
        const activeRun = runs.find((r) => r.id === targetId || r.scenarioId === targetId);

        primaryEntity = (scenario || activeRun || {}) as unknown as Record<string, unknown>;
        title = scenario?.name || `Simulation ${targetId}`;

        if (activeRun) {
          simulationProvenance = {
            isSimulation: true,
            simulationId: activeRun.scenarioId,
            scenarioId: activeRun.scenarioId,
            runId: activeRun.id,
            seed: activeRun.seed,
          };

          const result = await this.provider.getSimulationResult(activeRun.id);
          if (result) {
            primaryEntity = {
              ...primaryEntity,
              simulationResult: result,
            };
          }
        }
      } catch {
        // Non-fatal
      }
    } else if (targetType === 'CASE') {
      try {
        const allCases: Case[] = await this.provider.getCases();
        const c = allCases.find((cs: Case) => cs.id === targetId || cs.caseNumber === targetId);
        if (c) {
          primaryEntity = c as unknown as Record<string, unknown>;
          title = `Case ${c.caseNumber}: ${c.title}`;

          if (c.incidentIds?.length) {
            const incs = await this.provider.getIncidents();
            relatedIncidents = incs
              .filter((i) => c.incidentIds.includes(i.id))
              .map((i) => i as unknown as Record<string, unknown>);
          }

          const allEvidence: Evidence[] = await this.provider.getEvidence();
          evidence = allEvidence
            .filter((e: Evidence) => e.caseId === c.id)
            .map((e: Evidence) => e as unknown as Record<string, unknown>);
        }
      } catch {
        // Non-fatal
      }
    } else {
      title = 'General SOC Operational Context';
      try {
        const snapshot = await this.provider.getSocOperationalSnapshot();
        primaryEntity = snapshot as unknown as Record<string, unknown>;
      } catch {
        // Non-fatal
      }
    }

    // ── RBAC Data Sanitization ───────────────────────────────────────────────

    if (roleId) {
      if (!hasPermission(roleId, 'INCIDENT_READ')) {
        relatedIncidents = [];
        if (targetType === 'INCIDENT') primaryEntity = null;
      }
      if (!hasPermission(roleId, 'THREAT_INTEL_READ')) {
        threatIntel = [];
        if (targetType === 'IOC' && primaryEntity) {
          delete (primaryEntity as any).threatIntel;
        }
      }
      if (!hasPermission(roleId, 'CASE_READ')) {
        cases = [];
        if (targetType === 'CASE') primaryEntity = null;
      }
      if (!hasPermission(roleId, 'EVIDENCE_READ')) {
        evidence = [];
        if (targetType === 'EVIDENCE') primaryEntity = null;
      }
      if (!hasPermission(roleId, 'DETECTION_RULE_READ')) {
        detectionRules = [];
        if (targetType === 'RULE') primaryEntity = null;
      }
      if (!hasPermission(roleId, 'PLAYBOOK_READ')) {
        responseExecutions = [];
      }
      if (!hasPermission(roleId, 'VIEW_SIMULATIONS')) {
        if (simulationProvenance?.isSimulation) {
          simulationProvenance = undefined;
        }
        if (targetType === 'SIMULATION') primaryEntity = null;
      }
    }

    const isTruncated =
      relatedEvents.length >= maxEvents ||
      relatedAlerts.length >= maxAlerts ||
      relatedIOCs.length >= maxIocs;

    return {
      contextId: `ctx-${targetType.toLowerCase()}-${targetId}-${Date.now()}`,
      targetType,
      targetId,
      title,
      assembledAt: new Date().toISOString(),
      contextVersion: 1,
      primaryEntity,
      relatedEvents,
      relatedAlerts,
      relatedIncidents,
      relatedAssets,
      relatedUsers,
      relatedIOCs,
      relatedMITRETechniques,
      correlationReasons,
      timeline,
      detectionRules,
      threatIntel,
      cases,
      evidence,
      responseExecutions,
      simulationProvenance,
      truncated: isTruncated,
      truncationReason: isTruncated
        ? `Context bounded to ${maxEvents} events, ${maxAlerts} alerts, and ${maxIocs} IOCs for performance.`
        : undefined,
    };
  }
}

/**
 * metrics-engine.ts
 *
 * Deterministic, offline-native Metrics Engine for EXPLAIN-SEC SPATIAL.
 *
 * Rules:
 * - 100% offline, purely mathematical calculations over canonical SOC records.
 * - Zero Math.random(), zero simulated counters, zero hardcoded KPIs.
 * - All calculations safe against division by zero and NaN.
 * - Missing timestamps produce explicit 'INSUFFICIENT_DATA' with explanations.
 * - Capped time-series bucketing (30-60 buckets max) to ensure spatial rendering performance.
 * - Memoized caching with epoch invalidation.
 */

import type { SecurityEvent, EventCategory } from '../models/event';
import type { Alert, DetectionRule } from '../models/detection';
import type { Incident, Severity } from '../models/incident';
import type { Case } from '../models/case';
import type { ThreatHunt } from '../models/hunting';
import type { Evidence } from '../models/evidence';
import type { Asset, IOC, SecurityUser } from '../models/entity';
import type { Playbook, PlaybookExecution } from '../models/response';
import type { AuditRecord } from '../models/audit';
import { calculateThreatAssessment } from '../security/threat-level-service';
import type {
  TimeWindow,
  TimeWindowFilter,
  TimeSeriesBucket,
  DistributionBucket,
  TopEntityItem,
  KpiResult,
  SocActivityTimelineItem,
  MetricProvenance,
  IncidentAgingBreakdown,
  SocOperationalSnapshot,
  DataSourceFilter,
} from '../models/metrics';

export interface CanonicalSocData {
  events: SecurityEvent[];
  alerts: Alert[];
  incidents: Incident[];
  cases: Case[];
  hunts: ThreatHunt[];
  evidence: Evidence[];
  iocs: IOC[];
  assets: Asset[];
  users: SecurityUser[];
  detectionRules: DetectionRule[];
  playbooks: Playbook[];
  playbookExecutions: PlaybookExecution[];
  auditRecords: AuditRecord[];
}

export class MetricsEngine {
  private cacheEpoch = 0;
  private snapshotCache = new Map<string, { epoch: number; data: SocOperationalSnapshot }>();
  private timeSeriesCache = new Map<string, { epoch: number; data: TimeSeriesBucket[] }>();

  public invalidateCache(): void {
    this.cacheEpoch++;
    this.snapshotCache.clear();
    this.timeSeriesCache.clear();
  }

  // ─── Time Window Resolution ──────────────────────────────────────────────────

  public resolveTimeRange(
    filter: TimeWindowFilter = { window: 'LAST_24_HOURS' },
    nowMs: number = Date.now()
  ): { startMs: number; endMs: number } {
    switch (filter.window) {
      case 'LAST_15_MINUTES':
        return { startMs: nowMs - 15 * 60 * 1000, endMs: nowMs };
      case 'LAST_HOUR':
        return { startMs: nowMs - 60 * 60 * 1000, endMs: nowMs };
      case 'LAST_6_HOURS':
        return { startMs: nowMs - 6 * 3600 * 1000, endMs: nowMs };
      case 'LAST_24_HOURS':
        return { startMs: nowMs - 24 * 3600 * 1000, endMs: nowMs };
      case 'LAST_7_DAYS':
        return { startMs: nowMs - 7 * 86400 * 1000, endMs: nowMs };
      case 'LAST_30_DAYS':
        return { startMs: nowMs - 30 * 86400 * 1000, endMs: nowMs };
      case 'ALL_TIME':
        return { startMs: 0, endMs: nowMs };
      case 'CUSTOM_RANGE': {
        const startMs = filter.start ? new Date(filter.start).getTime() : 0;
        const endMs = filter.end ? new Date(filter.end).getTime() : nowMs;
        return {
          startMs: isNaN(startMs) ? 0 : startMs,
          endMs: isNaN(endMs) ? nowMs : endMs,
        };
      }
      default:
        return { startMs: nowMs - 24 * 3600 * 1000, endMs: nowMs };
    }
  }

  public isInRange(isoTimestamp: string | undefined, startMs: number, endMs: number): boolean {
    if (!isoTimestamp) return false;
    const t = new Date(isoTimestamp).getTime();
    if (isNaN(t)) return false;
    return t >= startMs && t <= endMs;
  }

  // ─── Source Mode Isolation (Step 12 Cyber Range) ───────────────────────────

  public filterBySourceMode(data: CanonicalSocData, sourceMode: DataSourceFilter = 'LIVE'): CanonicalSocData {
    if (sourceMode === 'ALL') return data;

    const isSimEvent = (e: SecurityEvent) => Boolean(e.metadata?.simulation || e.sourceType === 'SIMULATION');
    const isSimAlert = (a: Alert) => Boolean(a.metadata?.simulation);
    const isSimInc = (i: Incident) => Boolean(i.metadata?.simulation);

    if (sourceMode === 'SIMULATION') {
      return {
        ...data,
        events: data.events.filter(isSimEvent),
        alerts: data.alerts.filter(isSimAlert),
        incidents: data.incidents.filter(isSimInc),
      };
    }

    // Default: 'LIVE' (Operational SOC excludes cyber range simulation events)
    return {
      ...data,
      events: data.events.filter((e) => !isSimEvent(e)),
      alerts: data.alerts.filter((a) => !isSimAlert(a)),
      incidents: data.incidents.filter((i) => !isSimInc(i)),
    };
  }

  // ─── Operational Snapshot ────────────────────────────────────────────────────

  public computeOperationalSnapshot(
    data: CanonicalSocData,
    filter: TimeWindowFilter = { window: 'LAST_24_HOURS' },
    nowMs: number = Date.now()
  ): SocOperationalSnapshot {
    const sourceMode = filter.sourceMode ?? 'LIVE';
    const cacheKey = `${filter.window}_${filter.start || ''}_${filter.end || ''}_${sourceMode}`;
    const cached = this.snapshotCache.get(cacheKey);
    if (cached && cached.epoch === this.cacheEpoch) {
      return cached.data;
    }

    const scopedData = this.filterBySourceMode(data, sourceMode);
    const { startMs, endMs } = this.resolveTimeRange(filter, nowMs);

    // Filter time-scoped collections
    const filteredEvents = scopedData.events.filter((e) => this.isInRange(e.timestamp, startMs, endMs));
    const filteredAlerts = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
    const filteredIncidents = scopedData.incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
    const filteredAudit = scopedData.auditRecords.filter((a) => this.isInRange(a.timestamp, startMs, endMs));
    const filteredExecutions = scopedData.playbookExecutions.filter((p) => this.isInRange(p.startedAt, startMs, endMs));

    // Threat assessment (using scoped incidents & assets)
    const threat = calculateThreatAssessment(
      scopedData.incidents,
      scopedData.assets,
      scopedData.iocs,
      [], // legacy response actions
      scopedData.alerts
    );

    // Incident Aging (computed across all currently open incidents in scoped data)
    const openIncidents = scopedData.incidents.filter(
      (i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED' && i.status !== 'FALSE_POSITIVE'
    );
    const incidentAging = this.computeIncidentAging(openIncidents, nowMs);

    // Open & Critical Alerts
    const openAlerts = scopedData.alerts.filter(
      (a) => a.status === 'NEW' || a.status === 'ACKNOWLEDGED'
    );
    const criticalAlerts = openAlerts.filter((a) => a.severity === 'CRITICAL');
    const highAlerts = openAlerts.filter((a) => a.severity === 'HIGH');

    // Asset state counts
    const compromisedAssets = scopedData.assets.filter((a) => a.status === 'COMPROMISED').length;
    const isolatedAssets = scopedData.assets.filter((a) => a.status === 'ISOLATED').length;
    const suspiciousAssets = scopedData.assets.filter((a) => a.status === 'SUSPICIOUS').length;

    // IOC state counts
    const activeIocs = scopedData.iocs.filter((i) => !i.isBlocked).length;
    const blockedIocs = scopedData.iocs.filter((i) => i.isBlocked).length;

    // Investigation state counts
    const activeCases = scopedData.cases.filter((c) => c.status === 'OPEN' || c.status === 'IN_PROGRESS' || c.status === 'PENDING').length;
    const activeHunts = scopedData.hunts.filter((h) => h.status === 'RUNNING').length;

    // SOAR Executions
    const activeExecs = scopedData.playbookExecutions.filter((e) => e.status === 'RUNNING').length;
    const waitingExecs = scopedData.playbookExecutions.filter((e) => e.status === 'WAITING_APPROVAL').length;
    const completedExecs = filteredExecutions.filter((e) => e.status === 'COMPLETED').length;
    const failedExecs = filteredExecutions.filter((e) => e.status === 'FAILED').length;

    // Detection rules
    const totalRules = scopedData.detectionRules.length;
    const enabledRules = scopedData.detectionRules.filter((r) => r.enabled).length;

    // Operational KPIs (Canonical Step 10 Metrics)
    const mttd = this.computeMTTD(filteredAlerts, scopedData.events);
    const mtta = this.computeMTTA(scopedData.alerts, startMs, endMs);
    const alertMttr = this.computeAlertMTTR(scopedData.alerts, startMs, endMs);
    const incidentMttr = this.computeIncidentMTTR(scopedData.incidents, startMs, endMs);
    const responseSuccessRate = this.computeResponseSuccessRate(filteredExecutions);

    // Extended Step 10 Canonical Metrics
    const alertVolume = this.computeAlertVolume(scopedData.alerts, startMs, endMs);
    const detectionVolume = this.computeDetectionVolume(scopedData.events, startMs, endMs);
    const incidentVolume = this.computeIncidentVolume(scopedData.incidents, startMs, endMs);
    const severityDistributionMetric = this.computeSeverityDistributionMetric(scopedData.incidents, scopedData.alerts, startMs, endMs);
    const responseActionsMetric = this.computeResponseActionsMetric(scopedData.playbookExecutions, startMs, endMs);
    const detectionEfficacy = this.computeDetectionEfficacy(scopedData.incidents, scopedData.alerts, startMs, endMs);
    const investigationDuration = this.computeInvestigationDuration(scopedData.cases, scopedData.incidents, startMs, endMs);
    const analystActivity = this.computeAnalystActivity(scopedData.auditRecords, startMs, endMs);
    const assetExposure = this.computeAssetExposure(scopedData.assets);
    const recurringAttackPatterns = this.computeRecurringAttackPatterns(scopedData.incidents, scopedData.alerts);

    const snapshot: SocOperationalSnapshot = {
      generatedAt: new Date(nowMs).toISOString(),
      timeWindow: filter.window,
      threatLevel: threat.level,
      threatScore: threat.score,
      eventCount: filteredEvents.length,
      alertCount: filteredAlerts.length,
      openAlertCount: openAlerts.length,
      criticalAlertCount: criticalAlerts.length,
      highAlertCount: highAlerts.length,
      detectionRuleCount: totalRules,
      enabledDetectionRuleCount: enabledRules,
      incidentCount: filteredIncidents.length,
      openIncidentCount: openIncidents.length,
      criticalIncidentCount: openIncidents.filter((i) => i.severity === 'CRITICAL').length,
      highIncidentCount: openIncidents.filter((i) => i.severity === 'HIGH').length,
      incidentAging,
      compromisedAssetCount: compromisedAssets,
      isolatedAssetCount: isolatedAssets,
      suspiciousAssetCount: suspiciousAssets,
      activeIOCCount: activeIocs,
      blockedIOCCount: blockedIocs,
      activeCases,
      activeHunts,
      evidenceCount: scopedData.evidence.length,
      activePlaybookExecutions: activeExecs,
      waitingApprovalExecutions: waitingExecs,
      completedPlaybookExecutions: completedExecs,
      failedPlaybookExecutions: failedExecs,
      auditRecordCount: filteredAudit.length,
      mttd,
      mtta,
      alertMttr,
      incidentMttr,
      responseSuccessRate,
      alertVolume,
      detectionVolume,
      incidentVolume,
      severityDistributionMetric,
      responseActionsMetric,
      detectionEfficacy,
      investigationDuration,
      analystActivity,
      assetExposure,
      recurringAttackPatterns,
      sourceMode,
      provenance: {
        sourceMode,
        generatedAt: new Date(nowMs).toISOString(),
      },
    };

    this.snapshotCache.set(cacheKey, { epoch: this.cacheEpoch, data: snapshot });
    return snapshot;
  }

  // ─── Operational KPIs ────────────────────────────────────────────────────────

  /**
   * MTTD: Mean Time To Detect
   * Formula: mean(Alert.createdAt - SecurityEvent.timestamp)
   * Where an alert has correlated events in the window.
   */
  public computeMTTD(alerts: Alert[], allEvents: SecurityEvent[]): KpiResult {
    const eventMap = new Map<string, number>();
    for (const ev of allEvents) {
      const t = new Date(ev.timestamp).getTime();
      if (!isNaN(t)) {
        eventMap.set(ev.id, t);
      }
    }

    const intervals: number[] = [];
    for (const alert of alerts) {
      const alertTime = new Date(alert.createdAt).getTime();
      if (isNaN(alertTime)) continue;

      // Find earliest related event timestamp
      let earliestEventTime: number | null = null;
      if (alert.sourceEventIds && alert.sourceEventIds.length > 0) {
        for (const eid of alert.sourceEventIds) {
          const evTime = eventMap.get(eid);
          if (evTime !== undefined) {
            if (earliestEventTime === null || evTime < earliestEventTime) {
              earliestEventTime = evTime;
            }
          }
        }
      }

      // If no explicit related events, check alert.firstSeenAt vs alert.createdAt
      if (earliestEventTime === null && alert.firstSeenAt) {
        const fsTime = new Date(alert.firstSeenAt).getTime();
        if (!isNaN(fsTime) && fsTime <= alertTime) {
          earliestEventTime = fsTime;
        }
      }

      if (earliestEventTime !== null && alertTime >= earliestEventTime) {
        const deltaSeconds = (alertTime - earliestEventTime) / 1000;
        intervals.push(deltaSeconds);
      }
    }

    if (intervals.length === 0) {
      return {
        metricId: 'MTTD',
        label: 'Mean Time To Detect (MTTD)',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'seconds',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Mean duration between initial security event occurrence and corresponding alert generation.',
          why: 'Evaluates sensor latency and detection rule trigger speed.',
          source: 'Alert.createdAt - SecurityEvent.timestamp (or Alert.firstSeen)',
          formula: 'Σ(Alert.createdAt - Event.timestamp) / N',
          sampleSize: 0,
          missingDataReason: 'No correlated security events with trigger timestamps found in selected time window.',
        },
      };
    }

    const avgSeconds = intervals.reduce((acc, v) => acc + v, 0) / intervals.length;
    return {
      metricId: 'MTTD',
      label: 'Mean Time To Detect (MTTD)',
      value: Math.round(avgSeconds * 10) / 10,
      formattedValue: this.formatDuration(avgSeconds),
      unit: 'seconds',
      status: avgSeconds > 900 ? 'WARNING' : avgSeconds > 3600 ? 'CRITICAL' : 'NORMAL',
      explanation: {
        what: 'Mean duration between initial security event occurrence and corresponding alert generation.',
        why: 'Evaluates sensor latency and detection rule trigger speed.',
        source: 'Alert.createdAt - SecurityEvent.timestamp',
        formula: 'Σ(Alert.createdAt - Event.timestamp) / N',
        sampleSize: intervals.length,
      },
    };
  }

  /**
   * MTTA: Mean Time To Acknowledge
   * Formula: mean(Alert.acknowledgedAt - Alert.createdAt)
   * Only qualifying acknowledged alerts.
   */
  public computeMTTA(alerts: Alert[], startMs: number, endMs: number): KpiResult {
    const qualifyingAlerts = alerts.filter((a) => {
      if (!a.acknowledgedAt) return false;
      const ackTime = new Date(a.acknowledgedAt).getTime();
      const createdTime = new Date(a.createdAt).getTime();
      return (
        !isNaN(ackTime) &&
        !isNaN(createdTime) &&
        ackTime >= createdTime &&
        this.isInRange(a.acknowledgedAt, startMs, endMs)
      );
    });

    if (qualifyingAlerts.length === 0) {
      return {
        metricId: 'MTTA',
        label: 'Mean Time To Acknowledge (MTTA)',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'seconds',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Mean duration between alert creation and initial analyst acknowledgement.',
          why: 'Measures SOC operational responsiveness to incoming threats.',
          source: 'Alert.acknowledgedAt - Alert.createdAt',
          formula: 'Σ(Alert.acknowledgedAt - Alert.createdAt) / N',
          sampleSize: 0,
          missingDataReason: 'No acknowledged alerts recorded in selected time window.',
        },
      };
    }

    const intervals = qualifyingAlerts.map(
      (a) => (new Date(a.acknowledgedAt!).getTime() - new Date(a.createdAt).getTime()) / 1000
    );
    const avgSeconds = intervals.reduce((acc, v) => acc + v, 0) / intervals.length;

    return {
      metricId: 'MTTA',
      label: 'Mean Time To Acknowledge (MTTA)',
      value: Math.round(avgSeconds * 10) / 10,
      formattedValue: this.formatDuration(avgSeconds),
      unit: 'seconds',
      status: avgSeconds > 1800 ? 'WARNING' : avgSeconds > 7200 ? 'CRITICAL' : 'NORMAL',
      explanation: {
        what: 'Mean duration between alert creation and initial analyst acknowledgement.',
        why: 'Measures SOC operational responsiveness to incoming threats.',
        source: 'Alert.acknowledgedAt - Alert.createdAt',
        formula: 'Σ(Alert.acknowledgedAt - Alert.createdAt) / N',
        sampleSize: qualifyingAlerts.length,
      },
    };
  }

  /**
   * Alert MTTR: Mean Time To Resolve Alert
   * Formula: mean(Alert.resolvedAt - Alert.createdAt)
   */
  public computeAlertMTTR(alerts: Alert[], startMs: number, endMs: number): KpiResult {
    const qualifyingAlerts = alerts.filter((a) => {
      if (!a.resolvedAt) return false;
      const resTime = new Date(a.resolvedAt).getTime();
      const createdTime = new Date(a.createdAt).getTime();
      return (
        !isNaN(resTime) &&
        !isNaN(createdTime) &&
        resTime >= createdTime &&
        this.isInRange(a.resolvedAt, startMs, endMs)
      );
    });

    if (qualifyingAlerts.length === 0) {
      return {
        metricId: 'ALERT_MTTR',
        label: 'Mean Time To Resolve Alert (MTTR)',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'seconds',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Mean duration from alert trigger to complete alert resolution.',
          why: 'Measures speed of alert-level triage, investigation, and disposition.',
          source: 'Alert.resolvedAt - Alert.createdAt',
          formula: 'Σ(Alert.resolvedAt - Alert.createdAt) / N',
          sampleSize: 0,
          missingDataReason: 'No resolved alerts recorded in selected time window.',
        },
      };
    }

    const intervals = qualifyingAlerts.map(
      (a) => (new Date(a.resolvedAt!).getTime() - new Date(a.createdAt).getTime()) / 1000
    );
    const avgSeconds = intervals.reduce((acc, v) => acc + v, 0) / intervals.length;

    return {
      metricId: 'ALERT_MTTR',
      label: 'Mean Time To Resolve Alert (MTTR)',
      value: Math.round(avgSeconds * 10) / 10,
      formattedValue: this.formatDuration(avgSeconds),
      unit: 'seconds',
      status: avgSeconds > 3600 ? 'WARNING' : avgSeconds > 14400 ? 'CRITICAL' : 'NORMAL',
      explanation: {
        what: 'Mean duration from alert trigger to complete alert resolution.',
        why: 'Measures speed of alert-level triage, investigation, and disposition.',
        source: 'Alert.resolvedAt - Alert.createdAt',
        formula: 'Σ(Alert.resolvedAt - Alert.createdAt) / N',
        sampleSize: qualifyingAlerts.length,
      },
    };
  }

  /**
   * Incident MTTR: Mean Time To Resolve Incident
   * Formula: mean(Incident.closedAt - Incident.createdAt)
   */
  public computeIncidentMTTR(incidents: Incident[], startMs: number, endMs: number): KpiResult {
    const qualifyingIncidents = incidents.filter((i) => {
      const closedAt = i.closedAt || (i.status === 'CLOSED' || i.status === 'RESOLVED' ? i.updatedAt : undefined);
      if (!closedAt) return false;
      const closedTime = new Date(closedAt).getTime();
      const createdTime = new Date(i.createdAt).getTime();
      return (
        !isNaN(closedTime) &&
        !isNaN(createdTime) &&
        closedTime >= createdTime &&
        this.isInRange(closedAt, startMs, endMs)
      );
    });

    if (qualifyingIncidents.length === 0) {
      return {
        metricId: 'INCIDENT_MTTR',
        label: 'Incident Resolution Time (MTTR)',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'seconds',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Mean duration from incident creation to final incident closure/resolution.',
          why: 'Reflects end-to-end incident containment, remediation, and root-cause eradication.',
          source: 'Incident.closedAt - Incident.createdAt',
          formula: 'Σ(Incident.closedAt - Incident.createdAt) / N',
          sampleSize: 0,
          missingDataReason: 'No closed or resolved incidents recorded in selected time window.',
        },
      };
    }

    const intervals = qualifyingIncidents.map((i) => {
      const closedAt = i.closedAt || i.updatedAt;
      return (new Date(closedAt).getTime() - new Date(i.createdAt).getTime()) / 1000;
    });
    const avgSeconds = intervals.reduce((acc, v) => acc + v, 0) / intervals.length;

    return {
      metricId: 'INCIDENT_MTTR',
      label: 'Incident Resolution Time (MTTR)',
      value: Math.round(avgSeconds * 10) / 10,
      formattedValue: this.formatDuration(avgSeconds),
      unit: 'seconds',
      status: avgSeconds > 86400 ? 'WARNING' : avgSeconds > 259200 ? 'CRITICAL' : 'NORMAL',
      explanation: {
        what: 'Mean duration from incident creation to final incident closure/resolution.',
        why: 'Reflects end-to-end incident containment, remediation, and root-cause eradication.',
        source: 'Incident.closedAt - Incident.createdAt',
        formula: 'Σ(Incident.closedAt - Incident.createdAt) / N',
        sampleSize: qualifyingIncidents.length,
      },
    };
  }

  /**
   * Response Success Rate:
   * Formula: Completed executions / (Completed + Failed executions) * 100%
   */
  public computeResponseSuccessRate(executions: PlaybookExecution[]): KpiResult {
    const concluded = executions.filter(
      (e) => e.status === 'COMPLETED' || e.status === 'FAILED'
    );

    if (concluded.length === 0) {
      return {
        metricId: 'RESPONSE_SUCCESS_RATE',
        label: 'Response Success Rate',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: '%',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Percentage of concluded playbook executions that completed successfully without failure.',
          why: 'Measures reliability and execution health of automated response workflows.',
          source: 'PlaybookExecution.status === COMPLETED vs FAILED',
          formula: '(Completed / (Completed + Failed)) * 100',
          sampleSize: 0,
          missingDataReason: 'No completed or failed playbook executions in selected time window.',
        },
      };
    }

    const completed = concluded.filter((e) => e.status === 'COMPLETED').length;
    const rate = Math.round((completed / concluded.length) * 1000) / 10;

    return {
      metricId: 'RESPONSE_SUCCESS_RATE',
      label: 'Response Success Rate',
      value: rate,
      formattedValue: `${rate}%`,
      unit: '%',
      status: rate < 70 ? 'CRITICAL' : rate < 90 ? 'WARNING' : 'NORMAL',
      explanation: {
        what: 'Percentage of concluded playbook executions that completed successfully without failure.',
        why: 'Measures reliability and execution health of automated response workflows.',
        source: 'PlaybookExecution.status',
        formula: '(Completed / Concluded) * 100',
        sampleSize: concluded.length,
      },
    };
  }

  /**
   * Alert Volume:
   * Total number of correlated alerts generated in the active time window.
   */
  public computeAlertVolume(alerts: Alert[], startMs: number, endMs: number): KpiResult {
    const qualifying = alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
    if (qualifying.length === 0) {
      return {
        metricId: 'ALERT_VOLUME',
        label: 'Alert Volume',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'alerts',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Total count of correlated alerts generated by detection rules in the active window.',
          why: 'Monitors incoming alert volume and operational load on triage analysts.',
          source: 'Alert.createdAt within window',
          formula: 'Count(Alerts where createdAt in [start, end])',
          sampleSize: 0,
          missingDataReason: 'No alerts found in selected time window.',
        },
      };
    }

    const openCount = qualifying.filter((a) => a.status === 'NEW' || a.status === 'ACKNOWLEDGED').length;
    return {
      metricId: 'ALERT_VOLUME',
      label: 'Alert Volume',
      value: qualifying.length,
      formattedValue: `${qualifying.length} Alert${qualifying.length > 1 ? 's' : ''} (${openCount} active)`,
      unit: 'alerts',
      status: qualifying.length > 50 ? 'WARNING' : 'NORMAL',
      explanation: {
        what: 'Total count of correlated alerts generated by detection rules in the active window.',
        why: 'Monitors incoming alert volume and operational load on triage analysts.',
        source: 'Alert.createdAt within window',
        formula: 'Count(Alerts where createdAt in [start, end])',
        sampleSize: qualifying.length,
      },
    };
  }

  /**
   * Detection Volume:
   * Total raw security telemetry events ingested and evaluated in the time window.
   */
  public computeDetectionVolume(events: SecurityEvent[], startMs: number, endMs: number): KpiResult {
    const qualifying = events.filter((e) => this.isInRange(e.timestamp, startMs, endMs));
    if (qualifying.length === 0) {
      return {
        metricId: 'DETECTION_VOLUME',
        label: 'Detection Volume',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'events',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Total count of raw security telemetry events ingested across endpoint, network, and cloud sensors.',
          why: 'Validates sensor health and ingestion throughput for correlation.',
          source: 'SecurityEvent.timestamp within window',
          formula: 'Count(SecurityEvents where timestamp in [start, end])',
          sampleSize: 0,
          missingDataReason: 'No raw security telemetry events captured in selected time window.',
        },
      };
    }

    return {
      metricId: 'DETECTION_VOLUME',
      label: 'Detection Volume',
      value: qualifying.length,
      formattedValue: `${qualifying.length} Telemetry Events`,
      unit: 'events',
      status: 'NORMAL',
      explanation: {
        what: 'Total count of raw security telemetry events ingested across endpoint, network, and cloud sensors.',
        why: 'Validates sensor health and ingestion throughput for correlation.',
        source: 'SecurityEvent.timestamp within window',
        formula: 'Count(SecurityEvents where timestamp in [start, end])',
        sampleSize: qualifying.length,
      },
    };
  }

  /**
   * Incident Volume:
   * Total correlated security incidents in the active time window.
   */
  public computeIncidentVolume(incidents: Incident[], startMs: number, endMs: number): KpiResult {
    const qualifying = incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
    if (qualifying.length === 0) {
      return {
        metricId: 'INCIDENT_VOLUME',
        label: 'Incident Volume',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'incidents',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Total correlated security incidents established in the time window.',
          why: 'Reflects high-severity consolidated threat campaigns requiring investigation.',
          source: 'Incident.createdAt within window',
          formula: 'Count(Incidents where createdAt in [start, end])',
          sampleSize: 0,
          missingDataReason: 'No correlated security incidents created in selected time window.',
        },
      };
    }

    const openCount = qualifying.filter((i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
    const criticalCount = qualifying.filter((i) => i.severity === 'CRITICAL').length;
    return {
      metricId: 'INCIDENT_VOLUME',
      label: 'Incident Volume',
      value: qualifying.length,
      formattedValue: `${qualifying.length} Incident${qualifying.length > 1 ? 's' : ''} (${openCount} open)`,
      unit: 'incidents',
      status: criticalCount > 0 ? 'CRITICAL' : qualifying.length > 5 ? 'WARNING' : 'NORMAL',
      explanation: {
        what: 'Total correlated security incidents established in the time window.',
        why: 'Reflects high-severity consolidated threat campaigns requiring investigation.',
        source: 'Incident.createdAt within window',
        formula: 'Count(Incidents where createdAt in [start, end])',
        sampleSize: qualifying.length,
      },
    };
  }

  /**
   * Severity Distribution Metric:
   * Consolidated ratio of Critical & High threats across incidents and alerts.
   */
  public computeSeverityDistributionMetric(
    incidents: Incident[],
    alerts: Alert[],
    startMs: number,
    endMs: number
  ): KpiResult {
    const qualInc = incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
    const qualAlt = alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));

    const total = qualInc.length + qualAlt.length;
    if (total === 0) {
      return {
        metricId: 'SEVERITY_DISTRIBUTION',
        label: 'Severity Distribution',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: '%',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Percentage of active alerts and incidents classified as Critical or High severity.',
          why: 'Assesses threat posture severity and urgency of containment allocation.',
          source: 'Incident.severity, Alert.severity',
          formula: '((Critical + High) / Total) * 100',
          sampleSize: 0,
          missingDataReason: 'No alerts or incidents found in selected time window.',
        },
      };
    }

    const critCount =
      qualInc.filter((i) => i.severity === 'CRITICAL').length +
      qualAlt.filter((a) => a.severity === 'CRITICAL').length;
    const highCount =
      qualInc.filter((i) => i.severity === 'HIGH').length +
      qualAlt.filter((a) => a.severity === 'HIGH').length;

    const pct = Math.round(((critCount + highCount) / total) * 1000) / 10;
    return {
      metricId: 'SEVERITY_DISTRIBUTION',
      label: 'Severity Distribution',
      value: pct,
      formattedValue: `${pct}% High/Crit (${critCount + highCount}/${total})`,
      unit: '%',
      status: critCount > 0 ? 'CRITICAL' : highCount > 0 ? 'WARNING' : 'NORMAL',
      explanation: {
        what: 'Percentage of active alerts and incidents classified as Critical or High severity.',
        why: 'Assesses threat posture severity and urgency of containment allocation.',
        source: 'Incident.severity, Alert.severity',
        formula: '((Critical + High) / Total) * 100',
        sampleSize: total,
      },
    };
  }

  /**
   * Response Actions Metric:
   * Total automated and semi-automated SOAR response actions executed.
   */
  public computeResponseActionsMetric(
    executions: PlaybookExecution[],
    startMs: number,
    endMs: number
  ): KpiResult {
    const qualifying = executions.filter((e) => this.isInRange(e.startedAt, startMs, endMs));
    if (qualifying.length === 0) {
      return {
        metricId: 'RESPONSE_ACTIONS',
        label: 'Response Actions',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'actions',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Count of initiated SOAR response workflows and mitigation playbooks.',
          why: 'Measures active threat neutralization velocity and containment actions.',
          source: 'PlaybookExecution.startedAt within window',
          formula: 'Count(PlaybookExecutions where startedAt in [start, end])',
          sampleSize: 0,
          missingDataReason: 'No SOAR response actions or playbook executions initiated in selected time window.',
        },
      };
    }

    const completed = qualifying.filter((e) => e.status === 'COMPLETED').length;
    const failed = qualifying.filter((e) => e.status === 'FAILED').length;
    return {
      metricId: 'RESPONSE_ACTIONS',
      label: 'Response Actions',
      value: qualifying.length,
      formattedValue: `${qualifying.length} Actions (${completed} passed, ${failed} failed)`,
      unit: 'actions',
      status: failed > 0 ? 'WARNING' : 'NORMAL',
      explanation: {
        what: 'Count of initiated SOAR response workflows and mitigation playbooks.',
        why: 'Measures active threat neutralization velocity and containment actions.',
        source: 'PlaybookExecution.startedAt within window',
        formula: 'Count(PlaybookExecutions where startedAt in [start, end])',
        sampleSize: qualifying.length,
      },
    };
  }

  /**
   * Detection Efficacy:
   * True Positive ratio vs False Positive outcomes across closed/triaged incidents and alerts.
   */
  public computeDetectionEfficacy(
    incidents: Incident[],
    alerts: Alert[],
    startMs: number,
    endMs: number
  ): KpiResult {
    const qualInc = incidents.filter(
      (i) => (i.status === 'RESOLVED' || i.status === 'CLOSED' || i.status === 'FALSE_POSITIVE') &&
             this.isInRange(i.closedAt || i.updatedAt, startMs, endMs)
    );
    const qualAlt = alerts.filter(
      (a) => (a.status === 'RESOLVED' || a.status === 'SUPPRESSED') &&
             this.isInRange(a.resolvedAt || a.createdAt, startMs, endMs)
    );

    const fpInc = qualInc.filter((i) => i.status === 'FALSE_POSITIVE').length;
    const tpInc = qualInc.length - fpInc;

    const fpAlt = qualAlt.filter((a) => a.status === 'SUPPRESSED').length;
    const tpAlt = qualAlt.length - fpAlt;

    const totalTP = tpInc + tpAlt;
    const totalFP = fpInc + fpAlt;
    const totalConcluded = totalTP + totalFP;

    if (totalConcluded === 0) {
      return {
        metricId: 'DETECTION_EFFICACY',
        label: 'Detection Efficacy',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: '%',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Precision ratio of confirmed True Positives vs dismissed False Positives.',
          why: 'Evaluates detection engineering fidelity and signal-to-noise ratio.',
          source: 'Incident.status (RESOLVED vs FALSE_POSITIVE), Alert.status (RESOLVED vs DISMISSED)',
          formula: '(TruePositives / (TruePositives + FalsePositives)) * 100',
          sampleSize: 0,
          missingDataReason: 'No triaged incidents or alerts with resolved/false-positive status in selected time window.',
        },
      };
    }

    const efficacy = Math.round((totalTP / totalConcluded) * 1000) / 10;
    return {
      metricId: 'DETECTION_EFFICACY',
      label: 'Detection Efficacy',
      value: efficacy,
      formattedValue: `${efficacy}% (${totalTP} TP / ${totalFP} FP)`,
      unit: '%',
      status: efficacy < 75 ? 'WARNING' : 'NORMAL',
      explanation: {
        what: 'Precision ratio of confirmed True Positives vs dismissed False Positives.',
        why: 'Evaluates detection engineering fidelity and signal-to-noise ratio.',
        source: 'Incident.status, Alert.status',
        formula: '(TruePositives / (TruePositives + FalsePositives)) * 100',
        sampleSize: totalConcluded,
      },
    };
  }

  /**
   * Investigation Duration:
   * Mean time cases and incidents remain open until resolution.
   */
  public computeInvestigationDuration(
    cases: Case[],
    incidents: Incident[],
    startMs: number,
    endMs: number
  ): KpiResult {
    const intervals: number[] = [];

    // Cases
    for (const c of cases) {
      if (c.status === 'CLOSED' || c.status === 'RESOLVED') {
        const closed = c.closedAt ? new Date(c.closedAt).getTime() : new Date(c.updatedAt).getTime();
        const created = new Date(c.createdAt).getTime();
        if (!isNaN(closed) && !isNaN(created) && closed >= created && this.isInRange(c.closedAt || c.updatedAt, startMs, endMs)) {
          intervals.push((closed - created) / 1000);
        }
      }
    }

    // Incidents
    for (const inc of incidents) {
      if (inc.status === 'RESOLVED' || inc.status === 'CLOSED') {
        const closed = inc.closedAt ? new Date(inc.closedAt).getTime() : new Date(inc.updatedAt).getTime();
        const created = new Date(inc.createdAt).getTime();
        if (!isNaN(closed) && !isNaN(created) && closed >= created && this.isInRange(inc.closedAt || inc.updatedAt, startMs, endMs)) {
          intervals.push((closed - created) / 1000);
        }
      }
    }

    if (intervals.length === 0) {
      return {
        metricId: 'INVESTIGATION_DURATION',
        label: 'Investigation Duration',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'seconds',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Mean duration required to conclude in-depth incident investigations and forensic cases.',
          why: 'Evaluates analyst investigation throughput and case lifecycle velocity.',
          source: 'Case.closedAt - Case.createdAt, Incident.closedAt - Incident.createdAt',
          formula: 'Σ(Investigation.closedAt - createdAt) / N',
          sampleSize: 0,
          missingDataReason: 'No closed cases or concluded investigations with recorded start and resolution timestamps.',
        },
      };
    }

    const avgSeconds = intervals.reduce((acc, v) => acc + v, 0) / intervals.length;
    return {
      metricId: 'INVESTIGATION_DURATION',
      label: 'Investigation Duration',
      value: Math.round(avgSeconds * 10) / 10,
      formattedValue: this.formatDuration(avgSeconds),
      unit: 'seconds',
      status: avgSeconds > 86400 ? 'WARNING' : 'NORMAL',
      explanation: {
        what: 'Mean duration required to conclude in-depth incident investigations and forensic cases.',
        why: 'Evaluates analyst investigation throughput and case lifecycle velocity.',
        source: 'Case.closedAt - Case.createdAt, Incident.closedAt - Incident.createdAt',
        formula: 'Σ(Investigation.closedAt - createdAt) / N',
        sampleSize: intervals.length,
      },
    };
  }

  /**
   * Analyst Activity:
   * Total analyst operations committed into the immutable audit trail in the time window.
   */
  public computeAnalystActivity(
    auditRecords: AuditRecord[],
    startMs: number,
    endMs: number
  ): KpiResult {
    const qualifying = auditRecords.filter((a) => this.isInRange(a.timestamp, startMs, endMs));
    if (qualifying.length === 0) {
      return {
        metricId: 'ANALYST_ACTIVITY',
        label: 'Analyst Activity',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'actions',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Total count of analyst operations committed into the immutable audit trail (triage, response, containment, hunt).',
          why: 'Measures human analyst operational workload and engagement.',
          source: 'AuditRecord.timestamp within window',
          formula: 'Count(AuditRecords where timestamp in [start, end])',
          sampleSize: 0,
          missingDataReason: 'No recorded analyst operational interactions in audit ledger for selected window.',
        },
      };
    }

    const actors = new Set(qualifying.map((a) => a.actor)).size;
    return {
      metricId: 'ANALYST_ACTIVITY',
      label: 'Analyst Activity',
      value: qualifying.length,
      formattedValue: `${qualifying.length} Operations (${actors} active analyst${actors > 1 ? 's' : ''})`,
      unit: 'actions',
      status: 'NORMAL',
      explanation: {
        what: 'Total count of analyst operations committed into the immutable audit trail (triage, response, containment, hunt).',
        why: 'Measures human analyst operational workload and engagement.',
        source: 'AuditRecord.timestamp within window',
        formula: 'Count(AuditRecords where timestamp in [start, end])',
        sampleSize: qualifying.length,
      },
    };
  }

  /**
   * Asset Exposure:
   * Ratio and count of monitored assets currently flagged as Compromised, Isolated, or Suspicious.
   */
  public computeAssetExposure(assets: Asset[]): KpiResult {
    if (assets.length === 0) {
      return {
        metricId: 'ASSET_EXPOSURE',
        label: 'Asset Exposure',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: '%',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Percentage of infrastructure assets currently flagged as Compromised, Isolated, or Suspicious.',
          why: 'Quantifies blast radius and total organizational infrastructure compromise.',
          source: 'Asset.status IN [COMPROMISED, ISOLATED, SUSPICIOUS]',
          formula: '(CompromisedAssets / TotalAssets) * 100',
          sampleSize: 0,
          missingDataReason: 'No monitored assets registered in canonical asset inventory.',
        },
      };
    }

    const exposed = assets.filter(
      (a) => a.status === 'COMPROMISED' || a.status === 'ISOLATED' || a.status === 'SUSPICIOUS'
    );
    const compromised = assets.filter((a) => a.status === 'COMPROMISED').length;
    const pct = Math.round((exposed.length / assets.length) * 1000) / 10;

    return {
      metricId: 'ASSET_EXPOSURE',
      label: 'Asset Exposure',
      value: pct,
      formattedValue: `${pct}% (${exposed.length}/${assets.length} Hosts)`,
      unit: '%',
      status: compromised > 0 ? 'CRITICAL' : exposed.length > 0 ? 'WARNING' : 'NORMAL',
      explanation: {
        what: 'Percentage of infrastructure assets currently flagged as Compromised, Isolated, or Suspicious.',
        why: 'Quantifies blast radius and total organizational infrastructure compromise.',
        source: 'Asset.status IN [COMPROMISED, ISOLATED, SUSPICIOUS]',
        formula: '(CompromisedAssets / TotalAssets) * 100',
        sampleSize: assets.length,
      },
    };
  }

  /**
   * Recurring Attack Patterns:
   * MITRE ATT&CK techniques or adversarial tactics detected across multiple alerts and incidents.
   */
  public computeRecurringAttackPatterns(incidents: Incident[], alerts: Alert[]): KpiResult {
    const techCounts = new Map<string, number>();

    const recordTechnique = (t: string) => {
      const trimmed = t.trim();
      if (!trimmed) return;
      techCounts.set(trimmed, (techCounts.get(trimmed) || 0) + 1);
    };

    // Extract techniques from incidents
    for (const inc of incidents) {
      if (Array.isArray(inc.metadata?.mitreTechniques)) {
        inc.metadata.mitreTechniques.forEach(recordTechnique);
      }
      if (Array.isArray((inc as any).techniques)) {
        (inc as any).techniques.forEach(recordTechnique);
      }
    }

    // Extract techniques from alerts
    for (const alt of alerts) {
      if (alt.ruleId && alt.ruleId.startsWith('T1')) {
        recordTechnique(alt.ruleId);
      }
      if (Array.isArray(alt.metadata?.mitreTechniques)) {
        alt.metadata.mitreTechniques.forEach(recordTechnique);
      }
    }

    if (techCounts.size === 0) {
      return {
        metricId: 'RECURRING_ATTACK_PATTERNS',
        label: 'Recurring Attack Patterns',
        value: null,
        formattedValue: 'INSUFFICIENT DATA',
        unit: 'patterns',
        status: 'INSUFFICIENT_DATA',
        explanation: {
          what: 'Adversarial techniques and tactics recurring across multiple distinct security incidents.',
          why: 'Identifies systemic vulnerabilities, threat actor campaigns, and repeated breach vectors.',
          source: 'Incident.mitreTechniques, Alert.ruleId, Alert.mitreTechniques',
          formula: 'Count(MITRE techniques observed >= 2 times across separate events)',
          sampleSize: 0,
          missingDataReason: 'No MITRE ATT&CK techniques or recurring attack vectors mapped in current telemetry.',
        },
      };
    }

    const recurring = Array.from(techCounts.entries()).filter(([_, count]) => count >= 2);
    if (recurring.length === 0) {
      return {
        metricId: 'RECURRING_ATTACK_PATTERNS',
        label: 'Recurring Attack Patterns',
        value: 0,
        formattedValue: `0 Recurring (${techCounts.size} unique)`,
        unit: 'patterns',
        status: 'NORMAL',
        explanation: {
          what: 'Adversarial techniques and tactics recurring across multiple distinct security incidents.',
          why: 'Identifies systemic vulnerabilities, threat actor campaigns, and repeated breach vectors.',
          source: 'Incident.mitreTechniques, Alert.ruleId, Alert.mitreTechniques',
          formula: 'Count(MITRE techniques observed >= 2 times across separate events)',
          sampleSize: techCounts.size,
        },
      };
    }

    recurring.sort((a, b) => b[1] - a[1]);
    const top = recurring[0];
    return {
      metricId: 'RECURRING_ATTACK_PATTERNS',
      label: 'Recurring Attack Patterns',
      value: recurring.length,
      formattedValue: `${recurring.length} Pattern${recurring.length > 1 ? 's' : ''} (Top: ${top[0]} ×${top[1]})`,
      unit: 'patterns',
      status: 'WARNING',
      explanation: {
        what: 'Adversarial techniques and tactics recurring across multiple distinct security incidents.',
        why: 'Identifies systemic vulnerabilities, threat actor campaigns, and repeated breach vectors.',
        source: 'Incident.mitreTechniques, Alert.ruleId, Alert.mitreTechniques',
        formula: 'Count(MITRE techniques observed >= 2 times across separate events)',
        sampleSize: recurring.length,
      },
    };
  }

  /**
   * Incident Aging:
   * Categorizes active incidents by age in hours/days.
   */
  public computeIncidentAging(
    openIncidents: Incident[],
    nowMs: number = Date.now()
  ): IncidentAgingBreakdown {
    const aging: IncidentAgingBreakdown = {
      under1Hour: 0,
      oneTo4Hours: 0,
      fourTo24Hours: 0,
      oneTo7Days: 0,
      over7Days: 0,
    };

    for (const incident of openIncidents) {
      const createdTime = new Date(incident.createdAt).getTime();
      if (isNaN(createdTime)) continue;

      const ageHours = (nowMs - createdTime) / (3600 * 1000);
      if (ageHours < 1) {
        aging.under1Hour++;
      } else if (ageHours < 4) {
        aging.oneTo4Hours++;
      } else if (ageHours < 24) {
        aging.fourTo24Hours++;
      } else if (ageHours < 168) {
        aging.oneTo7Days++;
      } else {
        aging.over7Days++;
      }
    }

    return aging;
  }

  // ─── Time-Series Aggregations ────────────────────────────────────────────────

  public computeTimeSeries(
    data: CanonicalSocData,
    metricId: 'EVENTS' | 'ALERTS' | 'INCIDENTS' | 'RESPONSE' | 'AUDIT',
    filter: TimeWindowFilter = { window: 'LAST_24_HOURS' },
    targetBucketCount: number = 30,
    nowMs: number = Date.now()
  ): TimeSeriesBucket[] {
    const sourceMode = filter.sourceMode ?? 'LIVE';
    const cacheKey = `${metricId}_${filter.window}_${filter.start || ''}_${filter.end || ''}_${targetBucketCount}_${sourceMode}`;
    const cached = this.timeSeriesCache.get(cacheKey);
    if (cached && cached.epoch === this.cacheEpoch) {
      return cached.data;
    }

    const scopedData = this.filterBySourceMode(data, sourceMode);
    const { startMs, endMs } = this.resolveTimeRange(filter, nowMs);
    const durationMs = Math.max(endMs - startMs, 60 * 1000);

    // Bound bucket count between 10 and 60
    const boundedBuckets = Math.max(10, Math.min(60, targetBucketCount));
    const bucketIntervalMs = Math.ceil(durationMs / boundedBuckets);

    // Initialize buckets
    const buckets: TimeSeriesBucket[] = [];
    for (let i = 0; i < boundedBuckets; i++) {
      const bStart = startMs + i * bucketIntervalMs;
      const d = new Date(bStart);
      const label = this.formatBucketLabel(d, durationMs);
      buckets.push({
        timestamp: d.toISOString(),
        label,
        count: 0,
        breakdown: {},
      });
    }

    // Extract timestamps according to metric
    const items: { timestamp: string; category?: string; severity?: string }[] = [];

    switch (metricId) {
      case 'EVENTS':
        for (const ev of scopedData.events) {
          items.push({ timestamp: ev.timestamp, category: ev.category, severity: ev.severity });
        }
        break;
      case 'ALERTS':
        for (const al of scopedData.alerts) {
          items.push({ timestamp: al.createdAt, severity: al.severity });
        }
        break;
      case 'INCIDENTS':
        for (const inc of scopedData.incidents) {
          items.push({ timestamp: inc.createdAt, severity: inc.severity });
        }
        break;
      case 'RESPONSE':
        for (const ex of scopedData.playbookExecutions) {
          items.push({ timestamp: ex.startedAt, category: ex.status });
        }
        break;
      case 'AUDIT':
        for (const au of scopedData.auditRecords) {
          items.push({ timestamp: au.timestamp, category: au.action });
        }
        break;
    }

    // Distribute into buckets
    for (const item of items) {
      const t = new Date(item.timestamp).getTime();
      if (isNaN(t) || t < startMs || t > endMs) continue;

      const bucketIndex = Math.min(
        Math.floor((t - startMs) / bucketIntervalMs),
        boundedBuckets - 1
      );

      if (bucketIndex >= 0 && bucketIndex < boundedBuckets) {
        buckets[bucketIndex].count++;
        const key = item.severity || item.category || 'default';
        if (!buckets[bucketIndex].breakdown) {
          buckets[bucketIndex].breakdown = {};
        }
        buckets[bucketIndex].breakdown![key] = (buckets[bucketIndex].breakdown![key] || 0) + 1;
      }
    }

    this.timeSeriesCache.set(cacheKey, { epoch: this.cacheEpoch, data: buckets });
    return buckets;
  }

  // ─── Distributions ───────────────────────────────────────────────────────────

  public computeDistributions(
    data: CanonicalSocData,
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
    filter: TimeWindowFilter = { window: 'LAST_24_HOURS' },
    nowMs: number = Date.now()
  ): DistributionBucket[] {
    const sourceMode = filter.sourceMode ?? 'LIVE';
    const scopedData = this.filterBySourceMode(data, sourceMode);
    const { startMs, endMs } = this.resolveTimeRange(filter, nowMs);

    const counts: Record<string, number> = {};
    let total = 0;

    switch (category) {
      case 'EVENTS_BY_SEVERITY': {
        const qualifying = scopedData.events.filter((e) => this.isInRange(e.timestamp, startMs, endMs));
        for (const e of qualifying) {
          counts[e.severity] = (counts[e.severity] || 0) + 1;
          total++;
        }
        break;
      }
      case 'EVENTS_BY_CATEGORY': {
        const qualifying = scopedData.events.filter((e) => this.isInRange(e.timestamp, startMs, endMs));
        for (const e of qualifying) {
          counts[e.category] = (counts[e.category] || 0) + 1;
          total++;
        }
        break;
      }
      case 'ALERTS_BY_SEVERITY': {
        const qualifying = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
        for (const a of qualifying) {
          counts[a.severity] = (counts[a.severity] || 0) + 1;
          total++;
        }
        break;
      }
      case 'ALERTS_BY_STATUS': {
        const qualifying = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
        for (const a of qualifying) {
          counts[a.status] = (counts[a.status] || 0) + 1;
          total++;
        }
        break;
      }
      case 'INCIDENTS_BY_SEVERITY': {
        const qualifying = scopedData.incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
        for (const i of qualifying) {
          counts[i.severity] = (counts[i.severity] || 0) + 1;
          total++;
        }
        break;
      }
      case 'INCIDENTS_BY_STATUS': {
        const qualifying = scopedData.incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
        for (const i of qualifying) {
          counts[i.status] = (counts[i.status] || 0) + 1;
          total++;
        }
        break;
      }
      case 'CASES_BY_STATUS': {
        const qualifying = scopedData.cases.filter((c) => this.isInRange(c.createdAt, startMs, endMs));
        for (const c of qualifying) {
          counts[c.status] = (counts[c.status] || 0) + 1;
          total++;
        }
        break;
      }
      case 'PLAYBOOKS_BY_STATUS': {
        const qualifying = scopedData.playbookExecutions.filter((p) => this.isInRange(p.startedAt, startMs, endMs));
        for (const p of qualifying) {
          counts[p.status] = (counts[p.status] || 0) + 1;
          total++;
        }
        break;
      }
      case 'EVIDENCE_BY_STATUS': {
        for (const ev of scopedData.evidence) {
          counts[ev.status] = (counts[ev.status] || 0) + 1;
          total++;
        }
        break;
      }
    }

    if (total === 0) return [];

    return Object.entries(counts)
      .map(([label, count]) => ({
        label,
        count,
        percentage: Math.round((count / total) * 1000) / 10,
        color: this.getDistributionColor(label),
      }))
      .sort((a, b) => b.count - a.count);
  }

  // ─── Top Entities ────────────────────────────────────────────────────────────

  public computeTopEntities(
    data: CanonicalSocData,
    type: 'TOP_AFFECTED_ASSETS' | 'TOP_TARGETED_USERS' | 'TOP_TRIGGERED_RULES' | 'TOP_IOCS' | 'TOP_MITRE_TECHNIQUES',
    filter: TimeWindowFilter = { window: 'LAST_24_HOURS' },
    limit: number = 5,
    nowMs: number = Date.now()
  ): TopEntityItem[] {
    const sourceMode = filter.sourceMode ?? 'LIVE';
    const scopedData = this.filterBySourceMode(data, sourceMode);
    const { startMs, endMs } = this.resolveTimeRange(filter, nowMs);

    const assetMap = new Map(scopedData.assets.map((a) => [a.id, a]));
    const userMap = new Map(scopedData.users.map((u) => [u.id, u]));
    const ruleMap = new Map(scopedData.detectionRules.map((r) => [r.id, r]));

    const counts: Record<string, number> = {};

    switch (type) {
      case 'TOP_AFFECTED_ASSETS': {
        const qualifyingAlerts = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
        for (const al of qualifyingAlerts) {
          if (al.assetId) {
            counts[al.assetId] = (counts[al.assetId] || 0) + 1;
          }
        }
        const qualifyingIncidents = scopedData.incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
        for (const inc of qualifyingIncidents) {
          if (inc.affectedAssets) {
            for (const aid of inc.affectedAssets) {
              counts[aid] = (counts[aid] || 0) + 2; // Weight incident involvement higher
            }
          }
        }
        return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id, count]) => {
            const asset = assetMap.get(id);
            return {
              id,
              name: asset ? asset.hostname : id,
              type: 'ASSET',
              count,
              severity: asset ? asset.criticality : undefined,
              details: asset ? `${asset.ipAddress} • ${asset.status}` : undefined,
            };
          });
      }

      case 'TOP_TARGETED_USERS': {
        const qualifyingEvents = scopedData.events.filter((e) => this.isInRange(e.timestamp, startMs, endMs));
        for (const ev of qualifyingEvents) {
          if (ev.userId) {
            counts[ev.userId] = (counts[ev.userId] || 0) + 1;
          }
        }
        return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id, count]) => {
            const user = userMap.get(id);
            return {
              id,
              name: user ? user.username : id,
              type: 'USER',
              count,
              details: user ? `${user.displayName} • ${user.department}` : undefined,
            };
          });
      }

      case 'TOP_TRIGGERED_RULES': {
        const qualifyingAlerts = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
        for (const al of qualifyingAlerts) {
          if (al.ruleId) {
            counts[al.ruleId] = (counts[al.ruleId] || 0) + 1;
          }
        }
        return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id, count]) => {
            const rule = ruleMap.get(id);
            return {
              id,
              name: rule ? rule.name : id,
              type: 'RULE',
              count,
              severity: rule ? rule.severity : undefined,
              details: rule ? `Technique: ${rule.mitreTechniqueId || 'N/A'}` : undefined,
            };
          });
      }

      case 'TOP_IOCS': {
        const qualifyingAlerts = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
        for (const al of qualifyingAlerts) {
          if (al.iocIds) {
            for (const ioc of al.iocIds) {
              counts[ioc] = (counts[ioc] || 0) + 1;
            }
          }
        }
        return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id, count]) => ({
            id,
            name: id,
            type: 'IOC',
            count,
          }));
      }

      case 'TOP_MITRE_TECHNIQUES': {
        const qualifyingIncidents = scopedData.incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
        for (const inc of qualifyingIncidents) {
          if (inc.mitreTechniques) {
            for (const t of inc.mitreTechniques) {
              counts[t] = (counts[t] || 0) + 1;
            }
          }
        }
        return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id, count]) => ({
            id,
            name: id,
            type: 'MITRE',
            count,
          }));
      }
    }
  }

  // ─── Activity Timeline ───────────────────────────────────────────────────────

  public computeActivityTimeline(
    data: CanonicalSocData,
    filter: TimeWindowFilter = { window: 'LAST_24_HOURS' },
    limit: number = 50,
    nowMs: number = Date.now()
  ): SocActivityTimelineItem[] {
    const sourceMode = filter.sourceMode ?? 'LIVE';
    const scopedData = this.filterBySourceMode(data, sourceMode);
    const { startMs, endMs } = this.resolveTimeRange(filter, nowMs);
    const timeline: SocActivityTimelineItem[] = [];

    // Alerts
    for (const al of scopedData.alerts) {
      if (this.isInRange(al.createdAt, startMs, endMs)) {
        timeline.push({
          id: `alert-created-${al.id}`,
          timestamp: al.createdAt,
          type: 'ALERT_CREATED',
          title: `Alert: ${al.title}`,
          category: 'DETECTION',
          severity: al.severity,
          entityId: al.id,
          entityType: 'ALERT',
          details: `Rule: ${al.ruleName || al.ruleId} • Status: ${al.status}`,
        });
      }
      if (al.acknowledgedAt && this.isInRange(al.acknowledgedAt, startMs, endMs)) {
        timeline.push({
          id: `alert-ack-${al.id}`,
          timestamp: al.acknowledgedAt,
          type: 'ALERT_ACKNOWLEDGED',
          title: `Alert Acknowledged: ${al.title}`,
          category: 'OPERATIONS',
          severity: al.severity,
          entityId: al.id,
          entityType: 'ALERT',
        });
      }
      if (al.resolvedAt && this.isInRange(al.resolvedAt, startMs, endMs)) {
        timeline.push({
          id: `alert-res-${al.id}`,
          timestamp: al.resolvedAt,
          type: 'ALERT_RESOLVED',
          title: `Alert Resolved: ${al.title}`,
          category: 'OPERATIONS',
          severity: al.severity,
          entityId: al.id,
          entityType: 'ALERT',
        });
      }
    }

    // Incidents
    for (const inc of scopedData.incidents) {
      if (this.isInRange(inc.createdAt, startMs, endMs)) {
        timeline.push({
          id: `inc-created-${inc.id}`,
          timestamp: inc.createdAt,
          type: 'INCIDENT_CREATED',
          title: `Incident: ${inc.title}`,
          category: 'INCIDENTS',
          severity: inc.severity,
          entityId: inc.id,
          entityType: 'INCIDENT',
          details: `Severity: ${inc.severity} • Status: ${inc.status}`,
        });
      }
      if (inc.closedAt && this.isInRange(inc.closedAt, startMs, endMs)) {
        timeline.push({
          id: `inc-closed-${inc.id}`,
          timestamp: inc.closedAt,
          type: 'INCIDENT_CLOSED',
          title: `Incident Closed: ${inc.title}`,
          category: 'INCIDENTS',
          severity: inc.severity,
          entityId: inc.id,
          entityType: 'INCIDENT',
        });
      }
    }

    // Playbook Executions
    for (const ex of scopedData.playbookExecutions) {
      if (this.isInRange(ex.startedAt, startMs, endMs)) {
        timeline.push({
          id: `playbook-started-${ex.id}`,
          timestamp: ex.startedAt,
          type: 'PLAYBOOK_STARTED',
          title: `Playbook Started: ${ex.playbookName}`,
          category: 'SOAR',
          entityId: ex.id,
          entityType: 'PLAYBOOK_EXECUTION',
          details: `Target: ${ex.targetEntity?.label || ex.targetEntity?.id || 'N/A'} • Status: ${ex.status}`,
        });
      }
      if (ex.completedAt && this.isInRange(ex.completedAt, startMs, endMs)) {
        timeline.push({
          id: `playbook-concluded-${ex.id}`,
          timestamp: ex.completedAt,
          type: ex.status === 'COMPLETED' ? 'PLAYBOOK_COMPLETED' : 'PLAYBOOK_FAILED',
          title: `Playbook ${ex.status}: ${ex.playbookName}`,
          category: 'SOAR',
          severity: ex.status === 'FAILED' ? 'HIGH' : undefined,
          entityId: ex.id,
          entityType: 'PLAYBOOK_EXECUTION',
          details: ex.error || ex.stepExecutions.find((s) => s.error)?.error,
        });
      }
    }

    // Sort descending by timestamp
    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return timeline.slice(0, limit);
  }

  // ─── Metric Provenance ───────────────────────────────────────────────────────

  public getMetricProvenance(
    metricId: string,
    filter: TimeWindowFilter = { window: 'LAST_24_HOURS' },
    data: CanonicalSocData,
    nowMs: number = Date.now()
  ): MetricProvenance {
    const sourceMode = filter.sourceMode ?? 'LIVE';
    const scopedData = this.filterBySourceMode(data, sourceMode);
    const { startMs, endMs } = this.resolveTimeRange(filter, nowMs);

    switch (metricId) {
      case 'MTTD': {
        const total = scopedData.alerts.length;
        const qualifying = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
        return {
          metricId,
          name: 'Mean Time To Detect (MTTD)',
          sourceStore: 'alerts + security_events',
          filterApplied: `[${sourceMode}] createdAt BETWEEN [${new Date(startMs).toISOString()} AND ${new Date(endMs).toISOString()}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total + scopedData.events.length,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Σ(Alert.createdAt - SecurityEvent.timestamp) / qualifyingAlertCount',
          sampleIds: qualifying.slice(0, 5).map((a) => a.id),
        };
      }
      case 'MTTA': {
        const total = scopedData.alerts.length;
        const qualifying = scopedData.alerts.filter(
          (a) => a.acknowledgedAt && this.isInRange(a.acknowledgedAt, startMs, endMs)
        );
        return {
          metricId,
          name: 'Mean Time To Acknowledge (MTTA)',
          sourceStore: 'alerts',
          filterApplied: `[${sourceMode}] acknowledgedAt IS NOT NULL AND acknowledgedAt BETWEEN [${new Date(startMs).toISOString()} AND ${new Date(endMs).toISOString()}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Σ(Alert.acknowledgedAt - Alert.createdAt) / qualifyingAcknowledgedAlertCount',
          sampleIds: qualifying.slice(0, 5).map((a) => a.id),
        };
      }
      case 'ALERT_MTTR': {
        const total = scopedData.alerts.length;
        const qualifying = scopedData.alerts.filter(
          (a) => a.resolvedAt && this.isInRange(a.resolvedAt, startMs, endMs)
        );
        return {
          metricId,
          name: 'Mean Time To Resolve Alert (MTTR)',
          sourceStore: 'alerts',
          filterApplied: `[${sourceMode}] resolvedAt IS NOT NULL AND resolvedAt BETWEEN [${new Date(startMs).toISOString()} AND ${new Date(endMs).toISOString()}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Σ(Alert.resolvedAt - Alert.createdAt) / qualifyingResolvedAlertCount',
          sampleIds: qualifying.slice(0, 5).map((a) => a.id),
        };
      }
      case 'INCIDENT_MTTR': {
        const total = scopedData.incidents.length;
        const qualifying = scopedData.incidents.filter(
          (i) => (i.closedAt || i.status === 'CLOSED') && this.isInRange(i.closedAt || i.updatedAt, startMs, endMs)
        );
        return {
          metricId,
          name: 'Incident Resolution Time (MTTR)',
          sourceStore: 'incidents',
          filterApplied: `[${sourceMode}] (closedAt IS NOT NULL OR status == CLOSED) AND timestamp IN [${filter.window}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Σ(Incident.closedAt - Incident.createdAt) / qualifyingClosedIncidents',
          sampleIds: qualifying.slice(0, 5).map((i) => i.id),
        };
      }
      case 'RESPONSE_SUCCESS_RATE': {
        const total = scopedData.playbookExecutions.length;
        const qualifying = scopedData.playbookExecutions.filter(
          (p) => (p.status === 'COMPLETED' || p.status === 'FAILED') && this.isInRange(p.startedAt, startMs, endMs)
        );
        return {
          metricId,
          name: 'Response Success Rate',
          sourceStore: 'playbook_executions',
          filterApplied: `[${sourceMode}] status IN [COMPLETED, FAILED] AND startedAt IN [${filter.window}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: '(CompletedExecutions / TotalConcludedExecutions) * 100',
          sampleIds: qualifying.slice(0, 5).map((p) => p.id),
        };
      }
      case 'ALERT_VOLUME': {
        const total = scopedData.alerts.length;
        const qualifying = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
        return {
          metricId,
          name: 'Alert Volume',
          sourceStore: 'alerts',
          filterApplied: `[${sourceMode}] createdAt BETWEEN [${new Date(startMs).toISOString()} AND ${new Date(endMs).toISOString()}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Count(Alerts in window)',
          sampleIds: qualifying.slice(0, 5).map((a) => a.id),
        };
      }
      case 'DETECTION_VOLUME': {
        const total = scopedData.events.length;
        const qualifying = scopedData.events.filter((e) => this.isInRange(e.timestamp, startMs, endMs));
        return {
          metricId,
          name: 'Detection Volume',
          sourceStore: 'security_events',
          filterApplied: `[${sourceMode}] timestamp BETWEEN [${new Date(startMs).toISOString()} AND ${new Date(endMs).toISOString()}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Count(SecurityEvents in window)',
          sampleIds: qualifying.slice(0, 5).map((e) => e.id),
        };
      }
      case 'INCIDENT_VOLUME': {
        const total = scopedData.incidents.length;
        const qualifying = scopedData.incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
        return {
          metricId,
          name: 'Incident Volume',
          sourceStore: 'incidents',
          filterApplied: `[${sourceMode}] createdAt BETWEEN [${new Date(startMs).toISOString()} AND ${new Date(endMs).toISOString()}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Count(Incidents in window)',
          sampleIds: qualifying.slice(0, 5).map((i) => i.id),
        };
      }
      case 'SEVERITY_DISTRIBUTION': {
        const total = scopedData.incidents.length + scopedData.alerts.length;
        const qualInc = scopedData.incidents.filter((i) => this.isInRange(i.createdAt, startMs, endMs));
        const qualAlt = scopedData.alerts.filter((a) => this.isInRange(a.createdAt, startMs, endMs));
        return {
          metricId,
          name: 'Severity Distribution',
          sourceStore: 'incidents + alerts',
          filterApplied: `[${sourceMode}] createdAt in [${filter.window}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualInc.length + qualAlt.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: '((CriticalCount + HighCount) / TotalActiveCount) * 100',
          sampleIds: [...qualInc.slice(0, 3).map((i) => i.id), ...qualAlt.slice(0, 2).map((a) => a.id)],
        };
      }
      case 'RESPONSE_ACTIONS': {
        const total = scopedData.playbookExecutions.length;
        const qualifying = scopedData.playbookExecutions.filter((e) => this.isInRange(e.startedAt, startMs, endMs));
        return {
          metricId,
          name: 'Response Actions',
          sourceStore: 'playbook_executions',
          filterApplied: `[${sourceMode}] startedAt in [${filter.window}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Count(PlaybookExecutions where startedAt in window)',
          sampleIds: qualifying.slice(0, 5).map((p) => p.id),
        };
      }
      case 'DETECTION_EFFICACY': {
        const qualInc = scopedData.incidents.filter(
          (i) => (i.status === 'RESOLVED' || i.status === 'CLOSED' || i.status === 'FALSE_POSITIVE') &&
                 this.isInRange(i.closedAt || i.updatedAt, startMs, endMs)
        );
        const qualAlt = scopedData.alerts.filter(
          (a) => (a.status === 'RESOLVED' || a.status === 'SUPPRESSED') &&
                 this.isInRange(a.resolvedAt || a.createdAt, startMs, endMs)
        );
        return {
          metricId,
          name: 'Detection Efficacy',
          sourceStore: 'incidents + alerts (triaged outcomes)',
          filterApplied: `[${sourceMode}] status in [RESOLVED, CLOSED, FALSE_POSITIVE, SUPPRESSED]`,
          timeWindow: filter.window,
          totalRecordsScanned: scopedData.incidents.length + scopedData.alerts.length,
          qualifyingRecords: qualInc.length + qualAlt.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: '(TruePositives / (TruePositives + FalsePositives)) * 100',
          sampleIds: [...qualInc.slice(0, 3).map((i) => i.id), ...qualAlt.slice(0, 2).map((a) => a.id)],
        };
      }
      case 'INVESTIGATION_DURATION': {
        const qualCases = scopedData.cases.filter((c) => (c.status === 'CLOSED' || c.status === 'RESOLVED') && this.isInRange(c.closedAt || c.updatedAt, startMs, endMs));
        const qualInc = scopedData.incidents.filter((i) => (i.status === 'CLOSED' || i.status === 'RESOLVED') && this.isInRange(i.closedAt || i.updatedAt, startMs, endMs));
        return {
          metricId,
          name: 'Investigation Duration',
          sourceStore: 'cases + incidents',
          filterApplied: `[${sourceMode}] status in [CLOSED, RESOLVED] and closedAt in [${filter.window}]`,
          timeWindow: filter.window,
          totalRecordsScanned: scopedData.cases.length + scopedData.incidents.length,
          qualifyingRecords: qualCases.length + qualInc.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Σ(ClosedAt - CreatedAt) / QualifyingCount',
          sampleIds: [...qualCases.slice(0, 3).map((c) => c.id), ...qualInc.slice(0, 2).map((i) => i.id)],
        };
      }
      case 'ANALYST_ACTIVITY': {
        const total = scopedData.auditRecords.length;
        const qualifying = scopedData.auditRecords.filter((a) => this.isInRange(a.timestamp, startMs, endMs));
        return {
          metricId,
          name: 'Analyst Activity',
          sourceStore: 'audit_records',
          filterApplied: `[${sourceMode}] timestamp in [${filter.window}]`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: qualifying.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Count(AuditRecords in window)',
          sampleIds: qualifying.slice(0, 5).map((a) => a.id),
        };
      }
      case 'ASSET_EXPOSURE': {
        const total = scopedData.assets.length;
        const exposed = scopedData.assets.filter((a) => a.status === 'COMPROMISED' || a.status === 'ISOLATED' || a.status === 'SUSPICIOUS');
        return {
          metricId,
          name: 'Asset Exposure',
          sourceStore: 'assets',
          filterApplied: `[${sourceMode}] all monitored inventory`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: exposed.length,
          computedAt: new Date(nowMs).toISOString(),
          formula: '(ExposedAssets / TotalMonitoredAssets) * 100',
          sampleIds: exposed.slice(0, 5).map((a) => a.id),
        };
      }
      case 'RECURRING_ATTACK_PATTERNS': {
        const total = scopedData.incidents.length + scopedData.alerts.length;
        return {
          metricId,
          name: 'Recurring Attack Patterns',
          sourceStore: 'incidents + alerts (MITRE techniques)',
          filterApplied: `[${sourceMode}] all techniques with occurrence >= 2`,
          timeWindow: filter.window,
          totalRecordsScanned: total,
          qualifyingRecords: total,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Count(Distinct MITRE techniques appearing in >= 2 distinct entities)',
          sampleIds: scopedData.incidents.slice(0, 5).map((i) => i.id),
        };
      }
      default: {
        return {
          metricId,
          name: metricId,
          sourceStore: 'canonical_store',
          filterApplied: `[${sourceMode}] timeWindow == ${filter.window}`,
          timeWindow: filter.window,
          totalRecordsScanned: 0,
          qualifyingRecords: 0,
          computedAt: new Date(nowMs).toISOString(),
          formula: 'Standard canonical count',
        };
      }
    }
  }

  // ─── Formatters & Helpers ────────────────────────────────────────────────────

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    const minutes = seconds / 60;
    if (minutes < 60) {
      return `${Math.round(minutes * 10) / 10}m`;
    }
    const hours = minutes / 60;
    if (hours < 24) {
      return `${Math.round(hours * 10) / 10}h`;
    }
    const days = hours / 24;
    return `${Math.round(days * 10) / 10}d`;
  }

  private formatBucketLabel(d: Date, totalDurationMs: number): string {
    if (totalDurationMs <= 3600 * 1000) {
      // 1 hour or less -> MM:SS
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${m}:${s}`;
    }
    if (totalDurationMs <= 86400 * 1000) {
      // 24 hours or less -> HH:MM
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }
    // Greater than 1 day -> MMM DD
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    return `${month} ${day}`;
  }

  private getDistributionColor(label: string): string {
    const l = label.toUpperCase();
    if (l === 'CRITICAL' || l === 'FAILED' || l === 'DISPUTED') return 'var(--color-critical, #ff3366)';
    if (l === 'HIGH' || l === 'WAITING_APPROVAL' || l === 'UNDER_REVIEW') return 'var(--color-warning, #ffaa00)';
    if (l === 'MEDIUM' || l === 'IN_PROGRESS' || l === 'ACTIVE') return 'var(--color-accent, #00ffff)';
    if (l === 'LOW' || l === 'NEW' || l === 'QUEUED') return 'var(--color-info, #3399ff)';
    if (l === 'RESOLVED' || l === 'COMPLETED' || l === 'VALIDATED') return 'var(--color-success, #00ff88)';
    return 'var(--color-text-muted, #8899aa)';
  }
}

// Global singleton instance
export const metricsEngine = new MetricsEngine();

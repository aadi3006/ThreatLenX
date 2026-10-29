/**
 * threat-level-service.ts
 *
 * Deterministic local threat level computation & canonical SOC operations snapshot.
 *
 * Requirements:
 * - 100% offline, local computation.
 * - Absolutely zero hardcoded dashboard metrics or random numbers.
 * - Consumes canonical entities from SecurityService.
 * - Single source of truth for threat-level calculation.
 */

import type { Incident, Severity } from '../models/incident';
import type { Asset, IOC } from '../models/entity';
import type { ResponseAction } from '../models/response';
import type { AuditRecord } from '../models/audit';
import type { SecurityEvent, SecurityEventStats, EventCategory } from '../models/event';
import type { Alert, AlertStats } from '../models/detection';
import { computeEventStats } from './event-engine';
import { computeAlertStats } from './detection-engine';
import type { SecurityService } from '../security-service';

export type ThreatLevel = 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

export interface ThreatFactor {
  factor: string;
  weight: number;
  contribution: number;
  description: string;
}

export interface SecurityActivityEvent {
  id: string;
  timestamp: string;
  eventType: string;
  severity: Severity;
  entityReference: string;
  actor?: string;
  description: string;
  status?: string;
  category?: EventCategory;
  source?: string;
}

export interface SecurityOperationsSnapshot {
  threatLevel: ThreatLevel;
  threatScore: number; // 0 - 100
  threatFactors: ThreatFactor[];
  criticalIncidents: number;
  activeIncidents: number;
  openAlerts: number;
  criticalAlerts: number;
  highAlerts: number;
  compromisedAssets: number;
  isolatedAssets: number;
  healthyAssets: number;
  suspiciousAssets: number;
  activeIOCs: number;
  blockedIOCs: number;
  activeResponseActions: number;
  pendingApprovals: number;
  activeInvestigations: number;
  recentEvents: SecurityActivityEvent[];
  eventStats?: SecurityEventStats;
  recentSecurityEvents?: SecurityEvent[];
  alerts?: Alert[];
  alertStats?: AlertStats;
  timestamp: string;
}

/**
 * Deterministic algorithm computing threat score (0-100) and mapping to ThreatLevel.
 *
 * Scoring breakdown:
 * - Active CRITICAL incident: +30 pts each
 * - Active HIGH incident:     +15 pts each
 * - Active MEDIUM incident:   +5 pts each
 * - Compromised asset:        +20 pts each
 * - Isolated asset:           +5 pts each
 * - Suspicious asset:         +5 pts each
 * - Active (unblocked) IOC:   +5 pts each (if rep >= 75: +10 pts)
 * - Pending Response Action:  +5 pts each
 * - Total score clamped to 100.
 *
 * Level Mapping:
 * - CRITICAL: >= 80
 * - HIGH:     55 - 79
 * - ELEVATED: 25 - 54
 * - NORMAL:   0 - 24
 */
export function calculateThreatAssessment(
  incidents: Incident[],
  assets: Asset[],
  iocs: IOC[],
  responseActions: ResponseAction[],
  alerts: Alert[] = []
): { level: ThreatLevel; score: number; factors: ThreatFactor[] } {
  // Only evaluate active (unclosed) incidents
  const activeIncidents = incidents.filter(
    (i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED' && i.status !== 'FALSE_POSITIVE'
  );

  const criticalIncidents = activeIncidents.filter((i) => i.severity === 'CRITICAL');
  const highIncidents = activeIncidents.filter((i) => i.severity === 'HIGH');
  const mediumIncidents = activeIncidents.filter((i) => i.severity === 'MEDIUM');

  const compromisedAssets = assets.filter((a) => a.status === 'COMPROMISED');
  const isolatedAssets = assets.filter((a) => a.status === 'ISOLATED');
  const suspiciousAssets = assets.filter((a) => a.status === 'SUSPICIOUS');

  const unblockedIocs = iocs.filter((ioc) => !ioc.isBlocked);
  const highRepUnblockedIocs = unblockedIocs.filter((ioc) => ioc.reputationScore >= 75);

  const pendingResponses = responseActions.filter(
    (ra) => ra.status === 'PENDING_APPROVAL' || ra.status === 'REQUESTED' || ra.status === 'EXECUTING'
  );

  const factors: ThreatFactor[] = [];
  let rawScore = 0;

  if (criticalIncidents.length > 0) {
    const pts = criticalIncidents.length * 30;
    rawScore += pts;
    factors.push({
      factor: 'CRITICAL_INCIDENTS',
      weight: 30,
      contribution: pts,
      description: `${criticalIncidents.length} active critical incident(s) in progress`,
    });
  }

  if (highIncidents.length > 0) {
    const pts = highIncidents.length * 15;
    rawScore += pts;
    factors.push({
      factor: 'HIGH_INCIDENTS',
      weight: 15,
      contribution: pts,
      description: `${highIncidents.length} active high-severity incident(s)`,
    });
  }

  if (mediumIncidents.length > 0) {
    const pts = mediumIncidents.length * 5;
    rawScore += pts;
    factors.push({
      factor: 'MEDIUM_INCIDENTS',
      weight: 5,
      contribution: pts,
      description: `${mediumIncidents.length} active medium-severity incident(s)`,
    });
  }

  if (compromisedAssets.length > 0) {
    const pts = compromisedAssets.length * 20;
    rawScore += pts;
    factors.push({
      factor: 'COMPROMISED_ASSETS',
      weight: 20,
      contribution: pts,
      description: `${compromisedAssets.length} compromised host/server asset(s)`,
    });
  }

  if (isolatedAssets.length > 0) {
    const pts = isolatedAssets.length * 5;
    rawScore += pts;
    factors.push({
      factor: 'ISOLATED_ASSETS',
      weight: 5,
      contribution: pts,
      description: `${isolatedAssets.length} isolated network node(s)`,
    });
  }

  if (suspiciousAssets.length > 0) {
    const pts = suspiciousAssets.length * 5;
    rawScore += pts;
    factors.push({
      factor: 'SUSPICIOUS_ASSETS',
      weight: 5,
      contribution: pts,
      description: `${suspiciousAssets.length} suspicious asset(s) under observation`,
    });
  }

  if (highRepUnblockedIocs.length > 0) {
    const pts = highRepUnblockedIocs.length * 10;
    rawScore += pts;
    factors.push({
      factor: 'ACTIVE_HIGH_RISK_IOCS',
      weight: 10,
      contribution: pts,
      description: `${highRepUnblockedIocs.length} active unblocked high-reputation threat IOC(s)`,
    });
  }

  if (pendingResponses.length > 0) {
    const pts = pendingResponses.length * 5;
    rawScore += pts;
    factors.push({
      factor: 'ACTIVE_RESPONSE_ACTIONS',
      weight: 5,
      contribution: pts,
      description: `${pendingResponses.length} active or pending response action(s)`,
    });
  }

  const activeCriticalAlerts = alerts.filter(
    (a) => a.severity === 'CRITICAL' && (a.status === 'NEW' || a.status === 'ACKNOWLEDGED')
  );
  if (activeCriticalAlerts.length > 0) {
    const pts = Math.min(25, activeCriticalAlerts.length * 8);
    rawScore += pts;
    factors.push({
      factor: 'CRITICAL_DETECTION_ALERTS',
      weight: 10,
      contribution: pts,
      description: `${activeCriticalAlerts.length} active critical detection alert(s) requiring immediate triage`,
    });
  }

  const score = Math.min(100, Math.max(0, rawScore));

  let level: ThreatLevel;
  if (score >= 80) {
    level = 'CRITICAL';
  } else if (score >= 55) {
    level = 'HIGH';
  } else if (score >= 25) {
    level = 'ELEVATED';
  } else {
    level = 'NORMAL';
  }

  return { level, score, factors };
}

/**
 * Builds the canonical SecurityOperationsSnapshot from raw domain collections.
 */
export function buildSecurityOperationsSnapshot(
  incidents: Incident[],
  assets: Asset[],
  iocs: IOC[],
  responseActions: ResponseAction[],
  auditRecords: AuditRecord[],
  events: SecurityEvent[] = [],
  alerts: Alert[] = []
): SecurityOperationsSnapshot {
  const activeIncidents = incidents.filter(
    (i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED' && i.status !== 'FALSE_POSITIVE'
  );

  const criticalIncidents = activeIncidents.filter((i) => i.severity === 'CRITICAL');
  const activeInvestigations = activeIncidents.filter((i) => i.status === 'INVESTIGATING');

  const openAlertsList = alerts.filter((a) => a.status === 'NEW' || a.status === 'ACKNOWLEDGED');
  const openAlerts = openAlertsList.length > 0
    ? openAlertsList.length
    : activeIncidents.reduce(
        (sum, inc) => sum + (inc.correlationChain ? inc.correlationChain.length : 0),
        0
      );

  const criticalAlerts = openAlertsList.filter((a) => a.severity === 'CRITICAL').length;
  const highAlerts = openAlertsList.filter((a) => a.severity === 'HIGH').length;

  const compromisedAssets = assets.filter((a) => a.status === 'COMPROMISED').length;
  const isolatedAssets = assets.filter((a) => a.status === 'ISOLATED').length;
  const healthyAssets = assets.filter((a) => a.status === 'HEALTHY').length;
  const suspiciousAssets = assets.filter((a) => a.status === 'SUSPICIOUS').length;

  const blockedIOCs = iocs.filter((ioc) => ioc.isBlocked).length;
  const activeIOCs = iocs.length - blockedIOCs;

  const activeResponseActions = responseActions.filter(
    (ra) => ra.status === 'PENDING_APPROVAL' || ra.status === 'REQUESTED' || ra.status === 'EXECUTING'
  ).length;

  const pendingApprovals = responseActions.filter(
    (ra) => ra.status === 'PENDING_APPROVAL' || ra.status === 'REQUESTED'
  ).length;

  const threat = calculateThreatAssessment(incidents, assets, iocs, responseActions, alerts);
  const eventStats = computeEventStats(events);
  const alertStats = computeAlertStats(alerts);

  // Compile recent operational events strictly from real security events & audit records
  const recentEvents: SecurityActivityEvent[] = [];

  // 1. Ingest real canonical SecurityEvents into the activity feed
  for (const ev of events.slice(0, 30)) {
    recentEvents.push({
      id: ev.id,
      timestamp: ev.timestamp,
      eventType: ev.eventType,
      severity: ev.severity,
      entityReference: ev.assetId ?? ev.userId ?? ev.domain ?? ev.srcIp ?? 'UNKNOWN',
      actor: ev.userId ?? ev.source,
      description: ev.message,
      status: ev.category,
      category: ev.category,
      source: ev.source,
    });
  }

  // 2. Map recent audit records (up to 10 most recent)
  for (const record of auditRecords.slice(-10).reverse()) {
    let sev: Severity = 'INFO';
    if (record.outcome === 'DENIED' || record.outcome === 'FAILURE') {
      sev = 'HIGH';
    } else if (record.action?.includes('QUARANTINE') || record.action?.includes('ISOLATE') || record.action?.includes('BLOCK')) {
      sev = 'MEDIUM';
    }

    recentEvents.push({
      id: record.id,
      timestamp: record.timestamp,
      eventType: record.action,
      severity: sev,
      entityReference: record.target,
      actor: record.actor,
      description: `${record.actor} executed ${record.action} on ${record.target} [${record.outcome}]`,
      status: record.outcome,
    });
  }

  // 3. Fallback to timeline events from active incidents if events are sparse
  if (recentEvents.length < 10) {
    for (const inc of activeIncidents) {
      for (const ev of (inc.timelineEvents ?? []).slice(-5)) {
        recentEvents.push({
          id: `tl-${ev.id}`,
          timestamp: ev.timestamp,
          eventType: ev.stage,
          severity: ev.severity,
          entityReference: ev.entityId ?? inc.id,
          actor: 'SYSTEM_DETECTOR',
          description: `[${inc.id}] ${ev.title}: ${ev.description}`,
          status: 'DETECTED',
        });
      }
    }
  }

  // Sort chronological descending
  recentEvents.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return {
    threatLevel: threat.level,
    threatScore: threat.score,
    threatFactors: threat.factors,
    criticalIncidents: criticalIncidents.length,
    activeIncidents: activeIncidents.length,
    openAlerts,
    criticalAlerts,
    highAlerts,
    compromisedAssets,
    isolatedAssets,
    healthyAssets,
    suspiciousAssets,
    activeIOCs,
    blockedIOCs,
    activeResponseActions,
    pendingApprovals,
    activeInvestigations: activeInvestigations.length,
    recentEvents: recentEvents.slice(0, 35),
    eventStats,
    recentSecurityEvents: events.slice(0, 50),
    alerts,
    alertStats,
    timestamp: new Date().toISOString(),
  };
}

/**
 * High-level helper to query SecurityService directly and derive the operations snapshot.
 */
export async function getSecurityOperationsSnapshot(
  service: SecurityService
): Promise<SecurityOperationsSnapshot> {
  const [incidents, assets, iocs, responseActions, auditLogs, events, alerts] = await Promise.all([
    service.getIncidents(),
    service.getAssets(),
    service.getIOCs(),
    service.getResponseActions(),
    service.getAuditLogs(),
    service.getEvents({ limit: 100 }),
    service.getAlerts({ limit: 100 }),
  ]);

  return buildSecurityOperationsSnapshot(incidents, assets, iocs, responseActions, auditLogs, events, alerts);
}

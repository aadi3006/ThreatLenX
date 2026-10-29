/**
 * correlation-engine.ts
 *
 * EXPLAIN-SEC SPATIAL — Stage 4 Correlation & Incident Creation Engine.
 *
 * Deterministically groups related SecurityEvents and Alerts into coherent
 * SecurityIncidents.
 *
 * Architectural Contracts:
 * - 100% offline, local computation. Zero external APIs or cloud SIEM calls.
 * - Pure, deterministic, explainable correlation signals (NO arbitrary AI or random weights).
 * - Human-readable reason generation: "CORRELATED BECAUSE: ...".
 * - Preserves strict domain separation: Event -> Alert -> Incident.
 * - An Alert is NOT an Incident. One incident groups multiple events/alerts.
 */

import type {
  Incident,
  IncidentPriority,
  IncidentStatus,
  TimelineEvent,
  CorrelationChainItem,
  CorrelationSignal,
  CorrelationSignalType,
  CorrelationMatchResult,
  IncidentQuery,
  Severity,
} from '../models/incident';
import type { Alert } from '../models/detection';
import type { SecurityEvent } from '../models/event';
import type { Asset, IOC } from '../models/entity';

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Minimum score required to automatically link activity to an incident or spawn a new incident */
export const AUTOMATIC_CORRELATION_THRESHOLD = 60;

/** Minimum score to consider activity as candidate correlation requiring analyst review */
export const CANDIDATE_CORRELATION_THRESHOLD = 40;

/** Default temporal proximity evaluation window (1 hour) */
export const DEFAULT_CORRELATION_TIME_WINDOW_MS = 3600000;

// ─── Kill-Chain Ordering for MITRE Progression ────────────────────────────────

const MITRE_KILL_CHAIN_ORDER: Record<string, number> = {
  'T1566': 1,     // Phishing (Initial Access)
  'T1566.001': 1,
  'T1204': 2,     // User Execution
  'T1204.002': 2,
  'T1059': 2,     // Command and Scripting
  'T1059.001': 2,
  'T1547': 3,     // Boot/Logon Autostart (Persistence)
  'T1547.001': 3,
  'T1098': 4,     // Account Manipulation (Privilege Escalation)
  'T1003': 5,     // OS Credential Dumping
  'T1003.001': 5,
  'T1110': 5,     // Brute Force
  'T1110.001': 5,
  'T1018': 6,     // Remote System Discovery
  'T1078': 7,     // Valid Accounts (Lateral Movement)
  'T1078.002': 7,
  'T1021': 7,     // Remote Services
  'T1560': 8,     // Archive Collected Data (Collection)
  'T1560.001': 8,
  'T1071': 9,     // Application Layer Protocol (C2)
  'T1071.001': 9,
  'T1048': 10,    // Exfiltration Over Alternative Protocol
  'T1048.003': 10,
  'T1490': 11,    // Inhibit System Recovery (Impact)
  'T1491': 11,    // Defacement / Ransom Note (Impact)
};

// ─── Deterministic Signal Evaluators ──────────────────────────────────────────

/**
 * Signal 1: Shared Host/Asset (Weight: 30)
 */
export function evaluateAssetSignal(
  assetIdA?: string,
  assetIdB?: string
): CorrelationSignal | null {
  if (!assetIdA || !assetIdB) return null;
  if (assetIdA.toLowerCase() === assetIdB.toLowerCase()) {
    return {
      type: 'SAME_ASSET',
      weight: 30,
      score: 30,
      description: `Same asset: ${assetIdA} (+30 pts)`,
      detail: { assetId: assetIdA },
    };
  }
  return null;
}

/**
 * Signal 2: Shared Threat Indicator (IOC) (Weight: 35)
 */
export function evaluateIocSignal(
  iocsA?: string[],
  iocsB?: string[]
): CorrelationSignal | null {
  if (!iocsA || !iocsB || iocsA.length === 0 || iocsB.length === 0) return null;

  const setB = new Set(iocsB.map((i) => i.toLowerCase()));
  const shared = iocsA.filter((i) => setB.has(i.toLowerCase()));

  if (shared.length > 0) {
    return {
      type: 'SHARED_IOC',
      weight: 35,
      score: 35,
      description: `Shared threat indicator(s): ${shared.join(', ')} (+35 pts)`,
      detail: { sharedIocs: shared },
    };
  }
  return null;
}

/**
 * Signal 3: Same User Context (Weight: 20)
 */
export function evaluateUserSignal(
  userIdA?: string,
  userIdB?: string
): CorrelationSignal | null {
  if (!userIdA || !userIdB) return null;
  if (userIdA.toLowerCase() === userIdB.toLowerCase()) {
    return {
      type: 'SAME_USER',
      weight: 20,
      score: 20,
      description: `Same user account: ${userIdA} (+20 pts)`,
      detail: { userId: userIdA },
    };
  }
  return null;
}

/**
 * Signal 4: Temporal Proximity (Weight: 15)
 * Scaled: 15 pts if <= 15 minutes, linearly decreasing to 0 at maxWindowMs.
 */
export function evaluateTemporalSignal(
  timeStrA: string,
  timeStrB: string,
  maxWindowMs: number = DEFAULT_CORRELATION_TIME_WINDOW_MS
): CorrelationSignal | null {
  const msA = Date.parse(timeStrA);
  const msB = Date.parse(timeStrB);
  if (isNaN(msA) || isNaN(msB)) return null;

  const diffMs = Math.abs(msA - msB);
  if (diffMs > maxWindowMs) return null;

  let score = 15;
  if (diffMs > 900000) {
    // Beyond 15 minutes, linear falloff to 0 at maxWindowMs
    const remainingFraction = 1 - (diffMs - 900000) / (maxWindowMs - 900000);
    score = Math.max(1, Math.round(15 * remainingFraction));
  }

  const minutes = (diffMs / 60000).toFixed(1);
  return {
    type: 'TEMPORAL_PROXIMITY',
    weight: 15,
    score,
    description: `Temporal proximity within ${minutes} min (+${score} pts)`,
    detail: { diffMs, minutes },
  };
}

/**
 * Signal 5: Shared Destination Network / C2 (Weight: 15)
 */
export function evaluateNetworkSignal(
  netA?: { dstIp?: string; domain?: string },
  netB?: { dstIp?: string; domain?: string }
): CorrelationSignal | null {
  if (!netA || !netB) return null;

  const sharedDomain =
    netA.domain && netB.domain && netA.domain.toLowerCase() === netB.domain.toLowerCase();
  const sharedIp =
    netA.dstIp && netB.dstIp && netA.dstIp.toLowerCase() === netB.dstIp.toLowerCase();

  if (sharedDomain || sharedIp) {
    const target = sharedDomain ? netA.domain : netA.dstIp;
    return {
      type: 'SHARED_DESTINATION_NETWORK',
      weight: 15,
      score: 15,
      description: `Shared network destination: ${target} (+15 pts)`,
      detail: { domain: netA.domain, dstIp: netA.dstIp },
    };
  }
  return null;
}

/**
 * Signal 6: MITRE Kill-Chain Progression (Weight: 20)
 */
export function evaluateMitreSignal(
  techA?: string,
  techB?: string
): CorrelationSignal | null {
  if (!techA || !techB) return null;
  if (techA === techB) {
    return {
      type: 'MITRE_KILL_CHAIN_PROGRESSION',
      weight: 10,
      score: 10,
      description: `Identical MITRE technique: ${techA} (+10 pts)`,
      detail: { techA, techB },
    };
  }

  const orderA = MITRE_KILL_CHAIN_ORDER[techA];
  const orderB = MITRE_KILL_CHAIN_ORDER[techB];

  if (orderA !== undefined && orderB !== undefined) {
    // If they represent different kill-chain stages within reasonable step distance
    const diff = Math.abs(orderA - orderB);
    if (diff >= 1 && diff <= 5) {
      return {
        type: 'MITRE_KILL_CHAIN_PROGRESSION',
        weight: 20,
        score: 20,
        description: `Correlated MITRE attack path: ${techA} → ${techB} (+20 pts)`,
        detail: { techA, techB, stepDiff: diff },
      };
    }
  }

  return null;
}

// ─── Pairwise Correlation Matching ───────────────────────────────────────────

export interface EntityTelemetryBundle {
  assetId?: string;
  userId?: string;
  iocIds?: string[];
  timestamp: string;
  dstIp?: string;
  domain?: string;
  mitreTechniqueId?: string;
}

/**
 * Evaluates all correlation signals between two telemetry bundles.
 */
export function evaluatePairwiseCorrelation(
  a: EntityTelemetryBundle,
  b: EntityTelemetryBundle,
  maxWindowMs: number = DEFAULT_CORRELATION_TIME_WINDOW_MS
): { score: number; signals: CorrelationSignal[]; reasons: string[] } {
  const signals: CorrelationSignal[] = [];

  const assetSig = evaluateAssetSignal(a.assetId, b.assetId);
  if (assetSig) signals.push(assetSig);

  const iocSig = evaluateIocSignal(a.iocIds, b.iocIds);
  if (iocSig) signals.push(iocSig);

  const userSig = evaluateUserSignal(a.userId, b.userId);
  if (userSig) signals.push(userSig);

  const timeSig = evaluateTemporalSignal(a.timestamp, b.timestamp, maxWindowMs);
  if (timeSig) signals.push(timeSig);

  const netSig = evaluateNetworkSignal(
    { dstIp: a.dstIp, domain: a.domain },
    { dstIp: b.dstIp, domain: b.domain }
  );
  if (netSig) signals.push(netSig);

  const mitreSig = evaluateMitreSignal(a.mitreTechniqueId, b.mitreTechniqueId);
  if (mitreSig) signals.push(mitreSig);

  // Sum scores and clamp to 100
  const rawScore = signals.reduce((sum, s) => sum + s.score, 0);
  const score = Math.min(100, Math.max(0, rawScore));
  const reasons = signals.map((s) => s.description);

  return { score, signals, reasons };
}

// ─── Incident Evaluation & Matching ──────────────────────────────────────────

/**
 * Evaluates whether an incoming Alert matches an existing active Incident.
 */
export function evaluateAlertAgainstIncident(
  alert: Alert,
  incident: Incident,
  events: SecurityEvent[] = [],
  maxWindowMs: number = DEFAULT_CORRELATION_TIME_WINDOW_MS
): CorrelationMatchResult {
  // If alert is already explicitly tagged with this incident, instant match
  if (alert.incidentId && alert.incidentId === incident.id) {
    return {
      matched: true,
      incidentId: incident.id,
      score: 100,
      reasons: [`Explicit incident binding: ${incident.id} (+100 pts)`],
      signals: [{
        type: 'MANUAL_ANALYST',
        weight: 100,
        score: 100,
        description: `Explicit binding to ${incident.id}`,
      }],
    };
  }

  // Find related events that belong to this incident
  const incidentEvents = events.filter(
    (e) => e.incidentId === incident.id || incident.eventIds?.includes(e.id)
  );

  // Compile incident entity footprint
  const incidentAssets = new Set(incident.affectedAssets);
  const incidentUsers = new Set(incident.affectedUsers);
  const incidentIocs = new Set(incident.iocs);
  const incidentTechniques = new Set(incident.mitreTechniques);

  // Compare alert with incident's footprint
  const signals: CorrelationSignal[] = [];

  // Asset match
  if (alert.assetId && incidentAssets.has(alert.assetId)) {
    signals.push({
      type: 'SAME_ASSET',
      weight: 30,
      score: 30,
      description: `Target asset ${alert.assetId} matches incident ${incident.id} (+30 pts)`,
      detail: { assetId: alert.assetId },
    });
  }

  // User match
  if (alert.userId && incidentUsers.has(alert.userId)) {
    signals.push({
      type: 'SAME_USER',
      weight: 20,
      score: 20,
      description: `User account ${alert.userId} active in incident ${incident.id} (+20 pts)`,
      detail: { userId: alert.userId },
    });
  }

  // IOC match
  if (alert.iocIds && alert.iocIds.length > 0) {
    const shared = alert.iocIds.filter((ioc) => incidentIocs.has(ioc));
    if (shared.length > 0) {
      signals.push({
        type: 'SHARED_IOC',
        weight: 35,
        score: 35,
        description: `Shared threat indicator(s): ${shared.join(', ')} (+35 pts)`,
        detail: { sharedIocs: shared },
      });
    }
  }

  // MITRE technique match or progression
  if (alert.mitreTechniqueId) {
    if (incidentTechniques.has(alert.mitreTechniqueId)) {
      signals.push({
        type: 'MITRE_KILL_CHAIN_PROGRESSION',
        weight: 15,
        score: 15,
        description: `Matching technique ${alert.mitreTechniqueId} already present in incident (+15 pts)`,
        detail: { techniqueId: alert.mitreTechniqueId },
      });
    } else {
      // Check kill chain progression with any technique in incident
      for (const tech of Array.from(incidentTechniques)) {
        const sig = evaluateMitreSignal(tech, alert.mitreTechniqueId);
        if (sig) {
          signals.push(sig);
          break;
        }
      }
    }
  }

  // Temporal proximity with incident activity window
  const incidentTime = incident.lastSeenAt || incident.createdAt;
  const timeSig = evaluateTemporalSignal(alert.lastSeenAt || alert.createdAt, incidentTime, maxWindowMs);
  if (timeSig) {
    signals.push(timeSig);
  }

  const rawScore = signals.reduce((sum, s) => sum + s.score, 0);
  const score = Math.min(100, Math.max(0, rawScore));
  const matched = score >= AUTOMATIC_CORRELATION_THRESHOLD;

  return {
    matched,
    incidentId: incident.id,
    incident,
    score,
    reasons: signals.map((s) => s.description),
    signals,
  };
}

/**
 * Discovers the best matching active Incident for a given alert from a list of open incidents.
 */
export function findBestMatchingIncident(
  alert: Alert,
  activeIncidents: Incident[],
  events: SecurityEvent[] = [],
  threshold: number = AUTOMATIC_CORRELATION_THRESHOLD
): CorrelationMatchResult | null {
  let bestMatch: CorrelationMatchResult | null = null;

  for (const incident of activeIncidents) {
    // Only correlate against active/open incidents
    if (incident.status === 'RESOLVED' || incident.status === 'CLOSED' || incident.status === 'FALSE_POSITIVE') {
      continue;
    }

    const match = evaluateAlertAgainstIncident(alert, incident, events);
    if (match.matched && match.score >= threshold) {
      if (!bestMatch || match.score > bestMatch.score) {
        bestMatch = match;
      }
    }
  }

  return bestMatch;
}

// ─── Severity, Priority, and Risk Score Derivations ──────────────────────────

/**
 * Deterministically derives Incident severity from associated alerts and events.
 *
 * Rules:
 * - If any alert is CRITICAL -> CRITICAL
 * - If 2 or more alerts are HIGH -> CRITICAL (multi-vector severe intrusion)
 * - If any alert is HIGH -> HIGH
 * - If any alert is MEDIUM -> MEDIUM
 * - Otherwise -> LOW
 */
export function deriveIncidentSeverity(
  alerts: Alert[],
  events: SecurityEvent[] = []
): Severity {
  const allSeverities: Severity[] = [
    ...alerts.map((a) => a.severity),
    ...events.map((e) => e.severity),
  ];

  if (allSeverities.includes('CRITICAL')) {
    return 'CRITICAL';
  }

  const highCount = allSeverities.filter((s) => s === 'HIGH').length;
  if (highCount >= 2) {
    return 'CRITICAL';
  }

  if (highCount === 1) {
    return 'HIGH';
  }

  if (allSeverities.includes('MEDIUM')) {
    return 'MEDIUM';
  }

  if (allSeverities.includes('LOW')) {
    return 'LOW';
  }

  return 'INFO';
}

/**
 * Deterministically derives Incident priority (P1 - P4).
 *
 * Rules:
 * - P1: CRITICAL severity OR >= 2 affected assets
 * - P2: HIGH severity OR >= 3 correlated alerts
 * - P3: MEDIUM severity
 * - P4: LOW/INFO severity
 */
export function deriveIncidentPriority(
  severity: Severity,
  affectedAssetsCount: number,
  alertsCount: number
): IncidentPriority {
  if (severity === 'CRITICAL' || affectedAssetsCount >= 2) {
    return 'P1';
  }
  if (severity === 'HIGH' || alertsCount >= 3) {
    return 'P2';
  }
  if (severity === 'MEDIUM') {
    return 'P3';
  }
  return 'P4';
}

/**
 * Deterministically calculates risk score (0.0 - 100.0).
 */
export function computeIncidentRiskScore(
  severity: Severity,
  priority: IncidentPriority,
  affectedAssetsCount: number,
  alertsCount: number,
  confidence: number
): number {
  let baseScore = 50.0;
  if (severity === 'CRITICAL') baseScore = 90.0;
  else if (severity === 'HIGH') baseScore = 75.0;
  else if (severity === 'MEDIUM') baseScore = 45.0;
  else baseScore = 25.0;

  const assetMod = Math.min(15.0, affectedAssetsCount * 4.0);
  const alertMod = Math.min(10.0, alertsCount * 2.0);
  const raw = (baseScore + assetMod + alertMod) * Math.min(1.0, Math.max(0.7, confidence));

  return Number(Math.min(99.0, Math.max(10.0, raw)).toFixed(1));
}

// ─── Timeline & Correlation Chain Builders ───────────────────────────────────

/**
 * Converts SecurityEvents into chronological TimelineEvents.
 */
export function buildTimelineFromEvents(
  events: SecurityEvent[],
  existingTimeline: TimelineEvent[] = []
): TimelineEvent[] {
  const existingMap = new Map(existingTimeline.map((t) => [t.id, t]));

  const derived: TimelineEvent[] = events.map((ev) => {
    // Map event category to kill-chain stage
    let stage: TimelineEvent['stage'] = 'EXECUTION';
    if (ev.category === 'SECURITY_CONTROL' || ev.eventType.includes('PHISH') || ev.eventType.includes('DELIVERY')) {
      stage = 'INITIAL_ACCESS';
    } else if (ev.category === 'PROCESS') {
      stage = ev.eventType.includes('LSASS') ? 'CREDENTIAL_ACCESS' : 'EXECUTION';
    } else if (ev.category === 'ENDPOINT' && (ev.eventType.includes('REG') || ev.message.includes('Run key'))) {
      stage = 'PERSISTENCE';
    } else if (ev.category === 'AUTHENTICATION') {
      stage = ev.eventType.includes('SMB') ? 'LATERAL_MOVEMENT' : 'CREDENTIAL_ACCESS';
    } else if (ev.category === 'NETWORK') {
      stage = ev.eventType.includes('EXFIL') ? 'EXFILTRATION' : 'DISCOVERY';
    } else if (ev.category === 'FILE' && (ev.eventType.includes('ENCRYPT') || ev.eventType.includes('MASS'))) {
      stage = 'IMPACT';
    } else if (ev.category === 'IDENTITY') {
      stage = 'PRIVILEGE_ESCALATION';
    }

    return {
      id: `tl-${ev.id}`,
      timestamp: ev.timestamp,
      title: `${ev.eventType.replace(/_/g, ' ')} on ${ev.assetId ?? ev.userId ?? ev.source}`,
      stage,
      severity: ev.severity,
      description: ev.message,
      entityId: ev.assetId ?? ev.userId,
      entityType: ev.assetId ? 'ASSET' : ev.userId ? 'USER' : undefined,
    };
  });

  // Combine, avoiding duplicates by id
  for (const item of derived) {
    if (!existingMap.has(item.id)) {
      existingMap.set(item.id, item);
    }
  }

  // Sort strictly chronologically
  return Array.from(existingMap.values()).sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
  );
}

/**
 * Builds correlation chain items from matched alerts.
 */
export function buildCorrelationChainFromAlerts(alerts: Alert[]): CorrelationChainItem[] {
  return alerts.map((a, i) => ({
    id: `chain-${a.id}`,
    alertId: a.id,
    title: a.title,
    ruleName: a.ruleName || a.ruleId,
    timestamp: a.lastSeenAt || a.createdAt,
    confidence: a.severity === 'CRITICAL' ? 0.95 : a.severity === 'HIGH' ? 0.88 : 0.75,
    evidenceSummary: `Matched rule ${a.ruleId} with ${a.occurrenceCount} occurrence(s). Causal events: ${a.sourceEventIds.join(', ')}`,
  }));
}

// ─── Querying & Filtering Engine ─────────────────────────────────────────────

/**
 * Pure query engine for Incidents.
 */
export function queryIncidents(incidents: Incident[], query?: IncidentQuery): Incident[] {
  if (!query) return [...incidents];

  let result = [...incidents];

  // Status
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    result = result.filter((i) => statuses.includes(i.status));
  }

  // Severity
  if (query.severity) {
    const sevs = Array.isArray(query.severity) ? query.severity : [query.severity];
    result = result.filter((i) => sevs.includes(i.severity));
  }

  // Priority
  if (query.priority) {
    const priorities = Array.isArray(query.priority) ? query.priority : [query.priority];
    result = result.filter((i) => i.priority && priorities.includes(i.priority));
  }

  // Asset ID
  if (query.assetId) {
    result = result.filter((i) => i.affectedAssets.includes(query.assetId!));
  }

  // User ID
  if (query.userId) {
    result = result.filter((i) => i.affectedUsers.includes(query.userId!));
  }

  // Full-text search
  if (query.search && query.search.trim() !== '') {
    const term = query.search.trim().toLowerCase();
    result = result.filter(
      (i) =>
        i.title.toLowerCase().includes(term) ||
        (i.summary && i.summary.toLowerCase().includes(term)) ||
        (i.description && i.description.toLowerCase().includes(term)) ||
        i.id.toLowerCase().includes(term) ||
        i.affectedAssets.some((a) => a.toLowerCase().includes(term)) ||
        i.affectedUsers.some((u) => u.toLowerCase().includes(term)) ||
        i.iocs.some((ioc) => ioc.toLowerCase().includes(term))
    );
  }

  // Sort order (default: newest first)
  const sortOrder = query.sortOrder || 'DESC';
  result.sort((a, b) => {
    const timeA = Date.parse(a.updatedAt || a.createdAt);
    const timeB = Date.parse(b.updatedAt || b.createdAt);
    return sortOrder === 'DESC' ? timeB - timeA : timeA - timeB;
  });

  // Pagination
  const offset = query.offset ?? 0;
  const limit = query.limit ?? result.length;
  return result.slice(offset, offset + limit);
}

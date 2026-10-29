/**
 * threat-hunt-engine.ts
 *
 * Core offline Threat Hunting Engine for EXPLAIN-SEC SPATIAL.
 *
 * Capabilities:
 * - Deterministic, typed structured query evaluation (zero eval() or Function()).
 * - Multi-operator predicate support: equals, notEquals, contains, startsWith,
 *   endsWith, in, notIn, greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual.
 * - Match rationale explainability generation ("MATCHED BECAUSE: ...").
 * - Clear provenance segregation: KNOWN (attached to alert/incident) vs UNKNOWN (novel discovery).
 * - Multi-dimensional aggregations (by asset, user, process, network, time, severity).
 * - Pre-configured offline BlackTide telemetry hunt templates.
 */

import type { SecurityEvent, EventCategory, EventSeverity } from '../models/event';
import type { Alert } from '../models/detection';
import type { Incident } from '../models/incident';
import type {
  ThreatHuntQuery,
  ThreatHuntResult,
  ThreatHuntExecutionResult,
  ThreatHuntAggregation,
  HuntFilterCondition,
  ThreatHuntTemplate,
  QueryOperator,
} from '../models/hunting';

// ─── Safe Predicate Evaluator ──────────────────────────────────────────────────

/**
 * Safely extracts a value from a SecurityEvent.
 * Supports top-level keys or dot-notation (e.g. 'metadata.sender').
 */
export function getFieldValue(event: SecurityEvent, fieldPath: string): unknown {
  if (fieldPath in event) {
    return (event as unknown as Record<string, unknown>)[fieldPath];
  }
  if (fieldPath.includes('.')) {
    const parts = fieldPath.split('.');
    let curr: unknown = event;
    for (const part of parts) {
      if (curr && typeof curr === 'object' && part in (curr as Record<string, unknown>)) {
        curr = (curr as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return curr;
  }
  return undefined;
}

/**
 * Safely compares two values using explicit typed operators.
 * FORBIDDEN: eval(), Function(), string execution.
 */
export function evaluateOperator(
  actual: unknown,
  operator: QueryOperator,
  expected: unknown
): boolean {
  if (actual === undefined || actual === null) {
    if (operator === 'notEquals') return expected !== undefined && expected !== null;
    if (operator === 'notIn') return true;
    return false;
  }

  // Normalize string comparisons to case-insensitive
  const strActual = typeof actual === 'string' ? actual.toLowerCase() : '';
  const strExpected = typeof expected === 'string' ? expected.toLowerCase() : '';

  switch (operator) {
    case 'equals':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return strActual === strExpected;
      }
      return actual === expected;

    case 'notEquals':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return strActual !== strExpected;
      }
      return actual !== expected;

    case 'contains':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return strActual.includes(strExpected);
      }
      if (Array.isArray(actual)) {
        if (typeof expected === 'string') {
          return actual.some((item) =>
            typeof item === 'string' ? item.toLowerCase() === strExpected : item === expected
          );
        }
        return actual.includes(expected);
      }
      return false;

    case 'startsWith':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return strActual.startsWith(strExpected);
      }
      return false;

    case 'endsWith':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return strActual.endsWith(strExpected);
      }
      return false;

    case 'in':
      if (Array.isArray(expected)) {
        if (typeof actual === 'string') {
          return expected.some((e) =>
            typeof e === 'string' ? e.toLowerCase() === strActual : e === actual
          );
        }
        return expected.includes(actual);
      }
      return false;

    case 'notIn':
      if (Array.isArray(expected)) {
        if (typeof actual === 'string') {
          return !expected.some((e) =>
            typeof e === 'string' ? e.toLowerCase() === strActual : e === actual
          );
        }
        return !expected.includes(actual);
      }
      return true;

    case 'greaterThan':
      if (typeof actual === 'number' && typeof expected === 'number') {
        return actual > expected;
      }
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual > expected; // ISO timestamps or lexicographical
      }
      return false;

    case 'lessThan':
      if (typeof actual === 'number' && typeof expected === 'number') {
        return actual < expected;
      }
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual < expected;
      }
      return false;

    case 'greaterThanOrEqual':
      if (typeof actual === 'number' && typeof expected === 'number') {
        return actual >= expected;
      }
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual >= expected;
      }
      return false;

    case 'lessThanOrEqual':
      if (typeof actual === 'number' && typeof expected === 'number') {
        return actual <= expected;
      }
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual <= expected;
      }
      return false;

    default:
      return false;
  }
}

export function evaluateCondition(event: SecurityEvent, condition: HuntFilterCondition): boolean {
  const actual = getFieldValue(event, condition.field);
  return evaluateOperator(actual, condition.operator, condition.value);
}

// ─── Query Match Explanation Builder ──────────────────────────────────────────

function buildMatchExplanation(event: SecurityEvent, query: ThreatHuntQuery, matchedReasons: string[]): string {
  if (matchedReasons.length > 0) {
    return `MATCHED BECAUSE: ${matchedReasons.join(' AND ')}`;
  }
  return `MATCHED BECAUSE: General query criteria satisfied across [${event.eventType}]`;
}

// ─── Deterministic Aggregations ───────────────────────────────────────────────

function calculateAggregations(
  results: ThreatHuntResult[],
  matchedEvents: SecurityEvent[]
): ThreatHuntAggregation {
  const assetMap = new Map<string, number>();
  const userMap = new Map<string, number>();
  const srcIpMap = new Map<string, number>();
  const dstIpMap = new Map<string, number>();
  const domainMap = new Map<string, number>();
  const processMap = new Map<string, number>();
  const eventTypeMap = new Map<string, number>();
  const timeBuckets = new Map<string, number>();

  const bySeverity: Record<EventSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };

  const byCategory: Record<EventCategory, number> = {
    AUTHENTICATION: 0,
    NETWORK: 0,
    PROCESS: 0,
    ENDPOINT: 0,
    FILE: 0,
    IDENTITY: 0,
    SYSTEM: 0,
    SECURITY_CONTROL: 0,
  };

  let knownCount = 0;
  let unknownCount = 0;

  for (const res of results) {
    if (res.isKnown) knownCount++;
    else unknownCount++;

    const evt = res.event;

    // Severity & Category
    if (evt.severity in bySeverity) bySeverity[evt.severity]++;
    if (evt.category in byCategory) byCategory[evt.category]++;

    // Entity maps
    if (evt.assetId) assetMap.set(evt.assetId, (assetMap.get(evt.assetId) || 0) + 1);
    if (evt.userId) userMap.set(evt.userId, (userMap.get(evt.userId) || 0) + 1);
    if (evt.srcIp) srcIpMap.set(evt.srcIp, (srcIpMap.get(evt.srcIp) || 0) + 1);
    if (evt.dstIp) dstIpMap.set(evt.dstIp, (dstIpMap.get(evt.dstIp) || 0) + 1);
    if (evt.domain) domainMap.set(evt.domain, (domainMap.get(evt.domain) || 0) + 1);
    if (evt.processName) processMap.set(evt.processName, (processMap.get(evt.processName) || 0) + 1);
    if (evt.eventType) eventTypeMap.set(evt.eventType, (eventTypeMap.get(evt.eventType) || 0) + 1);

    // Hourly / 15-minute time bucket
    const ts = evt.timestamp;
    const bucketKey = ts.length >= 16 ? `${ts.substring(0, 13)}:00Z` : ts;
    timeBuckets.set(bucketKey, (timeBuckets.get(bucketKey) || 0) + 1);
  }

  const mapToSortedList = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

  const sortedTimeBuckets = Array.from(timeBuckets.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  return {
    byAsset: mapToSortedList(assetMap),
    byUser: mapToSortedList(userMap),
    bySourceIp: mapToSortedList(srcIpMap),
    byDestinationIp: mapToSortedList(dstIpMap),
    byDomain: mapToSortedList(domainMap),
    byProcess: mapToSortedList(processMap),
    byEventType: mapToSortedList(eventTypeMap),
    bySeverity,
    byCategory,
    overTime: sortedTimeBuckets,
    knownCount,
    unknownCount,
  };
}

// ─── Threat Hunt Execution Pipeline ───────────────────────────────────────────

export function executeHuntQuery(
  events: SecurityEvent[],
  query: ThreatHuntQuery,
  alerts: Alert[] = [],
  incidents: Incident[] = []
): ThreatHuntExecutionResult {
  const startTimeMs = performance.now();

  // Index alert event associations for fast provenance lookups
  const eventToAlertIds = new Map<string, string[]>();
  for (const alert of alerts) {
    if (alert.sourceEventIds && Array.isArray(alert.sourceEventIds)) {
      for (const evtId of alert.sourceEventIds) {
        const list = eventToAlertIds.get(evtId) || [];
        list.push(alert.id);
        eventToAlertIds.set(evtId, list);
      }
    }
  }

  // Pre-filter events using structured criteria
  const matchedResults: ThreatHuntResult[] = [];
  const matchedEventIds: string[] = [];
  const relatedAlertIdsSet = new Set<string>();
  const relatedIncidentIdsSet = new Set<string>();

  for (const event of events) {
    const reasons: string[] = [];
    let matches = true;

    // 1. Time range
    if (query.startTime && event.timestamp < query.startTime) {
      matches = false;
    }
    if (query.endTime && event.timestamp > query.endTime) {
      matches = false;
    }
    if (query.startTime || query.endTime) {
      reasons.push(`Time range [${query.startTime ?? '*'} to ${query.endTime ?? '*'}]`);
    }

    // 2. Event Types
    if (matches && query.eventTypes && query.eventTypes.length > 0) {
      if (!query.eventTypes.includes(event.eventType)) {
        matches = false;
      } else {
        reasons.push(`Event Type in [${query.eventTypes.join(', ')}]`);
      }
    }

    // 3. Categories
    if (matches && query.categories && query.categories.length > 0) {
      if (!query.categories.includes(event.category)) {
        matches = false;
      } else {
        reasons.push(`Category in [${query.categories.join(', ')}]`);
      }
    }

    // 4. Severities
    if (matches && query.severities && query.severities.length > 0) {
      if (!query.severities.includes(event.severity)) {
        matches = false;
      } else {
        reasons.push(`Severity in [${query.severities.join(', ')}]`);
      }
    }

    // 5. Assets
    if (matches && query.assetIds && query.assetIds.length > 0) {
      if (!event.assetId || !query.assetIds.includes(event.assetId)) {
        matches = false;
      } else {
        reasons.push(`Asset ID = ${event.assetId}`);
      }
    }

    // 6. Users
    if (matches && query.userIds && query.userIds.length > 0) {
      if (!event.userId || !query.userIds.includes(event.userId)) {
        matches = false;
      } else {
        reasons.push(`User ID = ${event.userId}`);
      }
    }

    // 7. Incident IDs (e.g. specifically hunting for unattached events if query specifies)
    if (matches && query.incidentIds && query.incidentIds.length > 0) {
      if (!event.incidentId || !query.incidentIds.includes(event.incidentId)) {
        matches = false;
      } else {
        reasons.push(`Incident ID = ${event.incidentId}`);
      }
    }

    // 8. Network: Source IPs
    if (matches && query.sourceIps && query.sourceIps.length > 0) {
      if (!event.srcIp || !query.sourceIps.includes(event.srcIp)) {
        matches = false;
      } else {
        reasons.push(`Source IP = ${event.srcIp}`);
      }
    }

    // 9. Network: Destination IPs
    if (matches && query.destinationIps && query.destinationIps.length > 0) {
      if (!event.dstIp || !query.destinationIps.includes(event.dstIp)) {
        matches = false;
      } else {
        reasons.push(`Destination IP = ${event.dstIp}`);
      }
    }

    // 10. Network: Domains
    if (matches && query.domains && query.domains.length > 0) {
      const lowerDomains = query.domains.map((d) => d.toLowerCase());
      if (!event.domain || !lowerDomains.includes(event.domain.toLowerCase())) {
        matches = false;
      } else {
        reasons.push(`Domain in [${query.domains.join(', ')}]`);
      }
    }

    // 11. Network: URLs
    if (matches && query.urls && query.urls.length > 0) {
      if (!event.url || !query.urls.some((u) => event.url?.toLowerCase().includes(u.toLowerCase()))) {
        matches = false;
      } else {
        reasons.push(`URL contains specified patterns`);
      }
    }

    // 12. Process: Names
    if (matches && query.processes && query.processes.length > 0) {
      const lowerProc = (event.processName || '').toLowerCase();
      if (!lowerProc || !query.processes.some((p) => p.toLowerCase() === lowerProc)) {
        matches = false;
      } else {
        reasons.push(`Process = ${event.processName}`);
      }
    }

    // 13. Process: Command lines
    if (matches && query.commandLines && query.commandLines.length > 0) {
      const lowerCmd = (event.commandLine || '').toLowerCase();
      if (!lowerCmd || !query.commandLines.some((c) => lowerCmd.includes(c.toLowerCase()))) {
        matches = false;
      } else {
        reasons.push(`Command line matches criteria`);
      }
    }

    // 14. Process: Hashes
    if (matches && query.hashes && query.hashes.length > 0) {
      if (!event.fileHash || !query.hashes.includes(event.fileHash)) {
        matches = false;
      } else {
        reasons.push(`File Hash = ${event.fileHash}`);
      }
    }

    // 15. Protocols & Ports
    if (matches && query.protocols && query.protocols.length > 0) {
      if (!event.protocol || !query.protocols.includes(event.protocol)) {
        matches = false;
      } else {
        reasons.push(`Protocol = ${event.protocol}`);
      }
    }
    if (matches && query.ports && query.ports.length > 0) {
      const hasPort = (event.dstPort && query.ports.includes(event.dstPort)) ||
                      (event.srcPort && query.ports.includes(event.srcPort));
      if (!hasPort) {
        matches = false;
      } else {
        reasons.push(`Port in [${query.ports.join(', ')}]`);
      }
    }

    // 16. Free text search
    if (matches && query.text && query.text.trim()) {
      const term = query.text.toLowerCase().trim();
      const searchable = [
        event.message,
        event.commandLine,
        event.processName,
        event.domain,
        event.srcIp,
        event.dstIp,
        event.source,
        event.filePath,
        event.eventType,
        event.category,
      ].filter(Boolean).join(' ').toLowerCase();

      if (!searchable.includes(term)) {
        matches = false;
      } else {
        reasons.push(`Free text contains "${query.text}"`);
      }
    }

    // 17. Custom structured conditions
    if (matches && query.conditions && query.conditions.length > 0) {
      for (const cond of query.conditions) {
        if (!evaluateCondition(event, cond)) {
          matches = false;
          break;
        } else {
          reasons.push(`[${cond.field} ${cond.operator} ${JSON.stringify(cond.value)}]`);
        }
      }
    }

    if (matches) {
      const alertIds = eventToAlertIds.get(event.id) || [];
      const isKnown = Boolean(event.incidentId || alertIds.length > 0);

      matchedEventIds.push(event.id);
      alertIds.forEach((id) => relatedAlertIdsSet.add(id));
      if (event.incidentId) relatedIncidentIdsSet.add(event.incidentId);

      const explanation = buildMatchExplanation(event, query, reasons);

      matchedResults.push({
        eventId: event.id,
        event,
        timestamp: event.timestamp,
        eventType: event.eventType,
        severity: event.severity,
        category: event.category,
        assetId: event.assetId,
        userId: event.userId,
        source: event.source,
        srcIp: event.srcIp,
        dstIp: event.dstIp,
        processName: event.processName,
        commandLine: event.commandLine,
        domain: event.domain,
        iocIds: event.iocIds,
        isKnown,
        relatedAlertIds: alertIds,
        relatedIncidentId: event.incidentId,
        explanation,
      });
    }
  }

  // Deterministic sorting
  const sortOrder = query.sortOrder ?? 'DESC';
  matchedResults.sort((a, b) => {
    return sortOrder === 'ASC'
      ? a.timestamp.localeCompare(b.timestamp)
      : b.timestamp.localeCompare(a.timestamp);
  });

  // Calculate aggregations on all matched results
  const aggregations = calculateAggregations(matchedResults, events);

  // Paginate results
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 100;
  const paginatedResults = matchedResults.slice(offset, offset + limit);

  const endTimeMs = performance.now();

  return {
    results: paginatedResults,
    totalMatches: matchedResults.length,
    aggregations,
    matchedEventIds,
    relatedAlertIds: Array.from(relatedAlertIdsSet),
    relatedIncidentIds: Array.from(relatedIncidentIdsSet),
    executionTimeMs: Math.round(endTimeMs - startTimeMs),
    executedAt: new Date().toISOString(),
  };
}

// ─── Canonical BlackTide Telemetry Hunt Templates ─────────────────────────────

export const BLACKTIDE_HUNT_TEMPLATES: ThreatHuntTemplate[] = [
  {
    id: 'hunt-tpl-001',
    name: 'Suspicious PowerShell Execution',
    description: 'Finds interactive, obfuscated, or suspicious PowerShell process invocations across endpoints.',
    category: 'PROCESS',
    recommendedRole: 'THREAT_HUNTER',
    hypothesis: 'Adversaries utilize PowerShell for in-memory payload execution, credential discovery, and defense evasion.',
    query: {
      categories: ['PROCESS', 'SYSTEM'],
      processes: ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'svchost32.exe'],
      limit: 100,
      sortOrder: 'DESC',
    },
  },
  {
    id: 'hunt-tpl-002',
    name: 'Repeated Authentication Failures',
    description: 'Hunts for brute force password spraying, Kerberos pre-auth failures, and anomalous logons.',
    category: 'AUTHENTICATION',
    recommendedRole: 'L2_ANALYST',
    hypothesis: 'Adversary attempting credential stuffing or brute force before pivoting into internal domain assets.',
    query: {
      categories: ['AUTHENTICATION'],
      eventTypes: ['AUTH_BRUTE_FORCE', 'KERBEROS_TGS_REQUEST', 'SMB_LOGON_SUCCESS'],
      limit: 100,
      sortOrder: 'DESC',
    },
  },
  {
    id: 'hunt-tpl-003',
    name: 'Privilege Escalation Activity',
    description: 'Searches for DCSync replication rights, LSASS memory handle access, and user token manipulations.',
    category: 'IDENTITY',
    recommendedRole: 'THREAT_HUNTER',
    hypothesis: 'Adversary has compromised an initial endpoint and is escalating privileges to Domain Administrator.',
    query: {
      conditions: [
        {
          field: 'eventType',
          operator: 'in',
          value: ['PROCESS_ACCESS_LSASS', 'ACL_REPLICATION_GRANT', 'KERBEROS_TGS_REQUEST'],
        },
      ],
      limit: 100,
      sortOrder: 'DESC',
    },
  },
  {
    id: 'hunt-tpl-004',
    name: 'Unusual Outbound C2 Beacons',
    description: 'Finds periodic outbound network flows and DNS lookups matching adversary command-and-control infrastructure.',
    category: 'NETWORK',
    recommendedRole: 'THREAT_HUNTER',
    hypothesis: 'Compromised endpoints communicate with external command servers via TLS or DNS tunneling.',
    query: {
      categories: ['NETWORK'],
      ports: [443, 8080, 8443, 9001],
      limit: 100,
      sortOrder: 'DESC',
    },
  },
  {
    id: 'hunt-tpl-005',
    name: 'IOC-Related Activity',
    description: 'Queries telemetry containing recognized Indicator of Compromise (IOC) IDs or malicious indicators.',
    category: 'SECURITY_CONTROL',
    recommendedRole: 'L2_ANALYST',
    hypothesis: 'Telemetry events directly correspond to known adversary file hashes, IPs, or domains.',
    query: {
      conditions: [
        {
          field: 'iocIds',
          operator: 'notEquals',
          value: undefined as unknown as string,
        },
      ],
      limit: 100,
      sortOrder: 'DESC',
    },
  },
  {
    id: 'hunt-tpl-006',
    name: 'Lateral Movement Indicators',
    description: 'Hunts for internal SMB session connections, administrative share mounting, and remote command executions.',
    category: 'NETWORK',
    recommendedRole: 'THREAT_HUNTER',
    hypothesis: 'Adversary moves laterally between workstations and critical domain infrastructure using SMB or RPC.',
    query: {
      conditions: [
        {
          field: 'eventType',
          operator: 'in',
          value: ['SMB_LOGON_SUCCESS', 'SMB_SESSION_CONNECT', 'LDAP_QUERY_ENUMERATION'],
        },
      ],
      limit: 100,
      sortOrder: 'DESC',
    },
  },
  {
    id: 'hunt-tpl-007',
    name: 'Suspicious Process Lineage',
    description: 'Hunts for suspicious executables launched from temp paths, PDF readers, or backup utilities.',
    category: 'PROCESS',
    recommendedRole: 'L2_ANALYST',
    hypothesis: 'Malicious droppers spawned by user applications attempting persistence or shadow copy deletion.',
    query: {
      categories: ['PROCESS', 'SYSTEM'],
      processes: ['svchost32.exe', 'vssadmin.exe', 'cmd.exe', 'certutil.exe'],
      limit: 100,
      sortOrder: 'DESC',
    },
  },
  {
    id: 'hunt-tpl-008',
    name: 'High-Severity Events Without Incidents',
    description: 'Identifies CRITICAL or HIGH severity telemetry that has NOT yet been correlated into an active incident.',
    category: 'SECURITY_CONTROL',
    recommendedRole: 'THREAT_HUNTER',
    hypothesis: 'Novel malicious activity exists in telemetry that bypassed automated detection or correlation rules.',
    query: {
      severities: ['CRITICAL', 'HIGH'],
      limit: 100,
      sortOrder: 'DESC',
    },
  },
];

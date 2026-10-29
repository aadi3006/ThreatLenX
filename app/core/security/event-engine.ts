/**
 * event-engine.ts
 *
 * Core Security Event Engine for EXPLAIN-SEC SPATIAL.
 *
 * Provides:
 * - Validation & referential integrity checks.
 * - Deterministic normalization and signature generation.
 * - In-memory deduplication and conflict detection.
 * - Deterministic local querying, filtering, and sorting.
 * - Event metrics and aggregation statistics.
 *
 * 100% offline, zero network dependencies.
 */

import type {
  SecurityEvent,
  SecurityEventInput,
  SecurityEventQuery,
  SecurityEventStats,
  EventCategory,
  EventSeverity,
  EventSourceType,
} from '../models/event';

export const VALID_CATEGORIES: ReadonlySet<EventCategory> = new Set([
  'AUTHENTICATION',
  'NETWORK',
  'PROCESS',
  'ENDPOINT',
  'FILE',
  'IDENTITY',
  'SYSTEM',
  'SECURITY_CONTROL',
]);

export const VALID_SEVERITIES: ReadonlySet<EventSeverity> = new Set([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
]);

export const VALID_SOURCE_TYPES: ReadonlySet<EventSourceType> = new Set([
  'ENDPOINT',
  'FIREWALL',
  'AUTH',
  'DNS',
  'PROXY',
  'APPLICATION',
  'SYSTEM',
  'SIMULATOR',
  'SIMULATION',
  'EXTERNAL',
]);

/**
 * Deterministic string hashing helper for stable signatures and IDs.
 */
export function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Generates a deterministic signature to identify duplicate telemetry submissions.
 */
export function generateEventSignature(event: Partial<SecurityEventInput>): string {
  const parts = [
    event.timestamp ? new Date(event.timestamp).toISOString() : '',
    event.source ?? '',
    event.eventType ?? '',
    event.assetId ?? '',
    event.srcIp ?? '',
    event.dstIp ?? '',
    event.srcPort ?? '',
    event.dstPort ?? '',
    event.processName ?? '',
    event.commandLine ?? '',
    event.fileHash ?? '',
    event.domain ?? '',
    event.message ?? '',
  ];
  return `sig-${simpleHash(parts.join('|'))}`;
}

export interface ValidationContext {
  knownAssets?: Set<string>;
  knownUsers?: Set<string>;
  knownIncidents?: Set<string>;
  knownIocs?: Set<string>;
}

/**
 * Validates a raw event candidate. Returns validation result with detailed error messages.
 */
export function validateSecurityEvent(
  event: Partial<SecurityEventInput>,
  context?: ValidationContext
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!event) {
    return { valid: false, errors: ['Event payload is null or undefined'] };
  }

  // 1. Timestamp validation (optional on raw input; validated if provided)
  if (event.timestamp !== undefined) {
    if (typeof event.timestamp !== 'string') {
      errors.push('Event timestamp must be a string');
    } else {
      const parsed = Date.parse(event.timestamp);
      if (isNaN(parsed)) {
        errors.push(`Invalid timestamp format: "${event.timestamp}"`);
      }
    }
  }

  // 2. EventType validation
  if (!event.eventType || typeof event.eventType !== 'string' || event.eventType.trim() === '') {
    errors.push('Missing eventType string identifier');
  }

  // 3. Category validation
  if (!event.category || !VALID_CATEGORIES.has(event.category)) {
    errors.push(`Invalid event category: "${event.category}". Must be one of ${Array.from(VALID_CATEGORIES).join(', ')}`);
  }

  // 4. Severity validation
  if (!event.severity || !VALID_SEVERITIES.has(event.severity)) {
    errors.push(`Invalid event severity: "${event.severity}". Must be one of ${Array.from(VALID_SEVERITIES).join(', ')}`);
  }

  // 5. Source validation
  if (!event.source || typeof event.source !== 'string' || event.source.trim() === '') {
    errors.push('Missing event source string identifier');
  }

  // 6. SourceType validation (optional on raw input; validated if provided)
  if (event.sourceType && !VALID_SOURCE_TYPES.has(event.sourceType)) {
    errors.push(`Invalid event sourceType: "${event.sourceType}". Must be one of ${Array.from(VALID_SOURCE_TYPES).join(', ')}`);
  }

  // 7. Message validation
  if (!event.message || typeof event.message !== 'string') {
    errors.push('Missing event human-readable message');
  }

  // 8. Referential integrity validation
  if (event.assetId && context?.knownAssets && !context.knownAssets.has(event.assetId)) {
    errors.push(`Referenced assetId "${event.assetId}" does not exist in canonical asset store`);
  }

  if (event.userId && context?.knownUsers && !context.knownUsers.has(event.userId)) {
    errors.push(`Referenced userId "${event.userId}" does not exist in canonical user store`);
  }

  if (event.incidentId && context?.knownIncidents && !context.knownIncidents.has(event.incidentId)) {
    errors.push(`Referenced incidentId "${event.incidentId}" does not exist in canonical incident store`);
  }

  if (event.iocIds && context?.knownIocs) {
    for (const iocId of event.iocIds) {
      if (!context.knownIocs.has(iocId)) {
        errors.push(`Referenced iocId "${iocId}" does not exist in canonical IOC store`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Normalizes a raw/input security event into a canonical SecurityEvent.
 */
export function normalizeSecurityEvent(raw: SecurityEventInput): SecurityEvent {
  const ts = raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString();
  const receivedAt = raw.receivedAt ? new Date(raw.receivedAt).toISOString() : new Date().toISOString();
  const signature = raw.signature || generateEventSignature(raw);

  // Derive stable deterministic ID if not provided
  let id = raw.id;
  if (!id) {
    const timeMs = Date.parse(ts);
    id = `evt-sec-${timeMs}-${signature.slice(4, 12)}`;
  }

  const category = (raw.category?.toUpperCase() as EventCategory) || 'SYSTEM';
  const severity = (raw.severity?.toUpperCase() as EventSeverity) || 'INFO';
  const sourceType = (raw.sourceType?.toUpperCase() as EventSourceType) || 'SYSTEM';

  return {
    id,
    timestamp: ts,
    receivedAt,
    eventType: raw.eventType.trim().toUpperCase(),
    category,
    severity,
    source: raw.source.trim(),
    sourceType,
    assetId: raw.assetId,
    userId: raw.userId,
    incidentId: raw.incidentId,
    iocIds: raw.iocIds && raw.iocIds.length > 0 ? Array.from(new Set(raw.iocIds)) : undefined,
    srcIp: raw.srcIp?.trim(),
    dstIp: raw.dstIp?.trim(),
    srcPort: raw.srcPort,
    dstPort: raw.dstPort,
    protocol: raw.protocol?.trim().toUpperCase(),
    processName: raw.processName?.trim(),
    processId: raw.processId,
    parentProcessName: raw.parentProcessName?.trim(),
    parentProcessId: raw.parentProcessId,
    commandLine: raw.commandLine?.trim(),
    filePath: raw.filePath?.trim(),
    fileHash: raw.fileHash?.trim().toLowerCase(),
    domain: raw.domain?.trim().toLowerCase(),
    url: raw.url?.trim(),
    httpMethod: raw.httpMethod?.trim().toUpperCase(),
    httpStatus: raw.httpStatus,
    message: raw.message.trim(),
    rawPayload: raw.rawPayload,
    metadata: raw.metadata,
    signature,
  };
}

/**
 * Deterministic local query engine for SecurityEvents.
 */
export function querySecurityEvents(
  events: SecurityEvent[],
  query?: SecurityEventQuery
): SecurityEvent[] {
  if (!query) {
    // Default: Sort newest first
    return [...events].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime() || b.id.localeCompare(a.id)
    );
  }

  let filtered = events;

  // 1. Time range
  if (query.startTime) {
    const startMs = Date.parse(query.startTime);
    filtered = filtered.filter((e) => Date.parse(e.timestamp) >= startMs);
  }
  if (query.endTime) {
    const endMs = Date.parse(query.endTime);
    filtered = filtered.filter((e) => Date.parse(e.timestamp) <= endMs);
  }

  // 2. Severity
  if (query.severity) {
    const sevs = Array.isArray(query.severity) ? new Set(query.severity) : new Set([query.severity]);
    filtered = filtered.filter((e) => sevs.has(e.severity));
  }

  // 3. Category
  if (query.category) {
    const cats = Array.isArray(query.category) ? new Set(query.category) : new Set([query.category]);
    filtered = filtered.filter((e) => cats.has(e.category));
  }

  // 4. Source
  if (query.source) {
    const sources = Array.isArray(query.source)
      ? query.source.map((s) => s.toLowerCase())
      : [query.source.toLowerCase()];
    filtered = filtered.filter((e) => sources.some((s) => e.source.toLowerCase().includes(s)));
  }

  // 5. SourceType
  if (query.sourceType) {
    const types = Array.isArray(query.sourceType) ? new Set(query.sourceType) : new Set([query.sourceType]);
    filtered = filtered.filter((e) => types.has(e.sourceType));
  }

  // 6. Entity relationships
  if (query.assetId) {
    filtered = filtered.filter((e) => e.assetId === query.assetId);
  }
  if (query.userId) {
    filtered = filtered.filter((e) => e.userId === query.userId);
  }
  if (query.incidentId) {
    filtered = filtered.filter((e) => e.incidentId === query.incidentId);
  }
  if (query.iocId) {
    filtered = filtered.filter((e) => e.iocIds && e.iocIds.includes(query.iocId!));
  }

  // 7. EventType
  if (query.eventType) {
    const et = query.eventType.toUpperCase();
    filtered = filtered.filter((e) => e.eventType === et);
  }

  // 8. Search query string (case-insensitive)
  if (query.search) {
    const q = query.search.toLowerCase();
    filtered = filtered.filter((e) =>
      e.message.toLowerCase().includes(q) ||
      (e.commandLine && e.commandLine.toLowerCase().includes(q)) ||
      (e.filePath && e.filePath.toLowerCase().includes(q)) ||
      (e.srcIp && e.srcIp.includes(q)) ||
      (e.dstIp && e.dstIp.includes(q)) ||
      (e.processName && e.processName.toLowerCase().includes(q))
    );
  }

  // 9. Deterministic sorting (newest first by default)
  const isAsc = query.sortOrder === 'ASC';
  filtered = [...filtered].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeA !== timeB) {
      return isAsc ? timeA - timeB : timeB - timeA;
    }
    // Stable tie-breaker by ID
    return isAsc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
  });

  // 10. Pagination
  const offset = query.offset ?? 0;
  const limit = query.limit ?? filtered.length;
  return filtered.slice(offset, offset + limit);
}

/**
 * Computes event metrics and aggregations for SOC operational telemetry.
 */
export function computeEventStats(events: SecurityEvent[]): SecurityEventStats {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  let eventsLast5Min = 0;
  let eventsLastHour = 0;
  let eventsLast24Hours = 0;

  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let infoCount = 0;

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

  const bySourceType: Record<EventSourceType, number> = {
    ENDPOINT: 0,
    FIREWALL: 0,
    AUTH: 0,
    DNS: 0,
    PROXY: 0,
    APPLICATION: 0,
    SYSTEM: 0,
    SIMULATOR: 0,
    SIMULATION: 0,
    EXTERNAL: 0,
  };

  const assetCounts = new Map<string, number>();

  for (const e of events) {
    const eTime = new Date(e.timestamp).getTime();

    // Time buckets
    if (eTime >= fiveMinAgo) eventsLast5Min++;
    if (eTime >= oneHourAgo) eventsLastHour++;
    if (eTime >= twentyFourHoursAgo) eventsLast24Hours++;

    // Severity
    switch (e.severity) {
      case 'CRITICAL': criticalCount++; break;
      case 'HIGH': highCount++; break;
      case 'MEDIUM': mediumCount++; break;
      case 'LOW': lowCount++; break;
      case 'INFO': infoCount++; break;
    }

    // Category
    if (e.category in byCategory) {
      byCategory[e.category]++;
    }

    // SourceType
    if (e.sourceType in bySourceType) {
      bySourceType[e.sourceType]++;
    }

    // Asset
    if (e.assetId) {
      assetCounts.set(e.assetId, (assetCounts.get(e.assetId) ?? 0) + 1);
    }
  }

  const topAssets = Array.from(assetCounts.entries())
    .map(([assetId, count]) => ({ assetId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalEvents: events.length,
    eventsLast5Min,
    eventsLastHour,
    eventsLast24Hours,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    infoCount,
    byCategory,
    bySourceType,
    topAssets,
  };
}

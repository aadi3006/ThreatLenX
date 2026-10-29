/**
 * event-normalizer.ts
 *
 * Ingestion boundary and schema normalizer for external security events.
 * Translates arbitrary external logs (SIEM, EDR, Syslog, Cloud audit)
 * into canonical SecurityEventInput objects with strict provenance and deduplication.
 */

import type { SecurityEventInput, EventCategory, EventSeverity } from '../models/event';

export interface NormalizationResult {
  valid: boolean;
  event?: SecurityEventInput;
  error?: string;
}

/**
 * Normalizes external raw security event records into canonical SecurityEventInput.
 */
export function normalizeExternalEvent(
  raw: Record<string, unknown>,
  sourceProvider: string
): NormalizationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Raw event must be a non-null object' };
  }

  // 1. Resolve source timestamp vs ingestion timestamp
  const rawTime = raw.timestamp || raw.eventTime || raw.time || raw['@timestamp'] || raw.created_at;
  let eventTimestamp: string;
  if (typeof rawTime === 'string' && !isNaN(Date.parse(rawTime))) {
    eventTimestamp = new Date(rawTime).toISOString();
  } else if (typeof rawTime === 'number') {
    eventTimestamp = new Date(rawTime).toISOString();
  } else {
    eventTimestamp = new Date().toISOString();
  }

  // 2. Resolve eventType
  const eventType = String(
    raw.eventType || raw.event_type || raw.action || raw.eventName || raw.type || 'EXTERNAL_ACTIVITY'
  ).toUpperCase();

  // 3. Map severity
  const rawSev = String(raw.severity || raw.level || raw.priority || 'INFO').toUpperCase();
  let severity: EventSeverity = 'INFO';
  if (rawSev.includes('CRIT')) severity = 'CRITICAL';
  else if (rawSev.includes('HIGH')) severity = 'HIGH';
  else if (rawSev.includes('MED')) severity = 'MEDIUM';
  else if (rawSev.includes('LOW')) severity = 'LOW';

  // 4. Map functional category
  let category: EventCategory = 'SYSTEM';
  const typeLower = eventType.toLowerCase();
  const rawCat = String(raw.category || raw.source_category || raw.cat || '').toLowerCase();
  if (rawCat.includes('process') || typeLower.includes('process') || typeLower.includes('exec') || typeLower.includes('spawn')) {
    category = 'PROCESS';
  } else if (rawCat.includes('auth') || typeLower.includes('logon') || typeLower.includes('auth') || typeLower.includes('login')) {
    category = 'AUTHENTICATION';
  } else if (rawCat.includes('network') || typeLower.includes('network') || typeLower.includes('connect') || typeLower.includes('traffic') || typeLower.includes('flow')) {
    category = 'NETWORK';
  } else if (rawCat.includes('file') || typeLower.includes('file') || typeLower.includes('write') || typeLower.includes('delete')) {
    category = 'FILE';
  } else if (rawCat.includes('endpoint') || typeLower.includes('endpoint') || typeLower.includes('agent')) {
    category = 'ENDPOINT';
  } else if (rawCat.includes('user') || rawCat.includes('identity') || typeLower.includes('user') || typeLower.includes('account') || typeLower.includes('identity')) {
    category = 'IDENTITY';
  }

  // 5. Resolve source and external provenance
  const sourceId = String(raw.id || raw.eventId || raw.event_id || `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sensor = String(raw.source || raw.sensor || raw.host || sourceProvider);

  // 6. Build message
  const message = String(
    raw.message || raw.description || raw.msg || raw.summary || `${sourceProvider}: ${eventType} event detected on ${sensor}`
  );

  // 7. Extract network / host telemetry
  const srcIp = raw.srcIp || raw.src_ip || raw.sourceIp || raw.sourceIP || (typeof raw.ip === 'string' ? raw.ip : undefined);
  const dstIp = raw.dstIp || raw.dst_ip || raw.destinationIp || raw.destinationIP || undefined;
  const processName = raw.processName || raw.process_name || raw.process || undefined;
  const commandLine = raw.commandLine || raw.command_line || raw.cmd || undefined;
  const assetId = raw.assetId ? String(raw.assetId) : undefined;
  const userId = raw.userId ? String(raw.userId) : undefined;

  // 8. Construct canonical SecurityEventInput
  const normalized: SecurityEventInput = {
    eventType,
    category,
    severity,
    source: sensor,
    sourceType: 'EXTERNAL',
    timestamp: eventTimestamp,
    message,
    assetId,
    userId,
    srcIp: srcIp ? String(srcIp) : undefined,
    dstIp: dstIp ? String(dstIp) : undefined,
    processName: processName ? String(processName) : undefined,
    commandLine: commandLine ? String(commandLine) : undefined,
    metadata: {
      sourceProvider,
      sourceId,
      sourceReceivedAt: new Date().toISOString(),
      rawFieldsCount: Object.keys(raw).length,
      externalHost: raw.host || raw.asset || raw.hostname || undefined,
      externalUser: raw.user || raw.username || undefined,
    },
  };

  return {
    valid: true,
    event: normalized,
  };
}

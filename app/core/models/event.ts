/**
 * event.ts
 *
 * Canonical SecurityEvent data model for EXPLAIN-SEC SPATIAL.
 *
 * Architectural Principle:
 * - Telemetry != Incident.
 * - An event is raw/normalized security telemetry (Sysmon, Windows Security,
 *   Firewall, Network Flow, Proxy/DNS, Endpoint, Cloud, Authentication).
 * - Events may be correlated into Incidents or timeline milestones later.
 * - 100% offline, local schema.
 */

import type { Severity } from './incident';

export type EventSeverity = Severity; // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export type EventCategory =
  | 'AUTHENTICATION'
  | 'NETWORK'
  | 'PROCESS'
  | 'ENDPOINT'
  | 'FILE'
  | 'IDENTITY'
  | 'SYSTEM'
  | 'SECURITY_CONTROL';

export type EventSourceType =
  | 'ENDPOINT'
  | 'FIREWALL'
  | 'AUTH'
  | 'DNS'
  | 'PROXY'
  | 'APPLICATION'
  | 'SYSTEM'
  | 'SIMULATOR'
  | 'SIMULATION'
  | 'EXTERNAL';

export interface SecurityEvent {
  /** Unique, stable canonical identifier (e.g. 'evt-sec-1729000-001') */
  id: string;

  /** Timestamp when event occurred (ISO 8601 UTC) */
  timestamp: string;

  /** Timestamp when event was ingested into local engine (ISO 8601 UTC) */
  receivedAt: string;

  /** Machine-readable event type (e.g. 'PROCESS_CREATE', 'LOGON_FAILED', 'DNS_QUERY', 'NETWORK_FLOW') */
  eventType: string;

  /** Canonical functional category */
  category: EventCategory;

  /** Standardized security severity */
  severity: EventSeverity;

  /** Name of emitting sensor or system (e.g. 'Sysmon-FINWS-027', 'PaloAlto-Edge', 'WinEventLog-Security') */
  source: string;

  /** Source architecture type */
  sourceType: EventSourceType;

  /** Associated Asset ID if localized to a specific host (e.g. 'asset-001') */
  assetId?: string;

  /** Associated User ID if authenticated or associated with an identity (e.g. 'user-001') */
  userId?: string;

  /** Associated Incident ID if correlated (e.g. 'incident-001') */
  incidentId?: string;

  /** Associated IOC IDs if an indicator matches (e.g. ['ioc-001']) */
  iocIds?: string[];

  // ─── Network Telemetry ──────────────────────────────────────────
  srcIp?: string;
  dstIp?: string;
  srcPort?: number;
  dstPort?: number;
  protocol?: 'TCP' | 'UDP' | 'ICMP' | 'HTTP' | 'HTTPS' | 'DNS' | 'SMB' | 'SSH' | string;

  // ─── Host / Process Telemetry ───────────────────────────────────
  processName?: string;
  processId?: number;
  parentProcessName?: string;
  parentProcessId?: number;
  commandLine?: string;
  filePath?: string;
  fileHash?: string;

  // ─── Web / Identity Telemetry ───────────────────────────────────
  domain?: string;
  url?: string;
  httpMethod?: string;
  httpStatus?: number;

  // ─── Semantic Payload ───────────────────────────────────────────
  message: string;
  rawPayload?: string;
  metadata?: Record<string, unknown>;

  // Backward compatibility aliases
  details?: Record<string, unknown>;
  ip?: string;
  hash?: string;

  /** Deterministic signature hash for deduplication */
  signature?: string;
}

export type SecurityEventInput = Omit<SecurityEvent, 'id' | 'receivedAt' | 'timestamp' | 'sourceType'> & {
  id?: string;
  timestamp?: string;
  sourceType?: EventSourceType;
  receivedAt?: string;
};

export interface SecurityEventQuery {
  startTime?: string;
  endTime?: string;
  severity?: EventSeverity | EventSeverity[];
  category?: EventCategory | EventCategory[];
  source?: string | string[];
  sourceType?: EventSourceType | EventSourceType[];
  assetId?: string;
  userId?: string;
  incidentId?: string;
  iocId?: string;
  eventType?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortOrder?: 'ASC' | 'DESC';
}

export interface SecurityEventStats {
  totalEvents: number;
  eventsLast5Min: number;
  eventsLastHour: number;
  eventsLast24Hours: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  byCategory: Record<EventCategory, number>;
  bySourceType: Record<EventSourceType, number>;
  topAssets: { assetId: string; count: number }[];
}

export interface IngestEventResult {
  success: boolean;
  event?: SecurityEvent;
  isDuplicate: boolean;
  error?: string;
}

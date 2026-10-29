/**
 * hunting.ts
 *
 * Canonical Threat Hunting domain models for EXPLAIN-SEC SPATIAL.
 *
 * Architectural Principle:
 * - Threat hunting is hypothesis-driven exploration across canonical SecurityEvents.
 * - SecurityEvent = what happened (telemetry).
 * - DetectionRule = what is suspicious according to a rule.
 * - Alert = rule detected suspicious activity.
 * - Incident = correlated security activity.
 * - ThreatHunt = analyst proactively investigates whether suspicious activity exists.
 *
 * 100% offline, local schema.
 */

import type { EventCategory, EventSeverity, SecurityEvent } from './event';

export type ThreatHuntStatus = 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'ARCHIVED';

export type QueryOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'in'
  | 'notIn'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual';

export interface HuntFilterCondition {
  field: keyof SecurityEvent | string;
  operator: QueryOperator;
  value: string | number | boolean | string[] | number[];
}

export interface ThreatHuntQuery {
  /** ISO timestamp start range */
  startTime?: string;
  /** ISO timestamp end range */
  endTime?: string;

  /** Filter by event types (e.g. ['PROCESS_CREATE', 'NETWORK_FLOW']) */
  eventTypes?: string[];

  /** Filter by functional categories */
  categories?: EventCategory[];

  /** Filter by standardized severities */
  severities?: EventSeverity[];

  /** Filter by associated entities */
  assetIds?: string[];
  userIds?: string[];
  incidentIds?: string[];
  alertIds?: string[];

  /** Network telemetry filters */
  sourceIps?: string[];
  destinationIps?: string[];
  domains?: string[];
  urls?: string[];

  /** Process telemetry filters */
  processes?: string[];
  commandLines?: string[];
  hashes?: string[];

  /** Protocol & Port */
  protocols?: string[];
  ports?: number[];

  /** Optional MITRE technique identifiers if enriched */
  mitreTechniqueIds?: string[];

  /** Free-text search term across message, commandLine, domain, etc. */
  text?: string;

  /** Advanced structured filter conditions evaluated with typed operators */
  conditions?: HuntFilterCondition[];

  /** Maximum records to return (default 100) */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Ordering (default 'DESC' by timestamp) */
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Retains provenance back to the underlying canonical SecurityEvent.
 */
export interface ThreatHuntResult {
  /** Event reference */
  eventId: string;
  event: SecurityEvent;
  timestamp: string;
  eventType: string;
  severity: EventSeverity;
  category: EventCategory;

  /** Entity context */
  assetId?: string;
  userId?: string;
  source: string;

  /** Relevant parameters */
  srcIp?: string;
  dstIp?: string;
  processName?: string;
  commandLine?: string;
  domain?: string;
  iocIds?: string[];

  /** Provenance state */
  isKnown: boolean; // true if already tied to an alert or incident
  relatedAlertIds: string[];
  relatedIncidentId?: string;
  mitreTechniqueId?: string;

  /** Human-readable deterministic match rationale */
  explanation: string;
}

export interface ThreatHuntAggregation {
  byAsset: { key: string; count: number }[];
  byUser: { key: string; count: number }[];
  bySourceIp: { key: string; count: number }[];
  byDestinationIp: { key: string; count: number }[];
  byDomain: { key: string; count: number }[];
  byProcess: { key: string; count: number }[];
  byEventType: { key: string; count: number }[];
  bySeverity: Record<EventSeverity, number>;
  byCategory: Record<EventCategory, number>;
  overTime: { bucket: string; count: number }[];
  knownCount: number;
  unknownCount: number;
}

export interface ThreatHuntExecutionResult {
  results: ThreatHuntResult[];
  totalMatches: number;
  aggregations: ThreatHuntAggregation;
  matchedEventIds: string[];
  relatedAlertIds: string[];
  relatedIncidentIds: string[];
  executionTimeMs: number;
  executedAt: string;
}

/**
 * Saved canonical ThreatHunt session / investigation notebook.
 */
export interface ThreatHunt {
  id: string;
  name: string;
  description: string;
  status: ThreatHuntStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  query: ThreatHuntQuery;
  resultCount: number;
  matchedEventIds: string[];
  relatedAlertIds: string[];
  relatedIncidentIds: string[];
  tags: string[];
  notes?: string;
  lastExecutedAt?: string;
}

export interface CreateThreatHuntInput {
  name: string;
  description: string;
  query: ThreatHuntQuery;
  tags?: string[];
  notes?: string;
}

export interface CreateIncidentFromHuntInput {
  title: string;
  severity: EventSeverity;
  summary: string;
  eventIds: string[];
  assignedTo?: string;
}

export interface ThreatHuntTemplate {
  id: string;
  name: string;
  description: string;
  category: EventCategory;
  recommendedRole: string;
  query: ThreatHuntQuery;
  hypothesis: string;
}

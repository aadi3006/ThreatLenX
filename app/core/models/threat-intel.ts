/**
 * threat-intel.ts
 *
 * Canonical Threat Intelligence domain models for EXPLAIN-SEC SPATIAL.
 *
 * Architectural Principle:
 * - IOC = canonical indicator observable recorded or seen in the SOC.
 * - Threat Intelligence = analytical context, confidence assessment, malware family/campaign
 *   correlations, and relationships between the indicator and events, assets, users, alerts,
 *   incidents, hunts, and cases.
 * - 100% offline, deterministic, zero remote telemetry/feed dependencies.
 */

import type { IocType } from './entity';
import type { Severity } from './incident';

/**
 * Deterministic intelligence confidence level.
 * Describes confidence in the intelligence context (distinct from severity or priority).
 */
export type IntelConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Threat intelligence classification.
 */
export type IntelClassification = 'MALICIOUS' | 'SUSPICIOUS' | 'BENIGN' | 'UNKNOWN';

/**
 * Origin of threat intelligence.
 * Strictly honest offline source attribution (no fake commercial vendor claims).
 */
export type IntelSourceType =
  | 'LOCAL_SEED'
  | 'LOCAL_ANALYST'
  | 'DETECTION_ENGINE'
  | 'HUNT_ENGINE'
  | 'INCIDENT_ANALYSIS'
  | 'CASE_ANALYSIS'
  | 'DETERMINISTIC_LOCAL_ENGINE';

/**
 * Types of semantic relationships between an indicator and SOC entities.
 */
export type IntelRelationshipType =
  | 'COMMUNICATES_WITH' // IP/Domain <-> Asset
  | 'OBSERVED_ON'       // File/Hash/Registry <-> Asset
  | 'EXECUTED_BY'       // Process/File <-> User
  | 'ASSOCIATED_WITH'   // IOC <-> Incident / Case / ThreatHunt
  | 'INDICATES'         // IOC <-> Malware Family / Threat Type
  | 'USES'              // Malware Family <-> MITRE Technique
  | 'DELIVERS'          // Domain/URL <-> Staged Hash / Payload
  | 'MAPS_TO'           // IOC <-> MITRE Technique
  | 'RELATED_TO';       // IOC <-> IOC

export type IntelTargetType =
  | 'IOC'
  | 'ASSET'
  | 'USER'
  | 'INCIDENT'
  | 'ALERT'
  | 'SECURITY_EVENT'
  | 'THREAT_HUNT'
  | 'CASE'
  | 'EVIDENCE'
  | 'MITRE_TECHNIQUE'
  | 'MALWARE_FAMILY'
  | 'CAMPAIGN';

/**
 * Canonical Threat Intelligence Record.
 * Adds analytical depth to an existing canonical IOC.
 */
export interface ThreatIntelRecord {
  /** Unique stable identifier (e.g. 'intel-ioc-001') */
  id: string;

  /** Canonical indicator foreign key */
  indicatorId: string;

  /** Indicator observable type (from entity.ts) */
  indicatorType: IocType;

  /** Indicator observable value */
  indicatorValue: string;

  /** Analyst/Engine title for this intelligence record */
  title: string;

  /** Detailed intelligence description and contextual assessment */
  description?: string;

  /** Deterministic confidence level */
  confidence: IntelConfidence;

  /** Assessed severity of the threat indicated */
  severity: Severity;

  /** Threat classification */
  classification: IntelClassification;

  /** Earliest observation timestamp derived from canonical events/IOCs */
  firstSeenAt?: string;

  /** Latest observation timestamp derived from canonical events/IOCs */
  lastSeenAt?: string;

  /** Provenance of the intelligence record */
  sourceType: IntelSourceType;

  /** Specific analyst, engine, or seed identifier */
  sourceName?: string;

  /** Categorization tags */
  tags: string[];

  /** Threat categorization (e.g. ['Ransomware', 'C2', 'Data Exfiltration']) */
  threatTypes: string[];

  /** Associated malware families (e.g. ['BlackCat/ALPHV']) */
  malwareFamilies?: string[];

  /** Associated campaigns (e.g. ['Operation BlackTide']) */
  campaigns?: string[];

  /** Attributed threat actors (only if defensibly supported by local context, otherwise omitted) */
  actors?: string[];

  /** Associated MITRE ATT&CK technique IDs (e.g. ['T1204.002', 'T1071.001']) */
  mitreTechniqueIds?: string[];

  /** Related indicator IDs (e.g. ['ioc-002']) */
  relatedIndicatorIds?: string[];

  /** Aggregated observation count across telemetry */
  observationsCount: number;

  /** ISO 8601 UTC creation timestamp */
  createdAt: string;

  /** ISO 8601 UTC last update timestamp */
  updatedAt: string;

  /** Extensible analytical metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Graph relationship edge connecting an indicator to another entity or context object.
 */
export interface ThreatIntelRelationship {
  id: string;

  sourceType: 'IOC';
  sourceId: string; // IOC ID

  targetType: IntelTargetType;
  targetId: string; // Target entity ID

  relationshipType: IntelRelationshipType;
  confidence: IntelConfidence;

  source: string; // Originating source/analyst

  createdAt: string;
  createdBy: string;

  metadata?: Record<string, unknown>;
}

export type ThreatIntelConfidence = IntelConfidence;
export type ThreatIntelClassification = IntelClassification;
export type ThreatIntelSourceType = IntelSourceType;
export type ThreatIntelRelationshipType = IntelRelationshipType;
export type ThreatIntelTargetType = IntelTargetType;
export type ThreatIntelSeverity = Severity;

/**
 * Input for creating a new Threat Intelligence Record.
 */
export interface CreateThreatIntelInput {
  indicatorId?: string;
  indicatorType?: IocType;
  indicatorValue?: string;
  title: string;
  description?: string;
  confidence?: IntelConfidence;
  severity?: Severity;
  classification?: IntelClassification;
  sourceType?: IntelSourceType;
  sourceName?: string;
  tags?: string[];
  threatTypes?: string[];
  malwareFamilies?: string[];
  campaigns?: string[];
  actors?: string[];
  mitreTechniqueIds?: string[];
  relatedIndicatorIds?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Patch for updating an existing Threat Intelligence Record.
 */
export interface UpdateThreatIntelInput {
  title?: string;
  description?: string;
  confidence?: IntelConfidence;
  severity?: Severity;
  classification?: IntelClassification;
  tags?: string[];
  threatTypes?: string[];
  malwareFamilies?: string[];
  campaigns?: string[];
  actors?: string[];
  mitreTechniqueIds?: string[];
  relatedIndicatorIds?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Filter for querying Threat Intelligence Records.
 */
export interface ThreatIntelQueryFilter {
  indicatorId?: string;
  indicatorType?: IocType;
  indicatorValue?: string;
  confidence?: IntelConfidence | IntelConfidence[];
  severity?: Severity | Severity[];
  classification?: IntelClassification | IntelClassification[];
  sourceType?: IntelSourceType | IntelSourceType[];
  threatType?: string;
  malwareFamily?: string;
  campaign?: string;
  mitreTechniqueId?: string;
  tag?: string;
  query?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Aggregated local observations for an indicator across all canonical SOC data.
 */
export interface IndicatorObservations {
  indicatorId: string;
  indicatorValue: string;
  totalObservations: number;
  totalCount?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;

  eventsCount: number;
  eventIds: string[];

  alertsCount: number;
  alertIds: string[];

  incidentsCount: number;
  incidentIds: string[];

  huntsCount: number;
  huntIds: string[];

  casesCount: number;
  caseIds: string[];

  evidenceCount: number;
  evidenceIds: string[];

  assetsCount: number;
  assetIds: string[];

  usersCount: number;
  userIds: string[];
}

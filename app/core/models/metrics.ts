/**
 * metrics.ts
 *
 * Canonical SOC Metrics & Operational Analytics data models for EXPLAIN-SEC SPATIAL.
 *
 * Rules:
 * - 100% offline, local metrics calculated purely from canonical SOC data.
 * - Zero Math.random(), zero simulated counters, zero hardcoded numbers.
 * - Time-series bucketing capped at 30-60 buckets to preserve 60fps spatial rendering.
 * - Full provenance transparency: every metric tracks calculation formula, source store, and sample size.
 * - Supports data source isolation: 'LIVE' (default, excludes cyber range simulation), 'SIMULATION', or 'ALL'.
 */

export type TimeWindow =
  | 'LAST_15_MINUTES'
  | 'LAST_HOUR'
  | 'LAST_6_HOURS'
  | 'LAST_24_HOURS'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'ALL_TIME'
  | 'CUSTOM_RANGE';

export type DataSourceFilter = 'LIVE' | 'SIMULATION' | 'ALL';

export interface TimeWindowFilter {
  window: TimeWindow;
  start?: string; // ISO string for CUSTOM_RANGE
  end?: string;   // ISO string for CUSTOM_RANGE
  sourceMode?: DataSourceFilter; // Default is 'LIVE'
}

export type MetricCategory =
  | 'SECURITY_ACTIVITY'
  | 'DETECTION'
  | 'INCIDENTS'
  | 'CASES'
  | 'THREAT_HUNTING'
  | 'EVIDENCE'
  | 'THREAT_INTEL'
  | 'SOAR'
  | 'AUDIT'
  | 'OPERATIONS';

export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  category: MetricCategory;
  unit: string;
  source: string;
  formula: string;
  timeScope: string;
  entityScope: string;
}

export interface TimeSeriesBucket {
  timestamp: string; // ISO start of bucket
  label: string;     // Friendly display label (e.g., "14:15", "Sep 22")
  count: number;
  breakdown?: Record<string, number>;
}

export interface DistributionBucket {
  label: string;
  count: number;
  percentage: number;
  color?: string;
}

export interface TopEntityItem {
  id: string;
  name: string;
  type: 'ASSET' | 'USER' | 'RULE' | 'IOC' | 'MITRE' | 'ACTION';
  count: number;
  severity?: string;
  details?: string;
}

export interface KpiResult {
  metricId: string;
  label: string;
  value: number | null;
  formattedValue: string;
  unit: string;
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'INSUFFICIENT_DATA';
  explanation: {
    what: string;
    why: string;
    source: string;
    formula: string;
    sampleSize: number;
    missingDataReason?: string;
  };
}

export interface SocActivityTimelineItem {
  id: string;
  timestamp: string;
  type:
    | 'EVENT_INGESTED'
    | 'ALERT_CREATED'
    | 'ALERT_ACKNOWLEDGED'
    | 'ALERT_RESOLVED'
    | 'INCIDENT_CREATED'
    | 'INCIDENT_UPDATED'
    | 'INCIDENT_CLOSED'
    | 'HUNT_STARTED'
    | 'HUNT_COMPLETED'
    | 'CASE_CREATED'
    | 'EVIDENCE_COLLECTED'
    | 'IOC_BLOCKED'
    | 'ASSET_ISOLATED'
    | 'PLAYBOOK_STARTED'
    | 'PLAYBOOK_COMPLETED'
    | 'PLAYBOOK_FAILED'
    | 'AUDIT_RECORD';
  title: string;
  category: string;
  severity?: string;
  entityId?: string;
  entityType?: string;
  details?: string;
}

export interface MetricProvenance {
  metricId: string;
  name: string;
  sourceStore: string;
  filterApplied: string;
  timeWindow: string;
  totalRecordsScanned: number;
  qualifyingRecords: number;
  computedAt: string;
  formula: string;
  sampleIds?: string[];
  sourceMode?: DataSourceFilter;
}

export interface IncidentAgingBreakdown {
  under1Hour: number;
  oneTo4Hours: number;
  fourTo24Hours: number;
  oneTo7Days: number;
  over7Days: number;
}

export interface SocOperationalSnapshot {
  generatedAt: string;
  timeWindow: TimeWindow;
  threatLevel: 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
  threatScore: number;
  
  // Security Activity
  eventCount: number;
  
  // Detection
  alertCount: number;
  openAlertCount: number;
  criticalAlertCount: number;
  highAlertCount: number;
  detectionRuleCount: number;
  enabledDetectionRuleCount: number;
  
  // Incidents
  incidentCount: number;
  openIncidentCount: number;
  criticalIncidentCount: number;
  highIncidentCount: number;
  incidentAging: IncidentAgingBreakdown;
  
  // Entities & Intel
  compromisedAssetCount: number;
  isolatedAssetCount: number;
  suspiciousAssetCount: number;
  activeIOCCount: number;
  blockedIOCCount: number;
  
  // Investigation & Operations
  activeCases: number;
  activeHunts: number;
  evidenceCount: number;
  
  // SOAR Response
  activePlaybookExecutions: number;
  waitingApprovalExecutions: number;
  completedPlaybookExecutions: number;
  failedPlaybookExecutions: number;
  
  // Audit
  auditRecordCount: number;
  
  // Core Operational KPIs
  mttd: KpiResult;
  mtta: KpiResult;
  alertMttr: KpiResult;
  incidentMttr: KpiResult;
  responseSuccessRate: KpiResult;

  // Extended Step 10 Canonical Metrics
  alertVolume?: KpiResult;
  detectionVolume?: KpiResult;
  incidentVolume?: KpiResult;
  severityDistributionMetric?: KpiResult;
  responseActionsMetric?: KpiResult;
  detectionEfficacy?: KpiResult;
  investigationDuration?: KpiResult;
  analystActivity?: KpiResult;
  assetExposure?: KpiResult;
  recurringAttackPatterns?: KpiResult;

  // Simulation Provenance & Isolation
  sourceMode?: DataSourceFilter;
  provenance?: {
    sourceMode: DataSourceFilter;
    generatedAt: string;
  };
}

export type CanonicalMetricId =
  | 'MTTD'
  | 'MTTA'
  | 'MTTR'
  | 'ALERT_MTTR'
  | 'INCIDENT_MTTR'
  | 'ALERT_VOLUME'
  | 'DETECTION_VOLUME'
  | 'INCIDENT_VOLUME'
  | 'SEVERITY_DISTRIBUTION'
  | 'RESPONSE_ACTIONS'
  | 'DETECTION_EFFICACY'
  | 'INVESTIGATION_DURATION'
  | 'ANALYST_ACTIVITY'
  | 'ASSET_EXPOSURE'
  | 'RECURRING_ATTACK_PATTERNS';

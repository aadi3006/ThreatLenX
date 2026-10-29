import type { Asset, SecurityUser, IOC } from './entity';
import type { MitreTechnique } from './mitre';
import type { AttackGraph } from './attack-graph';
import type { ResponseAction } from './response';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type IncidentStatus =
  | 'NEW'
  | 'TRIAGED'
  | 'INVESTIGATING'
  | 'CONTAINING'
  | 'RESOLVED'
  | 'CLOSED'
  | 'FALSE_POSITIVE';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  title: string;
  stage:
    | 'INITIAL_ACCESS'
    | 'EXECUTION'
    | 'PERSISTENCE'
    | 'PRIVILEGE_ESCALATION'
    | 'DEFENSE_EVASION'
    | 'CREDENTIAL_ACCESS'
    | 'DISCOVERY'
    | 'LATERAL_MOVEMENT'
    | 'COLLECTION'
    | 'EXFILTRATION'
    | 'IMPACT';
  severity: Severity;
  description: string;
  entityId?: string;
  entityType?: 'ASSET' | 'USER' | 'IOC' | 'PROCESS';
  techniqueId?: string;
  metadata?: Record<string, unknown>;
}

export interface CorrelationChainItem {
  id: string;
  alertId: string;
  title: string;
  ruleName: string;
  timestamp: string;
  confidence: number;
  evidenceSummary: string;
}

export interface IncidentEvidence {
  id: string;
  incidentId: string;
  title: string;
  type: 'LOG' | 'NETWORK_PCAP' | 'MEMORY_DUMP' | 'FILE_SAMPLE' | 'SCREENSHOT' | 'ANALYST_NOTE' | 'HASH';
  source: string;
  collectedAt: string;
  hash?: string;
  content: string;
  collectedBy: string;
  isVerified: boolean;
}

export type IncidentPriority = 'P1' | 'P2' | 'P3' | 'P4';

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  riskScore: number; // 0.0 - 100.0
  status: IncidentStatus;
  confidence: number; // 0.0 - 1.0
  createdAt: string;
  updatedAt: string;
  assignedTo?: string;
  assignedRole?: string;
  affectedAssets: string[]; // Asset IDs
  affectedUsers: string[]; // User IDs
  iocs: string[]; // IOC IDs
  mitreTechniques: string[]; // Technique IDs (e.g. 'T1078.002')
  timelineEvents: TimelineEvent[];
  correlationChain: CorrelationChainItem[];
  evidence: IncidentEvidence[];
  summary?: string;
  attackPathId?: string;

  // ─── Step 4 Correlation Extensions ─────────────────────────────────────────
  description?: string;
  priority?: IncidentPriority;
  source?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  eventIds?: string[];
  alertIds?: string[];
  correlationScore?: number; // 0 - 100
  correlationReasons?: string[];
  tags?: string[];
  closedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IncidentDetail extends Incident {
  assets: Asset[];
  users: SecurityUser[];
  iocDetails: IOC[];
  techniques: MitreTechnique[];
  attackGraph: AttackGraph;
  responseActions: ResponseAction[];
}

export interface CreateIncidentInput {
  title: string;
  severity: Severity;
  riskScore?: number;
  priority?: IncidentPriority;
  summary?: string;
  description?: string;
  source?: string;
  assignedTo?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  affectedAssets?: string[];
  affectedUsers?: string[];
  iocs?: string[];
  mitreTechniques?: string[];
  eventIds?: string[];
  alertIds?: string[];
  correlationScore?: number;
  correlationReasons?: string[];
  tags?: string[];
  initialDetectionDescription?: string;
}

// ─── Correlation Domain Types (Step 4) ────────────────────────────────────────

export type CorrelationSignalType =
  | 'SAME_ASSET'
  | 'SHARED_IOC'
  | 'SAME_USER'
  | 'TEMPORAL_PROXIMITY'
  | 'MITRE_KILL_CHAIN_PROGRESSION'
  | 'SHARED_DESTINATION_NETWORK'
  | 'MANUAL_ANALYST';

export interface CorrelationSignal {
  type: CorrelationSignalType;
  weight: number;
  score: number;
  description: string;
  detail?: Record<string, any>;
}

export interface CorrelationCandidate {
  id: string;
  eventIds: string[];
  alertIds: string[];
  assetIds: string[];
  userIds: string[];
  iocIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  confidence: number; // 0 - 100
  reasons: string[];
  signals: CorrelationSignal[];
}

export interface CorrelationMatchResult {
  matched: boolean;
  incidentId?: string;
  incident?: Incident;
  isNewIncidentRequired?: boolean;
  score: number;
  reasons: string[];
  signals: CorrelationSignal[];
}

export interface IncidentQuery {
  status?: IncidentStatus | IncidentStatus[];
  severity?: Severity | Severity[];
  priority?: IncidentPriority | IncidentPriority[];
  assetId?: string;
  userId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortOrder?: 'ASC' | 'DESC';
}

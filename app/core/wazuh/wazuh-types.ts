/**
 * app/core/wazuh/wazuh-types.ts
 *
 * TypeScript types for the Wazuh SOC integration module.
 * Defines raw Wazuh API schemas, canonical normalized alert structures,
 * and service status metadata.
 */

// ─── Normalized Internal Alert Format ─────────────────────────────────────────

export type NormalizedSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type NormalizedAlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED';

export interface NormalizedAgentInfo {
  id: string;
  name: string;
  ip?: string;
  status?: string;
}

/**
 * Canonical normalized alert structure consumed by the SOC backend and dashboard.
 * Strictly decoupled from Wazuh's internal API representations.
 */
export interface NormalizedAlert {
  id: string;
  timestamp: string;
  severity: NormalizedSeverity;
  source: string;
  destination: string;
  description: string;
  rule_id: string;
  mitre_technique?: string;
  agent: NormalizedAgentInfo;
  status: NormalizedAlertStatus;
  raw?: Record<string, unknown>;
}

// ─── Wazuh Agent Models ───────────────────────────────────────────────────────

export type WazuhAgentStatus = 'active' | 'disconnected' | 'never_connected' | 'pending';

export interface WazuhAgent {
  id: string;
  name: string;
  ip?: string;
  status: WazuhAgentStatus;
  version?: string;
  os?: {
    name?: string;
    platform?: string;
    version?: string;
    arch?: string;
  };
  node_name?: string;
  lastKeepAlive?: string;
  dateAdd?: string;
  group?: string[];
}

export interface WazuhAgentStatusSummary {
  total: number;
  active: number;
  disconnected: number;
  never_connected: number;
  pending: number;
}

// ─── Raw Wazuh API Response Schemas ───────────────────────────────────────────

export interface WazuhAuthResponse {
  error: number;
  message?: string;
  data?: {
    token: string;
  };
}

export interface WazuhRawRule {
  id: number | string;
  level: number;
  description: string;
  groups?: string[];
  mitre?: {
    id?: string[] | string;
    tactic?: string[] | string;
    technique?: string[] | string;
  };
  pci_dss?: string[];
  gdpr?: string[];
}

export interface WazuhRawAgent {
  id: string;
  name: string;
  ip?: string;
  status?: string;
}

export interface WazuhRawAlert {
  id?: string;
  _id?: string;
  timestamp?: string;
  '@timestamp'?: string;
  rule?: WazuhRawRule;
  agent?: WazuhRawAgent;
  data?: {
    srcip?: string;
    dstip?: string;
    srcport?: number | string;
    dstport?: number | string;
    srcuser?: string;
    dstuser?: string;
    command?: string;
    [key: string]: unknown;
  };
  full_log?: string;
  location?: string;
  decoder?: {
    name?: string;
  };
  [key: string]: unknown;
}

export interface WazuhApiResponse<T> {
  error: number;
  message?: string;
  data: {
    affected_items: T[];
    total_affected_items: number;
    failed_items?: unknown[];
    total_failed_items?: number;
  };
}

// ─── Connection & Service Diagnostics ─────────────────────────────────────────

export type WazuhDataMode = 'LIVE' | 'MOCK_FALLBACK';

export interface WazuhConnectionStatus {
  isConnected: boolean;
  mode: WazuhDataMode;
  apiUrl: string;
  authConfigured: boolean;
  version?: string;
  latencyMs?: number;
  lastChecked: string;
  error?: string;
}

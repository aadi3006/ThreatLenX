/**
 * app/core/wazuh/wazuh-normalizer.ts
 *
 * Normalization layer transforming heterogeneous Wazuh API responses
 * into the canonical internal NormalizedAlert model.
 */

import type {
  NormalizedAlert,
  NormalizedSeverity,
  WazuhRawAlert,
  WazuhAgent,
} from './wazuh-types';
import type { Alert, AlertStatus } from '../models/detection';

/**
 * Maps Wazuh rule severity levels (0-16) to normalized SOC severity.
 *
 * Wazuh standards:
 * - 0 - 2: Informational
 * - 3 - 4: Low priority
 * - 5 - 7: Medium priority
 * - 8 - 11: High priority
 * - 12 - 16: Critical / Immediate action required
 */
export function mapWazuhLevelToSeverity(level: number | undefined): NormalizedSeverity {
  const lvl = typeof level === 'number' ? level : 0;
  if (lvl >= 12) return 'CRITICAL';
  if (lvl >= 8) return 'HIGH';
  if (lvl >= 5) return 'MEDIUM';
  if (lvl >= 3) return 'LOW';
  return 'INFO';
}

/**
 * Normalizes raw MITRE ATT&CK information from Wazuh rule objects.
 */
export function extractMitreTechnique(rawRule?: WazuhRawAlert['rule']): string | undefined {
  if (!rawRule?.mitre) return undefined;

  const mitre = rawRule.mitre;
  const ids = Array.isArray(mitre.id) ? mitre.id : mitre.id ? [mitre.id] : [];
  const techniques = Array.isArray(mitre.technique)
    ? mitre.technique
    : mitre.technique
    ? [mitre.technique]
    : [];
  const tactics = Array.isArray(mitre.tactic)
    ? mitre.tactic
    : mitre.tactic
    ? [mitre.tactic]
    : [];

  if (ids.length > 0) {
    const firstId = ids[0];
    const techName = techniques[0] || tactics[0];
    return techName ? `${firstId} (${techName})` : firstId;
  }

  if (techniques.length > 0) return techniques[0];
  if (tactics.length > 0) return tactics[0];
  return undefined;
}

/**
 * Normalizes a raw Wazuh alert object into the requested internal alert structure.
 */
export function normalizeWazuhAlert(raw: WazuhRawAlert): NormalizedAlert {
  // 1. Resolve identifier
  const id = String(
    raw.id ||
      raw._id ||
      `wazuh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  // 2. Resolve timestamp
  const rawTime = raw.timestamp || raw['@timestamp'];
  let timestamp: string;
  if (rawTime && !isNaN(Date.parse(rawTime))) {
    timestamp = new Date(rawTime).toISOString();
  } else {
    timestamp = new Date().toISOString();
  }

  // 3. Resolve severity
  const severity = mapWazuhLevelToSeverity(raw.rule?.level);

  // 4. Resolve source and destination
  const source =
    raw.data?.srcip ||
    (raw.srcip as string) ||
    raw.agent?.ip ||
    raw.agent?.name ||
    'EXTERNAL';

  const destination =
    raw.data?.dstip ||
    (raw.dstip as string) ||
    raw.location ||
    'INTERNAL';

  // 5. Resolve description
  const description =
    raw.rule?.description ||
    raw.full_log ||
    (raw.description as string) ||
    'Wazuh Security Event Alert';

  // 6. Resolve rule ID
  const rule_id = String(raw.rule?.id || raw.rule_id || '0');

  // 7. Resolve MITRE ATT&CK info
  const mitre_technique = extractMitreTechnique(raw.rule);

  // 8. Resolve Agent info
  const agent = {
    id: String(raw.agent?.id || '000'),
    name: String(raw.agent?.name || 'wazuh-manager'),
    ip: raw.agent?.ip,
    status: raw.agent?.status || 'active',
  };

  // 9. Normalized Alert Status
  const status = 'NEW';

  return {
    id,
    timestamp,
    severity,
    source,
    destination,
    description,
    rule_id,
    mitre_technique,
    agent,
    status,
    raw,
  };
}

/**
 * Maps an agent raw record to standard WazuhAgent structure.
 */
export function normalizeWazuhAgent(raw: any): WazuhAgent {
  return {
    id: String(raw.id || '000'),
    name: String(raw.name || 'unnamed-agent'),
    ip: raw.ip,
    status: (raw.status || 'disconnected').toLowerCase(),
    version: raw.version,
    os: raw.os,
    node_name: raw.node_name,
    lastKeepAlive: raw.lastKeepAlive,
    dateAdd: raw.dateAdd,
    group: Array.isArray(raw.group) ? raw.group : [],
  };
}

/**
 * Translates our NormalizedAlert into the SOC's canonical Alert model for systemwide ingestion.
 */
export function toCanonicalSocAlert(norm: NormalizedAlert): Alert {
  const socSeverity = norm.severity; // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  return {
    id: norm.id,
    ruleId: `WAZUH-${norm.rule_id}`,
    ruleName: `Wazuh Rule ${norm.rule_id}`,
    title: norm.description.length > 50 ? `${norm.description.slice(0, 47)}…` : norm.description,
    description: `${norm.description} (Agent: ${norm.agent.name} [${norm.agent.id}], Source: ${norm.source}, Dest: ${norm.destination})`,
    severity: socSeverity,
    status: norm.status as AlertStatus,
    category: 'SYSTEM',
    createdAt: norm.timestamp,
    firstSeenAt: norm.timestamp,
    lastSeenAt: norm.timestamp,
    occurrenceCount: 1,
    sourceEventIds: [norm.id],
    primaryEventId: norm.id,
    assetId: norm.agent.id,
    mitreTechniqueId: norm.mitre_technique ? norm.mitre_technique.split(' ')[0] : undefined,
    fingerprint: `wazuh-${norm.rule_id}-${norm.agent.id}-${norm.source}`,
  };
}

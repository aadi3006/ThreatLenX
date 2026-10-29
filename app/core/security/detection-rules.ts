/**
 * detection-rules.ts
 *
 * Deterministic detection rules catalogue for EXPLAIN-SEC SPATIAL.
 * Evaluates canonical SecurityEvents to produce high-fidelity security Alerts.
 *
 * Rules are declarative data — strictly NO eval() or dynamic code execution.
 */

import type { DetectionRule } from '../models/detection';

export const SEED_DETECTION_RULES: DetectionRule[] = [
  // ─── 1. Authentication Anomaly ───────────────────────────────────────────────
  {
    id: 'DET-AUTH-001',
    name: 'Suspicious Authentication & Password Spray Activity',
    description: 'Detects repeated failed authentications, credential bursts, or password spraying targeting enterprise directory services.',
    enabled: true,
    severity: 'MEDIUM',
    category: 'AUTHENTICATION',
    eventTypes: ['AUTHENTICATION_FAILURE', 'BRUTE_FORCE_BURST', 'KERBEROS_PREAUTH_FAIL', 'AUTH_BRUTE_FORCE', 'KERBEROS_TGS_REQUEST'],
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'AUTHENTICATION' },
      { field: 'severity', operator: 'IN_LIST', value: ['MEDIUM', 'HIGH', 'CRITICAL'] },
    ],
    timeWindowMs: 900000, // 15 minutes
    threshold: 1,
    mitreTechniqueId: 'T1110.001',
    mitreTactic: 'Credential Access',
    tags: ['authentication', 'brute_force', 'kerberos'],
    author: 'EXPLAIN-SEC Detection Engineering',
    createdAt: '2024-11-01T00:00:00Z',
    updatedAt: '2024-11-01T00:00:00Z',
  },

  // ─── 2. Suspicious Process Execution ────────────────────────────────────────
  {
    id: 'DET-PROC-001',
    name: 'Suspicious Obfuscated Process Execution',
    description: 'Detects execution of suspicious dropper binaries, masqueraded services (e.g. svchost32.exe), or encoded command-lines spawned by user applications.',
    enabled: true,
    severity: 'CRITICAL',
    category: 'PROCESS',
    eventTypes: ['PROCESS_CREATE', 'SUSPICIOUS_EXECUTION', 'PROCESS_LAUNCH'],
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'PROCESS' },
      { field: 'severity', operator: 'IN_LIST', value: ['HIGH', 'CRITICAL'] },
      { field: 'processName', operator: 'IN_LIST', value: ['svchost32.exe', 'powershell.exe', 'cmd.exe', 'rundll32.exe'] },
    ],
    timeWindowMs: 900000,
    threshold: 1,
    mitreTechniqueId: 'T1059.001',
    mitreTactic: 'Execution',
    tags: ['process', 'dropper', 'blackcat', 'powershell'],
    author: 'EXPLAIN-SEC Detection Engineering',
    createdAt: '2024-11-01T00:00:00Z',
    updatedAt: '2024-11-01T00:00:00Z',
  },

  // ─── 3. Network C2 Beaconing ────────────────────────────────────────────────
  {
    id: 'DET-NET-001',
    name: 'Cobalt Strike C2 Beaconing & Malicious DNS Queries',
    description: 'Detects outbound network flows, DNS lookups, or HTTP/S beacons matching known threat actor infrastructure or high-entropy domains.',
    enabled: true,
    severity: 'CRITICAL',
    category: 'NETWORK',
    eventTypes: ['DNS_QUERY', 'NETWORK_FLOW', 'C2_BEACON_DETECTED'],
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'NETWORK' },
      { field: 'severity', operator: 'IN_LIST', value: ['HIGH', 'CRITICAL'] },
    ],
    timeWindowMs: 900000,
    threshold: 1,
    mitreTechniqueId: 'T1071.001',
    mitreTactic: 'Command and Control',
    tags: ['c2', 'beacon', 'network', 'dns'],
    author: 'EXPLAIN-SEC Detection Engineering',
    createdAt: '2024-11-01T00:00:00Z',
    updatedAt: '2024-11-01T00:00:00Z',
  },

  // ─── 4. Known Threat IOC Match ──────────────────────────────────────────────
  {
    id: 'DET-IOC-001',
    name: 'High-Confidence Indicator of Compromise Match',
    description: 'Fires when an observed security event references one or more confirmed threat indicators (IOCs) such as malicious IPs, domains, or file hashes.',
    enabled: true,
    severity: 'HIGH',
    category: 'SECURITY_CONTROL',
    conditions: [
      { field: 'iocIds', operator: 'EXISTS' },
    ],
    timeWindowMs: 900000,
    threshold: 1,
    mitreTechniqueId: 'T1071',
    mitreTactic: 'Command and Control',
    tags: ['ioc', 'threat_intelligence', 'correlation'],
    author: 'EXPLAIN-SEC Detection Engineering',
    createdAt: '2024-11-01T00:00:00Z',
    updatedAt: '2024-11-01T00:00:00Z',
  },

  // ─── 5. Persistence via Registry Modification ──────────────────────────────
  {
    id: 'DET-PER-001',
    name: 'Unauthorized Registry Persistence Modification',
    description: 'Detects modifications to Windows Run keys, startup folders, or scheduled task persistence mechanisms by untrusted processes.',
    enabled: true,
    severity: 'HIGH',
    category: 'ENDPOINT',
    eventTypes: ['REGISTRY_MOD', 'PERSISTENCE_REGISTRY_MOD', 'REGISTRY_MODIFIED'],
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'ENDPOINT' },
      { field: 'message', operator: 'CONTAINS', value: 'Run key' },
    ],
    timeWindowMs: 900000,
    threshold: 1,
    mitreTechniqueId: 'T1547.001',
    mitreTactic: 'Persistence',
    tags: ['persistence', 'registry', 'endpoint'],
    author: 'EXPLAIN-SEC Detection Engineering',
    createdAt: '2024-11-01T00:00:00Z',
    updatedAt: '2024-11-01T00:00:00Z',
  },

  // ─── 6. Sensitive File Exfiltration Staging ─────────────────────────────────
  {
    id: 'DET-EXF-001',
    name: 'Sensitive File Collection & Exfiltration Staging',
    description: 'Detects password-protected archive utilities or mass compression of confidential corporate documents in temporary directories.',
    enabled: true,
    severity: 'HIGH',
    category: 'FILE',
    eventTypes: ['FILE_CREATE', 'SENSITIVE_FILE_EXFIL_STAGE'],
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'FILE' },
      { field: 'severity', operator: 'IN_LIST', value: ['HIGH', 'CRITICAL'] },
    ],
    timeWindowMs: 900000,
    threshold: 1,
    mitreTechniqueId: 'T1560.001',
    mitreTactic: 'Collection',
    tags: ['exfiltration', 'archive', 'staging', 'dlp'],
    author: 'EXPLAIN-SEC Detection Engineering',
    createdAt: '2024-11-01T00:00:00Z',
    updatedAt: '2024-11-01T00:00:00Z',
  },

  // ─── 7. Security Gateway / Phishing Delivery ────────────────────────────────
  {
    id: 'DET-GW-001',
    name: 'High-Risk Email Gateway Attachment Delivery',
    description: 'Fires when email gateway or perimeter security controls detect weaponized attachment delivery to enterprise user mailboxes.',
    enabled: true,
    severity: 'HIGH',
    category: 'SECURITY_CONTROL',
    eventTypes: ['EMAIL_ATTACHMENT_DELIVERY'],
    conditions: [
      { field: 'eventType', operator: 'EQUALS', value: 'EMAIL_ATTACHMENT_DELIVERY' },
      { field: 'severity', operator: 'IN_LIST', value: ['HIGH', 'CRITICAL'] },
    ],
    timeWindowMs: 900000,
    threshold: 1,
    mitreTechniqueId: 'T1566.001',
    mitreTactic: 'Initial Access',
    tags: ['phishing', 'email', 'initial_access'],
    author: 'EXPLAIN-SEC Detection Engineering',
    createdAt: '2024-11-01T00:00:00Z',
    updatedAt: '2024-11-01T00:00:00Z',
  },
];

export const DETECTION_RULES = SEED_DETECTION_RULES;

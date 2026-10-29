/**
 * Deterministic offline seed data for EXPLAIN-SEC SPATIAL.
 *
 * This file is the single authoritative source of local demo state.
 * All IDs are static so cross-references remain consistent.
 *
 * Scenario: "Operation BlackTide" — a realistic ransomware-as-a-service
 * attack against a financial services firm, modelled on ALPHV/BlackCat TTPs.
 */

import type { Asset } from '../models/entity';
import type { SecurityUser } from '../models/entity';
import type { IOC } from '../models/entity';
import type { Incident, TimelineEvent, IncidentEvidence, CorrelationChainItem } from '../models/incident';
import type { AttackGraph } from '../models/attack-graph';
import type { SystemRadarData } from '../models/spatial-structures';
import type { IocGraphData } from '../models/spatial-structures';
import type { MitreTechniqueCoverage } from '../models/mitre';
import type { AuditRecord } from '../models/audit';
import type { ResponseAction } from '../models/response';
import type { ScenarioDefinition } from '../models/spatial-structures';

// ─── Assets ──────────────────────────────────────────────────────────────────

export const SEED_ASSETS: Asset[] = [
  {
    id: 'asset-001',
    name: 'FINWS-027',
    hostname: 'FINWS-027.corp.blacktide.local',
    type: 'ENDPOINT',
    ipAddress: '10.40.12.27',
    macAddress: '00:1A:2B:3C:4D:5E',
    os: 'Windows 11 22H2',
    criticality: 'HIGH',
    status: 'COMPROMISED',
    owner: 'user-001',
    department: 'Finance',
    networkSegment: 'CORP_LAN',
    blastRadiusLevel: 'DIRECT',
    compromisedAt: '2024-11-14T02:17:04Z',
  },
  {
    id: 'asset-002',
    name: 'FINDC-001',
    hostname: 'FINDC-001.corp.blacktide.local',
    type: 'DOMAIN_CONTROLLER',
    ipAddress: '10.40.1.10',
    macAddress: '00:1A:2B:3C:4D:6A',
    os: 'Windows Server 2022',
    criticality: 'CRITICAL',
    status: 'SUSPICIOUS',
    department: 'IT Infrastructure',
    networkSegment: 'CORE_INFRA',
    blastRadiusLevel: 'POTENTIAL',
  },
  {
    id: 'asset-003',
    name: 'DB-PAYMENTS-01',
    hostname: 'DB-PAYMENTS-01.corp.blacktide.local',
    type: 'DATABASE',
    ipAddress: '10.40.20.5',
    macAddress: '00:1A:2B:3C:4D:7B',
    os: 'RHEL 9.2',
    criticality: 'CRITICAL',
    status: 'SUSPICIOUS',
    department: 'Payments',
    networkSegment: 'DATA_TIER',
    blastRadiusLevel: 'POTENTIAL',
  },
  {
    id: 'asset-004',
    name: 'BACKUP-NAS-01',
    hostname: 'BACKUP-NAS-01.corp.blacktide.local',
    type: 'SERVER',
    ipAddress: '10.40.30.100',
    macAddress: '00:1A:2B:3C:4D:8C',
    os: 'FreeNAS 13',
    criticality: 'CRITICAL',
    status: 'COMPROMISED',
    department: 'IT Infrastructure',
    networkSegment: 'BACKUP_ZONE',
    blastRadiusLevel: 'DIRECT',
    compromisedAt: '2024-11-14T03:42:00Z',
  },
  {
    id: 'asset-005',
    name: 'EDGE-FW-01',
    hostname: 'EDGE-FW-01.corp.blacktide.local',
    type: 'FIREWALL',
    ipAddress: '203.0.113.1',
    macAddress: '00:1A:2B:3C:4D:9D',
    os: 'FortiOS 7.4',
    criticality: 'CRITICAL',
    status: 'HEALTHY',
    department: 'IT Infrastructure',
    networkSegment: 'PERIMETER',
    blastRadiusLevel: 'AT_RISK',
  },
  {
    id: 'asset-006',
    name: 'SECOPS-JUMP-01',
    hostname: 'SECOPS-JUMP-01.corp.blacktide.local',
    type: 'SERVER',
    ipAddress: '10.40.5.2',
    macAddress: '00:1A:2B:3C:5A:01',
    os: 'Ubuntu 22.04 LTS',
    criticality: 'HIGH',
    status: 'HEALTHY',
    department: 'Security Operations',
    networkSegment: 'SECOPS_ZONE',
    blastRadiusLevel: 'AT_RISK',
  },
];

// ─── Users ────────────────────────────────────────────────────────────────────

export const SEED_USERS: SecurityUser[] = [
  {
    id: 'user-001',
    username: 'r.morrison',
    email: 'r.morrison@blacktide.local',
    displayName: 'Rachel Morrison',
    roleInOrg: 'Senior Financial Analyst',
    department: 'Finance',
    status: 'COMPROMISED',
    riskScore: 92,
    lastActive: '2024-11-14T02:10:00Z',
    assignedAssets: ['asset-001'],
  },
  {
    id: 'user-002',
    username: 'p.chen',
    email: 'p.chen@blacktide.local',
    displayName: 'Patrick Chen',
    roleInOrg: 'IT Systems Administrator',
    department: 'IT Infrastructure',
    status: 'FLAGGED',
    riskScore: 55,
    lastActive: '2024-11-14T01:55:00Z',
    assignedAssets: ['asset-002', 'asset-004'],
  },
  {
    id: 'user-003',
    username: 'a.rodriguez',
    email: 'a.rodriguez@blacktide.local',
    displayName: 'Ana Rodriguez',
    roleInOrg: 'Payments Engineer',
    department: 'Payments',
    status: 'ACTIVE',
    riskScore: 12,
    lastActive: '2024-11-13T17:30:00Z',
    assignedAssets: ['asset-003'],
  },
];

// ─── IOCs ─────────────────────────────────────────────────────────────────────

export const SEED_IOCS: IOC[] = [
  {
    id: 'ioc-001',
    type: 'HASH_SHA256',
    value: 'b94f3e2a1c8d5f0e7a9b2c4d6e8f1a3b5c7d9e0f2a4b6c8d0e2f4a6b8c0d2e4',
    threatType: 'Ransomware dropper (BlackCat/ALPHV)',
    confidence: 0.97,
    firstSeen: '2024-11-14T02:18:00Z',
    lastSeen: '2024-11-14T02:18:00Z',
    reputationScore: 99,
    isBlocked: false,
    relatedIncidents: ['incident-001'],
    relatedAssets: ['asset-001'],
  },
  {
    id: 'ioc-002',
    type: 'IP',
    value: '185.220.101.47',
    threatType: 'Tor exit node / C2 infrastructure',
    confidence: 0.88,
    firstSeen: '2024-11-14T02:20:00Z',
    lastSeen: '2024-11-14T04:05:00Z',
    reputationScore: 95,
    isBlocked: false,
    relatedIncidents: ['incident-001'],
    relatedAssets: ['asset-001', 'asset-004'],
  },
  {
    id: 'ioc-003',
    type: 'DOMAIN',
    value: 'update-sync.blacktide-exfil.net',
    threatType: 'Attacker-controlled exfiltration endpoint',
    confidence: 0.91,
    firstSeen: '2024-11-14T03:55:00Z',
    lastSeen: '2024-11-14T04:10:00Z',
    reputationScore: 97,
    isBlocked: false,
    relatedIncidents: ['incident-001'],
    relatedAssets: ['asset-001'],
  },
  {
    id: 'ioc-004',
    type: 'FILE_PATH',
    value: 'C:\\Users\\r.morrison\\AppData\\Local\\Temp\\svchost32.exe',
    threatType: 'Ransomware payload staging location',
    confidence: 0.95,
    firstSeen: '2024-11-14T02:17:04Z',
    lastSeen: '2024-11-14T02:22:00Z',
    reputationScore: 99,
    isBlocked: false,
    relatedIncidents: ['incident-001'],
    relatedAssets: ['asset-001'],
  },
  {
    id: 'ioc-005',
    type: 'REGISTRY_KEY',
    value: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run\\SysUpdate32',
    threatType: 'Persistence mechanism (Run key)',
    confidence: 0.93,
    firstSeen: '2024-11-14T02:19:00Z',
    lastSeen: '2024-11-14T02:19:00Z',
    reputationScore: 96,
    isBlocked: false,
    relatedIncidents: ['incident-001'],
    relatedAssets: ['asset-001'],
  },
];

// ─── Timeline Events ──────────────────────────────────────────────────────────

export const SEED_TIMELINE: TimelineEvent[] = [
  {
    id: 'evt-001',
    timestamp: '2024-11-13T22:04:00Z',
    title: 'Malicious phishing email delivered',
    stage: 'INITIAL_ACCESS',
    severity: 'HIGH',
    description: 'Spearphishing email with weaponized PDF (CVE-2024-21338) delivered to r.morrison@blacktide.local from spoofed accounting-reports@blacktide-finance.co.',
    entityId: 'user-001',
    entityType: 'USER',
    techniqueId: 'T1566.001',
  },
  {
    id: 'evt-002',
    timestamp: '2024-11-14T02:17:04Z',
    title: 'Ransomware dropper executed on FINWS-027',
    stage: 'EXECUTION',
    severity: 'CRITICAL',
    description: 'Process svchost32.exe created under r.morrison user context. SHA256 matches BlackCat/ALPHV dropper. Outbound beacon to 185.220.101.47:443 within 60 seconds.',
    entityId: 'asset-001',
    entityType: 'ASSET',
    techniqueId: 'T1204.002',
    metadata: { pid: 8472, parentProcess: 'AcroRd32.exe' },
  },
  {
    id: 'evt-003',
    timestamp: '2024-11-14T02:19:00Z',
    title: 'Registry run-key persistence established',
    stage: 'PERSISTENCE',
    severity: 'HIGH',
    description: 'HKCU Run key SysUpdate32 pointing to dropper staging path created to survive reboot.',
    entityId: 'asset-001',
    entityType: 'ASSET',
    techniqueId: 'T1547.001',
  },
  {
    id: 'evt-004',
    timestamp: '2024-11-14T02:24:00Z',
    title: 'LSASS memory access — credential dump',
    stage: 'CREDENTIAL_ACCESS',
    severity: 'CRITICAL',
    description: 'Mimikatz-like access pattern detected against lsass.exe. Handles opened with PROCESS_VM_READ | PROCESS_QUERY_INFORMATION. Credentials for p.chen likely exfiltrated.',
    entityId: 'asset-001',
    entityType: 'ASSET',
    techniqueId: 'T1003.001',
  },
  {
    id: 'evt-005',
    timestamp: '2024-11-14T02:41:00Z',
    title: 'Lateral movement to FINDC-001 via stolen credentials',
    stage: 'LATERAL_MOVEMENT',
    severity: 'CRITICAL',
    description: 'Authenticated SMB login to FINDC-001 (Domain Controller) using p.chen credentials from FINWS-027. Domain enumeration commands observed immediately after login.',
    entityId: 'asset-002',
    entityType: 'ASSET',
    techniqueId: 'T1078.002',
  },
  {
    id: 'evt-006',
    timestamp: '2024-11-14T02:55:00Z',
    title: 'Active Directory recon — DCSync preparation',
    stage: 'DISCOVERY',
    severity: 'HIGH',
    description: 'LDAP queries enumerating domain admins, privileged groups, and trust relationships originating from p.chen session on FINDC-001.',
    entityId: 'asset-002',
    entityType: 'ASSET',
    techniqueId: 'T1018',
  },
  {
    id: 'evt-007',
    timestamp: '2024-11-14T03:10:00Z',
    title: 'Privilege escalation — DCSync rights granted',
    stage: 'PRIVILEGE_ESCALATION',
    severity: 'CRITICAL',
    description: 'Replication privileges granted to attacker-controlled account using DRSYNC attack path. Enables extraction of all AD credentials including krbtgt hash.',
    entityId: 'asset-002',
    entityType: 'ASSET',
    techniqueId: 'T1098',
  },
  {
    id: 'evt-008',
    timestamp: '2024-11-14T03:42:00Z',
    title: 'Backup NAS accessed — encryption begins',
    stage: 'IMPACT',
    severity: 'CRITICAL',
    description: 'BACKUP-NAS-01 shares mounted over SMB using domain admin credentials. Ransomware payload deployed. Encryption of backup data confirmed. VSS shadow copies deleted.',
    entityId: 'asset-004',
    entityType: 'ASSET',
    techniqueId: 'T1490',
    metadata: { encryptedFiles: 14820, extensionAdded: '.blackcat' },
  },
  {
    id: 'evt-009',
    timestamp: '2024-11-14T03:55:00Z',
    title: 'Data exfiltration to external endpoint',
    stage: 'EXFILTRATION',
    severity: 'CRITICAL',
    description: '47 GB of financial records exfiltrated to update-sync.blacktide-exfil.net via HTTPS. Double-extortion tactic consistent with ALPHV affiliate operations.',
    entityId: 'asset-001',
    entityType: 'ASSET',
    techniqueId: 'T1048.003',
    metadata: { bytesExfiltrated: 50465865728, destDomain: 'update-sync.blacktide-exfil.net' },
  },
  {
    id: 'evt-010',
    timestamp: '2024-11-14T04:12:00Z',
    title: 'Ransom note dropped across all encrypted volumes',
    stage: 'IMPACT',
    severity: 'CRITICAL',
    description: 'RECOVER_YOUR_FILES.txt dropped in all encrypted directories. Tor .onion payment portal URL included. 72-hour deadline before public data leak.',
    entityId: 'asset-004',
    entityType: 'ASSET',
    techniqueId: 'T1491',
  },
];

// ─── Evidence ─────────────────────────────────────────────────────────────────

export const SEED_EVIDENCE: IncidentEvidence[] = [
  {
    id: 'ev-001',
    incidentId: 'incident-001',
    title: 'Ransomware dropper binary',
    type: 'FILE_SAMPLE',
    source: 'FINWS-027 — Endpoint EDR',
    collectedAt: '2024-11-14T02:30:00Z',
    hash: 'b94f3e2a1c8d5f0e7a9b2c4d6e8f1a3b5c7d9e0f2a4b6c8d0e2f4a6b8c0d2e4',
    content: 'Binary recovered from C:\\Users\\r.morrison\\AppData\\Local\\Temp\\svchost32.exe. Packed with UPX. Matches ALPHV/BlackCat stage-1 dropper signature cluster.',
    collectedBy: 'analyst2',
    isVerified: true,
  },
  {
    id: 'ev-002',
    incidentId: 'incident-001',
    title: 'LSASS memory dump',
    type: 'MEMORY_DUMP',
    source: 'FINWS-027 — Live Response',
    collectedAt: '2024-11-14T02:35:00Z',
    content: 'LSASS.exe process memory captured via live response agent. Analysis confirms Mimikatz sekurlsa::logonpasswords pattern. p.chen NTLM hash recovered.',
    collectedBy: 'analyst2',
    isVerified: true,
  },
  {
    id: 'ev-003',
    incidentId: 'incident-001',
    title: 'Network capture — C2 beacon',
    type: 'NETWORK_PCAP',
    source: 'EDGE-FW-01 — NetFlow',
    collectedAt: '2024-11-14T02:22:00Z',
    content: 'TLS 1.3 sessions from FINWS-027 to 185.220.101.47:443. JA3 fingerprint matches BlackCat C2 beacon profile. Beaconing interval: 47 seconds ± jitter.',
    collectedBy: 'analyst1',
    isVerified: true,
  },
  {
    id: 'ev-004',
    incidentId: 'incident-001',
    title: 'Ransom note sample',
    type: 'FILE_SAMPLE',
    source: 'BACKUP-NAS-01 — IR team',
    collectedAt: '2024-11-14T04:30:00Z',
    content: 'RECOVER_YOUR_FILES.txt. Contents confirm ALPHV affiliate. Payment address: hxxp://alphvmmm27o3abo3r2mlmjjiijsem4ereqazfmbdoz2jd7li7ql7pyd[.]onion. Deadline: 72h from drop timestamp.',
    collectedBy: 'responder',
    isVerified: false,
  },
];

// ─── Correlation Chain ────────────────────────────────────────────────────────

export const SEED_CORRELATION_CHAIN: CorrelationChainItem[] = [
  {
    id: 'corr-001',
    alertId: 'alert-001',
    title: 'Ransomware dropper execution detected',
    ruleName: 'RANSOM_DROPPER_BEHAVIORAL',
    timestamp: '2024-11-14T02:17:04Z',
    confidence: 0.97,
    evidenceSummary: 'SHA256 match on known BlackCat dropper; immediate C2 beacon.',
  },
  {
    id: 'corr-002',
    alertId: 'alert-002',
    title: 'LSASS credential dump pattern',
    ruleName: 'LSASS_ACCESS_PATTERN',
    timestamp: '2024-11-14T02:24:00Z',
    confidence: 0.92,
    evidenceSummary: 'PROCESS_VM_READ handle opened to lsass.exe by non-system process.',
  },
  {
    id: 'corr-003',
    alertId: 'alert-003',
    title: 'Lateral movement — domain admin session',
    ruleName: 'LATERAL_MOVEMENT_ADMIN_SMB',
    timestamp: '2024-11-14T02:41:00Z',
    confidence: 0.89,
    evidenceSummary: 'SMB auth to DC from compromised endpoint using non-resident credentials.',
  },
  {
    id: 'corr-004',
    alertId: 'alert-004',
    title: 'Large-volume exfiltration over HTTPS',
    ruleName: 'EXFIL_VOLUME_THRESHOLD_HTTPS',
    timestamp: '2024-11-14T03:55:00Z',
    confidence: 0.94,
    evidenceSummary: '47 GB outbound to threat-intel listed domain over 10 minutes.',
  },
];

// ─── Primary Incident ─────────────────────────────────────────────────────────

export const SEED_INCIDENT: Incident = {
  id: 'incident-001',
  title: 'Operation BlackTide — ALPHV Ransomware Compromise',
  severity: 'CRITICAL',
  priority: 'P1',
  riskScore: 96.4,
  status: 'INVESTIGATING',
  confidence: 0.94,
  source: 'CORRELATION_ENGINE',
  createdAt: '2024-11-14T02:17:04Z',
  updatedAt: '2024-11-14T04:35:00Z',
  firstSeenAt: '2024-11-13T22:04:00Z',
  lastSeenAt: '2024-11-14T04:12:00Z',
  assignedTo: 'user-analyst2',
  assignedRole: 'L2_ANALYST',
  affectedAssets: ['asset-001', 'asset-002', 'asset-004'],
  affectedUsers: ['user-001', 'user-002'],
  iocs: ['ioc-001', 'ioc-002', 'ioc-003', 'ioc-004', 'ioc-005'],
  mitreTechniques: ['T1566.001', 'T1204.002', 'T1547.001', 'T1003.001', 'T1078.002', 'T1018', 'T1098', 'T1490', 'T1048.003', 'T1491'],
  eventIds: [
    'evt-raw-001',
    'evt-raw-002',
    'evt-raw-003',
    'evt-raw-004',
    'evt-raw-005',
    'evt-raw-006',
    'evt-raw-007',
    'evt-raw-008',
    'evt-raw-009',
    'evt-raw-010',
    'evt-raw-011',
    'evt-raw-012',
    'evt-raw-014',
    'evt-raw-015',
    'evt-raw-016',
  ],
  alertIds: [],
  correlationScore: 96,
  correlationReasons: [
    'Same primary asset FINWS-027 (asset-001) linked across execution and exfiltration stages',
    'Shared threat indicators (svchost32.exe dropper, C2 IP 185.220.101.47, exfil domain update-sync.blacktide-exfil.net)',
    'Sequential MITRE kill-chain progression: Spearphishing -> Execution -> Credential Access -> Lateral Movement -> Exfiltration -> Impact',
    'Compromised credential chain: r.morrison context to p.chen privilege escalation on Domain Controller',
  ],
  tags: ['ransomware', 'alphv', 'double-extortion', 'blacktide'],
  timelineEvents: SEED_TIMELINE,
  correlationChain: SEED_CORRELATION_CHAIN,
  evidence: SEED_EVIDENCE,
  summary: 'A financially-motivated threat actor (ALPHV affiliate) gained initial access via spearphishing, executed a ransomware dropper, dumped credentials from LSASS, moved laterally to the Domain Controller, encrypted backups, and exfiltrated 47 GB of financial data. Double-extortion ransom demand issued with 72-hour deadline.',
  attackPathId: 'attack-graph-001',
};

// Secondary incident (lower severity, simpler)
export const SEED_INCIDENT_2: Incident = {
  id: 'incident-002',
  title: 'Brute-force Attack on VPN Gateway',
  severity: 'MEDIUM',
  priority: 'P3',
  riskScore: 38.2,
  status: 'TRIAGED',
  confidence: 0.78,
  source: 'DETECTION_ENGINE',
  createdAt: '2024-11-14T01:00:00Z',
  updatedAt: '2024-11-14T01:45:00Z',
  firstSeenAt: '2024-11-14T01:00:00Z',
  lastSeenAt: '2024-11-14T01:08:00Z',
  affectedAssets: ['asset-005'],
  affectedUsers: [],
  iocs: [],
  mitreTechniques: ['T1110.001'],
  eventIds: ['evt-raw-013'],
  alertIds: [],
  correlationScore: 75,
  correlationReasons: [
    'Repeated authentication failures on perimeter firewall EDGE-FW-01 (asset-005)',
    'Single external source IP: 83.55.7.22',
  ],
  tags: ['perimeter', 'brute-force', 'vpn'],
  timelineEvents: [
    {
      id: 'evt-101',
      timestamp: '2024-11-14T01:00:00Z',
      title: 'VPN brute-force threshold exceeded',
      stage: 'INITIAL_ACCESS',
      severity: 'MEDIUM',
      description: '2,400 failed authentication attempts from 83.55.7.22 against VPN gateway over 8 minutes. Geographic anomaly: Source is Kyiv, UA; no business nexus.',
      entityId: 'asset-005',
      entityType: 'ASSET',
      techniqueId: 'T1110.001',
    },
  ],
  correlationChain: [],
  evidence: [],
  summary: 'Automated brute-force credential-stuffing attack against FortiVPN perimeter. No successful authentication. Access denied by rate-limiting policy.',
};

// ─── Attack Graph ─────────────────────────────────────────────────────────────

export const SEED_ATTACK_GRAPH: AttackGraph = {
  incidentId: 'incident-001',
  rootNodeId: 'node-incident',
  attackPathNodeIds: ['node-incident', 'node-exec', 'node-persist', 'node-cred', 'node-lateral', 'node-backup', 'node-exfil'],
  nodes: [
    { id: 'node-incident',   label: 'BlackTide Ransomware',    type: 'INCIDENT',  severity: 'CRITICAL', isRoot: true,         x: 0,     y: 0,     z: 0   },
    { id: 'node-user001',    label: 'r.morrison',              type: 'USER',      severity: 'HIGH',     isCompromised: true,  x: -200,  y: 100,   z: 0   },
    { id: 'node-phish',      label: 'Phishing Email',          type: 'EVENT',     severity: 'HIGH',                           x: -300,  y: 200,   z: 0   },
    { id: 'node-exec',       label: 'svchost32.exe',           type: 'PROCESS',   severity: 'CRITICAL',                       x: -150,  y: 200,   z: 0   },
    { id: 'node-asset001',   label: 'FINWS-027',               type: 'ASSET',     severity: 'CRITICAL', isCompromised: true,  x: -150,  y: 300,   z: 0   },
    { id: 'node-persist',    label: 'Run Key Persistence',     type: 'TECHNIQUE', severity: 'HIGH',                           x: -50,   y: 300,   z: 0   },
    { id: 'node-cred',       label: 'LSASS Credential Dump',  type: 'TECHNIQUE', severity: 'CRITICAL',                       x: 50,    y: 200,   z: 0   },
    { id: 'node-lateral',    label: 'FINDC-001',               type: 'ASSET',     severity: 'CRITICAL', isCompromised: true,  x: 150,   y: 100,   z: 0   },
    { id: 'node-backup',     label: 'BACKUP-NAS-01',           type: 'ASSET',     severity: 'CRITICAL', isCompromised: true,  x: 200,   y: 200,   z: 0   },
    { id: 'node-exfil',      label: 'Exfiltration (47 GB)',    type: 'ACTION',    severity: 'CRITICAL',                       x: 100,   y: 300,   z: 0   },
    { id: 'node-ioc-ip',     label: '185.220.101.47',          type: 'IOC',       severity: 'HIGH',                           x: 300,   y: 200,   z: 0   },
    { id: 'node-ioc-domain', label: 'blacktide-exfil.net',     type: 'IOC',       severity: 'CRITICAL',                       x: 100,   y: 400,   z: 0   },
  ],
  edges: [
    { id: 'e-01', source: 'node-phish',    target: 'node-user001',   relation: 'TARGETS',         isCriticalPath: true,  stepOrder: 1 },
    { id: 'e-02', source: 'node-user001',  target: 'node-exec',      relation: 'EXECUTED_ON',     isCriticalPath: true,  stepOrder: 2 },
    { id: 'e-03', source: 'node-exec',     target: 'node-asset001',  relation: 'AFFECTS',         isCriticalPath: true,  stepOrder: 2 },
    { id: 'e-04', source: 'node-exec',     target: 'node-persist',   relation: 'USES',            isCriticalPath: false, stepOrder: 3 },
    { id: 'e-05', source: 'node-exec',     target: 'node-cred',      relation: 'USES',            isCriticalPath: true,  stepOrder: 4 },
    { id: 'e-06', source: 'node-cred',     target: 'node-lateral',   relation: 'PRECEDES',        isCriticalPath: true,  stepOrder: 5 },
    { id: 'e-07', source: 'node-lateral',  target: 'node-backup',    relation: 'AFFECTS',         isCriticalPath: true,  stepOrder: 6 },
    { id: 'e-08', source: 'node-backup',   target: 'node-exfil',     relation: 'PRECEDES',        isCriticalPath: true,  stepOrder: 7 },
    { id: 'e-09', source: 'node-asset001', target: 'node-ioc-ip',    relation: 'COMMUNICATED_WITH' },
    { id: 'e-10', source: 'node-exfil',    target: 'node-ioc-domain', relation: 'ASSOCIATED_WITH' },
    { id: 'e-11', source: 'node-incident', target: 'node-exec',      relation: 'GENERATED_BY',    isCriticalPath: true  },
  ],
};

// ─── System Radar ─────────────────────────────────────────────────────────────

export const SEED_SYSTEM_RADAR: SystemRadarData = {
  incidentId: 'incident-001',
  focalAssetId: 'asset-001',
  totalAssetsAtRisk: 5,
  compromisedCount: 2,
  isolatedCount: 0,
  assets: [
    { asset: SEED_ASSETS[0], blastRadiusLevel: 'DIRECT',    distance: 0.1, angle: 0,                  hopCount: 0 },
    { asset: SEED_ASSETS[3], blastRadiusLevel: 'DIRECT',    distance: 0.2, angle: Math.PI * 0.75,     hopCount: 1 },
    { asset: SEED_ASSETS[1], blastRadiusLevel: 'POTENTIAL', distance: 0.5, angle: Math.PI * 0.3,      hopCount: 1 },
    { asset: SEED_ASSETS[2], blastRadiusLevel: 'POTENTIAL', distance: 0.6, angle: Math.PI * 1.4,      hopCount: 2 },
    { asset: SEED_ASSETS[4], blastRadiusLevel: 'AT_RISK',   distance: 0.85, angle: Math.PI * 1.8,    hopCount: 3 },
    { asset: SEED_ASSETS[5], blastRadiusLevel: 'AT_RISK',   distance: 0.9, angle: Math.PI * 0.6,     hopCount: 3 },
  ],
};

// ─── IOC Graph ────────────────────────────────────────────────────────────────

export const SEED_IOC_GRAPH: IocGraphData = {
  incidentId: 'incident-001',
  iocs: SEED_IOCS,
  links: [
    { sourceIocId: 'ioc-001', targetEntityId: 'asset-001',    targetType: 'ASSET',    relation: 'EXECUTED_ON' },
    { sourceIocId: 'ioc-002', targetEntityId: 'asset-001',    targetType: 'ASSET',    relation: 'COMMUNICATED_WITH' },
    { sourceIocId: 'ioc-002', targetEntityId: 'asset-004',    targetType: 'ASSET',    relation: 'COMMUNICATED_WITH' },
    { sourceIocId: 'ioc-003', targetEntityId: 'incident-001', targetType: 'INCIDENT', relation: 'ASSOCIATED_WITH' },
    { sourceIocId: 'ioc-004', targetEntityId: 'asset-001',    targetType: 'ASSET',    relation: 'OBSERVED_ON' },
    { sourceIocId: 'ioc-005', targetEntityId: 'asset-001',    targetType: 'ASSET',    relation: 'OBSERVED_ON' },
  ],
};

// ─── MITRE Coverage ───────────────────────────────────────────────────────────

export const SEED_MITRE_COVERAGE: MitreTechniqueCoverage[] = [
  {
    technique: { id: 'T1566.001', tacticId: 'TA0001', tacticName: 'Initial Access', name: 'Spearphishing Attachment', description: 'Emails with malicious attachments to gain execution.', detection: 'Email gateway filtering, attachment sandboxing.', platforms: ['Windows', 'macOS', 'Linux'] },
    status: 'ACTIVE', detectedCount: 1, associatedIncidentIds: ['incident-001'], firstObserved: '2024-11-13T22:04:00Z', lastObserved: '2024-11-13T22:04:00Z',
  },
  {
    technique: { id: 'T1204.002', tacticId: 'TA0002', tacticName: 'Execution', name: 'Malicious File', description: 'User executes malicious file delivered via phishing.', detection: 'Process monitoring, behavioral analytics.', platforms: ['Windows', 'macOS', 'Linux'] },
    status: 'ACTIVE', detectedCount: 1, associatedIncidentIds: ['incident-001'], firstObserved: '2024-11-14T02:17:04Z', lastObserved: '2024-11-14T02:17:04Z',
  },
  {
    technique: { id: 'T1547.001', tacticId: 'TA0003', tacticName: 'Persistence', name: 'Registry Run Keys', description: 'Adversaries achieve persistence via Run key.', detection: 'Registry monitoring, autoruns analysis.', platforms: ['Windows'] },
    status: 'DETECTED', detectedCount: 1, associatedIncidentIds: ['incident-001'], firstObserved: '2024-11-14T02:19:00Z', lastObserved: '2024-11-14T02:19:00Z',
  },
  {
    technique: { id: 'T1003.001', tacticId: 'TA0006', tacticName: 'Credential Access', name: 'LSASS Memory', description: 'Extract credentials from LSASS memory.', detection: 'LSASS handle monitoring, Credential Guard.', platforms: ['Windows'] },
    status: 'ACTIVE', detectedCount: 1, associatedIncidentIds: ['incident-001'], firstObserved: '2024-11-14T02:24:00Z', lastObserved: '2024-11-14T02:24:00Z',
  },
  {
    technique: { id: 'T1078.002', tacticId: 'TA0008', tacticName: 'Lateral Movement', name: 'Valid Accounts: Domain Accounts', description: 'Use stolen domain credentials for lateral movement.', detection: 'Login anomaly detection, impossible travel.', platforms: ['Windows', 'Azure AD'] },
    status: 'ACTIVE', detectedCount: 1, associatedIncidentIds: ['incident-001'], firstObserved: '2024-11-14T02:41:00Z', lastObserved: '2024-11-14T02:41:00Z',
  },
  {
    technique: { id: 'T1490', tacticId: 'TA0040', tacticName: 'Impact', name: 'Inhibit System Recovery', description: 'Delete shadow copies and backups to inhibit recovery.', detection: 'VSS monitoring, backup process monitoring.', platforms: ['Windows', 'Linux', 'macOS'] },
    status: 'ACTIVE', detectedCount: 1, associatedIncidentIds: ['incident-001'], firstObserved: '2024-11-14T03:42:00Z', lastObserved: '2024-11-14T03:42:00Z',
  },
  {
    technique: { id: 'T1048.003', tacticId: 'TA0010', tacticName: 'Exfiltration', name: 'Exfiltration Over Unencrypted Non-C2 Protocol', description: 'Data exfiltrated over HTTPS to attacker-controlled domain.', detection: 'DLP, NetFlow analysis, DNS monitoring.', platforms: ['Windows', 'Linux', 'macOS'] },
    status: 'ACTIVE', detectedCount: 1, associatedIncidentIds: ['incident-001'], firstObserved: '2024-11-14T03:55:00Z', lastObserved: '2024-11-14T04:10:00Z',
  },
  {
    technique: { id: 'T1110.001', tacticId: 'TA0006', tacticName: 'Credential Access', name: 'Password Guessing', description: 'Systematically guess credentials against authentication services.', detection: 'Rate limiting, lockout policies, anomaly detection.', platforms: ['Windows', 'Linux', 'macOS', 'Network'] },
    status: 'MITIGATED', detectedCount: 1, associatedIncidentIds: ['incident-002'], firstObserved: '2024-11-14T01:00:00Z', lastObserved: '2024-11-14T01:08:00Z',
  },
];

// ─── Audit Records ────────────────────────────────────────────────────────────

export const SEED_AUDIT_RECORDS: AuditRecord[] = [
  {
    id: 'audit-001',
    timestamp: '2024-11-14T04:20:00Z',
    actor: 'analyst2',
    actorRole: 'L2_ANALYST',
    action: 'EVIDENCE_COLLECTED',
    target: 'incident-001',
    resultingState: 'Evidence ev-001 added',
    authorization: 'INCIDENT_INVESTIGATE',
    outcome: 'SUCCESS',
    details: { evidenceId: 'ev-001', evidenceType: 'FILE_SAMPLE' },
  },
  {
    id: 'audit-002',
    timestamp: '2024-11-14T04:25:00Z',
    actor: 'analyst2',
    actorRole: 'L2_ANALYST',
    action: 'CONTAINMENT_REQUEST',
    target: 'asset-001',
    previousState: 'COMPROMISED',
    resultingState: 'Containment action QUARANTINE_HOST pending approval',
    authorization: 'CONTAINMENT_REQUEST',
    outcome: 'SUCCESS',
    details: { actionId: 'action-001', actionType: 'QUARANTINE_HOST' },
  },
  {
    id: 'audit-003',
    timestamp: '2024-11-14T04:28:00Z',
    actor: 'manager',
    actorRole: 'SOC_MANAGER',
    action: 'CONTAINMENT_APPROVED',
    target: 'action-001',
    previousState: 'AWAITING_APPROVAL',
    resultingState: 'APPROVED',
    authorization: 'CONTAINMENT_APPROVE',
    outcome: 'SUCCESS',
    details: { approvedBy: 'manager', incidentId: 'incident-001' },
  },
];

// ─── Response Actions ─────────────────────────────────────────────────────────

export const SEED_RESPONSE_ACTIONS: ResponseAction[] = [
  {
    id: 'action-001',
    type: 'QUARANTINE_HOST',
    targetId: 'asset-001',
    targetType: 'ASSET',
    targetLabel: 'FINWS-027',
    incidentId: 'incident-001',
    status: 'APPROVED',
    riskImpact: 'MEDIUM',
    reversibility: 'FULL',
    requestedBy: 'analyst2',
    requestedAt: '2024-11-14T04:25:00Z',
    approvedBy: 'manager',
    approvedAt: '2024-11-14T04:28:00Z',
    resultMessage: 'Network isolation policy applied via EDR. Host removed from all VLANs except forensic segment.',
  },
  {
    id: 'action-002',
    type: 'BLOCK_IOC',
    targetId: 'ioc-002',
    targetType: 'IOC',
    targetLabel: '185.220.101.47',
    incidentId: 'incident-001',
    status: 'EXECUTED',
    riskImpact: 'LOW',
    reversibility: 'FULL',
    requestedBy: 'analyst1',
    requestedAt: '2024-11-14T04:10:00Z',
    approvedBy: 'analyst2',
    approvedAt: '2024-11-14T04:12:00Z',
    executedAt: '2024-11-14T04:12:30Z',
    resultMessage: 'IP blocked at perimeter firewall (EDGE-FW-01) and propagated to SIEM threat feed.',
  },
  {
    id: 'action-003',
    type: 'DISABLE_ACCOUNT',
    targetId: 'user-001',
    targetType: 'USER',
    targetLabel: 'r.morrison',
    incidentId: 'incident-001',
    status: 'PENDING',
    riskImpact: 'MEDIUM',
    reversibility: 'FULL',
    requestedBy: 'analyst2',
    requestedAt: '2024-11-14T04:35:00Z',
  },
];

// ─── Scenario Definition ──────────────────────────────────────────────────────

export const SEED_SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'scenario-blacktide',
    name: 'Operation BlackTide',
    description: 'ALPHV ransomware-as-a-service attack chain: phishing → dropper → credential dump → lateral movement → double-extortion.',
    threatType: 'Ransomware',
    initialDefcon: 2,
    estimatedDurationMs: 30 * 60 * 1000, // 30 minutes training scenario
  },
  {
    id: 'scenario-vpn-bruteforce',
    name: 'VPN Brute-Force Storm',
    description: 'Credential-stuffing attack against VPN gateway from botnet. Tests rate-limit and lockout policy responses.',
    threatType: 'Credential Attack',
    initialDefcon: 3,
    estimatedDurationMs: 10 * 60 * 1000,
  },
];

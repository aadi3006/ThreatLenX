/**
 * simulation-scenarios.ts
 *
 * Canonical defensive simulation scenarios for EXPLAIN-SEC SPATIAL Cyber Range.
 *
 * Scenarios:
 * 1. Operation BlackTide (ALPHV Ransomware Full Chain)
 * 2. Suspicious Authentication Chain & Credential Stuffing
 * 3. C2 Beacon & Malicious IOC Containment Drill
 * 4. Endpoint Dropper & Persistence Drill
 * 5. Internal Network Lateral Movement Investigation
 *
 * Rules:
 * - 100% offline, safe simulated telemetry only.
 * - Harmless descriptive strings in commandLine / payloads.
 * - Targets canonical entities (asset-001 FINWS-027, user-001 r.morrison, ioc-001, etc.).
 * - Matches canonical detection rules (DET-AUTH-001, DET-PROC-001, DET-NET-001, DET-IOC-001, DET-PER-001).
 */

import type { SimulationScenario } from '../models/simulation';

export const SEED_SIMULATION_SCENARIOS: SimulationScenario[] = [
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. OPERATION BLACKTIDE (ALPHV RANSOMWARE FULL CHAIN)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'scen-blacktide-01',
    scenarioId: 'SCEN-BLACKTIDE-01',
    version: 1,
    name: 'Operation BlackTide: ALPHV Ransomware Campaign',
    description:
      'Multi-phase defensive training scenario modeling the ALPHV/BlackTide ransomware progression: Phishing attachment delivery, suspicious dropper execution, C2 beaconing, indicator discovery, and host-level persistence.',
    objective:
      'Observe real SOC telemetry ingestion, trigger critical detection rules (DET-GW-001, DET-PROC-001, DET-NET-001, DET-IOC-001), verify automatic correlation into a high-severity incident, and validate dry-run SOAR host containment.',
    difficulty: 'ADVANCED',
    category: 'RANSOMWARE',
    status: 'READY',
    durationSeconds: 180, // 3 minutes virtual time
    entities: [
      { id: 'asset-001', type: 'ASSET', name: 'FINWS-027 (Finance Workstation)', roleInScenario: 'Patient-Zero Target' },
      { id: 'user-001', type: 'USER', name: 'r.morrison (Senior Financial Analyst)', roleInScenario: 'Compromised Identity' },
      { id: 'ioc-001', type: 'IOC', name: '185.220.101.47 (Cobalt Strike C2)', roleInScenario: 'External C2 Server' },
      { id: 'ioc-002', type: 'IOC', name: 'evil-blacktide.xyz (Malicious Domain)', roleInScenario: 'Staging Infrastructure' },
    ],
    phases: [
      {
        id: 'phase-bt-01',
        phaseIndex: 0,
        name: 'INITIAL_ACCESS',
        description: 'Phishing email delivery with weaponized macro spreadsheet observed at email perimeter.',
        offsetSeconds: 5,
        mitreTechniqueId: 'T1566.001',
        eventTemplateIds: ['tpl-bt-01'],
      },
      {
        id: 'phase-bt-02',
        phaseIndex: 1,
        name: 'EXECUTION',
        description: 'Suspicious masqueraded dropper binary svchost32.exe spawned by user application on FINWS-027.',
        offsetSeconds: 25,
        mitreTechniqueId: 'T1059.001',
        eventTemplateIds: ['tpl-bt-02'],
      },
      {
        id: 'phase-bt-03',
        phaseIndex: 2,
        name: 'COMMAND_AND_CONTROL',
        description: 'Outbound TLS beacon to known threat actor IP 185.220.101.47 on port 8443.',
        offsetSeconds: 50,
        mitreTechniqueId: 'T1071.001',
        eventTemplateIds: ['tpl-bt-03', 'tpl-bt-04'],
      },
      {
        id: 'phase-bt-04',
        phaseIndex: 3,
        name: 'PERSISTENCE',
        description: 'New registry artifact written to CurrentVersion\\Run key for persistence.',
        offsetSeconds: 85,
        mitreTechniqueId: 'T1547.001',
        eventTemplateIds: ['tpl-bt-05'],
      },
      {
        id: 'phase-bt-05',
        phaseIndex: 4,
        name: 'DISCOVERY',
        description: 'Local host and network share discovery commands executed under compromised account.',
        offsetSeconds: 120,
        mitreTechniqueId: 'T1082',
        eventTemplateIds: ['tpl-bt-06'],
      },
    ],
    eventTemplates: [
      {
        id: 'tpl-bt-01',
        name: 'Phishing Email Weaponized Attachment Delivery',
        category: 'SECURITY_CONTROL',
        eventType: 'EMAIL_ATTACHMENT_DELIVERY',
        severity: 'HIGH',
        source: 'Proofpoint-Gateway',
        userId: 'user-001',
        message: 'Inbound email from payroll-update@external-notify.com with attachment Q4_Financial_Bonus_Audit.xlsm delivered to r.morrison.',
        offsetSeconds: 5,
        mitreTechniqueId: 'T1566.001',
      },
      {
        id: 'tpl-bt-02',
        name: 'Suspicious Obfuscated Process Execution',
        category: 'PROCESS',
        eventType: 'PROCESS_CREATE',
        severity: 'CRITICAL',
        source: 'Sysmon-FINWS-027',
        assetId: 'asset-001',
        userId: 'user-001',
        processName: 'svchost32.exe',
        parentProcessName: 'excel.exe',
        commandLine: 'C:\\Users\\r.morrison\\AppData\\Local\\Temp\\svchost32.exe --simulated-blacktide-payload',
        filePath: 'C:\\Users\\r.morrison\\AppData\\Local\\Temp\\svchost32.exe',
        fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        message: 'Untrusted binary svchost32.exe executed from AppData\\Local\\Temp spawned by EXCEL.EXE.',
        offsetSeconds: 25,
        mitreTechniqueId: 'T1059.001',
      },
      {
        id: 'tpl-bt-03',
        name: 'Cobalt Strike C2 Beacon Network Flow',
        category: 'NETWORK',
        eventType: 'NETWORK_FLOW',
        severity: 'CRITICAL',
        source: 'PaloAlto-Edge',
        assetId: 'asset-001',
        srcIp: '10.0.4.27',
        dstIp: '185.220.101.47',
        srcPort: 49812,
        dstPort: 8443,
        protocol: 'TCP',
        iocIds: ['ioc-001'],
        message: 'Outbound TCP connection from FINWS-027 (10.0.4.27) to known malicious C2 IP 185.220.101.47 on port 8443.',
        offsetSeconds: 50,
        mitreTechniqueId: 'T1071.001',
      },
      {
        id: 'tpl-bt-04',
        name: 'Malicious Domain DNS Query',
        category: 'NETWORK',
        eventType: 'DNS_QUERY',
        severity: 'HIGH',
        source: 'CoreDNS-Internal',
        assetId: 'asset-001',
        domain: 'evil-blacktide.xyz',
        srcIp: '10.0.4.27',
        iocIds: ['ioc-002'],
        message: 'DNS lookup query for suspected C2 staging domain evil-blacktide.xyz from FINWS-027.',
        offsetSeconds: 55,
        mitreTechniqueId: 'T1071.004',
      },
      {
        id: 'tpl-bt-05',
        name: 'Persistence via Registry Run Key',
        category: 'ENDPOINT',
        eventType: 'REGISTRY_MOD',
        severity: 'HIGH',
        source: 'Sysmon-FINWS-027',
        assetId: 'asset-001',
        userId: 'user-001',
        processName: 'svchost32.exe',
        message: 'Registry modification to HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run key pointing to svchost32.exe.',
        offsetSeconds: 85,
        mitreTechniqueId: 'T1547.001',
      },
      {
        id: 'tpl-bt-06',
        name: 'System Discovery Telemetry',
        category: 'PROCESS',
        eventType: 'PROCESS_CREATE',
        severity: 'MEDIUM',
        source: 'Sysmon-FINWS-027',
        assetId: 'asset-001',
        userId: 'user-001',
        processName: 'cmd.exe',
        commandLine: 'cmd.exe /c "net view && net group \"Domain Admins\" /domain"',
        message: 'Command-line system and domain reconnaissance executed by r.morrison on FINWS-027.',
        offsetSeconds: 120,
        mitreTechniqueId: 'T1082',
      },
    ],
    expectedDetections: [
      {
        ruleId: 'DET-GW-001',
        ruleName: 'High-Risk Email Gateway Attachment Delivery',
        expectedAlert: true,
        category: 'SECURITY_CONTROL',
        mitreTechniqueId: 'T1566.001',
      },
      {
        ruleId: 'DET-PROC-001',
        ruleName: 'Suspicious Obfuscated Process Execution',
        expectedAlert: true,
        category: 'PROCESS',
        mitreTechniqueId: 'T1059.001',
      },
      {
        ruleId: 'DET-NET-001',
        ruleName: 'Cobalt Strike C2 Beaconing & Malicious DNS Queries',
        expectedAlert: true,
        category: 'NETWORK',
        mitreTechniqueId: 'T1071.001',
      },
      {
        ruleId: 'DET-IOC-001',
        ruleName: 'High-Confidence Indicator of Compromise Match',
        expectedAlert: true,
        category: 'SECURITY_CONTROL',
        mitreTechniqueId: 'T1071',
      },
      {
        ruleId: 'DET-PER-001',
        ruleName: 'Unauthorized Registry Persistence Modification',
        expectedAlert: true,
        category: 'ENDPOINT',
        mitreTechniqueId: 'T1547.001',
      },
    ],
    expectedIncidents: [
      {
        title: 'Correlated Incident: Suspicious Obfuscated Process Execution on FINWS-027',
        severity: 'CRITICAL',
        targetAssetId: 'asset-001',
        targetUserId: 'user-001',
      },
    ],
    expectedResponses: ['PB-BLACKTIDE-ISOLATE'],
    mitreTechniques: ['T1566.001', 'T1059.001', 'T1071.001', 'T1547.001', 'T1082'],
    tags: ['blacktide', 'ransomware', 'alphv', 'drill', 'baseline'],
    createdAt: '2024-11-15T00:00:00Z',
    updatedAt: '2024-11-15T00:00:00Z',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. SUSPICIOUS AUTHENTICATION CHAIN & CREDENTIAL STUFFING
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'scen-auth-02',
    scenarioId: 'SCEN-AUTH-02',
    version: 1,
    name: 'Suspicious Authentication Chain: Credential Stuffing & Spray',
    description:
      'Defensive scenario simulating distributed credential stuffing followed by a successful anomalous logon from a foreign subnet.',
    objective:
      'Verify alert generation for repeated authentication anomalies (DET-AUTH-001) and correlation into an identity-centric security incident.',
    difficulty: 'BEGINNER',
    category: 'CREDENTIAL_ACCESS',
    status: 'READY',
    durationSeconds: 120,
    entities: [
      { id: 'user-001', type: 'USER', name: 'r.morrison', roleInScenario: 'Targeted User' },
      { id: 'asset-001', type: 'ASSET', name: 'FINWS-027', roleInScenario: 'Logon Destination' },
    ],
    phases: [
      {
        id: 'phase-auth-01',
        phaseIndex: 0,
        name: 'CREDENTIAL_ACCESS',
        description: 'Repeated failed Kerberos pre-authentication requests from external VPN IP.',
        offsetSeconds: 5,
        mitreTechniqueId: 'T1110.001',
        eventTemplateIds: ['tpl-auth-01', 'tpl-auth-02'],
      },
      {
        id: 'phase-auth-02',
        phaseIndex: 1,
        name: 'INITIAL_ACCESS',
        description: 'High-severity authentication burst bypassing normal geofence policies.',
        offsetSeconds: 40,
        mitreTechniqueId: 'T1078.002',
        eventTemplateIds: ['tpl-auth-03'],
      },
    ],
    eventTemplates: [
      {
        id: 'tpl-auth-01',
        name: 'Kerberos Pre-Authentication Failure Burst',
        category: 'AUTHENTICATION',
        eventType: 'AUTHENTICATION_FAILURE',
        severity: 'MEDIUM',
        source: 'WinEventLog-Security',
        userId: 'user-001',
        srcIp: '198.51.100.42',
        message: 'Kerberos pre-authentication failed for user r.morrison (Error code 0x18: preauth failed).',
        offsetSeconds: 5,
        mitreTechniqueId: 'T1110.001',
      },
      {
        id: 'tpl-auth-02',
        name: 'Password Spray Threshold Exceeded',
        category: 'AUTHENTICATION',
        eventType: 'BRUTE_FORCE_BURST',
        severity: 'HIGH',
        source: 'AzureAD-Audit',
        userId: 'user-001',
        srcIp: '198.51.100.42',
        message: '15 failed password attempts observed within 60 seconds against r.morrison account.',
        offsetSeconds: 20,
        mitreTechniqueId: 'T1110.003',
      },
      {
        id: 'tpl-auth-03',
        name: 'Anomalous Interactive Logon Succeeded',
        category: 'AUTHENTICATION',
        eventType: 'AUTHENTICATION_FAILURE', // Trigger rule
        severity: 'HIGH',
        source: 'WinEventLog-Security',
        userId: 'user-001',
        assetId: 'asset-001',
        srcIp: '198.51.100.42',
        message: 'Suspicious authentication anomaly: logon session initiated from untrusted IP 198.51.100.42.',
        offsetSeconds: 40,
        mitreTechniqueId: 'T1078.002',
      },
    ],
    expectedDetections: [
      {
        ruleId: 'DET-AUTH-001',
        ruleName: 'Suspicious Authentication & Password Spray Activity',
        expectedAlert: true,
        category: 'AUTHENTICATION',
        mitreTechniqueId: 'T1110.001',
      },
    ],
    expectedIncidents: [
      {
        title: 'Correlated Incident: Suspicious Authentication & Password Spray Activity on r.morrison',
        severity: 'HIGH',
        targetUserId: 'user-001',
      },
    ],
    expectedResponses: ['PB-USER-REVOKE'],
    mitreTechniques: ['T1110.001', 'T1110.003', 'T1078.002'],
    tags: ['identity', 'authentication', 'bruteforce', 'drill'],
    createdAt: '2024-11-15T00:00:00Z',
    updatedAt: '2024-11-15T00:00:00Z',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. C2 BEACON & MALICIOUS IOC CONTAINMENT DRILL
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'scen-ioc-03',
    scenarioId: 'SCEN-IOC-03',
    version: 1,
    name: 'C2 Beacon & Malicious IOC Containment Drill',
    description:
      'Exercises network sensor detection of confirmed external C2 infrastructure, triggering DET-NET-001 and DET-IOC-001 for automated threat intelligence enrichment.',
    objective:
      'Validate rapid indicator tagging, detection firing, and dry-run playbook execution for automated firewall blocking (PB-IOC-CONTAIN).',
    difficulty: 'INTERMEDIATE',
    category: 'ENDPOINT_COMPROMISE',
    status: 'READY',
    durationSeconds: 90,
    entities: [
      { id: 'asset-001', type: 'ASSET', name: 'FINWS-027', roleInScenario: 'Beaconing Host' },
      { id: 'ioc-001', type: 'IOC', name: '185.220.101.47', roleInScenario: 'Target Indicator' },
    ],
    phases: [
      {
        id: 'phase-ioc-01',
        phaseIndex: 0,
        name: 'COMMAND_AND_CONTROL',
        description: 'Periodic HTTP/S beaconing to known threat actor proxy.',
        offsetSeconds: 10,
        mitreTechniqueId: 'T1071.001',
        eventTemplateIds: ['tpl-ioc-01', 'tpl-ioc-02'],
      },
    ],
    eventTemplates: [
      {
        id: 'tpl-ioc-01',
        name: 'High-Frequency HTTPS Beacon Observed',
        category: 'NETWORK',
        eventType: 'NETWORK_FLOW',
        severity: 'CRITICAL',
        source: 'Suricata-NIDS',
        assetId: 'asset-001',
        srcIp: '10.0.4.27',
        dstIp: '185.220.101.47',
        dstPort: 443,
        protocol: 'HTTPS',
        iocIds: ['ioc-001'],
        message: 'Periodic TLS beacon detected to high-threat IP 185.220.101.47 with jitter <= 5%.',
        offsetSeconds: 10,
        mitreTechniqueId: 'T1071.001',
      },
      {
        id: 'tpl-ioc-02',
        name: 'Threat Intel Match Event',
        category: 'SECURITY_CONTROL',
        eventType: 'C2_BEACON_DETECTED',
        severity: 'HIGH',
        source: 'ThreatIntel-Engine',
        assetId: 'asset-001',
        iocIds: ['ioc-001'],
        message: 'Observed destination IP 185.220.101.47 matches confirmed ALPHV BlackTide C2 feed.',
        offsetSeconds: 25,
        mitreTechniqueId: 'T1071',
      },
    ],
    expectedDetections: [
      {
        ruleId: 'DET-NET-001',
        ruleName: 'Cobalt Strike C2 Beaconing & Malicious DNS Queries',
        expectedAlert: true,
        category: 'NETWORK',
        mitreTechniqueId: 'T1071.001',
      },
      {
        ruleId: 'DET-IOC-001',
        ruleName: 'High-Confidence Indicator of Compromise Match',
        expectedAlert: true,
        category: 'SECURITY_CONTROL',
        mitreTechniqueId: 'T1071',
      },
    ],
    expectedIncidents: [
      {
        title: 'Correlated Incident: Cobalt Strike C2 Beaconing & Malicious DNS Queries on FINWS-027',
        severity: 'CRITICAL',
        targetAssetId: 'asset-001',
      },
    ],
    expectedResponses: ['PB-IOC-CONTAIN'],
    mitreTechniques: ['T1071.001', 'T1071'],
    tags: ['ioc', 'network', 'c2', 'containment'],
    createdAt: '2024-11-15T00:00:00Z',
    updatedAt: '2024-11-15T00:00:00Z',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. ENDPOINT DROPPER & PERSISTENCE DRILL
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'scen-endpoint-04',
    scenarioId: 'SCEN-ENDPOINT-04',
    version: 1,
    name: 'Endpoint Dropper & Persistence Drill',
    description:
      'Tests endpoint sensor alerting on suspicious script execution and registry Run key persistence artifacts.',
    objective:
      'Demonstrate host telemetry triggering DET-PROC-001 and DET-PER-001 with asset linkage.',
    difficulty: 'INTERMEDIATE',
    category: 'ENDPOINT_COMPROMISE',
    status: 'READY',
    durationSeconds: 100,
    entities: [
      { id: 'asset-001', type: 'ASSET', name: 'FINWS-027', roleInScenario: 'Target Host' },
    ],
    phases: [
      {
        id: 'phase-ep-01',
        phaseIndex: 0,
        name: 'EXECUTION',
        description: 'PowerShell execution with base64 encoded parameters.',
        offsetSeconds: 15,
        mitreTechniqueId: 'T1059.001',
        eventTemplateIds: ['tpl-ep-01'],
      },
      {
        id: 'phase-ep-02',
        phaseIndex: 1,
        name: 'PERSISTENCE',
        description: 'Persistence mechanism established in user registry.',
        offsetSeconds: 45,
        mitreTechniqueId: 'T1547.001',
        eventTemplateIds: ['tpl-ep-02'],
      },
    ],
    eventTemplates: [
      {
        id: 'tpl-ep-01',
        name: 'Encoded PowerShell Dropper Execution',
        category: 'PROCESS',
        eventType: 'PROCESS_CREATE',
        severity: 'HIGH',
        source: 'Sysmon-FINWS-027',
        assetId: 'asset-001',
        processName: 'powershell.exe',
        commandLine: 'powershell.exe -ExecutionPolicy Bypass -simulated-telemetry',
        message: 'Suspicious PowerShell execution with bypass parameters on FINWS-027.',
        offsetSeconds: 15,
        mitreTechniqueId: 'T1059.001',
      },
      {
        id: 'tpl-ep-02',
        name: 'Startup Run Key Modification',
        category: 'ENDPOINT',
        eventType: 'PERSISTENCE_REGISTRY_MOD',
        severity: 'HIGH',
        source: 'Sysmon-FINWS-027',
        assetId: 'asset-001',
        processName: 'powershell.exe',
        message: 'Suspicious modification to HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run key detected.',
        offsetSeconds: 45,
        mitreTechniqueId: 'T1547.001',
      },
    ],
    expectedDetections: [
      {
        ruleId: 'DET-PROC-001',
        ruleName: 'Suspicious Obfuscated Process Execution',
        expectedAlert: true,
        category: 'PROCESS',
        mitreTechniqueId: 'T1059.001',
      },
      {
        ruleId: 'DET-PER-001',
        ruleName: 'Unauthorized Registry Persistence Modification',
        expectedAlert: true,
        category: 'ENDPOINT',
        mitreTechniqueId: 'T1547.001',
      },
    ],
    expectedIncidents: [
      {
        title: 'Correlated Incident: Suspicious Obfuscated Process Execution on FINWS-027',
        severity: 'HIGH',
        targetAssetId: 'asset-001',
      },
    ],
    expectedResponses: ['PB-BLACKTIDE-ISOLATE'],
    mitreTechniques: ['T1059.001', 'T1547.001'],
    tags: ['endpoint', 'powershell', 'persistence', 'sysmon'],
    createdAt: '2024-11-15T00:00:00Z',
    updatedAt: '2024-11-15T00:00:00Z',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. INTERNAL NETWORK LATERAL MOVEMENT INVESTIGATION
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'scen-lateral-05',
    scenarioId: 'SCEN-LATERAL-05',
    version: 1,
    name: 'Internal Lateral Movement & Data Staging Drill',
    description:
      'Simulates cross-workstation SMB access, suspicious process execution, and sensitive file compression.',
    objective:
      'Evaluate SOC detection capabilities across process (DET-PROC-001) and file exfiltration staging (DET-EXF-001).',
    difficulty: 'ADVANCED',
    category: 'LATERAL_MOVEMENT',
    status: 'READY',
    durationSeconds: 140,
    entities: [
      { id: 'asset-001', type: 'ASSET', name: 'FINWS-027', roleInScenario: 'Originating Host' },
      { id: 'user-001', type: 'USER', name: 'r.morrison', roleInScenario: 'Active Account' },
    ],
    phases: [
      {
        id: 'phase-lat-01',
        phaseIndex: 0,
        name: 'LATERAL_MOVEMENT',
        description: 'Internal remote command execution via masqueraded svchost32.exe.',
        offsetSeconds: 20,
        mitreTechniqueId: 'T1021.002',
        eventTemplateIds: ['tpl-lat-01'],
      },
      {
        id: 'phase-lat-02',
        phaseIndex: 1,
        name: 'EXFILTRATION',
        description: 'Archiving and staging corporate confidential documents.',
        offsetSeconds: 70,
        mitreTechniqueId: 'T1560.001',
        eventTemplateIds: ['tpl-lat-02'],
      },
    ],
    eventTemplates: [
      {
        id: 'tpl-lat-01',
        name: 'Masqueraded Binary Spawned for Lateral RPC',
        category: 'PROCESS',
        eventType: 'PROCESS_CREATE',
        severity: 'CRITICAL',
        source: 'Sysmon-FINWS-027',
        assetId: 'asset-001',
        userId: 'user-001',
        processName: 'svchost32.exe',
        commandLine: 'svchost32.exe --lateral-probe 10.0.4.50',
        message: 'svchost32.exe spawned initiating high-volume internal RPC connection.',
        offsetSeconds: 20,
        mitreTechniqueId: 'T1021.002',
      },
      {
        id: 'tpl-lat-02',
        name: 'Sensitive File Compression Staging',
        category: 'FILE',
        eventType: 'SENSITIVE_FILE_EXFIL_STAGE',
        severity: 'HIGH',
        source: 'DLP-Monitor',
        assetId: 'asset-001',
        userId: 'user-001',
        filePath: 'C:\\Users\\r.morrison\\AppData\\Local\\Temp\\Archive_Finance_Confidential.7z',
        message: 'Mass compression of 48 financial spreadsheets into encrypted archive in temp folder.',
        offsetSeconds: 70,
        mitreTechniqueId: 'T1560.001',
      },
    ],
    expectedDetections: [
      {
        ruleId: 'DET-PROC-001',
        ruleName: 'Suspicious Obfuscated Process Execution',
        expectedAlert: true,
        category: 'PROCESS',
        mitreTechniqueId: 'T1059.001',
      },
      {
        ruleId: 'DET-EXF-001',
        ruleName: 'Sensitive File Collection & Exfiltration Staging',
        expectedAlert: true,
        category: 'FILE',
        mitreTechniqueId: 'T1560.001',
      },
    ],
    expectedIncidents: [
      {
        title: 'Correlated Incident: Suspicious Obfuscated Process Execution on FINWS-027',
        severity: 'CRITICAL',
        targetAssetId: 'asset-001',
      },
    ],
    expectedResponses: ['PB-BLACKTIDE-ISOLATE'],
    mitreTechniques: ['T1021.002', 'T1560.001'],
    tags: ['lateral_movement', 'exfiltration', 'dlp', 'staging'],
    createdAt: '2024-11-15T00:00:00Z',
    updatedAt: '2024-11-15T00:00:00Z',
  },
];

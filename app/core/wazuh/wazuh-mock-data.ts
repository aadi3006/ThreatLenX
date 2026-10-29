/**
 * app/core/wazuh/wazuh-mock-data.ts
 *
 * High-fidelity deterministic mock data for Wazuh alerts and agents.
 * Used transparently as a graceful fallback when the Wazuh API is offline or unconfigured.
 */

import type { NormalizedAlert, WazuhAgent, WazuhAgentStatusSummary } from './wazuh-types';

export const MOCK_WAZUH_AGENTS: WazuhAgent[] = [
  {
    id: '001',
    name: 'dc-prod-01.corp.internal',
    ip: '10.0.10.15',
    status: 'active',
    version: 'Wazuh v4.9.0',
    os: {
      name: 'Windows Server 2022 Standard',
      platform: 'windows',
      version: '10.0.20348',
      arch: 'x86_64',
    },
    node_name: 'wazuh-manager-master',
    lastKeepAlive: new Date(Date.now() - 15000).toISOString(),
    group: ['default', 'domain-controllers', 'pci-dss'],
  },
  {
    id: '002',
    name: 'web-dmz-ingress-01',
    ip: '10.0.20.44',
    status: 'active',
    version: 'Wazuh v4.9.0',
    os: {
      name: 'Ubuntu 22.04.4 LTS',
      platform: 'ubuntu',
      version: '22.04',
      arch: 'x86_64',
    },
    node_name: 'wazuh-manager-master',
    lastKeepAlive: new Date(Date.now() - 42000).toISOString(),
    group: ['default', 'dmz-web'],
  },
  {
    id: '003',
    name: 'db-cluster-primary',
    ip: '10.0.30.12',
    status: 'active',
    version: 'Wazuh v4.9.0',
    os: {
      name: 'Red Hat Enterprise Linux 9.2',
      platform: 'rhel',
      version: '9.2',
      arch: 'x86_64',
    },
    node_name: 'wazuh-manager-worker-01',
    lastKeepAlive: new Date(Date.now() - 68000).toISOString(),
    group: ['default', 'database-tier'],
  },
  {
    id: '004',
    name: 'dev-workstation-88',
    ip: '10.0.40.88',
    status: 'disconnected',
    version: 'Wazuh v4.8.2',
    os: {
      name: 'macOS Sonoma 14.5',
      platform: 'darwin',
      version: '14.5',
      arch: 'arm64',
    },
    node_name: 'wazuh-manager-master',
    lastKeepAlive: new Date(Date.now() - 86400000).toISOString(),
    group: ['workstations'],
  },
  {
    id: '005',
    name: 'cloud-jumpbox-aws',
    ip: '10.0.1.5',
    status: 'active',
    version: 'Wazuh v4.9.0',
    os: {
      name: 'Amazon Linux 2023',
      platform: 'amzn',
      version: '2023',
      arch: 'x86_64',
    },
    node_name: 'wazuh-manager-worker-01',
    lastKeepAlive: new Date(Date.now() - 25000).toISOString(),
    group: ['default', 'cloud-infrastructure'],
  },
];

export const MOCK_WAZUH_AGENT_SUMMARY: WazuhAgentStatusSummary = {
  total: 5,
  active: 4,
  disconnected: 1,
  never_connected: 0,
  pending: 0,
};

export const MOCK_NORMALIZED_ALERTS: NormalizedAlert[] = [
  {
    id: 'wazuh-alert-5710-001',
    timestamp: new Date(Date.now() - 120000).toISOString(),
    severity: 'HIGH',
    source: '198.51.100.42',
    destination: '10.0.20.44',
    description: 'sshd: Multiple failed SSH login attempts (brute-force threshold exceeded)',
    rule_id: '5710',
    mitre_technique: 'T1110.001 (Password Guessing)',
    agent: {
      id: '002',
      name: 'web-dmz-ingress-01',
      ip: '10.0.20.44',
      status: 'active',
    },
    status: 'NEW',
    raw: {
      rule: { id: 5710, level: 10, description: 'sshd: Multiple failed logins' },
      agent: { id: '002', name: 'web-dmz-ingress-01' },
      data: { srcip: '198.51.100.42', dstip: '10.0.20.44', dstport: 22 },
    },
  },
  {
    id: 'wazuh-alert-92200-002',
    timestamp: new Date(Date.now() - 360000).toISOString(),
    severity: 'CRITICAL',
    source: '10.0.40.88',
    destination: '10.0.10.15',
    description: 'Suspicious encoded PowerShell command line execution detected via EventID 4688',
    rule_id: '92200',
    mitre_technique: 'T1059.001 (PowerShell Execution)',
    agent: {
      id: '001',
      name: 'dc-prod-01.corp.internal',
      ip: '10.0.10.15',
      status: 'active',
    },
    status: 'NEW',
    raw: {
      rule: { id: 92200, level: 13, description: 'Suspicious PowerShell execution' },
      agent: { id: '001', name: 'dc-prod-01.corp.internal' },
      data: { srcip: '10.0.40.88', dstip: '10.0.10.15' },
    },
  },
  {
    id: 'wazuh-alert-100201-003',
    timestamp: new Date(Date.now() - 600000).toISOString(),
    severity: 'CRITICAL',
    source: '10.0.30.12',
    destination: '10.0.30.12',
    description: 'Syscheck: Integrity Canary File modified in rapid succession (potential ransomware)',
    rule_id: '100201',
    mitre_technique: 'T1486 (Data Encrypted for Impact)',
    agent: {
      id: '003',
      name: 'db-cluster-primary',
      ip: '10.0.30.12',
      status: 'active',
    },
    status: 'ACKNOWLEDGED',
    raw: {
      rule: { id: 100201, level: 14, description: 'Integrity canary modified' },
      agent: { id: '003', name: 'db-cluster-primary' },
    },
  },
  {
    id: 'wazuh-alert-5501-004',
    timestamp: new Date(Date.now() - 950000).toISOString(),
    severity: 'MEDIUM',
    source: '10.0.1.5',
    destination: '10.0.1.5',
    description: 'PAM: User login failed or invalid credentials provided on cloud jumpbox',
    rule_id: '5501',
    mitre_technique: 'T1078 (Valid Accounts)',
    agent: {
      id: '005',
      name: 'cloud-jumpbox-aws',
      ip: '10.0.1.5',
      status: 'active',
    },
    status: 'NEW',
    raw: {
      rule: { id: 5501, level: 5, description: 'PAM: User login failed' },
      agent: { id: '005', name: 'cloud-jumpbox-aws' },
    },
  },
  {
    id: 'wazuh-alert-60100-005',
    timestamp: new Date(Date.now() - 1400000).toISOString(),
    severity: 'LOW',
    source: '10.0.20.44',
    destination: '10.0.20.44',
    description: 'Nginx: 404 Not Found error threshold exceeded for web-dmz-ingress-01',
    rule_id: '60100',
    mitre_technique: 'T1595 (Active Scanning)',
    agent: {
      id: '002',
      name: 'web-dmz-ingress-01',
      ip: '10.0.20.44',
      status: 'active',
    },
    status: 'RESOLVED',
    raw: {
      rule: { id: 60100, level: 4, description: 'Nginx 404 error threshold exceeded' },
      agent: { id: '002', name: 'web-dmz-ingress-01' },
    },
  },
];

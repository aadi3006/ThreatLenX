import type { Severity } from './incident';

export type AssetType =
  | 'ENDPOINT'
  | 'SERVER'
  | 'DATABASE'
  | 'DOMAIN_CONTROLLER'
  | 'FIREWALL'
  | 'ROUTER'
  | 'CLOUD_INSTANCE';

export type AssetCriticality = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type AssetStatus =
  | 'HEALTHY'
  | 'SUSPICIOUS'
  | 'COMPROMISED'
  | 'ISOLATED'
  | 'OFFLINE';

export type BlastRadiusLevel = 'DIRECT' | 'POTENTIAL' | 'AT_RISK' | 'SAFE';

export interface Asset {
  id: string;
  name: string;
  hostname: string;
  type: AssetType;
  ipAddress: string;
  macAddress: string;
  os: string;
  criticality: AssetCriticality;
  status: AssetStatus;
  owner?: string;
  department?: string;
  networkSegment?: string;
  blastRadiusLevel?: BlastRadiusLevel;
  compromisedAt?: string;
}

export type UserSecurityStatus = 'ACTIVE' | 'FLAGGED' | 'SUSPENDED' | 'COMPROMISED';

export interface SecurityUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  roleInOrg: string;
  department: string;
  status: UserSecurityStatus;
  riskScore: number;
  lastActive: string;
  assignedAssets: string[];
}

export type IocType =
  | 'IP'
  | 'DOMAIN'
  | 'HASH_SHA256'
  | 'HASH_MD5'
  | 'URL'
  | 'FILE_PATH'
  | 'MUTEX'
  | 'REGISTRY_KEY';

export interface IOC {
  id: string;
  type: IocType;
  value: string;
  threatType: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  reputationScore: number; // 0-100 maliciousness
  isBlocked: boolean;
  relatedIncidents: string[];
  relatedAssets: string[];
}

export interface Process {
  pid: number;
  name: string;
  path: string;
  commandLine: string;
  parentPid?: number;
  parentName?: string;
  user?: string;
  hash?: string;
  startedAt: string;
  assetId: string;
}

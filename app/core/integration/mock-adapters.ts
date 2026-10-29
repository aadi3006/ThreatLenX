/**
 * mock-adapters.ts
 *
 * Deterministic test & demonstration adapters for Step 14:
 * MockRemoteSecurityProvider, MockSIEMProvider, MockEDRAdapter,
 * MockIdentityProvider, MockExternalThreatIntelAdapter, MockExternalResponseExecutor.
 *
 * 100% in-memory, zero network access, fully controllable for testing edge cases
 * (network drop, conflicts, latency, external errors).
 */

import type {
  RemoteSecurityProvider,
  SIEMEventSource,
  EDRAdapter,
  IdentityProviderAdapter,
  ExternalThreatIntelAdapter,
  ExternalResponseExecutor,
} from './integration-interfaces';
import type { SyncOperation, SyncConflict, ExternalActionExecutionResult } from '../models/integration';
import type { Asset, SecurityUser, IOC } from '../models/entity';

/**
 * Controllable Mock Cloud Security Provider for testing synchronization & conflict handling.
 */
export class MockRemoteSecurityProvider implements RemoteSecurityProvider {
  public readonly providerId = 'MOCK_CLOUD_SOC';
  public readonly name = 'Mock Cloud SOC Backend';

  private connected = false;
  public shouldFailConnect = false;
  public shouldFailSync = false;
  public triggerConflictOnEntityId: string | null = null;
  public conflictRemoteVersion = 99;

  public async connect(): Promise<void> {
    if (this.shouldFailConnect) {
      throw new Error('Connection refused: Remote cloud gateway unreachable');
    }
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async fetchRemoteChanges(sinceTimestamp: string) {
    return {
      lastSyncTimestamp: new Date().toISOString(),
    };
  }

  public async pushLocalChanges(operations: SyncOperation[]): Promise<{
    applied: string[];
    conflicts: SyncConflict[];
  }> {
    if (!this.connected) {
      throw new Error('Cannot push changes: Remote provider is disconnected');
    }
    if (this.shouldFailSync) {
      throw new Error('Remote HTTP 503: Service temporarily unavailable');
    }

    const applied: string[] = [];
    const conflicts: SyncConflict[] = [];

    for (const op of operations) {
      if (this.triggerConflictOnEntityId && op.entityId === this.triggerConflictOnEntityId) {
        conflicts.push({
          conflictId: `conf-${Date.now()}-${op.entityId}`,
          entityType: op.entityType,
          entityId: op.entityId,
          localVersion: op.version,
          remoteVersion: this.conflictRemoteVersion,
          localPayload: op.payload,
          remotePayload: { ...op.payload, remoteModified: true, version: this.conflictRemoteVersion },
          detectedAt: new Date().toISOString(),
          resolution: 'UNRESOLVED',
        });
      } else {
        applied.push(op.operationId);
      }
    }

    return { applied, conflicts };
  }
}

/**
 * Controllable Mock SIEM Source (e.g. Splunk / Microsoft Sentinel).
 */
export class MockSIEMProvider implements SIEMEventSource {
  public readonly providerId = 'MOCK_SPLUNK_SIEM';
  public readonly name = 'Enterprise SIEM Stream';

  private connected = false;

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async queryEvents(params: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    filter?: string;
  }): Promise<Record<string, unknown>[]> {
    return [
      {
        id: `siem-evt-${Date.now()}-1`,
        timestamp: new Date().toISOString(),
        eventType: 'LOGON_FAILURE_SPIKE',
        source: 'AD-DC-01.corp.internal',
        severity: 'HIGH',
        message: 'Repeated Kerberos pre-authentication failure detected across multiple domain accounts.',
        assetId: 'asset-001',
        srcIp: '185.220.101.5',
      },
    ];
  }
}

/**
 * Controllable Mock EDR Adapter (e.g. CrowdStrike Falcon / Defender for Endpoint).
 */
export class MockEDRAdapter implements EDRAdapter {
  public readonly adapterId = 'MOCK_CROWDSTRIKE_EDR';
  public readonly name = 'Falcon Endpoint Agent Gateway';

  public isolatedHosts: Set<string> = new Set();

  public async getAsset(assetId: string): Promise<Asset | null> {
    return {
      id: assetId,
      name: `Host-${assetId}`,
      hostname: `host-${assetId}.corp.internal`,
      type: 'ENDPOINT',
      ipAddress: '10.0.4.15',
      macAddress: '00:1A:2B:3C:4D:5E',
      os: 'Linux Ubuntu 22.04',
      criticality: 'HIGH',
      owner: 'SecOps',
      department: 'Finance',
      status: this.isolatedHosts.has(assetId) ? 'ISOLATED' : 'HEALTHY',
    };
  }

  public async isolateAsset(assetId: string, reason: string) {
    this.isolatedHosts.add(assetId);
    return {
      success: true,
      details: {
        assetId,
        action: 'NETWORK_ISOLATION_ENGAGED',
        reason,
        agentStatus: 'ISOLATED',
        timestamp: new Date().toISOString(),
      },
    };
  }

  public async restoreAsset(assetId: string, reason: string) {
    this.isolatedHosts.delete(assetId);
    return {
      success: true,
      details: {
        assetId,
        action: 'NETWORK_ISOLATION_RELEASED',
        reason,
        agentStatus: 'NORMAL',
        timestamp: new Date().toISOString(),
      },
    };
  }

  public async collectEndpointEvidence(assetId: string, evidenceType: string) {
    return {
      evidenceId: `edr-evd-${Date.now()}`,
      assetId,
      evidenceType,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      collectedAt: new Date().toISOString(),
    };
  }

  public async getProcessActivity(assetId: string, limit = 10) {
    return [
      {
        pid: 4812,
        name: 'powershell.exe',
        commandLine: 'powershell.exe -NoP -NonI -W Hidden -Enc SUVY...',
        startedAt: new Date(Date.now() - 300000).toISOString(),
        user: 'CORP\\jsmith',
      },
    ];
  }
}

/**
 * Controllable Mock Identity Provider (e.g. Okta / Entra ID).
 */
export class MockIdentityProvider implements IdentityProviderAdapter {
  public readonly adapterId = 'MOCK_OKTA_IDP';
  public readonly name = 'Enterprise Directory Gateway';

  public suspendedUsers: Set<string> = new Set();

  public async getUser(userId: string): Promise<SecurityUser | null> {
    return {
      id: userId,
      username: `user_${userId}`,
      displayName: `User ${userId}`,
      department: 'Engineering',
      email: `${userId}@corp.internal`,
      roleInOrg: 'Standard',
      riskScore: 65,
      status: this.suspendedUsers.has(userId) ? 'SUSPENDED' : 'ACTIVE',
      lastActive: new Date().toISOString(),
      assignedAssets: [],
    };
  }

  public async suspendUser(userId: string, reason: string) {
    this.suspendedUsers.add(userId);
    return {
      success: true,
      details: {
        userId,
        action: 'USER_ACCOUNT_SUSPENDED',
        reason,
        suspendedAt: new Date().toISOString(),
      },
    };
  }

  public async restoreUser(userId: string) {
    this.suspendedUsers.delete(userId);
    return {
      success: true,
      details: {
        userId,
        action: 'USER_ACCOUNT_RESTORED',
        restoredAt: new Date().toISOString(),
      },
    };
  }

  public async getUserGroups(userId: string) {
    return ['Domain Users', 'VPN Access', 'Finance Operators'];
  }

  public async getUserActivity(userId: string, limit = 10) {
    return [
      {
        timestamp: new Date().toISOString(),
        action: 'USER_AUTH_SUCCESS',
        ipAddress: '192.168.1.100',
        location: 'HQ Enclave',
      },
    ];
  }
}

/**
 * Controllable Mock External Threat Intel Provider.
 */
export class MockExternalThreatIntelAdapter implements ExternalThreatIntelAdapter {
  public readonly adapterId = 'MOCK_EXTERNAL_TI';
  public readonly name = 'External Threat Feed Aggregator';

  public async lookupIOC(iocType: string, value: string) {
    if (value.includes('185.220.101') || value.includes('blacktide')) {
      return {
        found: true,
        confidence: 90,
        verdict: 'MALICIOUS',
        reputationScore: 92,
        tags: ['c2', 'botnet', 'blacktide-campaign'],
        rawDetails: { source: 'Global Threat Vault', asn: 'AS13335' },
      };
    }
    return { found: false };
  }

  public async enrichIOC(ioc: IOC): Promise<Partial<IOC>> {
    const res = await this.lookupIOC(ioc.type, ioc.value);
    if (res.found) {
      return {
        confidence: res.confidence,
        isBlocked: true,
      };
    }
    return {};
  }

  public async queryIndicators(filter: { minConfidence?: number; types?: string[]; limit?: number }): Promise<IOC[]> {
    return [];
  }
}

/**
 * Controllable Mock External Response Executor.
 */
export class MockExternalResponseExecutor implements ExternalResponseExecutor {
  public readonly executorId = 'MOCK_EXTERNAL_SOAR';
  public readonly name = 'Palo Alto Panorama Firewall Gateway';

  public async executeExternalAction(
    actionType: string,
    target: Record<string, unknown>,
    params?: Record<string, unknown>
  ): Promise<ExternalActionExecutionResult> {
    return {
      executionId: `ext-exec-${Date.now()}`,
      adapterId: this.executorId,
      actionType,
      targetId: String(target.id || 'TARGET'),
      status: 'SUCCESS',
      executedAt: new Date().toISOString(),
      details: {
        actionType,
        ruleApplied: 'BLOCK_POLICY_RULE_049',
        verified: true,
      },
    };
  }
}

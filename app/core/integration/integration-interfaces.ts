/**
 * integration-interfaces.ts
 *
 * Provider-neutral integration seam interfaces for Step 14:
 * SIEM, EDR, Identity, Threat Intel, Evidence Vault, SOAR, Ticketing, and Remote Provider.
 */

import type { SecurityEvent, IngestEventResult } from '../models/event';
import type { Alert } from '../models/alert';
import type { Incident } from '../models/incident';
import type { Asset, SecurityUser, IOC } from '../models/entity';
import type { DetectionRule } from '../models/detection';
import type { Case } from '../models/case';
import type { SyncOperation, SyncConflict, ExternalActionExecutionResult } from '../models/integration';

/**
 * Provider-neutral SIEM event ingestion stream / query interface.
 */
export interface SIEMEventSource {
  readonly providerId: string;
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  queryEvents(params: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    filter?: string;
  }): Promise<Record<string, unknown>[]>;
  streamEvents?(onEvent: (rawEvent: Record<string, unknown>) => void): () => void;
}

/**
 * Endpoint Detection & Response (EDR) integration interface.
 */
export interface EDRAdapter {
  readonly adapterId: string;
  readonly name: string;
  getAsset(assetId: string): Promise<Asset | null>;
  isolateAsset(assetId: string, reason: string): Promise<{ success: boolean; details: Record<string, unknown> }>;
  restoreAsset(assetId: string, reason: string): Promise<{ success: boolean; details: Record<string, unknown> }>;
  collectEndpointEvidence(assetId: string, evidenceType: string): Promise<Record<string, unknown>>;
  getProcessActivity(assetId: string, limit?: number): Promise<Array<{
    pid: number;
    name: string;
    commandLine: string;
    startedAt: string;
    user?: string;
  }>>;
}

/**
 * Enterprise Identity Provider (IdP) integration interface.
 */
export interface IdentityProviderAdapter {
  readonly adapterId: string;
  readonly name: string;
  getUser(userId: string): Promise<SecurityUser | null>;
  suspendUser(userId: string, reason: string): Promise<{ success: boolean; details: Record<string, unknown> }>;
  restoreUser(userId: string, reason: string): Promise<{ success: boolean; details: Record<string, unknown> }>;
  getUserGroups(userId: string): Promise<string[]>;
  getUserActivity(userId: string, limit?: number): Promise<Array<{
    timestamp: string;
    action: string;
    ipAddress?: string;
    location?: string;
  }>>;
}

/**
 * External Threat Intelligence provider interface.
 */
export interface ExternalThreatIntelAdapter {
  readonly adapterId: string;
  readonly name: string;
  lookupIOC(iocType: string, value: string): Promise<{
    found: boolean;
    confidence?: number;
    verdict?: string;
    reputationScore?: number;
    tags?: string[];
    rawDetails?: Record<string, unknown>;
  }>;
  enrichIOC(ioc: IOC): Promise<Partial<IOC>>;
  queryIndicators(filter: {
    minConfidence?: number;
    types?: string[];
    limit?: number;
  }): Promise<IOC[]>;
}

/**
 * Secure remote storage adapter for forensic evidence preservation.
 */
export interface ExternalEvidenceStorageAdapter {
  readonly adapterId: string;
  readonly name: string;
  uploadEvidenceBlob(
    evidenceId: string,
    blob: Blob | ArrayBuffer,
    metadata: Record<string, unknown>
  ): Promise<{ remoteUri: string; sha256: string; uploadedAt: string }>;
  downloadEvidenceBlob(remoteUri: string): Promise<ArrayBuffer>;
  verifyRemoteBlobIntegrity(remoteUri: string, expectedSha256: string): Promise<boolean>;
}

/**
 * External SOAR action execution adapter.
 */
export interface ExternalResponseExecutor {
  readonly executorId: string;
  readonly name: string;
  executeExternalAction(
    actionType: string,
    target: Record<string, unknown>,
    params?: Record<string, unknown>
  ): Promise<ExternalActionExecutionResult>;
}

/**
 * External Case Management / ITSM integration adapter (Jira, ServiceNow, etc.).
 */
export interface TicketingCaseAdapter {
  readonly adapterId: string;
  readonly name: string;
  createTicket(caseData: Case): Promise<{ ticketId: string; externalUrl?: string }>;
  updateTicket(ticketId: string, updates: Partial<Case>): Promise<void>;
  addComment(ticketId: string, comment: string, author: string): Promise<void>;
  closeTicket(ticketId: string, resolution: string): Promise<void>;
}

/**
 * Remote cloud security backend sync contract.
 */
export interface RemoteSecurityProvider {
  readonly providerId: string;
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  fetchRemoteChanges(sinceTimestamp: string): Promise<{
    incidents?: Incident[];
    alerts?: Alert[];
    events?: SecurityEvent[];
    assets?: Asset[];
    rules?: DetectionRule[];
    cases?: Case[];
    lastSyncTimestamp: string;
  }>;
  pushLocalChanges(operations: SyncOperation[]): Promise<{
    applied: string[];
    conflicts: SyncConflict[];
  }>;
}

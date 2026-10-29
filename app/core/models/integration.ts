/**
 * integration.ts
 *
 * Core domain models for Step 14: External & Cloud Integration Architecture.
 *
 * Establishes provider-agnostic contracts for:
 * - ConnectivityState (OFFLINE vs CONNECTED, status, sync health)
 * - SyncOperation (local-first outbox queue)
 * - SyncConflict (deterministic divergence detection & resolution)
 * - IntegrationConfig (adapter runtime parameters without hardcoded secrets)
 */

import type { TargetEntityType } from './ai';

export type ConnectivityMode = 'OFFLINE' | 'CONNECTED';

export type ConnectivityStatus =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'SYNCING'
  | 'DEGRADED'
  | 'ERROR';

export type SyncOperationType = 'CREATE' | 'UPDATE' | 'DELETE';

export type SyncOperationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CONFLICT';

export type ConflictResolutionPolicy =
  | 'LOCAL_WINS'
  | 'REMOTE_WINS'
  | 'MANUAL_REVIEW';

export type ConflictResolutionStatus =
  | 'UNRESOLVED'
  | 'LOCAL_WINS'
  | 'REMOTE_WINS'
  | 'MANUALLY_MERGED';

/**
 * Health & connection status of the SOC integration layer.
 */
export interface ConnectivityState {
  mode: ConnectivityMode;
  status: ConnectivityStatus;
  activeProviderId: string;
  isAirgapped: boolean;
  lastConnectedAt?: string;
  lastSyncAt?: string;
  pendingChangesCount: number;
  activeConflictsCount: number;
  lastError?: string;
  latencyMs?: number;
  availableAdapters: string[];
}

/**
 * Bounded outbox mutation entry representing a local change queued for remote sync.
 */
export interface SyncOperation {
  operationId: string;
  entityType: TargetEntityType;
  entityId: string;
  operation: SyncOperationType;
  payload: Record<string, unknown>;
  version: number;
  createdAt: string;
  retryCount: number;
  status: SyncOperationStatus;
  lastError?: string;
  syncedAt?: string;
}

/**
 * Deterministic version divergence record when local and remote versions conflict.
 */
export interface SyncConflict {
  conflictId: string;
  entityType: TargetEntityType;
  entityId: string;
  localVersion: number;
  remoteVersion: number;
  localPayload: Record<string, unknown>;
  remotePayload: Record<string, unknown>;
  detectedAt: string;
  resolution: ConflictResolutionStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
}

/**
 * Runtime configuration for integration adapters.
 * Never stores plaintext secrets or permanent credentials in source code.
 */
export interface IntegrationConfig {
  adapterId: string;
  name: string;
  type: 'SIEM' | 'EDR' | 'IDENTITY' | 'THREAT_INTEL' | 'EVIDENCE' | 'SOAR' | 'TICKETING' | 'CLOUD_AI';
  enabled: boolean;
  endpointUrl?: string;
  pollIntervalMs?: number;
  batchSize?: number;
  timeoutMs?: number;
  allowExternalActions?: boolean;
  enableRedaction?: boolean;
}

/**
 * Result returned from external response execution through an adapter.
 */
export interface ExternalActionExecutionResult {
  executionId: string;
  adapterId: string;
  actionType: string;
  targetId: string;
  status: 'SUCCESS' | 'FAILED' | 'QUEUED' | 'REJECTED';
  executedAt: string;
  details: Record<string, unknown>;
  errorMessage?: string;
}

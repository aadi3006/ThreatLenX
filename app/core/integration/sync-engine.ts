/**
 * sync-engine.ts
 *
 * Offline-first synchronization engine for Step 14.
 *
 * Architectural Invariants:
 * 1. LOCAL-FIRST: Local persistence happens immediately without blocking on remote sync.
 * 2. BOUNDED OUTBOX: Mutable operations (CREATE, UPDATE, DELETE) queue into 'sync_queue'.
 * 3. ZERO NETWORK IN OFFLINE MODE: When mode is 'OFFLINE', zero network calls are made.
 * 4. DETERMINISTIC CONFLICT RESOLUTION: Divergences produce SyncConflict records
 *    and resolve according to strict policy (LOCAL_WINS, REMOTE_WINS, MANUAL_REVIEW).
 */

import type {
  ConnectivityMode,
  ConnectivityStatus,
  ConnectivityState,
  SyncOperation,
  SyncOperationType,
  SyncConflict,
  ConflictResolutionPolicy,
  ConflictResolutionStatus,
} from '../models/integration';
import type { TargetEntityType } from '../models/ai';
import { get, getAll, put, remove } from '../storage/idb-store';
import type { RemoteSecurityProvider } from './integration-interfaces';

export type SyncEngineListener = (state: ConnectivityState) => void;

export class SyncEngine {
  private mode: ConnectivityMode = 'OFFLINE';
  private status: ConnectivityStatus = 'OFFLINE';
  private remoteProvider: RemoteSecurityProvider | null = null;
  private conflictPolicy: ConflictResolutionPolicy = 'LOCAL_WINS';
  private isAirgapped = true;
  private lastConnectedAt?: string;
  private lastSyncAt?: string;
  private lastError?: string;
  private latencyMs?: number;

  private inMemoryQueue: SyncOperation[] = [];
  private inMemoryConflicts: SyncConflict[] = [];
  private listeners: Set<SyncEngineListener> = new Set();
  private isSyncing = false;

  constructor() {
    this.status = 'OFFLINE';
  }

  // ─── Lifecycle & State ──────────────────────────────────────────────────────

  public async initialize(): Promise<void> {
    try {
      const persistedQueue = await getAll<SyncOperation>('sync_queue');
      this.inMemoryQueue = persistedQueue.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      const persistedConflicts = await getAll<SyncConflict>('sync_conflicts');
      this.inMemoryConflicts = persistedConflicts;
    } catch {
      // In-memory fallback if IndexedDB is not yet ready or in mock test environment
    }
  }

  public getConnectivityState(): ConnectivityState {
    return {
      mode: this.mode,
      status: this.status,
      activeProviderId: this.remoteProvider?.providerId || 'LOCAL_ONLY',
      isAirgapped: this.mode === 'OFFLINE',
      lastConnectedAt: this.lastConnectedAt,
      lastSyncAt: this.lastSyncAt,
      pendingChangesCount: this.inMemoryQueue.filter((op) => op.status === 'PENDING').length,
      activeConflictsCount: this.inMemoryConflicts.filter((c) => c.resolution === 'UNRESOLVED').length,
      lastError: this.lastError,
      latencyMs: this.latencyMs,
      availableAdapters: this.remoteProvider ? [this.remoteProvider.providerId] : [],
    };
  }

  public subscribe(listener: SyncEngineListener): () => void {
    this.listeners.add(listener);
    listener(this.getConnectivityState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getConnectivityState();
    this.listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error('[SyncEngine] Listener notification error:', err);
      }
    });
  }

  // ─── Mode Switching ─────────────────────────────────────────────────────────

  public async setMode(
    targetMode: ConnectivityMode,
    remoteProvider?: RemoteSecurityProvider
  ): Promise<ConnectivityState> {
    if (targetMode === 'OFFLINE') {
      this.mode = 'OFFLINE';
      this.status = 'OFFLINE';
      this.isAirgapped = true;
      if (this.remoteProvider) {
        try {
          await this.remoteProvider.disconnect();
        } catch {
          // ignore cleanup errors
        }
      }
      this.notify();
      return this.getConnectivityState();
    }

    // CONNECTED MODE
    this.mode = 'CONNECTED';
    this.status = 'CONNECTING';
    this.isAirgapped = false;
    this.lastError = undefined;
    this.notify();

    if (remoteProvider) {
      this.remoteProvider = remoteProvider;
    }

    if (!this.remoteProvider) {
      this.status = 'ERROR';
      this.lastError = 'Cannot enter connected mode: No RemoteSecurityProvider configured.';
      this.notify();
      return this.getConnectivityState();
    }

    try {
      const t0 = Date.now();
      await this.remoteProvider.connect();
      this.latencyMs = Date.now() - t0;
      this.status = 'CONNECTED';
      this.lastConnectedAt = new Date().toISOString();
      this.notify();

      // Trigger sync of queued operations
      await this.flushSyncQueue();
    } catch (err: any) {
      this.status = 'DEGRADED';
      this.lastError = `Remote connection failed: ${err?.message || 'Network unreachable'}. Operating in offline fallback.`;
      this.notify();
    }

    return this.getConnectivityState();
  }

  public setConflictPolicy(policy: ConflictResolutionPolicy): void {
    this.conflictPolicy = policy;
  }

  public getConflictPolicy(): ConflictResolutionPolicy {
    return this.conflictPolicy;
  }

  // ─── Outbox Queue ───────────────────────────────────────────────────────────

  public async queueOperation(
    entityType: TargetEntityType,
    entityId: string,
    operation: SyncOperationType,
    payload: Record<string, unknown>,
    version = 1
  ): Promise<SyncOperation> {
    const syncOp: SyncOperation = {
      operationId: `sync-op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      entityType,
      entityId,
      operation,
      payload,
      version,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      status: 'PENDING',
    };

    this.inMemoryQueue.push(syncOp);

    try {
      await put('sync_queue', syncOp);
    } catch {
      // In-memory fallback
    }

    this.notify();

    // If connected, attempt background dispatch
    if (this.mode === 'CONNECTED' && this.status === 'CONNECTED' && !this.isSyncing) {
      this.flushSyncQueue().catch((err) => {
        console.warn('[SyncEngine] Background flush error:', err);
      });
    }

    return syncOp;
  }

  public getQueue(status?: SyncOperation['status']): SyncOperation[] {
    if (!status) return [...this.inMemoryQueue];
    return this.inMemoryQueue.filter((op) => op.status === status);
  }

  public getConflicts(unresolvedOnly = false): SyncConflict[] {
    if (unresolvedOnly) {
      return this.inMemoryConflicts.filter((c) => c.resolution === 'UNRESOLVED');
    }
    return [...this.inMemoryConflicts];
  }

  // ─── Sync Execution ─────────────────────────────────────────────────────────

  public async flushSyncQueue(): Promise<{ synced: number; conflicts: number; failed: number }> {
    if (this.mode === 'OFFLINE' || !this.remoteProvider || this.isSyncing) {
      return { synced: 0, conflicts: 0, failed: 0 };
    }

    const pending = this.inMemoryQueue.filter((op) => op.status === 'PENDING');
    if (pending.length === 0) {
      return { synced: 0, conflicts: 0, failed: 0 };
    }

    this.isSyncing = true;
    this.status = 'SYNCING';
    this.notify();

    let syncedCount = 0;
    let conflictCount = 0;
    let failedCount = 0;

    try {
      const result = await this.remoteProvider.pushLocalChanges(pending);

      for (const opId of result.applied) {
        const item = this.inMemoryQueue.find((op) => op.operationId === opId);
        if (item) {
          item.status = 'COMPLETED';
          item.syncedAt = new Date().toISOString();
          syncedCount++;
          try {
            await put('sync_queue', item);
          } catch {
            // non-fatal
          }
        }
      }

      for (const conf of result.conflicts) {
        conflictCount++;
        const item = this.inMemoryQueue.find((op) => op.entityId === conf.entityId);
        if (item) item.status = 'CONFLICT';

        // Apply policy
        if (this.conflictPolicy === 'LOCAL_WINS') {
          conf.resolution = 'LOCAL_WINS';
          conf.resolvedAt = new Date().toISOString();
          conf.resolvedBy = 'SYSTEM_POLICY_LOCAL_WINS';
        } else if (this.conflictPolicy === 'REMOTE_WINS') {
          conf.resolution = 'REMOTE_WINS';
          conf.resolvedAt = new Date().toISOString();
          conf.resolvedBy = 'SYSTEM_POLICY_REMOTE_WINS';
        } else {
          conf.resolution = 'UNRESOLVED';
        }

        this.inMemoryConflicts.push(conf);
        try {
          await put('sync_conflicts', conf);
        } catch {
          // non-fatal
        }
      }

      this.lastSyncAt = new Date().toISOString();
      this.status = conflictCount > 0 && this.conflictPolicy === 'MANUAL_REVIEW' ? 'DEGRADED' : 'CONNECTED';
    } catch (err: any) {
      failedCount = pending.length;
      this.status = 'DEGRADED';
      this.lastError = `Sync failed: ${err?.message || 'Remote error'}`;
      for (const op of pending) {
        op.retryCount++;
        op.lastError = err?.message;
      }
    } finally {
      this.isSyncing = false;
      this.notify();
    }

    return { synced: syncedCount, conflicts: conflictCount, failed: failedCount };
  }

  // ─── Manual Conflict Recording & Resolution ─────────────────────────────────

  public async recordConflict(
    entityType: TargetEntityType,
    entityId: string,
    localVersion: number,
    remoteVersion: number,
    localPayload: Record<string, unknown>,
    remotePayload: Record<string, unknown>
  ): Promise<SyncConflict> {
    const conflict: SyncConflict = {
      conflictId: `conf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entityType,
      entityId,
      localVersion,
      remoteVersion,
      localPayload,
      remotePayload,
      detectedAt: new Date().toISOString(),
      resolution: 'UNRESOLVED',
    };
    this.inMemoryConflicts.push(conflict);
    try {
      await put('sync_conflicts', conflict);
    } catch {
      // non-fatal
    }
    this.notify();
    return conflict;
  }

  public async resolveConflict(
    conflictId: string,
    resolution: 'LOCAL_WINS' | 'REMOTE_WINS',
    actor = 'analyst'
  ): Promise<SyncConflict> {
    const conflict = this.inMemoryConflicts.find((c) => c.conflictId === conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    conflict.resolution = resolution;
    conflict.resolvedAt = new Date().toISOString();
    conflict.resolvedBy = actor;

    try {
      await put('sync_conflicts', conflict);
    } catch {
      // non-fatal
    }

    // Update associated queue item if exists
    const queueItem = this.inMemoryQueue.find((op) => op.entityId === conflict.entityId);
    if (queueItem) {
      if (resolution === 'LOCAL_WINS') {
        queueItem.status = 'PENDING'; // re-attempt push
      } else {
        queueItem.status = 'COMPLETED'; // remote takes precedence
      }
      try {
        await put('sync_queue', queueItem);
      } catch {
        // non-fatal
      }
    }

    this.notify();
    return conflict;
  }
}

export const syncEngine = new SyncEngine();

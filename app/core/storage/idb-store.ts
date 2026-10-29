/**
 * idb-store.ts — Typed IndexedDB wrapper for EXPLAIN-SEC SPATIAL.
 *
 * Schema v1 object stores:
 *   incidents        keyPath: 'id'   — Incident records (mutable)
 *   assets           keyPath: 'id'   — Asset records (mutable)
 *   users            keyPath: 'id'   — SecurityUser records (mutable)
 *   iocs             keyPath: 'id'   — IOC records (mutable)
 *   response_actions keyPath: 'id'   — ResponseAction records (mutable)
 *   audit_records    keyPath: 'id'   — AuditRecord records (append-only)
 *   meta             keyPath: 'key'  — Version flags, scenario state, etc.
 *
 * Static/computed data (attack graphs, system radar, IOC graphs, MITRE coverage)
 * is NOT persisted — it is derived from seed-data.ts at read time and costs
 * nothing to regenerate. Only mutable user-state stores are persisted.
 *
 * Migration strategy:
 *   Increment DB_VERSION and add a case to the `onupgradeneeded` switch.
 *   Each version block runs exactly once per client.
 */

export const DB_NAME = 'es-spatial-db';
export const DB_VERSION = 13;

export type IdbStoreName =
  | 'incidents'
  | 'assets'
  | 'users'
  | 'iocs'
  | 'response_actions'
  | 'audit_records'
  | 'events'
  | 'alerts'
  | 'threat_hunts'
  | 'cases'
  | 'case_notes'
  | 'case_tasks'
  | 'case_findings'
  | 'evidence'
  | 'evidence_annotations'
  | 'evidence_custody'
  | 'evidence_blobs'
  | 'threat_intel'
  | 'threat_intel_relationships'
  | 'detection_rules'
  | 'detection_rule_versions'
  | 'detection_test_runs'
  | 'playbooks'
  | 'playbook_versions'
  | 'playbook_executions'
  | 'approvals'
  | 'response_policies'
  | 'simulation_scenarios'
  | 'simulation_runs'
  | 'simulation_results'
  | 'ai_investigation_responses'
  | 'ai_action_proposals'
  | 'sync_queue'
  | 'sync_conflicts'
  | 'integration_configs'
  | 'meta';

// ─── Meta key constants ───────────────────────────────────────────────────────

export const META_SEEDED             = 'seeded';               // boolean — has baseline seed data been written?
export const META_EVENTS_SEEDED      = 'events_seeded';        // boolean — has seed security events data been written?
export const META_ALERTS_SEEDED      = 'alerts_seeded';        // boolean — has baseline detection alerts data been written?
export const META_CORRELATION_SEEDED = 'correlation_seeded';   // boolean — has correlation seed alignment run?
export const META_HUNTS_SEEDED       = 'hunts_seeded';         // boolean — has baseline threat hunts data been written?
export const META_CASES_SEEDED       = 'cases_seeded';         // boolean — has baseline cases data been written?
export const META_CASE_SEQUENCE      = 'case_sequence';        // number — monotonic sequence for case numbering
export const META_EVIDENCE_SEEDED    = 'evidence_seeded';      // boolean — has baseline evidence data been written?
export const META_EVIDENCE_SEQUENCE  = 'evidence_sequence';    // number — monotonic sequence for evidence numbering
export const META_THREAT_INTEL_SEEDED = 'threat_intel_seeded'; // boolean — has baseline threat intel been seeded?
export const META_RULES_SEEDED       = 'rules_seeded';         // boolean — has baseline detection rules data been written?
export const META_PLAYBOOKS_SEEDED   = 'playbooks_seeded';     // boolean — has baseline SOAR playbooks been written?
export const META_SIMULATIONS_SEEDED = 'simulations_seeded'; // boolean — has baseline simulation scenarios data been written?
export const META_SCENARIO           = 'scenario_state';       // { activeScenarioId, activeScenarioStep }
export const META_DB_VERSION         = 'schema_version';       // number

export interface ScenarioMeta {
  activeScenarioId: string | null;
  activeScenarioStep: number;
}

// ─── Singleton DB handle ──────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      // Each case is intentionally un-broken — run all upgrades in sequence.
      // eslint-disable-next-line default-case
      switch (true) {
        case oldVersion < 1: {
          // v0 → v1: create all initial stores
          if (!db.objectStoreNames.contains('incidents'))        db.createObjectStore('incidents',        { keyPath: 'id' });
          if (!db.objectStoreNames.contains('assets'))           db.createObjectStore('assets',           { keyPath: 'id' });
          if (!db.objectStoreNames.contains('users'))            db.createObjectStore('users',            { keyPath: 'id' });
          if (!db.objectStoreNames.contains('iocs'))             db.createObjectStore('iocs',             { keyPath: 'id' });
          if (!db.objectStoreNames.contains('response_actions')) db.createObjectStore('response_actions', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('audit_records'))    db.createObjectStore('audit_records',    { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta'))             db.createObjectStore('meta',             { keyPath: 'key' });
        }
        case oldVersion < 2: {
          // v1 → v2: create events store for raw/normalized security telemetry
          if (!db.objectStoreNames.contains('events')) {
            const eventStore = db.createObjectStore('events', { keyPath: 'id' });
            eventStore.createIndex('by_timestamp', 'timestamp');
            eventStore.createIndex('by_severity', 'severity');
            eventStore.createIndex('by_category', 'category');
            eventStore.createIndex('by_asset', 'assetId');
            eventStore.createIndex('by_incident', 'incidentId');
          }
        }
        case oldVersion < 3: {
          // v2 → v3: create alerts store with indices
          if (!db.objectStoreNames.contains('alerts')) {
            const alertStore = db.createObjectStore('alerts', { keyPath: 'id' });
            alertStore.createIndex('by_ruleId', 'ruleId');
            alertStore.createIndex('by_severity', 'severity');
            alertStore.createIndex('by_status', 'status');
            alertStore.createIndex('by_asset', 'assetId');
            alertStore.createIndex('by_incident', 'incidentId');
            alertStore.createIndex('by_createdAt', 'createdAt');
            alertStore.createIndex('by_fingerprint', 'fingerprint');
          }
        }
        case oldVersion < 4: {
          // v3 → v4: ensure incidents store has status, severity, and createdAt indices
          const tx = (event.target as IDBOpenDBRequest).transaction;
          if (tx && db.objectStoreNames.contains('incidents')) {
            const incidentStore = tx.objectStore('incidents');
            if (!incidentStore.indexNames.contains('by_status')) {
              incidentStore.createIndex('by_status', 'status');
            }
            if (!incidentStore.indexNames.contains('by_severity')) {
              incidentStore.createIndex('by_severity', 'severity');
            }
            if (!incidentStore.indexNames.contains('by_createdAt')) {
              incidentStore.createIndex('by_createdAt', 'createdAt');
            }
          }
        }
        case oldVersion < 5: {
          // v4 → v5: create threat_hunts store with indices
          if (!db.objectStoreNames.contains('threat_hunts')) {
            const huntStore = db.createObjectStore('threat_hunts', { keyPath: 'id' });
            huntStore.createIndex('by_status', 'status');
            huntStore.createIndex('by_createdAt', 'createdAt');
            huntStore.createIndex('by_createdBy', 'createdBy');
          }
        }
        case oldVersion < 6: {
          // v5 → v6: create case management stores with indices
          if (!db.objectStoreNames.contains('cases')) {
            const caseStore = db.createObjectStore('cases', { keyPath: 'id' });
            caseStore.createIndex('by_caseNumber', 'caseNumber', { unique: true });
            caseStore.createIndex('by_status', 'status');
            caseStore.createIndex('by_priority', 'priority');
            caseStore.createIndex('by_severity', 'severity');
            caseStore.createIndex('by_ownerId', 'ownerId');
            caseStore.createIndex('by_createdAt', 'createdAt');
            caseStore.createIndex('by_updatedAt', 'updatedAt');
          }
          if (!db.objectStoreNames.contains('case_notes')) {
            const noteStore = db.createObjectStore('case_notes', { keyPath: 'id' });
            noteStore.createIndex('by_caseId', 'caseId');
            noteStore.createIndex('by_authorId', 'authorId');
            noteStore.createIndex('by_createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('case_tasks')) {
            const taskStore = db.createObjectStore('case_tasks', { keyPath: 'id' });
            taskStore.createIndex('by_caseId', 'caseId');
            taskStore.createIndex('by_status', 'status');
            taskStore.createIndex('by_assigneeId', 'assigneeId');
            taskStore.createIndex('by_createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('case_findings')) {
            const findingStore = db.createObjectStore('case_findings', { keyPath: 'id' });
            findingStore.createIndex('by_caseId', 'caseId');
            findingStore.createIndex('by_createdAt', 'createdAt');
          }
        }
        case oldVersion < 7: {
          // v6 → v7: create evidence management stores with indices
          if (!db.objectStoreNames.contains('evidence')) {
            const evidenceStore = db.createObjectStore('evidence', { keyPath: 'id' });
            evidenceStore.createIndex('by_evidenceNumber', 'evidenceNumber', { unique: true });
            evidenceStore.createIndex('by_caseId', 'caseId');
            evidenceStore.createIndex('by_status', 'status');
            evidenceStore.createIndex('by_type', 'type');
            evidenceStore.createIndex('by_sourceType', 'sourceType');
            evidenceStore.createIndex('by_createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('evidence_annotations')) {
            const annoStore = db.createObjectStore('evidence_annotations', { keyPath: 'id' });
            annoStore.createIndex('by_evidenceId', 'evidenceId');
            annoStore.createIndex('by_createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('evidence_custody')) {
            const custodyStore = db.createObjectStore('evidence_custody', { keyPath: 'id' });
            custodyStore.createIndex('by_evidenceId', 'evidenceId');
            custodyStore.createIndex('by_timestamp', 'timestamp');
          }
          if (!db.objectStoreNames.contains('evidence_blobs')) {
            db.createObjectStore('evidence_blobs', { keyPath: 'id' });
          }
        }
        case oldVersion < 8: {
          // v7 → v8: create threat intelligence and relationship stores
          if (!db.objectStoreNames.contains('threat_intel')) {
            const intelStore = db.createObjectStore('threat_intel', { keyPath: 'id' });
            intelStore.createIndex('by_indicatorId', 'indicatorId', { unique: true });
            intelStore.createIndex('by_indicatorType', 'indicatorType');
            intelStore.createIndex('by_indicatorValue', 'indicatorValue');
            intelStore.createIndex('by_confidence', 'confidence');
            intelStore.createIndex('by_sourceType', 'sourceType');
            intelStore.createIndex('by_createdAt', 'createdAt');
            intelStore.createIndex('by_updatedAt', 'updatedAt');
          }
          if (!db.objectStoreNames.contains('threat_intel_relationships')) {
            const relStore = db.createObjectStore('threat_intel_relationships', { keyPath: 'id' });
            relStore.createIndex('by_sourceId', 'sourceId');
            relStore.createIndex('by_targetId', 'targetId');
            relStore.createIndex('by_targetType', 'targetType');
            relStore.createIndex('by_relationshipType', 'relationshipType');
            relStore.createIndex('by_createdAt', 'createdAt');
          }
        }
        case oldVersion < 9: {
          // v8 → v9: create detection engineering stores
          if (!db.objectStoreNames.contains('detection_rules')) {
            const ruleStore = db.createObjectStore('detection_rules', { keyPath: 'id' });
            ruleStore.createIndex('by_ruleId', 'ruleId');
            ruleStore.createIndex('by_status', 'status');
            ruleStore.createIndex('by_severity', 'severity');
            ruleStore.createIndex('by_category', 'category');
            ruleStore.createIndex('by_enabled', 'enabled');
          }
          if (!db.objectStoreNames.contains('detection_rule_versions')) {
            const verStore = db.createObjectStore('detection_rule_versions', { keyPath: 'id' });
            verStore.createIndex('by_ruleId', 'ruleId');
            verStore.createIndex('by_version', 'version');
            verStore.createIndex('by_ruleId_version', ['ruleId', 'version']);
          }
          if (!db.objectStoreNames.contains('detection_test_runs')) {
            const runStore = db.createObjectStore('detection_test_runs', { keyPath: 'id' });
            runStore.createIndex('by_ruleId', 'ruleId');
            runStore.createIndex('by_executedAt', 'executedAt');
          }
        }
        case oldVersion < 10: {
          // v9 → v10: create SOAR playbook, execution, approval, and policy stores
          if (!db.objectStoreNames.contains('playbooks')) {
            const pbStore = db.createObjectStore('playbooks', { keyPath: 'id' });
            pbStore.createIndex('by_playbookId', 'playbookId');
            pbStore.createIndex('by_status', 'status');
            pbStore.createIndex('by_enabled', 'enabled');
            pbStore.createIndex('by_category', 'category');
          }
          if (!db.objectStoreNames.contains('playbook_versions')) {
            const verStore = db.createObjectStore('playbook_versions', { keyPath: 'id' });
            verStore.createIndex('by_playbookId', 'playbookId');
            verStore.createIndex('by_version', 'version');
          }
          if (!db.objectStoreNames.contains('playbook_executions')) {
            const execStore = db.createObjectStore('playbook_executions', { keyPath: 'id' });
            execStore.createIndex('by_playbookId', 'playbookId');
            execStore.createIndex('by_incidentId', 'incidentId');
            execStore.createIndex('by_status', 'status');
            execStore.createIndex('by_startedAt', 'startedAt');
          }
          if (!db.objectStoreNames.contains('approvals')) {
            const appStore = db.createObjectStore('approvals', { keyPath: 'id' });
            appStore.createIndex('by_executionId', 'executionId');
            appStore.createIndex('by_status', 'status');
            appStore.createIndex('by_stepId', 'stepId');
          }
          if (!db.objectStoreNames.contains('response_policies')) {
            db.createObjectStore('response_policies', { keyPath: 'id' });
          }
        }
        case oldVersion < 11: {
          // v10 → v11: create attack simulation & cyber range stores
          if (!db.objectStoreNames.contains('simulation_scenarios')) {
            const scStore = db.createObjectStore('simulation_scenarios', { keyPath: 'id' });
            scStore.createIndex('by_scenarioId', 'scenarioId');
            scStore.createIndex('by_status', 'status');
            scStore.createIndex('by_category', 'category');
            scStore.createIndex('by_difficulty', 'difficulty');
          }
          if (!db.objectStoreNames.contains('simulation_runs')) {
            const runStore = db.createObjectStore('simulation_runs', { keyPath: 'id' });
            runStore.createIndex('by_scenarioId', 'scenarioId');
            runStore.createIndex('by_status', 'status');
            runStore.createIndex('by_startedAt', 'startedAt');
          }
          if (!db.objectStoreNames.contains('simulation_results')) {
            const resStore = db.createObjectStore('simulation_results', { keyPath: 'id' });
            resStore.createIndex('by_runId', 'runId', { unique: true });
            resStore.createIndex('by_scenarioId', 'scenarioId');
          }
        }
        case oldVersion < 12: {
          // v11 → v12: create AI investigation responses & action proposal stores
          if (!db.objectStoreNames.contains('ai_investigation_responses')) {
            const aiStore = db.createObjectStore('ai_investigation_responses', { keyPath: 'id' });
            aiStore.createIndex('by_contextId', 'contextId');
            aiStore.createIndex('by_responseType', 'responseType');
            aiStore.createIndex('by_generatedAt', 'generatedAt');
          }
          if (!db.objectStoreNames.contains('ai_action_proposals')) {
            const propStore = db.createObjectStore('ai_action_proposals', { keyPath: 'id' });
            propStore.createIndex('by_contextId', 'contextId');
            propStore.createIndex('by_status', 'status');
            propStore.createIndex('by_actionType', 'actionType');
            propStore.createIndex('by_createdAt', 'createdAt');
          }
        }
        case oldVersion < 13: {
          // v12 → v13: create Step 14 sync queue, conflicts & integration config stores
          if (!db.objectStoreNames.contains('sync_queue')) {
            const queueStore = db.createObjectStore('sync_queue', { keyPath: 'operationId' });
            queueStore.createIndex('by_status', 'status');
            queueStore.createIndex('by_entityType', 'entityType');
            queueStore.createIndex('by_createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('sync_conflicts')) {
            const conflictStore = db.createObjectStore('sync_conflicts', { keyPath: 'conflictId' });
            conflictStore.createIndex('by_entityType', 'entityType');
            conflictStore.createIndex('by_resolution', 'resolution');
            conflictStore.createIndex('by_detectedAt', 'detectedAt');
          }
          if (!db.objectStoreNames.contains('integration_configs')) {
            db.createObjectStore('integration_configs', { keyPath: 'adapterId' });
          }
          break;
        }
      }
    };

    request.onsuccess = () => {
      _db = request.result;

      // Handle unexpected version changes / tab conflicts
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };

      resolve(_db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IDB open blocked — close other tabs.'));
  });
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

function tx(
  db: IDBDatabase,
  stores: IdbStoreName | IdbStoreName[],
  mode: IDBTransactionMode
): IDBTransaction {
  return db.transaction(stores, mode);
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror    = () => reject(transaction.error);
    transaction.onabort    = () => reject(new Error('IDB transaction aborted'));
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read a single record by key. */
export async function get<T>(store: IdbStoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  return promisify<T | undefined>(tx(db, store, 'readonly').objectStore(store).get(key));
}

/** Read all records from a store. */
export async function getAll<T>(store: IdbStoreName): Promise<T[]> {
  const db = await openDb();
  return promisify<T[]>(tx(db, store, 'readonly').objectStore(store).getAll());
}

/** Write (upsert) a single record. */
export async function put<T>(store: IdbStoreName, value: T): Promise<void> {
  const db = await openDb();
  const t  = tx(db, store, 'readwrite');
  t.objectStore(store).put(value);
  return txDone(t);
}

/** Write (upsert) many records in a single transaction. */
export async function putMany<T>(store: IdbStoreName, values: T[]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDb();
  const t  = tx(db, store, 'readwrite');
  const os = t.objectStore(store);
  for (const v of values) os.put(v);
  return txDone(t);
}

/** Delete a single record by key. */
export async function remove(store: IdbStoreName, key: string): Promise<void> {
  const db = await openDb();
  const t  = tx(db, store, 'readwrite');
  t.objectStore(store).delete(key);
  return txDone(t);
}

export const deleteRecord = remove;

/** Clear all records in a store. */
export async function clearStore(store: IdbStoreName): Promise<void> {
  const db = await openDb();
  const t  = tx(db, store, 'readwrite');
  t.objectStore(store).clear();
  return txDone(t);
}

// ─── Meta helpers ─────────────────────────────────────────────────────────────

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const row = await promisify<{ key: string; value: T } | undefined>(
    tx(db, 'meta', 'readonly').objectStore('meta').get(key)
  );
  return row?.value;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  const t  = tx(db, 'meta', 'readwrite');
  t.objectStore('meta').put({ key, value });
  return txDone(t);
}

/**
 * Deterministically generates the next collision-safe case number: CASE-000001, etc.
 * Uses atomic sequence increment in the meta store.
 */
export async function getNextCaseNumber(): Promise<string> {
  const currentSeq = (await getMeta<number>(META_CASE_SEQUENCE)) ?? 0;
  const nextSeq = currentSeq + 1;
  await setMeta<number>(META_CASE_SEQUENCE, nextSeq);
  return `CASE-${String(nextSeq).padStart(6, '0')}`;
}

/**
 * Deterministically generates the next collision-safe evidence number: EVD-000001, etc.
 * Uses atomic sequence increment in the meta store.
 */
export async function getNextEvidenceNumber(): Promise<string> {
  const currentSeq = (await getMeta<number>(META_EVIDENCE_SEQUENCE)) ?? 0;
  const nextSeq = currentSeq + 1;
  await setMeta<number>(META_EVIDENCE_SEQUENCE, nextSeq);
  return `EVD-${String(nextSeq).padStart(6, '0')}`;
}

// ─── Reset ────────────────────────────────────────────────────────────────────

/**
 * Wipe all mutable stores AND the seeded flag.
 * On the next LocalProvider.initialize() call, seed data will be re-inserted.
 * Use from devtools or a "Reset Demo Data" UI control.
 */
export async function resetLocalData(): Promise<void> {
  const mutableStores: IdbStoreName[] = [
    'incidents',
    'assets',
    'users',
    'iocs',
    'response_actions',
    'audit_records',
    'events',
    'alerts',
    'threat_hunts',
    'cases',
    'case_notes',
    'case_tasks',
    'case_findings',
    'evidence',
    'evidence_annotations',
    'evidence_custody',
    'evidence_blobs',
    'threat_intel',
    'threat_intel_relationships',
    'detection_rules',
    'detection_rule_versions',
    'detection_test_runs',
    'playbooks',
    'playbook_versions',
    'playbook_executions',
    'approvals',
    'response_policies',
    'simulation_scenarios',
    'simulation_runs',
    'simulation_results',
    'ai_investigation_responses',
    'ai_action_proposals',
    'sync_queue',
    'sync_conflicts',
    'integration_configs',
    'meta',
  ];

  const db = await openDb();
  const t  = tx(db, mutableStores, 'readwrite');

  for (const s of mutableStores) {
    t.objectStore(s).clear();
  }

  await txDone(t);
  // _db is still valid — next initialize() will re-seed
}

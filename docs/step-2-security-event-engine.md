# STEP 2 — SECURITY EVENT ENGINE SPECIFICATION & ARCHITECTURE

**Project:** EXPLAIN-SEC SPATIAL  
**Stage:** Step 2 — Security Event Engine (Data + Security Engineering)  
**Status:** COMPLETE & FULLY VERIFIED  
**Environment:** 100% Offline, Zero Cloud Dependencies, Single RAF Loop, Single MediaPipe Vision Instance  

---

## 1. Executive Summary

Step 2 establishes the canonical **Security Event Engine** underneath the EXPLAIN-SEC SPATIAL SOC Command Center and spatial investigation hub. 

Prior to Step 2, security activity was represented by higher-level incident milestones (`TimelineEvent`) and operational audit logs (`AuditRecord`). The Security Event Engine introduces the foundational layer of **raw and normalized security telemetry** (`SecurityEvent`), allowing the SOC to ingest, validate, normalize, deduplicate, persist, query, and stream granular telemetry events locally.

```
+-------------------------------------------------------------------------+
|                              SOC UI LAYER                               |
|        SOC Command Center  *  Incident Universe  *  Investigation Hub   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                         SECURITY SERVICE FACADE                         |
|     getEvents(), queryEvents(), ingestEvent(), subscribeToEvents()      |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                             LOCAL PROVIDER                              |
|           Validation  *  Normalization  *  Deduplication                |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                         INDEXEDDB STORAGE (v2)                          |
|             'events' Object Store (Indices: ts, sev, cat, asset)        |
+-------------------------------------------------------------------------+
```

---

## 2. Canonical Security Event Model

Defined in `app/core/models/event.ts` and exported via `app/core/models/index.ts`:

```typescript
export type EventSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type EventCategory =
  | 'AUTHENTICATION'
  | 'NETWORK'
  | 'PROCESS'
  | 'ENDPOINT'
  | 'FILE'
  | 'IDENTITY'
  | 'SYSTEM'
  | 'SECURITY_CONTROL';

export type EventSourceType =
  | 'ENDPOINT'
  | 'FIREWALL'
  | 'AUTH'
  | 'DNS'
  | 'PROXY'
  | 'APPLICATION'
  | 'SYSTEM'
  | 'SIMULATOR';

export interface SecurityEvent {
  id: string;                               // Canonical unique identifier (e.g. evt-sec-...)
  timestamp: string;                        // ISO 8601 UTC timestamp of occurrence
  receivedAt: string;                       // ISO 8601 UTC timestamp when ingested
  eventType: string;                        // Normalized event name (e.g. POWERSHELL_LAUNCH, C2_BEACON)
  category: EventCategory;                  // Deterministic security category
  severity: EventSeverity;                  // Event telemetry severity (INFO..CRITICAL)
  source: string;                           // Specific sensor identifier (e.g. Sysmon-FINWS-027)
  sourceType: EventSourceType;              // Telemetry collector category
  
  // Entity references (Canonical foreign keys)
  assetId?: string;                         // Target or source asset ID (e.g. 'asset-001')
  userId?: string;                          // Associated user ID (e.g. 'user-001')
  incidentId?: string;                      // Associated incident if correlated (e.g. 'incident-001')
  iocIds?: string[];                        // Matched indicator of compromise IDs

  // Network telemetry
  srcIp?: string;
  dstIp?: string;
  srcPort?: number;
  dstPort?: number;
  protocol?: string;

  // Host / Process telemetry
  processName?: string;
  processId?: number;
  parentProcessName?: string;
  parentProcessId?: number;
  commandLine?: string;
  filePath?: string;
  fileHash?: string;

  // Web / Identity telemetry
  domain?: string;
  url?: string;
  httpMethod?: string;
  httpStatus?: number;

  // Semantic payload & metadata
  message: string;                          // Human-readable analyst description
  rawPayload?: string;                      // Optional raw log snippet
  metadata?: Record<string, unknown>;       // Extensible domain-specific attributes
  signature?: string;                       // Deterministic hash for deduplication
}
```

---

## 3. Event Normalization & Validation Pipeline

Located in `app/core/security/event-engine.ts`.

### 3.1 Ingestion Flow
```
RAW EVENT INPUT
       ↓
[1. VALIDATION] ──→ Rejects missing required fields, invalid category/severity,
       ↓           or corrupted referential integrity (unknown assetId/userId)
[2. NORMALIZATION] ─→ Standardizes ISO UTC timestamps, trims strings, upper-cases
       ↓           category/severity, computes deterministic signature
[3. DEDUPLICATION] ─→ Computes signature: simpleHash(ts|type|cat|src|asset|cmd|hash)
       ↓           Matches against in-memory & IndexedDB index
[4. PERSISTENCE] ───→ Writes to IndexedDB 'events' object store
       ↓
[5. IN-MEMORY STATE] → Updates LocalProvider._events cache & metrics
       ↓
[6. EVENT EMISSION] ─→ Emits 'EVENT_INGESTED' to subscribers & re-computes snapshot
```

### 3.2 Deduplication Strategy
Deterministic signatures are derived using:
$$\text{Signature} = \text{hash}(\text{timestamp} \mid \text{eventType} \mid \text{category} \mid \text{source} \mid \text{assetId} \mid \text{userId} \mid \text{srcIp} \mid \text{dstIp} \mid \text{commandLine} \mid \text{fileHash} \mid \text{message})$$

If an incoming event has the same canonical `id` or identical `signature` as an existing record, the engine safely returns:
```typescript
{ success: true, isDuplicate: true, event: existingEvent }
```
Duplicate events are never inserted twice into IndexedDB.

---

## 4. IndexedDB Schema Migration (v1 → v2)

File: `app/core/storage/idb-store.ts`

- **Upgraded Database Version:** `DB_VERSION = 2`.
- **Zero-Loss Incremental Migration:**
  The `onupgradeneeded` handler checks `oldVersion`:
  - When upgrading from v1 to v2, all existing stores (`incidents`, `assets`, `users`, `iocs`, `responseActions`, `auditRecords`, `meta`) remain completely untouched.
  - Creates object store `'events'` with `keyPath: 'id'`.
  - Creates query indices:
    - `by_timestamp` (`timestamp`)
    - `by_severity` (`severity`)
    - `by_category` (`category`)
    - `by_asset` (`assetId`)
    - `by_incident` (`incidentId`)
- **Deterministic Seeding:**
  Stores meta flag `'events_seeded'` to seed 22 rich Operation BlackTide and background noise events once on first startup.

---

## 5. SecurityService APIs

File: `app/core/security-service.ts`

UI components interact exclusively with `SecurityService`:

| API Method | Description |
| :--- | :--- |
| `getEvents(): Promise<SecurityEvent[]>` | Retrieves all normalized security events (sorted newest first). |
| `getEventById(id: string): Promise<SecurityEvent \| null>` | Retrieves a single security event by its canonical ID. |
| `queryEvents(query: SecurityEventQuery): Promise<SecurityEvent[]>` | Executes local filtering, time-bounding, text search, and pagination. |
| `getEventsForIncident(incidentId: string): Promise<SecurityEvent[]>` | Retrieves all security events associated with a specific incident. |
| `getEventsForAsset(assetId: string): Promise<SecurityEvent[]>` | Retrieves all security events targeting or originating from an asset. |
| `getEventsForUser(userId: string): Promise<SecurityEvent[]>` | Retrieves all security events associated with a specific user identity. |
| `getEventsForIOC(iocId: string): Promise<SecurityEvent[]>` | Retrieves all security events referencing a specific threat indicator. |
| `getRecentEvents(limit?: number): Promise<SecurityEvent[]>` | Retrieves the most recent $N$ security events (default 50). |
| `getEventsBetween(start: string, end: string): Promise<SecurityEvent[]>` | Retrieves events within an ISO timestamp time window. |
| `getEventStats(): Promise<SecurityEventStats>` | Computes live aggregation statistics across the event dataset. |
| `ingestEvent(event: SecurityEventInput): Promise<IngestEventResult>` | Ingests, normalizes, deduplicates, persists, and broadcasts a single event. |
| `ingestEvents(events: SecurityEventInput[]): Promise<IngestEventResult[]>` | Batch ingestion pipeline with atomic persistence and deduplication. |
| `subscribeToEvents(listener: (event: SecurityEvent) => void): () => void` | Subscribes to live security telemetry stream. |

---

## 6. SOC Command Center Integration

File: `app/spatial/command/CommandCenter.tsx`

The Step 1 Command Center was updated to integrate the Security Event Engine:
1. **Live Telemetry Stream Header:**
   - Displays real-time event counter: `SECURITY EVENT ENGINE TELEMETRY (23 EVENTS)`.
   - Real-time stat tags: `CRIT: 8`, `HIGH: 7`, `5M: 1`.
2. **Category Filter Tabs:**
   - Allows instant one-click filtering by `ALL`, `PROCESS`, `NETWORK`, `AUTH`, `ENDPOINT`, `FILE`.
3. **Live Ingestion Simulation:**
   - Includes an interactive `+ SIMULATE INGEST` button in the activity bar header.
   - Clicking triggers `securityService.ingestEvent(...)` with realistic enterprise attack vectors (Cobalt Strike C2, PowerShell memory execution, Kerberos brute-force, registry persistence).
   - Ingested events immediately update the UI, increment counters, and persist to IndexedDB.
4. **Investigation Hub Unbroken:**
   - Clicking `OPEN INVESTIGATION` seamlessly transitions into the cinematic investigation state machine without disruption.

---

## 7. Verification & Test Results

### 7.1 Automated Engine Unit Tests (`scripts/test-event-engine.ts`)
Executed with Node.js v26 / tsx:
- `✓ 1. Validation: Rejects event missing required fields`
- `✓ 2. Validation: Rejects invalid severity and category`
- `✓ 3. Validation: Accepts well-formed event input`
- `✓ 4. Validation: Enforces referential integrity for assetId and incidentId when requested`
- `✓ 5. Normalization: Standardizes timestamps, uppercase severity and category`
- `✓ 6. Deterministic Signatures: Identical raw telemetry yields identical signature`
- `✓ 7. Deduplication: Distinct telemetry produces different signatures`
- `✓ 8. Query Engine: Filters by severity, category, asset, and search term`
- `✓ 9. Query Engine: Deterministic sorting (newest first vs oldest first)`
- `✓ 10. Query Engine: Limit and offset pagination`
- `✓ 11. Statistics: Accurately computes totals, severities, categories, and top assets`
- `✓ 12. Seed Dataset: All 22 events conform to canonical schema with valid relationships`

**Result:** `12 / 12 tests passed (0 failures)`.

### 7.2 TypeScript & Build Verification
- `npx tsc --noEmit`: Exited with code **0** (0 errors).
- `npm run build:vercel`: Production build completed cleanly in **562ms**.

### 7.3 End-to-End Browser Verification
- Tested on `http://localhost:3000/`.
- Ingested simulated event `C2_BEACON_DETECTED`.
- Verified counter incremented from 22 to 23.
- Verified category filter tabs (`PROCESS`, `NETWORK`, `AUTH`).
- Reloaded page: verified event persisted at 23 events in IndexedDB.
- Verified investigation hub opened smoothly in FOCUS mode.

---

## 8. Limitations & Starting Point for Step 3

### Current Stage Scope Boundaries
- **Telemetry Layer Only:** This stage specifically implemented the telemetry foundation.
- **No Detection Rules Yet:** Sigma rules, threshold detectors, and automated alert correlation are reserved for Step 3.
- **No Auto-Incident Creation:** Events feed the activity stream and future correlation, but do not automatically create Incidents in this stage.

### Recommended Starting Point for Step 3:
1. Implement local detection rule engine (Sigma / YAML matching rules).
2. Correlate multiple `SecurityEvents` into detection `Alerts`.
3. Feed correlated alerts into automated Incident clustering.

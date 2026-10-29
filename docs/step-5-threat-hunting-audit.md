# EXPLAIN-SEC SPATIAL — STEP 5 THREAT HUNTING ENGINE AUDIT

**Date:** 2026-09-21  
**Status:** Phase 0 Architecture Audit Complete  
**Scope:** Offline-first Threat Hunting Engine  

---

## 1. Executive Summary & Core Guiding Principles

This pre-implementation audit examines the existing security architecture of **EXPLAIN-SEC SPATIAL** to establish the foundation for **Step 5: Threat Hunting Engine**.

### Fundamental Distinction in SOC Operating Model
- **SecurityEvent** (`app/core/models/event.ts`): *What happened* — raw and normalized security telemetry (Sysmon, Windows Event Logs, network flows, firewall, authentication, web proxy).
- **DetectionRule** (`app/core/models/detection.ts`): *What is suspicious according to a rule* — deterministic pattern matching logic.
- **Alert** (`app/core/models/detection.ts`): *A rule detected suspicious activity* — automated notification tied to source event(s).
- **Incident** (`app/core/models/incident.ts`): *Correlated security activity* — attack progression grouping related alerts and events across entities.
- **Threat Hunt** (`app/core/models/hunting.ts`): *Analyst proactively asks whether suspicious activity exists* — hypothesis-driven exploration across canonical security events, uncovering activity that may **not** have triggered an alert or incident.

```
                  [ CANONICAL TELEMETRY ]
                      SecurityEvent
                      │          │
         Automated    │          │  Analyst-Driven
         Pipeline     │          │  Pipeline
                      ▼          ▼
             DetectionRule    ThreatHuntQuery
                      ▼          ▼
                   Alert     Filter / Search / Aggregation
                      ▼          ▼
              Correlation    Hunt Results (Known vs Unknown Provenance)
                      ▼          ▼
               Incident ◄──── Investigation & Optional Link/Create
```

---

## 2. Current Architecture Inspection

### 2.1 SecurityEvent Model (`app/core/models/event.ts`)
- **Canonical Schema**: `id`, `timestamp`, `receivedAt`, `eventType`, `category` (`AUTHENTICATION` | `NETWORK` | `PROCESS` | `ENDPOINT` | `FILE` | `IDENTITY` | `SYSTEM` | `SECURITY_CONTROL`), `severity` (`CRITICAL` | `HIGH` | `MEDIUM` | `LOW` | `INFO`), `source`, `sourceType`.
- **Entity Associations**: `assetId?`, `userId?`, `incidentId?`, `iocIds?`.
- **Network Fields**: `srcIp?`, `dstIp?`, `srcPort?`, `dstPort?`, `protocol?`.
- **Process Fields**: `processName?`, `processId?`, `parentProcessName?`, `parentProcessId?`, `commandLine?`, `filePath?`, `fileHash?`.
- **Web & Identity**: `domain?`, `url?`, `httpMethod?`, `httpStatus?`.
- **Semantic Payload**: `message`, `rawPayload?`, `metadata?`, `signature?`.

### 2.2 Existing Query Capabilities
- `SecurityEventQuery`: Supports filtering by time range (`startTime`, `endTime`), `severity`, `category`, `source`, `sourceType`, `assetId`, `userId`, `incidentId`, `iocId`, `eventType`, text `search`, `limit`, `offset`, and `sortOrder`.
- **Limitations for Threat Hunting**:
  - The existing `SecurityEventQuery` is limited to exact equality or substring search.
  - It lacks structured multi-field relational operators (`contains`, `startsWith`, `endsWith`, `in`, `notIn`, `greaterThan`, `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual`).
  - It lacks deterministic aggregations (by asset, user, source IP, dest IP, domain, process, event type, severity, over time).
  - It lacks match explainability (`MATCHED BECAUSE: ...`).
  - It does not retain hunt query session metadata, notes, tags, or execution state.

### 2.3 IndexedDB Layer (`app/core/storage/idb-store.ts`)
- **Current DB Version**: `4` (`es-spatial-db`).
- **Existing Stores**:
  - `incidents` (indices: `by_status`, `by_severity`, `by_createdAt`)
  - `events` (indices: `by_timestamp`, `by_severity`, `by_category`, `by_asset`, `by_incident`)
  - `alerts` (indices: `by_ruleId`, `by_severity`, `by_status`, `by_asset`, `by_incident`, `by_createdAt`, `by_fingerprint`)
  - `assets`, `users`, `iocs`, `response_actions`, `audit_records`, `meta`.
- **Required Upgrade (v4 → v5)**:
  - Add object store `threat_hunts` (keyPath `'id'`, indices: `by_status`, `by_createdAt`, `by_createdBy`).
  - Update `resetLocalData()` to clear `threat_hunts`.
  - Non-destructive sequential migration preserving all user and seed data.

### 2.4 Existing Investigation System (`app/spatial/investigation/`)
- `InvestigationContext.tsx`, `investigation-state.ts`, `InvestigationHub.tsx`.
- Provides views: `ATTACK`, `TIMELINE`, `MITRE`, `SYSTEMS`, `IOCs`, `REPLAY`, `RESPONSE`.
- Reusable choreography and entity selection bridges.
- **Integration**: Selected hunt results can immediately transition to the spatial investigation hub, revealing surrounding timeline events, asset posture, and IOC connections.

### 2.5 Access Control (RBAC) & Audit Logging
- Roles defined in `app/core/auth/rbac.ts` and `app/core/models/auth.ts`:
  - `L1_ANALYST`: `THREAT_HUNT_READ`
  - `L2_ANALYST`: `THREAT_HUNT_READ`, `THREAT_HUNT_EXECUTE` (update definition to allow hunting workflows)
  - `THREAT_HUNTER`: Full hunting capabilities (`THREAT_HUNT_READ`, `THREAT_HUNT_EXECUTE`, `INCIDENT_INVESTIGATE`)
  - `SOC_MANAGER`, `PLATFORM_ADMIN`: Full permissions
- Audit log store `audit_records` in IndexedDB tracks significant security actions without creating noise.

---

## 3. Reusable Infrastructure vs. Missing Capabilities

| System Component | Current State | Reusable As-Is? | Changes / Additions Required |
| :--- | :--- | :---: | :--- |
| **SecurityEvent Data** | 22+ canonical events in IDB | **Yes** | None; all queries run against canonical telemetry |
| **Alert & Incident Stores** | Persisted in IDB | **Yes** | Used to determine result provenance (KNOWN vs UNKNOWN) |
| **Incident Creation** | Step 4 canonical API | **Yes** | Reused for controlled workflow ("Create Incident from Selected Evidence") |
| **Attach Event to Incident**| `attachEventToIncident()` | **Yes** | Reused for controlled workflow ("Link to Existing Incident") |
| **Threat Hunt Domain Model**| None | **No** | Create `ThreatHunt`, `ThreatHuntQuery`, `ThreatHuntResult`, `ThreatHuntAggregation` in `app/core/models/hunting.ts` |
| **Hunt Execution Engine** | None | **No** | Create `app/core/hunting/threat-hunt-engine.ts` with safe typed operators |
| **Hunt Persistence** | None | **No** | IDB schema v5: `threat_hunts` store |
| **Hunt Aggregations** | None | **No** | Deterministic aggregation calculation (by asset, user, process, IP, etc.) |
| **Hunt Templates** | None | **No** | 8 deterministic templates targeting actual Operation BlackTide telemetry |
| **Spatial Hunting UI** | None | **No** | Create `app/spatial/hunting/ThreatHuntingWorkspace.tsx` + integration into Command Center |

---

## 4. Proposed Integration Points

1. **Core Domain Layer (`app/core/models/hunting.ts` & `index.ts`)**:
   - Canonical `ThreatHunt` entity with status `DRAFT` | `RUNNING` | `COMPLETED` | `ARCHIVED`.
   - `ThreatHuntQuery` with structured criteria and typed operator evaluation.
   - `ThreatHuntResult` with provenance (`isKnown`, `alertIds`, `incidentId`) and deterministic explanation.
   - `ThreatHuntAggregation` containing multi-dimensional breakdowns.

2. **Storage Layer (`app/core/storage/idb-store.ts`)**:
   - `DB_VERSION = 5` with sequential migration for store `threat_hunts`.
   - Meta flag `META_HUNTS_SEEDED` for baseline hunt examples.

3. **Engine Layer (`app/core/hunting/threat-hunt-engine.ts`)**:
   - Safe expression evaluation: `equals`, `notEquals`, `contains`, `startsWith`, `endsWith`, `in`, `notIn`, `greaterThan`, `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual`.
   - Zero dynamic code execution (`eval` and `Function` strictly forbidden).
   - Generates human-readable explanation strings ("MATCHED BECAUSE: ...").

4. **Service Layer (`app/core/providers/` & `app/core/security-service.ts`)**:
   - New APIs: `runThreatHunt()`, `getThreatHunts()`, `getThreatHunt()`, `createThreatHunt()`, `updateThreatHunt()`, `archiveThreatHunt()`, `linkHuntEventsToIncident()`, `createIncidentFromHunt()`.
   - Event emissions: `THREAT_HUNT_CREATED`, `THREAT_HUNT_UPDATED`, `THREAT_HUNT_EXECUTED`.

5. **Spatial Layer (`app/spatial/hunting/ThreatHuntingWorkspace.tsx`)**:
   - Spatial Hunt workspace with Query Builder (left), Result Constellation / Event Field (center), Hunt Inspector (right), and Result Timeline (bottom).
   - Graceful performance degradation (`FULL`, `REDUCED`, `LOW`).
   - Single RAF and single MediaPipe instance preserved.
   - Command Center HUD entry point for immediate operational access.

---

## 5. Persistence Requirements & Integrity

- **No Duplicated Event Data**: Saved hunts persist query specifications, metadata, notes, tags, result counts, and matched event IDs — **never** duplicate copies of event objects.
- **Dynamic Re-execution**: Reopening a saved hunt evaluates the stored query against current canonical events in IndexedDB.
- **Audit Logging**: Meaningful actions (hunt created, executed, saved, archived, evidence linked, incident created) append to canonical audit records.

---

## 6. Performance Considerations

- **Bounded Rendering**: Center field limits rendered 3D spatial nodes to the top $N$ results (e.g. 100 max) with pagination, preventing frame drops.
- **Graceful Degradation**: In `LOW` mode, visual glow and particle nodes are disabled, showing high-contrast flat nodes while preserving query power.
- **Single Pass Aggregations**: Aggregations are calculated in a single deterministic scan over matched results without reloading the database.
- **Offline Guarantee**: 100% local IndexedDB and in-memory evaluation. Zero network requests (`fetch()`, cloud APIs).

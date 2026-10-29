# EXPLAIN-SEC SPATIAL — STEP 5: THREAT HUNTING ENGINE

**Specification & Verification Report**  
**Version:** 1.0.0 (Offline-First Spatial SOC)  
**Date:** 2026-09-22  
**Status:** Step 5 Complete & Verified  

---

## 1. Architectural Overview & Operating Model

Step 5 introduces a real, offline **Threat Hunting Engine** into EXPLAIN-SEC SPATIAL. Threat hunting allows an analyst to proactively investigate security activity that may **not** have already generated an alert or incident:

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

### Core Separation of Concerns
1. **SecurityEvent** (`app/core/models/event.ts`): Raw and normalized security telemetry (*what happened*).
2. **DetectionRule** (`app/core/models/detection.ts`): Predicate rules defining known suspicious activity (*what is suspicious*).
3. **Alert** (`app/core/models/detection.ts`): Automated trigger notifying that a detection rule matched (*rule detected suspicious activity*).
4. **Incident** (`app/core/models/incident.ts`): Correlated attack campaign grouping related alerts and events across entities (*correlated security activity*).
5. **Threat Hunt** (`app/core/models/hunting.ts`): Proactive analyst query session (*analyst asks whether suspicious or unalerted activity exists*).

Threat hunting is **not** an incident filter. It operates directly across canonical `SecurityEvent` records, uncovering novel activity before or outside detection boundaries.

---

## 2. Canonical Threat Hunt Domain Models

Located in `app/core/models/hunting.ts` and re-exported through `app/core/models/index.ts`:

### 2.1 Status & Predicates
```typescript
export type ThreatHuntStatus = 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'ARCHIVED';

export type QueryOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'in'
  | 'notIn'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual';

export interface HuntFilterCondition {
  field: keyof SecurityEvent | string;
  operator: QueryOperator;
  value: string | number | boolean | string[] | number[];
}
```

### 2.2 Structured Query Model
```typescript
export interface ThreatHuntQuery {
  startTime?: string;
  endTime?: string;
  eventTypes?: string[];
  categories?: EventCategory[];
  severities?: EventSeverity[];
  assetIds?: string[];
  userIds?: string[];
  incidentIds?: string[];
  alertIds?: string[];
  sourceIps?: string[];
  destinationIps?: string[];
  domains?: string[];
  urls?: string[];
  processes?: string[];
  commandLines?: string[];
  hashes?: string[];
  protocols?: string[];
  ports?: number[];
  mitreTechniqueIds?: string[];
  text?: string;
  conditions?: HuntFilterCondition[];
  limit?: number;
  offset?: number;
  sortOrder?: 'ASC' | 'DESC';
}
```

### 2.3 Result Provenance & Explainability
```typescript
export interface ThreatHuntResult {
  eventId: string;
  event: SecurityEvent;
  timestamp: string;
  eventType: string;
  severity: EventSeverity;
  category: EventCategory;
  assetId?: string;
  userId?: string;
  source: string;
  srcIp?: string;
  dstIp?: string;
  processName?: string;
  commandLine?: string;
  domain?: string;
  iocIds?: string[];
  isKnown: boolean; // true if already tied to an alert or incident
  relatedAlertIds: string[];
  relatedIncidentId?: string;
  mitreTechniqueId?: string;
  explanation: string; // "MATCHED BECAUSE: ..."
}
```

### 2.4 Saved ThreatHunt Entity
```typescript
export interface ThreatHunt {
  id: string;
  name: string;
  description: string;
  status: ThreatHuntStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  query: ThreatHuntQuery;
  resultCount: number;
  matchedEventIds: string[];
  relatedAlertIds: string[];
  relatedIncidentIds: string[];
  tags: string[];
  notes?: string;
  lastExecutedAt?: string;
}
```

---

## 3. Safe Query Operators & Engine Execution

Located in `app/core/hunting/threat-hunt-engine.ts`:

- **Zero Dynamic Code Execution**: `eval()` and `Function()` are strictly forbidden. All operators are explicitly typed and evaluated with safe comparisons:
  - `equals` / `notEquals`: Case-insensitive string comparison, strict numeric/boolean comparison.
  - `contains`: Substring match or array element membership.
  - `startsWith` / `endsWith`: Prefix / suffix string checking.
  - `in` / `notIn`: Case-insensitive array membership testing.
  - `greaterThan` / `lessThan` / `greaterThanOrEqual` / `lessThanOrEqual`: Numeric or ISO 8601 timestamp range comparisons.
- **Explainability**: Builds deterministic rationale strings for every matched event:
  `MATCHED BECAUSE: [category == "PROCESS"] AND [commandLine contains "powershell"]`
- **Deterministic Aggregations**:
  - `byAsset`: Top assets with event counts.
  - `byUser`: Top users with event counts.
  - `bySourceIp` / `byDestinationIp`: Top network nodes.
  - `byProcess`: Top process executables.
  - `byEventType`: Frequency breakdown.
  - `bySeverity` & `byCategory`: Distribution maps.
  - `overTime`: Chronological time buckets.
  - `knownCount` vs `unknownCount`: Ratio of known alerted/correlated events vs novel unalerted events.

---

## 4. Operation BlackTide Telemetry Hunt Templates

8 deterministic offline templates matching the actual telemetry in `SEED_SECURITY_EVENTS` and simulation streams:

1. **Suspicious PowerShell Execution**: Investigates `powershell.exe`, `pwsh.exe`, `cmd.exe`, `svchost32.exe` execution under user sessions.
2. **Repeated Authentication Failures**: Targets `AUTH_BRUTE_FORCE`, `KERBEROS_TGS_REQUEST`, and unusual logons.
3. **Privilege Escalation Activity**: Identifies `PROCESS_ACCESS_LSASS`, `ACL_REPLICATION_GRANT` (DCSync), and Kerberos ticket requests.
4. **Unusual Outbound C2 Beacons**: Finds periodic outbound network flows on ports 443, 8080, 8443, 9001.
5. **IOC-Related Activity**: Queries telemetry containing recognized Indicator of Compromise (IOC) IDs.
6. **Lateral Movement Indicators**: Detects `SMB_LOGON_SUCCESS`, `SMB_SESSION_CONNECT`, and high-volume LDAP query enumeration.
7. **Suspicious Process Lineage**: Detects anomalous binaries (`svchost32.exe`, `vssadmin.exe`, `certutil.exe`) launched from user temp folders or PDF readers.
8. **High-Severity Events Without Incidents**: Surfaces unassigned CRITICAL or HIGH events that bypassed automated correlation.

---

## 5. Storage Layer & IndexedDB Schema v5 Migration

In `app/core/storage/idb-store.ts`:
- Upgraded `DB_VERSION` from `4` to `5`.
- Added sequential migration:
  ```typescript
  case oldVersion < 5: {
    if (!db.objectStoreNames.contains('threat_hunts')) {
      const huntStore = db.createObjectStore('threat_hunts', { keyPath: 'id' });
      huntStore.createIndex('by_status', 'status');
      huntStore.createIndex('by_createdAt', 'createdAt');
      huntStore.createIndex('by_createdBy', 'createdBy');
    }
    break;
  }
  ```
- Added `META_HUNTS_SEEDED = 'hunts_seeded'` flag.
- Added `'threat_hunts'` to `resetLocalData()`.
- **Integrity Guarantee**: Non-destructive upgrade preserves all existing incidents, alerts, events, assets, and audit logs.
- **Zero Event Duplication**: Saved hunts store query parameters, metadata, notes, tags, result counts, and matched event IDs — **never** copies of event payloads. Reopening re-queries canonical events.

---

## 6. SecurityService Facade & RBAC

All interaction from the UI flows through `securityService`:

### APIs Exposed
- `securityService.runThreatHunt(query: ThreatHuntQuery): Promise<ThreatHuntExecutionResult>`
- `securityService.getThreatHunts(): Promise<ThreatHunt[]>`
- `securityService.getThreatHuntById(id: string): Promise<ThreatHunt | null>`
- `securityService.createThreatHunt(input: CreateThreatHuntInput): Promise<ThreatHunt>`
- `securityService.updateThreatHunt(id: string, updates: Partial<ThreatHunt>): Promise<ThreatHunt>`
- `securityService.archiveThreatHunt(id: string): Promise<ThreatHunt>`
- `securityService.linkHuntEventsToIncident(incidentId: string, eventIds: string[]): Promise<Incident>`
- `securityService.createIncidentFromHunt(input: CreateIncidentFromHuntInput): Promise<Incident>`
- `securityService.getThreatHuntTemplates(): ThreatHuntTemplate[]`

### Reactive Events Emitted
- `THREAT_HUNT_CREATED`
- `THREAT_HUNT_UPDATED`
- `THREAT_HUNT_EXECUTED`

### RBAC Matrix
- `THREAT_HUNTER`, `SOC_MANAGER`, `PLATFORM_ADMIN`: Full hunting capabilities (execute, query, save, update, archive, investigate).
- `L2_ANALYST`: Execute queries, save hunts, link evidence, add notes/tags.
- `L1_ANALYST`: Query and inspect results (`THREAT_HUNT_READ`).
- `INCIDENT_RESPONDER`: Inspect findings; containment remains through authorized SOAR response mechanisms.

### Audit Logging
Meaningful actions are logged to `audit_records` in IndexedDB:
- `THREAT_HUNT_CREATED`
- `THREAT_HUNT_EXECUTED`
- `THREAT_HUNT_UPDATED`
- `THREAT_HUNT_ARCHIVED`
- `THREAT_HUNT_EVIDENCE_LINKED`
- `THREAT_HUNT_INCIDENT_CREATED`

---

## 7. Spatial Threat Hunting Operating Environment

Located in `app/spatial/hunting/ThreatHuntingWorkspace.tsx` and `threat-hunting.css`:

### 7.1 Layout Architecture
- **LEFT (Primary Query & Templates)**:
  - BlackTide template cards with active selection indicators.
  - Multi-parameter criteria (category, severity, process, IP, free text, time range).
  - Saved Hunts notebook drawer with recent history.
  - "RUN HUNT" button displaying asynchronous pipeline states:
    `QUERYING` $\to$ `FILTERING` $\to$ `AGGREGATING` $\to$ `READY`.
  - "SAVE" button opening modal to persist hunt notebook.
- **CENTER (Event Constellation Field)**:
  - 2.5D spatial node cloud positioned deterministically across coordinate axes.
  - Color-coding by severity: CRITICAL (`#ff2a2a`), HIGH (`#ff7700`), MEDIUM (`#ffb700`), LOW (`#00f0ff`), INFO (`#3dffb0`).
  - Provenance halos: Gold halo for UNKNOWN/NOVEL events; Cyan/Green halo for KNOWN events.
  - Point-and-click or point+dwell node selection.
  - Performance degradation:
    - `FULL`: 80 nodes max, interactive halos, subtle animations.
    - `REDUCED`: 50 nodes max, background grid disabled, reduced glow.
    - `LOW`: 25 nodes max, zero box-shadows, high-contrast flat nodes.
- **RIGHT (Hunt Inspector)**:
  - Event ID, timestamp, category, severity, asset, user, process lineage, network parameters.
  - Telemetry message preview.
  - **Deterministic Match Rationale**: High-visibility card explaining query match.
  - **Provenance Badge**: `KNOWN EVIDENCE` vs `UNKNOWN NOVEL`.
  - Correlated Artifacts: Links to alerts and incident if correlated.
  - Actions:
    - `INVESTIGATE IN SPATIAL`: Pivots directly to Spatial Incident Universe.
    - `LINK TO INCIDENT`: Controlled workflow to link selected event to an existing incident.
    - `CREATE INCIDENT FROM EVIDENCE`: Controlled workflow to create a new incident from selected evidence using the canonical Step 4 engine.
- **BOTTOM (Timeline & Aggregations)**:
  - Execution summary: Execution time (ms), Total Matches, Novel Discoveries.
  - Aggregation tabs: `BY ASSET`, `BY USER`, `BY PROCESS`, `BY IP`. Interactive aggregation chips.

### 7.2 Navigation & Command Center Integration
- In `app/spatial/command/CommandCenter.tsx`:
  Added a `THREAT HUNTING WORKSPACE [H]` KPI badge in the top operational halo.
- In `app/soc-spatial.tsx`:
  Added `THREAT HUNT [H]` spatial pill to the top floating mode bar.
- Hotkey `H` instantly switches spatial mode to `HUNTING`; `ESC` or `F` returns to Command Center.
- 0 additional RAF loops; exactly 1 MediaPipe instance preserved.

---

## 8. Verification Results

### 8.1 Automated Test Suites
Run via `npx tsx scripts/test-step5-hunting.ts`:
- **Suite 1 (Query Operators)**: 14/14 passed (equals, notEquals, contains, startsWith, endsWith, in, notIn, greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual).
- **Suite 2 (Field Value Extraction & Conditions)**: 5/5 passed (direct, nested dot-notation, missing property, condition matching).
- **Suite 3 (Structured Query Execution)**: 4/4 passed (category filtering, DESC/ASC timestamp ordering).
- **Suite 4 (Time Range Filtering)**: 2/2 passed (strict boundary adherence).
- **Suite 5 (Provenance & Match Rationale)**: 5/5 passed (KNOWN vs UNKNOWN detection, alert linkage, match explanation strings).
- **Suite 6 (Deterministic Aggregations)**: 8/8 passed (bySeverity, byCategory, byAsset, known/unknown totals).
- **Suite 7 (BlackTide Telemetry Hunt Templates)**: 8/8 passed (all 8 templates return non-zero deterministic matches against real telemetry).
- **Suite 8 (RBAC Permissions)**: 9/9 passed (THREAT_HUNTER, SOC_MANAGER, PLATFORM_ADMIN, L2_ANALYST, L1_ANALYST, INCIDENT_RESPONDER).
- **Suite 9 (Hunt Lifecycle Simulation)**: 6/6 passed (DRAFT $\to$ RUNNING $\to$ COMPLETED $\to$ ARCHIVED, query replaying).
- **Suite 10 (Controlled Evidence Linking & Incident Creation)**: 6/6 passed (link to incident, create incident from evidence).

### 8.2 TypeScript & Build Status
- `npx tsc --noEmit`: Exited 0 with **0 errors**.
- `npm run build:vercel`: Production build completed successfully in **508ms**.

---

## 9. Scope Boundaries Confirmation

The following capabilities were explicitly kept out of scope for Step 5:
- No external SIEM or cloud ingestion.
- No remote telemetry feeds or cloud AI.
- No autonomous automated response without analyst consent.
- No modification of existing MediaPipe or single RAF loop.
- No network requests (`fetch()`, Firebase).

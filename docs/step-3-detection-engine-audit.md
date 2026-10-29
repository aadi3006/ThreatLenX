# STEP 3 — DETECTION & ALERT ENGINE AUDIT

**Target:** EXPLAIN-SEC SPATIAL — Stage 0 Detection Engine Architecture Audit  
**Date:** 2026-09-21  
**Status:** Pre-Implementation Baseline Complete  
**Scope:** Offline-first detection rules, declarative rule evaluation, canonical Alert model, deduplication, alert lifecycle, IndexedDB migration (v2 → v3), and SOC Command Center integration.

---

## 1. Existing Architecture & Telemetry Baseline

### 1.1 Step 2 Telemetry Baseline
In Step 2, the canonical `SecurityEvent` engine was established:
- **Canonical Model:** Defined in `app/core/models/event.ts` (`SecurityEvent`).
- **Storage:** Stored in IndexedDB `'events'` store (`keyPath: 'id'`) with indices for `by_timestamp`, `by_severity`, `by_category`, `by_asset`, and `by_incident`.
- **Normalization & Validation:** Located in `app/core/security/event-engine.ts`.
- **Seed Telemetry:** 22 rich canonical events in `app/core/data/seed-events.ts` covering initial delivery, execution on FINWS-027, C2 beacons, credential dumping, lateral movement, database exfiltration, and background enterprise noise.
- **Provider & Facade:** Accessible via `LocalProvider` and `SecurityService` (`getEvents()`, `queryEvents()`, `ingestEvent()`).

### 1.2 Existing Alert-Like Concepts
Prior to Step 3, alerts existed only as an ungrounded abstraction:
1. `app/core/models/alert.ts`: Contained a legacy stub interface `Alert` with basic fields (`id`, `ruleId`, `ruleName`, `title`, `severity`, `timestamp`, `source`, `assetId`, `userId`, `category`), but **no persistence**, **no rule engine**, and **no lifecycle**.
2. `Incident.correlationChain`: In `app/core/models/incident.ts`, incidents reference `CorrelationChainItem` (`alertId`, `title`, `ruleName`, `confidence`), indicating that higher-level incidents were designed to bundle correlated alerts.
3. `threat-level-service.ts`: Computed `openAlerts` by summing the length of `incident.correlationChain` across active incidents because no authoritative Alert store existed.

### 1.3 Existing Severity Model
The project has a unified severity enum:
```typescript
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
```
Used consistently across `Incident`, `SecurityEvent`, and `ResponseAction`. Detection rules and generated Alerts must use this exact same type.

### 1.4 Existing RBAC Model
Defined in `app/core/auth/rbac.ts`:
- **Roles:** `L1_ANALYST`, `L2_ANALYST`, `INCIDENT_RESPONDER`, `THREAT_HUNTER`, `SOC_MANAGER`, `PLATFORM_ADMIN`.
- **Permissions:**
  - Alert viewing: mapped to `INCIDENT_READ` (all roles).
  - Alert acknowledgment: mapped to `INCIDENT_TRIAGE` (L1, L2, Responder, Manager, Admin).
  - Alert resolution: mapped to `INCIDENT_TRIAGE` / `CONTAINMENT_APPROVE` (L2, Responder, Manager, Admin).
  - Rule management/toggling: mapped to `CONFIG_MANAGE` or `THREAT_HUNT_EXECUTE`.

### 1.5 Existing Audit Architecture
Defined in `app/core/models/audit.ts` (`AuditRecord`):
- Actions logged to IndexedDB store `'audit_records'` (`action`, `actor`, `actorRole`, `target`, `previousState`, `resultingState`, `authorization`, `outcome`, `details`).
- State mutations (alert acknowledgment, alert resolution, alert creation) must emit corresponding audit records.

---

## 2. Required Architectural Additions for Step 3

```
+-------------------------------------------------------------------------+
|                              SOC UI LAYER                               |
|        SOC Command Center  *  Incident Universe  *  Investigation Hub   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                         SECURITY SERVICE FACADE                         |
|   getAlerts(), getOpenAlerts(), acknowledgeAlert(), resolveAlert()     |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                             LOCAL PROVIDER                              |
|   Detection Engine Evaluator  *  Deduplication  *  Alert Lifecycle      |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                         INDEXEDDB STORAGE (v3)                          |
|             'alerts' Object Store (Indices: rule, sev, status, asset)   |
+-------------------------------------------------------------------------+
```

### 2.1 Canonical Detection Rule Model (`DetectionRule`)
- Declarative rule structure avoiding `eval()` or dynamic code execution.
- Condition types:
  - `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `STARTS_WITH`, `GREATER_THAN`, `LESS_THAN`, `IN_LIST`.
- Rule categories aligned with `EventCategory` (`AUTHENTICATION`, `PROCESS`, `NETWORK`, `ENDPOINT`, `FILE`, `SECURITY_CONTROL`).
- MITRE technique mapping (`mitreTechniqueId`, `mitreTactic`).
- Deterministic initial ruleset (6–8 rules targeting Operation BlackTide events).

### 2.2 Canonical Alert Model (`Alert`)
- Properties:
  - `id`: Unique stable identifier (e.g. `alt-sec-1710000000000-abcd1234`).
  - `ruleId`: Identifier of the triggering detection rule.
  - `ruleName`: Human-readable rule title.
  - `title`: Alert title.
  - `description`: Detailed description.
  - `severity`: `Severity` ('CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO').
  - `status`: Lifecycle state ('NEW' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED').
  - `category`: Event category.
  - `createdAt`: ISO UTC timestamp.
  - `firstSeenAt`: First occurrence timestamp.
  - `lastSeenAt`: Most recent occurrence timestamp.
  - `occurrenceCount`: Number of matched events collapsed into this alert.
  - `sourceEventIds`: Array of contributing `SecurityEvent.id`s.
  - `primaryEventId`: The initial triggering event ID.
  - `assetId`: Target or originating asset.
  - `userId`: Target or originating user.
  - `iocIds`: Matched threat indicators.
  - `mitreTechniqueId`: Associated MITRE technique ID (e.g. `T1059.001`).
  - `incidentId`: Optional association with an existing incident.
  - `fingerprint`: Deterministic signature for deduplication and throttling.

### 2.3 Alert Deduplication & Throttling
- Deterministic fingerprint:
  $$\text{Fingerprint} = \text{hash}(\text{ruleId} \mid \text{assetId} \mid \text{userId} \mid \text{timeBucket})$$
- If an existing active alert (`NEW` or `ACKNOWLEDGED`) with the same fingerprint exists within the throttling window (e.g. 15 minutes):
  - Do not create a new alert record.
  - Update existing alert's `lastSeenAt = event.timestamp`.
  - Increment `occurrenceCount += 1`.
  - Append `event.id` to `sourceEventIds`.

### 2.4 IndexedDB Schema Migration (v2 → v3)
- Increment `DB_VERSION = 3` in `idb-store.ts`.
- Non-destructive `case oldVersion < 3`:
  - Create `'alerts'` object store with `keyPath: 'id'`.
  - Create indices: `by_ruleId`, `by_severity`, `by_status`, `by_asset`, `by_incident`, `by_createdAt`, `by_fingerprint`.
  - Add meta flag `META_ALERTS_SEEDED = 'alerts_seeded'`.
- Zero data loss for existing stores (`incidents`, `assets`, `users`, `iocs`, `response_actions`, `audit_records`, `events`, `meta`).

### 2.5 Command Center & Investigation Integration
- **Command Center KPI Halo:** Connect `openAlerts`, `criticalAlerts`, `highAlerts` to real canonical `Alert` data.
- **Alert Stream Drawer / Flank:** Allow analysts to inspect real alerts, review source events, and change status (`ACKNOWLEDGE`, `RESOLVE`).
- **Investigation Navigation:** Selecting an alert allows navigating directly into the affected asset and incident using the existing spatial investigation state machine (`PROXIMITY` → `FOCUSING` → `INVESTIGATION_OPEN`).

---

## 3. Migration Safety Checklist
- [x] No schema resets: `DB_VERSION = 3` must additively create `'alerts'` store without modifying prior stores.
- [x] No `fetch()` or external APIs: Detection and alerting remain 100% offline.
- [x] No duplicate RAF loops or vision instances: Detection runs asynchronously on event ingestion.
- [x] No UI → IndexedDB bypass: All alert reading and mutations flow through `SecurityService` → `LocalProvider` → `IndexedDB`.
- [x] RBAC enforcement on all alert mutations.

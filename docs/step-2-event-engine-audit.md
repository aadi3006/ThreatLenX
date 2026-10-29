# EXPLAIN-SEC SPATIAL — Stage 0 Architecture Audit (Step 2 Security Event Engine)

**Document:** `docs/step-2-event-engine-audit.md`  
**Date:** September 2026  
**System:** EXPLAIN-SEC SPATIAL — Offline-First Spatial SOC  
**Target Milestone:** STEP 2 — Security Event Engine  

---

## 1. Executive Summary & Context

Step 1 established the spatial-native **SOC Command Center**, providing real-time situational awareness (threat score, active incidents, asset posture, SOAR pipeline, and a live activity stream).

The objective of **Step 2** is to build the foundational **Security Event Engine** underneath the Command Center and the spatial investigation system. This engine serves as the canonical telemetry pipeline for raw/normalized security telemetry (Sysmon, Windows Security, Firewall, Network Flow, Proxy/DNS, Endpoint), bridging the gap between raw machine telemetry and higher-order security constructs (incidents, alerts, attack graphs).

### Core Principle:
$$\text{Raw Telemetry} \xrightarrow{\text{Normalize \& Deduplicate}} \text{SecurityEvent (Telemetry)} \xrightarrow{\text{Contributes To}} \text{Incident / Timeline (Milestones)}$$

---

## 2. Audit of Existing Architecture

### 2.1 Current Event & Activity Types

Currently, the system contains two distinct "event-like" constructs, neither of which is a canonical raw/normalized security event engine:

1. **`TimelineEvent` (`app/core/models/incident.ts`)**:
   - High-level analytical milestones attached to an `Incident` (`incident.timelineEvents: TimelineEvent[]`).
   - Fields: `id`, `timestamp`, `title`, `stage` (MITRE stage: `INITIAL_ACCESS`, `EXECUTION`, etc.), `severity`, `description`, `entityId`, `entityType` (`ASSET` | `USER` | `IOC` | `PROCESS`), `techniqueId`, `metadata`.
   - Role: Used by `SpatialTimeline` and `AttackReplay` to represent curated kill-chain milestones.
   - Limitation: It is an incident milestone, not raw telemetry. Cannot model high-volume streaming telemetry, benign background traffic, or multi-event correlation.

2. **`AuditRecord` (`app/core/models/audit.ts`)**:
   - Represents analyst and system actions within the SOC (`actor`, `actorRole`, `action`, `target`, `outcome`, `authorization`, `details`).
   - Persisted in IndexedDB `audit_records` store.
   - Role: Compliance, accountability, and tracking SOAR executions / incident creation.
   - Limitation: Tracks human/system governance actions, not machine security events.

3. **`CorrelationChainItem` (`app/core/models/incident.ts`)**:
   - Models detection alert items correlated into an incident (`alertId`, `ruleName`, `confidence`, `evidenceSummary`).

### 2.2 Current Persistence Capabilities (`app/core/storage/idb-store.ts`)

- **Database Name**: `es-spatial-db`
- **Schema Version**: `DB_VERSION = 1`
- **Current Object Stores**:
  - `incidents` (keyPath: `id`)
  - `assets` (keyPath: `id`)
  - `users` (keyPath: `id`)
  - `iocs` (keyPath: `id`)
  - `response_actions` (keyPath: `id`)
  - `audit_records` (keyPath: `id`)
  - `meta` (keyPath: `key`)
- **Limitation**: There is **no dedicated store** for security telemetry events (`events`).

### 2.3 Existing `SecurityService` & Provider Surface

- `SecurityService` acts as the singleton application facade.
- Current methods cover: authentication/session, incidents (`getIncidents`, `getIncidentById`, `createIncident`, `updateIncidentStatus`, `escalateIncident`, `addEvidence`), investigation artifacts (`getAttackGraph`, `getSystemRadar`, `getTimeline`, `getIocConstellation`, `getMitreMatrix`), entity queries (`getAssets`, `getUsers`, `getIOCs`), audit logs (`getAuditLogs`), response actions (`getResponseActions`, `requestResponseAction`, `approveResponseAction`, `executeResponseAction`), and scenarios (`getAvailableScenarios`, `loadScenario`, `stepScenario`, `resetScenario`).
- **Limitation**: Zero event ingestion, zero event querying, zero event filtering, and zero event subscription methods.

### 2.4 Relationships Between Entities

```
┌─────────────────────────────────────────────────────────────┐
│                         Incident                            │
│  - affectedAssets: string[] (Asset IDs)                     │
│  - affectedUsers:  string[] (User IDs)                      │
│  - iocs:           string[] (IOC IDs)                       │
│  - mitreTechniques:string[] (e.g. 'T1078.002')              │
│  - timelineEvents: TimelineEvent[]                          │
│  - correlationChain: CorrelationChainItem[]                 │
└─────────────────────────────────────────────────────────────┘
          ▲                   ▲                   ▲
          │                   │                   │
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│      Asset       │ │   SecurityUser   │ │       IOC        │
│ id: 'asset-001'  │ │ id: 'user-001'   │ │ id: 'ioc-001'    │
│ name: FINWS-027  │ │ user: r.morrison │ │ ip: 185.220...   │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## 3. Required Changes for Step 2

### 3.1 Canonical `SecurityEvent` Model (`app/core/models/event.ts`)

Create a canonical, extensible model supporting:
- Core identity: `id` (deterministic / UUID), `timestamp` (ISO 8601), `receivedAt`.
- Categorization & Classification: `eventType`, `category` (`AUTHENTICATION`, `NETWORK`, `PROCESS`, `FILE`, `ENDPOINT`, `SYSTEM`, `SECURITY_CONTROL`), `severity` (`INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- Origin: `source` (e.g. `Sysmon`, `Suricata`, `WindowsSecurity`, `PaloAltoFW`, `CrowdStrike`, `Simulator`), `sourceType` (`ENDPOINT`, `FIREWALL`, `AUTH`, `DNS`, `PROXY`, `APPLICATION`, `SYSTEM`).
- Entity Associations: `assetId?`, `userId?`, `incidentId?`, `iocIds?: string[]`.
- Technical Network Attributes: `srcIp?`, `dstIp?`, `srcPort?`, `dstPort?`, `protocol?`.
- Technical Process & Host Attributes: `processName?`, `processId?`, `parentProcessName?`, `commandLine?`, `fileHash?`, `filePath?`.
- Web / Domain Attributes: `domain?`, `url?`, `httpMethod?`, `httpStatus?`.
- Human-Readable Message & Extensibility: `message`, `metadata?: Record<string, unknown>`.

### 3.2 Event Normalization & Validation Layer (`app/core/security/event-normalizer.ts`)

- Ingest raw local / simulated payloads.
- Strictly validate mandatory fields (`timestamp`, `eventType`, `category`, `severity`, `source`).
- Validate entity references against registered assets, users, and incidents.
- Deduplication: Calculate deterministic event signature (hash of `timestamp + source + eventType + assetId + srcIp + dstIp + processName`) to reject or idempotent-update exact duplicates.

### 3.3 Database Migration: Schema v1 $\to$ Schema v2 (`app/core/storage/idb-store.ts`)

- Upgrade `DB_VERSION = 2`.
- In `onupgradeneeded`:
  ```ts
  case oldVersion < 2: {
    const eventStore = db.createObjectStore('events', { keyPath: 'id' });
    eventStore.createIndex('by_timestamp', 'timestamp');
    eventStore.createIndex('by_severity', 'severity');
    eventStore.createIndex('by_category', 'category');
    eventStore.createIndex('by_asset', 'assetId');
    eventStore.createIndex('by_incident', 'incidentId');
    break;
  }
  ```
- **Zero data loss**: Preserves existing `incidents`, `assets`, `users`, `iocs`, `response_actions`, `audit_records`, and `meta`.

### 3.4 Seed Telemetry Expansion (`app/core/data/seed-events.ts`)

- Construct a realistic dataset of canonical `SecurityEvent` records for **Operation BlackTide**:
  - Initial spearphishing email & payload drop on `FINWS-027`.
  - Process execution (`svchost32.exe`, `AcroRd32.exe`).
  - Network C2 beacons to `185.220.101.47` and DNS queries to `c2-pool.blacktide-ops.net`.
  - LSASS credential dumping & Kerberos ticket requests.
  - SMB lateral movement to Domain Controller `FINDC-001`.
  - Active Directory LDAP enumeration and replication rights modification.
  - SMB connection to `BACKUP-NAS-01`, shadow copy deletion, and mass file encryption.
  - Plus benign background events (regular NTP, DNS, benign authentication) to provide real SOC telemetry contrast.

### 3.5 Provider & Service API Extensions

- `ISecurityProvider` / `LocalProvider`:
  - `getEvents(query?: SecurityEventQuery): Promise<SecurityEvent[]>`
  - `getEventById(id: string): Promise<SecurityEvent | null>`
  - `ingestEvent(event: SecurityEventInput, actor?: string): Promise<IngestEventResult>`
  - `ingestEvents(events: SecurityEventInput[], actor?: string): Promise<IngestEventResult[]>`
  - `getEventStats(): Promise<SecurityEventStats>`
- `SecurityService`:
  - Facade methods matching the above plus helper query methods:
    `getEventsForIncident(incidentId)`, `getEventsForAsset(assetId)`, `getEventsForUser(userId)`, `getEventsForIOC(iocId)`, `getRecentEvents(limit)`.
  - Event pub/sub: `subscribeToEvents(listener)`, emitting `'EVENT_INGESTED'` and updating derived SOC metrics.
- RBAC validation: Read permissions for viewing events; `ANALYST` or higher for ingestion.

### 3.6 Command Center & Spatial Integration

- Update `CommandCenter.tsx`:
  - Replace the mixed activity view with a dedicated, real-time `SecurityEvent` stream powered by `securityService.getEvents({ limit: 50 })`.
  - Add event statistics counters (total events, events by category, critical/high event counts).
- Connect incident investigation view so selecting an incident filters canonical events associated with `incident.id`.

---

## 4. Migration & Compatibility Strategy

1. Existing `TimelineEvent` records on `Incident` remain intact for spatial timeline and replay visualization.
2. In addition, each timeline milestone correlates to underlying raw `SecurityEvent` IDs via `metadata.securityEventIds` or `event.incidentId`.
3. In-flight and stored incidents remain untouched; no breaking schema change for existing stores.
4. Schema version 1 safely upgrades to schema version 2 in IndexedDB on first load.

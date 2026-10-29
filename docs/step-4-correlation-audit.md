# EXPLAIN-SEC SPATIAL — STEP 4 CORRELATION & INCIDENT CREATION ENGINE AUDIT

**Date:** 2026-09-21  
**Status:** Stage 0 Architecture Audit Complete  
**Scope:** Offline-first Correlation & Incident Creation Engine  

---

## 1. Executive Summary

This pre-implementation audit examines the current architectural state of EXPLAIN-SEC SPATIAL across all data layers, persistence contracts, domain models, and visualization modules to establish the baseline for **Step 4: Correlation & Incident Creation Engine**.

### Core Guiding Principle
- **Step 2 (Events)**: *"What happened?"* → `SecurityEvent` (canonical telemetry)
- **Step 3 (Detections & Alerts)**: *"Is it suspicious?"* → `DetectionRule` & `Alert` (deterministic single-event detections)
- **Step 4 (Correlation & Incidents)**: *"Are these detections part of the same attack?"* → `CorrelationEngine` & `Incident`

Crucially:
- **An Alert is NOT an Incident**.
- **An Incident is NOT a single event or single alert**.
- Incidents must group related events and alerts based on deterministic, explainable correlation signals (same asset, same user, shared IOC, temporal proximity, MITRE kill-chain progression).

---

## 2. Existing Systems Inspection

### 2.1 SecurityEvent Telemetry Architecture (Step 2)
- **Model**: `app/core/models/event.ts`
- **Fields**: `id`, `timestamp`, `receivedAt`, `eventType`, `category` (`AUTHENTICATION` | `PROCESS` | `NETWORK` | `ENDPOINT` | `FILE` | `SECURITY_CONTROL` | `IDENTITY` | `SYSTEM`), `severity`, `source`, `sourceType`, `assetId?`, `userId?`, `incidentId?`, `iocIds?`, `processName?`, `commandLine?`, `srcIp?`, `dstIp?`, `dstPort?`, `protocol?`, `domain?`, `fileHash?`, `signature?`, `metadata?`.
- **IndexedDB**: Object store `'events'` with indices `by_timestamp`, `by_severity`, `by_category`, `by_asset`, `by_incident`.
- **Seed Telemetry**: `SEED_SECURITY_EVENTS` (22 events) in `app/core/data/seed-events.ts`.

### 2.2 Alert & Detection Engine Architecture (Step 3)
- **Model**: `app/core/models/detection.ts`
- **Fields**: `id`, `ruleId`, `ruleName`, `fingerprint`, `title`, `description`, `severity`, `status` (`NEW` | `ACKNOWLEDGED` | `RESOLVED` | `SUPPRESSED`), `category`, `createdAt`, `firstSeenAt`, `lastSeenAt`, `occurrenceCount`, `sourceEventIds: string[]`, `primaryEventId?`, `assetId?`, `userId?`, `iocIds?`, `mitreTechniqueId?`, `incidentId?`, `metadata?`.
- **IndexedDB**: Object store `'alerts'` with indices `by_ruleId`, `by_severity`, `by_status`, `by_asset`, `by_incident`, `by_createdAt`, `by_fingerprint`.
- **Deduplication**: Hash of `ruleId|assetId|userId|eventType|ioc|timeBucket(15m)`.

### 2.3 Existing Incident Model
- **Model**: `app/core/models/incident.ts`
- **Existing Fields**:
  - `id: string` (e.g. `'incident-001'`)
  - `title: string`
  - `severity: Severity` (`CRITICAL` | `HIGH` | `MEDIUM` | `LOW` | `INFO`)
  - `riskScore: number` (0.0 - 100.0)
  - `status: IncidentStatus` (`NEW` | `TRIAGED` | `INVESTIGATING` | `CONTAINING` | `RESOLVED` | `CLOSED` | `FALSE_POSITIVE`)
  - `confidence: number` (0.0 - 1.0)
  - `createdAt: string`
  - `updatedAt: string`
  - `assignedTo?: string`
  - `assignedRole?: string`
  - `affectedAssets: string[]`
  - `affectedUsers: string[]`
  - `iocs: string[]`
  - `mitreTechniques: string[]`
  - `timelineEvents: TimelineEvent[]`
  - `correlationChain: CorrelationChainItem[]`
  - `evidence: Evidence[]`
  - `summary?: string`
  - `attackPathId?: string`

### 2.4 Persistence Layer (IndexedDB v3)
- **Database Name**: `es-spatial-db`
- **Current Version**: `3`
- **Stores**:
  - `incidents` (keyPath `'id'`) — currently has NO indices; queries rely on in-memory array or `getAll()`.
  - `assets`, `users`, `iocs`, `response_actions`, `audit_records`, `meta`
  - `events` (with 5 indices)
  - `alerts` (with 7 indices)
- **Migration Strategy**: Version 4 will add index on `incidents` (e.g. `by_status`, `by_severity`, `by_createdAt`, `by_fingerprint`) while preserving all existing stores and data completely intact.

### 2.5 SecurityService & LocalProvider
- **Facade**: `app/core/security-service.ts` wraps `ISecurityProvider` (`LocalProvider`).
- **Incident Methods Currently Implemented**:
  - `getIncidents(): Promise<Incident[]>`
  - `getIncidentById(id: string): Promise<IncidentDetail | null>`
  - `createIncident(input, actor, actorRole): Promise<Incident>`
  - `escalateIncident(incidentId, toRole, reason, actor, actorRole): Promise<Incident>`
  - `updateIncidentStatus(incidentId, status, actor, actorRole, reason): Promise<Incident>`
  - `addEvidence(incidentId, evidence, actor): Promise<Evidence>`
  - `getAttackGraph(incidentId)`
  - `getSystemRadar(incidentId)`
  - `getTimeline(incidentId)`
  - `getIocConstellation(incidentId)`

### 2.6 Existing Operation BlackTide Data
- **Primary Incident**: `incident-001` (*Operation BlackTide — ALPHV Ransomware Compromise*).
  - Assets: `asset-001` (FINWS-027), `asset-002` (FINDC-001), `asset-004` (BACKUP-NAS-01).
  - Users: `user-001` (r.morrison), `user-002` (p.chen).
  - IOCs: `ioc-001` (185.220.101.47), `ioc-002` (c2-pool.blacktide-ops.net), `ioc-003`, `ioc-004`, `ioc-005`.
  - MITRE Techniques: `T1566.001`, `T1204.002`, `T1547.001`, `T1003.001`, `T1078.002`, `T1018`, `T1098`, `T1490`, `T1048.003`, `T1491`.
  - 10 timeline events, 4 evidence items, 4 static correlation chain items.
- **Secondary Incident**: `incident-002` (*Brute-force Attack on VPN Gateway*).
  - Asset: `asset-005` (EDGE-FW-01).

### 2.7 Spatial Investigation State Machine & Context
- `InvestigationContext.tsx`:
  - Receives `incidentId`.
  - Calls `securityService.getIncidentById(incidentId)`.
  - Loads assets, users, iocs, mitre techniques, attack graph, and response actions.
  - Reconstructs attack path from attack graph node IDs.
  - Runs choreography sequence (`FOCUSING` → `TIMELINE_ENTRY` → `GRAPH_NODES` → `GRAPH_EDGES` → `RADAR_SWEEP` → `IOC_CONSTELLATION` → `READY`).
  - Controls deterministic timeline scrubber / replay state.

### 2.8 RBAC & Auditing
- **RBAC**: `app/core/auth/rbac.ts` enforces `INCIDENT_CREATE`, `INCIDENT_TRIAGE`, `INCIDENT_INVESTIGATE`, `INCIDENT_ESCALATE`, `CONTAINMENT_REQUEST`, `CONTAINMENT_APPROVE`, `SOAR_EXECUTE`, `THREAT_HUNT_EXECUTE`, `CONFIG_MANAGE`.
- **System Actions**: The automated correlation engine acts as `SYSTEM_CORRELATION_ENGINE` or `DETECTION_ENGINE` with role `SYSTEM`.
- **Audit Actions**:
  - Existing: `INCIDENT_CREATED`, `INCIDENT_ESCALATED`, `INCIDENT_STATUS_UPDATED`, `ALERT_GENERATED`, `ALERT_ACKNOWLEDGED`, `ALERT_RESOLVED`.
  - To Add for Step 4: `INCIDENT_AUTOMATICALLY_CORRELATED`, `INCIDENT_CORRELATION_UPDATED`, `ALERT_ATTACHED_TO_INCIDENT`, `EVENT_ATTACHED_TO_INCIDENT`.

---

## 3. Findings & Answers to Required Questions

### 1. How are incidents currently created?
- Manually via `securityService.createIncident(input)` or loaded via `loadScenario()`.
- Initialized with status `'NEW'`, an initial timeline event, and empty correlation chain.
- No automatic generation from events or alerts exists yet.

### 2. Which incident fields already exist?
- Identity & Status: `id`, `title`, `severity`, `riskScore`, `status`, `confidence`, `createdAt`, `updatedAt`, `assignedTo`, `assignedRole`, `summary`.
- Associated Entities: `affectedAssets` (`string[]`), `affectedUsers` (`string[]`), `iocs` (`string[]`), `mitreTechniques` (`string[]`).
- Chronology & Evidence: `timelineEvents` (`TimelineEvent[]`), `correlationChain` (`CorrelationChainItem[]`), `evidence` (`Evidence[]`), `attackPathId`.

### 3. How do alerts currently reference incidents?
- `Alert.incidentId?: string`.
- In Step 3, alerts generated from seed events with `incidentId: 'incident-001'` retained `incidentId: 'incident-001'`.
- Alerts generated dynamically from events without an incidentId have `incidentId: undefined`.
- Step 4 will correlate alerts and write `alert.incidentId = incident.id`.

### 4. How do events currently reference incidents?
- `SecurityEvent.incidentId?: string`.
- In Step 2, events carried static or simulated `incidentId`s.
- Step 4 will associate unassigned events with correlated incidents: `event.incidentId = incident.id`.

### 5. How does the spatial investigation load incidents?
- Via `useInvestigation()` and `InvestigationContext.tsx` calling `securityService.getIncidentById(focusedIncidentId)`.
- Reconstructs the 5 spatial visualizations (Timeline, Attack Graph, Radar, IOC Constellation, MITRE Matrix) from the incident's entities.
- Works dynamically with any canonical `Incident` object, including fallback attack graphs.

### 6. Which incident relationships already exist?
- Entities referenced by ID strings: `affectedAssets` $\to$ `Asset`, `affectedUsers` $\to$ `SecurityUser`, `iocs` $\to$ `IOC`, `mitreTechniques` $\to$ `MitreTechnique`.
- `TimelineEvent.entityId` links timeline items to entities.
- `CorrelationChainItem.alertId` links to alerts.

### 7. Which existing seed incidents must be migrated or preserved?
- `incident-001` (Operation BlackTide) and `incident-002` (VPN Brute Force).
- Both must remain intact in `incidents` store.
- Step 4 correlation engine will evaluate incoming alerts/events and associate them with `incident-001` when matching BlackTide telemetry, or dynamically create new incidents when confidence threshold is met.

---

## 4. Required Additions for Step 4

1. **Correlation Engine Core (`app/core/security/correlation-engine.ts`)**:
   - `CorrelationCandidate` interface.
   - Signals: Temporal proximity, same asset, same user, shared IOC, shared network destination, MITRE kill-chain progression, related detection rules.
   - Deterministic explainable scoring function: weights calibrated between 0 and 100, generating human-readable reasons (`CORRELATED BECAUSE: ...`).
   - Configurable confidence threshold (e.g. $\ge 65$ for automatic grouping).
2. **Canonical Incident Model Evolution (`app/core/models/incident.ts`)**:
   - Add optional backward-compatible fields: `description?`, `priority?` (`P1`|`P2`|`P3`|`P4`), `source?`, `firstSeenAt?`, `lastSeenAt?`, `eventIds?: string[]`, `alertIds?: string[]`, `correlationScore?: number`, `correlationReasons?: string[]`, `tags?: string[]`.
3. **Incident Lifecycle State Machine**:
   - States: `NEW` $\to$ `TRIAGED` $\to$ `INVESTIGATING` $\to$ `CONTAINING` $\to$ `RESOLVED` $\to$ `CLOSED`.
   - Distinct from SOAR response action states (`REQUESTED`, `PENDING_APPROVAL`, `EXECUTING`, `COMPLETED`).
4. **Automatic Incident Creation & Deduplication Pipeline**:
   - When new alerts/events arrive in `LocalProvider`, evaluate against active incidents.
   - If correlation confidence $\ge \text{threshold}$, update the existing incident (`lastSeenAt`, `alertIds`, `eventIds`, `severity`, `correlationReasons`).
   - If multiple unassigned alerts correlate together with confidence $\ge \text{threshold}$, automatically create a new Incident, persist to IndexedDB, update `alert.incidentId`, and emit `'INCIDENT_CREATED'`.
5. **Timeline Derivation from Correlated Events**:
   - When an incident is formed or updated, synchronize `timelineEvents` from the correlated `SecurityEvent`s in chronological order.
6. **IndexedDB Version 4 Upgrade**:
   - Update `DB_VERSION = 4`.
   - Add indices to `'incidents'` store: `by_status`, `by_severity`, `by_createdAt`.
7. **SOC Command Center & Investigation Integration**:
   - Clear KPI display distinguishing Events, Open Alerts, Active Incidents, and Critical Incidents.
   - Navigation from Alert $\to$ Incident $\to$ Investigation.
8. **Automated Unit Test Suite (`scripts/test-correlation-engine.ts`)**:
   - 15+ tests validating temporal, asset, user, IOC, and MITRE correlation signals, scoring, reasons, deduplication, lifecycle, and RBAC.

# EXPLAIN-SEC SPATIAL — STEP 6 CASE MANAGEMENT ARCHITECTURE AUDIT

**Date:** 2026-09-22  
**Status:** Phase 0 Architecture Audit Complete  
**Scope:** Offline-first Case Management System  

---

## 1. Executive Summary & Core Architectural Boundaries

This pre-implementation audit examines the existing architecture of **EXPLAIN-SEC SPATIAL** to establish the foundation for **Step 6: Case Management System**.

### Core Guiding Distinction
In a modern spatial Security Operations Centre:
- **SecurityEvent** (`app/core/models/event.ts`): *Something happened* — raw and normalized security telemetry.
- **Alert** (`app/core/models/detection.ts`): *Detection identified suspicious activity* — automated trigger from a detection rule.
- **Incident** (`app/core/models/incident.ts`): *Correlated security activity* — attack progression grouping related alerts and events.
- **Threat Hunt** (`app/core/models/hunting.ts`): *Analyst-driven investigation* — hypothesis-driven exploration across canonical security events.
- **Case** (`app/core/models/case.ts`): *Operational container* — used by analysts and managers to coordinate ownership, investigation workflows, notes, analyst tasks, explicit findings, evidence references, and resolution.

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
              Correlation    Hunt Results (Known vs Unknown)
                      ▼          ▼
               Incident ──────► [ CASE ] ◄────── Threat Hunt
               (Security        (Operational      (Proactive
                Campaign)        Workspace)        Hypothesis)
```

Cases do **not** replace Incidents. A Case sits above Incidents and Threat Hunts, serving as the operational investigation folder. Multiple incidents or hunts can belong to a single Case.

---

## 2. Existing Systems Inspection

### 2.1 Incident Lifecycle & Limitations
- **Current Model**: `Incident` in `app/core/models/incident.ts`.
- **Statuses**: `'NEW' | 'TRIAGED' | 'INVESTIGATING' | 'CONTAINING' | 'RESOLVED' | 'CLOSED' | 'FALSE_POSITIVE'`.
- **Ownership**: `assignedTo?: string`, `assignedRole?: string`.
- **Gaps for Case Management**:
  - An Incident represents a single correlated attack graph (e.g. Operation BlackTide). It does not have task tracking (`TODO`, `IN_PROGRESS`, `DONE`), timestamped collaboration notes, distinct findings with multi-entity provenance, or cross-incident operational coordination.
  - Incidents are automated security constructs; Cases are human operational containers.

### 2.2 Threat Hunting Layer (Step 5)
- **Model**: `ThreatHunt` in `app/core/models/hunting.ts`.
- **Capabilities**: Structured queries, match explainability, known vs unknown provenance, aggregations, 8 BlackTide templates.
- **Integration**: Analysts can select findings from a Threat Hunt and create or link to a Case without duplicating event data.

### 2.3 Existing Evidence Reference Pattern
- **Current Model**: `Evidence` in `app/core/models/incident.ts` (`id`, `incidentId`, `title`, `type`, `source`, `collectedAt`, `hash`, `content`, `collectedBy`, `isVerified`).
- **Scope Boundary**: Full forensic evidence management, vaults, chain-of-custody, and file acquisition belong to **Step 7**. Case management in Step 6 must provide clean reference arrays (`incidentIds`, `huntIds`, `alertIds`, `eventIds`, `assetIds`, `userIds`, `iocIds`) without duplicating telemetry or pre-empting Step 7.

### 2.4 User Model & RBAC
- **Organization Directory Users**: `SecurityUser` in `app/core/models/entity.ts` (`user-001`, `user-002`, `user-003`).
- **SOC Analyst Accounts**: Defined in `app/core/auth/local-auth-service.ts`:
  - `analyst1` (Alex Romero, L1_ANALYST)
  - `analyst2` (Sam Okafor, L2_ANALYST)
  - `responder` (Jo Blackwood, INCIDENT_RESPONDER)
  - `hunter` (Morgan Vance, THREAT_HUNTER)
  - `manager` (Taylor Singh, SOC_MANAGER)
  - `admin` (Admin System, PLATFORM_ADMIN)
- **RBAC**: Defined in `app/core/auth/rbac.ts`. Permissions must be expanded to include:
  - `CASE_READ`: Allowed for all roles.
  - `CASE_CREATE`: Analysts, Hunters, Managers, Admins.
  - `CASE_UPDATE`: Analysts, Hunters, Responders, Managers, Admins.
  - `CASE_MANAGE`: Assign, reassign, change priority, close, and reopen cases (Managers and Admins).

### 2.5 Storage Layer (IndexedDB v5)
- **Current DB Version**: `5` (`es-spatial-db`).
- **Stores**: `incidents`, `assets`, `users`, `iocs`, `response_actions`, `audit_records`, `events`, `alerts`, `threat_hunts`, `meta`.
- **Required Upgrade (v5 → v6)**:
  - Add stores:
    - `cases` (keyPath `'id'`, indices: `by_caseNumber`, `by_status`, `by_priority`, `by_severity`, `by_ownerId`, `by_createdAt`, `by_updatedAt`)
    - `case_notes` (keyPath `'id'`, indices: `by_caseId`, `by_authorId`, `by_createdAt`)
    - `case_tasks` (keyPath `'id'`, indices: `by_caseId`, `by_status`, `by_assigneeId`, `by_createdAt`)
    - `case_findings` (keyPath `'id'`, indices: `by_caseId`, `by_createdAt`)
  - Add metadata flags:
    - `META_CASES_SEEDED = 'cases_seeded'`
    - `META_CASE_SEQUENCE = 'case_sequence'` (monotonic integer sequence for human-readable IDs e.g. `CASE-000001`)
  - Safe, non-destructive migration preserving all existing records.

### 2.6 Audit Logging
- Store `audit_records` persists meaningful lifecycle actions.
- Add audit actions:
  - `CASE_CREATED`, `CASE_UPDATED`, `CASE_ASSIGNED`, `CASE_REASSIGNED`, `CASE_STATUS_CHANGED`, `CASE_PRIORITY_CHANGED`, `CASE_RESOLVED`, `CASE_CLOSED`, `CASE_REOPENED`
  - `CASE_NOTE_ADDED`, `CASE_NOTE_UPDATED`
  - `CASE_TASK_ADDED`, `CASE_TASK_UPDATED`
  - `CASE_FINDING_ADDED`, `CASE_FINDING_UPDATED`
  - `CASE_INCIDENT_LINKED`, `CASE_INCIDENT_UNLINKED`
  - `CASE_HUNT_LINKED`, `CASE_HUNT_UNLINKED`

---

## 3. Reusable Infrastructure vs. Required Gaps

| Component | Current Architecture | Reusable As-Is? | Case Management Requirements |
| :--- | :--- | :---: | :--- |
| **Security Telemetry** | `SecurityEvent` in IDB | **Yes** | Referenced by ID in cases and findings |
| **Incidents** | Canonical incidents in IDB | **Yes** | Multi-incident linking without merging records |
| **Threat Hunts** | Step 5 `ThreatHunt` in IDB | **Yes** | Linked to cases by ID |
| **Audit Log** | `audit_records` in IDB | **Yes** | Feed Case Activity Timeline |
| **User Directory** | `SecurityUser` & `LocalAccount` | **Yes** | Reused for Case ownership, assignment, and authorship |
| **Case Domain Models** | None | **No** | Create `Case`, `CaseNote`, `CaseTask`, `CaseFinding`, `CaseLifecycle` in `app/core/models/case.ts` |
| **Sequence Generator** | None | **No** | Deterministic monotonic sequence `CASE-000001` via IDB meta store |
| **Case Persistence** | None | **No** | IDB schema v6 with 4 new stores |
| **Spatial Case UI** | None | **No** | Spatial Case Workspace with Context, Investigation, Operations, and Activity Timeline |
| **Service Layer** | SecurityService | **No** | Add Case CRUD, task management, notes, findings, and linking methods |

---

## 4. Proposed Case Architecture

### 4.1 Canonical Case Model (`app/core/models/case.ts`)
- `CaseStatus`: `'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED'`
- `CasePriority`: `'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'`
- `CaseSeverity`: `'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'`
- `Case`:
  - Identification: `id`, `caseNumber` (`CASE-000001`), `title`, `description`
  - State: `status`, `priority`, `severity`
  - Timestamps: `createdAt`, `updatedAt`, `closedAt?`, `resolvedAt?`
  - Ownership: `createdBy`, `ownerId?`, `participantIds?: string[]`
  - Relationships (by ID): `incidentIds: string[]`, `huntIds: string[]`, `alertIds: string[]`, `eventIds: string[]`, `assetIds: string[]`, `userIds: string[]`, `iocIds: string[]`
  - Operational: `tags: string[]`, `resolution?: string`, `closureReason?: string`, `metadata?: Record<string, unknown>`

### 4.2 Sub-Entities
- **CaseNote**: `id`, `caseId`, `authorId`, `authorName`, `createdAt`, `updatedAt`, `content`, `isEdited?: boolean`.
- **CaseTask**: `id`, `caseId`, `title`, `description?`, `status` (`'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'`), `priority` (`'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'`), `assigneeId?`, `createdBy`, `createdAt`, `updatedAt`, `dueAt?`, `completedAt?`.
- **CaseFinding**: `id`, `caseId`, `title`, `description`, `severity?`, `authorId`, `createdAt`, `updatedAt`, `relatedEventIds?: string[]`, `relatedAlertIds?: string[]`, `relatedIncidentIds?: string[]`, `relatedHuntIds?: string[]`.

### 4.3 Deterministic Case Numbering
- Sequence stored under IDB `meta` key `case_sequence`.
- Format: `CASE-${String(sequence).padStart(6, '0')}` (e.g. `CASE-000001`, `CASE-000002`).
- Sequential and collision-safe.

---

## 5. Migration & Integrity Strategy

- `DB_VERSION` bumped from `5` to `6`.
- Stores `cases`, `case_notes`, `case_tasks`, `case_findings` created sequentially in `onupgradeneeded`.
- `resetLocalData()` updated to include new stores.
- Baseline seed case created for Operation BlackTide referencing `incident-001`, `hunt-seed-001`, findings, tasks, and notes.
- Zero network dependencies; 100% offline local operation.

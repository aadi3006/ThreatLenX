# EXPLAIN-SEC SPATIAL — STEP 6: CASE MANAGEMENT SYSTEM

**Status:** Completed & Verified  
**Date:** 2026-09-22  
**Implementation:** Offline-first Spatial Case Management  

---

## 1. Executive Summary & Hierarchy

Step 6 introduces the operational container layer sitting above telemetry, alerts, incidents, and threat hunts:

```
                SecurityEvent (Telemetry)
                      │          │
         Automated    │          │  Analyst-Driven
         Pipeline     │          │  Pipeline
                      ▼          ▼
             DetectionRule    ThreatHuntQuery
                      ▼          ▼
                   Alert     Hunt Results
                      ▼          ▼
              Correlation        │
                      ▼          ▼
               Incident ──────► [ CASE ] ◄────── Threat Hunt
               (Security        (Operational      (Proactive
                Campaign)        Workspace)        Hypothesis)
```

- **SecurityEvent**: Telemetry describing raw or normalized activity.
- **Alert**: Automated detection rule trigger.
- **Incident**: Correlated security attack campaign.
- **Threat Hunt**: Proactive analyst-driven exploration.
- **Case**: Operational coordination workspace containing ownership, tasks, findings, notes, and references to canonical security entities without duplicating source telemetry.

---

## 2. Canonical Case Models

Implemented in `app/core/models/case.ts` and exported via `app/core/models/index.ts`:

- **Case**:
  - `id`: Unique UUID identifier
  - `caseNumber`: Deterministic sequential identifier (`CASE-000001`, `CASE-000002`)
  - `title`, `description`
  - `status`: `'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED'`
  - `priority`: `'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'` (operational urgency)
  - `severity`: `'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'` (security impact)
  - `createdAt`, `updatedAt`, `closedAt?`, `resolvedAt?`
  - `createdBy`, `ownerId?`, `participantIds?`
  - References: `incidentIds`, `huntIds`, `alertIds`, `eventIds`, `assetIds`, `userIds`, `iocIds`
  - `tags`, `resolution?`, `closureReason?`, `metadata?`
- **CaseNote**: Timestamped analyst collaboration notes with author attribution, edit detection, and IndexedDB persistence.
- **CaseTask**: Actionable operational task list (`TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED`) with assignees and completion timestamps.
- **CaseFinding**: Explicit investigative conclusions retaining strict provenance links (`relatedEventIds`, `relatedAlertIds`, `relatedIncidentIds`, `relatedHuntIds`).

---

## 3. Lifecycle State Machine & Deterministic Numbering

- **State Machine**: Enforced by `VALID_CASE_STATUS_TRANSITIONS` and `isValidCaseStatusTransition`.
  - Allowed transitions: `OPEN` $\to$ `IN_PROGRESS` $\to$ `PENDING` $\to$ `RESOLVED` $\to$ `CLOSED`.
  - Direct mutation from `CLOSED` back to active states is blocked; requires explicit `reopenCase` workflow.
- **Sequence Numbering**: Atomic monotonic sequence stored in IndexedDB `meta` under `META_CASE_SEQUENCE`, formatting collision-safe IDs (`CASE-000001`, `CASE-000002`).

---

## 4. IndexedDB Schema Upgrade (v5 $\to$ v6)

Non-destructive upgrade implemented in `app/core/storage/idb-store.ts`:
- Added stores:
  - `cases` (indexes: `by_caseNumber`, `by_status`, `by_priority`, `by_severity`, `by_ownerId`, `by_createdAt`, `by_updatedAt`)
  - `case_notes` (indexes: `by_caseId`, `by_authorId`, `by_createdAt`)
  - `case_tasks` (indexes: `by_caseId`, `by_status`, `by_assigneeId`, `by_createdAt`)
  - `case_findings` (indexes: `by_caseId`, `by_createdAt`)
- Added meta flags: `META_CASES_SEEDED`, `META_CASE_SEQUENCE`.

---

## 5. RBAC & Audit System

- **RBAC**: Expanded in `app/core/models/auth.ts` and `app/core/auth/rbac.ts`:
  - `CASE_READ`: All roles.
  - `CASE_CREATE`: `L1_ANALYST`, `L2_ANALYST`, `THREAT_HUNTER`, `SOC_MANAGER`, `PLATFORM_ADMIN`.
  - `CASE_UPDATE`: Analysts, Hunters, Responders, Managers, Admins.
  - `CASE_MANAGE`: `SOC_MANAGER` and `PLATFORM_ADMIN` (ownership assignment, priority changes, case closure, case reopening).
- **Audit Logging**: Every case creation, status transition, priority modification, assignment, note addition, task update, and finding registration is appended to `audit_records`.

---

## 6. Spatial Case Workspace UI

- **Component**: `app/spatial/cases/CaseWorkspace.tsx` and `app/spatial/cases/case-workspace.css`.
- **Spatial Mode**: Added `'CASES'` to `SpatialMode` in `app/spatial-transform.ts`.
- **Keyboard Shortcut**: `C` key toggles Case Workspace; `ESC` returns to Command Center.
- **Top HUD**: Dedicated `CASES [C]` pill with indicator badge.
- **Command Center Integration**: Quick-switch cell in Command Center KPI bar.
- **Threat Hunting Integration**: "ATTACH TO CASE" action in threat hunt inspector.
- **Investigation Hub Integration**: "CASE [C]" quick-pivot button in investigation header.
- **5-Zone Spatial Workspace**:
  1. Top Bar: Case selector, metadata badges, quick actions, new case trigger.
  2. Left Rail: Context cards for linked incidents, threat hunts, alerts, affected assets, users, and IOCs.
  3. Center: Investigation findings list with provenance tags & interactive spatial hierarchy tree.
  4. Right Rail: Status state machine buttons, owner assignment dropdown, task checklist.
  5. Bottom Row: Canonical activity audit stream & collaboration notes stream.

---

## 7. Verification & Test Results

- **Automated Test Suite**: `scripts/test-step6-cases.ts` (10 test suites covering 42 assertions):
  - Canonical models & lifecycle state transitions
  - RBAC authorization matrix
  - Provider baseline & Operation BlackTide case (`CASE-000001`)
  - Deterministic sequential numbering (`CASE-000002`, `CASE-000003`)
  - Lifecycle state machine & rejection of direct transitions from `CLOSED`
  - Explicit `reopenCase` workflow
  - Ownership assignment and reassignment RBAC
  - Notes, tasks, and findings with multi-entity provenance
  - Incident and Threat Hunt linking/unlinking
  - Search and filter queries
  - SecurityService facade event bus and reactivity
- **Compiler**: `npx tsc --noEmit` exited with code 0.
- **Production Build**: `npm run build:vercel` built successfully with 0 errors.

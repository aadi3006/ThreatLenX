# EXPLAIN-SEC SPATIAL — Phase 0 Architecture Audit (Step 7 Evidence Management)

**Document:** `docs/step-7-evidence-management-audit.md`  
**Date:** September 2026  
**System:** EXPLAIN-SEC SPATIAL — Offline-First Spatial SOC  
**Target Milestone:** STEP 7 — Build the Evidence Management System  

---

## 1. Executive Summary & Core Objective

The objective of **Step 7** is to build a canonical, offline-first **Evidence Management System** for EXPLAIN-SEC SPATIAL.

In modern Security Operations, evidence is fundamentally distinct from raw security telemetry, detection results, attack campaigns, threat hunts, and operational case containers:

$$\begin{aligned}
\text{SecurityEvent} &\quad\text{Telemetry describing something that occurred in the environment} \\
\text{Alert}         &\quad\text{Result of detection logic identifying suspicious activity} \\
\text{Incident}      &\quad\text{Correlated security activity & attack campaign across entities} \\
\text{Threat Hunt}   &\quad\text{Analyst-driven hypothesis & query investigation across event streams} \\
\text{Case}          &\quad\text{Operational investigation container tracking response workflows} \\
\mathbf{Evidence}    &\quad\mathbf{Investigation\ artifact/reference\ preserved\ for\ analysis\ with} \\
                     &\quad\mathbf{provenance,\ integrity\ metadata\ (SHA\text{-}256),\ ownership,\ and} \\
                     &\quad\mathbf{append\text{-}only\ chain\text{-}of\text{-}custody\ records.}
\end{aligned}$$

The architectural relationship hierarchy is strictly preserved:

$$\begin{matrix}
\text{EVENT} & \longrightarrow & \text{ALERT} & \longrightarrow & \text{INCIDENT} & \longrightarrow & \text{CASE} & \longrightarrow & \mathbf{EVIDENCE} & \longrightarrow & \text{FINDING} & \longrightarrow & \text{CASE RESOLUTION} \\
\text{EVENT} & \longrightarrow & \text{THREAT HUNT} & \longrightarrow & \text{CASE} & \longrightarrow & \mathbf{EVIDENCE} & \longrightarrow & \text{FINDING} & & & &
\end{matrix}$$

Evidence preserves security-relevant artifacts inside a case **without duplicating the entire security data model**. Reference evidence points to canonical entities by ID; file evidence is preserved locally with cryptographic SHA-256 integrity verification.

---

## 2. Current Case Architecture Audit

From our inspection of `app/core/models/case.ts` and `app/core/providers/local-provider.ts`:

1. **Case Model (`Case`)**:
   - `id`: Unique identifier (e.g., `case-blacktide-001`).
   - `caseNumber`: Sequential human-readable identifier generated atomically via `META_CASE_SEQUENCE` (e.g., `CASE-000001`).
   - `title`, `description`: Contextual case narrative.
   - `status`: `OPEN` | `IN_PROGRESS` | `PENDING` | `RESOLVED` | `CLOSED`.
   - `priority`, `severity`: Operational risk classifications.
   - Canonical reference arrays: `incidentIds`, `huntIds`, `alertIds`, `eventIds`, `assetIds`, `userIds`, `iocIds`.
   - `tags`: Tagging array.
   - `ownerId`, `participantIds`: Operational assignment.

2. **Case Sub-Entities**:
   - `CaseNote`: Structured notes with author and timestamp tracking.
   - `CaseTask`: Action items with assignees, priorities, and statuses (`TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED`).
   - `CaseFinding`: Core investigative findings with author and references (`relatedEventIds`, `relatedAlertIds`, `relatedIncidentIds`, `relatedHuntIds`). Currently lacks direct `relatedEvidenceIds` reference links.

3. **Current Gaps Identified**:
   - Findings link to events and alerts directly, but there is no canonical `Evidence` entity linking cases and findings with provenance and cryptographic integrity.
   - Analysts cannot collect security telemetry, alert snapshots, or hunt outputs into an immutable, audited evidence repository.
   - No chain-of-custody tracking exists for investigative artifacts.

---

## 3. Existing Persistence & Storage Audit

From inspection of `app/core/storage/idb-store.ts`:
- Current database: `es-spatial-db`, version `DB_VERSION = 6`.
- Existing Object Stores:
  - `incidents` (keyPath: `id`)
  - `assets` (keyPath: `id`)
  - `users` (keyPath: `id`)
  - `iocs` (keyPath: `id`)
  - `response_actions` (keyPath: `id`)
  - `audit_records` (keyPath: `id`)
  - `meta` (keyPath: `key`)
  - `events` (keyPath: `id`, indices on timestamp, severity, category, asset, incident)
  - `alerts` (keyPath: `id`, indices on ruleId, severity, status, asset, incident, createdAt, fingerprint)
  - `threat_hunts` (keyPath: `id`, indices on status, createdAt, createdBy)
  - `cases` (keyPath: `id`, indices on caseNumber, status, priority, severity, ownerId, createdAt, updatedAt)
  - `case_notes` (keyPath: `id`, indices on caseId, authorId, createdAt)
  - `case_tasks` (keyPath: `id`, indices on caseId, status, assigneeId, createdAt)
  - `case_findings` (keyPath: `id`, indices on caseId, createdAt)

### Binary/File Storage Audit
- **Binary/file storage currently does not exist** anywhere in the codebase.
- No `ArrayBuffer`, `Blob`, or file parsing is implemented.
- Offline Web Crypto APIs (`window.crypto.subtle.digest` or Node `crypto.createHash`) are not yet integrated into `idb-store.ts` or `local-provider.ts`.

### IndexedDB Schema Upgrade Plan (v6 → v7)
- Increment `DB_VERSION = 7`.
- Under `case oldVersion < 7:`:
  - Create `evidence` store:
    - `keyPath: 'id'`
    - Indices: `by_evidenceNumber` (unique), `by_caseId`, `by_status`, `by_type`, `by_sourceType`, `by_createdAt`.
  - Create `evidence_annotations` store:
    - `keyPath: 'id'`
    - Indices: `by_evidenceId`, `by_createdAt`.
  - Create `evidence_custody` store:
    - `keyPath: 'id'`
    - Indices: `by_evidenceId`, `by_timestamp`.
  - Create `evidence_blobs` store:
    - `keyPath: 'id'`
    - Stores local file bytes/ArrayBuffer with size enforcement (e.g. max 10MB per file).
  - Add metadata sequence keys:
    - `META_EVIDENCE_SEEDED = 'evidence_seeded'`
    - `META_EVIDENCE_SEQUENCE = 'evidence_sequence'`
  - Atomic helper `getNextEvidenceNumber()` yielding `EVD-000001`, `EVD-000002`, etc.

---

## 4. Existing Provenance & Audit Behavior

1. **Audit Records (`AuditRecord` in `app/core/models/audit.ts`)**:
   - `id`, `timestamp`, `actor`, `actorRole`, `action`, `target`, `previousState`, `resultingState`, `authorization`, `outcome`, `details`.
   - Append-only in IndexedDB (`put<AuditRecord>('audit_records', entry)`).

2. **Evidence Provenance Requirements**:
   - Every evidence object must answer: **Where did this come from?**
   - Source types: `SECURITY_EVENT`, `ALERT`, `INCIDENT`, `THREAT_HUNT`, `IOC`, `ASSET`, `USER`, `ANALYST`, `FILE`, `MANUAL`.
   - Stores canonical `sourceId` (e.g., `evt-001`, `alert-seed-001`, `incident-001`).
   - Selecting evidence must allow direct spatial navigation back to the source entity.
   - The source payload is **not** duplicated into the evidence record; only the reference pointer, type, integrity hash, and analyst collection context are stored.

3. **Chain of Custody**:
   - Internal SOC evidence audit trail (`EvidenceCustodyEntry`).
   - Append-only, collision-safe records:
     - `id`, `evidenceId`, `action` (`COLLECTED`, `VIEWED`, `TRANSFERRED`, `STATUS_CHANGED`, `ANNOTATED`, `INTEGRITY_VERIFIED`, `ARCHIVED`), `actorId`, `timestamp`, `fromStatus`, `toStatus`, `source`, `destination`, `reason`, `metadata`.
   - Must never allow editing or deletion of historical custody records.

---

## 5. Integrity & Cryptographic Hashing Implementation

1. **Hashing Engine**:
   - Algorithm: SHA-256.
   - For file evidence: calculate SHA-256 over raw file bytes (`ArrayBuffer`) using `crypto.subtle.digest('SHA-256', buffer)` in the browser, with fallback to Node.js `crypto.createHash('sha256')` for scripts/tests.
   - For text notes: calculate SHA-256 over UTF-8 encoded text content.
   - For canonical references: compute deterministic provenance fingerprint based on `sourceType`, `sourceId`, and collection timestamp, plus verify canonical entity existence.

2. **Integrity Verification Workflow**:
   - Given an `evidenceId`, retrieve stored hash.
   - For files, retrieve stored bytes from `evidence_blobs` and recalculate SHA-256.
   - For references, verify existence and unchanged identity of the canonical entity.
   - Compare recalculation against stored hash:
     - Match $\to$ Status `VERIFIED` (`MATCH`).
     - Mismatch $\to$ Status `INTEGRITY_MISMATCH` (`MISMATCH`).
   - Record an append-only custody event for every verification attempt.

---

## 6. RBAC Integration

Using existing roles in `app/core/models/auth.ts` and `app/core/auth/rbac.ts`:
- Permissions to add:
  - `EVIDENCE_READ`: Inspect evidence and custody logs.
  - `EVIDENCE_COLLECT`: Create evidence objects and collect references from events/alerts/incidents/hunts.
  - `EVIDENCE_ANNOTATE`: Add analyst commentary without modifying core provenance.
  - `EVIDENCE_VERIFY`: Execute cryptographic SHA-256 verification and record custody entries.
  - `EVIDENCE_MANAGE`: Change status (`UNDER_REVIEW`, `VALIDATED`, `DISPUTED`, `ARCHIVED`) and manage case assignments.

- Role mappings:
  - `L1_ANALYST`: `EVIDENCE_READ`, `EVIDENCE_COLLECT`, `EVIDENCE_ANNOTATE`, `EVIDENCE_VERIFY`.
  - `L2_ANALYST`: `EVIDENCE_READ`, `EVIDENCE_COLLECT`, `EVIDENCE_ANNOTATE`, `EVIDENCE_VERIFY`, `EVIDENCE_MANAGE`.
  - `INCIDENT_RESPONDER`: `EVIDENCE_READ`, `EVIDENCE_COLLECT`, `EVIDENCE_ANNOTATE`, `EVIDENCE_VERIFY`.
  - `THREAT_HUNTER`: `EVIDENCE_READ`, `EVIDENCE_COLLECT`, `EVIDENCE_ANNOTATE`, `EVIDENCE_VERIFY`.
  - `SOC_MANAGER`: Full permissions including `EVIDENCE_MANAGE`.
  - `PLATFORM_ADMIN`: Full permissions.

---

## 7. Security & Safe File Handling Considerations

- **Strict Offline Rule**: Zero `fetch()`, zero external API calls, zero cloud storage.
- **Safe File Handling**:
  - The repository is an evidence vault, not an execution runtime.
  - Never execute uploaded files, scripts, binaries, or macros.
  - Enforce a strict file size limit (10MB) to prevent IndexedDB quota exhaustion.
  - Display safe metadata (size, MIME type, SHA-256 hash, timestamps) rather than attempting arbitrary previews of untrusted or executable types.
  - For safe plain text or logs, render in a sanitized, read-only text viewer.

---

## 8. Spatial User Interface & Reusable Components

1. **Spatial Mode**:
   - Add `'EVIDENCE'` to `SpatialMode` in `app/spatial-transform.ts`.
   - Register hotkey `'e'` in `app/spatial-controller.ts`.
   - Add `EVIDENCE [E]` navigation pill to HUD in `app/soc-spatial.tsx`.

2. **Evidence Workspace (`app/spatial/evidence/EvidenceWorkspace.tsx`)**:
   - Spatial-native 5-zone layout adhering to the spatial HUD contract:
     - **TOP HUD**: Evidence number (`EVD-000001`), title, type badge, status pill, integrity badge (SHA-256 verified / mismatch), collector, timestamps, actions (`VERIFY INTEGRITY`, `CHANGE STATUS`, `ARCHIVE`).
     - **LEFT PANEL**: Evidence collection list for the case, filters by status/type/provenance, and `COLLECT EVIDENCE` action.
     - **CENTER STAGE**: Evidence object viewer:
       - References: Interactive source relationship card with direct navigation back to source event/alert/incident/hunt.
       - Text Notes: Safe read-only monospaced text viewer.
       - Files: Cryptographic hash breakdown, byte size, MIME type, integrity status, and safe metadata viewer.
     - **RIGHT PANEL**: Append-only Chain of Custody timeline with chronological actions, actors, and state transitions.
     - **BOTTOM PANEL**: Analyst annotations and commentary stream with author attribution and timestamping.

3. **Case Integration**:
   - `CaseWorkspace.tsx`:
     - Add `EVIDENCE` tab alongside `FINDINGS` and `RELATIONSHIPS`.
     - Display evidence counts, review status, and integrity states.
     - Provide direct navigation to Evidence Workspace.
     - Enable findings to reference evidence (`relatedEvidenceIds`).

4. **Incident & Threat Hunting Integration**:
   - `InvestigationHub.tsx` & `ThreatHuntingWorkspace.tsx`:
     - Provide "Collect as Evidence" button to preserve active events, alerts, or hunt queries into the active case.

---

## 9. Baseline Demonstration Scenario (Operation BlackTide)

We will seed canonical baseline evidence tied to `CASE-000001` (Operation BlackTide):
- `EVD-000001`: Event reference to `evt-001` (Encoded PowerShell execution on FINWS-027), status `VALIDATED`, SHA-256 integrity verified, linked to `finding-blacktide-001`.
- `EVD-000002`: Threat hunt reference to `hunt-seed-001` (C2 beaconing sweep to 198.51.100.45), status `UNDER_REVIEW`, linked to `finding-blacktide-001`.
- `EVD-000003`: Synthetic local test file artifact (`blacktide_powershell_payload.ps1.txt`), size 245 bytes, valid SHA-256 hash, chain of custody recorded.

---

## 10. Audit Conclusion

The architecture is fully verified. We are ready to proceed with creating the implementation plan and executing Step 7.

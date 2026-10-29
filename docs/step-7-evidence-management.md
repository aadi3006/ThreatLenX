# Step 7: Offline Evidence Management System Documentation

## Overview

The Evidence Management System establishes an offline, forensically sound evidence repository for the EXPLAIN-SEC Spatial SOC. It bridges operational investigations with concrete evidence artifacts while preserving the foundational hierarchy:

$$\begin{aligned}
\text{EVENT / ALERT / INCIDENT / HUNT} &\longrightarrow \mathbf{CASE} \\
&\longrightarrow \mathbf{EVIDENCE} \\
&\longrightarrow \mathbf{FINDING} \\
&\longrightarrow \mathbf{CASE\ RESOLUTION}
\end{aligned}$$

Evidence is strictly distinguished from operational security entities:
- **SecurityEvent**: Raw telemetry describing an observation that happened on an asset or network.
- **Alert**: Detection engine output identifying suspicious patterns or thresholds.
- **Incident**: Correlated cluster of alerts and events requiring investigation.
- **ThreatHunt**: Analyst-driven hypothesis investigation across events.
- **Case**: Operational investigation container managing lifecycle, owners, and tasks.
- **Evidence**: Forensically preserved artifact or reference preserved for analysis, complete with provenance, integrity metadata, ownership, and an append-only chain of custody.

---

## 1. Canonical Evidence Model

The canonical model is defined in [`app/core/models/evidence.ts`](file:///Users/aadibondre/Downloads/explainsec-AR/explainsec-AR/app/core/models/evidence.ts):

```typescript
export interface Evidence {
  id: string;                                // UUID (e.g., evd-blacktide-001)
  evidenceNumber: string;                    // Sequential human-readable ID: EVD-000001
  caseId: string;                            // Mandatory relationship to a Case

  type: EvidenceType;                        // Category of evidence artifact
  title: string;                             // Analyst-assigned title
  description?: string;                      // Investigation context

  sourceType: EvidenceSourceType;            // SECURITY_EVENT, ALERT, INCIDENT, THREAT_HUNT, IOC, ASSET, USER, ANALYST, FILE, MANUAL
  sourceId?: string;                         // Canonical source identifier (e.g., evt-raw-004, alt-001)

  collectedAt: string;                       // ISO timestamp (Immutable)
  collectedBy: string;                       // Collector user ID (Immutable)

  createdAt: string;
  updatedAt: string;

  status: EvidenceStatus;                    // COLLECTED -> UNDER_REVIEW -> VALIDATED / DISPUTED -> ARCHIVED

  integrity: {
    algorithm: 'SHA-256';                    // Cryptographic hash algorithm
    hash?: string;                           // SHA-256 hex string (Immutable)
    verified?: boolean;                      // Verification status (true = match, false = mismatch)
    verifiedAt?: string;                     // Timestamp of last verification
    verifiedBy?: string;                     // User who performed verification
  };

  metadata: Record<string, unknown>;         // Extensible context metadata
  tags: string[];                            // Investigation tags
  notes?: string;                            // Analyst collection notes
  chainOfCustodyId?: string;                 // Pointer to chain of custody

  // Local Sandboxed File Metadata
  sizeBytes?: number;                        // Payload size in bytes
  mimeType?: string;                         // MIME type (e.g. text/plain, application/json)
  fileName?: string;                         // Filename
  storageReference?: string;                 // Storage key in IndexedDB evidence_blobs store
  textContent?: string;                      // Content for TEXT_NOTE

  // Canonical Security Entity References
  relatedEventIds?: string[];
  relatedAlertIds?: string[];
  relatedIncidentIds?: string[];
  relatedHuntIds?: string[];
  relatedAssetIds?: string[];
  relatedUserIds?: string[];
  relatedIocIds?: string[];
}
```

---

## 2. Evidence Types

Evidence does not require raw binary uploads for every artifact. Instead, canonical references to security objects are valid first-class evidence:

| Evidence Type | Description | Source Type | Payload / Metadata |
|---|---|---|---|
| `EVENT_REFERENCE` | Direct pointer to a `SecurityEvent` | `SECURITY_EVENT` | Event ID, eventType, assetId, rawPayload |
| `ALERT_REFERENCE` | Pointer to a detection `Alert` | `ALERT` | Alert ID, rule ID, severity, title |
| `INCIDENT_REFERENCE` | Pointer to an existing `Incident` | `INCIDENT` | Incident ID, severity, status, title |
| `HUNT_REFERENCE` | Threat Hunt hypothesis & execution output | `THREAT_HUNT` | Hunt ID, query, matched event count |
| `IOC_REFERENCE` | Preserved Indicator of Compromise | `IOC` | Value, type, reputation, block status |
| `ASSET_REFERENCE` | Compromised or witness machine reference | `ASSET` | Asset ID, IP, OS, criticality |
| `USER_REFERENCE` | Identity/account artifact reference | `USER` | Username, department, role |
| `TEXT_NOTE` | Raw analyst commentary or memory dump summary | `ANALYST` | Monospaced UTF-8 text string |
| `FILE` | Offline sandboxed binary or text artifact | `FILE` | MIME, size, SHA-256, local blob reference |

---

## 3. Sequential Numbering

Human-readable, collision-safe numbering format:
$$\text{EVD-000001},\ \text{EVD-000002},\ \dots$$

Implemented in [`app/core/storage/idb-store.ts`](file:///Users/aadibondre/Downloads/explainsec-AR/explainsec-AR/app/core/storage/idb-store.ts) using an atomic `evidence_counter` in IndexedDB. Guaranteed monotonically increasing, collision-safe across restarts, and never derived from timestamps alone.

---

## 4. Evidence Lifecycle & Status Transitions

Allowed state transitions enforced by `isValidEvidenceStatusTransition()`:

```
               COLLECTED
                   │
                   ▼
             UNDER_REVIEW ◄──────────┐
               │        │            │
               ▼        ▼            │
          VALIDATED   DISPUTED ──────┘
               │        │
               ▼        ▼
               ARCHIVED
```

- **COLLECTED**: Initial state upon acquisition.
- **UNDER_REVIEW**: Assigned to an analyst or manager for technical examination.
- **VALIDATED**: Provenance and cryptographic integrity confirmed; ready for case finding citation.
- **DISPUTED**: Integrity failed or provenance challenged. Disputed is an explicit investigative state, never a silent deletion.
- **ARCHIVED**: Sealed upon case resolution or formal closure.

Every lifecycle transition requires an operational reason and appends a record to the append-only Chain of Custody.

---

## 5. Source Provenance & Immutability

To guarantee forensic integrity:
1. **Provenance Linking**: References store canonical entity identifiers (`sourceId`) rather than duplicating the entire security data model.
2. **Immutable Provenance Fields**: Once collected, the following core provenance attributes **cannot be edited or overwritten** under any circumstances:
   - `id`
   - `evidenceNumber`
   - `caseId`
   - `collectedAt`
   - `collectedBy`
   - `sourceType`
   - `sourceId`
   - `integrity.hash`
3. **Permitted Edits**: Only non-provenance metadata (`title`, `description`, `notes`, `tags`, `metadata`) may be updated by authorized analysts. Any modification automatically creates an `ANNOTATED` entry in the Chain of Custody and an immutable record in the audit log.

---

## 6. Cryptographic Hashing & Integrity Verification

- **SHA-256 Engine**: Native Web Crypto API (`crypto.subtle.digest('SHA-256')`) with isomorphic dynamic import fallback (`node:crypto`) for headless test suites.
- **Payload Hashing**:
  - For files: Calculated directly from raw `ArrayBuffer` bytes.
  - For text notes: Calculated from UTF-8 encoded bytes.
  - For canonical references: Deterministic SHA-256 fingerprint generated from `sourceType:sourceId:title`.
- **Integrity Verification**:
  - The analyst triggers `VERIFY INTEGRITY`.
  - The system recalculates the cryptographic hash from current bytes or checks the authentic existence of the canonical entity.
  - Compares recalculation with stored hash.
  - Outputs **`VERIFIED`** or flags an **`INTEGRITY MISMATCH`**.
  - Logs the result to the Chain of Custody and records an audit event.

---

## 7. Chain of Custody (Append-Only)

Every evidence artifact maintains an append-only timeline of `EvidenceCustodyEntry` objects:

```typescript
export interface EvidenceCustodyEntry {
  id: string;
  evidenceId: string;
  action: EvidenceCustodyAction;  // COLLECTED | VIEWED | STATUS_CHANGED | ANNOTATED | INTEGRITY_VERIFIED | ARCHIVED
  actorId: string;
  actorRole?: RoleId;
  timestamp: string;
  fromStatus?: EvidenceStatus;
  toStatus?: EvidenceStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
}
```

Custody history is append-only. Analysts cannot modify or delete past custody entries.

---

## 8. Sandboxed Safe File Handling

To prevent security risks in the SOC analyst workstation:
1. **Strict 10MB Local Storage Limit**: Enforced during collection; larger files are rejected.
2. **Zero Executable Execution**: Executables (`.exe`, `.dll`, `.bat`, `.ps1`, `.sh`) are never executed or spawned.
3. **Safe Metadata-First Loading**: Center panel previews display metadata (size, MIME, SHA-256) first.
4. **Sandboxed Text Previews**: Read-only UTF-8 text preview rendered up to 4KB for logs, scripts, JSON, and CSVs.
5. **No Network Transmission**: Zero cloud uploads, zero external API calls.

---

## 9. Integration Across the Spatial Architecture

1. **Evidence Workspace (`app/spatial/evidence/EvidenceWorkspace.tsx`)**:
   - 5-zone holographic HUD matching the cyberpunk Tron aesthetic:
     - **TOP**: Evidence number, title, type badge, status pill, SHA-256 integrity badge, lifecycle actions (`VERIFY INTEGRITY`, `VALIDATE`, `DISPUTE`, `ARCHIVE`), exit.
     - **LEFT**: Case evidence collection inventory, quick filters (type, status), search bar, `+ COLLECT EVIDENCE` trigger.
     - **CENTER**: Evidence Object Inspector, Provenance Card with `[JUMP TO CANONICAL SOURCE]`, safe payload preview, and case findings citation list.
     - **RIGHT**: Append-only Chain of Custody vertical timeline.
     - **BOTTOM**: Analyst annotations list + submission form.
2. **Command Center (`app/spatial/command/CommandCenter.tsx`)**:
   - Operational evidence metrics chip: displays total evidence artifacts, review count, validated count, and highlights integrity mismatches with red alert glow. Clicking navigates directly to Evidence Workspace.
3. **Case Workspace (`app/spatial/cases/CaseWorkspace.tsx`)**:
   - Integrated `EVIDENCE VAULT` tab alongside `FINDINGS` and `SPATIAL HIERARCHY TREE`.
   - Left panel context displays evidence counts with shortcut button.
   - Investigation findings list displays clickable `EVD: <id>` provenance badges.
4. **Investigation Hub (`app/spatial/investigation/InvestigationHub.tsx`)**:
   - Top action bar includes `[EVIDENCE (E)]` one-click collection shortcut to preserve the active incident into the baseline case.
5. **Spatial HUD Navigation (`app/soc-spatial.tsx`)**:
   - Added `EVIDENCE [E]` navigation pill in top HUD bar. Keyboard hotkey `E` toggles the workspace.

---

## 10. IndexedDB Schema Migration

Upgraded database version to `DB_VERSION = 7`:

| Store Name | KeyPath | Indexes | Purpose |
|---|---|---|---|
| `evidence` | `id` | `caseId`, `type`, `status`, `evidenceNumber` | Canonical evidence records |
| `evidence_annotations` | `id` | `evidenceId`, `authorId` | Analyst commentary bubbles |
| `evidence_custody` | `id` | `evidenceId`, `timestamp`, `action` | Append-only chain of custody records |
| `evidence_blobs` | `id` | `createdAt` | Local sandboxed binary payloads |

*Existing stores (`incidents`, `alerts`, `security_events`, `cases`, `threat_hunts`, `audit_records`) were preserved with zero data deletion.*

---

## 11. Role-Based Access Control (RBAC)

Enforced in [`app/core/auth/rbac.ts`](file:///Users/aadibondre/Downloads/explainsec-AR/explainsec-AR/app/core/auth/rbac.ts):

| Permission | L1 Analyst | L2 Analyst | Hunter | Responder | Manager | Admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `EVIDENCE_READ` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `EVIDENCE_COLLECT` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `EVIDENCE_ANNOTATE`| ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `EVIDENCE_VERIFY` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `EVIDENCE_MANAGE` | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |

*(Status transitions and archiving require `EVIDENCE_MANAGE` or authorized analyst review).*

---

## 12. Verification & Testing Summary

1. **Automated Test Suite**:
   - `scripts/test-step7-evidence.ts`: **11/11 Suites Passed (100%)**.
   - Verified Operation BlackTide baseline seeding (`EVD-000001`, `EVD-000002`, `EVD-000003`).
   - Verified sequential collision-safe numbering (`EVD-000004`, `EVD-000005`).
   - Verified SHA-256 computation, integrity verification, and mismatch detection.
   - Verified immutability of core provenance fields (`collectedBy`, `collectedAt`, `evidenceNumber`).
   - Verified append-only Chain of Custody.
   - Verified analyst annotations.
   - Verified lifecycle transitions (`COLLECTED` $\rightarrow$ `UNDER_REVIEW` $\rightarrow$ `VALIDATED` $\rightarrow$ `ARCHIVED`).
   - Verified event/alert/incident/hunt collection wrappers.
   - Verified finding linkage (`relatedEvidenceIds`).
   - Verified RBAC enforcement.
   - Verified audit log generation.
2. **TypeScript Compilation**:
   - `npx tsc --noEmit`: **0 errors**.
3. **Production Build**:
   - `npm run build:vercel`: **Passed cleanly in 649ms**.

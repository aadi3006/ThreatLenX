# STEP 9 — DETECTION ENGINEERING & RULE AUTHORING SYSTEM AUDIT

## Phase 0: System Inspection & Gap Analysis

**Date:** 2026-09-22  
**Target:** EXPLAIN-SEC SPATIAL SOC — Step 9 Detection Engineering  
**Scope:** Offline Detection Rule Authoring, Validation, Simulation, Versioning, Lifecycle, and Runtime Execution  

---

### 1. Existing Detection Architecture Overview

The system already possesses a runtime Detection & Alert Engine (implemented in Step 3), an Incident Correlation Engine (Step 4), a Threat Hunting Engine (Step 5), and a Threat Intelligence Engine (Step 8).

Currently, detection rules flow as follows:
$$\text{SecurityEvent} \longrightarrow \text{DetectionRule (In-Memory)} \longrightarrow \text{evaluateRule()} \longrightarrow \text{buildAlertFromMatch()} \longrightarrow \text{Alert} \longrightarrow \text{Correlation Engine} \longrightarrow \text{Incident}$$

However, detection rules are currently **static in-memory seeds**, cannot be edited or versioned by analysts, lack a visual condition builder, lack safe dry-run simulation against historical telemetry, and do not track rule versions when generating alerts.

---

### 2. Component Audits

#### A. Existing DetectionRule Model (`app/core/models/detection.ts`)
- **Current Fields:**
  - `id`: string (e.g. `'DET-AUTH-001'`)
  - `name`: string
  - `description`: string
  - `enabled`: boolean
  - `severity`: Severity (`'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'`)
  - `category`: EventCategory
  - `eventTypes?`: string[]
  - `conditions`: RuleCondition[]
  - `timeWindowMs?`: number
  - `threshold?`: number
  - `mitreTechniqueId?`: string
  - `mitreTactic?`: string
  - `tags?`: string[]
  - `author?`: string
  - `createdAt`: string
  - `updatedAt`: string
- **Missing for Step 9:**
  - `ruleId`: string (stable rule lineage identifier, separating lineage from `id` of specific versions)
  - `version`: number (monotonic version integer, e.g. 1, 2, 3)
  - `status`: RuleLifecycleStatus (`'DRAFT' | 'VALIDATING' | 'TESTING' | 'PUBLISHED' | 'ENABLED' | 'DISABLED' | 'DEPRECATED'`)
  - `authorId`: string
  - `publishedAt?`: string
  - `disabledAt?`: string
  - `deprecatedAt?`: string
  - `versionStatus?`: `'ACTIVE' | 'ARCHIVED' | 'SUPERSEDED'`
  - `mitreTechniqueIds?`: string[] (supporting multi-technique association)
  - `changeDescription?`: string

#### B. Existing Evaluator (`app/core/security/detection-engine.ts`)
- **Functionality:**
  - `evaluateRule(rule: DetectionRule, event: SecurityEvent): RuleEvaluationResult`
  - `evaluateCondition(condition: RuleCondition, event: SecurityEvent): boolean`
  - `getFieldValue(event: SecurityEvent, fieldPath: string): unknown`
  - `generateAlertFingerprint(rule, event, timeWindowMs): string`
  - `buildAlertFromMatch(rule, event, fingerprint): Alert`
- **Strengths:** Pure functions, zero `eval()` / zero dynamic code execution, deterministic, handles nested properties and array evaluation.
- **Gaps:**
  - Condition evaluation only supports conjunction (`AND`) at the top level; does not yet support structured logical grouping (`AND`, `OR`, `NOT`).
  - Alert does not store `ruleVersion` (only `ruleId`), preventing historical audit of which version produced an alert.
  - Evaluation results are ternary (`'MATCH' | 'NO_MATCH' | 'INVALID'`) without detailed condition breakdown explaining *why* an event did or did not match during analyst testing.

#### C. Built-in Baseline Rules (`app/core/security/detection-rules.ts`)
- 7 core rules covering Operation BlackTide:
  1. `DET-AUTH-001`: Suspicious Authentication & Password Spray Activity
  2. `DET-PROC-001`: Suspicious Obfuscated Process Execution
  3. `DET-NET-001`: Cobalt Strike C2 Beaconing & Malicious DNS Queries
  4. `DET-IOC-001`: High-Confidence Indicator of Compromise Match
  5. `DET-PER-001`: Unauthorized Registry Persistence Modification
  6. `DET-EXF-001`: Sensitive File Collection & Exfiltration Staging
  7. `DET-GW-001`: High-Risk Email Gateway Attachment Delivery
- All 7 rules are well-formed and map to canonical BlackTide telemetry events.

#### D. Storage & Persistence (`app/core/storage/idb-store.ts`)
- Current schema version: `DB_VERSION = 8`.
- `LocalProvider` currently holds `_detectionRules: DetectionRule[] = clone(SEED_DETECTION_RULES)` in memory only, without IndexedDB persistence!
- **Required IndexedDB Changes:**
  - Bump `DB_VERSION` from `8` to `9`.
  - Add object store `detection_rules` (`keyPath: 'id'`, indexed by `ruleId`, `status`, `severity`, `category`).
  - Add object store `detection_rule_versions` (`keyPath: 'id'`, indexed by `ruleId`, `version`, `[ruleId+version]`).
  - Add object store `detection_test_runs` (`keyPath: 'id'`, indexed by `ruleId`, `executedAt`).
  - Non-destructive migration: seed initial baseline rules on first migration into `detection_rules` and `detection_rule_versions` with `version: 1`, `status: 'ENABLED'`, and preserve all existing event, alert, incident, case, and intelligence records.

#### E. Reusable Query & Evaluator Infrastructure
- `app/core/hunting/threat-hunt-engine.ts` provides typed safe operators (`equals`, `notEquals`, `contains`, `startsWith`, `endsWith`, `in`, `notIn`, `greaterThan`, `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual`) and match explainability strings.
- We can unify and reuse operator logic across Hunting and Detection while preserving individual model purity.
- `app/core/security/replay-engine.ts` provides temporal telemetry ranges and deterministic playback events for simulation testing.

#### F. RBAC & Audit System
- Roles: `L1_ANALYST`, `L2_ANALYST`, `INCIDENT_RESPONDER`, `THREAT_HUNTER`, `SOC_MANAGER`, `PLATFORM_ADMIN`.
- Current permissions in `app/core/auth/rbac.ts` include `canManageDetectionRules(roleId)` checking `CONFIG_MANAGE`, `THREAT_HUNTER`, or `SOC_MANAGER`.
- We will add granular helpers:
  - `canReadDetectionRules(roleId)`: all roles
  - `canTestDetectionRules(roleId)`: all analyst roles
  - `canAuthorDetectionRules(roleId)`: `L2_ANALYST`, `THREAT_HUNTER`, `SOC_MANAGER`, `PLATFORM_ADMIN`
  - `canPublishDetectionRules(roleId)`: `THREAT_HUNTER`, `SOC_MANAGER`, `PLATFORM_ADMIN`
- Audit events to emit:
  - `RULE_CREATED`
  - `RULE_EDITED`
  - `RULE_VERSION_CREATED`
  - `RULE_VALIDATED`
  - `RULE_TEST_EXECUTED`
  - `RULE_PUBLISHED`
  - `RULE_ENABLED`
  - `RULE_DISABLED`
  - `RULE_DEPRECATED`
  - `RULE_CLONED`
  - `RULE_MITRE_CHANGED`

#### G. Spatial Operating Environment
- Spatial Modes: `COMMAND`, `SPATIAL`, `FOCUS`, `CALIBRATION`, `HUNTING`, `CASES`, `EVIDENCE`.
- We will add mode `DETECTION` (hotkey `D`).
- Spatial Detection Engineering Workspace will feature:
  - **Left**: Rule Library (cards/list with search by name/tag/MITRE, filters for status, severity, category).
  - **Center**: Rule Canvas & Visual Condition Builder (declarative flow: Event Trigger $\to$ Conditions $\to$ Match $\to$ Alert Preview).
  - **Right**: Rule Inspector (Metadata, MITRE mapping, Lifecycle Status, Version History, Structural Diff).
  - **Bottom**: Simulation & Test Harness (dry-run test controls, event evaluation metrics, match/non-match explainability, side-effect free guarantee).

---

### 3. Gap Summary & Proposed Architecture

| Capability | Current State | Required State (Step 9) |
|---|---|---|
| **Rule Persistence** | In-memory clone of static seed | IndexedDB `detection_rules` & `detection_rule_versions` |
| **Rule Versioning** | Unversioned single object | Monotonic versioning (`v1`, `v2`, `v3`) with historical immutability |
| **Rule Lifecycle** | Only `enabled: boolean` | `DRAFT` $\to$ `VALIDATING` $\to$ `TESTING` $\to$ `PUBLISHED` $\to$ `ENABLED` / `DISABLED` / `DEPRECATED` |
| **Validation** | Basic runtime null checks | Deterministic validator with structured errors & warnings |
| **Testing / Simulation** | None (live detection only) | Side-effect free simulation against historical events with match rationale |
| **Alert Provenance** | `ruleId` only | `ruleId` + `ruleVersion` for exact forensic reproducibility |
| **Condition Builder** | Raw code arrays | Declarative safe condition builder with logical grouping (`AND`, `OR`, `NOT`) |
| **Workflow Pivots** | None | Event $\to$ Rule, Hunt $\to$ Rule, Alert $\to$ Rule Clone |
| **Spatial UI** | None | Dedicated `DETECTION [D]` 3D holographic workspace matching EXPLAIN-SEC spatial language |

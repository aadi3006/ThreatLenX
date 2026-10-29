# STEP 9: Offline Detection Engineering & Rule Authoring Architecture

## Executive Summary

Step 9 elevates EXPLAIN-SEC from a fixed runtime detection evaluator into a full, offline-native Detection Engineering and Rule Authoring platform. Security analysts and threat hunters can author, validate, dry-run simulate, version, publish, and toggle detection rules directly within the holographic spatial operating environment.

Crucially, Step 9 preserves the foundational distinction:
```
SecurityEvent
    ↓
DetectionRule (Author → Validate → Test → Version → Publish → Enable)
    ↓
Detection Evaluation (Deterministic offline evaluator)
    ↓
Alert (Retains exact ruleId and ruleVersion provenance)
    ↓
Correlation
    ↓
Incident
    ↓
Case
    ↓
Evidence
```

---

## 1. Architectural Overview

```
                           ┌────────────────────────────────────────────────────────┐
                           │          THREAT HUNTING (Step 5)                       │
                           │  - Interactive analyst query                           │
                           │  - "Convert to Detection" Bridge                       │
                           └───────────────────────┬────────────────────────────────┘
                                                   │ Pre-populated conditions
                                                   ▼
┌──────────────────────┐        ┌───────────────────────────────────────────────────┐
│   SECURITY EVENT     │───────▶│             DETECTION RULE AUTHORING              │
│ - Pivot to Detection │        │  - Visual Canvas / Logical Condition Builder      │
└──────────────────────┘        │  - Canonical AST: AND/OR/NOT groups + predicates  │
                                │  - Safe Operators: equals, contains, in, >=, etc. │
                                └─────────────────────────┬─────────────────────────┘
                                                          │
                                                          ▼
                                ┌───────────────────────────────────────────────────┐
                                │             DETERMINISTIC VALIDATOR               │
                                │  - Field verification & type checking             │
                                │  - Operator validity & regex safety               │
                                │  - Threshold & MITRE technique verification       │
                                └─────────────────────────┬─────────────────────────┘
                                                          │ (Valid)
                                                          ▼
                                ┌───────────────────────────────────────────────────┐
                                │          DRY-RUN SIMULATION HARNESS               │
                                │  - Zero side-effects (0 production alerts)        │
                                │  - Time-bounded historical telemetry replay       │
                                │  - Per-event match condition explainability       │
                                └─────────────────────────┬─────────────────────────┘
                                                          │ (Verified)
                                                          ▼
                                ┌───────────────────────────────────────────────────┐
                                │               LIFECYCLE & VERSIONING              │
                                │  - DRAFT → VALIDATING → TESTING →                 │
                                │    PUBLISHED → ENABLED / DISABLED / DEPRECATED    │
                                │  - Immutable version snapshots (v1, v2, v3...)    │
                                │  - Structural Rule Diff Engine                    │
                                └─────────────────────────┬─────────────────────────┘
                                                          │ (Enabled rules only)
                                                          ▼
                                ┌───────────────────────────────────────────────────┐
                                │            RUNTIME DETECTION PIPELINE             │
                                │  - Evaluates active rules against incoming events │
                                │  - Generates Alert with ruleId & ruleVersion      │
                                └─────────────────────────┬─────────────────────────┘
                                                          │
                                                          ▼
                                             CORRELATION & INCIDENTS
```

---

## 2. Canonical DetectionRule Model & Versions

All detection rule entities strictly adhere to TypeScript domain types defined in `app/core/models/detection.ts`.

### DetectionRule Schema
```typescript
export interface DetectionRule {
  id: string;                      // Document key: "RULE-0001"
  ruleId: string;                  // Canonical rule ID: "RULE-0001"
  version: number;                 // Active version number (e.g. 1, 2)
  name: string;
  description: string;
  category: EventCategory;
  severity: Severity;
  eventTypes: SecurityEventType[];
  conditions: (RuleCondition | RuleConditionGroup)[];
  threshold?: number;
  timeWindowMs?: number;
  status: RuleLifecycleStatus;     // Canonical lifecycle state
  enabled: boolean;                // Maintained in sync with status === 'ENABLED'
  mitreTechniqueId?: string;       // Primary MITRE technique ID
  mitreTechniqueIds?: string[];    // Array of mapped MITRE techniques
  tags?: string[];
  authorId: string;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  disabledAt?: number;
  deprecatedAt?: number;
  versionStatus?: 'CURRENT' | 'ARCHIVED' | 'SUPERSEDED';
  changeDescription?: string;
}
```

### Immutable Version Snapshot (`DetectionRuleVersion`)
Every time a rule is published or updated while active, a historical snapshot is recorded in the `detection_rule_versions` store:
```typescript
export interface DetectionRuleVersion {
  id: string;                      // "RULE-0001:v1"
  ruleId: string;
  version: number;
  name: string;
  description: string;
  category: EventCategory;
  severity: Severity;
  eventTypes: SecurityEventType[];
  conditions: (RuleCondition | RuleConditionGroup)[];
  threshold?: number;
  timeWindowMs?: number;
  mitreTechniqueId?: string;
  mitreTechniqueIds?: string[];
  tags?: string[];
  authorId: string;
  createdAt: number;
  publishedAt: number;
  changeDescription: string;
}
```

---

## 3. Rule Lifecycle State Machine

The rule lifecycle enforces deterministic promotion criteria:

```
[ DRAFT ] ───────────▶ [ VALIDATING ] ───────────▶ [ TESTING ]
   ▲                         │                          │
   │ (Fix errors)            │                          │
   └─────────────────────────┴──────────────────────────┘
                                                        │ (Validation & Simulation OK)
                                                        ▼
                                                 [ PUBLISHED ]
                                                        │
                                                        ▼
                                                  [ ENABLED ]
                                                   │       ▲
                                    (Disable rule) │       │ (Re-enable)
                                                   ▼       │
                                                 [ DISABLED ]
                                                        │
                                                        ▼ (Deprecate)
                                                [ DEPRECATED ]
```

### Promotion Rules
1. **DRAFT**: Editable working copy.
2. **VALIDATING**: Rule is run through `validateDetectionRule()`. If validation fails with blocking errors, publication is prevented.
3. **TESTING**: Evaluated against historical security events side-effect free.
4. **PUBLISHED**: Rule logic is locked and versioned.
5. **ENABLED**: Consumed by the live runtime detection evaluator. Only validated, published rules can be enabled.
6. **DISABLED**: Retained in library; bypassed by runtime detection evaluation.
7. **DEPRECATED**: Permanently marked obsolete; never executed in runtime; preserved for historical alert and case audits.

---

## 4. Condition Grammar & Supported Operators

Detection conditions support both single-level predicate evaluations and recursive logical groups (`AND`, `OR`, `NOT`).

### Condition Predicates
```typescript
export interface RuleCondition {
  field: string;
  operator: ConditionOperator;
  value: string | number | boolean | string[] | number[];
}
```

### Logical Groups
```typescript
export interface RuleConditionGroup {
  operator: 'AND' | 'OR';
  negate?: boolean;                // NOT logic
  conditions: (RuleCondition | RuleConditionGroup)[];
}
```

### Safe Deterministic Operators
- `equals`, `notEquals`: Strict equality/inequality.
- `contains`, `notContains`: Substring matching (case-insensitive where strings).
- `startsWith`, `endsWith`: String prefix/suffix validation.
- `in`, `notIn`: Array or set membership.
- `greaterThan`, `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual`: Numeric or chronological comparison.
- `regex`: Constrained regex evaluation with safe execution guardrails (strict limit on pattern length, sanitized inputs, zero arbitrary code execution).

---

## 5. Offline Rule Validation Engine

The validator (`app/core/security/rule-validator.ts`) evaluates rule declarations before any promotion.

### Validation Checks
- **Required Metadata**: Name, description, author, category, severity, and eventTypes.
- **Field Whitelist**: Verifies field paths against known `SecurityEvent` properties (`eventType`, `severity`, `category`, `sourceIp`, `destIp`, `srcIp`, `dstIp`, `commandLine`, `processName`, `userName`, `filePath`, etc.).
- **Operator Whitelist**: Verifies operator validity and ensures value matches expected types (e.g. numeric values for comparison operators, arrays for `in`/`notIn`).
- **Group Non-Emptiness**: Detects empty or malformed condition groups.
- **Threshold & Window Checks**: Requires threshold $\ge 1$ and time window $\ge 1000\text{ ms}$ if specified.
- **MITRE Verification**: Verifies referenced techniques against the canonical MITRE ATT&CK knowledge base (`T1059.001`, `T1078`, `T1021`, etc.). Unrecognized techniques return non-blocking warnings.

---

## 6. Side-Effect Free Dry-Run Simulation

The testing and simulation harness (`app/core/security/detection-engine.ts`) allows analysts to replay rules against local telemetry:

1. **Zero Side-Effects**: Does NOT create entries in `alerts`, `incidents`, `cases`, or `evidence`.
2. **Evaluation Metrics**:
   - `eventsEvaluated`: Total events in the evaluation sample window.
   - `eventsMatched`: Count of matching events.
   - `executionTimeMs`: Processing latency.
   - `matchedEventIds`: Sampled IDs of matching telemetry.
3. **Condition Explainability**: For each evaluated event, the engine produces explicit condition-by-condition match summaries:
   - Process Execution $\to$ `eventType == "PROCESS_EXECUTION"` (Matched)
   - Command Line $\to$ `commandLine contains "powershell"` (Matched)
   - Severity $\to$ `severity >= HIGH` (Matched)

---

## 7. Structural Version Diff Engine

The diff engine (`diffRuleVersions()`) compares any two versions or draft modifications structurally:
- Modified root fields (severity, category, threshold, time window, description).
- Modified event type subscriptions.
- Modified condition predicates and groupings.
- Added / removed MITRE technique mappings and tags.

---

## 8. Runtime Pipeline & Alert Provenance

When an incoming `SecurityEvent` matches an active rule:
1. `LocalProvider._processEventForDetections` queries all rules where `status === 'ENABLED'`.
2. The evaluator evaluates conditions.
3. Upon threshold match, `buildAlertFromMatch` constructs an `Alert` stamped with:
   - `ruleId`: e.g. `"RULE-0001"`
   - `ruleVersion`: e.g. `1`
4. Analysts navigating alerts in the spatial UI can immediately jump to the exact historical rule version responsible for triggering the detection.

---

## 9. Role-Based Access Control (RBAC)

Rule authoring integrates with the existing 4-tier SOC RBAC model:

| Role | Read Rules | Test / Simulate | Author Drafts | Manage / Publish / Toggle |
|---|:---:|:---:|:---:|:---:|
| **SOC_ANALYST** | Yes | Yes | Yes | No (Approval/Manager Required) |
| **THREAT_HUNTER** | Yes | Yes | Yes | Yes |
| **SOC_RESPONDER** | Yes | No | No | No |
| **SOC_MANAGER** | Yes | Yes | Yes | Yes |

Enforcement is implemented at both the service layer (`LocalProvider`) and in the spatial UI buttons/controls.

---

## 10. Audit Logging

Meaningful detection engineering lifecycle events are recorded in the tamper-evident offline audit log:
- `RULE_CREATED`: New rule drafted.
- `RULE_EDITED`: Existing draft updated.
- `RULE_VALIDATED`: Rule checked against validation engine.
- `RULE_TEST_EXECUTED`: Dry-run simulation executed with test run ID.
- `RULE_PUBLISHED`: Rule published and immutable version snapshot created.
- `RULE_ENABLED`: Rule activated for live runtime evaluation.
- `RULE_DISABLED`: Rule paused from runtime evaluation.
- `RULE_DEPRECATED`: Rule permanently retired.

---

## 11. Storage & Offline Persistence

### IndexedDB Upgrade (v8 $\to$ v9)
- Incremented `DB_VERSION` from 8 to 9.
- Added object stores:
  - `detection_rules` (Key: `id`, Indexes: `ruleId`, `status`, `enabled`, `category`, `severity`)
  - `detection_rule_versions` (Key: `id`, Indexes: `ruleId`, `version`)
  - `detection_test_runs` (Key: `id`, Indexes: `ruleId`, `executedAt`)
- Migrated legacy baseline rules on first launch to canonical v1 `ENABLED` rules in the new store with metadata tracking.

---

## 12. Spatial Detection Engineering UI

The Detection Engineering workspace (`SpatialMode: 'DETECTION'`) is accessible via hotkey `[D]` or the spatial navbar:

1. **Left Panel — Rule Library**: Searchable, filterable list of rules displaying status badges, severity markers, versions, and MITRE tags.
2. **Center Panel — Visual Rule Canvas**: Holographic flow representation showing Event Trigger $\to$ Conditions $\to$ Match Criteria $\to$ Alert Generation. Includes interactive condition builder.
3. **Right Panel — Rule Inspector & Version Manager**: Full metadata inspection, version selector, structural diff viewer, and lifecycle action buttons (`Validate`, `Publish`, `Enable`, `Disable`, `Deprecate`).
4. **Bottom Panel — Dry-Run Simulation Harness**: Execution controls, sample window selectors, summary cards, and per-event condition match explainers.
5. **Cross-Workspace Workflows**:
   - Threat Hunting $\to$ Detection: "Convert to Detection Rule" button in hunting inspector converts compatible AST predicates into a new detection rule draft.
   - Event $\to$ Detection: Creates a pre-populated detection draft from an observed event.

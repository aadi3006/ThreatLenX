# EXPLAIN-SEC SPATIAL — STEP 3 DETECTION & ALERT ENGINE

## Executive Summary

Step 3 introduces the foundational local **Detection & Alert Engine** on top of the canonical `SecurityEvent` engine established in Step 2.

The architectural separation is strictly preserved:
```
SECURITY EVENT (Step 2: "What happened?")
      ↓
DETECTION RULE (Declarative comparison logic)
      ↓
RULE EVALUATION (Deterministic, pure function, zero side effects)
      ↓
ALERT (Step 3: "Is it suspicious?")
      ↓
SOC COMMAND CENTER & ANALYST INVESTIGATION
      ↓
(Future Step 4 Correlation: "Do these represent one attack?" → Incident)
```

**Crucial Boundaries Maintained:**
- An **Alert is NOT an Incident**. Step 3 **never** automatically creates incidents.
- All evaluation is **100% offline**, deterministic, and local.
- Strictly prohibited dynamic code evaluation (`eval()`, `Function()`).
- High-fidelity deduplication and throttling via deterministic SHA fingerprinting and 15-minute time bucketing.
- IndexedDB migration from version 2 to 3 creates a dedicated `'alerts'` object store with 7 query indices without modifying or clearing historical data.

---

## 1. Detection Architecture

The Detection Engine operates as a pure, reactive pipeline sitting between event ingestion and SOC presentation:

```
                  SECURITY TELEMETRY
                         │
                         ▼
                  SecurityEvent
                         │
                         ▼
                 Detection Engine
                (Applicability Filter)
                    /    |    \
                   /     |     \
               Rule 1  Rule 2  Rule 3
                  \      |      /
                   \     |     /
                         ▼
                    RULE MATCH
                         │
                         ▼
                   Alert Builder
                         │
                         ▼
             Deterministic Fingerprint
             hash(ruleId|assetId|userId|timeBucket)
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
   New Fingerprint?              Existing Active Alert?
        │                                 │
   Create Alert                  Increment occurrenceCount,
   Status: 'NEW'                 update lastSeenAt,
   occurrenceCount: 1            append sourceEventId
        │                                 │
        └────────────────┬────────────────┘
                         ▼
               Persist to IndexedDB
               Store: 'alerts' (v3)
                         │
                         ▼
              SecurityService Events
         'ALERT_CREATED' / 'ALERT_UPDATED'
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Command Center     Compact Stream   Alert Inspector
     KPI Halo          Left Flank      Provenance Modal
```

---

## 2. DetectionRule Model

Defined in `app/core/models/detection.ts`:

```typescript
export interface RuleCondition {
  field: string;
  operator: RuleConditionOperator;
  value?: any;
}

export type RuleConditionOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'CONTAINS'
  | 'NOT_CONTAINS'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'GREATER_THAN'
  | 'LESS_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN_OR_EQUAL'
  | 'IN_LIST'
  | 'NOT_IN_LIST'
  | 'EXISTS';

export interface DetectionRule {
  id: string; // e.g. 'DET-PROC-001'
  name: string;
  description: string;
  enabled: boolean;
  severity: Severity; // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  category?: EventCategory;
  eventTypes?: string[];
  conditions: RuleCondition[];
  threshold?: number;
  timeWindowMs?: number;
  mitreTechniqueId?: string; // e.g. 'T1059.001'
  mitreTactic?: string;
  tags?: string[];
  author?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## 3. Alert Model

Defined in `app/core/models/detection.ts` and re-exported via `app/core/models/alert.ts`:

```typescript
export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED';

export interface Alert {
  id: string; // e.g. 'alt-1774350000000-84a1bc2d'
  ruleId: string; // Stable reference to triggering DetectionRule
  ruleName: string;
  fingerprint: string; // Deterministic deduplication hash
  title: string;
  description: string;
  severity: Severity;
  status: AlertStatus;
  category: EventCategory;
  createdAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number; // Incremented on throttled/duplicate occurrences
  sourceEventIds: string[]; // Strict causal provenance chain
  primaryEventId?: string;
  assetId?: string;
  userId?: string;
  iocIds?: string[];
  mitreTechniqueId?: string;
  incidentId?: string; // Optional: Alert is NOT an incident
  metadata?: Record<string, any>;
}
```

---

## 4. Deterministic Rule Evaluator

Defined in `app/core/security/detection-engine.ts`:

### Evaluation Flow
1. **Safety Contract**: No `eval()`, no `Function()`, no side effects.
2. **Applicability Filter**:
   - Skips disabled rules (`rule.enabled === false`).
   - Pre-filters by `rule.eventTypes` (matches case-insensitively).
   - Pre-filters by `rule.category` unless generalized (`SECURITY_CONTROL`).
3. **Conjunction of Conditions**: All conditions in `rule.conditions` must evaluate to `TRUE`.
4. **Nested Field Access**: Supports dot-notation paths (e.g. `metadata.targetProcess`) without throwing.
5. **Returns**: `'MATCH' | 'NO_MATCH' | 'INVALID'`.

---

## 5. Alert Deduplication & Throttling

To prevent alert floods while preserving distinguishable detections across different hosts and threat behaviors:

- **Fingerprint Formula**:
  $$\text{fingerprint} = \text{hash}(\text{ruleId} \mid \text{assetId} \mid \text{userId} \mid \text{eventType} \mid \text{primaryIOC} \mid \text{timeBucket})$$
- **Time Window**: Default 15 minutes ($900{,}000\,\text{ms}$).
- **Behavior on Duplicate Occurrence**:
  - Existing open alert (`NEW` or `ACKNOWLEDGED`) with identical fingerprint is retrieved.
  - `occurrenceCount` increments ($+1$).
  - `lastSeenAt` updates to the new event timestamp.
  - New `eventId` is appended to `sourceEventIds` for complete provenance.
  - No redundant alert entity is created.

---

## 6. Alert Lifecycle & State Machine

```
               [EVENT INGESTION]
                      │
                      ▼
               ┌─────────────┐
               │     NEW     │  (Default state on match)
               └──────┬──────┘
                      │
           Analyst Acknowledges
                      │
                      ▼
               ┌─────────────┐
               │ ACKNOWLEDGED│  (Assigned / In Triage)
               └──────┬──────┘
                      │
             Incident Resolved /
             Triage Concluded
                      │
                      ▼
               ┌─────────────┐
               │  RESOLVED   │  (Terminal status, audits closed)
               └─────────────┘
```

Every transition:
1. Enforces RBAC permissions (`canAcknowledgeAlert`, `canResolveAlert`).
2. Mutates state and updates `lastSeenAt`.
3. Persists directly to IndexedDB object store `'alerts'`.
4. Writes an immutable audit record (`ALERT_ACKNOWLEDGED`, `ALERT_RESOLVED`).
5. Emits `ALERT_UPDATED` notification to subscribers.

---

## 7. Role-Based Access Control (RBAC)

Integrated into `app/core/auth/rbac.ts`:

| Role | View Alerts | Acknowledge Alert | Resolve Alert | Manage Detection Rules |
| :--- | :---: | :---: | :---: | :---: |
| **L1_ANALYST** | Yes | Yes (`INCIDENT_TRIAGE`) | Yes (`INCIDENT_TRIAGE`) | No |
| **L2_ANALYST** | Yes | Yes (`INCIDENT_TRIAGE`) | Yes (`INCIDENT_TRIAGE`) | No |
| **INCIDENT_RESPONDER** | Yes | Yes (`INCIDENT_TRIAGE`) | Yes (`CONTAINMENT_APPROVE`) | No |
| **THREAT_HUNTER** | Yes | No | No | Yes (`THREAT_HUNT_EXECUTE`) |
| **SOC_MANAGER** | Yes | Yes | Yes | Yes (`CONFIG_MANAGE`) |

---

## 8. IndexedDB Schema Upgrade (Version 2 → Version 3)

In `app/core/storage/idb-store.ts`:
- Incremented `DB_VERSION` to `3`.
- Added `'alerts'` object store with keyPath `'id'`.
- Configured 7 indices:
  - `by_ruleId`: For rule-based alert queries.
  - `by_severity`: For DEFCON scoring and severity filtering.
  - `by_status`: For open alert triage (`NEW`, `ACKNOWLEDGED`).
  - `by_asset`: For asset impact correlation.
  - `by_incident`: For incident linking.
  - `by_createdAt`: For temporal sorting.
  - `by_fingerprint`: For $O(1)$ deduplication lookups.
- Completely non-destructive: preserved all `'events'`, `'incidents'`, `'assets'`, `'users'`, `'iocs'`, `'response_actions'`, and `'audit_records'`.

---

## 9. Grounded Operation BlackTide Detection Rules

Catalogue defined in `app/core/security/detection-rules.ts`:

1. **`DET-AUTH-001`**: Suspicious Authentication & Password Spray Activity (`T1110.001` - Credential Access)
   - Evaluates: `AUTHENTICATION` events with `MEDIUM`/`HIGH`/`CRITICAL` severity matching failed logins or Kerberos preauth failures.
2. **`DET-PROC-001`**: Suspicious Obfuscated Process Execution (`T1059.001` - Execution)
   - Evaluates: `PROCESS` events with `HIGH`/`CRITICAL` severity executing dropper binaries (`svchost32.exe`, `powershell.exe`, `cmd.exe`).
3. **`DET-NET-001`**: Cobalt Strike C2 Beaconing & Malicious DNS Queries (`T1071.001` - Command and Control)
   - Evaluates: `NETWORK` events with `HIGH`/`CRITICAL` severity matching outbound beacons or suspicious DNS lookups.
4. **`DET-IOC-001`**: High-Confidence Indicator of Compromise Match (`T1071` - Command and Control)
   - Evaluates: Events containing active IOC IDs (`iocIds` exists).
5. **`DET-PER-001`**: Unauthorized Registry Persistence Modification (`T1547.001` - Persistence)
   - Evaluates: `ENDPOINT` registry events containing `Run key` modifications.
6. **`DET-EXF-001`**: Sensitive File Collection & Exfiltration Staging (`T1560.001` - Collection)
   - Evaluates: `FILE` events with `HIGH`/`CRITICAL` severity creating archives or staging file encryption.
7. **`DET-GW-001`**: High-Risk Email Gateway Attachment Delivery (`T1566.001` - Initial Access)
   - Evaluates: Security control gateway alerts delivering untrusted attachments.

---

## 10. SOC Command Center Integration

1. **Top Telemetry Sector (KPI Halo)**:
   - Displays real canonical alert metrics:
     ```
     OPEN ALERTS       09
     CRITICAL ALERTS   04
     HIGH ALERTS       05
     ```
   - Clickable cell toggles the interactive Alert Inspector modal.
2. **Left Flank Panel (Mode Selector)**:
   - Toggle tabs: `[INCIDENTS (3)]` and `[ALERTS (9)]`.
   - When `ALERTS` is selected, renders the compact alert stream:
     - Severity badge (`CRITICAL`, `HIGH`, `MEDIUM`)
     - Timestamp (`14:03:19`)
     - Title (`Cobalt Strike C2 Beaconing...`)
     - Target Asset (`asset-001`)
     - Occurrence badge (`x2`)
     - Action cue (`INSPECT PROVENANCE`)
3. **Interactive Alert Inspector Modal**:
   - Two-pane cyber HUD interface:
     - Left pane: Filterable stream of active alerts (`ALL`, `NEW`, `ACKNOWLEDGED`, `RESOLVED`, `CRITICAL`).
     - Right pane: Full provenance inspection:
       - Rule ID and MITRE ATT&CK technique pill.
       - Affected Asset and User accounts.
       - First seen and last seen timestamps with occurrence count.
       - Associated Threat Indicators (IOCs).
       - Collapsible causal source telemetry events with raw payload inspection.
       - Direct action controls: `[ACKNOWLEDGE]`, `[RESOLVE ALERT]`, `[INVESTIGATE INCIDENT]`, and `[FOCUS ASSET]`.

---

## 11. Automated Verification & Test Results

1. **Automated Unit Test Suite (`scripts/test-detection-engine.ts`)**:
   - Tested 14 core engine capabilities:
     - Condition evaluation (EQUALS, NOT_EQUALS, CONTAINS, STARTS_WITH, ENDS_WITH, comparisons, IN_LIST, EXISTS).
     - Conjunction of multiple conditions.
     - Disabled rules pre-filtering.
     - Applicability pre-filtering by category and eventType.
     - Deterministic alert creation and provenance retention.
     - Deterministic alert fingerprinting across time buckets.
     - Querying and filtering (severity, status, asset, text search).
     - Statistics computation (counts, byStatus, byRule).
     - Full evaluation over Operation BlackTide seed dataset (11 raw rule matches, 7 distinct detection rules triggered).
     - RBAC permissions validation across all roles.
   - Result: **14/14 tests passed perfectly**.
2. **TypeScript Compilation Check**:
   - `npx tsc --noEmit` exited with code 0 (zero errors).
3. **Production Build**:
   - `npm run build:vercel` built successfully in 612ms.
4. **End-to-End Browser Verification (`step3_alert_engine_1790008867496.webp`)**:
   - KPI halo verified: 9 open alerts (4 critical, 5 high).
   - Left flank compact alert stream verified.
   - Alert Inspector modal verified with expanded JSON payload.
   - `ACKNOWLEDGE` action verified: badge updated and audit log recorded.
   - `RESOLVE` action verified: status updated, open alerts decremented from 9 to 8.
   - Telemetry simulation (`+ SIMULATE INGEST`) verified: triggered new detections.
   - Page reload verified: state strictly persisted from IndexedDB.

---

## 12. Known Limitations & Clean Handoff to Step 4

### Step 3 Scope Boundaries Respected:
- **No Automatic Incidents**: Alerts remain standalone detection objects. They are not incidents.
- **Single-Event Detections**: Rules evaluate against individual SecurityEvents within a time bucket.
- **Local Seed Catalogue**: Detection rules are deterministic seed objects with runtime extensibility.

### Exact Recommended Starting Point for Step 4 (Correlation Engine):
1. **Multi-Event Correlation**: Build the Correlation Engine to consume canonical `Alert`s and correlated `SecurityEvent`s across shared entities (e.g. same `assetId`, `userId`, `iocId`, or temporal clustering).
2. **Attack Graph & Kill-Chain Mapping**: Connect correlated alerts into kill-chain stages (Initial Access $\to$ Execution $\to$ Persistence $\to$ C2 $\to$ Impact).
3. **Incident Generation**: Synthesize multi-alert correlations into canonical `Incident` models with automated risk scoring and entity aggregation.

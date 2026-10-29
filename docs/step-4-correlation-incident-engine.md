# STEP 4 — CORRELATION & INCIDENT CREATION ENGINE

## Architectural Overview & Objective

EXPLAIN-SEC SPATIAL transforms isolated security telemetry into coherent, explainable security investigations. Prior to Step 4, the SOC possessed a normalized Security Event Engine (Step 2) and a deterministic Detection & Alert Engine (Step 3). However, each alert was evaluated independently without automated synthesis.

Step 4 implements the **Local Correlation & Incident Creation Engine**, bridging the gap between isolated detection alerts and actionable spatial incidents:

```
SECURITY EVENTS (Telemetry)
       │
       ├──────────────┐
       ↓              ↓
DETECTION RULES   CORRELATION SIGNALS
       ↓              ↓
    ALERTS ───────────┘
           ↓
   CORRELATION ENGINE
   (Deterministic Multi-Signal Scoring)
           ↓
  CORRELATED ACTIVITY / CLUSTERS
           ↓
   SECURITY INCIDENTS (P1 - P4)
           ↓
  SPATIAL INVESTIGATION (Universe, Timeline, Attack Graph, Radar, IOCs)
```

The fundamental domain distinction remains strictly enforced:
- **SecurityEvent**: Something that happened in the environment.
- **Alert**: A detection rule identified suspicious activity.
- **Incident**: A collection of related events and alerts representing one coherent security investigation.

---

## 1. Correlation Architecture

The correlation engine is implemented as a pure, deterministic offline domain service in `app/core/security/correlation-engine.ts`, invoked by `LocalProvider` (`app/core/providers/local-provider.ts`) and exposed via the `SecurityService` facade (`app/core/security-service.ts`).

### Canonical Data Flow
```
IndexedDB (v4)
      ↓
LocalProvider
      ↓
SecurityService
      ↓
SOC Domain Services & Spatial UI
```
- **Zero Cloud Dependencies:** 100% offline, zero `fetch()`, zero external SIEM, zero cloud AI.
- **No Direct IndexedDB Access by UI:** All spatial components query strictly through `SecurityService`.
- **Single Render & Vision Loop:** Exactly one MediaPipe instance and one RAF loop maintained.

---

## 2. Deterministic Correlation Signals

The engine evaluates 6 distinct deterministic correlation signals supported directly by the canonical telemetry schema:

| Signal | Type | Weight | Evaluation Logic |
| :--- | :--- | :--- | :--- |
| **Shared Asset** | `SAME_ASSET` | **+30 pts** | Exact match on `assetId` between incoming alert and incident entities. |
| **Shared Threat Indicator** | `SHARED_IOC` | **+35 pts** | Set intersection between alert IOCs (`iocIds`) and incident IOCs (`iocs`). |
| **Shared User Context** | `SAME_USER` | **+20 pts** | Exact match on `userId` between alert and incident user identities. |
| **Temporal Proximity** | `TEMPORAL_PROXIMITY` | **+15 pts** | Scaled proximity: full 15 pts within 15 minutes, linear falloff to 0 at configurable window (default 60 minutes). |
| **Network Destination** | `SHARED_NETWORK_DEST`| **+15 pts** | Match on target C2 IP (`dstIp`) or threat domain (`domain`). |
| **MITRE Progression** | `MITRE_KILL_CHAIN_PROGRESSION`| **+20 pts** | Logical progression across adjacent MITRE kill-chain stages (Initial Access $\to$ Execution $\to$ Persistence $\to$ Credential Access $\to$ Lateral Movement $\to$ Exfiltration $\to$ Impact). |

---

## 3. Correlation Scoring & Human Explainability

The correlation score is the deterministic sum of all matched signal weights, clamped between 0 and 100:

$$\text{Confidence Score} = \min\left(100, \sum_{i=1}^{n} \text{Weight}_i\right)$$

### Explainable Grouping Evidence
Every grouping operation generates clear, human-readable explanatory bullet points attached to `incident.correlationReasons`, such as:
- `✓ Same asset: asset-001 (FINWS-027) (+30 pts)`
- `✓ Shared threat indicator(s): ioc-002 (185.220.101.47) (+35 pts)`
- `✓ Same user identity: user-001 (r.morrison) (+20 pts)`
- `✓ Correlated MITRE attack path: T1204.002 → T1003.001 (+20 pts)`
- `✓ Temporal proximity within 3.2 min (+14 pts)`

An analyst can immediately inspect **why** the system grouped telemetry into an incident.

---

## 4. Correlation Thresholds

| Threshold | Score Range | Action |
| :--- | :--- | :--- |
| **AUTOMATIC_CORRELATION_THRESHOLD** | **$\ge 60$** | **Automatic Grouping:** Alert is attached to existing incident; events linked; severity/priority re-derived; audit emitted. |
| **CANDIDATE_CORRELATION_THRESHOLD** | **$40 - 59$** | **Candidate Relationship:** Flagged for analyst inspection without automatic mutation. |
| **LOW CONFIDENCE** | **$< 40$** | **Separate:** Activity kept distinct; prevents unjustified merging across unrelated hosts. |

---

## 5. Canonical Incident Model

The `Incident` interface in `app/core/models/incident.ts` was evolved to support complete correlation metadata without duplicating underlying event objects:

```typescript
export type IncidentPriority = 'P1' | 'P2' | 'P3' | 'P4';

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  priority?: IncidentPriority;
  riskScore: number;
  status: IncidentStatus;
  confidence: number;
  source?: string;
  createdAt: string;
  updatedAt: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  assignedTo?: string;
  assignedRole?: string;
  affectedAssets: string[];
  affectedUsers: string[];
  iocs: string[];
  mitreTechniques: string[];
  timelineEvents: TimelineEvent[];
  correlationChain: CorrelationChainItem[];
  evidence: Evidence[];
  summary?: string;
  attackPathId?: string;

  // Step 4 Correlation Extensions
  description?: string;
  eventIds?: string[];
  alertIds?: string[];
  correlationScore?: number;
  correlationReasons?: string[];
  tags?: string[];
}
```

---

## 6. Incident Lifecycle vs Response State

The incident investigation lifecycle and the SOAR response lifecycle remain strictly decoupled:

- **Incident Lifecycle:**
  `NEW` $\longrightarrow$ `TRIAGED` $\longrightarrow$ `INVESTIGATING` $\longrightarrow$ `CONTAINING` $\longrightarrow$ `RESOLVED` $\longrightarrow$ `CLOSED` (or `FALSE_POSITIVE`)
- **Response Action Lifecycle:**
  `PROPOSED` $\longrightarrow$ `APPROVED` $\longrightarrow$ `EXECUTING` $\longrightarrow$ `ACTIVE` $\longrightarrow$ `COMPLETED` / `ROLLED_BACK`

An incident may be in `INVESTIGATING` while a containment action against `asset-001` is `ACTIVE`. They do not collapse into each other.

---

## 7. Incident Deduplication & Deduplication Strategy

To prevent alert flooding and duplicate incident creation:
1. When a security event matches detection rules, `generateAlertFingerprint(rule, event, window)` identifies repeat occurrences and increments `occurrenceCount` and `lastSeenAt` rather than spawning duplicate alerts.
2. When correlation executes, `findBestMatchingIncident(alert, openIncidents)` locates the highest-confidence active open incident.
3. If an open incident already matches with score $\ge 60$, the alert and events attach to that open incident, updating its temporal envelope (`lastSeenAt`), entity sets, and aggregated severity/priority without spawning duplicate incidents.

---

## 8. Event and Alert Relationships

- **Event $\to$ Incident:** Every correlated `SecurityEvent` stores `event.incidentId = incident.id` and the incident maintains `incident.eventIds = [...]`.
- **Alert $\to$ Incident:** Every correlated `Alert` stores `alert.incidentId = incident.id` and the incident maintains `incident.alertIds = [...]`.
- Full objects are not duplicated; relationships are maintained through stable, canonical IDs.

---

## 9. Deterministic Severity & Priority Aggregation

### Severity Aggregation (`deriveIncidentSeverity`)
- If any correlated alert is `CRITICAL` $\longrightarrow$ Incident severity is **`CRITICAL`**.
- If $\ge 2$ correlated alerts are `HIGH` $\longrightarrow$ Elevated to **`CRITICAL`** (multi-vector severe intrusion).
- If 1 correlated alert is `HIGH` $\longrightarrow$ Incident severity is **`HIGH`**.
- If any alert is `MEDIUM` $\longrightarrow$ Incident severity is **`MEDIUM`**.
- Otherwise $\longrightarrow$ **`LOW`** / **`INFO`**.

### Priority Derivation (`deriveIncidentPriority`)
- **P1**: `CRITICAL` severity OR $\ge 2$ affected assets.
- **P2**: `HIGH` severity OR $\ge 3$ correlated alerts.
- **P3**: `MEDIUM` severity.
- **P4**: `LOW` or `INFO` severity.

---

## 10. Operation BlackTide Validation

Operation BlackTide (`incident-001`) serves as the canonical test scenario:
- **Telemetry Ingestion:** 15 canonical seed events across spearphishing, process execution (`svchost32.exe`), credential access (`lsass.exe`), lateral movement (`SMB` to `FINDC-001`), NAS ransomware deployment, and exfiltration (`update-sync.blacktide-exfil.net`).
- **Detection Matching:** Triggered behavioral rules `RANSOM_DROPPER_BEHAVIORAL`, `LSASS_ACCESS_PATTERN`, `LATERAL_MOVEMENT_ADMIN_SMB`, `EXFIL_VOLUME_THRESHOLD_HTTPS`.
- **Correlation Synthesis:** Correlated together with confidence score **100/100** via shared asset `FINWS-027` (+30), shared C2 IP `185.220.101.47` (+35), shared user `r.morrison` (+20), and kill-chain progression (+20).
- **Incident Outcome:** Consolidated into **ONE coherent incident** (`incident-001`) with severity **CRITICAL**, priority **P1**, 9 alerts, 3 assets, 5 IOCs, and full chronological timeline.
- **Isolation of Unrelated Activity:** Brute-force attacks against the perimeter firewall (`EDGE-FW-01` / `asset-005`) correctly isolated into `incident-002` (`P3`, `MEDIUM`).

---

## 11. Spatial Investigation & Command Center Integration

- **Command Center:**
  - Distinct operational counters: `EVENTS` (1,248+), `OPEN ALERTS` (10), `ACTIVE INCIDENTS` (2), `CRITICAL INCIDENTS` (1).
  - Incident cards display priority badges (`P1`, `P3`), severity badges, and correlated alert counts.
  - Alert Inspector displays `CORRELATED INCIDENT: incident-001` and provides a direct `INVESTIGATE INCIDENT` action button.
- **Spatial Investigation Hub:**
  - Context strip displays `PRIORITY: P1`, `ALERTS: 9`, `ASSETS: 3`, `IOCs: 5`.
  - Seamless navigation through Timeline, Attack Graph, System Radar, IOC Constellation, and MITRE Matrix.
  - Exiting returns cleanly to the Command Center HUD.

---

## 12. IndexedDB Schema Migration (v3 $\to$ v4)

- `DB_VERSION` bumped to **4**.
- Object store migration:
  - Added indices to `'incidents'` store: `by_status`, `by_severity`, `by_createdAt`.
  - Added metadata flag: `META_CORRELATION_SEEDED`.
  - Updated `resetLocalData()` to ensure all 9 stores (`incidents`, `assets`, `users`, `iocs`, `response_actions`, `audit_records`, `events`, `alerts`, `meta`) are cleanly reset during testing.

---

## 13. RBAC & Audit Generation

- **RBAC Policy:**
  - Automated engine operations operate with system authorization.
  - Analysts with `INCIDENT_TRIAGE` or `INCIDENT_INVESTIGATE` permissions can correlate alerts and attach events (`canCorrelate`).
  - Only authorized roles can escalate (`INCIDENT_ESCALATE`) or create manual incidents (`INCIDENT_CREATE`).
- **Audit Records:**
  - `INCIDENT_AUTOMATICALLY_CORRELATED`: Generated on automated cluster creation.
  - `INCIDENT_CORRELATION_UPDATED`: Generated when new alerts attach to open incidents.
  - `INCIDENT_ALERT_ATTACHED`: Generated when alerts are manually or automatically linked.
  - `INCIDENT_EVENT_ATTACHED`: Generated when telemetry events are linked.

---

## 14. Verification & Testing

### Automated Unit Test Suite (`scripts/test-step4-correlation.ts`)
- Evaluates 42 discrete test assertions covering temporal proximity, asset matching, user matching, IOC matching, network signals, MITRE progression, threshold boundaries, severity aggregation, priority derivation, timeline synthesis, and RBAC.
- **Result:** `42 PASSED, 0 FAILED`.

### TypeScript & Production Build
- `npx tsc --noEmit`: 0 errors.
- `npm run build:vercel`: Production bundle built in 759ms with zero errors.

### Browser Verification
- Verified on `http://localhost:3000/` via browser agent:
  - Command Center HUD with P1 incident cards.
  - Alert Inspector with `CORRELATED INCIDENT: incident-001` and `INVESTIGATE INCIDENT` workflow.
  - Spatial Investigation Hub with context strip indicators and timeline navigation.

---

## 15. Known Limitations & Future Roadmap

1. **Static Predefined Graph Layouts:** Complex dynamically-spawned incidents currently use the procedural fallback attack graph generator. Custom graph auto-layout algorithms will be refined in future stages.
2. **Cross-Tenant / Multi-Cloud Correlation:** Intentionally out of scope. EXPLAIN-SEC SPATIAL is an offline-first sovereign SOC.
3. **Manual Splitting / Merging UI:** While the correlation engine deterministically groups related telemetry, an analyst-facing UI for splitting and merging incidents belongs to a future case-management stage.

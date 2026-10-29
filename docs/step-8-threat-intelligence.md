# STEP 8 — THREAT INTELLIGENCE ENGINE IMPLEMENTATION

## 1. Executive Summary

Step 8 introduces a deterministic, 100% offline Threat Intelligence Engine to the EXPLAIN-SEC SPATIAL SOC. The system contextualizes indicators of compromise (IOCs) and models assessed semantic relationships across telemetry, detection alerts, incidents, proactive threat hunts, operational cases, forensic evidence, assets, users, and MITRE ATT&CK techniques.

### Core Architectural Principle

$$\text{RAW SECURITY EVENT} \longrightarrow \mathbf{IOC} \longrightarrow \mathbf{THREAT\ INTELLIGENCE} \longrightarrow \mathbf{CONTEXT\ /\ RELATIONSHIPS} \longrightarrow \text{ALERT / INCIDENT / HUNT / CASE} \longrightarrow \text{INVESTIGATION}$$

- **IOC Identity**: Represents canonical observable identity recorded by the SOC (`id`, `type`, `value`, `isBlocked`, `reputationScore`). The canonical IOC store remains authoritative.
- **Threat Intelligence**: Adds analytical depth, assessed confidence, malware family/campaign context, dynamic first-seen/last-seen timestamps, and directional graph relationships. Threat Intelligence is **NOT** a second IOC database.

---

## 2. Canonical Threat Intelligence Data Model

Located in `app/core/models/threat-intel.ts`:

```typescript
export type IntelConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type IntelClassification = 'MALICIOUS' | 'SUSPICIOUS' | 'BENIGN' | 'UNKNOWN';
export type IntelSourceType =
  | 'LOCAL_SEED'
  | 'LOCAL_ANALYST'
  | 'DETECTION_ENGINE'
  | 'HUNT_ENGINE'
  | 'INCIDENT_ANALYSIS'
  | 'CASE_ANALYSIS'
  | 'DETERMINISTIC_LOCAL_ENGINE';

export type IntelRelationshipType =
  | 'COMMUNICATES_WITH' // IP/Domain <-> Asset
  | 'OBSERVED_ON'       // File/Hash/Registry <-> Asset
  | 'EXECUTED_BY'       // Process/File <-> User
  | 'ASSOCIATED_WITH'   // IOC <-> Incident / Case / ThreatHunt
  | 'INDICATES'         // IOC <-> Alert / Threat Type
  | 'USES'              // IOC / Malware Family <-> MITRE Technique
  | 'DELIVERS'          // Staged Hash / Payload <-> Dropped File
  | 'MAPS_TO'           // IOC <-> MITRE Technique
  | 'RELATED_TO';       // IOC <-> IOC

export type IntelTargetType =
  | 'IOC'
  | 'ASSET'
  | 'USER'
  | 'INCIDENT'
  | 'ALERT'
  | 'SECURITY_EVENT'
  | 'THREAT_HUNT'
  | 'CASE'
  | 'EVIDENCE'
  | 'MITRE_TECHNIQUE'
  | 'MALWARE_FAMILY'
  | 'CAMPAIGN';

export interface ThreatIntelRecord {
  id: string;
  indicatorId: string;
  indicatorType: IocType;
  indicatorValue: string;
  title: string;
  description?: string;
  confidence: IntelConfidence;
  severity: Severity;
  classification: IntelClassification;
  firstSeenAt?: string;
  lastSeenAt?: string;
  sourceType: IntelSourceType;
  sourceName?: string;
  tags: string[];
  threatTypes: string[];
  malwareFamilies?: string[];
  campaigns?: string[];
  actors?: string[];
  mitreTechniqueIds?: string[];
  relatedIndicatorIds?: string[];
  observationsCount: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ThreatIntelRelationship {
  id: string;
  sourceType: 'IOC';
  sourceId: string;
  targetType: IntelTargetType;
  targetId: string;
  relationshipType: IntelRelationshipType;
  confidence: IntelConfidence;
  source: string;
  createdAt: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}
```

---

## 3. Deterministic Local Confidence Scoring

Confidence is strictly an **analytical intelligence assessment**, distinct from operational severity, priority, or blast radius:

- **HIGH**:
  - Indicator observed in confirmed, correlated incident telemetry with 2+ security events, OR
  - Canonical IOC baseline confidence $\ge 0.90$ / reputation $\ge 90$.
- **MEDIUM**:
  - Indicator triggered detection alerts or isolated security events, OR
  - Canonical IOC baseline confidence $\ge 0.70$.
- **LOW**:
  - Unobserved seed indicator or single unverified observable.

---

## 4. Dynamic First-Seen & Last-Seen Derivation

Timestamps are never hardcoded or manually duplicated when calculating local intelligence. `ThreatIntelEngine.deriveObservations()` scans:
1. Canonical security events (`events`)
2. Detection alerts (`alerts`)
3. Correlated incidents (`incidents`)
4. Proactive threat hunts (`threat_hunts`)
5. Initial IOC timestamps (`firstSeen`, `lastSeen`)

`firstSeenAt` resolves to the minimum ISO timestamp; `lastSeenAt` resolves to the maximum ISO timestamp across all observed touchpoints.

---

## 5. Offline Enrichment Pipeline (`enrichIndicatorLocally`)

The engine operates 100% offline without remote feeds or cloud APIs:

1. **Indicator Ingestion**: Validates that the indicator exists in the canonical `iocs` store.
2. **Telemetry Scan**: Aggregates occurrences across `events`, `alerts`, `incidents`, `threat_hunts`, `cases`, and `evidence`.
3. **Confidence Derivation**: Computes deterministic confidence.
4. **Graph Edge Synthesis**:
   - `IOC -> Asset`: `OBSERVED_ON` for all compromised or beaconing hosts.
   - `IOC -> Incident`: `ASSOCIATED_WITH` for correlated investigations.
   - `IOC -> Alert`: `INDICATES` for detection alerts containing the observable.
   - `IOC -> MITRE Technique`: `MAPS_TO` for techniques executed by or matching the observable.
   - `IOC -> Malware Family`: `DELIVERS` / `USES` (e.g. `BlackCat/ALPHV`).
   - `IOC -> Campaign`: `ASSOCIATED_WITH` (e.g. `Operation BlackTide`).
   - `IOC -> IOC`: `COMMUNICATES_WITH` / `RELATED_TO` (e.g. C2 IP $\leftrightarrow$ Exfiltration Domain).
5. **Persistence**: Saves records and relationship edges to IndexedDB stores `threat_intel` and `threat_intel_relationships`.
6. **Audit**: Emits `LOCAL_ENRICHMENT_EXECUTED` audit record.

---

## 6. Operation BlackTide Baseline Intelligence

The 5 canonical indicators in `seed-data.ts` are automatically seeded and enriched upon startup:

| Indicator ID | Type | Value | Confidence | Malware / Campaign | MITRE Mapping |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ioc-001` | `HASH_SHA256` | `b94f3e2a1c8d5f...` | `HIGH` | BlackCat/ALPHV | T1204.002 |
| `ioc-002` | `IP` | `185.220.101.47` | `HIGH` | Operation BlackTide | T1071.001 |
| `ioc-003` | `DOMAIN` | `update-sync.blacktide-exfil.net` | `HIGH` | Operation BlackTide | T1567.002 |
| `ioc-004` | `FILE_PATH` | `C:\Users\...\svchost32.exe` | `HIGH` | BlackCat/ALPHV | T1059.001 |
| `ioc-005` | `REGISTRY_KEY` | `HKCU\...\SysUpdate32` | `HIGH` | Operation BlackTide | T1547.001 |

No external threat actor attribution is fabricated; provenance is honestly marked as `LOCAL_SEED` and `DETERMINISTIC_LOCAL_ENGINE`.

---

## 7. IndexedDB Schema Migration (v7 $\to$ v8)

`DB_VERSION` bumped from 7 to 8 in `app/core/storage/idb-store.ts`. Existing stores and records remain untouched:

```typescript
case oldVersion < 8: {
  if (!db.objectStoreNames.contains('threat_intel')) {
    const intelStore = db.createObjectStore('threat_intel', { keyPath: 'id' });
    intelStore.createIndex('by_indicatorId', 'indicatorId', { unique: true });
    intelStore.createIndex('by_indicatorType', 'indicatorType');
    intelStore.createIndex('by_indicatorValue', 'indicatorValue');
    intelStore.createIndex('by_confidence', 'confidence');
    intelStore.createIndex('by_sourceType', 'sourceType');
    intelStore.createIndex('by_createdAt', 'createdAt');
    intelStore.createIndex('by_updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains('threat_intel_relationships')) {
    const relStore = db.createObjectStore('threat_intel_relationships', { keyPath: 'id' });
    relStore.createIndex('by_sourceId', 'sourceId');
    relStore.createIndex('by_targetId', 'targetId');
    relStore.createIndex('by_targetType', 'targetType');
    relStore.createIndex('by_relationshipType', 'relationshipType');
    relStore.createIndex('by_createdAt', 'createdAt');
  }
  break;
}
```

---

## 8. Role-Based Access Control (RBAC)

RBAC permissions defined in `app/core/models/auth.ts` and enforced in `app/core/auth/rbac.ts` & `LocalProvider`:

| Role | `THREAT_INTEL_READ` | `THREAT_INTEL_ENRICH` | `THREAT_INTEL_MANAGE` |
| :--- | :---: | :---: | :---: |
| `L1_ANALYST` | ✓ | ✓ | ✗ |
| `L2_ANALYST` | ✓ | ✓ | ✓ |
| `INCIDENT_RESPONDER` | ✓ | ✓ | ✗ |
| `THREAT_HUNTER` | ✓ | ✓ | ✓ |
| `SOC_MANAGER` | ✓ | ✓ | ✓ |
| `PLATFORM_ADMIN` | ✓ | ✓ | ✓ |

---

## 9. Security Audit Logging

Operations create append-only audit entries in `audit_records`:
- `THREAT_INTEL_CREATED`: Triggered on creation of local intelligence records.
- `THREAT_INTEL_UPDATED`: Triggered on patch updates.
- `CONFIDENCE_CHANGED`: Dedicated audit event when confidence assessment is adjusted.
- `LOCAL_ENRICHMENT_EXECUTED`: Triggered when local enrichment pipeline runs.

---

## 10. Spatial UI & Operational Integrations

1. **`ThreatIntelProfile.tsx` & `threat-intel.css`**:
   - Holographic modal with Chakra Petch headers and high-contrast typography.
   - Indicator value, type, and confidence badge.
   - First-seen and last-seen timestamps.
   - Observations counters with breakdown (Events, Alerts, Incidents, Hunts, Cases, Assets, Evidence).
   - Contextual chips for Malware Families, Campaigns, and MITRE ATT&CK techniques.
   - Interactive relationship list with one-click pivots.
   - "Re-run Local Enrichment" button executing live offline re-evaluation.
2. **`IOCConstellation.tsx` Integration**:
   - IOC Detail Strip features `⚡ INTEL PROFILE` button.
   - Double-clicking any IOC node in the constellation opens `ThreatIntelProfile`.
3. **`CommandCenter.tsx` Integration**:
   - `IOC INTEL` KPI cell displaying active IOCs and `{highConfidenceCount} HIGH CONF`.
   - Clicking the KPI cell directly opens intelligence inspection.
4. **`CaseWorkspace.tsx` & `EvidenceWorkspace.tsx`**:
   - Clickable IOC chips and references allow pivoting directly into the intelligence profile.

---

## 11. Verification & Testing Results

- **Unit & Integration Suite (`scripts/test-step8-intel.ts`)**:
  - 11 test suites, **34/34 tests passing cleanly (0 failures)**.
  - Full suite (Events, Detection, Correlation, Hunting, Cases, Evidence, Threat Intel) passes 100%.
- **Type Checking (`npx tsc --noEmit`)**:
  - 0 errors.
- **Production Build (`npm run build:vercel`)**:
  - Built cleanly in 588ms.
- **Offline Integrity**:
  - Zero network `fetch()` calls or external feeds.

# Step 8: Threat Intelligence Engine — Architectural Audit

## Executive Summary

This audit assesses the state of indicator and intelligence handling across the EXPLAIN-SEC Spatial SOC repository to prepare for **Step 8: Threat Intelligence Engine**.

Threat Intelligence is distinct from raw indicator logs (`IOC`):
- **SecurityEvent**: Raw/normalized observation (telemetry) on a system, network, or identity.
- **IOC**: An observable indicator (IP, domain, hash, file path, registry key, mutex) detected or recorded within the SOC.
- **Threat Intelligence**: Contextual, analytical knowledge about an indicator, its assessed confidence, malware family associations, campaign context, tactical MITRE mappings, and bidirectional relationships with assets, users, events, alerts, incidents, hunts, and cases.

---

## 1. Current Architecture Review

### 1.1 Existing IOC Model (`app/core/models/entity.ts`)
The project defines a canonical `IOC` model:
```typescript
export type IocType =
  | 'IP'
  | 'DOMAIN'
  | 'HASH_SHA256'
  | 'HASH_MD5'
  | 'URL'
  | 'FILE_PATH'
  | 'MUTEX'
  | 'REGISTRY_KEY';

export interface IOC {
  id: string;
  type: IocType;
  value: string;
  threatType: string;
  confidence: number;            // 0.0 - 1.0 numeric score
  firstSeen: string;
  lastSeen: string;
  reputationScore: number;       // 0-100 maliciousness score
  isBlocked: boolean;
  relatedIncidents: string[];    // Incident IDs
  relatedAssets: string[];       // Asset IDs
}
```
**Audit Finding**: The current `IOC` type represents an indicator observable with basic metadata and flattened string arrays for incidents and assets. It lacks:
- Granular, typed intelligence relationships (`COMMUNICATES_WITH`, `DELIVERS`, `MAPS_TO`, `INDICATES`, etc.).
- Malware family and campaign context.
- MITRE technique mappings.
- Observation counting and source provenance (`LOCAL_ANALYST`, `LOCAL_SEED`, `DETECTION_ENGINE`, etc.).
- An enrichment pipeline that correlates indicators against telemetry, alerts, hunts, and cases.

### 1.2 Existing Entity Relationships
- **SecurityEvent (`app/core/models/event.ts`)**: Contains optional `iocIds?: string[]`, along with telemetry fields: `srcIp`, `dstIp`, `fileHash`, `filePath`, `domain`, `url`.
- **Alert (`app/core/models/detection.ts`)**: Contains `iocIds?: string[]`, `mitreTechniqueId?: string`, and `sourceEventIds: string[]`.
- **Incident (`app/core/models/incident.ts`)**: Contains `iocs: string[]`, `mitreTechniques: string[]`, `affectedAssets: string[]`, `affectedUsers: string[]`.
- **ThreatHunt (`app/core/models/hunting.ts`)**: Supports filtering by `sourceIps`, `destinationIps`, `domains`, `hashes`, and outputs results referencing `iocIds`.
- **Case (`app/core/models/case.ts`)**: Links `iocIds: string[]`.
- **Evidence (`app/core/models/evidence.ts`)**: Supports `IOC_REFERENCE` with `relatedIocIds?: string[]`.

### 1.3 Existing Spatial IOC Visualization (`app/spatial/investigation/iocs/IOCConstellation.tsx`)
The current IOC Constellation renders:
- An inner ring of IOC nodes (diamonds colored by type, showing blocked shield status).
- An outer ring of related entities (`ASSET`, `USER`, `INCIDENT`).
- Static SVG links loaded from `securityService.getIocConstellation(incidentId)`.
- A bottom strip displaying basic IOC details on click.

**Audit Finding**: The constellation is currently limited to 3 hardcoded target entity types (`ASSET`, `USER`, `INCIDENT`) and relies on `SEED_IOC_GRAPH` with static link records. It must be extended to:
1. Support expanded intelligence nodes: `MITRE_TECHNIQUE`, `MALWARE_FAMILY`, `CAMPAIGN`, `ALERT`.
2. Dynamically pull from canonical `threat_intel_relationships`.
3. Provide an interactive **Threat Intelligence Profile** modal/panel with detailed local observations, confidence breakdown, and one-click pivots.

### 1.4 Persistence & IndexedDB (`app/core/storage/idb-store.ts`)
The database is currently at `DB_VERSION = 7`.
Existing stores:
- `incidents`, `assets`, `users`, `iocs`, `response_actions`, `audit_records`, `events`, `alerts`, `threat_hunts`, `cases`, `case_notes`, `case_tasks`, `case_findings`, `evidence`, `evidence_annotations`, `evidence_custody`, `evidence_blobs`, `meta`.

**Audit Finding**: We must upgrade to `DB_VERSION = 8` to add:
- `threat_intel`: Stores canonical `ThreatIntelRecord` objects.
- `threat_intel_relationships`: Stores typed `ThreatIntelRelationship` edges.
- Migration must be safe and non-destructive: existing stores and records must remain 100% intact.

### 1.5 Role-Based Access Control (RBAC) & Audit
Current permissions in `app/core/models/auth.ts`:
- Role hierarchy: `L1_ANALYST`, `L2_ANALYST`, `INCIDENT_RESPONDER`, `THREAT_HUNTER`, `SOC_MANAGER`, `ADMIN`.
- Threat intelligence requires dedicated permissions:
  - `THREAT_INTEL_READ`: All roles.
  - `THREAT_INTEL_ENRICH`: L1, L2, Hunter, Responder, Manager, Admin.
  - `THREAT_INTEL_MANAGE`: L2, Hunter, Manager, Admin.
- Audit actions needed:
  - `THREAT_INTEL_CREATED`
  - `THREAT_INTEL_UPDATED`
  - `THREAT_INTEL_ENRICHED`
  - `THREAT_INTEL_RELATIONSHIP_CREATED`
  - `THREAT_INTEL_RELATIONSHIP_REMOVED`
  - `THREAT_INTEL_CONFIDENCE_UPDATED`

---

## 2. Threat Intelligence Requirements & Design

### 2.1 Canonical Threat Intelligence Model (`ThreatIntelRecord`)
- **`id`**: Stable identifier (e.g., `intel-ioc-001`).
- **`indicatorId`**: Foreign key to canonical `IOC.id`.
- **`indicatorType`**: Reuses `IocType` (`IP`, `DOMAIN`, `HASH_SHA256`, `HASH_MD5`, `URL`, `FILE_PATH`, `MUTEX`, `REGISTRY_KEY`).
- **`indicatorValue`**: String value matching the IOC.
- **`title`**: Descriptive intelligence title.
- **`description`**: Contextual intelligence summary.
- **`confidence`**: Deterministic level (`LOW` | `MEDIUM` | `HIGH`).
- **`severity`**: Assessed risk (`CRITICAL` | `HIGH` | `MEDIUM` | `LOW` | `INFO`).
- **`classification`**: `MALICIOUS` | `SUSPICIOUS` | `BENIGN` | `UNKNOWN`.
- **`sourceType`**: `LOCAL_SEED` | `LOCAL_ANALYST` | `DETECTION_ENGINE` | `HUNT_ENGINE` | `INCIDENT_ANALYSIS` | `CASE_ANALYSIS`.
- **`sourceName`**: Name of source / analyst / detection rule.
- **`tags`**: Array of investigative tags.
- **`threatTypes`**: Array of threat categories (e.g. `Ransomware`, `C2`, `Exfiltration`).
- **`malwareFamilies`**: Named malware families from local context (e.g., `BlackCat/ALPHV`).
- **`campaigns`**: Named campaigns (e.g., `Operation BlackTide`).
- **`actors`**: Defensible local attribution references if any, or empty (no fabrication).
- **`mitreTechniqueIds`**: Mapped MITRE technique IDs (e.g., `T1204.002`, `T1078.002`, `T1048.003`).
- **`relatedIndicatorIds`**: Array of related IOC IDs.
- **`firstSeenAt` / `lastSeenAt`**: Dynamically aggregated from canonical telemetry observations.
- **`observationsCount`**: Dynamic count of events/alerts referencing the indicator.
- **`createdAt` / `updatedAt`**: ISO timestamps.

### 2.2 Canonical Relationship Model (`ThreatIntelRelationship`)
- **`id`**: Unique identifier (`rel-intel-...`).
- **`sourceType`**: `'IOC'`.
- **`sourceId`**: IOC ID.
- **`targetType`**: `'IOC'` | `'ASSET'` | `'USER'` | `'INCIDENT'` | `'ALERT'` | `'SECURITY_EVENT'` | `'MITRE_TECHNIQUE'` | `'MALWARE_FAMILY'` | `'CAMPAIGN'`.
- **`targetId`**: Identifier of target entity.
- **`relationshipType`**:
  - `COMMUNICATES_WITH` (IP/Domain $\leftrightarrow$ Asset)
  - `OBSERVED_ON` (File/Registry/Process $\leftrightarrow$ Asset)
  - `EXECUTED_BY` (Process/File $\leftrightarrow$ User)
  - `ASSOCIATED_WITH` (IOC $\leftrightarrow$ Incident/Case)
  - `INDICATES` (IOC $\leftrightarrow$ Malware Family / Threat Type)
  - `USES` (Malware Family $\leftrightarrow$ MITRE Technique)
  - `DELIVERS` (Domain/URL $\leftrightarrow$ Hash/File)
  - `MAPS_TO` (IOC $\leftrightarrow$ MITRE Technique)
  - `RELATED_TO` (IOC $\leftrightarrow$ IOC)
- **`confidence`**: `LOW` | `MEDIUM` | `HIGH`.
- **`source`**: Originating engine or analyst.

### 2.3 Local Offline Enrichment Engine
An offline deterministic pipeline:
1. Takes an indicator (by ID or type+value).
2. Looks up or creates a `ThreatIntelRecord`.
3. Scans canonical local data stores:
   - `events`: matches on `iocIds`, `dstIp`, `srcIp`, `domain`, `url`, `fileHash`, `filePath`.
   - `alerts`: matches on `iocIds` or linked source event IDs.
   - `incidents`: matches on `incident.iocs`.
   - `threat_hunts`: matches on hunt results.
   - `cases`: matches on `case.iocIds`.
   - `evidence`: matches on `evidence.relatedIocIds`.
4. Derives `firstSeenAt` (earliest timestamp) and `lastSeenAt` (latest timestamp).
5. Computes observation counts across telemetry, alerts, and incidents.
6. Synthesizes bidirectional `ThreatIntelRelationship` edges.
7. Computes a deterministic local confidence (`HIGH` if observed in verified incidents with multiple alert/event correlations; `MEDIUM` if observed in single alert/event; `LOW` if unobserved seed).

### 2.4 Operation BlackTide Baseline Intelligence
Seed the local intelligence engine with verified contextual intelligence for the existing BlackTide scenario:
- **`ioc-001`** (`HASH_SHA256: b94f3e2a1...`):
  - Malware: `BlackCat/ALPHV` Dropper.
  - Campaign: `Operation BlackTide`.
  - MITRE: `T1204.002` (Malicious File).
  - Relationships: `OBSERVED_ON asset-001`, `ASSOCIATED_WITH incident-001`, `DELIVERED_BY ioc-003`, `COMMUNICATES_WITH ioc-002`.
- **`ioc-002`** (`IP: 185.220.101.47`):
  - Threat Type: Tor Exit Node / C2 Beacon.
  - Campaign: `Operation BlackTide`.
  - MITRE: `T1071.001` (Web Protocols C2).
  - Relationships: `COMMUNICATES_WITH asset-001`, `COMMUNICATES_WITH asset-004`, `ASSOCIATED_WITH incident-001`.
- **`ioc-003`** (`DOMAIN: update-sync.blacktide-exfil.net`):
  - Threat Type: Exfiltration Endpoint.
  - Campaign: `Operation BlackTide`.
  - MITRE: `T1048.003` (Exfiltration Over Unencrypted Non-C2 Protocol).
  - Relationships: `COMMUNICATES_WITH asset-001`, `DELIVERS ioc-001`, `ASSOCIATED_WITH incident-001`.
- **`ioc-004`** (`FILE_PATH: C:\Users\r.morrison\AppData\Local\Temp\svchost32.exe`):
  - Threat Type: Staged Payload.
  - MITRE: `T1204.002`.
  - Relationships: `OBSERVED_ON asset-001`, `EXECUTED_BY user-001`.
- **`ioc-005`** (`REGISTRY_KEY: HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run\SysUpdate32`):
  - Threat Type: Persistence Mechanism.
  - MITRE: `T1547.001` (Registry Run Keys).
  - Relationships: `OBSERVED_ON asset-001`.

### 2.5 Spatial & UI Integrations
1. **IOC Constellation Extended**:
   - Enhances `IOCConstellation.tsx` to display intelligence context, confidence rings, and relationship links to MITRE techniques, malware families, and alerts in addition to assets/users/incidents.
2. **Threat Intelligence Profile Modal / Drawer**:
   - When an IOC is clicked or selected in the spatial constellation, Case Workspace, or Evidence Workspace, a comprehensive **Threat Intelligence Profile** opens.
   - Shows: Indicator header, type, value, local confidence pill (`HIGH`/`MEDIUM`/`LOW`), reputation score, First Seen, Last Seen, local observations breakdown (Events, Alerts, Incidents, Hunts, Cases, Assets, Users), intelligence context (Threat Types, Malware Families, Campaigns, MITRE Techniques), active relationships table, and local provenance source.
   - Provides action triggers: `[LOCAL ENRICHMENT]` (recalculates observations & links), `[INVESTIGATE INCIDENT]`, `[PIVOT TO HUNT]`, and `[PRESERVE AS EVIDENCE]`.
3. **Command Center Integration**:
   - Adds an operational Threat Intelligence metrics indicator in the Command Center top KPI ribbon (`THREAT INTEL`: Total indicators, High confidence count, Linked to open incidents).
4. **Investigation Hub / Cases / Evidence Pivots**:
   - Clickable IOC badges in alerts, incidents, cases, and evidence pivot directly to the Threat Intelligence Profile.

---

## 3. Strict Scope Boundaries
- **100% Offline**: Zero `fetch()`, zero external API calls, zero VirusTotal, AbuseIPDB, MISP, or STIX/TAXII remote sync.
- **Zero Fabrication**: Only attribution and relationships supported by local telemetry, alerts, and incidents are recorded.
- **Non-Destructive DB Migration**: Database version increases to 8, strictly preserving all previous stores (`incidents`, `evidence`, etc.).
- **Performance**: Zero extra RAF loops; leverages existing memoized spatial transform state.

---

## 4. Conclusion & Next Steps
The audit confirms that the project's data architecture is structured and ready for Step 8.
We will now create the formal `implementation_plan.md` to design and execute the Threat Intelligence Engine.

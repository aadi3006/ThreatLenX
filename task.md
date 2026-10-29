# EXPLAIN-SEC SPATIAL — Master Execution Tasks

## Master Status: Complete (Stages 0–16 Verified)
All architectural stages fully verified with clean TypeScript compilation and production builds.

---

### Stage Checklist

- [x] **Stage 0: Baseline Audit**
  - [x] Inspect full architecture (`app/page.tsx`, `app/soc-spatial.tsx`, spatial architecture, gesture engine, spatial controller, spatial transform, SecurityService, LocalProvider, IndexedDB, Incident Universe, investigation components, response components).
  - [x] Establish render hierarchy, gesture flow, render loops, data flow, persistence flow, legacy dependencies, performance bottlenecks.
  - [x] Create `docs/current-architecture-audit.md`.
  - [x] Verify baseline with `npx tsc --noEmit` (0 errors) and `npm run build:vercel` (clean).

- [x] **Stage 1: Remove the Legacy System**
  - [x] Retire `SocDashboard` from the active SOC render tree.
  - [x] Clean up obsolete dashboard navigation, timers, and 2D canvas RAF loops.
  - [x] Set Spatial SOC as the default entry point (`showCar: false`).
  - [x] Isolate vehicle study so it only mounts when explicitly toggled.
  - [x] Verify clean compilation (`npx tsc --noEmit`) and production build.

- [x] **Stage 2: Establish the Cinematic Investigation State Machine**
  - [x] Create central investigation presentation state machine (IDLE → PROXIMITY → FOCUSING → INVESTIGATION_OPEN → CONTEXT_BUILDING → CONTEXT_READY → REPLAYING → RESPONSE → COLLAPSING).
  - [x] Integrate state machine with `InvestigationContext` and spatial transform.
  - [x] Add choreography construction sub-steps and banner with fast-forward/skip.
  - [x] Verify compilation (`npx tsc --noEmit`) and production build.

- [x] **Stage 3: Cinematic Incident Focus**
  - [x] Implement smooth spatial incident focus transition (background dimming, focal node expansion, progressive metadata reveal).
  - [x] Replace abrupt panel popping with radial gradient clip-path emergence radiating from incident coordinate.
  - [x] Ensure interruptible transitions on gesture or collapse via reverse collapse animation.
  - [x] Verify compilation (`npx tsc --noEmit`) and production build.

- [x] **Stage 4: Cinematic Timeline**
  - [x] Animate timeline events entering sequentially with calculated animation delay on investigation open.
  - [x] Add dynamic traveling laser pulse along the timeline spine line (`@keyframes spine-travel`).
  - [x] Synchronize with replay temporal state, active event pulse, and smooth centering into view.
  - [x] Verify compilation (`npx tsc --noEmit`) and production build.

- [x] **Stage 5: Attack Graph Construction Animation**
  - [x] Implement dynamic SVG stroke-dash edge drawing (`@keyframes ag-edge-draw`).
  - [x] Add node appearance sequence in topological kill-chain order (`@keyframes ag-node-appear`).
  - [x] Implement causal path illumination, adjacent edge highlighting, and irrelevant node dimming on selection.
  - [x] Verify compilation (`npx tsc --noEmit`) and production build.

- [x] **Stage 6: System Radar**
  - [x] Implement cinematic rotating radar sweep arm with subtle trail (`@keyframes radar-sweep-spin`).
  - [x] Add detection blip rings on asset nodes synchronized with radar beam angle (`@keyframes blip-pulse`).
  - [x] Sync radar asset reactions with incident replay and blast radius level.
  - [x] Verify compilation (`npx tsc --noEmit`) and production build.

- [x] **Stage 7: IOC Constellation**
  - [x] Animate progressive IOC node entry and dynamic link construction.
  - [x] Visually differentiate blocked vs active indicators (strikethrough / shield badge).
  - [x] Implement relationship illumination on hover, dwell, and selection with automatic dimming of unrelated entities.

- [x] **Stage 8: MITRE Investigation**
  - [x] Implement progressive technique illumination linked to attack path and timeline.
  - [x] Differentiate firing now, activated, and unreached techniques during temporal replay.
  - [x] Connect highlighted techniques directly to timeline events and compromised host assets.

- [x] **Stage 9: Spatial Replay**
  - [x] Upgrade replay into a deterministic temporal reconstruction engine driving all 5 visualization surfaces.
  - [x] Add interactive timeline scrubber slider with click/drag seeking across steps $t_0 \dots t_N$.
  - [x] Add variable speed controls (0.5x, 1x, 2x, 4x) and keyboard hotkeys (Space, ArrowLeft, ArrowRight, R).

- [x] **Stage 10: Response / SOAR Cinematic Transition**
  - [x] Upgrade visual transition between Investigation and Response Space.
  - [x] Render dedicated Subject of Response focus banner dynamically tracking active assets/IOCs.
  - [x] Display real-time containment state transitions (Threat -> Isolating -> Isolated) grounded in canonical IndexedDB persistence and audit logging.

- [x] **Stage 11: Hand Interaction Upgrade**
  - [x] Add instant Pinch Select (thumb tip to index tip) for swift selection without dwell waiting.
  - [x] Add 0.0035 Euclidean deadzone and velocity filtering to palm movement, eliminating jitter.
  - [x] Preserve single MediaPipe Tasks Vision instance and single RAF loop throughout.

- [x] **Stage 12: Performance Pass**
  - [x] Implement Adaptive Performance Governor (`performanceManager`) supporting FULL, REDUCED, and LOW profiles.
  - [x] Move continuous animations (radar sweep, blip delay, spine travel) into GPU CSS transforms with 0 React re-renders.
  - [x] Add real-time performance tier switcher pill in the HUD floating bar.

- [x] **Stage 13: Visual Coherence Pass**
  - [x] Unify color palette across severity levels (Critical #ff2a2a, High #ff6b35/#ffb700, Medium #00f0ff, Low #3dffb0).
  - [x] Standardize motion curves (`cubic-bezier(0.16, 1, 0.3, 1)`), spacing, and cyber typography.
  - [x] Ensure all animation strictly communicates state, attention, and temporal causality.

- [x] **Stage 14: Offline Verification**
  - [x] Verified zero external `fetch()` calls in `app/core/` and `app/spatial/`.
  - [x] Verified IndexedDB persistence (`explainsec_spatial_db`) and deterministic seed scenario.

- [x] **Stage 15: AI Connector Preparation**
  - [x] Created clean pluggable AI abstraction (`ExplainSecAIProvider` and `aiService`).
  - [x] Implemented `DeterministicOfflineIntelligenceProvider` with explicit `DETERMINISTIC_LOCAL_ENGINE` provenance.

- [x] **Stage 16: Final Validation**
  - [x] Executed TypeScript verification: `npx tsc --noEmit` (0 errors).
  - [x] Executed production build: `npm run build:vercel` (clean in ~1.0s).
  - [x] Produced complete architectural documentation (`docs/current-architecture-audit.md`, `docs/cinematic-investigation-spec.md`, `docs/performance-report.md`).

---

## Step 1: SOC Command Center — Complete

- [x] **Stage 0: Architecture Audit**
  - [x] Audited full codebase for SecurityService contracts, persistence, spatial entry point, and state flow.
  - [x] Created `docs/step-1-command-center-audit.md`.
- [x] **Core Threat Level & Snapshot Service**
  - [x] Implemented deterministic threat scoring service (`app/core/security/threat-level-service.ts`) with factor contributions.
  - [x] Implemented canonical `SecurityOperationsSnapshot` generator derived 100% from canonical entities.
- [x] **Spatial Command Center Layer**
  - [x] Created `app/spatial/command/CommandCenter.tsx` and `command-center.css`.
  - [x] Built interactive Threat State Beacon with DEFCON scoring drawer.
  - [x] Built Incident Command View with filters and direct transition to investigation.
  - [x] Built Asset Posture breakdown (Compromised, Isolated, Suspicious, Healthy) with direct incident linking.
  - [x] Built SOAR active response action pipeline view.
  - [x] Built Live Operational Security Activity stream using real audit logs and timeline events.
  - [x] Integrated into `IncidentUniverse.tsx` surrounding the 3D starfield.
- [x] **Investigation Transition & State Choreography**
  - [x] Selecting any incident seamlessly engages the existing `PROXIMITY` → `FOCUSING` → `INVESTIGATION_OPEN` state machine.
  - [x] Preserved single MediaPipe instance and single RAF loop.
  - [x] Preserved performance governor integration (`FULL`, `REDUCED`, `LOW`).
- [x] **Verification & Documentation**
  - [x] Full browser subagent test and recorded walkthrough artifact (`command_center_flow_1790005013384.webp`).
  - [x] TypeScript verification: `npx tsc --noEmit` (0 errors).
  - [x] Production build: `npm run build:vercel` (clean in 1.01s).
  - [x] Created `docs/step-1-command-center.md`.

---

## Step 2: Security Event Engine — Complete

- [x] **Stage 0: Pre-Implementation Audit**
  - [x] Inspected existing SecurityService, LocalProvider, IndexedDB wrapper, Incident/Asset/User/IOC models, and replay.
  - [x] Created `docs/step-2-event-engine-audit.md`.
- [x] **Canonical Security Event Model**
  - [x] Created `app/core/models/event.ts` (`SecurityEvent`, `SecurityEventInput`, `SecurityEventQuery`, `SecurityEventStats`, `IngestEventResult`).
  - [x] Defined categories, severities, and source types; reconciled legacy stub in `alert.ts`.
- [x] **Event Engine Core (Validation, Normalization, Deduplication, Querying, Stats)**
  - [x] Created `app/core/security/event-engine.ts` with `validateSecurityEvent`, `normalizeSecurityEvent`, `generateEventSignature`, `querySecurityEvents`, and `computeEventStats`.
- [x] **IndexedDB Schema Upgrade (v1 → v2)**
  - [x] Upgraded `app/core/storage/idb-store.ts` to `DB_VERSION = 2` with `'events'` object store and 5 indices (`by_timestamp`, `by_severity`, `by_category`, `by_asset`, `by_incident`).
  - [x] Safe incremental migration without clearing existing tables or data.
- [x] **Seed Telemetry Dataset**
  - [x] Created `app/core/data/seed-events.ts` with 22 rich canonical events matching Operation BlackTide and enterprise background traffic.
- [x] **LocalProvider & SecurityService Integration**
  - [x] Updated `app/core/providers/local-provider.ts` and `app/core/security-service.ts` to support full event querying, pagination, ingestion, statistics, and subscriptions (`EVENT_INGESTED`).
  - [x] Enforced RBAC check (`canIngestEvents`).
- [x] **SOC Command Center Telemetry Stream**
  - [x] Integrated real-time event counters (`TOTAL`, `CRIT`, `HIGH`, `5M rate`) and category filter tabs (`ALL`, `PROCESS`, `NETWORK`, `AUTH`, `ENDPOINT`, `FILE`).
  - [x] Added interactive `+ SIMULATE INGEST` button for real-time telemetry testing.
- [x] **Automated Tests & E2E Browser Verification**
  - [x] Automated test suite: `scripts/test-event-engine.ts` (12/12 passed).
  - [x] End-to-end browser test on `http://localhost:3000/`: verified initial count 22, live simulation to 23, category filtering, persistence across page reload, and incident investigation hub.
  - [x] TypeScript verification: `npx tsc --noEmit` (0 errors).
  - [x] Production build: `npm run build:vercel` (0 errors, 562ms).
  - [x] Created `docs/step-2-security-event-engine.md`.

---

## Step 3: Detection & Alert Engine — Complete

- [x] **Stage 0: Pre-Implementation Audit**
  - [x] Audited existing SecurityEvent telemetry, IndexedDB v2 stores, LocalProvider, SecurityService, Command Center, RBAC, and Operation BlackTide seed scenario.
  - [x] Created `docs/step-3-detection-engine-audit.md`.
- [x] **Canonical Detection & Alert Models**
  - [x] Created `app/core/models/detection.ts` defining `RuleCondition`, `RuleConditionOperator`, `DetectionRule`, `AlertStatus` (`NEW`, `ACKNOWLEDGED`, `RESOLVED`, `SUPPRESSED`), `Alert`, `AlertQuery`, and `AlertStats`.
  - [x] Reconciled legacy stub in `app/core/models/alert.ts` with backward compatibility aliases.
- [x] **Deterministic Detection Rules Catalogue**
  - [x] Created `app/core/security/detection-rules.ts` with 7 grounded rules (`DET-AUTH-001`, `DET-PROC-001`, `DET-NET-001`, `DET-IOC-001`, `DET-PER-001`, `DET-EXF-001`, `DET-GW-001`) mapped directly to MITRE ATT&CK techniques.
- [x] **Pure Deterministic Rule Evaluator & Alert Builder**
  - [x] Created `app/core/security/detection-engine.ts` implementing declarative condition evaluation (no `eval()` or dynamic code execution).
  - [x] Built deterministic SHA-based fingerprinting with 15-minute time bucketing for alert throttling and occurrence counting.
  - [x] Implemented `buildAlertFromMatch`, `queryAlerts`, and `computeAlertStats`.
- [x] **IndexedDB Schema Upgrade (v2 → v3)**
  - [x] Upgraded `app/core/storage/idb-store.ts` to `DB_VERSION = 3`.
  - [x] Created `'alerts'` object store with 7 query indices (`by_ruleId`, `by_severity`, `by_status`, `by_asset`, `by_incident`, `by_createdAt`, `by_fingerprint`).
  - [x] Non-destructive migration preserving all v1 and v2 stores and records.
- [x] **LocalProvider & SecurityService Integration**
  - [x] Implemented detection pipeline hooked directly into `ingestEvent` and initial seed migration.
  - [x] Implemented alert query APIs, `acknowledgeAlert`, and `resolveAlert` with audit logging and reactive events (`ALERT_CREATED`, `ALERT_UPDATED`).
  - [x] Added RBAC enforcement in `app/core/auth/rbac.ts` (`canAcknowledgeAlert`, `canResolveAlert`, `canManageDetectionRules`).
- [x] **SOC Command Center & Investigation Integration**
  - [x] Updated KPI halo with clickable `OPEN ALERTS` showing live count and critical/high breakdown.
  - [x] Added compact alert stream in left flank with instant toggle between `INCIDENTS` and `ALERTS`.
  - [x] Built full-featured interactive `Alert Inspector` modal with metadata grid, MITRE technique tags, causal source telemetry expansion, and RBAC-audited `ACKNOWLEDGE` and `RESOLVE ALERT` action buttons.
  - [x] Connected alerts to existing spatial investigation (`onSelectIncident` and `onSelectAsset`).
- [x] **Automated Unit Tests & E2E Browser Verification**
  - [x] Automated test suite: `scripts/test-detection-engine.ts` (14/14 passed covering conditions, conjunctions, disabled rules, pre-filtering, provenance, deduplication, stats, BlackTide scenario, and RBAC).
  - [x] End-to-end browser verification via subagent recording (`step3_alert_engine_1790008867496.webp`): tested KPI halo, left flank stream, inspector modal, causal event payload preview, acknowledge/resolve lifecycle, live ingestion, and persistence across complete page refresh.
  - [x] TypeScript verification: `npx tsc --noEmit` (0 errors).
  - [x] Production build: `npm run build:vercel` (0 errors, 612ms).
  - [x] Created `docs/step-3-detection-alert-engine.md`.

---

## Step 4: Correlation & Incident Creation Engine — Complete

- [x] **Stage 0: Pre-Implementation Audit**
  - [x] Inspected canonical SecurityEvent model, Alert model, Incident model, LocalProvider, IndexedDB stores, detection engine, Operation BlackTide seed scenario, investigation state machine, replay, and RBAC.
  - [x] Created `docs/step-4-correlation-audit.md`.
- [x] **Deterministic Correlation Models & Signals**
  - [x] Created `app/core/security/correlation-engine.ts` implementing 6 deterministic offline correlation signals:
    - Same Asset (+30 pts)
    - Shared IOC Threat Indicators (+35 pts)
    - Same User Context (+20 pts)
    - Temporal Proximity (+15 pts with decay over 60m window)
    - Shared Network Destination (+15 pts)
    - MITRE Kill-Chain Progression (+20 pts sequential path)
  - [x] Built explainable human-readable grouping evidence bullets for every correlation match.
  - [x] Established deterministic thresholds: `AUTOMATIC_CORRELATION_THRESHOLD = 60`, `CANDIDATE_CORRELATION_THRESHOLD = 40`.
  - [x] Created multi-vector severity aggregation (`deriveIncidentSeverity`) and priority calculation (`deriveIncidentPriority`: P1–P4).
  - [x] Added timeline synthesis from events and correlation chain builder from alerts.
- [x] **Evolved Canonical Incident Model**
  - [x] Updated `app/core/models/incident.ts` with `IncidentPriority` (`P1`|`P2`|`P3`|`P4`), extended incident fields (`description?`, `priority?`, `source?`, `firstSeenAt?`, `lastSeenAt?`, `eventIds?: string[]`, `alertIds?: string[]`, `correlationScore?: number`, `correlationReasons?: string[]`, `tags?: string[]`).
  - [x] Added `IncidentQuery`, `CorrelationSignal`, `CorrelationCandidate`, and `CorrelationMatchResult`.
- [x] **IndexedDB Schema Upgrade (v3 → v4)**
  - [x] Upgraded `app/core/storage/idb-store.ts` to `DB_VERSION = 4`.
  - [x] Added query indices to `'incidents'` store (`by_status`, `by_severity`, `by_createdAt`).
  - [x] Added `META_CORRELATION_SEEDED` metadata flag.
  - [x] Safe non-destructive migration preserving existing data.
  - [x] Updated `resetLocalData()` to include `'events'` and `'alerts'` in mutable store reset list.
- [x] **LocalProvider & SecurityService Integration**
  - [x] Added `runCorrelation()`, `attachAlertToIncident()`, and `attachEventToIncident()` in `ISecurityProvider`, `LocalProvider`, and `SecurityService`.
  - [x] Updated `getIncidents(query?: IncidentQuery)` with rich filtering support.
  - [x] Implemented automated correlation hook inside `_processEventForDetections` to instantly cluster incoming alerts and telemetry.
  - [x] Implemented seed correlation alignment associating BlackTide alerts into `incident-001` (P1 Critical) and perimeter brute-force into `incident-002` (P3 Medium).
  - [x] Added RBAC enforcement in `app/core/auth/rbac.ts` (`canCorrelate`).
  - [x] Emitted reactive events: `INCIDENT_CREATED`, `INCIDENT_UPDATED`, `CORRELATION_COMPLETED`.
- [x] **SOC Command Center & Investigation Integration**
  - [x] Command Center KPI halo displays live counts of Events, Open Alerts, and Active Incidents (with Critical breakdown).
  - [x] Left flank incident cards display priority badges (`P1`, `P3`), severity badges, and correlated alert count.
  - [x] Alert Inspector displays `CORRELATED INCIDENT: incident-001` with one-click `INVESTIGATE INCIDENT` transition button.
  - [x] Spatial Investigation Hub displays `PRIORITY: P1` and `ALERTS: 9` in context strip alongside Assets, IOCs, Techniques, and Path steps.
  - [x] Seamless navigation between Command Center and Spatial Investigation.
- [x] **Automated Tests & E2E Browser Verification**
  - [x] Automated test suite: `scripts/test-step4-correlation.ts` (42/42 passed covering signals, scoring, explainability, thresholds, severity aggregation, priority derivation, risk scores, timeline synthesis, correlation chains, queries, and RBAC).
  - [x] Browser verification via subagent recording (`step4_correlation_verification`): verified Command Center P1 badges, alert inspector correlation provenance, spatial investigation context strip, and timeline navigation.
  - [x] TypeScript verification: `npx tsc --noEmit` (0 errors).
  - [x] Production build: `npm run build:vercel` (0 errors, 759ms).
  - [x] Created `docs/step-4-correlation-incident-engine.md`.

---

## Step 5: Threat Hunting Engine — Complete
- [x] **Threat Hunting Engine & Hypothesis Workflow**
  - [x] Built `ThreatHuntingEngine` supporting structured event search, filters, aggregations, hypothesis workflows, and BlackTide hunt templates.
  - [x] IndexedDB store upgrade (`threat_hunts`, `threat_hunt_queries`).
  - [x] SecurityService & LocalProvider APIs with RBAC and audit trail.
  - [x] Spatial Threat Hunting Workspace (`ThreatHuntingWorkspace.tsx`).

---

## Step 6: Case Management System — Complete
- [x] **Case Management & Investigation Container**
  - [x] Canonical Case model (`CASE-000001` sequential numbering, severity, priority, lifecycle state machine).
  - [x] Case notes, task checklists, and investigation findings with provenance.
  - [x] Incident & Threat Hunt linking to cases.
  - [x] Spatial Case Workspace (`CaseWorkspace.tsx`) with 5-zone holographic HUD.
  - [x] 100% test pass on `scripts/test-step6-cases.ts`.

---

## Step 7: Offline Evidence Management System — Complete
- [x] **Pre-Implementation Audit & Planning**
  - [x] Completed deep architectural audit in `docs/step-7-evidence-management-audit.md`.
  - [x] Planned canonical Evidence model, provenance immutability, Web Crypto SHA-256, and append-only custody.
- [x] **Canonical Evidence Data Model**
  - [x] Created `app/core/models/evidence.ts` with `Evidence`, `EvidenceType`, `EvidenceStatus`, `EvidenceSourceType`, `EvidenceCustodyEntry`, `EvidenceAnnotation`.
  - [x] Enforced mandatory case relationship (`caseId`).
  - [x] Enforced strict immutability of core provenance (`id`, `evidenceNumber`, `caseId`, `collectedAt`, `collectedBy`, `sourceType`, `sourceId`, `integrity.hash`).
  - [x] Implemented canonical references without duplicating source entities (`EVENT_REFERENCE`, `ALERT_REFERENCE`, `INCIDENT_REFERENCE`, `HUNT_REFERENCE`, `IOC_REFERENCE`, `ASSET_REFERENCE`, `USER_REFERENCE`, `TEXT_NOTE`, `FILE`).
- [x] **Sequential Numbering & IndexedDB Migration (DB_VERSION = 7)**
  - [x] Atomic sequential numbering generating `EVD-000001`, `EVD-000002`... in `app/core/storage/idb-store.ts`.
  - [x] Created stores: `evidence`, `evidence_annotations`, `evidence_custody`, `evidence_blobs`.
  - [x] Safe non-destructive migration preserving all existing SOC stores.
- [x] **Cryptographic Hashing & Integrity Verification**
  - [x] Created `app/core/security/evidence-crypto.ts` utilizing native `crypto.subtle` (SHA-256) with dynamic `node:crypto` fallback for test runners.
  - [x] Live integrity check recalculates hash, compares with stored value, returns MATCH / MISMATCH, and logs to custody.
- [x] **Append-Only Chain of Custody & Annotations**
  - [x] Implemented append-only custody tracking: `COLLECTED`, `VIEWED`, `STATUS_CHANGED`, `ANNOTATED`, `INTEGRITY_VERIFIED`, `ARCHIVED`.
  - [x] Implemented analyst annotations for investigative commentary without modifying original evidence.
- [x] **RBAC & Security Audit Integration**
  - [x] Defined `EVIDENCE_READ`, `EVIDENCE_COLLECT`, `EVIDENCE_ANNOTATE`, `EVIDENCE_VERIFY`, `EVIDENCE_MANAGE`.
  - [x] Audited all collection, status changes, integrity checks, annotations, and finding linkages.
- [x] **Spatial Evidence Workspace & SOC Integration**
  - [x] Built spatial-native `EvidenceWorkspace.tsx` and `evidence-workspace.css` (5-zone cyberpunk holographic HUD).
  - [x] Integrated `EVIDENCE [E]` mode in `soc-spatial.tsx` with hotkey support.
  - [x] Added `EVIDENCE VAULT` tab and findings link chips in `CaseWorkspace.tsx`.
  - [x] Added operational evidence metrics cell in `CommandCenter.tsx`.
  - [x] Added one-click evidence preservation button in `InvestigationHub.tsx`.
- [x] **Automated Testing & Documentation**
  - [x] Created `scripts/test-step7-evidence.ts` (11/11 test suites passed 100%).
  - [x] Verified zero regressions on previous steps (`test-step6-cases.ts`, `test-step4-correlation.ts`).
  - [x] Verified clean TypeScript compilation (`npx tsc --noEmit`: 0 errors).
  - [x] Verified production build (`npm run build:vercel`: clean, 649ms).
  - [x] Created `docs/step-7-evidence-management.md`.

---

## Step 8: Threat Intelligence Engine — Complete
- [x] **Phase 0 Pre-Implementation Audit & Planning**
  - [x] Completed deep architectural audit in `docs/step-8-threat-intelligence-audit.md`.
  - [x] Defined canonical Threat Intelligence model, confidence scoring, offline local enrichment, and relationship semantics.
- [x] **Canonical Threat Intelligence Model**
  - [x] Created `app/core/models/threat-intel.ts` with `ThreatIntelRecord`, `ThreatIntelRelationship`, `IntelConfidence`, `IntelClassification`, `IntelSourceType`, `IntelRelationshipType`, `IntelTargetType`.
  - [x] Preserved canonical IOC identity: Threat Intelligence adds context without duplicating the IOC store.
- [x] **Deterministic Local Confidence Scoring**
  - [x] Analytical confidence (`HIGH` / `MEDIUM` / `LOW`) distinct from severity/priority.
  - [x] Derived from observation presence in verified incident telemetry, detection alerts, and correlated events.
- [x] **Dynamic First-Seen & Last-Seen Calculation**
  - [x] Evaluated dynamically from earliest and latest observed occurrences in canonical telemetry.
- [x] **Offline Local Enrichment Pipeline**
  - [x] Implemented `ThreatIntelEngine.enrichLocally()` in `app/core/security/threat-intel-engine.ts`.
  - [x] Synthesizes graph relationships (`OBSERVED_ON`, `ASSOCIATED_WITH`, `INDICATES`, `MAPS_TO`, `DELIVERS`, `COMMUNICATES_WITH`, `RELATED_TO`).
  - [x] Strictly 100% offline, zero network requests, zero commercial feed claims.
- [x] **Operation BlackTide Baseline Intelligence**
  - [x] Seeded local intelligence and relationships for all 5 baseline IOCs (`ioc-001` through `ioc-005`).
- [x] **IndexedDB Schema Migration (DB_VERSION = 8)**
  - [x] Upgraded `DB_VERSION` to 8 in `app/core/storage/idb-store.ts`.
  - [x] Created `threat_intel` and `threat_intel_relationships` stores with indices.
  - [x] Safe, non-destructive migration preserving all existing stores and data.
- [x] **SecurityService & LocalProvider APIs**
  - [x] Implemented `getThreatIntel`, `getThreatIntelByIndicator`, `getThreatIntelRecords`, `createThreatIntelRecord`, `updateThreatIntelRecord`, `getThreatIntelRelationships`, `getRelatedIndicators`, `getIndicatorObservations`, `enrichIndicatorLocally`.
  - [x] Emitted reactive events: `THREAT_INTEL_CREATED`, `THREAT_INTEL_UPDATED`, `THREAT_INTEL_ENRICHED`.
- [x] **RBAC & Security Audit Integration**
  - [x] Defined permissions `THREAT_INTEL_READ`, `THREAT_INTEL_ENRICH`, `THREAT_INTEL_MANAGE`.
  - [x] Audited operations: `THREAT_INTEL_CREATED`, `THREAT_INTEL_UPDATED`, `CONFIDENCE_CHANGED`, `LOCAL_ENRICHMENT_EXECUTED`.
- [x] **Spatial Threat Intelligence Profile & Constellation Integration**
  - [x] Built holographic `ThreatIntelProfile.tsx` and `threat-intel.css`.
  - [x] Integrated `⚡ INTEL PROFILE` action and double-click trigger into `IOCConstellation.tsx`.
  - [x] Added `IOC INTEL` KPI cell with high-confidence indicators count in `CommandCenter.tsx`.
  - [x] Enabled interactive pivots to Threat Intelligence from `CaseWorkspace.tsx` and `EvidenceWorkspace.tsx`.
- [x] **Automated Testing & Production Build**
  - [x] Created `scripts/test-step8-intel.ts` (34/34 tests passed 100%).
  - [x] Verified complete test suite from Step 2 to Step 8 without regressions.
  - [x] Verified clean TypeScript compilation (`npx tsc --noEmit`: 0 errors).
  - [x] Verified production build (`npm run build:vercel`: clean in 588ms).
  - [x] Created `docs/step-8-threat-intelligence.md`.
---

## Step 9: Detection Engineering & Rule Authoring System — Complete
- [x] **Phase 0 Pre-Implementation Audit & Planning**
  - [x] Completed deep architectural audit in `docs/step-9-detection-engineering-audit.md`.
  - [x] Planned canonical DetectionRule model extension, immutable versioning, lifecycle state machine, deterministic validation, dry-run simulation, and alert provenance.
- [x] **Canonical Detection Rule & Versioning Models**
  - [x] Extended `DetectionRule` in `app/core/models/detection.ts` with `ruleId`, `version`, `status` (`RuleLifecycleStatus`), `authorId`, `publishedAt`, `disabledAt`, `deprecatedAt`, `versionStatus`, `changeDescription`.
  - [x] Added `RuleConditionGroup` (`AND`, `OR`, `negate`), `DetectionRuleVersion`, `RuleValidationResult`, `DetectionTestRun`, `DetectionTestRunResult`, `RuleDiffResult`.
  - [x] Added `ruleVersion?: number` to `Alert` model for end-to-end alert-to-rule provenance tracking.
- [x] **Deterministic Offline Rule Validation Engine**
  - [x] Implemented `validateDetectionRule` in `app/core/security/rule-validator.ts`.
  - [x] Checks required metadata, fields against canonical whitelist, operators against safe type rules, threshold/timeWindow sanity, non-empty condition groups, and MITRE ATT&CK technique IDs.
- [x] **Rule Lifecycle & Versioning Engine**
  - [x] Implemented strict state transitions: `DRAFT` → `VALIDATING` → `TESTING` → `PUBLISHED` → `ENABLED` / `DISABLED` / `DEPRECATED`.
  - [x] Enforced validation gate: rules cannot enter `ENABLED` state without successful validation.
  - [x] Immutable version snapshots created upon publishing; changes to published rules create new versions (`v1`, `v2`, `v3`).
  - [x] Implemented structural version diff engine (`diffRuleVersions`).
- [x] **Side-Effect Free Dry-Run Simulation Engine**
  - [x] Implemented `simulateRule` in `app/core/security/detection-engine.ts`.
  - [x] Evaluates rule against canonical historical telemetry without creating production alerts, incidents, cases, or modifying existing records.
  - [x] Provides condition-by-condition match explainability for every evaluated event.
- [x] **Cross-Engine Conversion Bridges**
  - [x] Threat Hunt → Detection: `convertHuntQueryToDetectionDraft` converts structured hunt predicates into declarative detection rules.
  - [x] Event → Detection: `convertEventToDetectionDraft` creates pre-populated drafts from observed events.
  - [x] Rule Cloner: `cloneRuleAsDraft` facilitates incremental rule iteration.
- [x] **IndexedDB Schema Migration (DB_VERSION = 9)**
  - [x] Upgraded `DB_VERSION` to 9 in `app/core/storage/idb-store.ts`.
  - [x] Added stores: `detection_rules`, `detection_rule_versions`, `detection_test_runs` with relevant indices.
  - [x] Safe sequential migration and automatic migration of legacy baseline rules into v1 `ENABLED` records.
- [x] **LocalProvider & SecurityService Integration**
  - [x] Implemented detection rule lifecycle management, querying, testing, publishing, diffing, and simulation in `LocalProvider`.
  - [x] Runtime pipeline in `_processEventForDetections` strictly consumes `VALID`, `PUBLISHED`, `ENABLED` rules.
  - [x] Constructed alerts retain exact `ruleId` and `ruleVersion` provenance.
  - [x] Reactive events emitted: `DETECTION_RULES_UPDATED`, `DETECTION_RULE_CREATED`, `DETECTION_RULE_UPDATED`, `DETECTION_RULE_TESTED`, `DETECTION_RULE_PUBLISHED`.
- [x] **RBAC & Security Audit Integration**
  - [x] Added permissions `DETECTION_RULE_READ`, `DETECTION_RULE_TEST`, `DETECTION_RULE_AUTHOR`, `DETECTION_RULE_MANAGE`.
  - [x] Enforced role permissions: SOC_ANALYST (read, test, author drafts), THREAT_HUNTER (author, test, manage), SOC_RESPONDER (read), SOC_MANAGER (manage, publish, enable/disable).
  - [x] Audited operations: `RULE_CREATED`, `RULE_EDITED`, `RULE_VALIDATED`, `RULE_TEST_EXECUTED`, `RULE_PUBLISHED`, `RULE_ENABLED`, `RULE_DISABLED`, `RULE_DEPRECATED`.
- [x] **Spatial Detection Engineering UI**
  - [x] Built `DetectionEngineeringWorkspace.tsx` and `detection-engineering.css`.
  - [x] 4-panel holographic HUD: Rule Library (left), Rule Canvas & Condition Builder (center), Rule Inspector, Lifecycle & Diff (right), Dry-Run Simulation Harness (bottom).
  - [x] Integrated `RULES [D]` navbar pill and hotkey in `soc-spatial.tsx` and `spatial-controller.ts`.
  - [x] Added "CONVERT TO DETECTION RULE" bridge in `ThreatHuntingWorkspace.tsx`.
- [x] **Automated Testing & Production Build**
  - [x] Created `scripts/test-step9-detection-engineering.ts` (65/65 tests passed 100%).
  - [x] Verified complete test suite from Step 2 to Step 9 without regressions.
  - [x] Verified clean TypeScript compilation (`npx tsc --noEmit`: 0 errors).
  - [x] Verified production build (`npm run build:vercel`: clean in 695ms).
  - [x] Created `docs/step-9-detection-engineering.md`.

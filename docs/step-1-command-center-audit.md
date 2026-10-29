# EXPLAIN-SEC SPATIAL — Stage 0 Architecture Audit (Step 1 Command Center)

**Document:** `docs/step-1-command-center-audit.md`  
**Date:** September 2026  
**System:** EXPLAIN-SEC SPATIAL — Offline-First Spatial SOC  
**Target Milestone:** STEP 1 — Build the SOC Command Center  

---

## 1. Executive Summary & Objective

The objective of **Step 1** is to transform EXPLAIN-SEC SPATIAL into an operational SOC Command Center while strictly preserving the existing cinematic spatial investigation system and local offline-first infrastructure.

The Command Center is **NOT** a return to a flat 2D dashboard, large rectangular metric cards, or synthetic telemetry. Instead, it forms a **spatial-native command layer** that sits above and around the existing Incident Universe, providing continuous operational situational awareness:
- Deterministic real-time Threat Level (`NORMAL`, `ELEVATED`, `HIGH`, `CRITICAL`)
- Canonical SOC Operational Snapshot (active/critical incidents, open alerts, compromised/isolated assets, active IOCs, active response actions)
- Live Operational Activity Stream derived strictly from persisted audit and timeline security records
- Discovery and selection of active incidents transitioning directly into the existing cinematic investigation choreography (`PROXIMITY` → `FOCUSING` → `INVESTIGATION_OPEN`)
- Asset environment posture (healthy, suspicious, compromised, isolated)
- SOAR response execution status

---

## 2. Current Architecture & Component Inventory

### 2.1 Layer Stack

```
┌─────────────────────────────────────────────────────────────┐
│                      UI / Spatial HUD                       │
│  app/page.tsx ──> app/soc-spatial.tsx ──> Command Layer    │
│                         │                                   │
│                         ▼                                   │
│         IncidentUniverse (3D Spatial Stage)                 │
│         InvestigationHub (Cinematic Visualizations)         │
├─────────────────────────────────────────────────────────────┤
│                 Spatial Interaction & Vision                │
│  SpatialTransformManager (Matrix3D, 120 FPS Direct DOM)     │
│  SpatialController (Dwell, Point, Hit-Testing)              │
│  GestureEngine (MediaPipe Hand Landmarks - Single Instance) │
│  PerformanceManager (FULL | REDUCED | LOW Profiles)         │
├─────────────────────────────────────────────────────────────┤
│                 Application Facade & State                  │
│  SecurityService (Canonical Singleton Facade)               │
│  useSecuritySpatial (Spatial Node Coordinate Mapping)       │
│  InvestigationContext (Choreography & View State Machine)   │
├─────────────────────────────────────────────────────────────┤
│                 Data Persistence & Providers                │
│  LocalProvider (Offline Security Operations Engine)         │
│  IdbStore ('es-spatial-db' v1 IndexedDB Object Stores)       │
│  Operation BlackTide (Deterministic Seed Scenario)          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Preserved Core Systems (Zero Redesign / Rebuild)
- **`SecurityService` (`app/core/security-service.ts`)**: Application-level facade. All UI reads and writes must pass through this facade. Zero direct IndexedDB calls from UI.
- **`LocalProvider` (`app/core/providers/local-provider.ts`)**: Concrete implementation managing IndexedDB stores, scenario stepping, and seed state.
- **IndexedDB (`app/core/storage/idb-store.ts`)**: Stores: `incidents`, `assets`, `users`, `iocs`, `response_actions`, `audit_records`, `meta`.
- **RBAC & Auth (`app/core/auth/`)**: Roles: `ANALYST`, `SENIOR_ANALYST`, `INCIDENT_COMMANDER`, `SOC_MANAGER`, `ADMIN`.
- **Investigation Choreography (`app/spatial/investigation/investigation-state.ts`)**: 9-phase state machine (`IDLE` → `PROXIMITY` → `FOCUSING` → `INVESTIGATION_OPEN` → `CONTEXT_BUILDING` → `CONTEXT_READY` → `REPLAYING` → `RESPONSE` → `COLLAPSING`).
- **Spatial Transform & Controller (`app/spatial-transform.ts`, `app/spatial-controller.ts`)**: Direct DOM transform engine, 120 FPS performance target, virtual reticle dwell cursor.
- **Performance Governor (`app/spatial/performance-mode.ts`)**: Tiers `FULL`, `REDUCED`, `LOW` with visual effect adaptation.

---

## 3. Available SecurityService Data & Contract Mapping

All Command Center metrics and views are strictly derived from `SecurityService`.

| Command Center Requirement | SecurityService API | Source Entity / Field | Derivation Method |
| :--- | :--- | :--- | :--- |
| **Threat Level** | `getIncidents()`, `getAssets()`, `getResponseActions()`, `getAuditLogs()` | `Incident.severity`, `Incident.status`, `Asset.status`, `ResponseAction.status` | Deterministic weighted scoring algorithm (`threat-level-service.ts`) |
| **Critical Incidents** | `getIncidents()` | `Incident[]` | Filter: `status !== 'RESOLVED' && status !== 'CLOSED' && severity === 'CRITICAL'` |
| **Active Incidents** | `getIncidents()` | `Incident[]` | Filter: `status !== 'RESOLVED' && status !== 'CLOSED' && status !== 'FALSE_POSITIVE'` |
| **Open Alerts** | `getIncidents()` | `Incident.correlationChain` | Sum length of `correlationChain` across all active incidents |
| **Compromised Assets** | `getAssets()` | `Asset.status` | Filter: `status === 'COMPROMISED'` |
| **Isolated Assets** | `getAssets()` | `Asset.status` | Filter: `status === 'ISOLATED'` |
| **Active IOCs** | `getIOCs()` | `IOC.isBlocked`, `reputationScore` | Filter: `!isBlocked && reputationScore >= 70` (or linked to active incident) |
| **Active Response Actions** | `getResponseActions()` | `ResponseAction.status` | Filter: `status IN ['REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING']` |
| **Current Investigations** | `getIncidents()` | `Incident.status` | Filter: `status === 'INVESTIGATING'` |
| **Recent Security Activity** | `getAuditLogs()`, `getIncidents().timelineEvents` | `AuditRecord[]`, `TimelineEvent[]` | Real persisted audit records and chronological events, sorted descending |

---

## 4. Current Spatial Entry Point & Render Flow

1. **Top Shell (`app/page.tsx`)**:
   - Manages global state (`showCar = false` default launches directly into spatial SOC).
   - Bootstraps `SecurityService` via `bootstrapSecurity()`.
   - Mounts `<SocSpatialWrapper theme={theme} onTriggerAlert={...} />` and `<GestureHud />`.
2. **Spatial Wrapper (`app/soc-spatial.tsx`)**:
   - Subscribes to `spatialTransform` discrete state (`mode`: `COMMAND` | `SPATIAL` | `FOCUS`).
   - Hosts the floating mode bar (`COMMAND [F]`, `SPATIAL [O]`, `RESET [R]`, `EXIT FOCUS [ESC]`, `PERF TOGGLE`).
   - Hosts `soc-spatial-stage` (direct-DOM transformed container) mounting `IncidentUniverse`.
   - Hosts the virtual hands-free reticle cursor (`spatial-virtual-cursor`).
3. **Primary Spatial Canvas (`app/spatial/incident-universe/IncidentUniverse.tsx`)**:
   - Uses `useSecuritySpatial()` to load incidents and compute sunflower-spiral spatial layout.
   - Registers spatial nodes with `spatialController` for dwell/click hit-testing.
   - Contains top HUD stat row (`INCIDENTS`, `CRITICAL`, `AVG RISK`, `ASSETS`, `IOCs`).
   - Renders `IncidentNode` entities and SVG dynamic connection lines.
   - When `focusedIncidentId` is set, renders `IncidentFocusPanel` overlay which delegates to `InvestigationHub`.

---

## 5. Current State Management & Reactive Subscriptions

`SecurityService` uses an internal event emitter. The following events are already dispatched and can drive real-time Command Center updates without page reloads:
- `INCIDENTS_UPDATED`: Fired when incidents are created, status changes, or scenario steps.
- `INCIDENT_DETAIL_UPDATED`: Fired when evidence or investigation details change.
- `RESPONSE_ACTION_UPDATED`: Fired on response action request, approval, rejection, or execution.
- `AUDIT_APPENDED`: Fired whenever an audit log entry is recorded.
- `SESSION_CHANGED`: Fired on user login/logout/role switch.

---

## 6. Legacy & Obsolete Code to Remain Unused

The following legacy files exist in the repository but must **NOT** be resurrected or mounted:
1. `app/soc-dashboard.tsx`: Legacy 2D flat dashboard containing static timers, hardcoded charts, and simulated intervals. **MUST REMAIN UNUSED**.
2. `app/cyber-dashboard.tsx`: Early telemetry prototype. **MUST REMAIN UNUSED**.
3. `app/vehicle-dashboard.tsx`: 3D vehicle demo dashboard (only active when `showCar === true`). **KEPT ISOLATED IN CAR MODE**.

---

## 7. Recommended Integration Points for Step 1

### 7.1 New Core Service: `app/core/security/threat-level-service.ts`
- Implement deterministic `calculateThreatLevel(snapshotData)`:
  - Normal: Base score < 25
  - Elevated: Base score 25 – 54
  - High: Base score 55 – 79
  - Critical: Base score ≥ 80
- Calculate `SecurityOperationsSnapshot` containing all 10 required metrics.
- Export clean helper functions reusable across both Spatial and Hook layers.

### 7.2 Updated Hook: `app/spatial/state/use-soc-snapshot.ts`
- Hook that subscribes to `SecurityService` events (`INCIDENTS_UPDATED`, `RESPONSE_ACTION_UPDATED`, `AUDIT_APPENDED`, `SESSION_CHANGED`).
- Emits reactive, fresh `SecurityOperationsSnapshot` derived strictly from canonical entities.

### 7.3 Spatial Command Center Component: `app/spatial/command/CommandCenterOverlay.tsx`
- Spatial-native, cinematic command overlay integrated seamlessly into `SocSpatialWrapper` / `IncidentUniverse`.
- Visual hierarchy:
  - **Top Sector: Threat State Beacon & Telemetry** — dynamic pulse, deterministic status, alert count, active risk profile.
  - **Operational Pillars (Horizontal Halo / Orbital Pods)**:
    - **Incident Command Pod**: Active incidents list with instant discovery (ID, title, severity, assets, phase, select to investigate).
    - **Asset Posture Pod**: Breakdown of Healthy, Suspicious, Compromised, Isolated assets with interaction hooks.
    - **IOC Constellation Pod**: Active/critical IOCs, blocked vs unblocked status.
    - **SOAR Response Pod**: Active response actions in flight (pending approval, executing, completed).
  - **Live Operational Activity Stream**: Scrolling chronologically ordered audit log with real timestamps, actor, action, target, and outcome.
- **Incident Selection Flow**:
  - Clicking/selecting an incident in the Command Center calls `spatialTransform.setFocusedPanel(incidentId)`.
  - Seamlessly engages the existing `PROXIMITY` → `FOCUSING` → `INVESTIGATION_OPEN` choreography in `IncidentFocusPanel` / `InvestigationHub`.
  - No duplicate workflow or competing state machines.

---

## 8. Audit Conclusion

The current codebase is in a clean, stable state with 0 TypeScript errors and full offline capability. The existing spatial infrastructure (`SpatialTransformManager`, `IncidentUniverse`, `InvestigationHub`, `SecurityService`) provides the exact integration hooks needed to mount a spatial-native Command Center without modifying gesture pipelines, creating duplicate RAF loops, or introducing external network dependencies.

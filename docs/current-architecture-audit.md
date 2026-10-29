# EXPLAIN-SEC SPATIAL — Current Architecture Audit (Stage 0 Baseline)

**Document:** `docs/current-architecture-audit.md`  
**Date:** September 2026  
**Status:** Complete Baseline Audit  
**TypeScript Baseline:** `npx tsc --noEmit` → **0 errors (clean)**  
**Production Build Baseline:** `npm run build:vercel` → **Success (692ms)**  

---

## 1. Executive Summary

EXPLAIN-SEC SPATIAL has completed its foundational architecture:
- Offline-first IndexedDB repository layer (`IdbStore`)
- Pluggable provider architecture (`ISecurityProvider`, `LocalProvider`)
- Canonical domain service (`SecurityService`) with pub/sub eventing and RBAC session control
- Deterministic seed scenario: **Operation BlackTide** (4 incidents, 12 assets, 8 IOCs, 10 timeline events, MITRE coverage, 6 response playbooks)
- Spatial rendering & direct-DOM transform engine (`SpatialTransformManager`) running at 120 FPS
- Computer-vision hand tracking (`GestureEngine`) with MediaPipe Tasks Vision
- Incident Universe with spatial positioning and hit-tested nodes
- Investigation Hub with Attack Graph, Timeline, MITRE Matrix, System Radar, IOC Constellation, Replay, and Response Space

However, the application currently exhibits several architectural discrepancies and MVP limitations:
1. **Legacy Dashboard Collision**: A legacy 734-line `SocDashboard` is mounted inside `SocSpatialWrapper` during `COMMAND` mode, running an unnecessary 2D canvas RAF loop, fake SIEM intervals, and decorative counters.
2. **Default Entry Point**: `app/page.tsx` defaults `showCar = true`, presenting the Model X vehicle study instead of launching directly into the Spatial SOC Incident Universe.
3. **Static Visualizations**: The investigation modules (`AttackGraph`, `SpatialTimeline`, `SystemRadar`, `IOCConstellation`, `SpatialMitreMatrix`) render static SVG/DOM representations with no progressive construction, no sweep arm, no temporal stagger, and no cinematic choreography.
4. **Lack of Central Investigation Presentation State Machine**: Mode switching currently happens via discrete React conditional rendering rather than an orchestrated choreography (IDLE → HOVER/PROXIMITY → FOCUSING → INVESTIGATION_OPEN → CONTEXT_BUILDING → CONTEXT_READY → REPLAYING → RESPONSE → COLLAPSING).

---

## 2. Architectural Analysis

### A. Current Render Hierarchy

```
app/layout.tsx
  └─ app/page.tsx  [Master Shell & Top Header]
       ├─ (If showCar === true)
       │    ├─ VehicleScene (Three.js WebGL canvas + post-processing)
       │    ├─ VehicleDashboard
       │    └─ HandControl panel (webcam video + overlay canvas)
       │
       └─ (If showCar === false)  [PRIMARY TARGET]
            ├─ SocSpatialWrapper  (app/soc-spatial.tsx)
            │    ├─ Floating Mode Bar (COMMAND, SPATIAL, RESET, EXIT FOCUS)
            │    ├─ soc-spatial-stage (Direct DOM Matrix Transform target)
            │    │    ├─ spatial-universe-layer
            │    │    │    └─ IncidentUniverse (app/spatial/incident-universe/IncidentUniverse.tsx)
            │    │    │         ├─ inc-universe-hud (Aggregate security metrics)
            │    │    │         ├─ inc-universe-field
            │    │    │         │    ├─ IncidentNode (1..N spatial nodes)
            │    │    │         │    └─ SVG links
            │    │    │         ├─ (If focusedIncidentId)
            │    │    │         │    └─ IncidentFocusPanel
            │    │    │         │         └─ InvestigationHub (app/spatial/investigation/InvestigationHub.tsx)
            │    │    │         │              └─ InvestigationProvider (Context)
            │    │    │         │                   ├─ Navigation Tabs (ATTACK, TIMELINE, MITRE, SYSTEMS, IOCs, REPLAY, RESPONSE)
            │    │    │         │                   └─ Active View (AttackGraph | SpatialTimeline | SpatialMitreMatrix | SystemRadar | IOCConstellation | AttackReplay | ResponseSpace)
            │    │    │         └─ CreateIncidentModal (Offline modal)
            │    │    │
            │    │    └─ (If mode === 'COMMAND')  [LEGACY SYSTEM TO RETIRE]
            │    │         └─ spatial-dashboard-layer
            │    │              └─ SocDashboard (app/soc-dashboard.tsx)
            │    │
            │    └─ spatial-virtual-cursor (Hands-free reticle: crosshair, brackets, dwell ring)
            │
            └─ GestureHud  (app/gesture-hud.tsx)
                 ├─ Floating diagnostic camera video & canvas
                 └─ GestureEngine instance connected to spatialController
```

### B. Current Gesture Flow

```
Webcam Frame
    ↓
MediaPipe HandLandmarker (app/gesture-engine.ts)
    ↓
Feature Extraction:
  - Palm width = distance(INDEX_MCP, PINKY_MCP)
  - Normalized Openness = mean(fingertip → wrist) / palmWidth
  - Pointing = Index extended, remaining 3 fingers curled
  - Fist = Openness < 1.15; Splay = Openness > 1.95
    ↓
State Transitions (Dwell smoothing: 260ms open/fist, 220ms pointing, 160ms 2-hand)
    ↓
Intent Dispatch (app/spatial-controller.ts):
  - MODE_EXPLODE_SPATIAL   → spatialTransform.setMode('SPATIAL')
  - MODE_COLLAPSE_COMMAND  → spatialTransform.setMode('COMMAND')
  - EXIT_FOCUS             → spatialTransform.setFocusedPanel(null)
  - POINTING               → spatialController.hitTest(x, y) → dwell countdown → select
  - SPATIAL_TRANSFORM      → spatialTransform.applyTwoHandTransform(...)
  - PALM_MOVE              → spatialTransform.panBy(...)
```

### C. Current Animation & Render Loops

| System | Loop Type | Frequency | Location | Status |
| --- | --- | --- | --- | --- |
| `SpatialTransformManager` | `requestAnimationFrame` | 60–120 FPS | `app/spatial-transform.ts` | **Keep** — High-performance direct-DOM matrix lerping |
| `GestureEngine` | `requestVideoFrameCallback` / RAF | Camera FPS (30–60 FPS) | `app/gesture-engine.ts` | **Keep** — Vision tracking pipeline |
| `VehicleScene` | Three.js RAF | 60–120 FPS | `app/vehicle-scene.tsx` | **Isolate** — Only runs when `showCar === true` |
| `SocDashboard` | 2D Canvas RAF | 60 FPS | `app/soc-dashboard.tsx` | **REMOVE (Stage 1)** — Obsolete legacy attack map |
| `SocDashboard Timers` | `setInterval` | Various (1s, 3s, 4s) | `app/soc-dashboard.tsx` | **REMOVE (Stage 1)** — Synthetic traffic/log tickers |
| `Investigation Replay` | `setInterval` via `useRef` | 2500ms | `InvestigationContext.tsx` | **Upgrade (Stage 9)** — Throttled state-advancing timer |

### D. Security Data Flow

```
IndexedDB (`explainsec_spatial_db`)
    ↓
LocalProvider (`app/core/providers/local-provider.ts`)
    ↓
SecurityService (`app/core/security-service.ts`)  [Pub/Sub + RBAC]
    ↓
    ├─ useSecuritySpatial()  →  IncidentUniverse (incidents, counts, risk)
    ├─ InvestigationProvider →  InvestigationHub (incident detail, attack graph, radar, IOCs, MITRE)
    └─ ResponseSpace         →  SOAR playbooks, action execution, audit stream
```

### E. Persistence Flow

- Stores in IndexedDB: `incidents`, `timeline_events`, `assets`, `users`, `iocs`, `mitre_techniques`, `response_actions`, `playbooks`, `audit_logs`, `sessions`, `meta`.
- Writes occur during:
  - Offline incident creation (`CreateIncidentModal`)
  - Response action status updates & playbook execution (`ResponseSpace`)
  - Audit logging (`logAudit`)
  - Session logins (`login`)
- Reactive UI updates trigger through `securityService.publish(event, payload)`.

### F. Legacy Dashboard Dependencies (To Remove in Stage 1)

1. **`app/soc-dashboard.tsx`**:
   - Contains: Legacy 2D canvas attack vector map with independent RAF loop, synthetic SIEM log generator, Defcon ticker, cluster resource monitors.
   - Consumer: Mounted in `app/soc-spatial.tsx` (lines 6, 53, 144–157) when `mode === 'COMMAND'`.
   - Dead import: `app/page.tsx` line 40.
2. **`app/cyber-dashboard.tsx`**:
   - 286 lines of unused vehicle telemetry markup; unreferenced in active code.
3. **`showCar` initial state**:
   - `app/page.tsx` line 86 defaults to `true`. Must default to `false` so the Spatial SOC loads directly.
4. **COMMAND Mode Semantics**:
   - In `soc-spatial.tsx`, `COMMAND` mode currently overlays the legacy 2D dashboard on top of the Incident Universe. `COMMAND` mode should represent an uncluttered spatial overview of the Incident Universe rather than a legacy dashboard.

---

## 3. Known Technical Debt & Performance Observations

1. **Unnecessary Canvas RAF Loop**: When `mode === 'COMMAND'`, `SocDashboard` runs `requestAnimationFrame` continuously, competing with `SpatialTransformManager` and `GestureEngine` for GPU/CPU cycles.
2. **Static Visualizations**: None of the investigation panels visually convey causality or temporal progression. All nodes and edges appear instantly.
3. **Replay Decoupling**: Replay steps increment a counter and highlight the active node ID, but child views do not reconstruct state or show animated temporal transitions.
4. **Vehicle Study Isolation**: The car study is valuable as a separate mode, but must not be active or initialize WebGL resources when the user is working in the Spatial SOC.

---

## 4. Execution Sequence

- [x] **Stage 0**: Baseline Architecture Audit (This document, verify clean `tsc` and build).
- [ ] **Stage 1**: Remove Legacy System (`SocDashboard` retired, default to Spatial SOC, clean imports/timers/loops).
- [ ] **Stage 2**: Establish Cinematic Investigation State Machine (Central presentation choreography).
- [ ] **Stage 3**: Cinematic Incident Focus (Smooth spatial selection, focus zone transition, progressive reveal).
- [ ] **Stage 4**: Cinematic Timeline (Sequential event appearance, stage connectors, temporal replay sync).
- [ ] **Stage 5**: Attack Graph Construction Animation (Dynamic SVG edge drawing, node pulse, causal focus).
- [ ] **Stage 6**: System Radar Sweep (Continuous rotating radar sweep arm, detection blips, blast radius reaction).
- [ ] **Stage 7**: IOC Constellation (Live relationship construction, indicator differentiation, selection glow).
- [ ] **Stage 8**: MITRE Investigation (Progressive technique illumination linked to attack path & timeline).
- [ ] **Stage 9**: Spatial Replay (Deterministic temporal reconstruction driving all canonical visualizer states).
- [ ] **Stage 10**: Response / SOAR Cinematic Transition (Action subject visual connection, state change animation).
- [ ] **Stage 11**: Hand Interaction Upgrade (Hysteresis, dead zones, smoothing, swipe/point/fist refinement).
- [ ] **Stage 12**: Performance Pass (Batching, CSS variables, zero layout thrashing, 120 FPS validation).
- [ ] **Stage 13**: Visual Coherence Pass (Consistent motion curves, glow levels, cyber aesthetics).
- [ ] **Stage 14**: Offline Verification (Test persistence, IndexedDB, zero network requests).
- [ ] **Stage 15**: AI Connector Preparation (Clean abstraction layer for future offline/local AI).
- [ ] **Stage 16**: Final Validation & Master Verification.

---

## 5. Baseline Verification Record

- **TypeScript Typecheck**: `npx tsc --noEmit` → Exit code 0 (0 errors).
- **Vite Production Build**: `npm run build:vercel` → Exit code 0 (built in 692ms).
- **Explosion Geometry Validator**: `node --experimental-strip-types scripts/validate-explosion.mjs` → Exit code 0 (334 slots valid).

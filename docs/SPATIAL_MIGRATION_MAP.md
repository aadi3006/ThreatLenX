# EXPLAIN-SEC SPATIAL — Migration Map & Architecture Audit

**Document:** `docs/SPATIAL_MIGRATION_MAP.md`  
**Status:** Architectural Audit & Phase 1 Migration Specification  
**Author:** AI System Engineering / Pair Programming Agent  
**Target:** Offline-First Spatial SOC Command Interface  
**Reference Documents:**  
- [`spatial_product_spec.md`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/spatial_product_spec.md)  
- [`docs/HAND_INTERACTION_ARCHITECTURE.md`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/docs/HAND_INTERACTION_ARCHITECTURE.md)  
- Reference Screenshots: [`Screenshots/`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/Screenshots)  
- Upstream EXPLAIN-SEC Codebase: `D:\explain-sec\explain-sec\explain-sec`

---

## Executive Summary

This document establishes the comprehensive technical migration map for evolving the current working spatial hand-tracking prototype (`sites-project` / Model X Studio Tron) into **EXPLAIN-SEC SPATIAL** — an offline-first, hands-free spatial cybersecurity operations center (SOC).

Per the core product vision in [`spatial_product_spec.md`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/spatial_product_spec.md), this project does **not** copy 2D cards, tables, and sidebars into 3D floating panels. Instead, it converts security entities (incidents, alerts, telemetry events, assets, IOCs, MITRE techniques, evidence, and response actions) and their relationships into an interactive spatial operations environment.

---

## A. Current Architecture

### 1. Technology Stack & Framework
- **Runtime & Bundler:** Next.js-compatible Vite framework (`vinext` 1.0.0-beta.5 + Vite 8.0.13), with Cloudflare Workers dev harness (`@cloudflare/vite-plugin` 1.37.1).
- **UI Framework:** React 19.2.6 + React DOM 19.2.6 (Strict TypeScript 5.9.3).
- **Styling:** Vanilla CSS design system in [`app/globals.css`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/globals.css) (67KB, ~1,150 lines) + Tailwind CSS 4.2.1 + Shadcn UI base primitives (`@base-ui/react`, `@shadcn/react`).
- **Vision & AI Inference:** MediaPipe Vision Tasks (`@mediapipe/tasks-vision` 0.10.35) using `HandLandmarker` running in `VIDEO` mode on client webcam stream (640×480).
- **3D Graphics & Scene Graph:** Three.js 0.159.0 (`@types/three` 0.159.0) used in [`app/vehicle-scene.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/vehicle-scene.tsx) (car study) and [`app/globe-scene.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/globe-scene.tsx).
- **Audio Synthesizer:** Procedural Web Audio API synthesizer in [`app/cyber-audio.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/cyber-audio.ts) (zero external audio asset files).

### 2. Application Modes & Dual-Entry Structure
The current root component in [`app/page.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/page.tsx) operates in two distinct operational branches:
1. **Holographic Vehicle Study (`showCar = true`):**
   - 3D interactive wireframe Tesla Model X (775k triangles, 334 modeled pieces).
   - Orbit controls, system isolation, explosion layouts, parts catalog.
   - Hand control via legacy [`app/hand-control.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/hand-control.ts).
2. **Spatial SOC Command Wall (`showCar = false`):**
   - Renders [`app/soc-spatial.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/soc-spatial.tsx) (spatial wrapper, canvas stage, floating mode bar, advanced virtual reticle cursor).
   - Renders [`app/soc-dashboard.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/soc-dashboard.tsx) (8 registered spatial panels).
   - Renders [`app/gesture-hud.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/gesture-hud.tsx) (compact diagnostic HUD, webcam preview, developer profiler).
   - Controlled via [`app/gesture-engine.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/gesture-engine.ts), [`app/spatial-controller.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/spatial-controller.ts), and [`app/spatial-transform.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/spatial-transform.ts).

---

## B. Existing Reusable Systems

| System | Location | Current Capability | Reusability in EXPLAIN-SEC Spatial |
|---|---|---|---|
| **Gesture Engine** | [`app/gesture-engine.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/gesture-engine.ts) | 30 FPS MediaPipe inference, mutex concurrency guard, adaptive velocity EMA smoothing, 6-state deterministic FSM, gesture lock/cooldown. | **100% Reusable** — Core engine for hands-free spatial control. Already decoupled from UI. |
| **Spatial Transform Manager** | [`app/spatial-transform.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/spatial-transform.ts) | 60 FPS RAF spring-lerp interpolation, direct DOM transform writes (`translate3d`, `scale`, `rotate`), throttled discrete React subscriber. | **100% Reusable** — Manages continuous matrix physics without React re-renders. |
| **Spatial Interaction Controller** | [`app/spatial-controller.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/spatial-controller.ts) | GestureIntent → action mapping, hit-testing, debounced dwell, hands-free element clicks, rAF-debounced proximity cache. | **95% Reusable** — Expand with multi-tier investigation spaces and entity selection. |
| **Virtual Reticle Cursor** | [`app/soc-spatial.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/soc-spatial.tsx) + [`app/globals.css`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/globals.css) | SVG radial dwell meter (`stroke-dashoffset`), contracting corner brackets, target telemetry badge, lock flash. | **100% Reusable** — Flagship hands-free targeting interface. |
| **Developer Profiler & HUD** | [`app/gesture-hud.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/gesture-hud.tsx) | Live telemetry (Tracking FPS, Render FPS, Camera FPS, Inference latency ms, Main-thread CPU latency, Dropped frames). | **100% Reusable** — Critical for maintaining 30+ FPS tracking & 60 FPS render budgets. |
| **Procedural Audio Synthesizer** | [`app/cyber-audio.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/cyber-audio.ts) | Procedural Web Audio API: clicks, selects, mode switches, scans, slider pitch, rising dwell ticks (700-1800Hz), lock chimes. | **100% Reusable** — Immediate tactical feedback with 0 external sound files. |
| **Attack Vector Canvas Engine** | [`app/soc-dashboard.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/soc-dashboard.tsx#L160-L280) | 2D canvas particle & arc vector animation between global telemetry nodes with progress, speed, and severity styling. | **85% Reusable** — Foundation for the Attack Path Reconstruction & Replay engine. |
| **Upstream Telemetry Correlator** | `D:\explain-sec\...\correlator` | `correlationEngine.js`, `qualificationEngine.js`, `riskEngine.js`, `entityRegistry.js`, clustering rules. | **Directly Adoptable** for offline SOC engine. |
| **Upstream Enterprise Generator** | `D:\explain-sec\...\generator` | `canonicalIncidentBuilder.js`, `enterpriseGenerator.js`, `simulationProfiles.js`. | **Directly Adoptable** for reproducible offline scenarios. |
| **Upstream Governance & Audit** | `D:\explain-sec\...\security` | `auditEngine.js`, `authorizationEngine.js`, `permissions.js`, `policies.js`, `timelineEngine.js`. | **Directly Adoptable** for RBAC, tamper-evident audit trail, and SOAR execution. |

---

## C. Existing Spatial Systems

The spatial environment currently implements a three-mode matrix:
1. **COMMAND Mode (Grid Layout):**
   - 8 SOC panels rendered in high-density responsive grid (`.soc-grid-layout`).
   - Normal scale (`1.0x`), zero rotation, zero pan offset.
   - Proximity reactions active (ambient border glows when hand hovers in front of camera).
2. **SPATIAL Mode (Exploded 3D Matrix):**
   - Triggered via Open Palm hold (280ms) or `O` key.
   - Stage gets 60 FPS direct DOM transforms (`translate3d(X, Y, 0) scale(S) rotate(R)`).
   - Panels explode outward according to predefined spatial coordinates (`data-spatial="true"`):
     - `threat-map`: Center (0, 0, z=0)
     - `threat-assess`: Upper-Left (-42%, -44%, z=1)
     - `siem-throughput`: Upper-Center (0%, -44%, z=1)
     - `waf`: Upper-Right (+42%, -44%, z=1)
     - `neural-sentry`: Far-Right (+52%, 0%, z=2)
     - `siem-logs`: Bottom-Left (-38%, +46%, z=2)
     - `cluster-health`: Bottom-Center (0%, +50%, z=2)
     - `tactical-actions`: Bottom-Right (+38%, +46%, z=2)
   - Two-hand continuous virtual manipulation (midpoint → pan, distance → zoom, angle → rotation) with baseline snapshot and continuous deadzone filtering.
   - Single open palm continuous movement (`PALM_MOVE`) allows one-handed panning across the workspace.
3. **FOCUS Mode (Maximized Panel Inspection):**
   - Triggered via Index Point + Dwell (600ms) or panel click.
   - Targeted panel scales to fill the viewport (`data-focused="true"`), remaining panels dim and blur (`data-dimmed="true"`).
   - Reticle cursor switches to element targeting: pointing at interactive buttons inside the focused panel triggers an arming countdown (650ms) and executes `.click()`.
   - Exit focus via Fist gesture or `ESC` key.

---

## D. Existing Gesture Systems

### Pipeline Architecture:
```text
Webcam (640×480 @ 30fps)
      │
      ▼
requestVideoFrameCallback (Frame Scheduler)
      │
      ├─► isInferring Guard (prevents frame queue stacking)
      │         │
      │         ▼
      │   MediaPipe HandLandmarker (VIDEO mode)
      │         │
      │         ▼
      │   Landmark Normalization (21 3D points per hand)
      │         │
      │         ▼
      │   Adaptive Velocity-Aware Smoothing (α = 0.18 stationary → 0.85 high-velocity)
      │         │
      │         ▼
      │   Deterministic Gesture FSM (IDLE → ONE_HAND_SHAPE → CANDIDATE → ACTIVE)
      │         │
      │         ▼
      │   GestureIntent Dispatched:
      │   - MODE_EXPLODE_SPATIAL
      │   - MODE_COLLAPSE_COMMAND
      │   - EXIT_FOCUS
      │   - POINTING { tip }
      │   - POINTING_RELEASED
      │   - PALM_MOVE { delta }
      │   - TWO_HAND_START
      │   - SPATIAL_TRANSFORM { deltaPan, zoomRatio, deltaAngle }
      │   - PROXIMITY { center }
      │   - PROXIMITY_LOST
      │
      └─► 60 FPS Visual Loop (requestAnimationFrame)
                │
                ├─► DOM Stage Transform (translate3d, scale, rotate)
                ├─► DOM Reticle Cursor (screen X, Y, dwell progress, badge)
                ├─► DOM Proximity & Dwell Glows
                └─► Canvas Skeleton Overlay (HUD preview)
```

### Hand Vocabulary Summary:
1. **Open Palm (Facing Camera):** Hold ≥280ms → Enters `SPATIAL` mode. Moving palm shifts spatial workspace laterally.
2. **Two Hands:** Bimanual frame. Distance controls zoom, midpoint controls pan, angle controls rotation.
3. **Index Point:** Angle-invariant 3D reach test ($d(\text{index}) > 1.22 \times d(\text{middle})$). Reticle cursor tracks index tip.
4. **Point + Dwell:**
   - On Panel: 600ms dwell with radial SVG meter → Activates `FOCUS` mode.
   - Inside Focused Panel: 650ms dwell on action buttons → Executes button click.
5. **Fist:** If in `FOCUS` mode → Exits focus. If in `SPATIAL` mode → Collapses back to `COMMAND` grid.
6. **Proximity:** Emitted continuously on hand presence; drives panel border glows and scanlines based on Euclidean distance.

---

## E. Existing Performance Bottlenecks & Historic Causes

During previous iterations, the prototype experienced 1–5 FPS interaction lag. Profiling identified and resolved five major bottlenecks:

| Root Cause | Mechanism | Previous Impact | Permanent Solution Implemented |
|---|---|---|---|
| **60 FPS React Rerender Loop** | `setActiveAttacks([...localAttacks])` invoked inside canvas animation RAF loop 60 times/sec. | Entire 670-line React tree reconciled on every frame, starving main thread. | Replaced React state with direct DOM `textContent` ref (`attackCountRef`). **Eliminated 60 rerenders/sec**. |
| **Dual Vision Pipelines Running Concurrently** | `HandControl` and `GestureEngine` both opened `getUserMedia()` and ran two MediaPipe GPU instances simultaneously. | Heavy GPU contention, dropped camera frames, 40ms+ CPU stall. | Restricted `HandControl` strictly to Car mode (`showCar && wantGesture`). Only one engine active. |
| **Synchronous Inference Stalling RAF** | `detectForVideo()` called synchronously inside RAF loop without concurrency guards. | Blocked rendering thread for 45–95ms per camera frame. | Decoupled inference via `requestVideoFrameCallback` + `isInferring` mutex lock. |
| **HUD React State Churn** | `setDiagnostics(diag)` updating React state on every inference frame (30–60 Hz). | React scheduling thrashing, micro-stutters. | Throttled diagnostics updates to 4 Hz (250ms), skeleton canvas drawn directly in RAF. |
| **CSS Transition Fighting RAF** | `.soc-spatial-stage` had CSS `transition: transform 0.04s linear` which fought RAF lerp transforms. | Visual stuttering, delayed response, frame judder. | Set `transition: none !important` on active transform stages; CSS transitions reserved for non-continuous states. |

**Performance Rule for All New Features:**
> *Never update React state inside per-frame camera or RAF loops. Continuous tracking, cursor movement, graph layout animation, and dwell timers must mutate direct DOM nodes, CSS custom properties, or WebGL/Canvas buffers directly. React state is reserved strictly for discrete semantic state transitions (mode changes, entity selections, lifecycle events).*

---

## F. Existing Static Dashboards & Functionality

The existing prototype includes two dashboard implementations:

### 1. `SocDashboard` ([`app/soc-dashboard.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/soc-dashboard.tsx))
- **DEFCON Posture & Threat Score:** Real-time fluctuating threat score, blocked attack counter, air-gapped readiness indicator.
- **SIEM Throughput & Detection Rate:** Ingestion rate (GB/s, packets/sec), MITRE technique detection counter, active heuristic scanners.
- **WAF & Cloud Armor Threat Mitigator:** Intercepted payload distribution, rate limiting, bot scrub filter status.
- **Global Threat Vector Canvas:** Interactive 2D map canvas simulating inter-node attack trajectories across 9 global points.
- **Neural Sentry Defense Matrix:** Autonomous containment engine status, quarantined hosts counter, model confidence rating.
- **Live SIEM Event Log Stream:** Auto-scrolling simulated log stream with severity badges (`CRITICAL`, `WARN`, `INFO`, `BLOCKED`).
- **Cluster Health & Node Telemetry:** Sentinel node status, cluster CPU / memory gauges, node health distribution.
- **Tactical Incident Response Actions:** 4 high-priority response buttons (`Lockdown Perimeter`, `Quarantine Host`, `Rotate SSL`, `Deep Scan`).

### 2. `VehicleDashboard` ([`app/vehicle-dashboard.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/vehicle-dashboard.tsx))
- Holographic automotive telemetry: battery pack thermals, dual motor torque, regenerative braking curve, subsystem isolation matrix. Kept intact for zero regression on Car mode.

---

## G. Screenshot → Existing Implementation Mapping

The reference screenshots in [`Screenshots/`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/Screenshots) capture the complete EXPLAIN-SEC operational suite. Below is the mapping from existing reference materials to current implementations and target spatial equivalents:

| Screenshot / Folder | Workflow / Role | Reference Concept | Existing Workspace Implementation | Target Spatial Equivalent ([`spatial_product_spec.md`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/spatial_product_spec.md)) |
|---|---|---|---|---|
| `Login.png` | Authentication | Zero Trust Analyst Login (User ID, Role, Tenant Key) | Mock session in `page.tsx` | **Offline Local Auth Space** (User/Role switch, persistent session) |
| `soc_l1/l1_dashboard.png` | SOC L1 Triage | Alert queue, unassigned alerts, initial triage status, severity breakdown | Simulated logs in `soc-dashboard.tsx` | **L1 Command Space** (Alert Stream + Incident Queue) |
| `soc_l1/triage+falsepostive.png` | SOC L1 Triage | Alert dismissal, false positive tagging, justification notes | Simulated in logs | **Spatial Triage Inspector** (Point+Dwell tag as FP / Escalate) |
| `soc_l1/escalation_to_l2.png` | SOC L1 Triage | Formal escalation modal to L2 with summary and artifacts | None | **Spatial Escalation Ribbon** (Open Palm confirm escalation) |
| `soc_l2/l2_dashboard.png` | SOC L2 Analysis | Advanced incident investigation, correlation clustering, root cause | `threat-assess` & `siem-logs` | **Incident Universe Anchor** (Incident Universe entry point) |
| `soc_l2/request_containment.png` | SOC L2 Response | Containment request workflow (isolate host, revoke token) | `tactical-actions` buttons | **SOAR Containment Request Ring** (Preview blast radius) |
| `ir/ir_dashboard.png` | Incident Response | Active containment workflows, quarantined asset inventory | `tactical-actions` | **Response Space** (Quarantined Hosts Radar + Active Actions) |
| `ir/ir_containment_action_request.png` | Incident Response | Host isolation ticket, risk assessment, impact preview | None | **Spatial Blast Radius Inspector** (Affected asset highlight) |
| `ir/ir_containment_action_approved.png` | Incident Response | Approved action execution, automated playbook step-through | Simulated alert triggers | **SOAR Playbook Execution Canvas** (Step-by-step progress) |
| `ir/ir_containment_action_rejected.png` | Incident Response | Containment rejection with managerial audit reasoning | None | **Audited Action Outcome Card** in Evidence Space |
| `manager/manager_dashboard_1.png` & `_2.png` | SOC Manager | Executive metrics (MTTD, MTTR, SLA compliance, analyst load) | Metrics in `soc-dashboard` | **Manager Spatial Overview** (Compact high-level health HUD) |
| `manager/manager_command_console_1.png` - `_3.png` | SOC Manager | Unified command console, real-time alert triage, incident queue | `SocSpatialWrapper` | **Spatial Command Space** (Expanded threat field) |
| `manager/incident_investigation.png` | SOC Manager / L2 | Deep incident view: timeline, correlation chain, affected entities | None (single flat panel) | **Incident Universe** (Attack Graph + Timeline + Evidence) |
| `manager/Containment_approval.png` | SOC Manager | Managerial two-analyst containment authorization | None | **Tactical Confirmation Arc** (Open Palm confirm / Fist cancel) |
| `manager/analytics.png` | SOC Manager | Attack trends, MITRE matrix coverage, recurring threat vectors | Metrics in `siem-throughput` | **Interactive ATT&CK Matrix** (Spatial technique coverage) |
| `phase 2/Incident Correlation.png` | Correlation Engine | Grouped alerts forming composite high-confidence incidents | Flat logs in `soc-dashboard` | **Correlation Graph** (Dynamic node-link correlation tree) |
| `phase 2/Flow Graph.png` | Attack Graph | Entity-relationship graph (Actor → IP → Host → Hash) | Global node map canvas | **Dynamic Attack Graph** (Spatial force-directed graph) |
| `phase 2/Engine.png` | Detection Rules | Heuristic rule configuration, correlation rule definitions | Hardcoded in `soc-dashboard` | **Deterministic Scenario Engine** (Reproducible attack generator) |
| `phase 2/Side View.png` | Investigation Detail | Collapsible entity inspection drawer with forensic evidence | None | **Spatial Inspector** (Progressively disclosed entity card) |
| `threat hunter/threat_hunter_dashboard.png` | Threat Hunter | Hypothesis tracking, IOC search, anomalous baseline queries | None | **Threat Hunt Space** (IOC Constellation + Telemetry Query) |
| `admin/admin_dashboard.png` & `soc_configuration.png` | Platform Admin | Configuration, engine parameters, data retention, ingestion | None | Compact conventional admin panel inside spatial canvas |
| `admin/audit_logs.png` | Compliance / Audit | Tamper-evident operational audit trail | Hardcoded logs in `soc-dashboard` | **Spatial Audit Log Stream** (Cryptographically signed logs) |
| `admin/user_management.png` & `role_management.png` | Identity & RBAC | User accounts, RBAC assignment, permissions matrix | None | **Local RBAC Authority** (Role context selector) |

---

## H. Existing Data / Domain Model

### Current Spatial Prototype Domain Model:
The current prototype in [`app/soc-dashboard.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/soc-dashboard.tsx) uses simplified inline types:
```typescript
interface AttackVector {
  id: string;
  from: { name: string; x: number; y: number };
  to: { name: string; x: number; y: number };
  type: string;
  severity: 'critical' | 'high' | 'medium';
  progress: number;
}

interface SiemLog {
  timestamp: string;
  id: string;
  source: string;
  event: string;
  level: 'CRITICAL' | 'WARN' | 'INFO' | 'BLOCKED';
}
```

### Upstream EXPLAIN-SEC Domain Model (Available for Reuse):
The upstream codebase at `D:\explain-sec\explain-sec\explain-sec\src` provides a rich enterprise domain model:
- **Incident Model (`src/telemetry/generator/canonicalIncidentBuilder.js`):**
  `Incident = { id, title, severity, riskScore, status, confidence, createdAt, affectedAssets[], affectedUsers[], iocs[], mitreTechniques[], timelineEvents[], correlationChain, evidence[] }`
- **Correlation Cluster (`src/telemetry/correlator/correlationCluster.js`):**
  Cluster definitions grouping alerts by asset ID, IP address, user principal, or temporal correlation window.
- **Risk Scoring Engine (`src/telemetry/correlator/riskEngine.js`):**
  Multi-factor risk score calculation based on asset criticality, attack progression, and threat actor telemetry.
- **Security Context & RBAC (`src/security/securityContext.js`, `permissions.js`):**
  Formal role definitions (`L1_ANALYST`, `L2_ANALYST`, `INCIDENT_RESPONDER`, `THREAT_HUNTER`, `SOC_MANAGER`, `PLATFORM_ADMIN`) with declarative permissions (`INCIDENT_READ`, `CONTAINMENT_REQUEST`, `CONTAINMENT_APPROVE`, `AUDIT_READ`, etc.).

---

## I. Existing Offline Capabilities

- **100% Offline Client Execution:** The current application runs entirely in the browser via Vite dev server / static build. No CDNs, no external font dependencies, no remote image assets.
- **Local MediaPipe Model:** `@mediapipe/tasks-vision` loads hand landmarker WASM and model files locally from `public/` or npm bundle.
- **Procedural Audio:** Web Audio API synthesizer generates all sound dynamically with zero network requests.
- **Zero Cloud Leakage:** No telemetry, tracking, or user data is transmitted over the network.
- **Gaps in Current Offline Implementation:**
  - Incidents and logs are currently generated via ephemeral `setInterval` in React component state.
  - Page refresh resets all metrics, threat score, and logs.
  - No IndexedDB or localStorage persistence layer.
  - No multi-user role switching or offline authentication.

---

## J. Missing Capabilities from `spatial_product_spec.md`

Comparing the current codebase against [`spatial_product_spec.md`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/spatial_product_spec.md):

| Spec Section | Feature Name | Current Status | Required Action |
|---|---|---|---|
| **§3.2 & §5** | **Incident Universe** | Missing | Build flagship spatial anchor: selecting an incident expands Attack Graph, MITRE Matrix, Timeline, Radar, and Evidence around it. |
| **§7** | **Attack Graph Engine** | Partial (2D canvas lines only) | Build interactive node-link spatial attack graph (nodes: Incident, Alert, Asset, User, IOC, Technique; links: `AFFECTS`, `EXECUTED_ON`, `COMMUNICATED_WITH`). |
| **§8** | **Attack Path Reconstruction & Replay** | Missing | Build chronological attack path stepper with Play, Pause, Step, and cross-visualization synchronization. |
| **§9** | **Interactive MITRE ATT&CK Matrix** | Partial (static metric only) | Build interactive ATT&CK matrix visualization synchronized with active attack path. |
| **§10 & §19** | **System Radar & Blast Radius** | Missing | Build radial asset visualization showing directly affected, at risk, and clean assets with blast radius expansion. |
| **§11** | **IOC Constellation** | Missing | Build relational IOC cluster (IPs, domains, hashes) connected to incidents and assets. |
| **§12** | **Spatial Timeline** | Partial (scrolling text log) | Build interactive horizontal spatial timeline with milestone cards and scrubbing. |
| **§14 & §15** | **SOAR Response & Playbook Engine** | Partial (4 simple buttons) | Build formal response action lifecycle (`TARGET` → `PREVIEW` → `CONFIRM` → `EXECUTE` → `AUDIT`) with rollback and approvals. |
| **§16** | **Threat Intelligence Orb** | Partial ([`app/globe-scene.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/globe-scene.tsx)) | Refactor 3D globe into an on-demand, data-driven Threat Intelligence Orb visualizing local GeoIP data. |
| **§17** | **Deterministic AI Narrative Engine** | Missing | Build deterministic rule-based security narrative generator for incident summaries and recommended actions. |
| **§27 & §28** | **Durable Local Persistence** | Missing | Implement `LocalProvider` backed by IndexedDB / Dexie / localStorage for durable offline state. |
| **§29** | **Offline Auth & RBAC** | Missing | Implement offline session management with role-based feature gating (L1, L2, IR, Hunter, Manager, Admin). |
| **§30 & §31** | **Deterministic Attack Scenario Engine** | Partial (random intervals) | Implement reproducible attack scenario player (Credential Compromise, Phishing, Ransomware, Insider Threat). |
| **§39** | **Provider / Connector Architecture** | Missing | Create `SecurityService` abstraction with `LocalProvider` interface, preparing for future `FirebaseProvider` / `ExplainSecProvider`. |

---

## K. Components That Should Be Refactored

1. **[`app/page.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/page.tsx):**
   - Currently holds both Car Study and SOC modes in one large file (778 lines).
   - Refactor into clean top-level workspace router: default directly to Spatial SOC interface, while preserving Car Study as an inspectable secondary mode.
2. **[`app/soc-dashboard.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/soc-dashboard.tsx):**
   - Currently mixes 8 disparate dashboard widgets with mock intervals inside a single file.
   - Refactor into modular spatial panel components (`ThreatAssessmentPanel`, `SiemThroughputPanel`, `ThreatMapCanvas`, `TacticalActionsPanel`) consuming the central `SecurityService`.
3. **[`app/globe-scene.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/globe-scene.tsx):**
   - Currently rendered conditionally in background. Refactor into an on-demand contextual **Threat Intelligence Orb** that mounts only when inspecting global campaign telemetry, consuming local data.
4. **[`app/spatial-controller.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/spatial-controller.ts):**
   - Extend `handlePointing` and dwell systems to support multi-mode navigation (Command Space ↔ Incident Universe ↔ Threat Hunt Space ↔ Response Space).

---

## L. Components That Should Remain Unchanged

1. **[`app/gesture-engine.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/gesture-engine.ts):**
   - The decoupled vision pipeline, inference mutex guard, adaptive EMA smoothing, and deterministic gesture FSM are thoroughly validated and achieve 30+ FPS tracking. Keep intact.
2. **[`app/spatial-transform.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/spatial-transform.ts):**
   - The 60 FPS RAF spring-lerp engine, direct DOM transform writes, and discrete subscriber architecture are rock solid. Keep intact.
3. **[`app/cyber-audio.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/cyber-audio.ts):**
   - Web Audio API synthesizer methods (`playClick`, `playSelect`, `playModeSwitch`, `playScan`, `playDwellTick`, `playLockAcquired`) work cleanly without assets.
4. **[`app/vehicle-scene.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/vehicle-scene.tsx) & [`app/parts.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/parts.ts):**
   - Automotive study implementation remains completely functional for zero regression.

---

## M. New Files, Components & Services Required

```text
app/
├── core/                                    # Offline Security Domain & Providers
│   ├── security-service.ts                  # Provider-agnostic service contract
│   ├── providers/
│   │   ├── local-provider.ts                # Offline IndexedDB / local persistence provider
│   │   └── provider-interface.ts            # SecurityProvider TypeScript interface
│   ├── models/
│   │   ├── incident.ts                      # Incident, Alert, Severity, Status
│   │   ├── entity.ts                        # Asset, User, IOC, Process
│   │   ├── attack-graph.ts                  # Graph nodes, edges, relationships
│   │   ├── mitre.ts                         # Tactics, Techniques, Sub-techniques
│   │   ├── timeline.ts                      # Timeline event milestones
│   │   └── audit.ts                         # Tamper-evident operational audit record
│   ├── auth/
│   │   ├── local-auth-service.ts            # Offline authentication & session state
│   │   └── rbac.ts                          # Roles (L1, L2, IR, Hunter, Manager, Admin) & permissions
│   ├── correlation/
│   │   ├── correlation-engine.ts            # Alert correlation & clustering logic
│   │   └── risk-engine.ts                   # Multi-factor asset/incident risk scoring
│   ├── scenario/
│   │   ├── scenario-engine.ts               # Deterministic attack scenario generator
│   │   └── scenarios/                       # Bundled reproducible attack campaigns
│   │       ├── credential-compromise.ts
│   │       ├── ransomware-outbreak.ts
│   │       └── insider-exfiltration.ts
│   └── ai/
│       └── deterministic-narrative.ts       # Structured AI security narrative generator
│
├── spatial/                                 # Spatial Visualization Components
│   ├── incident-universe/                   # Flagship Incident Investigation Anchor
│   │   ├── incident-universe.tsx            # Main Incident Universe coordinator
│   │   ├── attack-graph-view.tsx            # Interactive spatial node-link attack graph
│   │   ├── attack-replay-bar.tsx            # Chronological attack path playback controls
│   │   ├── mitre-matrix-view.tsx            # Interactive spatial ATT&CK matrix
│   │   ├── system-radar-view.tsx            # Blast radius & asset health radar
│   │   ├── spatial-timeline-view.tsx        # Horizontal event milestone scrubber
│   │   ├── ioc-constellation-view.tsx       # Relational IOC cluster visualization
│   │   └── evidence-inspector.tsx           # Forensic artifact inspector
│   ├── threat-hunt/                         # Threat Hunt Space
│   │   └── threat-hunt-space.tsx            # IOC pivoting & hypothesis investigation
│   ├── response/                            # SOAR Response Space
│   │   ├── response-orchestrator.tsx        # Action preview, authorization, execution
│   │   └── playbook-view.tsx                # Spatial SOAR playbook workflow graph
│   ├── auth-space/                          # Offline Authentication Space
│   │   └── login-space.tsx                  # Spatial role selector & credential entry
│   └── threat-orb/                          # Cinematic Contextual Threat Orb
│       └── threat-intelligence-orb.tsx      # On-demand Three.js local infrastructure globe
```

---

## N. Proposed Provider / Connector Boundary

Per `spatial_product_spec.md` §39 and §54, the architecture strictly enforces a unidirectional dependency hierarchy:

```text
┌────────────────────────────────────────────────────────┐
│                   SECURITY DOMAIN                      │
│   (Incidents, Assets, IOCs, MITRE, Audit, RBAC)        │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                  SECURITY SERVICE                      │
│   (Central business logic, correlation, scenarios)     │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                PROVIDER INTERFACE                      │
│   (Unified CRUD, event streams, action dispatch)       │
└──────┬───────────────────┬──────────────────────┬──────┘
       │                   │                      │
┌──────▼──────┐     ┌──────▼──────┐        ┌──────▼──────┐
│LocalProvider│     │FirebaseProv │        │ExplainSecPr │
│ (IndexedDB) │     │ (Phase B)   │        │  (Phase C)  │
└──────┬──────┘     └─────────────┘        └─────────────┘
       │
┌──────▼─────────────────────────────────────────────────┐
│               SPATIAL STATE MANAGER                    │
│   (Current space, active incident, replay timeline)    │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│          SPATIAL VISUALIZATION COMPONENTS              │
│   (Incident Universe, Attack Graph, Radar, Timeline)   │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│             HAND INTERACTION CONTROLLER                │
│   (GestureEngine → Intent → SpatialController)         │
└────────────────────────────────────────────────────────┘
```

### Core Provider Interface Definition:
```typescript
export interface ISecurityProvider {
  readonly id: string;
  readonly isOffline: boolean;

  // Session & Identity
  authenticate(credentials: UserCredentials): Promise<UserSession>;
  getCurrentSession(): UserSession | null;
  getRoles(): RoleDefinition[];

  // Data Queries
  getIncidents(): Promise<Incident[]>;
  getIncidentById(id: string): Promise<IncidentDetail | null>;
  getAttackGraph(incidentId: string): Promise<AttackGraphData>;
  getSystemRadar(incidentId: string): Promise<SystemRadarData>;
  getTimeline(incidentId: string): Promise<TimelineEvent[]>;
  getIocConstellation(incidentId: string): Promise<IocGraphData>;
  getMitreMatrix(): Promise<MitreTechniqueCoverage[]>;
  getAuditLogs(): Promise<AuditRecord[]>;

  // Workflow Actions
  executeResponseAction(action: ResponseActionPayload): Promise<ActionExecutionResult>;
  escalateIncident(incidentId: string, toRole: string, reason: string): Promise<boolean>;
  updateIncidentStatus(incidentId: string, status: IncidentStatus): Promise<boolean>;

  // Scenario Simulation (Offline Engine)
  loadScenario(scenarioId: string): Promise<void>;
  stepScenario(stepIndex: number): Promise<void>;
  resetScenario(): Promise<void>;
}
```

---

## O. Proposed Implementation Order

Following the staged roadmap in `spatial_product_spec.md` §50:

### Stage 1 — Architecture & Core Provider Boundary (Current Stage)
- [x] Complete codebase audit.
- [x] Analyze `spatial_product_spec.md` and `Screenshots/`.
- [x] Author `docs/SPATIAL_MIGRATION_MAP.md`.
- [ ] Define TypeScript domain types and `ISecurityProvider` contract.
- [ ] Implement `LocalProvider` with deterministic in-memory / IndexedDB persistence.

### Stage 2 — Offline Security Core & Scenario Engine
- Implement offline authentication & role switching (SOC L1, SOC L2, IR, Hunter, Manager, Admin).
- Port upstream correlation & risk scoring engines (`correlationEngine.js`, `riskEngine.js`).
- Port deterministic scenario generator (`canonicalIncidentBuilder.js`, `simulationProfiles.js`) with 3 bundled scenarios:
  1. *Credential Abuse & Lateral Movement* (Primary Flagship Flow)
  2. *Ransomware Infiltration & Host Quarantine*
  3. *Cloud WAF Data Exfiltration Attempt*
- Wire tamper-evident audit logging engine.

### Stage 3 — Spatial Incident Universe (Flagship Experience)
- Build `IncidentUniverse` anchor component.
- Implement `AttackGraphView`: Interactive 3D/2D node-link graph with force layout and relationship edges.
- Implement `AttackReplayBar`: Play/Pause/Step controller synchronizing attack progression across all views.
- Implement `SystemRadarView`: Concentric radial blast radius layout (Compromised → At Risk → Safe).
- Implement `SpatialTimelineView`: Horizontal milestone scrubber with event cards.
- Implement `IocConstellationView`: Relational IOC cluster.
- Implement `MitreMatrixView`: Interactive ATT&CK coverage matrix.

### Stage 4 — SOAR Response & Blast Radius Execution
- Implement formal 5-step response lifecycle (`Target` → `Preview` → `Confirm` → `Execute` → `Audit`).
- Implement dual-gesture confirmation: Open Palm hold (confirm) vs. Fist (cancel).
- Live blast radius state updates when host is quarantined or account is disabled.

### Stage 5 — Deterministic AI Narrative Layer
- Implement structured security narrative generator for executive summaries and investigation guidance.
- AI provider abstraction preparing for optional local model / Ollama integration.

### Stage 6 — Threat Intelligence Orb Refactoring
- Refactor [`app/globe-scene.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/globe-scene.tsx) into an on-demand contextual 3D Threat Intelligence Orb that visualizes local campaign infrastructure.

### Stage 7 — Verification & Polish
- Full offline validation (disconnect Wi-Fi/Ethernet).
- 30+ FPS tracking & 60 FPS rendering profiling across all spaces.
- TypeScript compiler and linter clean checks.

---

## P. Risks & Regressions to Avoid

1. **Risk: Re-introducing React Rerenders into Tracking Loop**
   - *Mitigation:* Zero `useState` calls in frame loops. Use direct DOM refs, SVG attribute updates, and CSS custom properties.
2. **Risk: Breaking Car Study Mode**
   - *Mitigation:* Preserve `showCar` branch and keep [`app/vehicle-scene.tsx`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/vehicle-scene.tsx) and [`app/parts.ts`](file:///d:/model-x-studio-tron-main/model-x-studio-tron-main/app/parts.ts) untouched.
3. **Risk: Premature Cloud / Firebase Coupling**
   - *Mitigation:* Strictly implement `LocalProvider` first. Do not add Firebase SDKs or external network dependencies until Phase B.
4. **Risk: Unstable Gesture Accidental Triggers on Response Actions**
   - *Mitigation:* High-impact SOAR actions (host isolation, credential wipe) require multi-step arming: Point + Dwell to select, followed by deliberate Open Palm hold (≥450ms) with audible countdown and Fist cancel option.
5. **Risk: Overwhelming Spatial Density (3D Clutter)**
   - *Mitigation:* Strictly adhere to Progressive Disclosure (§44): Level 1 (Incident Anchor) → Level 2 (Summary & Risk) → Level 3 (Attack Graph & Radar) → Level 4 (Forensic Evidence & Log Details).
6. **Risk: Fabricated / Non-Deterministic Demos**
   - *Mitigation:* Attack paths and event replays must be strictly derived from the relational incident dataset, never arbitrary decorative animations.

# EXPLAIN-SEC SPATIAL — Cinematic Investigation Specification
**Document Status:** Production-MVP Verified  
**Environment:** Spatial Native SOC Investigation Environment  

---

## 1. Core Architectural Principle
EXPLAIN-SEC SPATIAL is not a traditional flat 2D dashboard retrofitted with hand gestures. It is an **offline-first spatial security investigation environment**. Security data is not just visually rendered; it behaves like a live, stateful spatial universe that analysts inspect and manipulate through intuitive direct manipulation and purposeful, state-driven motion.

---

## 2. Central Investigation Choreography State Machine

All visual animations represent actual security state transitions orchestrated by a centralized state machine (`investigation-state.ts` / `InvestigationContext.tsx`), rather than disparate uncoordinated component timers.

```
                  ┌───────────────────────┐
                  │         IDLE          │  (Incident Universe Ambient)
                  └───────────┬───────────┘
                              │ Analyst proximity / Dwell
                              ▼
                  ┌───────────────────────┐
                  │       PROXIMITY       │  (Targeted incident elevates & pulses)
                  └───────────┬───────────┘
                              │ Focus selection
                              ▼
                  ┌───────────────────────┐
                  │       FOCUSING        │  (Universe dims, target zooms to center)
                  └───────────┬───────────┘
                              │ Radial wipe transition
                              ▼
                  ┌───────────────────────┐
                  │  INVESTIGATION_OPEN   │  (Hub shell mounts, telemetry ready)
                  └───────────┬───────────┘
                              │ Sequential construction trigger
                              ▼
                  ┌───────────────────────┐
                  │   CONTEXT_BUILDING    │
                  │  (Sub-Steps 1 → 5)    │
                  │  1. TIMELINE_ENTRY    │
                  │  2. ATTACK_PATH       │
                  │  3. RADAR_SWEEP       │
                  │  4. IOC_CONSTELLATION │
                  │  5. MITRE_MATRIX      │
                  └───────────┬───────────┘
                              │ Construction complete / Fast-forward
                              ▼
                  ┌───────────────────────┐
      ┌───────────┤     CONTEXT_READY     ├───────────┐
      │           └───────────▲───────────┘           │
      │ Replay active         │ Reset                 │ Response tab
      ▼                       │                       ▼
┌───────────┐                 │                 ┌───────────┐
│ REPLAYING │─────────────────┤                 │ RESPONSE  │
└───────────┘                 │                 └─────┬─────┘
                              │                       │ Containment executed
                              │                       ▼
                              │                 ┌───────────┐
                              │                 │ AUDIT LOG │
                              │                 └─────┬─────┘
                              │ Exit / Fist           │
                              ▼                       │
                  ┌───────────────────────┐           │
                  │      COLLAPSING       │◄──────────┘
                  │  (Graceful reverse)   │
                  └───────────┬───────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │         IDLE          │
                  └───────────────────────┘
```

---

## 3. Visualization Upgrades & Temporal Grounding

### 3.1 Incident Universe & Focal Zoom (Stage 3)
- Background nodes scale to `0.88`, dim to `0.12` opacity, and apply subtle backdrop defocus.
- Focal incident node expands outward radiating a dynamic radial gradient `clip-path` centered at the node's exact screen coordinates.
- Dynamic elevation of the focal node with `28px` multi-ring drop shadow and progressive metric reveal.

### 3.2 Spatial Timeline (Stage 4)
- Non-blocking sequential event entrance staggered at `65ms * index`.
- Vertical glowing traveling spine laser pulse (`@keyframes spine-travel`) representing the causal progression from initial access to objective impact.
- Active replay synchronizes the row pulsing while dimming future unexecuted events.

### 3.3 Attack Graph Construction (Stage 5)
- Topological kill-chain ordering derived directly from the canonical graph's `attackPathNodeIds`.
- Self-drawing vector edges using SVG `stroke-dasharray` and `stroke-dashoffset` (`400px` draw animation over `0.9s`).
- Causal path highlighting: selecting an entity illuminates all upstream and downstream causal links while non-relevant nodes dim to `0.16` opacity.

### 3.4 System Radar (Stage 6)
- Continuous `4s` 360° rotating phosphor sweep arm with 38° translucent gradient trail.
- Sweep implemented purely in CSS transforms (`@keyframes radar-sweep-spin`), resulting in **0 React re-renders** and 60 FPS performance.
- Asset detection blips ping with an exact mathematical delay mapped to their polar angle:
  $$\text{delay} = \left(\frac{|\theta|}{2\pi}\right) \times 4\text{s}$$

### 3.5 IOC Constellation (Stage 7)
- Center-out progressive node entry with dynamic SVG lines.
- Blocked IOCs visually differentiated with dashed emerald shields and `[BLOCKED]` status tags.
- Bidirectional hover and selection illumination: selecting an IOC highlights its associated host machines, users, and incident links while dimming unrelated elements.

### 3.6 MITRE Technique Matrix (Stage 8)
- Real-time temporal coupling: techniques highlight progressively as the replay timeline steps through stages.
- Differentiates `FIRING NOW` (active attack execution) from `ACTIVATED` (past technique) and `UNREACHED` (future technique).
- Clickable event badges allow jumping directly between MITRE tactics and correlated timeline events or compromised host assets.

### 3.7 Deterministic Temporal Replay (Stage 9)
- Canonical investigation timeline driving all 5 visualization surfaces concurrently.
- Interactive timeline scrubber slider with click/drag seeking across steps $t_0 \dots t_N$.
- Variable speed controls (`0.5x`, `1x`, `2x`, `4x`) and full keyboard navigation (Space for Play/Pause, Left/Right Arrows for Step, `R` for Reset).

### 3.8 Response Space & Containment Transitions (Stage 10)
- Selected entity from investigation becomes the focal **Subject of Response**.
- Live visual state transitions from canonical `SecurityService`:
  $$\text{DETECTED THREAT} \longrightarrow \text{ISOLATING... (Transmitting)} \longrightarrow \text{ISOLATED (802.1X)}$$
- High-impact confirmation modal with real-time feedback and automatic IndexedDB persistence and audit logging.

### 3.9 Hand Interaction & Precision Tracking (Stage 11)
- Preserves single MediaPipe vision instance and single requestAnimationFrame loop.
- **Pinch Select**: Instant object selection by pinching thumb tip (4) to index tip (8) without waiting for dwell timers.
- **Palm Move Deadzone**: Continuous lateral navigation filtered through a `0.0035` Euclidean deadzone, eliminating camera jitter while providing smooth panning.
- **Two-Hand Transformations**: Continuous scaling and rotation with deadzones and velocity smoothing.

---

## 4. Architectural Rules Compliance
- **Offline First**: Zero external network dependencies or telemetry leaks.
- **IndexedDB Grounding**: All state changes persist deterministically across reloads.
- **Single Source of Truth**: All components bind to `securityService` facades.
- **Zero Duplicate Inference**: Strictly one MediaPipe Tasks Vision instance running.
- **Zero Frame-Rate Sacrifices**: Animations driven by CSS transforms, GPU composition, and DOM styles rather than per-frame React state tickers.

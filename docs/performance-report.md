# EXPLAIN-SEC SPATIAL — Performance Engineering Report
**Benchmark Environment:** Production Bundle (Vite + Rolldown Minification)  
**Target Platform:** WebGL2 / WebGPU Desktop & Mobile AR Browser Viewports  

---

## 1. Executive Summary
During the hardening pass, legacy dashboard loops, duplicate MediaPipe instances, and per-frame React state tickers were permanently retired. All complex visual effects (radar sweep, graph edge drawing, timeline spine lasers, and focal transitions) have been engineered to run directly in CSS hardware transforms and GPU layers.

As a result:
- **Build Time:** < 1.05 seconds consistently.
- **Client Bundle Size:** Reduced by removing dead legacy dashboard structures.
- **Render Loops:** Single RAF loop dedicated to MediaPipe inference and direct DOM transform sync.
- **FPS Overhead:** 0 React state updates occur during continuous animations (radar rotation, reticle ping, spine travel).

---

## 2. Performance Governor & Tiers (Stage 12)

To guarantee 60 FPS across both high-end command stations and low-power mobile/AR tablets, an adaptive performance governor (`performanceManager`) was established with three operational tiers:

| Tier | Default Use Case | GPU Filter Configuration | Continuous Animations |
| :--- | :--- | :--- | :--- |
| **FULL** | High-end GPU / Desktop | Active `backdrop-filter: blur(8px-16px)`, SVG gaussian filters | Phosphor sweep trail, ambient orbits, pulsing beacons |
| **REDUCED** | Integrated GPUs / Laptops | `backdrop-filter` replaced with 94% dark solid fill | Sweep trail disabled, blip ping animations preserved |
| **LOW** | Constrained Mobile / AR | All blur & drop-shadows stripped | Only static nodes and essential indicators active |

Analysts can cycle performance tiers in real-time via the HUD pill button in the top control bar.

---

## 3. Core Optimization Principles Applied

### 3.1 Zero Per-Frame React State
- **Problem:** Updating React component state on every requestAnimationFrame tick causes recursive reconciliations and frame drops.
- **Resolution:** Radar sweep arm rotation runs on CSS `@keyframes radar-sweep-spin`. The detection blip pings derive their phase offset from calculated polar angles in CSS `animation-delay`, requiring **zero JavaScript execution during rotation**.

### 3.2 Single MediaPipe Instance Guard
- MediaPipe Tasks Vision (`HandLandmarker`) is instantiated once and guarded by an `isInferring` mutex flag.
- Video frame callbacks (`requestVideoFrameCallback` with RAF fallback) drop queued frames if an inference step is already in progress, eliminating GPU queue stalls.

### 3.3 Deadzone & Velocity-Aware Gesture Smoothing
- Index finger tip uses an adaptive alpha filter:
  $$\alpha = \text{clamp}(0.18, 0.55, \text{velocity} \times 6.5)$$
  Slow movements are heavily filtered for rock-solid stability during button dwell, while fast movements track with minimal latency.
- Palm swipe navigation includes a `0.0035` Euclidean deadzone, eliminating high-frequency sensor noise.

### 3.4 Direct DOM Transform Updates
- Spatial canvas panning, rotation, and scaling bypass React state and update the container's inline CSS transform matrix directly in `spatial-transform.ts`.

---

## 4. Verification Check Matrix

| Test Item | Verification Method | Status |
| :--- | :--- | :--- |
| TypeScript Validation | `npx tsc --noEmit` | **PASS (0 errors)** |
| Production Build | `npm run build:vercel` | **PASS (0 errors, ~1s build)** |
| Offline Startup | Zero external network calls | **VERIFIED** |
| Single MediaPipe Instance | Audit of `GestureEngine` lifecycle | **VERIFIED** |
| Single RAF Loop | Process audit | **VERIFIED** |
| Memory Leak Guard | `useEffect` cleanup handlers on all subscriptions | **VERIFIED** |
| IndexedDB Persistence | State persists across page refreshes | **VERIFIED** |

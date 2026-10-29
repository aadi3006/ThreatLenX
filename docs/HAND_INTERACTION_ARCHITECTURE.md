# Hands-Free Spatial SOC Command Interface Architecture

## 1. Overview

This document specifies the complete hand-tracking and spatial interaction architecture implemented for the Cyber Security Operations Center (SOC) Command Interface.

The interface converts raw webcam video frames into hands-free spatial manipulation of an 8-panel live cybersecurity operations console.

---

## 2. Five-Layer Architecture Pipeline

```
┌────────────────────────────────────────────────────────┐
│ 1. Computer Vision Capture                             │
│    Webcam stream (640×480) → MediaPipe HandLandmarker  │
│    VIDEO running mode, GPU accelerated with CPU        │
│    fallback, detects up to 2 hands                     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. Feature Extraction & Normalization                  │
│    - Palm center (mirrored screen coordinates)         │
│    - Metric palm span & finger extension ratio         │
│    - Palm normal (Z-plane orientation vector)          │
│    - Index finger pointer ray & tip position           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. Signal Smoothing (Exponential Moving Average)       │
│    - Landmark positions: α = 0.22                      │
│    - Openness metric:    α = 0.35                      │
│    - Two-hand transform: α = 0.25                      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. Deterministic Gesture State Machine                 │
│    - Dwell timers before state transitions             │
│    - Hysteresis band on activation vs release          │
│    - Gesture lock mechanism to prevent double-firing   │
│    - Two-hand anchor snapshot & delta calculation      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 5. Spatial Interaction Controller & UI Render Layer    │
│    - Mode switching: COMMAND / SPATIAL / FOCUS         │
│    - RAF spring interpolation (damping 0.14)           │
│    - Panel bounding box hit-testing & dwell focus      │
│    - Procedural cyber audio synthesis triggers         │
└────────────────────────────────────────────────────────┘
```

---

## 3. Gesture State Machine Specification

### States
- `IDLE`: No hand detected for > 1500 ms.
- `HAND_DETECTED`: Hand present with detection confidence > 0.65.
- `ONE_HAND_SHAPE`: Neutral single hand recognized.
- `OPEN_PALM_CANDIDATE`: Openness > 0.82 with palm facing camera.
- `OPEN_PALM_ACTIVE`: Openness sustained ≥ 280 ms. Dispatches `MODE_EXPLODE_SPATIAL`.
- `FIST_CANDIDATE`: Openness < 0.28.
- `FIST_ACTIVE`: Fist sustained ≥ 280 ms. Dispatches `EXIT_FOCUS` (if focused) or `MODE_COLLAPSE_COMMAND`.
- `POINTING_CANDIDATE`: Index finger extended, other fingers curled.
- `POINTING_ACTIVE`: Sustained index point ≥ 320 ms. Emits continuous screen-space reticle coordinates.
- `TWO_HAND_CANDIDATE`: Two hands detected simultaneously.
- `TWO_HAND_ACTIVE`: Both hands stable ≥ 180 ms. Snapshots anchor and continuously calculates zoom, rotation, and pan deltas.
- `TRACKING_LOST`: Tracking confidence lost for > 600 ms. Freezes spatial state without resetting.

### Thresholds & Hysteresis

| Metric / Parameter | Value | Description |
|---|---|---|
| Openness Activation | `> 0.82` | Threshold to enter `OPEN_PALM_CANDIDATE` |
| Openness Release | `< 0.60` | Hysteresis threshold to exit open palm |
| Fist Activation | `< 0.28` | Threshold to enter `FIST_CANDIDATE` |
| Fist Release | `> 0.55` | Hysteresis threshold to exit fist |
| Palm Normal Threshold | `\|Nz\| > 0.005` | Requires palm facing camera |
| Open Palm Dwell | `280 ms` | Hold duration before triggering Explode |
| Fist Dwell | `280 ms` | Hold duration before triggering Collapse / Exit Focus |
| Pointing Dwell | `320 ms` | Hold duration before displaying reticle cursor |
| Two-Hand Dwell | `180 ms` | Hold duration before locking anchor |
| Action Cooldown | `600 ms` | Minimum time between discrete state triggers |
| Tracking Loss Timeout | `600 ms` | Grace period before entering `TRACKING_LOST` |

---

## 4. Two-Hand Anchor Transform Model

When the user presents two hands, the engine waits 180 ms for tracking stability and captures an **Anchor Snapshot**:
```typescript
interface AnchorSnapshot {
  midpoint: { x: number; y: number }; // Normalized 0-1
  distance: number;                   // Distance between palm centers
  angle: number;                      // Angle in radians (-π to π)
}
```

Continuous transformations are evaluated strictly as **deltas relative to the snapshot**, eliminating drift:
1. **Pan**: `deltaX = (currentMidpoint.x - anchor.midpoint.x) * viewportWidth * 0.9`
   - Deadzone: `2.5%` viewport width
2. **Zoom**: `zoomFactor = currentDistance / anchor.distance`
   - Clamped to range `[0.6, 2.2]`
   - Deadzone: `2%` distance change
3. **Rotation**: `deltaAngle = currentAngle - anchor.angle`
   - Wrapped to `[-π, π]`
   - Deadzone: `0.03 rad (~1.7°)`

---

## 5. Dashboard Modes

### A. COMMAND Mode (Default)
- Standard 3-2-3 CSS grid layout.
- High-density information display.
- Camera and sensor remain in continuous evaluation.

### B. SPATIAL Mode (Exploded Matrix)
- Triggered by **OPEN PALM** (hold 0.3s) or `[O]` key.
- Panels explode outwards into spatial coordinate offsets with smooth CSS bezier transitions:
  - `threat-map`: Center (0%, 0%), scale 1.04x
  - `threat-assess`: Upper Left (-30%, -28%), scale 0.93x
  - `siem-throughput`: Upper Center (0%, -32%), scale 0.93x
  - `waf`: Upper Right (30%, -28%), scale 0.93x
  - `neural-sentry`: Right (36%, 0%), scale 0.95x
  - `siem-logs`: Lower Left (-30%, 28%), scale 0.93x
  - `cluster-health`: Lower Center (0%, 32%), scale 0.93x
  - `tactical-actions`: Lower Right (30%, 28%), scale 0.93x
- Enables continuous 2-hand manipulation (zoom, rotation, panning).

### C. FOCUS Mode
- Triggered by pointing at a panel with index finger (dwell > 650 ms), clicking, or pressing number keys `1`–`8`.
- The target panel scales to center-stage (`scale(1.14)`, elevated `z-index: 9999`, illuminated cyan border glow).
- All background panels dim (`opacity: 0.16`, `blur(4px)`).
- Exited via **FIST** (hold 0.3s), `[ESC]` key, or clicking "EXIT FOCUS".

---

## 6. Keyboard & Mouse Fallback Controls

Full functionality is guaranteed even without webcam access:

| Key | Action |
|---|---|
| `O` / `o` | Explode into **SPATIAL** mode |
| `F` / `f` | **FIST** action: exit focus if focused, else collapse to **COMMAND** mode |
| `ESC` | Exit focus mode |
| `+` / `=` | Zoom in (+0.15x) |
| `-` / `_` | Zoom out (-0.15x) |
| `R` / `0` | Reset transform (zoom, pan, rotation) |
| `Arrow Keys` | Pan spatial canvas (Up, Down, Left, Right) |
| `1`–`8` | Quick-focus panel 1 through 8 directly |
| Click panel | Focus panel |
| Floating Bar | On-screen mode toggle buttons with telemetry |

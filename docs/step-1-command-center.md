# EXPLAIN-SEC SPATIAL — Step 1: SOC Command Center

**Document:** `docs/step-1-command-center.md`  
**Date:** September 2026  
**System:** EXPLAIN-SEC SPATIAL — Offline-First Spatial SOC  
**Milestone:** STEP 1 COMPLETE  

---

## 1. What Was Implemented

In Step 1, EXPLAIN-SEC SPATIAL was transformed from an incident investigation viewer into a full, spatial-native **SOC Command Center**. The Command Center operates as a persistent, real-time command layer positioned directly above and around the 3D Incident Universe.

Key capabilities delivered:
1. **Deterministic Threat-Level Service (`app/core/security/threat-level-service.ts`)**:
   - Computes DEFCON threat score (0–100) and discrete threat tier (`NORMAL`, `ELEVATED`, `HIGH`, `CRITICAL`) using canonical security state.
   - Provides transparent factor breakdowns (active critical incidents, high incidents, compromised hosts, isolated nodes, unblocked threat IOCs, and active SOAR response actions).
2. **Canonical SOC Operations Snapshot**:
   - Derives all 10 required operational metrics directly from `SecurityService`:
     - Threat level & score
     - Critical incident count
     - Active incident count
     - Open alerts count (correlated alerts across active incidents)
     - Compromised asset count
     - Isolated asset count
     - Active IOC count & blocked IOC count
     - Active response actions & pending approval count
     - Active investigations count
     - Real-time recent security activity events
3. **Spatial Command Center HUD (`app/spatial/command/CommandCenter.tsx`, `command-center.css`)**:
   - **Top Sector**: Interactive Threat State Beacon with DEFCON status, pulsing radar core, scoring factor drawer, and operational KPI badges.
   - **Left Flank (Incident Command View)**: Filterable list of active incidents with instant discovery, severity/status badges, host/IOC counts, and one-click transition to investigation.
   - **Right Flank (Asset Posture & SOAR Operations)**: 4-tier posture breakdown (Compromised, Isolated, Suspicious, Healthy), priority compromised hosts list with direct incident connection, and active SOAR response action pipeline.
   - **Bottom Sector**: Compact live operational security activity ticker powered strictly by real persisted audit records and timeline events.
   - **HUD Toggle (`MINIMIZE HUD` / `EXPAND HUD`)**: Enables the analyst to collapse the flanking wings for an unobstructed view of the Incident Universe starfield while keeping the Threat Beacon visible.
4. **Natural Transition into Existing Investigation Choreography**:
   - Selecting any incident in the Incident Command View directly calls `spatialTransform.setFocusedPanel(incidentId)`, smoothly entering the existing 9-phase cinematic investigation state machine (`PROXIMITY` → `FOCUSING` → `INVESTIGATION_OPEN`).
   - When an investigation is open, the Command Center seamlessly transforms into a compact, ambient top threat status ribbon, letting the Investigation Hub take the primary focal plane.
   - Exiting focus (`ESC`, fist gesture, or `EXIT FOCUS` button) restores the full Command Center operational overview.
5. **Performance Governor Integration**:
   - Adapts HUD styling and effects across `FULL`, `REDUCED`, and `LOW` tiers without sacrificing security functionality or data updates.

---

## 2. Architecture & Layering

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Spatial UI & HUD Layer                          │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ CommandCenter (Threat Beacon, KPI Halo, Wings, Activity)        │   │
│   └────────────────────────────────────────────────────────────────┘   │
│           ▲                                         │                  │
│           │ (data snapshot)                         │ (selectPanel)    │
│           │                                         ▼                  │
│   ┌──────────────────────────────┐    ┌────────────────────────────┐   │
│   │ IncidentUniverse (3D Canvas) │    │ InvestigationHub (Focused) │   │
│   └──────────────────────────────┘    └────────────────────────────┘   │
├────────────────────────────────────────────────────────────────────────┤
│                       Spatial Interaction Core                         │
│  - SpatialTransformManager (Matrix3D, 120 FPS Direct DOM)              │
│  - SpatialController (Virtual Reticle Dwell, Hit-Testing)              │
│  - PerformanceManager (FULL, REDUCED, LOW Tiers)                       │
├────────────────────────────────────────────────────────────────────────┤
│                       Security State Facade                            │
│  - SecurityService (Singleton Domain Facade)                           │
│  - ThreatLevelService (Deterministic Scoring & Snapshot Derivation)    │
│  - useSecuritySpatial (Reactive hook with multi-event subscriptions)   │
├────────────────────────────────────────────────────────────────────────┤
│                      Local Persistence Layer                           │
│  - LocalProvider (Offline Security Operations Engine)                  │
│  - IdbStore (IndexedDB 'es-spatial-db' v1 Stores)                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Flow

```
IndexedDB Object Stores
  │
  ▼
LocalProvider
  │
  ▼
SecurityService (getIncidents, getAssets, getIOCs, getResponseActions, getAuditLogs)
  │
  ▼
threat-level-service.ts (buildSecurityOperationsSnapshot)
  │
  ▼
useSecuritySpatial hook (synchronizes React state via SecurityService events)
  │
  ▼
CommandCenter & IncidentUniverse
  │
  ▼ (Analyst clicks incident card or asset)
spatialTransform.setFocusedPanel(incidentId)
  │
  ▼
Choreography Phase: PROXIMITY ──> FOCUSING ──> INVESTIGATION_OPEN
  │
  ▼
InvestigationHub (Attack Graph, Timeline, MITRE, Radar, IOCs, Replay, SOAR)
```

---

## 4. Deterministic Threat-Level Algorithm

The threat level is calculated mathematically with **zero synthetic/random numbers**:

### Factors & Weights:
- **Active CRITICAL Incident**: $+30\text{ pts}$ each
- **Active HIGH Incident**: $+15\text{ pts}$ each
- **Active MEDIUM Incident**: $+5\text{ pts}$ each
- **Compromised Host / Asset**: $+20\text{ pts}$ each
- **Isolated Network Node**: $+5\text{ pts}$ each
- **Suspicious Asset Under Observation**: $+5\text{ pts}$ each
- **Active Unblocked High-Reputation Threat IOC ($\ge 75$)**: $+10\text{ pts}$ each
- **Active / Pending SOAR Response Action**: $+5\text{ pts}$ each

### Formula:
$$\text{Raw Score} = \sum (\text{Active Incident Pts}) + \sum (\text{Asset Pts}) + \sum (\text{IOC Pts}) + \sum (\text{Response Pts})$$
$$\text{Threat Score} = \min(100, \max(0, \text{Raw Score}))$$

### Threat Level Thresholds:
| Score Range | Threat Level | Visual Accent | Beacon Behavior |
| :--- | :--- | :--- | :--- |
| $\ge 80$ | **CRITICAL** | Crimson (`#ff2a2a`) | High-frequency pulse, urgent warning borders |
| $55 - 79$ | **HIGH** | Amber/Orange (`#ff7700`) | Elevated alert pulse |
| $25 - 54$ | **ELEVATED** | Amber/Yellow (`#ffb700`) | Steady tactical amber glow |
| $0 - 24$ | **NORMAL** | Emerald (`#3dffb0`) | Calm breathing emerald glow |

---

## 5. SOC Operational Snapshot Structure

```typescript
export interface SecurityOperationsSnapshot {
  threatLevel: ThreatLevel;
  threatScore: number;
  threatFactors: ThreatFactor[];
  criticalIncidents: number;
  activeIncidents: number;
  openAlerts: number;
  compromisedAssets: number;
  isolatedAssets: number;
  healthyAssets: number;
  suspiciousAssets: number;
  activeIOCs: number;
  blockedIOCs: number;
  activeResponseActions: number;
  pendingApprovals: number;
  activeInvestigations: number;
  recentEvents: SecurityActivityEvent[];
  timestamp: string;
}
```

---

## 6. UI Components

1. **`CommandCenter.tsx`**:
   - `soc-threat-beacon`: Interactive Defcon threat level display, score tag, and expandable factors drawer.
   - `soc-kpi-halo`: 5 compact overview metrics with high-visibility contrast numbers.
   - `soc-left-flank`: Incident Command View with `ALL`, `CRITICAL`, and `ACTIVE` filter tabs, rich incident cards with affected host counts, IOC counts, risk ratings, and direct `OPEN INVESTIGATION` cues.
   - `soc-right-flank`:
     - `asset-pod`: 4-color status bars and high-priority compromised host rows.
     - `response-pod`: Active containment actions with approval status badges (`PENDING_APPROVAL`, `EXECUTING`).
   - `soc-bottom-stream`: Compact live activity stream ticker displaying real audit records.
   - `soc-threat-ribbon`: Compact top status ribbon displayed when an incident is focused.
2. **`command-center.css`**:
   - Custom cyber-dense spatial styling matching existing visual design system (`Chakra Petch`, glassmorphism, glowing borders, non-rectangular layout).
   - Fully interactive controls with `pointer-events: auto` while passing universe dragging gestures through (`pointer-events: none` on backdrop).
   - Performance tier adaptations for `FULL`, `REDUCED`, and `LOW`.

---

## 7. SecurityService Integration

No component bypasses `SecurityService`. All state updates occur reactively via event subscriptions:
- `INCIDENTS_UPDATED`
- `INCIDENT_DETAIL_UPDATED`
- `RESPONSE_ACTION_UPDATED`
- `AUDIT_APPENDED`
- `SESSION_CHANGED`

---

## 8. Offline Behavior & Persistence

- Zero external HTTP fetch calls, zero cloud APIs, zero Firebase dependencies.
- Bootstraps directly from IndexedDB (`es-spatial-db`) via `LocalProvider`.
- All metrics persist across browser reloads.
- Offline incident generator creates real IndexedDB records and emits events, immediately updating the Command Center metrics.

---

## 9. Performance & Rendering Guardrails

- **Single MediaPipe Instance**: Preserved.
- **Single RAF Loop**: Preserved. Command Center uses declarative React state and CSS hardware-accelerated animations.
- **Performance Tiers**:
  - `FULL`: Full glassmorphism blur (12px), glowing border shadows, keyframe animations.
  - `REDUCED`: Reduced blur (4px), simplified shadows.
  - `LOW`: Flat high-contrast backgrounds, zero blur, maximum performance.

---

## 10. Verification Results

| Test / Check | Result | Details |
| :--- | :--- | :--- |
| **TypeScript Compilation** | **PASSED (0 errors)** | `npx tsc --noEmit` clean |
| **Production Build** | **PASSED (1.01s)** | `npm run build:vercel` clean |
| **Offline Initialization** | **PASSED** | Bootstraps 100% offline from IndexedDB |
| **Threat Level Calculation** | **PASSED** | Deterministic score (100 / CRITICAL for BlackTide scenario with factors verified) |
| **Incident Command Discovery** | **PASSED** | Displays active incidents, filter tabs operational |
| **Investigation Transition** | **PASSED** | Clicking incident transitions directly into `InvestigationHub` |
| **Return to Command Center** | **PASSED** | Pressing `ESC` or clicking `EXIT FOCUS` restores Command Center overview |
| **HUD Toggle (Minimize/Expand)** | **PASSED** | Flanks collapse for unobstructed universe viewing |
| **Browser Recording** | **VERIFIED** | Saved to artifact `command_center_flow_1790005013384.webp` |

---

## 11. Known Limitations (Step 1 Scope)

1. **Static Ingestion Model**: Live activity currently reflects seed timeline events and user-initiated response/audit actions, rather than a real-time event streaming pipe.
2. **Alert Correlation**: Open alerts are derived from `Incident.correlationChain` items. A standalone detection engine will be introduced in subsequent steps.

---

## 12. Deferred Functionality (Explicitly Out of Scope for Step 1)

The following systems are deferred to later steps per the master blueprint:
- Real-time event ingestion engine (Step 2)
- Detection rule engine & Sigma rules
- Correlation engine & graph analytics
- Threat hunting engine & queries
- Case management & evidence chain of custody
- Advanced threat intelligence feeds
- Automated SOAR playbook execution engines

---

## 13. Recommended Starting Point for Step 2

With the SOC Command Center operational foundation established in Step 1, the exact starting point for **Step 2** is:
- **Build the Security Event Engine**: A deterministic local event ingestion pipeline that streams simulated and captured security events into `SecurityService`, populating the live activity stream and driving dynamic alert generation.

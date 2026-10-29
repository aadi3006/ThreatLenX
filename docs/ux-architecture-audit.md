# EXPLAIN-SEC UX and Architecture Audit

**Audit date:** 2026-10-20  
**Scope:** Step 1 audit only. No application behavior or source code was changed.  
**Goal:** Identify the causes of duplicate UI, unpredictable navigation, spatial overflow, input mismatch, and state loss before implementing the refinement roadmap.

## Audit coverage and limits

This audit covered the full project inventory and traced the reachable application path through the page shell, spatial shell, all current SOC workspaces, investigation panels, gesture engine/controller, canonical service/provider boundary, IndexedDB wrapper, authentication/RBAC, response workflows, tests, CSS, prior audit documents, product specification, and saved screenshots. The application contains approximately 41,756 lines across 73 core and spatial source/style files.

The audit also executed all nine domain test scripts, TypeScript, lint, and the current production build. A headless live-render attempt was made, but the machine's Chrome/WebGL display path did not produce a screenshot. Camera-based real-hand testing and a complete manual click-through therefore remain explicit pre-implementation validation items; static inspection or unit tests cannot substitute for them.

## Executive summary

The security domain is already broad and mostly centralized behind `SecurityService`, but the presentation layer has no single navigation authority. Four systems currently overlap:

1. `app/page.tsx` owns the global vehicle/SOC view, the permanent top header, theme, audio, and a separate vehicle gesture path.
2. `app/soc-spatial.tsx` owns a second workspace navigation bar and switches workspaces directly through `spatialTransform`.
3. Individual workspaces own their own headers, selectors, close destinations, and local detail state.
4. `spatial-controller.ts` maps keyboard and gesture intents directly to low-level spatial modes.

This explains the reported duplicate headers, repeated destinations, lost investigation context, and inconsistent gesture behavior. The next step should introduce one semantic navigation state and route every input through actions on that state. The existing `SecurityService`, provider, storage, gesture recognition, and workspace implementations can remain in place.

## Current architecture

```text
Home page shell
├── Vehicle workspace and vehicle-only hand controller
├── Permanent cyber header and vehicle/SOC switch
└── SOC spatial wrapper
    ├── Floating mode/workspace bar
    ├── Spatial transform manager (global singleton)
    ├── Gesture/keyboard controller (global singleton)
    ├── Command Center and Incident Universe rendered together
    ├── Focused investigation overlay
    └── Hunting / Cases / Evidence / Detection workspaces

SecurityService
└── LocalProvider → IndexedDB and canonical security entities
```

The data boundary is suitable for refinement. The navigation boundary is not: visual modes, workspaces, selected incidents, focused panels, and transforms are encoded in the same state object or in unrelated component state.

## Findings

### P0 — Navigation has no canonical semantic state

`SpatialMode` combines visual layout (`COMMAND`, `SPATIAL`, `FOCUS`, `CALIBRATION`) with product workspaces (`HUNTING`, `CASES`, `EVIDENCE`, `DETECTION`). Its only selection field is `focusedPanelId`. There is no explicit workspace, navigation level, selected item, active investigation panel, return destination, or dock visibility state.

**Evidence**

- `app/spatial-transform.ts:3-15` defines the mixed mode model.
- `app/soc-spatial.tsx:171-245` renders entire workspaces by branching on that mode.
- Workspace callbacks set modes directly and do not record their origin.

**Impact**

- Back and close actions cannot return to the previous semantic location.
- A panel ID is overloaded as an incident selection and as generic focus state.
- Adding navigation controls creates more competing state rather than fixing the existing flow.
- Navigation state cannot be reliably preserved across workspace pivots.

**Required correction**

Create one navigation model with, at minimum: `workspace`, `level`, `selectedItem`, `activePanel`, `returnTarget`, `dockVisible`, and `chromeVisible`. Keep spatial transforms in a separate view state.

### P0 — Fist and keyboard behavior contradict the intended Spatial Hub contract

The gesture controller maps `MODE_COLLAPSE_COMMAND` directly to `COMMAND`. The `F` key also exits focus or sends the application to `COMMAND`. The product requirement is for fist to return to Spatial Hub while preserving investigation context.

**Evidence**

- `app/spatial-controller.ts:73-101` handles gesture mode collapse.
- `app/spatial-controller.ts:479-491` handles the `F` key with the same command-center destination.
- `docs/HAND_INTERACTION_ARCHITECTURE.md` documents the older collapse-to-command contract, so the implementation and documentation reinforce the obsolete behavior.

**Impact**

- Real gesture, keyboard, and desired navigation semantics disagree.
- A user cannot reliably predict whether fist means back, close, or command overview.

**Required correction**

Map fist, keyboard, mouse, and simulator events to one semantic `navigateHome()` or `navigateBack()` action. Gesture recognition should emit intent only; it should not choose product destinations.

### P0 — Command Center and Incident Universe are mounted together

`IncidentUniverse` always renders `CommandCenter` and the incident field in the same component tree. CSS decides how these layers appear for each mode.

**Evidence**

- `app/spatial/incident-universe/IncidentUniverse.tsx:119-188` mounts both layers unconditionally.

**Impact**

- The interface can show or retain multiple primary surfaces simultaneously.
- Hidden layers still own state, registered panels, effects, and layout.
- The architecture prevents a clean `Hub → workspace → list → selected item` progression.

**Required correction**

Render one primary surface from canonical navigation state. The Hub, Command Center, incident list/universe, and focused investigation should be siblings selected by a router/store rather than permanent stacked layers.

### P0 — Context is dropped or targets are ignored during cross-workspace navigation

Several callbacks accept IDs but never use them. All workspace close buttons route to Command Center regardless of origin. Investigation buttons mutate the global mode without a return target.

**Evidence**

- `app/soc-spatial.tsx:174-233` hard-codes every close destination to `COMMAND`.
- `onNavigateToCase={(caseId) => ...}` and `onOpenThreatHunt={(huntId) => ...}` ignore `caseId` and `huntId`.
- `app/spatial/investigation/InvestigationHub.tsx:176-207` jumps directly to Cases or Evidence and does not preserve an investigation return path.
- Evidence collection uses the fixed case ID `case-blacktide-001` rather than the current investigation/case context.
- Evidence source navigation falls back to `inc-blacktide-001`, which does not match the canonical seeded ID format `incident-001`.
- Threat Hunting opens `incident-001` when a result has no linked incident, even though the UI states that no incident relationship exists.

**Impact**

- Entity pivots can open the right workspace with the wrong item selected.
- Back navigation destroys the analyst's place.
- Evidence may be associated with an unrelated fixed case.
- Unrelated hunt events and evidence can appear to belong to the seeded BlackTide incident.

**Required correction**

Carry typed navigation payloads and restore the previous context on back. Remove fixed IDs from contextual actions and resolve the active case through canonical state and authorization rules.

### P0 — Some UI actions invent relationships instead of requiring a canonical link

The Threat Hunting “Investigate” action substitutes the flagship incident when the selected event has no related incident. Evidence navigation similarly substitutes a BlackTide incident for non-incident source types. These fallbacks conflict with the product rule that navigation and animation must reflect canonical security relationships.

**Evidence**

- `app/spatial/hunting/ThreatHuntingWorkspace.tsx:585-598` declares that the event has no relationship, then navigates to `incident-001`.
- `app/spatial/evidence/EvidenceWorkspace.tsx:852-865` routes event and alert evidence to hard-coded `inc-blacktide-001`.

**Required correction**

Disable investigation navigation until a relationship exists, offer the existing controlled link/create workflow, or resolve the true incident through `SecurityService`. Never substitute a demonstration incident silently.

### P1 — The application has two visible shell headers plus workspace headers

The home page always renders `cyber-top-header`. The SOC wrapper renders `spatial-floating-bar`, and each workspace adds its own top bar. The SOC navigation is at the top even though the intended shell places workspace navigation at the bottom.

**Evidence**

- `app/page.tsx:350-423` renders the global top header.
- `app/soc-spatial.tsx:69-167` renders the second top navigation bar.
- Cases, Evidence, Investigation, Hunting, and Detection each render another local header.
- `app/globals.css:238` and `app/globals.css:485-500` position the global and spatial headers independently.

**Impact**

- Vertical space is consumed before the actual workspace begins.
- Controls with similar labels and different state ownership compete for attention.
- Responsive layouts are more likely to clip or overlap.

**Required correction**

Keep one compact operational header, one primary content region, and one bottom workspace dock. Local workspace headers should contain only item context and panel actions.

### P1 — A stray JSX text token is rendered beside the SOC

The SOC branch contains an extra `/>` after `SocSpatialWrapper`. It is valid as a JSX text node, so the production build succeeds and the token can appear as a clipped or misplaced element in the interface.

**Evidence**

- `app/page.tsx:713-719` closes `SocSpatialWrapper`, then contains a second standalone `/>` before `GestureHud`.

**Impact**

- This is a direct source candidate for the reported stray top-left spatial artifact.

**Required correction**

Remove the standalone text token during the shell cleanup and include a visual regression check at common viewport sizes.

### P1 — There is no navigation dock visibility state

The current state model has no `dockVisible` field and `soc-spatial.tsx` contains no hide-navigation control. A future button cannot reclaim layout space without adding yet another isolated state path.

**Impact**

- The reported “Hide Navigation” failure cannot be fixed coherently in the existing model.
- Hiding a visual element alone would leave reserved offsets and overlapping controls.

**Required correction**

Make dock visibility part of the canonical shell state. The content grid must derive its bottom inset from this value, so hiding the dock removes both the dock and its reserved space. Keep global chrome visibility separate.

### P1 — Real hand control is split across two pipelines

`page.tsx` creates `HandControl` for vehicle mode, while the SOC uses `GestureHud`/`GestureEngine` connected to `spatialController`. Camera ownership and gesture semantics therefore change with the view.

**Evidence**

- `app/page.tsx:105-190` owns the vehicle `HandControl` lifecycle.
- `app/page.tsx:713-719` mounts a separate `GestureHud` in SOC mode.
- `app/spatial-controller.ts` subscribes to `GestureEngine` intents.

**Impact**

- Camera lifecycle, hand labels, thresholds, and actions can diverge.
- Input parity cannot be verified through a single logical action layer.
- Switching modes can stop and restart different trackers.

**Required correction**

Keep one authoritative MediaPipe/gesture engine. Add view-specific adapters after recognition, then dispatch semantic application actions through the same command layer used by mouse, keyboard, and the simulator.

### P1 — The Attack Graph is bounded by a fixed logical canvas, not the available panel

The graph normalizes coordinates into a fixed `760 × 560` SVG with `80` units of padding. It does not measure the rendered container or reserve bounds for actual node shapes and labels. The SVG is `width: 100%` but has no explicit responsive height or aspect-ratio policy.

**Evidence**

- `app/spatial/investigation/attack-graph/AttackGraph.tsx:61-87` uses fixed dimensions and coordinate normalization.
- Node labels extend 14–25 units below the node after normalization.
- `app/spatial/investigation/investigation.css:319-352` gives the SVG width only.

**Impact**

- Nodes may technically fall inside the viewBox while labels and glows clip.
- The graph scales poorly in short, narrow, or dock-constrained panels.
- Layout does not respond to the real canvas dimensions.

**Required correction**

Measure the graph container, compute inner bounds from node radius plus label footprint, preserve a minimum readable scale, and recalculate on resize. Clip or wrap labels deliberately. Keep animation cleanup tied to panel lifecycle and reduced-motion mode.

### P1 — Graph construction animation is incomplete and relationship semantics are inconsistent

Only critical Attack Graph edges receive the draw animation. Noncritical edges appear immediately. The Incident Universe draws every incident to the first incident with a comment that these are faint static links, rather than using canonical relationships.

**Evidence**

- `AttackGraph.tsx` applies `ag-edge-draw` only when `isCritical` is true.
- `IncidentUniverse.tsx:167-186` generates synthetic first-incident links.
- `RelationshipGraph.tsx` uses static dashed lines without a lifecycle-aware construction sequence.

**Impact**

- Relationship animation does not consistently represent graph construction.
- The universe can imply relationships that do not exist in canonical security data.

**Required correction**

Build edges solely from canonical relations. Animate all newly constructed relationships in a deterministic order, with distinct styling for critical paths and selected neighborhoods.

### P1 — The investigation flow is incomplete relative to the target workflow

The investigation has Attack, Timeline, MITRE, Systems, IOCs, Replay, and Response. It lacks dedicated Evidence, Findings, and Notes panels, although these features exist elsewhere in the product.

**Evidence**

- `app/spatial/investigation/InvestigationHub.tsx:44-54` defines the complete local view list.

**Impact**

- Analysts must leave the investigation to document evidence or findings.
- Contextual work becomes a workspace jump that currently loses the return location.

**Required correction**

After canonical navigation is in place, expose Evidence, Findings, and Notes as incident-scoped panels or contextual drawers backed by the same selected incident and case.

### P1 — Verification gates are not clean

The production build succeeds, but TypeScript and lint do not.

**Verification results on 2026-10-20**

| Gate | Result | Key evidence |
|---|---|---|
| `npm run build` | Pass with warnings | Browser externalization warning for `node:crypto`; oversized chunks over 500 kB |
| `npx tsc --noEmit` | Fail | Three errors in `scripts/test-step9-detection-engineering.ts` |
| `npm run lint` | Fail | Broad unused code, accessibility, hooks, promise handling, purity, and type-safety findings |

All nine domain scripts were also run directly and passed:

- Security events: 12 checks passed.
- Detection and alerts: 14 checks passed.
- Correlation and incident creation: 42 checks passed.
- Threat hunting: all 10 suites passed.
- Case management: all 10 suites passed.
- Evidence management: all 11 suites passed.
- Threat intelligence: 34 checks passed.
- Detection engineering: 65 checks passed.

These suites validate the domain engines and provider workflows, but they do not cover shell navigation, responsive layout, graph bounds, input parity, or preservation of UI context.

The project status documents are stale: `task.md` records TypeScript and build gates as clean at earlier milestones, while the current checkout fails TypeScript and lint. Future status reports must be regenerated from the current commit rather than treated as live evidence.

The successful build does not prove type safety because the current build pipeline does not block on the standalone TypeScript failures.

### P1 — The initial page produces a React hydration mismatch

A live development request returned HTTP 200 but logged a hydration mismatch on the root `<html>` element: the client added `data-perf-mode="FULL"` before hydration while the server output did not contain it.

**Evidence**

- `app/spatial/performance-mode.ts:19-28` mutates the document from the singleton constructor during client module initialization.
- `app/spatial/performance-mode.ts:48-51` writes the attribute directly to `document.documentElement`.

**Impact**

- Server and client markup disagree at startup.
- React explicitly reports that the mismatch will not be patched, which can mask other hydration defects and cause inconsistent initial styling.

**Required correction**

Apply persisted performance mode after hydration in one shell-owned effect, or render the initial attribute consistently from the server. Avoid DOM mutation in a module singleton constructor.

### P2 — Dead and legacy surfaces increase ambiguity

The project still includes older dashboard components and unused state/imports. `CyberDashboard` and `SocDashboard` coexist with the newer spatial command center. The main page retains globe and region state even though the SOC path no longer renders `GlobeScene`.

**Impact**

- Developers can modify the wrong dashboard.
- Search results and CSS selectors make ownership harder to understand.
- Lint output is noisy enough to hide higher-risk regressions.

**Required correction**

After the canonical shell is working, identify the reachable component graph and archive or remove unreachable surfaces in a separate, reviewable cleanup.

### P2 — Accessibility and keyboard behavior are uneven

The lint audit reports nonsemantic interactive elements, invalid ARIA combinations, missing keyboard handlers, and unlabeled form controls. Global keyboard shortcuts are attached at the window level and only exclude input, textarea, and contenteditable targets.

**Impact**

- Keyboard parity is incomplete despite advertised shortcuts.
- Selects, dialogs, custom graph nodes, and interactive cards can behave inconsistently for keyboard and assistive technology users.

**Required correction**

Use semantic controls, scope shortcuts to the active workspace, document conflicts, and test full navigation without a pointer.

## Target navigation contract for Step 2

```text
SPATIAL_HUB
  → WORKSPACE(workspaceId)
    → LIST(workspaceId, filters, selectedItemId?)
      → DETAIL(workspaceId, selectedItemId)
        → PANEL(workspaceId, selectedItemId, panelId)
```

Suggested state shape:

```ts
interface NavigationState {
  workspace: WorkspaceId | 'SPATIAL_HUB';
  level: 'HUB' | 'LIST' | 'DETAIL' | 'PANEL';
  selectedItem: { type: EntityType; id: string } | null;
  activePanel: string | null;
  history: NavigationSnapshot[];
  dockVisible: boolean;
  chromeVisible: boolean;
}
```

Spatial presentation state should remain separate:

```ts
interface SpatialViewState {
  layout: 'FLAT' | 'SPATIAL';
  scale: number;
  rotation: number;
  panX: number;
  panY: number;
  pointedTarget: string | null;
}
```

All input paths should call the same semantic actions:

| Intent | Mouse | Keyboard | Real gesture | Simulator |
|---|---|---|---|---|
| Open workspace | Dock click | Scoped shortcut | Point/pinch | Same action |
| Select item | Click | Arrow/Enter | Point/dwell | Same action |
| Change panel | Tab click | Left/right or shortcut | Point/pinch | Same action |
| Back | Back button | Escape | Fist | Same action |
| Hub | Hub button | Assigned shortcut | Fist at workspace root | Same action |

## Recommended implementation sequence

1. Add a typed navigation store and action API without changing workspace internals.
2. Adapt `spatialTransform` to manage spatial presentation only.
3. Route shell buttons, workspace callbacks, keyboard shortcuts, and gesture intents through navigation actions.
4. Introduce the single top operational header and bottom workspace dock.
5. Render one primary route at a time and preserve list/item/panel state in history.
6. Add explicit dock and global chrome visibility behavior.
7. Update gesture documentation and simulator mappings to the new semantic contract.
8. Only then proceed to investigation and Attack Graph refinements.

## Acceptance checks for Step 2

- A single state snapshot completely describes the visible workspace, selected item, and active panel.
- Every cross-workspace callback consumes its target ID.
- Back restores the previous item and panel.
- Fist, Escape, mouse back, and simulator back invoke the same action.
- Hub navigation preserves the active investigation for later return.
- Hiding the bottom dock removes its reserved space.
- Spatial pan/zoom state cannot change the active product workspace.
- Existing `SecurityService`, IndexedDB persistence, RBAC, approvals, and audit APIs remain untouched.

## Audit conclusion

The immediate problem is navigation ownership, not missing SOC functionality. Implementing Step 2 as a small semantic navigation layer will remove the main source of duplication and give later UI, investigation, graph, gesture, and performance work a stable foundation.

# EXPLAIN-SEC Refinement Roadmap

**Current status:** Step 1 complete — UX and architecture audit  
**Execution rule:** Complete and verify each step before starting the next. Preserve `SecurityService`, `LocalProvider`, IndexedDB data, RBAC, approvals, audit records, and the canonical gesture-recognition pipeline.

## Step 2 — Canonical navigation state

**Goal:** Establish one authoritative navigation model for the whole application.

### Deliverables

- Create typed state for:
  - current workspace
  - navigation level: Hub, List, Detail, Panel
  - selected entity and ID
  - active investigation panel
  - navigation history and return target
  - bottom dock visibility
  - global chrome visibility
- Separate semantic navigation from pan, zoom, rotation, cursor, and spatial layout state.
- Add semantic actions such as:
  - `openHub()`
  - `openWorkspace()`
  - `selectItem()`
  - `openPanel()`
  - `navigateBack()`
  - `setDockVisible()`
  - `setChromeVisible()`
- Route mouse, keyboard, real gestures, and the simulator through these actions.
- Consume all IDs supplied by cross-workspace callbacks.
- Remove hard-coded fallback navigation to BlackTide entities.
- Preserve the previous workspace, selected item, and panel when navigating back.

### Must not include

- Major visual redesign.
- Attack Graph layout changes.
- Security service or database rewrites.

### Completion gate

- A single navigation snapshot fully explains the visible screen.
- Fist, Escape, mouse back, and simulator back invoke the same logical action.
- Fist reaches Spatial Hub at a workspace root without deleting investigation context.
- Cross-workspace links select the requested incident, case, hunt, evidence, or IOC.
- TypeScript, production build, domain tests, and navigation tests pass.

## Step 3 — Unified shell and progressive disclosure

**Goal:** Replace overlapping headers and stacked surfaces with one coherent shell.

### Deliverables

- Keep one compact operational header.
- Create one bottom workspace navigation dock.
- Make “Hide Navigation” remove the dock and reclaim its reserved space.
- Keep “Hide UI” as a separate global chrome control.
- Render one primary workspace at a time.
- Remove the stray `/>` text token from the SOC render branch.
- Stop mounting Command Center and Incident Universe as simultaneous primary layers.
- Remove duplicate workspace controls from local headers.
- Fix the initial `data-perf-mode` hydration mismatch.
- Define responsive layouts for desktop, tablet, and narrow screens.

### Completion gate

- No duplicate header, ribbon, dock, or workspace surface is visible.
- No overlap or clipped element at supported viewport sizes.
- Hiding navigation increases usable canvas height.
- Refreshing does not produce a React hydration warning.
- Current workspace and selected item survive shell visibility changes.

## Step 4 — Focused incident investigation

**Goal:** Provide one coherent investigation journey for a selected incident.

### Deliverables

- Implement the flow:
  - Spatial Hub
  - Investigation workspace
  - Incident list
  - Selected incident
  - Focused investigation panel
- Keep one shared incident context across:
  - Timeline
  - Attack Graph
  - IOC
  - MITRE
  - Systems/assets
  - Evidence
  - Findings
  - Notes
  - Replay
  - Response
- Preserve panel, selection, filters, and scroll position when moving back.
- Replace the fixed `case-blacktide-001` evidence target with the active linked case or a controlled case-selection flow.
- Use canonical IDs for every incident/case/evidence pivot.

### Completion gate

- Selecting any incident opens that incident everywhere.
- Timeline, graph, IOC, MITRE, evidence, and response selections remain synchronized.
- Evidence and findings are linked to the correct incident and case.
- Back returns to the previous incident list state.
- RBAC and audit behavior remain unchanged.

## Step 5 — Attack Graph repair

**Goal:** Make the graph bounded, responsive, accurate, and readable.

### Deliverables

- Measure the available graph container.
- Calculate node positions inside bounds using node size, label footprint, and safe padding.
- Recalculate layout on resize and dock visibility changes.
- Use canonical graph nodes and edges only.
- Animate construction of all relationships in deterministic order.
- Style critical paths without limiting animation to critical edges.
- Highlight the selected node, adjacent nodes, and connected edges.
- Dim unrelated graph content without making it unreadable.
- Clean up timers and animations on panel exit.
- Respect reduced-motion and performance modes.

### Completion gate

- No node, label, glow, or selection strip leaves the usable canvas.
- Validate at desktop, tablet, narrow, dock-visible, and dock-hidden sizes.
- Selection accurately highlights only canonical neighbors.
- Re-entering the graph does not duplicate animations or listeners.

## Step 6 — Incident universe and entity visualization

**Goal:** Reveal incident relationships progressively instead of displaying every layer at once.

### Deliverables

- Replace synthetic links to the first incident with canonical relationships.
- Create clear list and spatial-view alternatives using the same incident data.
- Reveal assets, users, alerts, IOCs, events, evidence, and MITRE relationships on selection.
- Keep labels and interaction targets inside the usable viewport.
- Make entity selection accessible to mouse, keyboard, gestures, and simulator.
- Provide explicit empty, loading, denied, and error states.

### Completion gate

- Every displayed relationship is traceable to canonical data.
- Selecting an entity opens the correct focused context.
- Large incident sets remain navigable and performant.
- No unrelated demonstration incident is substituted.

## Step 7 — Command Center refinement

**Goal:** Create a compact operational overview grounded in real security state.

### Deliverables

- Prioritize current incidents, alerts, assets, response activity, and engine health.
- Remove repeated metrics and decorative panels that do not support an action.
- Make each metric and queue open a filtered focused view.
- Keep simulations clearly labeled and separate from real telemetry.
- Eliminate random visual or data behavior from production operational views.
- Ensure success, failure, pending, and denied states reflect actual results.

### Completion gate

- Every displayed metric has a documented canonical source.
- Every interactive metric opens the expected filtered destination.
- No fake telemetry or premature success animation appears.
- Command Center remains readable without scrolling at the primary desktop target.

## Step 8 — Threat Hunting and Threat Intelligence

**Goal:** Connect queries, results, entities, intelligence, alerts, and incidents without false pivots.

### Deliverables

- Preserve query, filters, results, and selected event across pivots.
- Disable “Investigate” when an event has no related incident, or offer controlled link/create actions.
- Navigate to the exact linked incident, alert, asset, IOC, or hunt.
- Integrate Threat Intelligence as an entity-focused panel rather than an unrelated overlay.
- Show relationship provenance and confidence.
- Preserve offline enrichment and audit behavior.

### Completion gate

- An unlinked event never opens `incident-001` automatically.
- Every pivot lands on the correct canonical object.
- Returning to Hunting restores the previous query and selected result.
- Threat Intelligence relationships match service data.

## Step 9 — Evidence, RBAC, and SOAR UX

**Goal:** Make provenance, permission, approval, and execution status unambiguous.

### Deliverables

- Show evidence source, collector, timestamps, hash, integrity state, custody, case, and annotations clearly.
- Resolve evidence source navigation through real relationships.
- Show why an action is permitted, denied, or requires approval.
- Maintain explicit SOAR states:
  - Draft
  - Requested
  - Pending approval
  - Approved
  - Executing
  - Successful
  - Failed
  - Rejected/denied
- Trigger visual success only after the service confirms success.
- Keep destructive actions behind confirmation and existing RBAC checks.

### Completion gate

- Evidence never opens an unrelated fallback incident.
- Integrity and custody data match stored records.
- Unauthorized actions cannot execute through any input method.
- Approval, execution, failure, and audit records remain synchronized.

## Step 10 — Metrics and AI refinement

**Goal:** Make calculated metrics transparent and AI assistance contextual.

### Deliverables

- Document the source and calculation for each displayed metric.
- Remove or label illustrative values.
- Surface deterministic local AI provenance.
- Keep AI output scoped to the selected incident, entity, or case.
- Require existing RBAC, policy, approval, and audit controls for any mutation suggested by AI.
- Distinguish facts, derived conclusions, and recommendations.

### Completion gate

- Metrics reproduce from canonical data.
- AI output never silently changes security state.
- AI recommendations identify their source context and provider.
- Offline behavior remains fully functional.

## Step 11 — Animation, accessibility, and performance hardening

**Goal:** Make motion purposeful and ensure the interface remains reliable across devices and input types.

### Deliverables

- Inventory every interval, timeout, RAF loop, subscription, and event listener.
- Guarantee cleanup on unmount and workspace changes.
- Remove duplicate animation and audio triggers.
- Respect reduced-motion settings and performance modes.
- Fix current lint findings affecting accessibility, hooks, promises, purity, and unsafe types.
- Use semantic buttons, dialogs, lists, tabs, and form labels.
- Scope keyboard shortcuts to the active workspace.
- Split oversized production chunks where useful.
- Resolve the browser `node:crypto` externalization risk for evidence hashing.

### Completion gate

- TypeScript, lint, production build, and all domain tests pass.
- No hydration warnings, leaked loops, or duplicate listeners appear.
- Full keyboard navigation works without a pointer.
- Reduced-motion and LOW performance modes remain usable.

## Step 12 — Spatial adapter and 360° preparation

**Goal:** Prepare the stable SOC for spatial and immersive presentation without creating a second security architecture.

### Deliverables

- Define semantic spatial objects for workspaces, incidents, entities, relationships, evidence, and response actions.
- Map semantic objects into world coordinates and depth through an adapter.
- Keep `SecurityService` and canonical navigation as the source of truth.
- Preserve the same selection and action commands across flat, spatial, and future immersive views.
- Add lifecycle rules for entering, leaving, suspending, and restoring spatial scenes.
- Document device capability fallbacks.

### Completion gate

- Flat and spatial presentations show the same selected data and workflow state.
- Switching presentation does not duplicate or reset security state.
- No security operation exists only inside the spatial renderer.
- Performance remains within the agreed target on supported hardware.

## Required verification after every step

1. Inspect the exact changed files and confirm the change follows the current architecture.
2. Run `npx tsc --noEmit`.
3. Run `npm run lint`.
4. Run `npm run build`.
5. Run all affected domain test scripts.
6. Test mouse and keyboard flows.
7. Test real hand gestures and the gesture simulator when navigation or interaction changes.
8. Verify persistence after reload.
9. Verify RBAC, approvals, audit records, and failure states.
10. Check desktop, tablet, and narrow viewport layouts.

## Final acceptance

- One coherent shell and one primary workspace at a time.
- Spatial Hub exposes every existing workspace.
- Navigation preserves selected items and panel context.
- Bottom dock visibility works and reclaims space.
- Fist returns to Spatial Hub at the correct navigation level.
- Correct left/right hand identification and working two-hand interaction.
- Mouse, keyboard, real gestures, and simulator share semantic actions.
- Attack Graph remains bounded and uses canonical relationships.
- Security workflows, persistence, RBAC, approvals, and audit remain correct.
- No invented relationships, fake telemetry, or misleading success states.
- TypeScript, lint, production build, domain tests, and manual validation pass.

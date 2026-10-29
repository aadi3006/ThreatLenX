# EXPLAIN-SEC SPATIAL — Product Specification

**Document:** `spatial_product_spec.md`  
**Status:** Master product/architecture specification  
**Target:** Offline-first Spatial SOC / AR/VR experience  
**Integration target:** EXPLAIN-SEC  
**Primary interaction:** Hands-free hand-tracking interaction  
**Design principle:** Spatial investigation, not dashboard replication

---

# 1. Product Definition

## 1.1 Product Name

**EXPLAIN-SEC SPATIAL**

Working description:

> An offline-first spatial cybersecurity operations environment that transforms EXPLAIN-SEC security entities, relationships, investigations, and response workflows into an interactive AR/VR-style SOC experience.

The product is **not** a 3D copy of the existing EXPLAIN-SEC dashboards.

The existing EXPLAIN-SEC application remains the source of truth for security functionality and domain concepts. The Spatial application becomes a new presentation and interaction layer optimized for:

- spatial understanding
- investigation
- correlation
- attack-path visualization
- situational awareness
- hands-free interaction
- contextual decision-making
- incident response

---

# 2. Core Product Principles

## P1 — Spatial-native, not dashboard-in-3D

Do not take existing cards, tables, sidebars, and dashboards and simply turn them into floating panels.

Instead, convert information into spatial objects where spatial representation provides additional value.

Examples:

- Incident card → Incident Anchor / Incident Universe
- Correlation table → Correlation Graph
- Timeline table → Spatial Timeline
- Asset table → System Radar
- IOC table → IOC Constellation
- MITRE matrix → Interactive ATT&CK Matrix
- Attack campaign → Campaign Graph
- Detail drawer → Spatial Inspector

## P2 — Investigation is the primary experience

The application should optimize for:

> "What happened, how did it happen, what is affected, and what should I do?"

rather than:

> "How many dashboard metrics can I display?"

## P3 — Relationships are first-class

Incidents, alerts, events, assets, users, IOCs, MITRE techniques, evidence, campaigns, and response actions should be connected through an underlying relationship model.

## P4 — Offline means fully functional

The application must operate without Internet access.

Offline operation does NOT mean stateless.

The application must persist data locally, including:

- users
- authentication/session information
- incidents
- events
- telemetry
- assets
- IOCs
- investigation state
- evidence metadata
- notes
- response actions
- playbooks
- audit logs
- configuration

## P5 — Integration must be replaceable

The Spatial application must not hard-code itself to Firebase or EXPLAIN-SEC.

The application consumes a security data/service interface.

Initial provider:

`LocalProvider`

Future providers:

`FirebaseProvider`

`ExplainSecProvider`

Potential future providers may be added without rewriting spatial components.

## P6 — Reliability before spectacle

The system must prioritize:

1. correctness
2. interaction reliability
3. latency
4. smoothness
5. information hierarchy
6. visual polish
7. cinematic effects

Never sacrifice tracking or security workflow reliability for visual effects.

---

# 3. Product Modes

The application should behave as one persistent spatial environment rather than a collection of independent pages.

## 3.1 Command Space

Default state.

Purpose:

- situational awareness
- active incidents
- threat activity
- asset health
- current risk
- live events
- SOC status

The Command Space should remain relatively compact.

It is the launch point for investigation.

## 3.2 Incident Space

Created when an incident is selected.

Purpose:

- understand incident
- reconstruct attack
- inspect affected entities
- inspect evidence
- inspect MITRE mapping
- inspect timeline
- assess risk
- initiate response

## 3.3 Threat Hunt Space

Created when the analyst starts a threat hunt.

Purpose:

- query telemetry
- explore IOCs
- pivot between entities
- discover relationships
- reconstruct possible attack paths

## 3.4 Asset Investigation Space

Created when an asset is selected.

Purpose:

- asset identity
- criticality
- current status
- related users
- processes/events
- network relationships
- incidents
- risk
- blast radius

## 3.5 IOC Investigation Space

Created when an IOC is selected.

Purpose:

- IOC details
- associated events
- assets
- users
- incidents
- related IOCs
- MITRE relationships

## 3.6 Technique Investigation Space

Created when a MITRE ATT&CK technique is selected.

Purpose:

- tactic
- technique/sub-technique
- related events
- incidents
- assets
- users
- attack paths
- evidence

## 3.7 Response Space

Created when a response action or playbook is selected.

Purpose:

- preview impact
- authorization/approval
- execute action
- observe outcome
- record audit trail

---

# 4. Spatial Command Center

The Command Space is not a traditional dashboard.

It should provide a compact threat field with interactive objects.

## Primary information

- Critical incidents
- High-severity incidents
- Active attacks/campaigns
- Current risk
- Affected assets
- High-value IOCs
- Live event activity
- SOC/engine health

## Interaction

Pointing at an object should expose a target state.

Point + dwell should focus the object.

Open palm should expand contextual information.

The command space should not display every available metric simultaneously.

Use progressive disclosure.

---

# 5. Incident Universe

The Incident Universe is the flagship investigation experience.

When an analyst selects an incident:

1. Incident becomes the spatial anchor.
2. Existing workspace content becomes visually subordinate.
3. Relevant relationships are discovered.
4. Related spatial objects appear around the incident.
5. The system generates a concise structured summary.
6. Attack path, MITRE, timeline, asset, IOC, evidence, and response views become available.

## Core structure

```text
                         MITRE ATT&CK
                              |
                              |
       IOC -------------- INCIDENT -------------- USER
                              |
                  +-----------+-----------+
                  |           |           |
                ASSETS      EVENTS     EVIDENCE
                              |
                           TIMELINE
                              |
                           RESPONSE
```

This is a conceptual structure, not a mandatory fixed layout.

The actual spatial arrangement should adapt to the incident's relationships.

---

# 6. Incident Summary

The initial incident expansion should show:

- Incident ID
- Severity
- Title/type
- Risk score
- Confidence
- Status
- Creation time
- affected assets
- affected users
- IOC count
- MITRE technique count
- current lifecycle stage

## Generated narrative

The offline MVP should support deterministic incident summaries generated from structured data.

Example structure:

> A suspicious authentication event was correlated with execution activity on an affected endpoint, followed by lateral movement toward a high-value asset.

The summary must be traceable to underlying incident data.

A local LLM can be added later as an optional provider.

---

# 7. Attack Graph Engine

The Attack Graph is a reusable spatial graph system.

## Node types

- Incident
- Alert
- Telemetry Event
- Asset
- User
- IOC
- IP
- Domain
- Hash
- Process
- MITRE Tactic
- MITRE Technique
- Threat Actor
- Campaign
- Evidence
- Response Action

## Relationship types

Examples:

- `GENERATED_BY`
- `AFFECTS`
- `EXECUTED_ON`
- `ASSOCIATED_WITH`
- `COMMUNICATED_WITH`
- `CORRELATED_WITH`
- `ATTRIBUTED_TO`
- `USES`
- `TARGETS`
- `PRECEDES`
- `MITIGATED_BY`
- `OBSERVED_ON`
- `RELATED_TO`

The graph engine must support:

- pan
- zoom
- rotation
- focus
- expansion
- collapse
- node selection
- relationship highlighting
- path highlighting
- temporal replay

---

# 8. Attack Path Reconstruction

When an incident contains sufficient chronological and relational data, the system should reconstruct an attack path.

Example:

```text
Initial Access
      ↓
Execution
      ↓
Credential Access
      ↓
Discovery
      ↓
Lateral Movement
      ↓
Collection
      ↓
Impact
```

The path must be derived from incident/event relationships.

It must not be an arbitrary decorative animation.

## Attack Path Replay

Controls:

- Play
- Pause
- Step Forward
- Step Back
- Restart
- Playback Speed

During replay:

- timeline advances
- attack graph path activates
- affected assets highlight
- MITRE techniques activate
- related IOCs highlight
- incident risk context updates

The replay must remain deterministic for the same incident dataset.

---

# 9. MITRE ATT&CK Spatial Matrix

MITRE ATT&CK becomes an interactive visualization rather than a static table.

Selecting a technique should expose:

- tactic
- technique
- sub-technique
- related events
- incidents
- assets
- users
- evidence
- attack-path position

## Cross-visual synchronization

Selecting a MITRE technique should cause:

- related attack graph nodes to highlight
- related timeline events to highlight
- related assets to highlight
- related IOCs to highlight
- incident context to update

The MITRE visualization and attack graph must consume the same underlying relationship model.

---

# 10. System Radar

The System Radar represents the affected environment around an incident or selected asset.

Possible entities:

- endpoints
- servers
- domain controllers
- databases
- users
- services
- network segments

## Visual semantics

Healthy:

normal state

Suspicious:

subtle warning state

Compromised:

high-visibility state

Critical:

highest-priority state

The radar should support:

- blast radius
- lateral movement
- affected assets
- trust relationships
- communication paths
- asset criticality

---

# 11. IOC Constellation

The IOC Constellation represents relationships among:

- IPs
- domains
- hashes
- URLs
- files
- incidents
- assets
- users

Selecting an IOC should expose related entities.

Example:

```text
IOC
 |
 +-- Events
 |
 +-- Assets
 |
 +-- Users
 |
 +-- Incidents
 |
 +-- MITRE Techniques
```

The system should support relationship expansion and collapse.

---

# 12. Spatial Timeline

The timeline is a first-class investigation object.

It should display chronological events and security milestones.

Example:

```text
09:41 ---- 09:47 ---- 09:53 ---- 10:02 ---- 10:11
  |          |           |           |           |
Login     Execution   Credential   Lateral     Impact
                      Access       Movement
```

Interactions:

- Point at event
- Dwell to focus
- Select event
- Move along timeline
- Replay incident

Selecting a timeline event should synchronize other views.

---

# 13. Evidence Space

Evidence should be progressively disclosed.

Evidence types may include:

- telemetry events
- logs
- artifacts
- hashes
- files
- screenshots
- analyst notes
- detection results
- correlation results

Evidence should remain associated with its source incident/entity.

---

# 14. Response Space

Response actions must be security-conscious and state-aware.

Potential actions:

- Quarantine Host
- Disable Account
- Block IOC
- Isolate Asset
- Escalate
- Start Investigation
- Mark False Positive
- Confirm Threat
- Execute Playbook

## Action lifecycle

```text
TARGET
  ↓
ACTION PREVIEW
  ↓
CONFIRMATION
  ↓
EXECUTION
  ↓
RESULT
  ↓
AUDIT
```

Actions should expose:

- target
- expected effect
- risk
- reversibility
- authorization requirement
- current status

Destructive actions must never execute from an unstable/transient gesture.

---

# 15. SOAR Playbook Visualization

Playbooks should be represented as spatial workflows.

Example:

```text
DETECT
  ↓
ENRICH
  ↓
CORRELATE
  ↓
CLASSIFY
  ↓
CONTAIN
  ↓
VERIFY
  ↓
RECOVER
```

The system should visually indicate:

- pending
- active
- completed
- failed
- awaiting approval

The analyst should be able to inspect each playbook step.

Future versions may support spatial playbook editing.

---

# 16. Threat Intelligence Orb

The cinematic orb is an optional visualization layer for threat/campaign/global infrastructure context.

It must NOT become the main application background.

It should appear when it provides meaningful security context.

## Possible data

- source IP locations
- destination locations
- affected infrastructure
- campaign infrastructure
- network relationships
- attack origins
- C2 relationships

## Offline requirement

The orb must not imply live Internet intelligence when operating offline.

It should visualize local/bundled datasets.

If geographic IP visualization is required offline, use a bundled local GeoIP/geolocation dataset.

The orb must reflect actual application data.

No fabricated "live global attacks."

## Visual behavior

- nodes represent infrastructure
- lines represent relationships
- severity controls prominence
- activity controls pulse/intensity
- paths can animate during attack replay
- selected entities can propagate focus through the graph

---

# 17. AI Intelligence Layer

AI is an intelligence layer, not a chat box attached to the dashboard.

## AI capabilities

- Incident Summary
- Attack Narrative
- Risk Explanation
- Correlation Explanation
- MITRE Reasoning
- Affected Asset Explanation
- Recommended Investigation Steps
- Recommended Response Actions
- Executive Summary
- Evidence Summarization

## Provider abstraction

```text
AIService
  |
  +-- RuleBasedProvider
  |
  +-- LocalLLMProvider
  |
  +-- ExplainSecAIProvider
```

The spatial UI must not depend directly on a specific AI provider.

## Offline MVP

The application must remain fully functional without an LLM.

Use deterministic analysis for:

- summaries
- severity
- correlation
- ATT&CK mapping
- attack-path construction
- risk scoring
- recommendations

A local model can be added later.

---

# 18. Cross-Visualization Intelligence

This is a core S-tier feature.

All investigation visualizations must remain synchronized.

Example:

```text
Analyst selects T1059.003
        |
        +--> MITRE highlights technique
        |
        +--> Attack Graph highlights path
        |
        +--> Timeline highlights related events
        |
        +--> System Radar highlights affected assets
        |
        +--> IOC Constellation highlights related IOCs
        |
        +--> Incident Summary updates context
```

There should be one underlying investigation context, not isolated visualizations.

---

# 19. Blast Radius Analysis

Selecting an asset or incident should allow:

`SHOW BLAST RADIUS`

The system traverses relationships and categorizes:

- directly affected
- potentially affected
- at risk
- unrelated

The traversal should be based on the actual relationship graph.

---

# 20. Risk Propagation

Risk should be represented across connected entities.

Example:

```text
Compromised Asset
      ↓
Critical Service
      ↓
Sensitive Data
      ↓
Business Impact
```

The system should show how risk changes when:

- new evidence appears
- new relationships are discovered
- containment occurs
- an incident is escalated
- an asset is isolated

Risk calculation must be deterministic and inspectable in offline mode.

---

# 21. Entity Lineage

Any important entity should support backward and forward lineage.

Backward:

```text
Incident
  ↑
Correlation
  ↑
Events
  ↑
Telemetry
  ↑
Source
```

Forward:

```text
Incident
  ↓
Analysis
  ↓
Decision
  ↓
Response
  ↓
Outcome
```

Lineage supports investigation and auditability.

---

# 22. Investigation Stack

Spatial navigation should preserve investigation context.

Example:

```text
SOC
 ↓
Incident
 ↓
Asset
 ↓
IOC
```

Fist/back behavior should return to the previous investigation context where appropriate.

The user should not lose their investigation state when drilling deeper.

---

# 23. Hands-Free Interaction Model

## Primary gestures

### Open Palm

Command Mode:

- enter spatial mode

Spatial Mode:

- activate continuous spatial interaction
- expand selected/contextual content

### Fist

Context-dependent:

- collapse
- go back one investigation level
- cancel confirmation
- exit focus

### Index Point

- target spatial object

### Point + Dwell

- focus/select

### Two Hands

Distance:

- zoom

Midpoint:

- pan

Angle:

- rotate

### Open Palm Movement

Horizontal:

- spatial workspace movement

Vertical:

- spatial workspace movement

Velocity:

- responsive/inertial influence

### Palm Orientation

Palm facing interaction surface:

- full interaction sensitivity

Palm turned away:

- reduce/disable interaction

### Optional Palm Depth

Palm toward camera:

- subtle depth/zoom response

Palm away:

- subtle reverse response

This is optional and must be disabled if unreliable.

### Future Pinch

Thumb + index pinch may become:

- grab
- pull
- object manipulation

Pinch is lower priority than core gestures.

---

# 24. Gesture Architecture

Individual UI components must NOT implement their own hand-recognition logic.

Use:

```text
Hand Tracking
      ↓
Gesture Engine
      ↓
Interaction Intent
      ↓
Spatial Interaction Controller
      ↓
Spatial Components
```

Example intents:

- `ENTER_SPATIAL`
- `COLLAPSE`
- `POINT_TARGET`
- `FOCUS_TARGET`
- `PAN`
- `ZOOM`
- `ROTATE`
- `EXPAND`
- `CONFIRM`
- `CANCEL`
- `BACK`

This keeps gesture logic reusable.

---

# 25. Spatial Interaction Physics

Continuous transforms should use target/current state.

```text
Hand Tracking
    ↓
Target Position
    ↓
Interpolation
    ↓
Current Position
    ↓
Renderer
```

The renderer must continue independently of hand inference.

Use:

- low-latency interpolation
- velocity-aware smoothing
- dead zones
- damping
- bounded sensitivity

Avoid excessive smoothing that creates perceptible lag.

---

# 26. Hand Tracking Performance

Performance is a product requirement.

Targets:

- Hand tracking: minimum ~30 FPS under normal conditions
- Preferred tracking: 30–45 FPS
- Rendering: approximately 60 FPS where hardware permits
- No full React render per tracking frame
- No unnecessary Three.js scene reconstruction
- No unused globe rendering during SOC mode

Camera/inference/rendering must be decoupled.

Conceptual pipeline:

```text
Camera
  ↓
Frame Scheduler
  ↓
Hand Inference
  ↓
Landmarks
  ↓
Gesture Engine
  ↓
Target Values
  ↓
RAF Interpolation
  ↓
Spatial Renderer
```

React state should represent semantic state, not continuous coordinates.

---

# 27. Offline Security Core

The application must function with:

- Wi-Fi disabled
- Ethernet disabled
- Internet unavailable

Core offline capabilities:

- authentication
- RBAC
- session management
- incident creation
- telemetry ingestion
- event generation
- correlation
- incident lifecycle
- MITRE mapping
- attack-path reconstruction
- threat hunting
- risk scoring
- evidence
- notes
- response workflows
- SOAR playbooks
- audit logging
- local persistence
- local reporting

---

# 28. Local Persistence

The exact database technology may evolve, but the architecture must support a durable local store.

Conceptual domains:

```text
users
roles
sessions

incidents
alerts
events
telemetry

assets
security_users
iocs

mitre_tactics
mitre_techniques

correlations
attack_paths
attack_nodes

evidence
notes

response_actions
playbooks

risk_scores
audit_logs
```

The UI must never treat local data as disposable mock state.

---

# 29. Offline Authentication and RBAC

Authentication remains mandatory.

Conceptual flow:

```text
Login
 ↓
Local Auth Service
 ↓
Credential Verification
 ↓
Session
 ↓
RBAC
 ↓
Spatial Workspace
```

Role context should influence:

- available workspaces
- visible information
- available actions
- response permissions
- escalation capabilities

Initial role contexts:

- SOC L1
- SOC L2
- Incident Response
- Threat Hunter
- SOC Manager
- Administrator

Exact roles and permissions should align with the existing EXPLAIN-SEC implementation during integration.

---

# 30. Offline Telemetry and Incident Generation

The application must be capable of generating realistic security activity locally.

Pipeline:

```text
Scenario / Telemetry
        ↓
Normalization
        ↓
Detection
        ↓
Correlation
        ↓
Qualification
        ↓
Incident
        ↓
Investigation
        ↓
Response
        ↓
Resolution
```

The system should support deterministic attack scenarios rather than purely random events.

Example:

```text
Credential Compromise
    ↓
Suspicious Login
    ↓
Execution
    ↓
Credential Access
    ↓
Discovery
    ↓
Lateral Movement
    ↓
Sensitive Asset Access
```

---

# 31. Attack Scenario Engine

Initial scenario library may include:

- Credential Compromise
- Phishing
- Ransomware
- Insider Threat
- Lateral Movement
- Data Exfiltration
- Privilege Escalation
- Web Attack
- Custom Scenario

A scenario should generate coherent:

- events
- telemetry
- IOCs
- users
- assets
- MITRE techniques
- correlations
- incident
- timeline
- attack path
- response opportunities

---

# 32. Scenario Replay

A scenario should be reproducible.

Given the same seed/configuration:

- event order should remain deterministic
- timestamps should be deterministic or controllably generated
- relationships should remain consistent
- attack graph should reconstruct consistently

This enables reliable demos and testing.

---

# 33. Reference UI Migration

Existing EXPLAIN-SEC screenshots are reference material.

They describe:

- existing functionality
- information hierarchy
- role-specific workflows
- available actions
- existing visual semantics

They are NOT templates for the new UI.

The spatial product should preserve functionality while redesigning:

- layout
- navigation
- interaction
- spatial representation
- information hierarchy
- progressive disclosure

---

# 34. Existing UI → Spatial Mapping

| Existing Concept | Spatial Equivalent |
|---|---|
| Overview Dashboard | Spatial Command Space |
| Live Telemetry Table | Spatial Event Stream |
| Incident Queue | Incident Field / Constellation |
| Incident Detail | Incident Universe |
| Event Investigation Drawer | Spatial Inspector |
| Correlation Chain | Correlation Graph |
| MITRE View | Interactive ATT&CK Matrix |
| Attack Campaign | Campaign Graph |
| Timeline | Spatial Timeline |
| Asset View | System Radar |
| IOC Table | IOC Constellation |
| L1 Dashboard | L1 Command Context |
| L2 Dashboard | L2 Investigation Context |
| Threat Hunter | Threat Hunt Space |
| Response Buttons | Spatial Response Layer |
| Reports | Case / Report Workspace |
| Governance | Governance Workspace |
| Admin | Conventional/spatial admin context as appropriate |

---

# 35. What Should NOT Be Spatialized

Spatial computing should not be forced onto every feature.

Keep conventional UI where spatial interaction does not provide meaningful benefit.

Examples:

- long configuration forms
- obscure administrative settings
- large CRUD workflows
- detailed configuration editing
- bulk data management
- authentication administration
- long-form report composition

These can remain compact conventional panels inside the spatial environment when needed.

---

# 36. S-Tier Feature Priority

## Tier S — Core differentiators

1. Incident Universe
2. Dynamic Attack Graph
3. Animated Attack Path Replay
4. Cross-visualization synchronization
5. MITRE ATT&CK spatial mapping
6. System Radar / blast radius
7. IOC Constellation
8. Spatial Timeline
9. Hands-free spatial manipulation
10. Offline persistence/auth/RBAC
11. Offline incident generation and workflows
12. SOAR spatial execution
13. AI-assisted investigation architecture
14. Cinematic Threat Intelligence Orb
15. Investigation Stack / contextual navigation

## Tier A — High-value extensions

- Scenario Builder
- Campaign Universe
- Evidence Board
- Risk Propagation
- Entity Lineage
- Investigation Bookmarks
- Playbook visualization
- Spatial notifications
- Analyst case workspace
- Local AI model support
- Voice interaction

## Tier B — Future expansion

- Collaborative multi-analyst spatial sessions
- Multi-user shared investigation
- advanced 3D environment mapping
- AR device-specific optimization
- spatial report generation
- advanced playbook authoring
- external threat-intelligence ingestion
- cloud-scale telemetry

---

# 37. Product Experience: Flagship Flow

The primary demo/investigation flow should be:

```text
ANALYST LOGIN
     ↓
SPATIAL COMMAND SPACE
     ↓
CRITICAL INCIDENT APPEARS
     ↓
POINT
     ↓
TARGET
     ↓
DWELL
     ↓
INCIDENT FOCUS
     ↓
OPEN PALM
     ↓
INCIDENT UNIVERSE
     ↓
SUMMARY + RISK
     ↓
ATTACK GRAPH
     ↓
MITRE MATRIX
     ↓
SYSTEM RADAR
     ↓
TIMELINE
     ↓
IOC CONSTELLATION
     ↓
ATTACK PATH REPLAY
     ↓
AI ANALYSIS
     ↓
BLAST RADIUS
     ↓
SOAR RESPONSE
     ↓
CONFIRM
     ↓
EXECUTE
     ↓
AUDIT
     ↓
INCIDENT RESOLUTION
```

Every visualization should be derived from the same incident context.

---

# 38. Data Architecture

The spatial application should use a domain-driven model.

Conceptually:

```text
Incident
├── alerts[]
├── events[]
├── assets[]
├── users[]
├── iocs[]
├── techniques[]
├── timeline[]
├── evidence[]
├── attackPath[]
├── responseActions[]
├── risk
└── lifecycle
```

Spatial visualizations consume this model rather than maintaining their own disconnected datasets.

---

# 39. Provider / Connector Architecture

The connector is a first-class subsystem.

Conceptual structure:

```text
                 Spatial Application
                         |
                  Security Service
                         |
          +--------------+--------------+
          |              |              |
     LocalProvider  FirebaseProvider  ExplainSecProvider
          |              |              |
        SQLite        Firestore       EXPLAIN-SEC
```

The spatial UI must only consume the provider/service interface.

It must not directly depend on:

- SQLite implementation details
- Firestore implementation details
- EXPLAIN-SEC API details

## Core service contract

Conceptual operations:

```text
getIncidents()
getIncident(id)
getEvents()
getAssets()
getUsers()
getIOCs()
getTechniques()
getTimeline()
getEvidence()
getAttackPath()

createIncident()
updateIncident()
assignIncident()
changeIncidentState()

addEvidence()
addNote()

executeResponse()
executePlaybook()

getAuditHistory()
```

The exact contract must be finalized against the existing EXPLAIN-SEC domain model before integration.

---

# 40. Integration Strategy

## Phase A — Existing Spatial Project

Use:

`LocalProvider`

Everything works offline.

## Phase B — Firebase

Introduce:

`FirebaseProvider`

without changing spatial components.

Firebase can provide:

- persistence
- authentication
- synchronization
- multi-user capability
- remote data

## Phase C — EXPLAIN-SEC

Introduce:

`ExplainSecProvider`

Map existing EXPLAIN-SEC entities and APIs into the provider contract.

The spatial application should then become an alternative EXPLAIN-SEC client.

---

# 41. Integration Rules

When integrating with EXPLAIN-SEC:

1. Do not duplicate business logic unnecessarily.
2. Do not create a second competing incident lifecycle.
3. Do not create conflicting RBAC rules.
4. Do not bypass existing governance/authorization.
5. Do not hard-code EXPLAIN-SEC API calls into visual components.
6. Map existing entities into the spatial domain model.
7. Preserve existing security state.
8. Preserve auditability.
9. Preserve role-specific workflows.
10. Keep the spatial UI provider-agnostic.

---

# 42. Visual Design Language

The target aesthetic is:

**high-end enterprise SOC + spatial computing + cinematic cyber command environment**

The visual language should communicate:

- severity
- relationships
- state
- selection
- focus
- depth
- movement
- hierarchy

Avoid:

- excessive neon
- meaningless particles
- constant glitch effects
- fake telemetry
- random animations
- giant decorative objects
- visual noise

The cinematic effect should emerge from meaningful data movement.

---

# 43. Cinematic Interaction Rules

Animation should represent something.

Good:

- attack path progresses through actual events
- affected asset lights up
- MITRE technique activates
- IOC relationship propagates
- incident expands into relationships
- response action changes system state

Bad:

- random particles
- meaningless rotating objects
- constant screen shake
- arbitrary camera movement
- fake attack lines unrelated to data

---

# 44. Progressive Disclosure

Information should appear in layers.

Example:

### Level 1

Incident severity + title.

### Level 2

Incident metadata + summary.

### Level 3

Related entities.

### Level 4

Evidence and detailed relationships.

### Level 5

Response actions and operational controls.

This prevents spatial information overload.

---

# 45. Contextual Visual Hierarchy

Foreground:

currently investigated object.

Middle:

directly related entities.

Background:

situational awareness.

The interface should continuously communicate:

> "What am I looking at?"

> "Why is it relevant?"

> "What is connected to it?"

> "What can I do next?"

---

# 46. Performance Architecture

Continuous interaction must be independent of semantic UI rendering.

Use:

```text
Camera
  ↓
Hand Inference
  ↓
Landmarks
  ↓
Gesture Features
  ↓
Interaction Intent
  ↓
Mutable Spatial Targets
  ↓
requestAnimationFrame
  ↓
Renderer
```

React/UI state:

- mode
- focused object
- semantic gesture
- incident
- workflow state
- authorization state

Mutable/continuous state:

- hand position
- cursor position
- pan
- zoom
- rotation
- interpolation
- spatial velocity

No per-frame full React tree updates.

---

# 47. Failure Handling

## Tracking loss

Freeze current spatial targets.

Do not:

- reset
- snap
- collapse
- teleport
- reset zoom
- reset rotation

When tracking returns:

smoothly reacquire position.

## Low performance

Adaptive quality may reduce:

- inference frequency
- tracking resolution
- optional effects

Do not degrade essential SOC information first.

## Offline data errors

Display clear local-system status.

Never silently fabricate data.

---

# 48. Security and Auditability

All operational actions must be auditable.

Record:

- actor
- role
- timestamp
- target
- action
- previous state
- resulting state
- authorization/approval
- outcome

The spatial layer must not bypass security controls simply because interaction is gesture-based.

---

# 49. Development Strategy

Existing EXPLAIN-SEC functionality is considered substantially implemented.

The Spatial project should therefore focus on:

- creating spatial components
- refactoring existing visual components
- creating the spatial domain adapter
- connecting existing workflows
- upgrading existing gesture infrastructure
- creating new visualizations
- preserving existing functionality

Avoid rewriting stable backend/business logic without evidence that it is necessary.

---

# 50. Implementation Order

## Stage 1 — Architecture

- Inspect current Spatial project
- Inspect EXPLAIN-SEC
- Inspect `/Screenshots/`
- Create spatial migration map
- Identify reusable existing components
- Identify provider boundary

## Stage 2 — Offline Core

- local auth
- RBAC
- persistence
- telemetry
- events
- incidents
- lifecycle
- audit

## Stage 3 — Investigation Intelligence

- correlation
- attack graph
- MITRE mapping
- timeline
- risk
- asset relationships
- IOC relationships

## Stage 4 — Spatial Engine

- workspace
- spatial panels
- graph renderer
- radar
- timeline
- orb
- inspector
- focus system

## Stage 5 — Hand Interaction

- open palm
- fist
- point
- dwell
- palm movement
- two-hand pan
- two-hand zoom
- two-hand rotation
- interaction locking
- tracking recovery

## Stage 6 — Incident Universe

- incident anchor
- dynamic expansion
- summary
- graph
- MITRE
- radar
- timeline
- IOC constellation
- evidence
- response

## Stage 7 — Replay

- attack reconstruction
- timeline synchronization
- animated path
- deterministic playback

## Stage 8 — AI

- rule-based intelligence
- AI provider abstraction
- local model option
- AI orb

## Stage 9 — SOAR

- actions
- playbooks
- confirmation
- execution
- audit

## Stage 10 — Firebase

- Firebase provider
- authentication
- Firestore
- synchronization

## Stage 11 — EXPLAIN-SEC Connector

- map domain entities
- map workflows
- map RBAC
- map lifecycle
- map audit
- connect real data

---

# 51. Definition of Done — Offline MVP

The offline version is considered substantially complete when:

- [ ] application starts without Internet
- [ ] local authentication works
- [ ] RBAC works
- [ ] local persistence works
- [ ] incidents can be generated
- [ ] telemetry/events can be generated
- [ ] incidents progress through lifecycle
- [ ] correlation works
- [ ] MITRE relationships work
- [ ] attack graph works
- [ ] timeline works
- [ ] system radar works
- [ ] IOC relationships work
- [ ] incident universe works
- [ ] attack replay works
- [ ] response workflow works
- [ ] audit logs work
- [ ] hand tracking works
- [ ] open palm works
- [ ] fist works
- [ ] pointing works
- [ ] dwell works
- [ ] two-hand pan works
- [ ] two-hand zoom works
- [ ] two-hand rotation works
- [ ] palm movement continuously affects spatial UI
- [ ] tracking loss/recovery works
- [ ] renderer remains smooth during tracking
- [ ] no per-frame React tree rerender
- [ ] unused globe is not rendered in SOC mode
- [ ] threat orb uses actual local data
- [ ] no external API is required
- [ ] offline attack scenarios are reproducible

---

# 52. Definition of Done — EXPLAIN-SEC Integration

The integrated version is considered complete when:

- [ ] ExplainSecProvider works
- [ ] existing EXPLAIN-SEC incidents are visible
- [ ] existing events are visible
- [ ] existing assets are mapped
- [ ] existing users/roles are respected
- [ ] existing MITRE mappings are respected
- [ ] existing lifecycle is respected
- [ ] existing response permissions are respected
- [ ] spatial investigation uses real EXPLAIN-SEC data
- [ ] actions flow through approved EXPLAIN-SEC workflows
- [ ] audit data remains consistent
- [ ] no duplicate business logic unnecessarily exists
- [ ] classic EXPLAIN-SEC remains functional
- [ ] Spatial becomes an alternative client/interface

---

# 53. Final Product Vision

The final experience should feel like:

```text
LOGIN
  ↓
SPATIAL SOC
  ↓
THREAT LANDSCAPE
  ↓
INCIDENT
  ↓
POINT
  ↓
FOCUS
  ↓
OPEN PALM
  ↓
INCIDENT UNIVERSE
  ↓
ATTACK GRAPH
  ↓
MITRE
  ↓
SYSTEM RADAR
  ↓
TIMELINE
  ↓
IOC CONSTELLATION
  ↓
ATTACK REPLAY
  ↓
AI ANALYSIS
  ↓
RISK / BLAST RADIUS
  ↓
SOAR
  ↓
RESPONSE
  ↓
AUDIT
  ↓
RESOLUTION
```

The defining characteristic is not that the application is 3D.

The defining characteristic is that:

> **Security relationships become visible, navigable, and actionable in space.**

The analyst should be able to understand an incident by manipulating the security environment rather than navigating through a sequence of conventional dashboards.

The final system should feel cinematic because the **security data itself creates the visual narrative**.

---

# 54. Non-Negotiable Architectural Rule

The Spatial project must always maintain this separation:

```text
SECURITY DOMAIN
       ↓
SECURITY SERVICES
       ↓
PROVIDER / CONNECTOR
       ↓
SPATIAL STATE
       ↓
SPATIAL VISUALIZATION
       ↓
HAND INTERACTION
```

Never reverse this dependency.

The gesture system must never become the source of security truth.

The visualization must never become the source of security state.

The provider must never be coupled to a specific visualization.

The spatial experience is a client of the security platform.

That architecture is what allows the same product to run:

```text
OFFLINE
   ↓
LOCAL DATA
```

and later:

```text
EXPLAIN-SEC
   ↓
FIREBASE / API
   ↓
REAL SECURITY DATA
```

without rebuilding the spatial experience.

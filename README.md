# ThreatLenX

> Detect. Explain. Respond.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?style=flat-square&logo=vite)](https://vite.dev/)
[![Vinext](https://img.shields.io/badge/Vinext-1.0.0--beta.5-black?style=flat-square)](https://github.com/cloudflare/vinext)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4.2-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)

**ThreatLenX** is an offline-first, client-side Security Operations Center (SOC) investigation and threat analysis platform. Built with React 19, TypeScript, Vite/Vinext, and IndexedDB, it gives security analysts, incident responders, and detection engineers an interactive environment to triage security incidents, explore multi-stage attack graphs, conduct hypothesis-driven threat hunting, track investigative cases, audit cryptographic evidence, and rehearse containment playbooks.

---

## Table of Contents

- [Project Purpose & Development Status](#project-purpose--development-status)
- [Six Core SOC Workspaces](#six-core-soc-workspaces)
  - [1. Command Center (COMMAND)](#1-command-center-command)
  - [2. Incident Investigation (INVESTIGATION)](#2-incident-investigation-investigation)
  - [3. Threat Hunting (HUNTING)](#3-threat-hunting-hunting)
  - [4. Case Management (CASES)](#4-case-management-cases)
  - [5. Evidence Vault (EVIDENCE)](#5-evidence-vault-evidence)
  - [6. Detection Rules (DETECTION)](#6-detection-rules-detection)
- [System Architecture](#system-architecture)
  - [Frontend Stack](#frontend-stack)
  - [Offline-First IndexedDB Persistence](#offline-first-indexeddb-persistence)
  - [Repository & Provider Pattern](#repository--provider-pattern)
- [Local Demo Data & Simulated Response Limitations](#local-demo-data--simulated-response-limitations)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation & Running Locally](#installation--running-locally)
- [Actual Build, Lint & Verification Commands](#actual-build-lint--verification-commands)
- [Repository Structure](#repository-structure)
- [Attribution & Prior Art](#attribution--prior-art)

---

## Project Purpose & Development Status

### Purpose
Modern security telemetry can be overwhelming and fragmented across disparate SIEM, EDR, and SOAR tools. ThreatLenX brings key SOC operational disciplines together into a unified, visual workspace:
- **Detect**: Rapidly identify anomalous signals, alert clusters, and rule matches across network, endpoint, and identity telemetry.
- **Explain**: Provide multi-dimensional contextual models including interactive attack graphs, MITRE ATT&CK technique matrices, IOC relationship constellations, and chronological timeline event replays.
- **Respond**: Rehearse defensive actions through structured SOAR containment playbooks, track incident cases, and verify cryptographic chain-of-custody logs.

### Development Status
ThreatLenX is currently in an **active prototype / development stage**:
- **Architecture**: The application runs entirely on the client side as a single-page application (SPA) backed by IndexedDB. It does not require a live remote backend database to run locally.
- **Production Readiness**: This project is **not** currently certified for production enterprise deployment. It is intended for operational design research, security concept evaluation, cyber-range simulation, and analyst training.
- **Current Verification State**:
  - TypeScript type checking (`npx tsc --noEmit`) passes cleanly with 0 errors.
  - Production builds (`npm run build` via Vinext and `npm run build:vercel` via Vite) compile successfully.
  - The static linter (`npm run lint` via `oxlint`) is active but currently reports strict rule violations and unhandled promise notices across several development components.
  - No standardized `npm test` script is registered in [package.json](package.json); domain verification suites currently live as individual scripts in the [scripts/](scripts/) directory.

---

## Six Core SOC Workspaces

The platform is structured around the **Spatial Command Hub** ([app/spatial/hub/SpatialCommandHub.tsx](app/spatial/hub/SpatialCommandHub.tsx)), providing fast access to six specialized operational workspaces:

```
                            ┌────────────────────────┐
                            │  Spatial Command Hub   │
                            │ (Hub Navigation Ring)  │
                            └───────────┬────────────┘
         ┌──────────────┬───────────────┼───────────────┬──────────────┐
         ▼              ▼               ▼               ▼              ▼
   ┌───────────┐  ┌───────────┐   ┌───────────┐   ┌───────────┐  ┌───────────┐
   │  Command  │  │ Incident  │   │  Threat   │   │   Case    │  │ Evidence  │
   │  Center   │  │ Investi-  │   │  Hunting  │   │  Manage-  │  │   Vault   │
   │ (COMMAND) │  │  gation   │   │ (HUNTING) │   │   ment    │  │(EVIDENCE) │
   └───────────┘  └─────┬─────┘   └───────────┘   └───────────┘  └───────────┘
                        │                                              ▲
                        ▼                                              │
                 ┌─────────────┐                                ┌──────┴──────┐
                 │  Detection  │◄───────────────────────────────┤ Playbooks & │
                 │    Rules    │                                │  Response   │
                 │ (DETECTION) │                                │   Actions   │
                 └─────────────┘                                └─────────────┘
```

### 1. Command Center (`COMMAND`)
*Files:* [app/spatial/incident-universe/IncidentUniverse.tsx](app/spatial/incident-universe/IncidentUniverse.tsx), [app/spatial/command/CommandCenterWorkspace.tsx](app/spatial/command/CommandCenterWorkspace.tsx)

- **Incident Universe**: Visual spatial layout representing active security incidents as interactive nodes color-coded by severity (Critical, High, Medium, Low).
- **Relationship Graph**: Displays relational links between active incidents, shared assets, and common infrastructure.
- **Posture Overview & Metrics**: Real-time status indicators summarizing open incidents, elevated alert volumes, and threat levels.
- **Incident Creation**: Modal to generate custom local incident records with mapped target assets and severities.

### 2. Incident Investigation (`INVESTIGATION`)
*Files:* [app/spatial/investigation/InvestigationHub.tsx](app/spatial/investigation/InvestigationHub.tsx), [app/spatial/investigation/](app/spatial/investigation/)

- **Attack Graph**: Node-and-link topological visualization charting attacker progression from initial access across internal pivots to final objectives.
- **MITRE ATT&CK Matrix**: Highlights observed tactics and techniques against the MITRE enterprise matrix framework.
- **Timeline & Event Replay**: Chronological timeline of correlated security events, with scrubber controls to step through attack stages.
- **IOC Constellation**: Visual extraction of indicators of compromise (IP addresses, domains, file hashes, CVEs) tied to the active incident.
- **Systems & Telemetry Radar**: Health and telemetry indicators for impacted host assets and network segments.
- **Findings, Notes & Evidence Linking**: Integrated views for analyst documentation, finding notes, and manual evidence attachment.
- **Inline Response Actions**: Execution interface for incident mitigation playbooks ([app/spatial/response/ResponseSpace.tsx](app/spatial/response/ResponseSpace.tsx)).

### 3. Threat Hunting (`HUNTING`)
*Files:* [app/spatial/hunting/ThreatHuntingWorkspace.tsx](app/spatial/hunting/ThreatHuntingWorkspace.tsx), [app/core/hunting/threat-hunt-engine.ts](app/core/hunting/threat-hunt-engine.ts)

- **Hypothesis Formulation**: Structure hunts around threat hypotheses, attacker behaviors, and anomaly descriptions.
- **Query Builder**: Multi-category query filter supporting process creation, network connections, authentication attempts, and file activity.
- **Correlation & Matching**: Runs hunt queries against local event streams, surfacing matched records and frequency metrics.
- **Investigation Pivot**: One-click pivoting from a hunt finding directly into full incident investigation.

### 4. Case Management (`CASES`)
*Files:* [app/spatial/cases/CaseWorkspace.tsx](app/spatial/cases/CaseWorkspace.tsx), [app/core/models/case.ts](app/core/models/case.ts)

- **Case Dossiers**: Formal case record tracking with assigned investigator, priority classification, and lifecycle states (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`).
- **Task & Finding Management**: Granular checklists and analytical findings associated with specific cases.
- **Cross-Entity Association**: Links cases to related incidents, threat hunts, and evidentiary artifacts.

### 5. Evidence Vault (`EVIDENCE`)
*Files:* [app/spatial/evidence/EvidenceWorkspace.tsx](app/spatial/evidence/EvidenceWorkspace.tsx), [app/core/security/evidence-crypto.ts](app/core/security/evidence-crypto.ts)

- **Cryptographic Chain of Custody**: Computes and verifies SHA-256 integrity hashes for stored evidence items.
- **Tamper Verification**: Audits recorded artifacts against expected cryptographic digests to detect unauthorized modifications.
- **Custody Audit Trail**: Immutable, append-only logs detailing who collected, accessed, or modified evidence records.
- **Artifact Classification**: Categorizes disk dumps, packet captures, process logs, memory images, and configuration snapshots.

### 6. Detection Rules (`DETECTION`)
*Files:* [app/spatial/detection/DetectionEngineeringWorkspace.tsx](app/spatial/detection/DetectionEngineeringWorkspace.tsx), [app/core/security/detection-engine.ts](app/core/security/detection-engine.ts)

- **Rule Authoring Studio**: Interface for crafting declarative detection rules with conditional groups (`AND`, `OR`, `NOT`).
- **Syntax & Structural Validation**: Real-time rule validation using [app/core/security/rule-validator.ts](app/core/security/rule-validator.ts) to verify field schemas, operators, and metadata completeness.
- **Dry-Run Simulation**: Evaluates rules against local event streams in isolation without generating extraneous production alerts.
- **Lifecycle State Machine**: Tracks rule progression through `DRAFT` → `VALIDATING` → `TESTING` → `PUBLISHED` → `ENABLED`.
- **Wazuh & Sigma Mapping**: Framework integration models for aligning rules with external SIEM schemas ([app/core/wazuh/](app/core/wazuh/)).

---

## System Architecture

### Frontend Stack
- **UI Framework**: React 19 (`react` 19.2.6, `react-dom` 19.2.6) with React Server Component (RSC) tooling compatibility.
- **Language**: TypeScript 5.9 (`typescript` 5.9.3) using strict typing for all security entities, providers, and event schemas.
- **Component Primitives**: TailwindCSS 4, `@shadcn/react`, `@base-ui/react`, and [Lucide React](https://lucide.dev/) icons.
- **Visualizations**: [Recharts](https://recharts.org/) and custom SVG canvas graph projections.
- **Bundler & Server**:
  - **Vinext** (`vinext` 1.0.0-beta.5) for Next.js-compatible development and edge builds.
  - **Vite 8** (`vite` 8.0.13) for optimized standalone Single Page Application (SPA) production packaging via [vite.vercel.config.ts](vite.vercel.config.ts).

### Offline-First IndexedDB Persistence
*Files:* [app/core/storage/idb-store.ts](app/core/storage/idb-store.ts)

ThreatLenX operates entirely in the browser using a typed IndexedDB wrapper targeting the `es-spatial-db` database. Data persistence is divided into:
- **Mutable Entity Stores**: `incidents`, `assets`, `users`, `iocs`, `cases`, `evidence`, `detection_rules`, and `threat_hunts`.
- **Append-Only Stores**: `audit_records`, `evidence_custody`, `detection_test_runs`, and `playbook_executions`.
- **Dynamic Derivations**: High-volume graph relationships, MITRE coverage matrices, and telemetry summaries are derived in-memory at runtime from canonical records.

### Repository & Provider Pattern
*Files:* [app/core/security-service.ts](app/core/security-service.ts), [app/core/providers/provider-interface.ts](app/core/providers/provider-interface.ts), [app/core/providers/local-provider.ts](app/core/providers/local-provider.ts)

- **`ISecurityProvider`**: An abstract interface decoupling the UI from data sources.
- **`LocalProvider`**: Concrete implementation executing against IndexedDB and pre-seeded security fixtures.
- **`SecurityService`**: Singleton gateway orchestrating data retrieval, role-based access control (RBAC), and reactive UI event subscriptions.

---

## Local Demo Data & Simulated Response Limitations

### Seeded Scenarios
When initialized for the first time, ThreatLenX seeds IndexedDB with a curated mock security scenario (**Operation BlackTide** and auxiliary security events):
- Multi-stage incidents simulating ransomware delivery, credential access, data exfiltration, and cloud privilege escalation.
- Associated host assets, mock users, network IOCs, and correlated event sequences.

### Defensive Simulation Engine
*Files:* [app/core/simulation/simulation-engine.ts](app/core/simulation/simulation-engine.ts)

The platform includes a local simulation engine that exercises the detection pipeline:
```
  Scenario Step ──► Event Generator ──► Detection Engine (AST) ──► Alert Dedup ──► Correlation ──► SOAR Dry-Run
```

### Response Limitations & Safety
> [!IMPORTANT]
> **Simulated Response Only**  
> ThreatLenX does **not** connect to live enterprise endpoints, production firewalls, EDR agents, or external cloud infrastructure.
>
> All SOAR response actions (such as *Isolate Host*, *Revoke User Session*, *Block IOC IP*, or *Deploy Firewall Rule*):
> 1. Mutate only the local mock entity records in IndexedDB.
> 2. Append an entry to the local `audit_records` store.
> 3. Perform **zero** external network calls, zero live cloud API mutations, and zero host operating system shell executions.

---

## Quick Start

### Prerequisites
- **Node.js**: `>=22.13.0` (required by `package.json` engines)
- **Package Manager**: `npm` (v10+ recommended)
- **Browser**: Modern Chromium-based browser (Chrome, Edge, Brave), Firefox, or Safari with WebGL2 and modern CSS support.

### Installation & Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aadi3006/ThreatLenX.git
   cd ThreatLenX
   ```

2. **Install dependencies cleanly:**
   ```bash
   npm ci
   ```

3. **Start the local development server:**
   ```bash
   npm run dev
   ```

4. **Access the application:**
   Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## Actual Build, Lint & Verification Commands

These commands reflect the actual scripts defined in [package.json](package.json) and standard repository workflows:

| Workflow | Command | Tool / Description |
| :--- | :--- | :--- |
| **Development** | `npm run dev` | Runs the `vinext dev` local development server on port 3000. |
| **Edge / Vinext Build** | `npm run build` | Compiles the full application using `vinext build`. |
| **Production SPA Build** | `npm run build:vercel` | Compiles a standalone static SPA bundle to `dist/vercel` using Vite. |
| **SPA Preview** | `npx vite preview dist/vercel` | Locally previews the generated static SPA distribution. |
| **Type Check** | `npx tsc --noEmit` | Runs the TypeScript compiler; verifies 0 type errors across the project. |
| **Lint** | `npm run lint` | Runs `oxlint`. *(Note: currently reports active lint violations in draft modules).* |
| **Format** | `npm run format` | Runs `oxfmt` to format files according to repository conventions. |
| **Tests** | *(No `npm test` script)* | Automated domain test scripts are located in [scripts/](scripts/) (e.g. `scripts/test-step9-detection-engineering.ts`). |

---

## Repository Structure

```
ThreatLenX/
├── app/
│   ├── core/                           # Offline-first security core & data layer
│   │   ├── auth/                       # RBAC permissions & session management
│   │   ├── bootstrap.ts                # Application initialization & IndexedDB seeding
│   │   ├── data/                       # Seed incident, event, and playbook data
│   │   ├── hunting/                    # Threat hunting query & hypothesis engine
│   │   ├── models/                     # TypeScript entity schemas (Incident, IOC, Case, etc.)
│   │   ├── providers/                  # Provider interfaces & LocalProvider
│   │   ├── response/                   # SOAR playbook engine & action catalog
│   │   ├── security/                   # Detection, correlation, and evidence crypto engines
│   │   ├── security-service.ts         # Singleton security service gateway
│   │   ├── simulation/                 # Local defensive scenario generator
│   │   ├── storage/                    # Typed IndexedDB wrapper (idb-store.ts)
│   │   └── wazuh/                      # Wazuh SIEM schema normalizers and mock fixtures
│   │
│   ├── spatial/                        # SOC operational workspace modules
│   │   ├── cases/                      # Case management workspace
│   │   ├── command/                    # Command center workspace
│   │   ├── detection/                  # Detection engineering & rule authoring studio
│   │   ├── evidence/                   # Evidence vault & chain of custody
│   │   ├── hub/                        # Central Spatial Command Hub (navigation ring)
│   │   ├── hunting/                    # Threat hunting workspace
│   │   ├── incident-universe/          # Spatial incident graph & node layout
│   │   ├── investigation/              # Multi-panel incident investigation hub
│   │   ├── response/                   # Containment playbook canvas & audit stream
│   │   └── state/                      # Shared workspace navigation and spatial hooks
│   │
│   ├── cyber-audio.ts                  # Synthesized procedural Web Audio feedback
│   ├── globals.css                     # Base styling, theme variables, and HUD layouts
│   ├── page.tsx                        # Master entry point mounting SocSpatialWrapper
│   └── soc-spatial.tsx                 # Workspace stage router and layout coordinator
│
├── components/                         # Reusable UI primitives (buttons, dialogs, inputs)
├── docs/                               # Architecture audit notes and implementation specs
├── public/                             # Static public web assets
├── scripts/                            # Verification, test suites, and maintenance scripts
├── package.json                        # Dependencies, engines, and npm scripts
├── tsconfig.json                       # TypeScript compiler configuration
├── vite.config.ts                      # Primary Vite configuration
└── vite.vercel.config.ts               # Standalone SPA Vite build configuration
```

---

## Attribution & Prior Art

- **Historical Foundations**: ThreatLenX evolved from early experimental spatial UI explorations (originally influenced by foundational interface concepts in [ashemag/model-x-studio](https://github.com/ashemag/model-x-studio) and visual HUD inspirations from [Higgsfield AI](https://higgsfield.ai)).
- **Evolution**: The codebase has since been refactored and re-architected into a dedicated, offline-first cybersecurity operations and threat investigation platform.
- **Notice**: ThreatLenX is an independent research and educational prototype.

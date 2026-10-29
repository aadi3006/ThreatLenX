/**
 * investigation-state.ts
 *
 * Pure types for the Investigation Layer.
 *
 * Separation of concerns:
 *   A. Canonical security data     → comes from SecurityService, stored in InvestigationContext
 *   B. Derived investigation data  → selectors.ts derives from (A) on demand
 *   C. Transient spatial state     → stored in InvestigationContext, NOT persisted
 */

import type { IncidentDetail, TimelineEvent } from '../../core/models/incident';
import type { AttackGraph, AttackGraphNode, AttackGraphEdge } from '../../core/models/attack-graph';
import type { SystemRadarData, IocGraphData } from '../../core/models/spatial-structures';
import type { MitreTechniqueCoverage } from '../../core/models/mitre';
import type { Asset, SecurityUser, IOC } from '../../core/models/entity';

// ─── Investigation view modes ─────────────────────────────────────────────────

export type InvestigationView =
  | 'TIMELINE'    // Spatial timeline
  | 'ATTACK'      // Attack graph + path visualization
  | 'IOCs'        // IOC constellation
  | 'MITRE'       // MITRE ATT&CK matrix (filtered to incident)
  | 'EVIDENCE'    // Incident forensic evidence vault & chain of custody
  | 'FINDINGS'    // Correlated security findings & impact analysis
  | 'NOTES'       // Analyst commentary & investigation log
  | 'RESPONSE'    // Response Space & SOAR operational surface
  | 'SYSTEMS'     // System radar / blast radius
  | 'REPLAY';     // Attack path replay (with timeline sync)

// ─── Entity selection (cross-visualization sync) ──────────────────────────────

export type SelectedEntityType =
  | 'INCIDENT'
  | 'ASSET'
  | 'USER'
  | 'IOC'
  | 'TECHNIQUE'
  | 'TIMELINE_EVENT'
  | 'GRAPH_NODE'
  | null;

export interface SelectedEntity {
  id: string;
  type: SelectedEntityType;
}

// ─── Replay state machine ─────────────────────────────────────────────────────

export type ReplayStatus =
  | 'IDLE'
  | 'PLAYING'
  | 'PAUSED'
  | 'COMPLETED';

export interface ReplayState {
  status: ReplayStatus;
  currentStep: number;   // 0-based index into attack path nodes
  totalSteps: number;
  currentNodeId: string | null;
  currentEdgeId: string | null;
  currentTimestamp: string | null;
}

// ─── Investigation Choreography State Machine (Stage 2) ──────────────────────

export type ChoreographyPhase =
  | 'IDLE'                 // Ambient Incident Universe
  | 'PROXIMITY'            // Dwell/hover proximity
  | 'FOCUSING'             // Incident selected, expanding into focal zone
  | 'INVESTIGATION_OPEN'   // Shell loaded, framing ready
  | 'CONTEXT_BUILDING'     // Progressive construction sequence
  | 'CONTEXT_READY'        // Complete construction, interactive
  | 'REPLAYING'            // Temporal investigation replay
  | 'RESPONSE'             // Containment / SOAR execution
  | 'COLLAPSING';          // Graceful reversal to Universe

export type ConstructionSubStep =
  | 'TIMELINE_ENTRY'
  | 'ATTACK_PATH'
  | 'RADAR_SWEEP'
  | 'IOC_CONSTELLATION'
  | 'MITRE_MATRIX'
  | 'COMPLETE';

export interface ChoreographyState {
  phase: ChoreographyPhase;
  subStep: ConstructionSubStep;
  progress: number; // 0.0 to 1.0 overall
}

// ─── Attack path (reconstructed ordered sequence) ────────────────────────────

export interface AttackPathStep {
  stepIndex: number;
  nodeId: string;
  node: AttackGraphNode;
  incomingEdge?: AttackGraphEdge;
  timelineEventId?: string;     // correlated timeline event (if available)
  timestamp?: string;
  techniqueId?: string;
}

export interface ReconstructedAttackPath {
  incidentId: string;
  steps: AttackPathStep[];
  criticalEdgeIds: string[];
}

// ─── Investigation canonical data bundle ─────────────────────────────────────

export interface InvestigationData {
  incidentId: string;
  incident: IncidentDetail;
  attackGraph: AttackGraph;
  systemRadar: SystemRadarData | null;
  iocGraph: IocGraphData | null;
  mitreCoverage: MitreTechniqueCoverage[];
  allAssets: Asset[];
  allUsers: SecurityUser[];
  allIOCs: IOC[];
  attackPath: ReconstructedAttackPath;
}

// ─── Investigation context value (what consumers get) ────────────────────────

export interface InvestigationContextValue {
  // Loading
  isLoading: boolean;
  error: string | null;

  // Canonical data (A)
  data: InvestigationData | null;

  // Active view (C)
  activeView: InvestigationView;
  setActiveView: (view: InvestigationView) => void;

  // Entity selection — cross-visualization sync (C)
  selectedEntity: SelectedEntity | null;
  setSelectedEntity: (entity: SelectedEntity | null) => void;

  // Replay state (C) — throttled, NOT per-frame
  replay: ReplayState;
  replaySpeed: number;
  setReplaySpeed: (speed: number) => void;
  replayPlay: () => void;
  replayPause: () => void;
  replayReset: () => void;
  replayStepForward: () => void;
  replayStepBack: () => void;
  replayJumpTo: (stepIndex: number) => void;

  // Choreography State Machine (Stage 2)
  choreography: ChoreographyState;
  skipChoreography: () => void;
  triggerCollapse: (onComplete: () => void) => void;
}

// ─── View labels for UI ───────────────────────────────────────────────────────

export const VIEW_LABELS: Record<InvestigationView, string> = {
  TIMELINE: 'TIMELINE',
  ATTACK:   'ATTACK GRAPH',
  IOCs:     'IOC',
  MITRE:    'MITRE',
  EVIDENCE: 'EVIDENCE',
  FINDINGS: 'FINDINGS',
  NOTES:    'NOTES',
  RESPONSE: 'RESPONSE',
  SYSTEMS:  'SYSTEM RADAR',
  REPLAY:   'REPLAY',
};

export const REPLAY_INTERVAL_MS = 2500; // ms between replay steps

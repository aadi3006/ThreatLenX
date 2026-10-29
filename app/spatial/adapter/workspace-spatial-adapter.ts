/**
 * app/spatial/adapter/workspace-spatial-adapter.ts
 *
 * EXPLAIN-SEC SPATIAL SOC — STEP 12: SPATIAL PRESENTATION ADAPTER
 *
 * Workspace Spatial Presentation Adapter.
 *
 * Adapts all 10 canonical SOC workspaces into spatial environments:
 *   1. Command Center   (COMMAND)
 *   2. Investigation    (INVESTIGATION)
 *   3. Hunt             (HUNTING)
 *   4. Cases            (CASES)
 *   5. Evidence         (EVIDENCE)
 *   6. Rules            (DETECTION)
 *   7. Metrics          (METRICS)
 *   8. Range            (SIMULATION)
 *   9. SOAR             (RESPONSE)
 *   10. AI              (AI)
 *
 * Invariants:
 * 1. The security domain does NOT change.
 * 2. Canonical security state is NOT duplicated.
 * 3. 2D workflow remains 100% operational; spatial layout is a presentation view.
 * 4. Cursor, keyboard, and hand gestures converge on identical semantic workspace actions.
 */

import { spatialNavStore, NavigationLevel } from '../state/use-spatial-nav';
import { spatialTransform, SpatialMode } from '../../spatial-transform';
import { cyberAudio } from '../../cyber-audio';
import { securityService } from '../../core/security-service';
import {
  SemanticSpatialObject,
  SpatialIncident,
  SpatialAsset,
  SpatialEvidence,
  createSpatialIncident,
  createSpatialAsset,
  createSpatialEvidence,
} from './spatial-object-model';
import {
  SpatialProjectionEngine,
  spatialProjectionEngine,
  ProjectionTopology,
  ViewportDimensions,
} from './spatial-projection';

export interface SpatialWorkspaceMetadata {
  id: SpatialMode;
  title: string;
  shortLabel: string;
  description: string;
  defaultTopology: ProjectionTopology;
  azimuthAngleDeg: number; // Center orientation in 360° space (-180° to +180°)
  depthLayer: number;
}

export const WORKSPACE_SPATIAL_REGISTRY: Record<SpatialMode, SpatialWorkspaceMetadata> = {
  HUB: {
    id: "HUB" as any,
    title: "SPATIAL COMMAND HUB",
    shortLabel: "HUB",
    description: "Central situational nexus and spatial orbital layout.",
    defaultTopology: "CYLINDRICAL_360",
    azimuthAngleDeg: 0,
    depthLayer: 0,
  },
  SPATIAL: {
    id: 'SPATIAL',
    title: 'SPATIAL COMMAND HUB',
    shortLabel: 'HUB',
    description: 'Central situational nexus and spatial orbital layout.',
    defaultTopology: 'CYLINDRICAL_360',
    azimuthAngleDeg: 0,
    depthLayer: 0,
  },
  COMMAND: {
    id: 'COMMAND',
    title: 'COMMAND CENTER',
    shortLabel: 'CMD',
    description: 'Operational telemetry wall and full fleet monitoring.',
    defaultTopology: 'CURVED_POD',
    azimuthAngleDeg: -36,
    depthLayer: 1,
  },
  INVESTIGATION: {
    id: 'INVESTIGATION',
    title: 'INVESTIGATION HUB',
    shortLabel: 'INV',
    description: 'Focused forensic timeline, attack graph, and telemetry replay.',
    defaultTopology: 'PLANAR_2D',
    azimuthAngleDeg: 0,
    depthLayer: 0,
  },
  HUNTING: {
    id: 'HUNTING',
    title: 'THREAT HUNTING STUDIO',
    shortLabel: 'HUNT',
    description: 'Hypothesis-driven query construction and anomaly discovery.',
    defaultTopology: 'CURVED_POD',
    azimuthAngleDeg: 36,
    depthLayer: 1,
  },
  CASES: {
    id: 'CASES',
    title: 'CASE MANAGEMENT',
    shortLabel: 'CASE',
    description: 'Incident escalations, investigative dossiers, and ownership.',
    defaultTopology: 'CURVED_POD',
    azimuthAngleDeg: -72,
    depthLayer: 1,
  },
  EVIDENCE: {
    id: 'EVIDENCE',
    title: 'FORENSIC EVIDENCE VAULT',
    shortLabel: 'EVD',
    description: 'Cryptographically sealed artifacts and chain of custody.',
    defaultTopology: 'CURVED_POD',
    azimuthAngleDeg: 72,
    depthLayer: 1,
  },
  DETECTION: {
    id: 'DETECTION',
    title: 'DETECTION ENGINEERING',
    shortLabel: 'DET',
    description: 'Correlation rules, sigma signatures, and detection efficacy.',
    defaultTopology: 'CURVED_POD',
    azimuthAngleDeg: -108,
    depthLayer: 1,
  },
  METRICS: {
    id: 'METRICS',
    title: 'OPERATIONAL METRICS',
    shortLabel: 'MET',
    description: 'Canonical SOC KPIs, MTTD, MTTA, MTTR, and distribution telemetry.',
    defaultTopology: 'PLANAR_2D',
    azimuthAngleDeg: 108,
    depthLayer: 1,
  },
  SIMULATION: {
    id: 'SIMULATION',
    title: 'CYBER RANGE SIMULATION',
    shortLabel: 'SIM',
    description: 'Deterministic adversary attack path rehearsal and validation.',
    defaultTopology: 'CURVED_POD',
    azimuthAngleDeg: -144,
    depthLayer: 1,
  },
  RESPONSE: {
    id: 'RESPONSE',
    title: 'SOAR RESPONSE SPACE',
    shortLabel: 'SOAR',
    description: 'Playbook execution, reversible containment, and leadership approvals.',
    defaultTopology: 'PLANAR_2D',
    azimuthAngleDeg: 144,
    depthLayer: 1,
  },
  AI: {
    id: 'AI',
    title: 'OFFLINE AI ASSISTANT',
    shortLabel: 'AI',
    description: 'Contextual investigation assistant and grounded proposal synthesis.',
    defaultTopology: 'PLANAR_2D',
    azimuthAngleDeg: 180,
    depthLayer: 1,
  },
  FOCUS: {
    id: 'FOCUS',
    title: 'ISOLATED FOCUS',
    shortLabel: 'FOC',
    description: 'Zero-distraction single entity deep dive.',
    defaultTopology: 'PLANAR_2D',
    azimuthAngleDeg: 0,
    depthLayer: 0,
  },
};

export class WorkspaceSpatialAdapter {
  private activeTopology: ProjectionTopology = 'PLANAR_2D'; // 2D workflow default
  private spatialObjects: Map<string, SemanticSpatialObject> = new Map();
  private projection: SpatialProjectionEngine = spatialProjectionEngine;
  private currentFocusedId: string | null = null;
  private currentHoveredId: string | null = null;

  constructor() {}

  public getTopology(): ProjectionTopology {
    return this.activeTopology;
  }

  public setTopology(topology: ProjectionTopology): void {
    if (this.activeTopology === topology) return;
    this.activeTopology = topology;
    cyberAudio.playModeSwitch();
  }

  public togglePanoramicMode(): ProjectionTopology {
    const next = this.activeTopology === 'PLANAR_2D' ? 'CYLINDRICAL_360' : 'PLANAR_2D';
    this.setTopology(next);
    return this.activeTopology;
  }

  /**
   * Adapts canonical security domain entities into Semantic Spatial Objects.
   * Directly queries SecurityService; zero security state is stored locally.
   */
  public async synchronizeSpatialObjects(
    workspace: SpatialMode = 'INVESTIGATION',
    incidentId?: string
  ): Promise<SemanticSpatialObject[]> {
    this.spatialObjects.clear();

    try {
      const radius = 1100;

      // 1. Adapt canonical Incidents (arranged in an azimuthal ring)
      const incidents = await securityService.getIncidents();
      const activeIncidents = incidents.filter((i) => i.status !== 'CLOSED').slice(0, 10);

      activeIncidents.forEach((inc, idx) => {
        const stepAngle = (2 * Math.PI) / Math.max(1, activeIncidents.length);
        const theta = -Math.PI + idx * stepAngle;
        const sObj = createSpatialIncident(
          inc.id,
          { theta, y: 0, radius },
          () => {
            spatialNavStore.goToItem(inc.id);
            spatialTransform.setFocusedPanel(inc.id);
          },
          inc.severity
        );
        this.spatialObjects.set(sObj.id, sObj);
      });

      // 2. If in focused incident context, adapt related Assets & Evidence into midground
      if (incidentId) {
        const detail = await securityService.getIncidentById(incidentId);
        if (detail && detail.affectedAssets) {
          detail.affectedAssets.slice(0, 5).forEach((assetId, aIdx) => {
            const assetTheta = ((aIdx - 2) * 18 * Math.PI) / 180;
            const assetObj = createSpatialAsset(
              assetId,
              { theta: assetTheta, y: 180, radius: radius * 0.85 },
              () => {
                // Focus asset context
                cyberAudio.playSelect();
              }
            );
            this.spatialObjects.set(assetObj.id, assetObj);
          });
        }

        const evidence = await securityService.getEvidenceForIncident(incidentId);
        evidence.slice(0, 4).forEach((ev, eIdx) => {
          const evTheta = ((eIdx - 1.5) * 22 * Math.PI) / 180;
          const evObj = createSpatialEvidence(
            ev.id,
            { theta: evTheta, y: -180, radius: radius * 0.9 },
            () => {
              spatialNavStore.goToWorkspace('EVIDENCE');
            }
          );
          this.spatialObjects.set(evObj.id, evObj);
        });
      }
    } catch (err) {
      console.warn('[WorkspaceSpatialAdapter] Sync fallback:', err);
    }

    return Array.from(this.spatialObjects.values());
  }

  public getSpatialObjects(): SemanticSpatialObject[] {
    return Array.from(this.spatialObjects.values());
  }

  public getSpatialObject(id: string): SemanticSpatialObject | undefined {
    return this.spatialObjects.get(id);
  }

  // ─── Unified Gesture & Pointer Convergence ──────────────────────────────────

  /**
   * Evaluates pointer or hand-pointing coordinates against all spatial objects.
   * Converges mouse cursor and hand gestures to the exact same semantic hit-test.
   */
  public handlePointing(
    normalizedPoint: { x: number; y: number },
    viewport: ViewportDimensions,
    dwellProgress = 0
  ): SemanticSpatialObject | null {
    const hit = this.projection.hitTestObjects(
      normalizedPoint,
      viewport,
      Array.from(this.spatialObjects.values())
    );

    if (hit) {
      if (this.currentHoveredId !== hit.id) {
        if (this.currentHoveredId) {
          const prev = this.spatialObjects.get(this.currentHoveredId);
          if (prev) {
            prev.interactionTarget.isHovered = false;
            prev.interactionTarget.isDwelling = false;
            prev.interactionTarget.dwellProgress = 0;
          }
        }
        this.currentHoveredId = hit.id;
        cyberAudio.playHover();
      }

      hit.interactionTarget.isHovered = true;
      hit.interactionTarget.isDwelling = dwellProgress > 0;
      hit.interactionTarget.dwellProgress = dwellProgress;

      // When dwell completes: trigger semantic action
      if (dwellProgress >= 1.0) {
        this.handleSelect(hit.id);
      }
    } else if (this.currentHoveredId) {
      const prev = this.spatialObjects.get(this.currentHoveredId);
      if (prev) {
        prev.interactionTarget.isHovered = false;
        prev.interactionTarget.isDwelling = false;
        prev.interactionTarget.dwellProgress = 0;
      }
      this.currentHoveredId = null;
    }

    return hit;
  }

  /**
   * Invokes the canonical semantic action for the targeted spatial object.
   */
  public handleSelect(spatialObjectId: string): void {
    const obj = this.spatialObjects.get(spatialObjectId);
    if (!obj) return;

    cyberAudio.playSelect();
    obj.interactionTarget.isSelected = true;
    this.currentFocusedId = obj.id;

    // Dispatch the semantic action bound to the canonical entity
    obj.interactionTarget.semanticAction();
  }

  /**
   * Rotates or pans the 360° spatial camera projection.
   * Driven by two-hand gestures, palm pan, or mouse orbit.
   */
  public handleCameraDelta(deltaYawNorm: number, deltaPitchNorm: number): void {
    const cam = this.projection.getCamera();
    const newYaw = cam.yaw + deltaYawNorm * Math.PI;
    const newPitch = cam.pitch + deltaPitchNorm * (Math.PI / 2);
    this.projection.setCameraOrientation(newYaw, newPitch);
  }

  public handleCameraZoom(zoomFactor: number): void {
    const cam = this.projection.getCamera();
    this.projection.setCameraZoom(cam.zoom * zoomFactor);
  }

  public resetProjection(): void {
    this.projection.resetCamera();
    this.currentFocusedId = null;
    this.currentHoveredId = null;
  }
}

export const workspaceSpatialAdapter = new WorkspaceSpatialAdapter();

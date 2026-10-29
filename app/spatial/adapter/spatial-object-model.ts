/**
 * app/spatial/adapter/spatial-object-model.ts
 *
 * EXPLAIN-SEC SPATIAL SOC — STEP 12: SPATIAL PRESENTATION ADAPTER
 *
 * Semantic Spatial Object Model (Presentation Abstraction Layer).
 *
 * Architectural Invariants:
 * 1. The spatial layer is strictly a PRESENTATION ADAPTER.
 * 2. Canonical security state remains authoritative — NO duplicated security truth.
 * 3. Canonical entities (Incident, Asset, IOC, User, Evidence, Attack Graph, Timeline, MITRE, Response)
 *    remain unchanged in domain logic; only their spatial representation changes.
 * 4. Spatial objects maintain spatial properties (world coordinates, cylindrical coords, depth,
 *    orientation, interaction targets) and dynamically reference authoritative state.
 */

import { securityService } from '../../core/security-service';
import type { Incident, Severity } from '../../core/models/incident';
import type { Asset, SecurityUser, IOC } from '../../core/models/entity';
import type { Evidence } from '../../core/models/evidence';
import type { ResponseAction } from '../../core/models/response';

export type CanonicalEntityType =
  | 'INCIDENT'
  | 'ASSET'
  | 'IOC'
  | 'USER'
  | 'EVIDENCE'
  | 'ATTACK_GRAPH'
  | 'TIMELINE'
  | 'MITRE'
  | 'RESPONSE';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface EulerRotation {
  pitch: number; // Rotation around X (radians)
  yaw: number;   // Rotation around Y (radians)
  roll: number;  // Rotation around Z (radians)
}

/**
 * Cylindrical spatial coordinates for 360° panoramic projection.
 * theta: azimuthal angle around operator (-PI to +PI radians)
 * y: vertical elevation from horizontal plane (pixels/units)
 * radius: distance from operator center (pixels/units)
 */
export interface CylindricalCoordinates {
  theta: number;
  y: number;
  radius: number;
}

export interface InteractionTarget {
  id: string;
  label: string;
  isHovered: boolean;
  isSelected: boolean;
  isFocused: boolean;
  isDwelling: boolean;
  dwellProgress: number; // 0.0 to 1.0
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  screenRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  semanticAction: () => void;
}

/**
 * Base Semantic Spatial Object.
 * Represents any security entity or visual artifact within the 360° spatial coordinate system.
 */
export interface SemanticSpatialObject<T = any> {
  id: string;
  canonicalId: string;
  canonicalType: CanonicalEntityType;
  worldPosition: Vector3D;
  cylindricalCoords: CylindricalCoordinates;
  depth: number; // Depth layer (0: focal foreground, 1: workspace midground, 2: ambient context)
  orientation: EulerRotation;
  scale: Vector3D;
  visible: boolean;
  interactionTarget: InteractionTarget;

  /**
   * Authoritative Accessor:
   * Retrieves live canonical domain data directly from SecurityService.
   * Guaranteed: Zero duplicate state stored in the presentation layer.
   */
  getCanonicalData(): Promise<T | null>;
}

// ─── Concrete Semantic Spatial Representations ────────────────────────────────

export interface SpatialIncident extends SemanticSpatialObject<Incident> {
  canonicalType: 'INCIDENT';
  severityTier: Severity;
  ringSector: number; // 0 to 11 (clock-face 360 orientation)
}

export interface SpatialAsset extends SemanticSpatialObject<Asset> {
  canonicalType: 'ASSET';
  postureTier: 'ISOLATED' | 'COMPROMISED' | 'VULNERABLE' | 'HEALTHY';
}

export interface SpatialIOC extends SemanticSpatialObject<IOC> {
  canonicalType: 'IOC';
  iocType: string;
}

export interface SpatialUser extends SemanticSpatialObject<SecurityUser> {
  canonicalType: 'USER';
  riskScore: number;
}

export interface SpatialEvidence extends SemanticSpatialObject<Evidence> {
  canonicalType: 'EVIDENCE';
  isSealed: boolean;
}

export interface SpatialAttackGraph extends SemanticSpatialObject<any> {
  canonicalType: 'ATTACK_GRAPH';
  nodeCount: number;
  chokePointCount: number;
}

export interface SpatialTimeline extends SemanticSpatialObject<any> {
  canonicalType: 'TIMELINE';
  eventCount: number;
  timeSpanMs: number;
}

export interface SpatialMitre extends SemanticSpatialObject<any> {
  canonicalType: 'MITRE';
  activeTacticsCount: number;
}

export interface SpatialResponse extends SemanticSpatialObject<ResponseAction> {
  canonicalType: 'RESPONSE';
  lifecycleState: 'PROPOSED' | 'APPROVED' | 'EXECUTING' | 'SUCCESS' | 'FAILED';
}

// ─── Factory Helpers for Non-Duplicating Spatial Objects ───────────────────────

export function createSpatialIncident(
  incidentId: string,
  coords: CylindricalCoordinates,
  action: () => void,
  severity: Severity = 'MEDIUM'
): SpatialIncident {
  const theta = coords.theta;
  const radius = coords.radius;
  // Standard cylindrical to Cartesian conversion:
  // x = r * sin(theta), z = r * cos(theta) - r
  const x = radius * Math.sin(theta);
  const z = radius * Math.cos(theta) - radius;
  const y = coords.y;

  return {
    id: `spatial-inc-${incidentId}`,
    canonicalId: incidentId,
    canonicalType: 'INCIDENT',
    severityTier: severity,
    ringSector: Math.round(((theta + Math.PI) / (2 * Math.PI)) * 12) % 12,
    worldPosition: { x, y, z },
    cylindricalCoords: coords,
    depth: 0,
    orientation: { pitch: 0, yaw: -theta, roll: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    interactionTarget: {
      id: `target-inc-${incidentId}`,
      label: `Incident ${incidentId}`,
      isHovered: false,
      isSelected: false,
      isFocused: false,
      isDwelling: false,
      dwellProgress: 0,
      boundingBox: {
        min: [x - 140, y - 90, z - 20],
        max: [x + 140, y + 90, z + 20],
      },
      screenRect: { left: 0, top: 0, width: 280, height: 180 },
      semanticAction: action,
    },
    getCanonicalData: async () => {
      try {
        const detail = await securityService.getIncidentById(incidentId);
        return detail ? (detail as unknown as Incident) : null;
      } catch {
        return null;
      }
    },
  };
}

export function createSpatialAsset(
  assetId: string,
  coords: CylindricalCoordinates,
  action: () => void,
  posture: 'ISOLATED' | 'COMPROMISED' | 'VULNERABLE' | 'HEALTHY' = 'HEALTHY'
): SpatialAsset {
  const x = coords.radius * Math.sin(coords.theta);
  const z = coords.radius * Math.cos(coords.theta) - coords.radius;
  const y = coords.y;

  return {
    id: `spatial-asset-${assetId}`,
    canonicalId: assetId,
    canonicalType: 'ASSET',
    postureTier: posture,
    worldPosition: { x, y, z },
    cylindricalCoords: coords,
    depth: 1,
    orientation: { pitch: 0, yaw: -coords.theta, roll: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    interactionTarget: {
      id: `target-asset-${assetId}`,
      label: `Asset ${assetId}`,
      isHovered: false,
      isSelected: false,
      isFocused: false,
      isDwelling: false,
      dwellProgress: 0,
      boundingBox: {
        min: [x - 100, y - 60, z - 10],
        max: [x + 100, y + 60, z + 10],
      },
      screenRect: { left: 0, top: 0, width: 200, height: 120 },
      semanticAction: action,
    },
    getCanonicalData: async () => {
      try {
        const assets = await securityService.getAssets();
        return assets.find((a) => a.id === assetId) || null;
      } catch {
        return null;
      }
    },
  };
}

export function createSpatialEvidence(
  evidenceId: string,
  coords: CylindricalCoordinates,
  action: () => void
): SpatialEvidence {
  const x = coords.radius * Math.sin(coords.theta);
  const z = coords.radius * Math.cos(coords.theta) - coords.radius;
  const y = coords.y;

  return {
    id: `spatial-evd-${evidenceId}`,
    canonicalId: evidenceId,
    canonicalType: 'EVIDENCE',
    isSealed: true,
    worldPosition: { x, y, z },
    cylindricalCoords: coords,
    depth: 1,
    orientation: { pitch: 0, yaw: -coords.theta, roll: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    interactionTarget: {
      id: `target-evd-${evidenceId}`,
      label: `Evidence ${evidenceId}`,
      isHovered: false,
      isSelected: false,
      isFocused: false,
      isDwelling: false,
      dwellProgress: 0,
      boundingBox: {
        min: [x - 120, y - 80, z - 10],
        max: [x + 120, y + 80, z + 10],
      },
      screenRect: { left: 0, top: 0, width: 240, height: 160 },
      semanticAction: action,
    },
    getCanonicalData: async () => {
      try {
        const ev = await securityService.getEvidence();
        return ev.find((e) => e.id === evidenceId) || null;
      } catch {
        return null;
      }
    },
  };
}

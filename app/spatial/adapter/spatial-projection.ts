/**
 * app/spatial/adapter/spatial-projection.ts
 *
 * EXPLAIN-SEC SPATIAL SOC — STEP 12: SPATIAL PRESENTATION ADAPTER
 *
 * Cylindrical & Panoramic 360° Projection Engine.
 *
 * Implements the mathematical transformation pipeline:
 * Current 2D workspace
 *    ↓
 * semantic spatial objects
 *    ↓
 * world coordinates
 *    ↓
 * depth
 *    ↓
 * camera
 *    ↓
 * cylindrical/panoramic projection
 *    ↓
 * 360° environment
 *
 * Invariants:
 * 1. Pure projection mathematics — zero security state mutations.
 * 2. GPU-friendly CSS 3D transforms (`translate3d`, `rotate3d`, `scale3d`).
 * 3. Bidirectional mapping: Planar 2D ↔ World 3D ↔ Cylindrical 360° ↔ Projected Screen.
 * 4. Hit-test raycasting converges cursor and hand-pointing to identical targets.
 */

import type { Vector3D, EulerRotation, CylindricalCoordinates, SemanticSpatialObject } from './spatial-object-model';

export type ProjectionTopology = 'PLANAR_2D' | 'CURVED_POD' | 'CYLINDRICAL_360';

export interface SpatialCamera {
  position: Vector3D;
  target: Vector3D;
  fovDegrees: number;
  near: number;
  far: number;
  yaw: number;   // Azimuthal rotation (radians)
  pitch: number; // Elevation angle (radians)
  zoom: number;  // Magnification scalar
}

export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface ProjectedScreenPoint {
  x: number;      // Pixel coordinate X (from top-left)
  y: number;      // Pixel coordinate Y (from top-left)
  depthScale: number; // Perspective scale scalar
  visible: boolean;   // Inside field of view
}

export interface SpatialRay {
  origin: Vector3D;
  direction: Vector3D;
}

export class SpatialProjectionEngine {
  private defaultRadius: number = 1100; // Optimal focal depth for 360° curve (pixels)
  private camera: SpatialCamera = {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: -1100 },
    fovDegrees: 75,
    near: 10,
    far: 4000,
    yaw: 0,
    pitch: 0,
    zoom: 1.0,
  };

  constructor(cylinderRadius = 1100) {
    this.defaultRadius = cylinderRadius;
  }

  public getCamera(): SpatialCamera {
    return { ...this.camera };
  }

  public setCameraOrientation(yaw: number, pitch: number): void {
    this.camera.yaw = Math.max(-Math.PI, Math.min(Math.PI, yaw));
    this.camera.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitch));
  }

  public setCameraZoom(zoom: number): void {
    this.camera.zoom = Math.max(0.6, Math.min(2.5, zoom));
  }

  public setCameraPan(x: number, y: number): void {
    this.camera.position.x = x;
    this.camera.position.y = y;
  }

  public resetCamera(): void {
    this.camera = {
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: -this.defaultRadius },
      fovDegrees: 75,
      near: 10,
      far: 4000,
      yaw: 0,
      pitch: 0,
      zoom: 1.0,
    };
  }

  /**
   * Converts 2D workspace planar coordinate into Cylindrical 360° coordinates.
   * @param x2d Horizontal coordinate on 2D workspace canvas (-W/2 to +W/2)
   * @param y2d Vertical coordinate on 2D workspace canvas (-H/2 to +H/2)
   * @param arcRadians Total arc span for projection (e.g. 2*PI for full 360, 2*PI/3 for 120 pod)
   * @param canvasWidth Total reference width of the 2D layout canvas
   */
  public planarToCylindrical(
    x2d: number,
    y2d: number,
    arcRadians = 2 * Math.PI,
    canvasWidth = 3840,
    radius = this.defaultRadius
  ): CylindricalCoordinates {
    const normX = Math.max(-0.5, Math.min(0.5, x2d / canvasWidth));
    const theta = normX * arcRadians;
    return {
      theta,
      y: y2d,
      radius,
    };
  }

  /**
   * Converts Cylindrical coordinates to 3D Cartesian World space.
   * Standard mapping:
   * x = radius * sin(theta)
   * z = radius * cos(theta) - radius  (so theta=0 rests at z=0 relative to focal plane)
   * y = elevation
   */
  public cylindricalToWorld(coords: CylindricalCoordinates): Vector3D {
    const r = coords.radius;
    const sinT = Math.sin(coords.theta);
    const cosT = Math.cos(coords.theta);

    return {
      x: r * sinT,
      y: coords.y,
      z: r * (cosT - 1),
    };
  }

  /**
   * Converts 3D Cartesian World coordinates back to Cylindrical coordinates.
   */
  public worldToCylindrical(pos: Vector3D, radius = this.defaultRadius): CylindricalCoordinates {
    const effectiveZ = pos.z + radius;
    const theta = Math.atan2(pos.x, effectiveZ);
    const actualR = Math.hypot(pos.x, effectiveZ);

    return {
      theta,
      y: pos.y,
      radius: actualR,
    };
  }

  /**
   * Projects a 3D World point to 2D Screen pixel space through the camera frustum.
   */
  public projectWorldToScreen(
    worldPos: Vector3D,
    viewport: ViewportDimensions
  ): ProjectedScreenPoint {
    // 1. Camera translation
    const cx = worldPos.x - this.camera.position.x;
    const cy = worldPos.y - this.camera.position.y;
    const cz = worldPos.z - this.camera.position.z - this.defaultRadius;

    // 2. Camera yaw rotation (around Y axis)
    const cosYaw = Math.cos(-this.camera.yaw);
    const sinYaw = Math.sin(-this.camera.yaw);
    const rotX = cx * cosYaw - cz * sinYaw;
    const rotZ = cx * sinYaw + cz * cosYaw;

    // 3. Camera pitch rotation (around X axis)
    const cosPitch = Math.cos(-this.camera.pitch);
    const sinPitch = Math.sin(-this.camera.pitch);
    const finalY = cy * cosPitch - rotZ * sinPitch;
    const finalZ = cy * sinPitch + rotZ * cosPitch;

    // Check if behind camera
    if (finalZ >= -this.camera.near) {
      return { x: 0, y: 0, depthScale: 0, visible: false };
    }

    // Perspective divide
    const fovRad = (this.camera.fovDegrees * Math.PI) / 180;
    const fovScale = 1.0 / Math.tan(fovRad / 2.0);
    const invZ = 1.0 / -finalZ;

    const projX = rotX * invZ * fovScale * this.camera.zoom;
    const projY = finalY * invZ * fovScale * this.camera.zoom;

    // Map normalized device coordinates [-1, 1] to screen pixels [0, W], [0, H]
    const screenX = (projX * 0.5 + 0.5) * viewport.width;
    const screenY = (-projY * 0.5 + 0.5) * viewport.height;
    const depthScale = Math.max(0.2, Math.min(2.0, (this.defaultRadius / -finalZ) * this.camera.zoom));

    const isInside =
      screenX >= -100 &&
      screenX <= viewport.width + 100 &&
      screenY >= -100 &&
      screenY <= viewport.height + 100;

    return {
      x: screenX,
      y: screenY,
      depthScale,
      visible: isInside,
    };
  }

  /**
   * Generates a GPU-accelerated CSS 3D transform string for DOM-rendered spatial objects.
   * This avoids canvas re-renders and lets the browser's compositor do all visual work!
   */
  public computeCss3dTransform(
    obj: SemanticSpatialObject,
    topology: ProjectionTopology = 'CYLINDRICAL_360'
  ): string {
    if (topology === 'PLANAR_2D') {
      return `translate3d(${obj.worldPosition.x.toFixed(1)}px, ${obj.worldPosition.y.toFixed(1)}px, 0px) scale(${obj.scale.x.toFixed(3)})`;
    }

    // Cylindrical / Curved 360 projection:
    // Translate along circular arc, rotate back to face the operator
    const pos = obj.worldPosition;
    const yawDeg = (-obj.cylindricalCoords.theta * 180) / Math.PI;

    return `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, ${pos.z.toFixed(1)}px) rotateY(${yawDeg.toFixed(2)}deg) scale3d(${obj.scale.x.toFixed(3)}, ${obj.scale.y.toFixed(3)}, ${obj.scale.z.toFixed(3)})`;
  }

  /**
   * Casts a ray from normalized screen point [0..1, 0..1] into 3D world space.
   * Converges cursor mouse and hand gestures into the exact same spatial hit test.
   */
  public hitTestObjects(
    normalizedScreenPoint: { x: number; y: number },
    viewport: ViewportDimensions,
    objects: SemanticSpatialObject[]
  ): SemanticSpatialObject | null {
    const screenX = normalizedScreenPoint.x * viewport.width;
    const screenY = normalizedScreenPoint.y * viewport.height;

    let closestMatch: SemanticSpatialObject | null = null;
    let closestDistanceSq = Infinity;

    for (const obj of objects) {
      if (!obj.visible) continue;
      const proj = this.projectWorldToScreen(obj.worldPosition, viewport);
      if (!proj.visible) continue;

      const hitW = (obj.interactionTarget.screenRect.width || 240) * proj.depthScale;
      const hitH = (obj.interactionTarget.screenRect.height || 160) * proj.depthScale;

      const halfW = hitW / 2;
      const halfH = hitH / 2;

      if (
        screenX >= proj.x - halfW &&
        screenX <= proj.x + halfW &&
        screenY >= proj.y - halfH &&
        screenY <= proj.y + halfH
      ) {
        const dx = screenX - proj.x;
        const dy = screenY - proj.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < closestDistanceSq) {
          closestDistanceSq = distSq;
          closestMatch = obj;
        }
      }
    }

    return closestMatch;
  }
}

export const spatialProjectionEngine = new SpatialProjectionEngine();

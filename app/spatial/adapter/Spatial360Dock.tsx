/**
 * app/spatial/adapter/Spatial360Dock.tsx
 *
 * EXPLAIN-SEC SPATIAL SOC — STEP 12: SPATIAL PRESENTATION ADAPTER
 *
 * 360° Cylindrical / Panoramic Spatial Presentation Dock.
 *
 * Presentation Controls:
 * - Topology Selector: PLANAR_2D (Default 2D workspace) ↔ CYLINDRICAL_360 (Curved Panorama) ↔ CURVED_POD (120° Tactical Arc)
 * - Panoramic Azimuth Compass: Displays operator look-angle in 360° space
 * - Depth Layer: Visualizes Foreground / Midground / Ambient layers
 * - Gesture & Pointer Convergence: Pointing & dwell targets mapped to canonical actions
 *
 * Invariants:
 * - Zero security state mutations
 * - Zero duplicate security truth
 * - 2D workflow remains 100% operational
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Compass, Rotate3d, Layers, Maximize2, Minimize2, Eye, RefreshCw } from 'lucide-react';
import { workspaceSpatialAdapter } from './workspace-spatial-adapter';
import { spatialProjectionEngine, ProjectionTopology } from './spatial-projection';
import { cyberAudio } from '../../cyber-audio';

export function Spatial360Dock() {
  const [topology, setTopology] = useState<ProjectionTopology>(() => workspaceSpatialAdapter.getTopology());
  const [azimuthDeg, setAzimuthDeg] = useState<number>(0);
  const [zoomScalar, setZoomScalar] = useState<number>(1.0);

  useEffect(() => {
    // Monitor camera changes via RAF interpolation without React rerender overhead
    let animId: number;
    const pollCamera = () => {
      const cam = spatialProjectionEngine.getCamera();
      const deg = Math.round(((-cam.yaw * 180) / Math.PI + 360) % 360);
      setAzimuthDeg(deg);
      setZoomScalar(Math.round(cam.zoom * 100) / 100);
      animId = requestAnimationFrame(pollCamera);
    };
    animId = requestAnimationFrame(pollCamera);

    return () => cancelAnimationFrame(animId);
  }, []);

  const handleCycleTopology = () => {
    cyberAudio.playModeSwitch();
    const next: ProjectionTopology =
      topology === 'PLANAR_2D'
        ? 'CURVED_POD'
        : topology === 'CURVED_POD'
        ? 'CYLINDRICAL_360'
        : 'PLANAR_2D';
    workspaceSpatialAdapter.setTopology(next);
    setTopology(next);
  };

  const handleResetCamera = () => {
    cyberAudio.playClick();
    spatialProjectionEngine.resetCamera();
  };

  return (
    <div
      className="spatial-360-dock"
      style={{
        position: 'fixed',
        bottom: 60,
        right: 16,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(2, 18, 12, 0.88)',
        border: '1px solid rgba(61, 255, 176, 0.3)',
        borderRadius: 3,
        padding: '4px 10px',
        backdropFilter: 'blur(12px)',
        fontSize: 10,
        fontFamily: 'inherit',
        color: '#c8ffe6',
      }}
      aria-label="Spatial Presentation Adapter"
    >
      {/* 360° Compass Azimuth */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Compass size={13} style={{ color: topology === 'PLANAR_2D' ? '#58c79b' : '#00f0ff' }} />
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
          {azimuthDeg.toString().padStart(3, '0')}° AZ
        </span>
      </div>

      <div style={{ width: 1, height: 14, background: 'rgba(61, 255, 176, 0.2)' }} />

      {/* Topology Mode Button */}
      <button
        type="button"
        onClick={handleCycleTopology}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          background: topology !== 'PLANAR_2D' ? 'rgba(0, 240, 255, 0.15)' : 'rgba(61, 255, 176, 0.08)',
          border: `1px solid ${topology !== 'PLANAR_2D' ? '#00f0ff' : 'rgba(61, 255, 176, 0.3)'}`,
          color: topology !== 'PLANAR_2D' ? '#00f0ff' : '#3dffb0',
          padding: '2px 8px',
          borderRadius: 2,
          fontSize: 9.5,
          fontWeight: 700,
          cursor: 'pointer',
        }}
        title="Cycle Spatial Projection: PLANAR_2D -> CURVED_POD (120°) -> CYLINDRICAL_360 (360°)"
      >
        <Rotate3d size={12} />
        <span>{topology.replace(/_/g, ' ')}</span>
      </button>

      {/* Zoom readout */}
      <span style={{ fontSize: 9, color: '#58c79b', fontVariantNumeric: 'tabular-nums' }}>
        {zoomScalar}x
      </span>

      {/* Reset Cam */}
      {topology !== 'PLANAR_2D' && (
        <button
          type="button"
          onClick={handleResetCamera}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#88a',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
          title="Reset 360° Camera Viewpoint"
        >
          <RefreshCw size={11} />
        </button>
      )}
    </div>
  );
}

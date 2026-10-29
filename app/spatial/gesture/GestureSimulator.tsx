/**
 * app/spatial/gesture/GestureSimulator.tsx
 *
 * First-Class Gesture Simulation & Interactive Testing Tool.
 *
 * Requirements:
 * 1. Feeds the exact same GestureIntent pipeline as the real MediaPipe engine.
 * 2. Directly exercises spatialController.dispatchIntent(intent, 'SIMULATOR').
 * 3. Supports all discrete and continuous spatial interactions:
 *    - Open Palm (Explode Spatial)
 *    - Fist (Collapse Command / Exit Focus)
 *    - Point + Dwell simulation at coordinates / panels
 *    - Pinch Select / Click confirmation
 *    - Two-Hand Zoom & Pan deltas
 *    - Focus Mode & UI visibility toggle
 *    - Workspace switching
 * 4. Renders clear visual feedback of simulated gesture events and provenance.
 */

'use client';
import { useState } from 'react';
import { spatialController } from '../../spatial-controller';
import { spatialTransform, SpatialMode } from '../../spatial-transform';
import { useSpatialUi } from '../state/use-spatial-ui';
import {
  Hand,
  Maximize2,
  Minimize2,
  Crosshair,
  Move,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Eye,
  Sliders,
  Layers,
  Activity,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';

export function GestureSimulator() {
  const { inputSource } = useSpatialUi();
  const [lastDispatched, setLastDispatched] = useState<string>('NONE');
  const [simHand, setSimHand] = useState<'LEFT' | 'RIGHT' | 'BOTH'>('RIGHT');

  const dispatch = (label: string, intent: Parameters<typeof spatialController.dispatchIntent>[0]) => {
    cyberAudio.playClick();
    setLastDispatched(label);
    spatialController.dispatchIntent(intent, 'SIMULATOR');
  };

  const simulatePointAtFirstIncident = () => {
    // Dispatch POINTING toward screen center where incident nodes live
    dispatch('POINTING (Screen Center)', {
      type: 'POINTING',
      pointing: {
        tip: { x: 0.5, y: 0.5 },
        dwellTimeMs: 650,
      },
    });
  };

  const simulatePointAtHubNode = () => {
    if (typeof window === 'undefined') return;
    const el = document.querySelector('.hub-workspace-node') as HTMLElement | null;
    if (el) {
      const rect = el.getBoundingClientRect();
      const normX = (rect.left + rect.width / 2) / window.innerWidth;
      const normY = (rect.top + rect.height / 2) / window.innerHeight;
      dispatch('POINT + DWELL (HUB NODE)', {
        type: 'POINTING',
        pointing: {
          tip: { x: normX, y: normY },
          dwellTimeMs: 650,
        },
      });
      return;
    }
    simulatePointAtFirstIncident();
  };

  const simulatePinchClickCenter = () => {
    dispatch('PINCH_SELECT (Center)', {
      type: 'PINCH_SELECT',
      point: { x: 0.5, y: 0.5 },
    });
  };

  const simulateTwoHandZoom = (ratio: number) => {
    dispatch(`TWO_HAND ZOOM (${ratio > 1 ? 'IN' : 'OUT'})`, {
      type: 'SPATIAL_TRANSFORM',
      transform: {
        midpoint: { x: 0.5, y: 0.5 },
        deltaPan: { x: 0, y: 0 },
        distance: ratio,
        zoomRatio: ratio,
        angle: 0,
        deltaAngle: 0,
      },
    });
  };

  const simulateTwoHandPan = (dx: number, dy: number, dir: string) => {
    dispatch(`TWO_HAND PAN (${dir})`, {
      type: 'SPATIAL_TRANSFORM',
      transform: {
        midpoint: { x: 0.5, y: 0.5 },
        deltaPan: { x: dx, y: dy },
        distance: 1.0,
        zoomRatio: 1.0,
        angle: 0,
        deltaAngle: 0,
      },
    });
  };

  return (
    <div className="gesture-simulator-panel" aria-label="Gesture Simulation Harness">
      <div className="sim-header-row">
        <div className="sim-title">
          <Sparkles size={12} className="text-cyan" />
          <span>GESTURE SIMULATOR [FIRST-CLASS HARNESS]</span>
        </div>
        <div className={`sim-source-tag ${inputSource === 'SIMULATOR' ? 'is-sim' : 'is-real'}`}>
          {inputSource === 'SIMULATOR' ? '● SIMULATOR ACTIVE' : '○ VISION STANDBY'}
        </div>
      </div>

      <div className="sim-status-strip">
        <span className="sim-status-label">LAST INTENT:</span>
        <strong className="sim-status-value">{lastDispatched}</strong>
      </div>

      <div className="sim-grid">
        {/* Core Discrete Gestures */}
        <div className="sim-group">
          <span className="sim-group-label">DISCRETE ENGINE GESTURES</span>
          <div className="sim-btn-row">
            <button
              className="sim-btn"
              onClick={() => dispatch('OPEN_PALM -> SPATIAL HUB', { type: 'MODE_EXPLODE_SPATIAL' })}
              title="Simulates Open Palm held for 280ms -> Return to Central Spatial Command Hub"
            >
              <Maximize2 size={11} />
              <span>OPEN PALM (HUB)</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('FIST -> SPATIAL HUB', { type: 'MODE_COLLAPSE_COMMAND' })}
              title="Simulates Fist held for 280ms -> Return to Central Spatial Command Hub"
            >
              <Minimize2 size={11} />
              <span>FIST (HUB)</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('FIST -> EXIT FOCUS', { type: 'EXIT_FOCUS' })}
              title="Simulates Fist held while in Focus -> Return to Central Spatial Command Hub"
            >
              <RotateCcw size={11} />
              <span>EXIT FOCUS</span>
            </button>
          </div>
        </div>

        {/* Hand Identity Simulation */}
        <div className="sim-group">
          <span className="sim-group-label">SIMULATED HAND IDENTITY</span>
          <div className="sim-btn-row">
            <button
              className={`sim-btn ${simHand === 'LEFT' ? 'active' : ''}`}
              onClick={() => {
                setSimHand('LEFT');
                dispatch('HAND IDENTITY: LEFT', { type: 'PROXIMITY', center: { x: 0.35, y: 0.5 }, handsDetected: 1 });
              }}
              title="Simulate Physical Left Hand"
            >
              <span>LEFT HAND</span>
            </button>
            <button
              className={`sim-btn ${simHand === 'RIGHT' ? 'active' : ''}`}
              onClick={() => {
                setSimHand('RIGHT');
                dispatch('HAND IDENTITY: RIGHT', { type: 'PROXIMITY', center: { x: 0.65, y: 0.5 }, handsDetected: 1 });
              }}
              title="Simulate Physical Right Hand"
            >
              <span>RIGHT HAND</span>
            </button>
            <button
              className={`sim-btn ${simHand === 'BOTH' ? 'active' : ''}`}
              onClick={() => {
                setSimHand('BOTH');
                dispatch('HAND IDENTITY: BOTH', { type: 'PROXIMITY', center: { x: 0.5, y: 0.5 }, handsDetected: 2 });
              }}
              title="Simulate Both Hands (Left + Right)"
            >
              <span>BOTH HANDS</span>
            </button>
          </div>
        </div>

        {/* Reticle, Pointing & Pinch */}
        <div className="sim-group">
          <span className="sim-group-label">RETICLE & INTERACTION</span>
          <div className="sim-btn-row">
            <button
              className="sim-btn"
              onClick={simulatePointAtFirstIncident}
              title="Simulates Index Pointing + Dwell at center target (650ms dwell)"
            >
              <Crosshair size={11} />
              <span>POINT + DWELL</span>
            </button>

            <button
              className="sim-btn"
              onClick={simulatePointAtHubNode}
              title="Simulates Index Pointing + Dwell at Spatial Command Hub workspace node"
            >
              <Crosshair size={11} color="#00f0ff" />
              <span>DWELL HUB</span>
            </button>

            <button
              className="sim-btn"
              onClick={simulatePinchClickCenter}
              title="Simulates Pinch Click at current target"
            >
              <Hand size={11} />
              <span>PINCH CLICK</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('POINTING_RELEASED', { type: 'POINTING_RELEASED' })}
              title="Simulates releasing pointing finger (resets reticle)"
            >
              <RotateCcw size={11} />
              <span>RELEASE POINT</span>
            </button>
          </div>
        </div>

        {/* Spatial Transforms (Two-Hand) */}
        <div className="sim-group">
          <span className="sim-group-label">TWO-HAND SPATIAL TRANSFORMS</span>
          <div className="sim-btn-row">
            <button
              className="sim-btn"
              onClick={() => simulateTwoHandZoom(1.15)}
              title="Simulates Two-Hand Spread (Zoom In)"
            >
              <ZoomIn size={11} />
              <span>ZOOM +</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => simulateTwoHandZoom(0.85)}
              title="Simulates Two-Hand Pinch (Zoom Out)"
            >
              <ZoomOut size={11} />
              <span>ZOOM -</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => simulateTwoHandPan(-40, 0, 'LEFT')}
              title="Simulates Two-Hand Pan Left"
            >
              <Move size={11} />
              <span>PAN ←</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => simulateTwoHandPan(40, 0, 'RIGHT')}
              title="Simulates Two-Hand Pan Right"
            >
              <Move size={11} />
              <span>PAN →</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('RESET_VIEW', { type: 'RESET_VIEW' })}
              title="Simulates Reset View gesture"
            >
              <RotateCcw size={11} />
              <span>RESET</span>
            </button>
          </div>
        </div>

        {/* UI & Dock Controls */}
        <div className="sim-group">
          <span className="sim-group-label">UI MANAGEMENT INTENTS</span>
          <div className="sim-btn-row">
            <button
              className="sim-btn highlight"
              onClick={() => dispatch('TOGGLE_UI', { type: 'TOGGLE_UI' })}
              title="Simulates UI Hide/Show intent"
            >
              <Eye size={11} />
              <span>TOGGLE UI</span>
            </button>

            <button
              className="sim-btn highlight"
              onClick={() => dispatch('TOGGLE_FOCUS_MODE', { type: 'TOGGLE_FOCUS_MODE' })}
              title="Simulates Focus Mode intent"
            >
              <Layers size={11} />
              <span>FOCUS MODE</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('TOGGLE LEFT DOCK', { type: 'TOGGLE_PANEL', panel: 'left' })}
              title="Simulates Left Dock toggle intent"
            >
              <Sliders size={11} />
              <span>LEFT DOCK</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('TOGGLE RIGHT DOCK', { type: 'TOGGLE_PANEL', panel: 'right' })}
              title="Simulates Right Dock toggle intent"
            >
              <Sliders size={11} />
              <span>RIGHT DOCK</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('TOGGLE BOTTOM TELEMETRY', { type: 'TOGGLE_PANEL', panel: 'bottom' })}
              title="Simulates Bottom Telemetry toggle intent"
            >
              <Activity size={11} />
              <span>BOTTOM TELEMETRY</span>
            </button>
          </div>
        </div>

        {/* Spatial Panel & Drill-Down Navigation (Phase F) */}
        <div className="sim-group">
          <span className="sim-group-label">SPATIAL PANEL & BACK NAVIGATION</span>
          <div className="sim-btn-row">
            <button
              className="sim-btn highlight"
              onClick={() => dispatch('NAVIGATE_BACK (ESC)', { type: 'NAVIGATE_BACK' })}
              title="Navigate back one level: Panel -> Item -> Incident List -> Hub [ESC]"
            >
              <ArrowLeft size={11} />
              <span>BACK [ESC]</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('PREVIOUS_PANEL (←)', { type: 'PREVIOUS_PANEL' })}
              title="Cycle to previous panel: e.g. ATTACK -> TIMELINE [Arrow Left / ←]"
            >
              <ChevronLeft size={11} />
              <span>PREV [←]</span>
            </button>

            <button
              className="sim-btn"
              onClick={() => dispatch('NEXT_PANEL (→)', { type: 'NEXT_PANEL' })}
              title="Cycle to next panel: e.g. TIMELINE -> ATTACK GRAPH [Arrow Right / →]"
            >
              <ChevronRight size={11} />
              <span>NEXT [→]</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

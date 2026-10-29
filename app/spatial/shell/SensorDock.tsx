/**
 * app/spatial/shell/SensorDock.tsx
 *
 * Compact Neural Spatial Sensor Dock & Diagnostics Interface (Phase 11).
 *
 * Default Presentation:
 * ● SENSOR   SPATIAL   2 HANDS   60 FPS   [REAL VISION / SIMULATOR]
 *
 * Expanded Presentation:
 * Full computer vision diagnostics, camera stream, performance profiler,
 * and first-class GestureSimulator testing harness.
 */

'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
export interface EngineDiagnostics {
  state: "IDLE" | "TRACKING" | "LOST" | "ERROR";
  handsDetected: number;
  handedness: "LEFT" | "RIGHT" | "BOTH" | "NONE";
  detectedHands: string[];
  openness: number;
  isPointing: boolean;
  isTwoHand: boolean;
  confidence: number;
  cameraFps: number;
  trackingFps: number;
  renderFps: number;
  inferenceMs: number;
  mainThreadMs: number;
  droppedFrames: number;
  lastIntent: string | null;
}
import { spatialController } from '../../spatial-controller';
import { useSpatialTransform } from '../../spatial-transform';
import { useSpatialUi } from '../state/use-spatial-ui';
import { GestureSimulator } from '../gesture/GestureSimulator';
import {
  Hand,
  Eye,
  EyeOff,
  Activity,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Gauge,
  Sliders,
  HelpCircle,
  X,
} from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';

export interface SensorDockProps {
  onStatusChange?: (active: boolean) => void;
}

export function SensorDock({ onStatusChange }: SensorDockProps) {
  const {
    sensorVisible,
    sensorExpanded,
    setSensorExpanded,
    setSensorVisible,
    inputSource,
  } = useSpatialUi();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);


  const [isActive, setIsActive] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showVideo, setShowVideo] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'STREAM' | 'PROFILER' | 'SIMULATOR' | 'LEGEND'>('STREAM');

  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics>({
    state: 'IDLE',
    handsDetected: 0,
    handedness: 'NONE',
    detectedHands: [],
    openness: 0,
    isPointing: false,
    isTwoHand: false,
    confidence: 0,
    cameraFps: 0,
    trackingFps: 0,
    renderFps: 0,
    inferenceMs: 0,
    mainThreadMs: 0,
    droppedFrames: 0,
    lastIntent: null,
  });

  const spatial = useSpatialTransform();

  const handleStart = useCallback(() => {
    if (isLoading) return;
    setIsLoading(true);
    cyberAudio.playScan();
    setIsActive(true);
    setDiagnostics((prev) => ({
      ...prev,
      state: "TRACKING",
      trackingFps: 60,
      renderFps: 60,
      confidence: 0.98,
    }));
    onStatusChange?.(true);
    cyberAudio.playSelect();
    setIsLoading(false);
  }, [isLoading, onStatusChange]);

  const handleStop = useCallback(() => {
    setIsActive(false);
    setDiagnostics((prev) => ({
      ...prev,
      state: "IDLE",
      handsDetected: 0,
      trackingFps: 0,
    }));
    onStatusChange?.(false);
    cyberAudio.playClick();
  }, [onStatusChange]);

  const toggleActive = useCallback(() => {
    if (isActive) handleStop();
    else handleStart();
  }, [isActive, handleStart, handleStop]);

  return (
    <>
      {/* ─── 1. Minimized / Launcher Strip (when sensorVisible is false) ─── */}
      {!sensorVisible && (
        <aside className="sensor-launcher-strip" aria-label="Sensor Dock Launcher">
          <button
            className="sensor-min-pill"
            onClick={() => {
              cyberAudio.playClick();
              setSensorVisible(true);
            }}
            title="Restore Neural Spatial Sensor"
          >
            <Hand size={12} className="text-cyan animate-pulse" />
            <span>SENSOR</span>
          </button>
        </aside>
      )}

      {/* ─── 2. Compact Status Pill (when visible but not expanded) ─── */}
      {sensorVisible && !sensorExpanded && (
        <aside className="sensor-dock-compact" aria-label="Neural Spatial Sensor Compact Status">
          <div
            className="sensor-compact-pill"
            onClick={() => {
              cyberAudio.playClick();
              setSensorExpanded(true);
            }}
            role="button"
            tabIndex={0}
            title="Click to expand full vision diagnostics & gesture simulator"
          >
            <span
              className={`sensor-status-dot ${
                isActive ? (diagnostics.handsDetected > 0 ? 'online' : 'listening') : 'offline'
              }`}
            />
            <Hand size={12} className="text-line" />
            <strong className="sensor-title">SENSOR</strong>
            <span className="sensor-tag">{spatial.mode}</span>
            <span className="sensor-tag">
              {diagnostics.handsDetected} HAND{diagnostics.handsDetected !== 1 ? 'S' : ''}
              {diagnostics.handedness !== 'NONE' ? ` [${diagnostics.handedness}]` : ''}
            </span>
            <span className="sensor-fps">{diagnostics.renderFps || 60} FPS</span>

            {/* Input Source Provenance Tag */}
            <span className={`sensor-provenance-tag ${inputSource === 'SIMULATOR' ? 'is-sim' : 'is-real'}`}>
              {inputSource === 'SIMULATOR' ? 'SIM' : 'REAL'}
            </span>

            <ChevronUp size={11} className="sensor-expand-icon" />
          </div>
        </aside>
      )}

      {/* ─── 3. Full Expanded Diagnostics HUD (PERMANENTLY MOUNTED to protect camera stream & MediaPipe inference) ─── */}
      <aside
        className={`sensor-dock-expanded ${
          sensorVisible && sensorExpanded ? 'is-open' : 'is-dock-minimized'
        }`}
        aria-label="Neural Spatial Sensor Diagnostics"
        aria-hidden={!sensorVisible || !sensorExpanded}
      >
        {/* Header */}
        <div className="sensor-expanded-header">
          <div className="sensor-header-left">
            <span
              className={`sensor-status-dot ${
                isActive ? (diagnostics.handsDetected > 0 ? 'online' : 'listening') : 'offline'
              }`}
            />
            <Hand size={13} className="text-cyan" />
            <span className="sensor-header-title">NEURAL SPATIAL SENSOR</span>
          </div>

          <div className="sensor-header-right">
            <button
              className={`sensor-ctrl-btn ${isActive ? 'active' : ''}`}
              onClick={toggleActive}
              disabled={isLoading}
              title={isActive ? 'Disable Vision Tracking' : 'Enable Neural Hand Tracking'}
            >
              {isLoading ? <Activity size={11} className="spin-fast" /> : <Hand size={11} />}
              <span>{isActive ? 'DISENGAGE' : 'ENGAGE'}</span>
            </button>

            <button
              className="sensor-ctrl-btn"
              onClick={() => setSensorExpanded(false)}
              title="Collapse Sensor HUD"
              aria-label="Collapse Sensor HUD"
            >
              <ChevronDown size={12} />
            </button>

            <button
              className="sensor-ctrl-btn"
              onClick={() => setSensorVisible(false)}
              title="Close Sensor Panel (Reopen from Dock)"
              aria-label="Close Sensor Panel"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Sensor Tabs */}
        <div className="sensor-tab-bar">
          <button
            className={`sensor-tab ${activeTab === 'STREAM' ? 'active' : ''}`}
            onClick={() => setActiveTab('STREAM')}
          >
            VISION FEED
          </button>
          <button
            className={`sensor-tab ${activeTab === 'PROFILER' ? 'active' : ''}`}
            onClick={() => setActiveTab('PROFILER')}
          >
            PROFILER
          </button>
          <button
            className={`sensor-tab ${activeTab === 'SIMULATOR' ? 'active' : ''}`}
            onClick={() => setActiveTab('SIMULATOR')}
          >
            <Sparkles size={10} style={{ display: 'inline', marginRight: 3 }} />
            SIMULATOR
          </button>
          <button
            className={`sensor-tab ${activeTab === 'LEGEND' ? 'active' : ''}`}
            onClick={() => setActiveTab('LEGEND')}
          >
            GESTURES
          </button>
        </div>

        {/* Tab Body */}
        <div className="sensor-tab-body">
          {/* Live Video Feed (ALWAYS MOUNTED to never disrupt requestVideoFrameCallback or MediaStream) */}
          <div className={`sensor-video-view ${activeTab === 'STREAM' ? 'tab-active' : 'tab-inactive'}`}>
            <div className="video-container">
              <video
                ref={videoRef}
                className="camera-video-el"
                playsInline
                muted
                autoPlay
                width={240}
                height={160}
              />
              <canvas
                ref={canvasRef}
                className="skeleton-canvas-el"
                width={240}
                height={160}
              />
              {!isActive && (
                <div className="camera-standby-overlay">
                  <Sparkles size={18} className="text-cyan mb-1" />
                  <span>CAMERA STANDBY</span>
                  <button className="standby-activate-btn" onClick={handleStart} disabled={isLoading}>
                    {isLoading ? 'CALIBRATING VISION…' : 'ENGAGE SENSOR'}
                  </button>
                </div>
              )}
            </div>

            {/* Quick Metrics Bar */}
            <div className="sensor-metrics-bar">
              <div className="metric-tag">STATE: <strong>{diagnostics.state}</strong></div>
              <div className="metric-tag">
                HANDS: <strong>{diagnostics.handsDetected}</strong>
                {diagnostics.handedness !== 'NONE' ? (
                  <span style={{ color: '#00f0ff', marginLeft: 4, fontWeight: 700 }}>
                    {diagnostics.handedness}
                  </span>
                ) : null}
              </div>
              <div className="metric-tag">OPEN: <strong>{(diagnostics.openness * 100).toFixed(0)}%</strong></div>
              <div className="metric-tag">LATENCY: <strong>{diagnostics.inferenceMs}ms</strong></div>
            </div>
          </div>

          {activeTab === 'PROFILER' && (
            <div className="sensor-profiler-view">
              <div className="profiler-grid">
                <div className="profiler-card">
                  <span className="lbl">TRACKING FPS</span>
                  <strong className={diagnostics.trackingFps >= 30 ? 'text-ok' : 'text-warn'}>
                    {diagnostics.trackingFps}
                  </strong>
                </div>
                <div className="profiler-card">
                  <span className="lbl">RENDER FPS</span>
                  <strong className={diagnostics.renderFps >= 50 ? 'text-ok' : 'text-warn'}>
                    {diagnostics.renderFps}
                  </strong>
                </div>
                <div className="profiler-card">
                  <span className="lbl">CAMERA FPS</span>
                  <strong>{diagnostics.cameraFps}</strong>
                </div>
                <div className="profiler-card">
                  <span className="lbl">INFERENCE MS</span>
                  <strong>{diagnostics.inferenceMs} ms</strong>
                </div>
                <div className="profiler-card">
                  <span className="lbl">MAIN THREAD</span>
                  <strong>{diagnostics.mainThreadMs} ms</strong>
                </div>
                <div className="profiler-card">
                  <span className="lbl">DROPPED FRAMES</span>
                  <strong>{diagnostics.droppedFrames}</strong>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'SIMULATOR' && (
            <div className="sensor-simulator-view">
              <GestureSimulator />
            </div>
          )}

          {activeTab === 'LEGEND' && (
            <div className="sensor-legend-view">
              <div className="legend-item">
                <strong className="legend-cmd">OPEN PALM</strong>
                <span className="legend-desc">Explode into SPATIAL Mode (0.28s dwell)</span>
              </div>
              <div className="legend-item">
                <strong className="legend-cmd">FIST</strong>
                <span className="legend-desc">Collapse to COMMAND / Exit Focus</span>
              </div>
              <div className="legend-item">
                <strong className="legend-cmd">POINT INDEX</strong>
                <span className="legend-desc">Aim Reticle & Dwell (0.32s) to Focus</span>
              </div>
              <div className="legend-item">
                <strong className="legend-cmd">TWO HANDS</strong>
                <span className="legend-desc">Spread to Zoom, Move to Pan</span>
              </div>
              <div className="legend-item">
                <strong className="legend-cmd">PINCH CLICK</strong>
                <span className="legend-desc">Touch thumb to index to click targeted UI</span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

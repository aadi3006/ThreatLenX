/**
 * app/spatial/hub/SpatialCommandHub.tsx
 *
 * Central Spatial Command Hub.
 *
 * One central cybersecurity hub visually connected to six primary SOC operational zones:
 * 1. Command Center
 * 2. Incident Investigation
 * 3. Threat Hunting
 * 4. Cases
 * 5. Evidence Vault
 * 6. Detection Rules
 */

'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Minimize2,
  Activity,
  Crosshair,
  Briefcase,
  FileCheck,
  Sliders,
} from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';
import type { PerformanceMode } from '../performance-mode';
import './spatial-command-hub.css';

export type SpatialHubZone =
  | 'COMMAND'
  | 'INVESTIGATION'
  | 'HUNTING'
  | 'CASES'
  | 'EVIDENCE'
  | 'DETECTION';

export interface SpatialCommandHubProps {
  perfMode: PerformanceMode;
  activeIncidentId: string | null;
  onNavigateZone: (zone: SpatialHubZone) => void;
  onRegisterPanel?: (id: string, el: HTMLElement | null) => void;
}

interface ZoneDestinationConfig {
  id: SpatialHubZone;
  title: string;
  sublabel: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
  badge?: string;
  angleDeg: number;
  ringScale: number;
  onExecute: () => void;
}

export function SpatialCommandHub({
  perfMode,
  activeIncidentId,
  onNavigateZone,
  onRegisterPanel,
}: SpatialCommandHubProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Dynamic canvas dimension tracking
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? Math.max(900, window.innerWidth - 64) : 1200,
    height: typeof window !== 'undefined' ? Math.max(550, window.innerHeight - 80) : 700,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        setDimensions({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };

    measure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 50 && height > 50) {
            setDimensions({
              width: Math.round(width),
              height: Math.round(height),
            });
          }
        }
      });
      ro.observe(el);
    }

    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // 6 Primary Symmetrical Operational Zones
  const destinations: ZoneDestinationConfig[] = useMemo(() => [
    {
      id: 'COMMAND',
      title: 'COMMAND CENTER',
      sublabel: 'INCIDENTS & POSTURE',
      icon: Minimize2,
      color: '#00f0ff',
      badge: 'F',
      angleDeg: 270, // 12 o'clock (Top)
      ringScale: 0.92,
      onExecute: () => onNavigateZone('COMMAND'),
    },
    {
      id: 'INVESTIGATION',
      title: 'INCIDENT INVESTIGATION',
      sublabel: 'ATTACK GRAPH & TIMELINE',
      icon: Activity,
      color: '#3dffb0',
      badge: activeIncidentId ? activeIncidentId.slice(0, 8).toUpperCase() : 'ACTIVE',
      angleDeg: 330, // 2 o'clock (Top-Right)
      ringScale: 1.0,
      onExecute: () => onNavigateZone('INVESTIGATION'),
    },
    {
      id: 'HUNTING',
      title: 'THREAT HUNTING',
      sublabel: 'HYPOTHESIS & QUERIES',
      icon: Crosshair,
      color: '#00f0ff',
      badge: 'H',
      angleDeg: 30, // 4 o'clock (Bottom-Right)
      ringScale: 0.92,
      onExecute: () => onNavigateZone('HUNTING'),
    },
    {
      id: 'CASES',
      title: 'CASE MANAGEMENT',
      sublabel: 'INCIDENT DOSSIERS',
      icon: Briefcase,
      color: '#00f0ff',
      badge: 'C',
      angleDeg: 90, // 6 o'clock (Bottom)
      ringScale: 0.92,
      onExecute: () => onNavigateZone('CASES'),
    },
    {
      id: 'EVIDENCE',
      title: 'EVIDENCE VAULT',
      sublabel: 'CHAIN OF CUSTODY',
      icon: FileCheck,
      color: '#3dffb0',
      badge: 'E',
      angleDeg: 150, // 8 o'clock (Bottom-Left)
      ringScale: 1.0,
      onExecute: () => onNavigateZone('EVIDENCE'),
    },
    {
      id: 'DETECTION',
      title: 'DETECTION RULES',
      sublabel: 'YARA-L RULES ENGINE',
      icon: Sliders,
      color: '#3dffb0',
      badge: 'D',
      angleDeg: 210, // 10 o'clock (Top-Left)
      ringScale: 1.0,
      onExecute: () => onNavigateZone('DETECTION'),
    },
  ], [activeIncidentId, onNavigateZone]);

  // Deterministic, Non-Colliding Orbital Layout
  const layout = useMemo(() => {
    const { width: W, height: H } = dimensions;

    const padX = 70;
    const padTop = 40;
    const padBottom = 55;

    const minX = padX;
    const maxX = Math.max(minX + 200, W - padX);
    const minY = padTop;
    const maxY = Math.max(minY + 150, H - padBottom);

    const cx = W / 2;
    const cy = H / 2;

    const spanX = Math.max(120, (maxX - minX) / 2);
    const spanY = Math.max(100, (maxY - minY) / 2);

    const baseRx = Math.min(spanX * 0.86, 460);
    const baseRy = Math.min(spanY * 0.76, 280);

    const sphereRadius = Math.max(50, Math.min(85, Math.min(baseRx, baseRy) * 0.38));
    const minCenterDistance = sphereRadius + 50;

    const halfNodeW = 75;
    const halfNodeH = 20;

    const nodes = destinations.map((dest) => {
      const rad = (dest.angleDeg * Math.PI) / 180;
      const rScale = dest.ringScale ?? 0.95;

      const rawX = cx + Math.cos(rad) * baseRx * rScale;
      const rawY = cy + Math.sin(rad) * baseRy * rScale;

      let x = Math.max(minX + halfNodeW, Math.min(maxX - halfNodeW, rawX));
      let y = Math.max(minY + halfNodeH, Math.min(maxY - halfNodeH, rawY));

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minCenterDistance && dist > 0.001) {
        const factor = minCenterDistance / dist;
        x = cx + dx * factor;
        y = cy + dy * factor;
      }

      return {
        ...dest,
        x: Math.round(x),
        y: Math.round(y),
      };
    });

    return {
      cx: Math.round(cx),
      cy: Math.round(cy),
      baseRx: Math.round(baseRx),
      baseRy: Math.round(baseRy),
      sphereRadius: Math.round(sphereRadius),
      nodes,
    };
  }, [dimensions, destinations]);

  // Register nodes with controller for hit-testing
  useEffect(() => {
    destinations.forEach((dest) => {
      const el = nodeRefs.current.get(dest.id);
      if (el && onRegisterPanel) {
        onRegisterPanel(`hub-${dest.id.toLowerCase()}`, el);
      }
    });

    return () => {
      destinations.forEach((dest) => {
        if (onRegisterPanel) {
          onRegisterPanel(`hub-${dest.id.toLowerCase()}`, null);
        }
      });
    };
  }, [destinations, onRegisterPanel, layout]);

  // Execute zone transition
  const isTransitioningRef = useRef(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const executeTransition = useCallback((dest: ZoneDestinationConfig) => {
    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;
    cyberAudio.playSelect();
    setTransitioningId(dest.id);

    transitionTimerRef.current = setTimeout(() => {
      dest.onExecute();
      setTransitioningId(null);
      isTransitioningRef.current = false;
    }, 240);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'Tab':
          e.preventDefault();
          cyberAudio.playClick();
          setFocusedIndex((prev) => (prev + 1) % destinations.length);
          break;

        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          cyberAudio.playClick();
          setFocusedIndex((prev) => (prev - 1 + destinations.length) % destinations.length);
          break;

        case 'Enter':
        case ' ':
          e.preventDefault();
          const target = destinations[focusedIndex];
          if (target) executeTransition(target);
          break;

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6': {
          const idx = parseInt(e.key, 10) - 1;
          if (destinations[idx]) {
            e.preventDefault();
            executeTransition(destinations[idx]);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
  }, [focusedIndex, destinations, executeTransition]);

  return (
    <div
      ref={containerRef}
      className={`spatial-hub-stage tier-${perfMode.toLowerCase()} ${transitioningId ? 'is-receding' : ''}`}
      style={{ '--hub-sphere-size': `${layout.sphereRadius * 2}px` } as React.CSSProperties}
      aria-label="Spatial Command Hub"
    >
      {/* ─── Background Concentric Orbital Tracks (SVG) ─── */}
      <svg className="hub-orbit-tracks" aria-hidden="true">
        <ellipse
          cx={layout.cx}
          cy={layout.cy}
          rx={Math.round(layout.baseRx * 0.76)}
          ry={Math.round(layout.baseRy * 0.76)}
          className="orbit-track-line"
        />
        <ellipse
          cx={layout.cx}
          cy={layout.cy}
          rx={Math.round(layout.baseRx * 0.98)}
          ry={Math.round(layout.baseRy * 0.98)}
          className="orbit-track-line"
        />

        {/* Dynamic connection beams to each of the 6 zones */}
        {layout.nodes.map((node) => {
          const isActive = hoveredId === node.id || destinations[focusedIndex]?.id === node.id;
          return (
            <line
              key={`beam-${node.id}`}
              x1={layout.cx}
              y1={layout.cy}
              x2={node.x}
              y2={node.y}
              className={`orbit-connection-beam ${isActive ? 'is-active' : ''}`}
            />
          );
        })}
      </svg>

      {/* ─── Central Stylized Holographic Wireframe Sphere ─── */}
      <div
        className={`hub-sphere-core ${transitioningId ? 'transitioning' : ''}`}
        style={{ left: layout.cx, top: layout.cy }}
      >
        <div className="hub-core-nucleus" />

        <svg className="hub-sphere-svg" viewBox="0 0 280 280" aria-hidden="true">
          <circle cx="140" cy="140" r="105" className="sphere-ring" />
          <ellipse cx="140" cy="140" rx="105" ry="38" className="sphere-ring equator" />
          <ellipse cx="140" cy="140" rx="38" ry="105" className="sphere-ring meridian" />
          <ellipse cx="140" cy="140" rx="90" ry="70" className="sphere-ring tilt" />
        </svg>
      </div>

      {/* ─── Orbiting 6 Zone Destination Nodes ─── */}
      <div className="hub-destinations-layer">
        {layout.nodes.map((node, idx) => {
          const isSelected = transitioningId === node.id;
          const isReceding = transitioningId !== null && !isSelected;
          const isHovered = hoveredId === node.id;
          const isFocused = focusedIndex === idx;

          const IconComponent = node.icon;

          return (
            <div
              key={node.id}
              ref={(el) => {
                if (el) {
                  nodeRefs.current.set(node.id, el);
                  if (onRegisterPanel) onRegisterPanel(`hub-${node.id.toLowerCase()}`, el);
                } else {
                  nodeRefs.current.delete(node.id);
                }
              }}
              className={`hub-workspace-node ${
                isSelected
                  ? 'state-selected'
                  : isFocused
                  ? 'state-focused'
                  : isHovered
                  ? 'state-hovered'
                  : 'state-idle'
              } ${isReceding ? 'receding' : ''}`}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              onMouseEnter={() => {
                setHoveredId(node.id);
                setFocusedIndex(idx);
                cyberAudio.playClick();
              }}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => executeTransition(node)}
              role="button"
              tabIndex={0}
              aria-label={`Open ${node.title}`}
            >
              <div className="node-anchor">
                <div className="node-icon-wrap" style={{ color: node.color }}>
                  <IconComponent size={15} />
                </div>
                <div className="node-text-col">
                  <strong className="node-title">{node.title}</strong>
                  <span className="node-sublabel">{node.sublabel}</span>
                </div>
                {node.badge && <span className="node-badge">{node.badge}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Compact Hub Operational Status Bar ─── */}
      <footer className="hub-status-ring">
        <div className="hub-status-item">
          <span>SPATIAL COMMAND HUB:</span>
          <strong>ONLINE</strong>
        </div>
        <div className="hub-status-item">
          <span>CONNECTED ZONES:</span>
          <strong>{destinations.length}</strong>
        </div>
        <div className="hub-status-hint">
          [ARROWS / TAB] SELECT &nbsp;·&nbsp; [ENTER / CLICK] OPEN ZONE &nbsp;·&nbsp; [1-6] QUICK LAUNCH
        </div>
      </footer>
    </div>
  );
}

export default SpatialCommandHub;

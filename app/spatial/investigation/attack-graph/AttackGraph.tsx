/**
 * AttackGraph.tsx
 *
 * EXPLAIN-SEC SPATIAL SOC — STEP 5: ATTACK GRAPH REBUILD
 *
 * Implements a bounded, responsive, highly readable Cyber Attack Graph Presentation:
 * 1. Bounded Graph Canvas:
 *    - Dynamically measures container width/height via ResizeObserver.
 *    - Uses normalized coordinates (u, v) in [0, 1] projected to safe canvas bounds.
 *    - Strict bounds clamping: node center within [padX, width - padX] x [padY, height - padY].
 *    - Corner exclusion prevents nodes from appearing in tight viewport corners.
 *    - Zero hard-coded viewport coordinates. Zero clipped icons or labels.
 * 2. Causal Progression Layout:
 *    - ENTRY → INITIAL ACCESS → EXECUTION → PERSISTENCE → DISCOVERY → LATERAL MOVEMENT → C2 → IMPACT
 *    - Uses existing canonical relationships; does not invent stages or links.
 *    - Deterministic positioning with collision avoidance.
 *    - Recalculates instantly on container resize.
 * 3. Progressive Graph Construction:
 *    - Canvas appears → Nodes construct sequentially → First node activates →
 *      Relationship line draws → Next node activates → Causal path becomes visible.
 *    - SVG stroke-dash animation settles into stable state.
 *    - Subtle traveling pulse on active causal paths only.
 * 4. Node Interaction & Focus:
 *    - Cursor: hover highlights, click focuses.
 *    - Keyboard: Arrow keys navigate related nodes, Enter inspects, Escape clears.
 *    - Gesture: Point focuses candidate, Dwell locks, Enter/confirmation inspects.
 *    - Focus: Focused node brightens, related nodes remain visible, unrelated nodes dim,
 *      connected relationships highlight.
 * 5. High Performance:
 *    - Pure CSS/SVG hardware-accelerated animations.
 *    - Zero permanent high-frequency React state updates. Cleaned up on unmount.
 */

'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInvestigation } from '../InvestigationContext';
import { spatialController } from '../../../spatial-controller';
import { cyberAudio } from '../../../cyber-audio';
import { Brain } from 'lucide-react';
import ContextualAiAssistant from '../../ai/ContextualAiAssistant';
import type {
  AttackGraphNode,
  AttackGraphEdge,
  AttackGraphNodeType,
} from '../../../core/models/attack-graph';

// ─── Visual Configuration ───────────────────────────────────────────────────

const NODE_COLORS: Record<AttackGraphNodeType, string> = {
  INCIDENT:  '#ff2a2a',
  ALERT:     '#ffb700',
  EVENT:     '#00f0ff',
  ASSET:     '#00f0ff',
  USER:      '#ffb700',
  IOC:       '#ff6b35',
  PROCESS:   '#a78bfa',
  TECHNIQUE: '#c084fc',
  ACTION:    '#ff2a2a',
};

// Node Card Dimensions
const CARD_W = 180;
const CARD_H = 50;
const SAFE_PADDING = 24;

// ─── Causal Progression Stages ──────────────────────────────────────────────

export const KILL_CHAIN_STAGES = [
  'ENTRY',
  'INITIAL ACCESS',
  'EXECUTION',
  'PERSISTENCE',
  'DISCOVERY',
  'LATERAL MOVEMENT',
  'C2',
  'IMPACT',
] as const;

export type KillChainStage = typeof KILL_CHAIN_STAGES[number];

/** Classify a node into one of the 8 canonical progression stages */
function classifyNodeStage(
  node: AttackGraphNode,
  attackPathNodeIds: string[]
): number {
  const label = (node.label || '').toLowerCase();
  const sublabel = (node.sublabel || '').toLowerCase();
  const dataStage = String(node.data?.stage || node.data?.killChainPhase || '').toUpperCase();

  const rawType: string = node.type;

  // 1. Explicit stage in node metadata
  const explicitIdx = KILL_CHAIN_STAGES.indexOf(dataStage as KillChainStage);
  if (explicitIdx !== -1) return explicitIdx;

  // 2. High-precision semantic heuristics
  if (
    label.includes('phish') ||
    label.includes('email') ||
    label.includes('ingress') ||
    label.includes('entry') ||
    label.includes('delivery') ||
    sublabel.includes('phish')
  ) {
    return 0; // ENTRY
  }

  if (
    label.includes('r.morrison') ||
    label.includes('user') ||
    label.includes('account') ||
    label.includes('initial') ||
    label.includes('access') ||
    label.includes('logon') ||
    rawType === 'USER'
  ) {
    return 1; // INITIAL ACCESS
  }

  if (
    label.includes('svchost') ||
    label.includes('exec') ||
    label.includes('process') ||
    label.includes('powershell') ||
    label.includes('binary') ||
    label.includes('malware') ||
    label.includes('ransomware') ||
    rawType === 'PROCESS' ||
    (rawType === 'INCIDENT' && node.isRoot)
  ) {
    return 2; // EXECUTION
  }

  if (
    label.includes('persist') ||
    label.includes('run key') ||
    label.includes('registry') ||
    label.includes('autorun') ||
    label.includes('scheduled') ||
    sublabel.includes('persist')
  ) {
    return 3; // PERSISTENCE
  }

  if (
    label.includes('lsass') ||
    label.includes('cred') ||
    label.includes('dump') ||
    label.includes('recon') ||
    label.includes('discovery') ||
    label.includes('scan') ||
    sublabel.includes('cred')
  ) {
    return 4; // DISCOVERY
  }

  if (
    label.includes('findc') ||
    label.includes('domain controller') ||
    label.includes('backup') ||
    label.includes('nas') ||
    label.includes('lateral') ||
    label.includes('pivot') ||
    (rawType === 'ASSET' && (label.includes('dc') || label.includes('backup') || label.includes('srv')))
  ) {
    return 5; // LATERAL MOVEMENT
  }

  if (
    rawType === 'IOC' ||
    label.includes('ioc') ||
    label.includes('185.220') ||
    label.includes('c2') ||
    label.includes('beacon') ||
    label.includes('.net') ||
    label.includes('ip')
  ) {
    return 6; // C2
  }

  if (
    label.includes('exfil') ||
    label.includes('impact') ||
    label.includes('47 gb') ||
    label.includes('encrypt') ||
    label.includes('destroy') ||
    label.includes('leak') ||
    rawType === 'ACTION'
  ) {
    return 7; // IMPACT
  }

  // 3. Fallback: Position along attack path
  const pathIdx = attackPathNodeIds.indexOf(node.id);
  if (pathIdx !== -1) {
    const fraction = pathIdx / Math.max(1, attackPathNodeIds.length - 1);
    return Math.min(7, Math.round(fraction * 7));
  }

  // 4. Node type generic fallback
  switch (rawType) {
    case 'EVENT': return 0;
    case 'USER': return 1;
    case 'PROCESS': return 2;
    case 'INCIDENT': return 2;
    case 'TECHNIQUE': return 3;
    case 'ASSET': return 5;
    case 'IOC': return 6;
    case 'ACTION': return 7;
    default: return 3;
  }
}

// ─── Bounded Deterministic Layout Engine ────────────────────────────────────

interface LayoutPosition {
  x: number;
  y: number;
  normU: number;
  normV: number;
  stage: number;
}

function computeCausalLayout(
  nodes: AttackGraphNode[],
  edges: AttackGraphEdge[],
  attackPathNodeIds: string[],
  width: number,
  height: number
): Map<string, LayoutPosition> {
  const result = new Map<string, LayoutPosition>();
  if (nodes.length === 0) return result;

  // Safe padding bounds:
  // Node card: CARD_W x CARD_H centered at (x, y)
  // If isRoot: header pill adds ~14px on top.
  const padX = CARD_W / 2 + SAFE_PADDING + 8;
  const padY = CARD_H / 2 + SAFE_PADDING + 20;

  const usableW = Math.max(220, width - padX * 2);
  const usableH = Math.max(160, height - padY * 2);

  // 1. Classify each node into a stage
  const stageMap = new Map<string, number>();
  nodes.forEach((n) => {
    stageMap.set(n.id, classifyNodeStage(n, attackPathNodeIds));
  });

  // 2. Refine stages using directed relationships to enforce forward causal order
  edges.forEach((e) => {
    const srcStage = stageMap.get(e.source);
    const tgtStage = stageMap.get(e.target);
    if (srcStage !== undefined && tgtStage !== undefined && e.isCriticalPath) {
      if (tgtStage < srcStage) {
        stageMap.set(e.target, Math.min(7, srcStage + 1));
      }
    }
  });

  // 3. Group nodes by stage
  const stageGroups = new Map<number, AttackGraphNode[]>();
  for (let s = 0; s < 8; s++) {
    stageGroups.set(s, []);
  }

  nodes.forEach((n) => {
    const s = stageMap.get(n.id) ?? 2;
    stageGroups.get(s)?.push(n);
  });

  // Identify active stages
  const activeStages = Array.from(stageGroups.keys()).filter(
    (s) => (stageGroups.get(s)?.length ?? 0) > 0
  );
  const minStage = activeStages.length > 0 ? Math.min(...activeStages) : 0;
  const maxStage = activeStages.length > 0 ? Math.max(...activeStages) : 7;
  const stageSpan = Math.max(1, maxStage - minStage);

  // 4. Compute normalized (u, v) and projected (x, y)
  activeStages.forEach((s) => {
    const group = stageGroups.get(s) ?? [];
    if (group.length === 0) return;

    // Horizontal normalized coordinate
    const normU = (s - minStage) / stageSpan;

    // Sort group deterministically: Root node first, then compromised, then alphabetical
    const sorted = [...group].sort((a, b) => {
      if (a.isRoot && !b.isRoot) return -1;
      if (!a.isRoot && b.isRoot) return 1;
      if (a.isCompromised && !b.isCompromised) return -1;
      if (!a.isCompromised && b.isCompromised) return 1;
      return a.id.localeCompare(b.id);
    });

    const m = sorted.length;
    sorted.forEach((node, idx) => {
      let normV = 0.5;
      if (m === 2) {
        normV = idx === 0 ? 0.32 : 0.68;
      } else if (m === 3) {
        normV = idx === 0 ? 0.22 : idx === 1 ? 0.50 : 0.78;
      } else if (m >= 4) {
        normV = 0.16 + (idx * 0.68) / (m - 1);
      }

      // Root intrusion node offset slightly upward if with others
      if (node.isRoot && m > 1) {
        normV = Math.max(0.14, normV - 0.12);
      }

      const x = padX + normU * usableW;
      const y = padY + normV * usableH;

      result.set(node.id, {
        x,
        y,
        normU,
        normV,
        stage: s,
      });
    });
  });

  // 5. Collision Avoidance (Deterministic Relaxation)
  const nodeIds = Array.from(result.keys());
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const posA = result.get(nodeIds[i])!;
        const posB = result.get(nodeIds[j])!;

        const dx = Math.abs(posA.x - posB.x);
        const dy = Math.abs(posA.y - posB.y);

        const minSepX = CARD_W + 18;
        const minSepY = CARD_H + 16;

        if (dx < minSepX && dy < minSepY) {
          const overlapY = minSepY - dy;
          if (posA.y <= posB.y) {
            posA.y -= overlapY * 0.5;
            posB.y += overlapY * 0.5;
          } else {
            posA.y += overlapY * 0.5;
            posB.y -= overlapY * 0.5;
          }
        }
      }
    }
  }

  // 6. Absolute Strict Clamping & Corner Exclusion
  const minX = padX;
  const maxX = width - padX;
  const minY = padY;
  const maxY = height - padY;

  const cornerMarginX = CARD_W * 0.65;
  const cornerMarginY = CARD_H * 0.85;

  result.forEach((pos) => {
    const cx = Math.max(minX, Math.min(maxX, pos.x));
    let cy = Math.max(minY, Math.min(maxY, pos.y));

    // Corner exclusion: Prevent nodes from appearing in tight screen corners
    if (cx < minX + cornerMarginX && cy < minY + cornerMarginY) {
      cy = minY + cornerMarginY + 8;
    }
    if (cx > maxX - cornerMarginX && cy < minY + cornerMarginY) {
      cy = minY + cornerMarginY + 8;
    }
    if (cx < minX + cornerMarginX && cy > maxY - cornerMarginY) {
      cy = maxY - cornerMarginY - 8;
    }
    if (cx > maxX - cornerMarginX && cy > maxY - cornerMarginY) {
      cy = maxY - cornerMarginY - 8;
    }

    // Final strict clamp
    pos.x = Math.max(minX, Math.min(maxX, cx));
    pos.y = Math.max(minY, Math.min(maxY, cy));
  });

  return result;
}

// ─── Vector Glyphs for Node Categories ──────────────────────────────────────

function NodeIcon({ type, color }: { type: AttackGraphNodeType; color: string }) {
  switch (type) {
    case 'INCIDENT':
      return (
        <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l7 3.5v5.5c0 5-3.5 9.5-7 11-3.5-1.5-7-6-7-11V5.5l7-3.5z" />
          <line x1="12" y1="7.5" x2="12" y2="12" />
          <circle cx="12" cy="15.5" r="0.75" fill={color} />
        </g>
      );
    case 'ASSET':
      return (
        <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="4" width="17" height="6.5" rx="1.5" />
          <rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" />
          <circle cx="7" cy="7.2" r="0.8" fill={color} />
          <circle cx="7" cy="16.7" r="0.8" fill={color} />
          <line x1="11.5" y1="7.2" x2="16.5" y2="7.2" />
          <line x1="11.5" y1="16.7" x2="16.5" y2="16.7" />
        </g>
      );
    case 'USER':
      return (
        <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="7.5" r="3.5" />
          <path d="M5.5 19.5c0-3.5 2.9-6.5 6.5-6.5s6.5 3 6.5 6.5" />
        </g>
      );
    case 'PROCESS':
      return (
        <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="15" rx="2" />
          <polyline points="7 9 10 12 7 15" />
          <line x1="12" y1="15" x2="16" y2="15" />
        </g>
      );
    case 'TECHNIQUE':
      return (
        <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 4 13 11 13 9 22 20 10 13 10 13 2" />
        </g>
      );
    case 'IOC':
      return (
        <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8.5" />
          <ellipse cx="12" cy="12" rx="4" ry="8.5" />
          <line x1="3.5" y1="12" x2="20.5" y2="12" />
        </g>
      );
    case 'EVENT':
      return (
        <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
          <polyline points="3.5 7.5 12 13 20.5 7.5" />
        </g>
      );
    case 'ACTION':
      return (
        <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </g>
      );
    default:
      return <circle cx="12" cy="12" r="6" stroke={color} strokeWidth="1.5" fill="none" />;
  }
}

// ─── Edge Component (Progressive Draw & Safe Geometry) ───────────────────────

interface EdgeProps {
  edge: AttackGraphEdge;
  fromPos: LayoutPosition;
  toPos: LayoutPosition;
  isSelected: boolean;
  isPathActive: boolean;
  isCritical: boolean;
  isReplaying: boolean;
  isDimmed: boolean;
  orderIndex: number;
}

function Edge({
  edge,
  fromPos,
  toPos,
  isSelected,
  isPathActive,
  isCritical,
  isReplaying,
  isDimmed,
  orderIndex,
}: EdgeProps) {
  const color = isReplaying
    ? '#ff2a2a'
    : isSelected || isPathActive
    ? '#00f0ff'
    : isCritical
    ? '#ff6b35'
    : '#3dffb055';
  const width = isReplaying || isSelected || isPathActive ? 2.6 : isCritical ? 2.0 : 1.2;

  // Compute card boundary intersection points so lines connect cleanly
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;

  let startX = fromPos.x;
  let startY = fromPos.y;
  let endX = toPos.x;
  let endY = toPos.y;

  if (Math.abs(dx) >= Math.abs(dy) * 0.75) {
    // Horizontal dominant
    if (dx > 0) {
      startX = fromPos.x + CARD_W / 2;
      endX = toPos.x - CARD_W / 2;
    } else {
      startX = fromPos.x - CARD_W / 2;
      endX = toPos.x + CARD_W / 2;
    }
  } else {
    // Vertical dominant
    if (dy > 0) {
      startY = fromPos.y + CARD_H / 2;
      endY = toPos.y - CARD_H / 2;
    } else {
      startY = fromPos.y - CARD_H / 2;
      endY = toPos.y + CARD_H / 2;
    }
  }

  // Bounded Bezier curve strictly within canvas
  const midX = (startX + endX) / 2;
  const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;

  const relLabel = edge.relation ? edge.relation.replace(/_/g, ' ') : '';
  const labelWidth = Math.max(46, relLabel.length * 6.2 + 12);

  // Progressive construction timing:
  // Source activates → line starts drawing after ~90ms → settles into stable state
  const edgeDelay = 80 + orderIndex * 220 + 90;

  return (
    <g
      className={`ag-edge${isSelected || isPathActive ? ' highlighted' : ''}${
        isDimmed ? ' dimmed' : ''
      }`}
    >
      {/* Outer Glow on Highlighted / Active Path */}
      {(isPathActive || isSelected || isReplaying) && (
        <path
          d={pathD}
          stroke={color}
          strokeWidth={width + 3}
          strokeOpacity="0.3"
          fill="none"
          strokeLinecap="round"
        />
      )}

      {/* Main Base Connector (Progressive Draw → Settles into Stable Line) */}
      <path
        d={pathD}
        stroke={color}
        strokeWidth={width}
        strokeDasharray={isCritical || isReplaying || isPathActive ? 'none' : '4 5'}
        fill="none"
        strokeLinecap="round"
        style={{
          strokeDasharray: '450',
          strokeDashoffset: '450',
          animation: `ag-edge-progressive-draw 0.32s cubic-bezier(0.16, 1, 0.3, 1) ${edgeDelay}ms forwards`,
        }}
      />

      {/* Subtle Traveling Energy Pulse ONLY on Critical / Replaying Path */}
      {(isCritical || isReplaying) && (
        <path
          d={pathD}
          stroke={isReplaying ? '#ff4444' : isPathActive ? '#00f0ff' : '#ff8533'}
          strokeWidth={width + 1.2}
          strokeDasharray="8 36"
          fill="none"
          strokeLinecap="round"
          opacity={isReplaying ? 0.95 : 0.65}
          style={{
            animation: `ag-pulse-travel 2.2s linear infinite`,
            animationDelay: `${edgeDelay + 300}ms`,
          }}
        />
      )}

      {/* End Arrow Target Point */}
      <circle
        cx={endX}
        cy={endY}
        r={isPathActive || isSelected || isReplaying ? 3.5 : 2.5}
        fill={color}
        opacity={0.9}
      />

      {/* Relation Pill Badge */}
      {relLabel && (
        <g
          transform={`translate(${midX}, ${(startY + endY) / 2})`}
          className="ag-edge-label"
          opacity={isSelected || isReplaying || isPathActive ? 0.95 : 0.7}
        >
          <rect
            x={-labelWidth / 2}
            y={-7.5}
            width={labelWidth}
            height={15}
            rx={3}
            fill="rgba(4, 8, 18, 0.94)"
            stroke={color}
            strokeWidth={0.8}
          />
          <text
            y={3}
            textAnchor="middle"
            fontSize="7.5"
            fontWeight="700"
            letterSpacing="0.08em"
            fill={color}
            fontFamily="'Chakra Petch', monospace"
          >
            {relLabel}
          </text>
        </g>
      )}
    </g>
  );
}

// ─── Main AttackGraph Component ─────────────────────────────────────────────

interface AttackGraphProps {
  incidentId?: string;
  onSelectEntity?: (entity: any) => void;
}

export default function AttackGraph({ onSelectEntity }: AttackGraphProps) {
  const { data, selectedEntity, setSelectedEntity, replay } = useInvestigation();
  const [filterMode, setFilterMode] = useState<'ALL' | 'CRITICAL' | 'COMPROMISED'>('ALL');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [isAiOpen, setIsAiOpen] = useState(false);

  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 600 });
  const nodeRefs = useRef<Map<string, SVGElement>>(new Map());

  const graph = data?.attackGraph;

  // 1. Dynamic ResizeObserver for bounded canvas
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) {
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
          if (width > 100 && height > 100) {
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

  // 2. Compute Causal Progression Layout strictly bounded inside canvas
  const positions = useMemo(() => {
    return computeCausalLayout(
      graph?.nodes ?? [],
      graph?.edges ?? [],
      graph?.attackPathNodeIds ?? [],
      dimensions.width,
      dimensions.height
    );
  }, [graph, dimensions.width, dimensions.height]);

  // 3. Sequential construction order map
  const nodeOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    const pathIds = graph?.attackPathNodeIds ?? [];
    pathIds.forEach((id, idx) => map.set(id, idx));

    let extra = pathIds.length;
    graph?.nodes.forEach((n) => {
      if (!map.has(n.id)) {
        map.set(n.id, extra++);
      }
    });
    return map;
  }, [graph]);

  // 4. Ordered list of nodes for keyboard cycling
  const orderedNodes = useMemo(() => {
    if (!graph) return [];
    return [...graph.nodes].sort((a, b) => {
      const orderA = nodeOrderMap.get(a.id) ?? 99;
      const orderB = nodeOrderMap.get(b.id) ?? 99;
      return orderA - orderB;
    });
  }, [graph, nodeOrderMap]);

  // 5. Related/Connected nodes to focused entity
  const activeFocusId = selectedEntity?.id || hoveredNodeId;

  const connectedNodeIds = useMemo(() => {
    if (!activeFocusId || !graph) return null;
    const set = new Set<string>();
    set.add(activeFocusId);
    graph.edges.forEach((e) => {
      if (e.source === activeFocusId) set.add(e.target);
      if (e.target === activeFocusId) set.add(e.source);
    });
    return set;
  }, [activeFocusId, graph]);

  const connectedNodesList = useMemo(() => {
    if (!selectedEntity?.id || !graph) return [];
    const connected = new Set<string>();
    graph.edges.forEach((e) => {
      if (e.source === selectedEntity.id) connected.add(e.target);
      if (e.target === selectedEntity.id) connected.add(e.source);
    });
    return graph.nodes.filter((n) => connected.has(n.id));
  }, [selectedEntity?.id, graph]);

  // 6. Handle Node Selection / Focus
  const handleNodeClick = useCallback(
    (node: AttackGraphNode) => {
      cyberAudio.playSelect();
      const entity = {
        id: node.id,
        type:
          node.type === 'INCIDENT'
            ? 'INCIDENT'
            : node.type === 'ASSET'
            ? 'ASSET'
            : node.type === 'USER'
            ? 'USER'
            : node.type === 'IOC'
            ? 'IOC'
            : node.type === 'TECHNIQUE' || node.type === 'ACTION'
            ? 'TECHNIQUE'
            : 'GRAPH_NODE',
      };
      setSelectedEntity(entity as any);
      if (onSelectEntity) onSelectEntity(entity);
    },
    [setSelectedEntity, onSelectEntity]
  );

  // 7. Keyboard Navigation (Arrow Keys → navigate related nodes, Enter → inspect, Escape → clear)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!graph || graph.nodes.length === 0) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        cyberAudio.playScan();
        // If an entity is focused and has connected neighbors, cycle through neighbors
        if (selectedEntity?.id && connectedNodesList.length > 0) {
          const curIdx = connectedNodesList.findIndex((n) => n.id === selectedEntity.id);
          const nextIdx = (curIdx + 1) % connectedNodesList.length;
          handleNodeClick(connectedNodesList[nextIdx]);
        } else {
          // Otherwise step forward along the causal chain
          const all = orderedNodes;
          const curIdx = selectedEntity?.id ? all.findIndex((n) => n.id === selectedEntity.id) : -1;
          const nextIdx = (curIdx + 1) % all.length;
          handleNodeClick(all[nextIdx]);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        cyberAudio.playScan();
        if (selectedEntity?.id && connectedNodesList.length > 0) {
          const curIdx = connectedNodesList.findIndex((n) => n.id === selectedEntity.id);
          const prevIdx = (curIdx - 1 + connectedNodesList.length) % connectedNodesList.length;
          handleNodeClick(connectedNodesList[prevIdx]);
        } else {
          const all = orderedNodes;
          const curIdx = selectedEntity?.id ? all.findIndex((n) => n.id === selectedEntity.id) : 0;
          const prevIdx = (curIdx - 1 + all.length) % all.length;
          handleNodeClick(all[prevIdx]);
        }
      } else if (e.key === 'Enter') {
        if (selectedEntity?.id) {
          e.preventDefault();
          cyberAudio.playSelect();
          // Inspect focused entity via AI copilot
          window.dispatchEvent(
            new CustomEvent('explainsec:open-ai-assistant', {
              detail: { entity: selectedEntity },
            })
          );
        }
      } else if (e.key === 'Escape') {
        if (selectedEntity) {
          e.preventDefault();
          cyberAudio.playClick();
          setSelectedEntity(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [graph, selectedEntity, connectedNodesList, orderedNodes, handleNodeClick, setSelectedEntity]);

  // 8. Register node elements for Spatial Hand Gestures (Point + Dwell + Confirmation)
  useEffect(() => {
    const registered: string[] = [];
    nodeRefs.current.forEach((el, id) => {
      spatialController.registerPanel(`ag-node-${id}`, el as unknown as HTMLElement);
      registered.push(id);
    });
    return () => {
      registered.forEach((id) => {
        spatialController.unregisterPanel(`ag-node-${id}`);
      });
    };
  }, [positions]);

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="ag-empty">
        <span>No attack graph available for this incident.</span>
      </div>
    );
  }

  // Filtered nodes
  const displayedNodes = graph.nodes.filter((node) => {
    if (filterMode === 'CRITICAL') {
      return node.severity === 'CRITICAL' || graph.attackPathNodeIds?.includes(node.id);
    }
    if (filterMode === 'COMPROMISED') {
      return node.isCompromised || node.isRoot;
    }
    return true;
  });

  const displayedNodeIds = new Set(displayedNodes.map((n) => n.id));
  const displayedEdges = graph.edges.filter(
    (e) => displayedNodeIds.has(e.source) && displayedNodeIds.has(e.target)
  );

  return (
    <div
      className="ag-container"
      role="region"
      aria-label="Causal Attack Graph Canvas"
    >
      {/* ── Top Interactive Toolbar ── */}
      <div className="ag-toolbar">
        <div className="ag-toolbar-left">
          <span className="ag-toolbar-tag">CAUSAL ATTACK GRAPH</span>
          <span className="ag-toolbar-stats">
            {graph.nodes.length} ENTITIES &nbsp;·&nbsp; {graph.edges.length} RELATIONS &nbsp;·&nbsp;{' '}
            {graph.attackPathNodeIds?.length ?? 0} PROGRESSION STEPS
          </span>
        </div>

        <div className="ag-toolbar-right">
          <button
            className={`ag-filter-btn ${filterMode === 'ALL' ? 'active' : ''}`}
            onClick={() => {
              cyberAudio.playClick();
              setFilterMode('ALL');
            }}
            title="Display all correlated entities"
          >
            ALL ENTITIES
          </button>
          <button
            className={`ag-filter-btn ${filterMode === 'CRITICAL' ? 'active' : ''}`}
            onClick={() => {
              cyberAudio.playClick();
              setFilterMode('CRITICAL');
            }}
            title="Filter to critical causal kill-chain only"
          >
            CRITICAL PATH
          </button>
          <button
            className={`ag-filter-btn ${filterMode === 'COMPROMISED' ? 'active' : ''}`}
            onClick={() => {
              cyberAudio.playClick();
              setFilterMode('COMPROMISED');
            }}
            title="Filter to confirmed compromised assets & accounts"
          >
            COMPROMISED
          </button>
          <button
            className="ag-filter-btn"
            style={{
              borderColor: isAiOpen ? '#00f0ff' : 'rgba(0, 240, 255, 0.4)',
              color: '#00f0ff',
              background: isAiOpen ? 'rgba(0, 240, 255, 0.2)' : 'rgba(0, 240, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onClick={() => {
              cyberAudio.playClick();
              setIsAiOpen((prev) => !prev);
            }}
            title="Toggle Contextual AI Attack-Path Explanation"
          >
            <Brain size={11} />
            <span>AI ATTACK PATH</span>
          </button>
        </div>
      </div>

      {/* ── Causal Progression Ribbon (Kill Chain) ── */}
      <div className="ag-killchain-ribbon" role="navigation" aria-label="Kill Chain Progression">
        {KILL_CHAIN_STAGES.map((stageName, sIdx) => {
          const hasNodes = Array.from(positions.values()).some((p) => p.stage === sIdx);
          return (
            <div key={stageName} className={`ag-stage-step ${hasNodes ? 'active' : ''}`}>
              <span>{stageName}</span>
              {sIdx < KILL_CHAIN_STAGES.length - 1 && <span className="ag-stage-arrow">→</span>}
            </div>
          );
        })}
      </div>

      {/* ── Bounded SVG Canvas (1:1 Exact Screen Space) ── */}
      <div className="ag-canvas-wrap" ref={canvasWrapRef}>
        <svg
          className="ag-svg"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          width="100%"
          height="100%"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
        <defs>
          {/* Ambient Cyber Grid */}
          <pattern id="ag-grid-pattern" width="36" height="36" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="36" y2="0" stroke="rgba(0, 240, 255, 0.03)" strokeWidth="1" />
            <line x1="0" y1="0" x2="0" y2="36" stroke="rgba(0, 240, 255, 0.03)" strokeWidth="1" />
            <circle cx="18" cy="18" r="0.75" fill="rgba(61, 255, 176, 0.06)" />
          </pattern>

          {/* Focused Node Glow Filter */}
          <filter id="ag-node-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient Grid Background */}
        <rect width={dimensions.width} height={dimensions.height} fill="url(#ag-grid-pattern)" pointerEvents="none" />

        {/* ── 1. Edges Layer (Rendered below nodes) ── */}
        <g className="ag-edges-layer">
          {displayedEdges.map((edge) => {
            const from = positions.get(edge.source);
            const to = positions.get(edge.target);
            if (!from || !to) return null;

            const isEdgeConnected =
              connectedNodeIds != null &&
              connectedNodeIds.has(edge.source) &&
              connectedNodeIds.has(edge.target);

            const isEdgeDimmed = connectedNodeIds != null && !isEdgeConnected;

            return (
              <Edge
                key={edge.id}
                edge={edge}
                fromPos={from}
                toPos={to}
                orderIndex={nodeOrderMap.get(edge.source) ?? 0}
                isSelected={selectedEntity?.id === edge.source || selectedEntity?.id === edge.target}
                isPathActive={isEdgeConnected}
                isCritical={!!edge.isCriticalPath}
                isReplaying={replay.currentEdgeId === edge.id}
                isDimmed={isEdgeDimmed}
              />
            );
          })}
        </g>

        {/* ── 2. Nodes Layer (Rendered above edges) ── */}
        <g className="ag-nodes-layer">
          {displayedNodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;

            const color = NODE_COLORS[node.type] ?? '#7b8ab8';
            const isSelected = selectedEntity?.id === node.id;
            const isHovered = hoveredNodeId === node.id;
            const isReplaying = replay.currentNodeId === node.id;
            const orderIdx = nodeOrderMap.get(node.id) ?? 0;

            const isConnected =
              connectedNodeIds != null && connectedNodeIds.has(node.id) && !isSelected;
            const isDimmed =
              connectedNodeIds != null && !connectedNodeIds.has(node.id);

            // Progressive construction delay: Node 0 activates, edge draws, Node 1 activates...
            const nodeDelay = 80 + orderIdx * 220;

            return (
              <g
                key={node.id}
                id={`ag-node-${node.id}`}
                ref={(el) => {
                  if (el) nodeRefs.current.set(node.id, el);
                  else nodeRefs.current.delete(node.id);
                }}
                className={`ag-node${isSelected ? ' selected' : ''}${
                  isReplaying ? ' replaying' : ''
                }${node.isRoot ? ' root' : ''}${isDimmed ? ' dimmed' : ''}${
                  isConnected ? ' connected' : ''
                }`}
                transform={`translate(${pos.x}, ${pos.y})`}
                onClick={() => handleNodeClick(node)}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                role="button"
                tabIndex={0}
                aria-label={`${node.type}: ${node.label}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNodeClick(node);
                }}
              >
                <g
                  className="ag-node-content"
                  style={{
                    animation: `ag-node-construct 0.38s cubic-bezier(0.16, 1, 0.3, 1) ${nodeDelay}ms both`,
                  }}
                >
                  <title>{node.label} — {node.sublabel || node.type}</title>

                  {/* Node Card Shell */}
                  <rect
                    className="ag-node-card"
                    x={-CARD_W / 2}
                    y={-CARD_H / 2}
                    width={CARD_W}
                    height={CARD_H}
                    rx={6}
                    fill="rgba(6, 12, 26, 0.95)"
                    stroke={isSelected || isReplaying ? color : isConnected ? '#00f0ff' : `${color}55`}
                    strokeWidth={isSelected || isReplaying ? 2.2 : isConnected ? 1.6 : 1.2}
                    filter={isSelected || isReplaying ? 'url(#ag-node-glow)' : undefined}
                  />

                  {/* Left Glyph Badge Container */}
                  <rect
                    x={-CARD_W / 2 + 6}
                    y={-CARD_H / 2 + 8}
                    width={34}
                    height={34}
                    rx={4}
                    fill={`${color}18`}
                    stroke={`${color}40`}
                    strokeWidth={0.8}
                  />

                  {/* Vector Node Icon */}
                  <g transform={`translate(${-CARD_W / 2 + 11}, ${-CARD_H / 2 + 13})`}>
                    <NodeIcon type={node.type} color={color} />
                  </g>

                  {/* Node Label Text */}
                  <text
                    x={-CARD_W / 2 + 48}
                    y={-2}
                    fontSize="10"
                    fontWeight={isSelected || node.isRoot ? '700' : '600'}
                    fill={isSelected || isReplaying ? color : '#f1f5f9'}
                    fontFamily="'Chakra Petch', monospace"
                    letterSpacing="0.02em"
                  >
                    {node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label}
                  </text>

                  {/* Node Sublabel / Stage Tag */}
                  <text
                    x={-CARD_W / 2 + 48}
                    y={13}
                    fontSize="8"
                    fontWeight="600"
                    fill={`${color}cc`}
                    fontFamily="'Chakra Petch', monospace"
                    letterSpacing="0.06em"
                  >
                    {node.sublabel ? (node.sublabel.length > 20 ? node.sublabel.slice(0, 19) + '…' : node.sublabel) : node.type}
                  </text>

                  {/* Compromised Indicator Pill */}
                  {node.isCompromised && (
                    <g transform={`translate(${CARD_W / 2 - 12}, ${-CARD_H / 2 + 12})`}>
                      <circle r="3.5" fill="#ff2a2a" />
                      <circle r="6" fill="none" stroke="#ff2a2a" strokeWidth="0.8" opacity="0.6" />
                    </g>
                  )}

                  {/* Root Intrusion Header Banner */}
                  {node.isRoot && (
                    <g transform={`translate(0, ${-CARD_H / 2 - 8})`}>
                      <rect
                        x="-38"
                        y="-7"
                        width="76"
                        height="14"
                        rx="3"
                        fill="rgba(0, 240, 255, 0.2)"
                        stroke="#00f0ff"
                        strokeWidth={0.8}
                      />
                      <text
                        y="3.5"
                        textAnchor="middle"
                        fontSize="7.5"
                        fontWeight="700"
                        letterSpacing="0.1em"
                        fill="#00f0ff"
                        fontFamily="'Chakra Petch', monospace"
                      >
                        ROOT INTRUSION
                      </text>
                    </g>
                  )}
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      </div>

      {/* ── Selection Inspector Strip ── */}
      {selectedEntity && (() => {
        const node = graph.nodes.find((n) => n.id === selectedEntity.id);
        if (!node) return null;
        const color = NODE_COLORS[node.type] ?? '#7b8ab8';
        const incomingEdges = graph.edges.filter((e) => e.target === node.id);
        const outgoingEdges = graph.edges.filter((e) => e.source === node.id);

        return (
          <div className="ag-selection-strip" style={{ borderColor: `${color}88` }}>
            <div className="ag-sel-left">
              <span
                className="ag-sel-type-badge"
                style={{
                  color,
                  backgroundColor: `${color}18`,
                  borderColor: `${color}40`,
                }}
              >
                {node.type}
              </span>
              <span className="ag-sel-title">{node.label}</span>
              {node.sublabel && <span className="ag-sel-sub">· {node.sublabel}</span>}
              {node.isCompromised && (
                <span className="ag-sel-compromised">COMPROMISED ENTITY</span>
              )}
              {node.isRoot && (
                <span
                  style={{
                    color: '#00f0ff',
                    fontSize: '8px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                  }}
                >
                  ROOT CAUSE
                </span>
              )}
            </div>

            <div className="ag-sel-right">
              <span className="ag-sel-sub">
                RELATIONS: {incomingEdges.length} INBOUND &nbsp;·&nbsp; {outgoingEdges.length}{' '}
                OUTBOUND
              </span>
              <button
                className="ag-sel-clear"
                onClick={() => {
                  cyberAudio.playSelect();
                  window.dispatchEvent(
                    new CustomEvent('explainsec:open-ai-assistant', {
                      detail: { entity: selectedEntity },
                    })
                  );
                }}
                title="Inspect entity with AI Copilot [ENTER]"
                aria-label="Inspect Entity"
              >
                INSPECT [ENTER]
              </button>
              <button
                className="ag-sel-clear"
                onClick={() => {
                  cyberAudio.playClick();
                  setSelectedEntity(null);
                }}
                title="Deselect entity [ESC]"
                aria-label="Deselect entity"
              >
                ✕ CLOSE [ESC]
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Contextual AI Attack-Path Explanation Drawer ── */}
      {data?.incident && (
        <ContextualAiAssistant
          mode="ATTACK_GRAPH"
          targetId={data.incident.id}
          isOpen={isAiOpen}
          onClose={() => setIsAiOpen(false)}
        />
      )}
    </div>
  );
}

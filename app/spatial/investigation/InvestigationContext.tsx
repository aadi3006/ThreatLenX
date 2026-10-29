/**
 * InvestigationContext.tsx
 *
 * Single shared context for all Stage 3 investigation visualizations.
 *
 * Responsibilities:
 * - Load all canonical data from SecurityService ONCE per focusedIncidentId.
 * - Reconstruct the deterministic attack path from seed graph data.
 * - Manage cross-visualization selection state.
 * - Drive the replay state machine (timer via useRef — NOT setState in ticker).
 * - Expose a single clean interface to all child visualizations.
 *
 * Performance contract:
 * - The replay timer (setInterval) updates a ref counter per tick.
 * - React state only receives a batched setState call after the ref advances.
 * - This keeps replay smooth without coupling to React render frequency.
 * - No RAF inside this module.
 */

'use client';
import {
  createContext, useContext, useEffect, useState, useRef, useCallback, useMemo
} from 'react';
import { securityService } from '../../core/bootstrap';
import type { IncidentDetail } from '../../core/models/incident';
import type { AttackGraph } from '../../core/models/attack-graph';
import type { SystemRadarData, IocGraphData } from '../../core/models/spatial-structures';
import type { MitreTechniqueCoverage } from '../../core/models/mitre';
import type { Asset, SecurityUser, IOC } from '../../core/models/entity';
import type {
  InvestigationContextValue,
  InvestigationView,
  SelectedEntity,
  ReplayState,
  ReconstructedAttackPath,
  InvestigationData,
  AttackPathStep,
  ChoreographyState,
  ChoreographyPhase,
  ConstructionSubStep,
} from './investigation-state';
import { REPLAY_INTERVAL_MS } from './investigation-state';

// ─── Attack path reconstruction ───────────────────────────────────────────────

function reconstructAttackPath(
  incidentId: string,
  graph: AttackGraph
): ReconstructedAttackPath {
  // Use attackPathNodeIds order from the graph — it is the canonical ordered path.
  const pathNodeIds = graph.attackPathNodeIds;

  const steps: AttackPathStep[] = pathNodeIds.map((nodeId, i) => {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    // Find the critical-path edge pointing TO this node from the previous step
    const incomingEdge =
      i > 0
        ? graph.edges.find(
            (e) =>
              e.target === nodeId &&
              e.source === pathNodeIds[i - 1] &&
              e.isCriticalPath
          ) ??
          graph.edges.find(
            (e) => e.target === nodeId && e.source === pathNodeIds[i - 1]
          )
        : undefined;

    return {
      stepIndex: i,
      nodeId,
      node,
      incomingEdge,
      timestamp: (node.data as Record<string, string> | undefined)?.timestamp,
      techniqueId: node.type === 'TECHNIQUE' ? node.label : undefined,
    } satisfies AttackPathStep;
  }).filter(Boolean) as AttackPathStep[];

  const criticalEdgeIds = graph.edges
    .filter((e) => e.isCriticalPath)
    .map((e) => e.id);

  return { incidentId, steps, criticalEdgeIds };
}

// ─── Initial replay state ─────────────────────────────────────────────────────

function makeIdleReplay(totalSteps: number): ReplayState {
  return {
    status: 'IDLE',
    currentStep: 0,
    totalSteps,
    currentNodeId: null,
    currentEdgeId: null,
    currentTimestamp: null,
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

const InvestigationCtx = createContext<InvestigationContextValue | null>(null);

export function useInvestigation(): InvestigationContextValue {
  const ctx = useContext(InvestigationCtx);
  if (!ctx) throw new Error('useInvestigation must be used inside InvestigationProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface Props {
  incidentId: string;
  children: React.ReactNode;
}

export function InvestigationProvider({ incidentId, children }: Props) {
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [data, setData]             = useState<InvestigationData | null>(null);
  const [activeView, setActiveView] = useState<InvestigationView>('TIMELINE');
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [replay, setReplay]         = useState<ReplayState>(makeIdleReplay(0));

  // Choreography presentation state machine (Stage 2)
  const [choreography, setChoreography] = useState<ChoreographyState>({
    phase: 'FOCUSING',
    subStep: 'TIMELINE_ENTRY',
    progress: 0.1,
  });

  const choreographyTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearChoreographyTimers = useCallback(() => {
    choreographyTimerRef.current.forEach(clearTimeout);
    choreographyTimerRef.current = [];
  }, []);

  // Replay timer lives in a ref so it never triggers re-renders per tick
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayStepRef  = useRef(0);
  const replayDataRef  = useRef<ReconstructedAttackPath | null>(null);

  // ── Load canonical data ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setData(null);
    setActiveView('ATTACK');
    setSelectedEntity(null);
    replayStepRef.current = 0;
    replayDataRef.current = null;

    // Clear any running replay
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }

    async function load(isInitial = true) {
      try {
        if (isInitial) setIsLoading(true);
        const [detail, attackGraph, systemRadar, iocGraph, mitreCoverage, allAssets, allUsers, allIOCs] =
          await Promise.all([
            securityService.getIncidentById(incidentId),
            securityService.getAttackGraph(incidentId),
            securityService.getSystemRadar(incidentId),
            securityService.getIocConstellation(incidentId),
            securityService.getMitreMatrix(),
            securityService.getAssets(),
            securityService.getUsers(),
            securityService.getIOCs(),
          ]);

        if (cancelled) return;

        if (!detail) {
          setError(`Incident ${incidentId} not found.`);
          setIsLoading(false);
          return;
        }

        // Use empty graph if none returned
        const graph: AttackGraph = attackGraph ?? {
          incidentId,
          rootNodeId: '',
          nodes: [],
          edges: [],
          attackPathNodeIds: [],
        };

        const attackPath = reconstructAttackPath(incidentId, graph);
        replayDataRef.current = attackPath;

        const bundle: InvestigationData = {
          incidentId,
          incident: detail,
          attackGraph: graph,
          systemRadar: systemRadar ?? null,
          iocGraph: iocGraph ?? null,
          mitreCoverage: mitreCoverage.filter(
            (c) => detail.mitreTechniques.includes(c.technique.id)
          ),
          allAssets,
          allUsers,
          allIOCs,
          attackPath,
        };

        setData(bundle);
        if (isInitial) {
          setReplay(makeIdleReplay(attackPath.steps.length));
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled && isInitial) setIsLoading(false);
      }
    }

    void load(true);

    const unsubAction = securityService.subscribe('RESPONSE_ACTION_UPDATED', () => {
      void load(false);
    });
    const unsubDetail = securityService.subscribe('INCIDENT_DETAIL_UPDATED', () => {
      void load(false);
    });
    const unsubIncidents = securityService.subscribe('INCIDENTS_UPDATED', () => {
      void load(false);
    });

    return () => {
      cancelled = true;
      unsubAction();
      unsubDetail();
      unsubIncidents();
    };
  }, [incidentId]);

  // ── Replay state machine ──────────────────────────────────────────────────────

  const clearReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  const advanceReplayStep = useCallback(() => {
    const path = replayDataRef.current;
    if (!path) return;

    replayStepRef.current += 1;
    const step = replayStepRef.current;
    const totalSteps = path.steps.length;

    if (step >= totalSteps) {
      clearReplayTimer();
      const lastStep = path.steps[totalSteps - 1];
      setReplay({
        status: 'COMPLETED',
        currentStep: totalSteps - 1,
        totalSteps,
        currentNodeId: lastStep?.nodeId ?? null,
        currentEdgeId: lastStep?.incomingEdge?.id ?? null,
        currentTimestamp: lastStep?.timestamp ?? null,
      });
      return;
    }

    const current = path.steps[step];
    // setState is safe here — it's called from setInterval, not from RAF
    setReplay({
      status: 'PLAYING',
      currentStep: step,
      totalSteps,
      currentNodeId: current.nodeId,
      currentEdgeId: current.incomingEdge?.id ?? null,
      currentTimestamp: current.timestamp ?? null,
    });
  }, [clearReplayTimer]);

  const [replaySpeed, setReplaySpeedState] = useState<number>(1);

  const startReplayLoop = useCallback((speed: number) => {
    clearReplayTimer();
    const interval = Math.max(400, Math.round(REPLAY_INTERVAL_MS / speed));
    replayTimerRef.current = setInterval(advanceReplayStep, interval);
  }, [advanceReplayStep, clearReplayTimer]);

  const setReplaySpeed = useCallback((speed: number) => {
    setReplaySpeedState(speed);
    if (replay.status === 'PLAYING') {
      startReplayLoop(speed);
    }
  }, [replay.status, startReplayLoop]);

  const replayPlay = useCallback(() => {
    const path = replayDataRef.current;
    if (!path || path.steps.length === 0) return;

    // If completed, restart from beginning
    if (replayStepRef.current >= path.steps.length) {
      replayStepRef.current = 0;
    }

    const startStep = path.steps[replayStepRef.current];
    setReplay((prev) => ({
      ...prev,
      status: 'PLAYING',
      currentNodeId: startStep?.nodeId ?? null,
      currentEdgeId: startStep?.incomingEdge?.id ?? null,
    }));

    setChoreography((prev) => (prev.phase === 'CONTEXT_READY' ? { ...prev, phase: 'REPLAYING' } : prev));
    startReplayLoop(replaySpeed);
  }, [replaySpeed, startReplayLoop]);

  const replayPause = useCallback(() => {
    clearReplayTimer();
    setReplay((prev) => ({ ...prev, status: 'PAUSED' }));
  }, [clearReplayTimer]);

  const replayReset = useCallback(() => {
    clearReplayTimer();
    replayStepRef.current = 0;
    setReplay(makeIdleReplay(replayDataRef.current?.steps.length ?? 0));
    setSelectedEntity(null);
    setChoreography((prev) => (prev.phase === 'REPLAYING' ? { ...prev, phase: 'CONTEXT_READY' } : prev));
  }, [clearReplayTimer]);

  const replayStepForward = useCallback(() => {
    clearReplayTimer();
    advanceReplayStep();
    setReplay((prev) => ({ ...prev, status: 'PAUSED' }));
  }, [advanceReplayStep, clearReplayTimer]);

  const replayStepBack = useCallback(() => {
    const path = replayDataRef.current;
    if (!path) return;
    clearReplayTimer();
    const newStep = Math.max(0, replayStepRef.current - 1);
    replayStepRef.current = newStep;
    const current = path.steps[newStep];
    setReplay((prev) => ({
      ...prev,
      status: 'PAUSED',
      currentStep: newStep,
      currentNodeId: current?.nodeId ?? null,
      currentEdgeId: current?.incomingEdge?.id ?? null,
      currentTimestamp: current?.timestamp ?? null,
    }));
  }, [clearReplayTimer]);

  const replayJumpTo = useCallback((stepIndex: number) => {
    const path = replayDataRef.current;
    if (!path) return;
    clearReplayTimer();
    const clampedStep = Math.max(0, Math.min(stepIndex, path.steps.length - 1));
    replayStepRef.current = clampedStep;
    const current = path.steps[clampedStep];
    setReplay({
      status: 'PAUSED',
      currentStep: clampedStep,
      totalSteps: path.steps.length,
      currentNodeId: current?.nodeId ?? null,
      currentEdgeId: current?.incomingEdge?.id ?? null,
      currentTimestamp: current?.timestamp ?? null,
    });
    // Sync selection
    if (current?.nodeId) {
      setSelectedEntity({ id: current.nodeId, type: 'GRAPH_NODE' });
    }
  }, [clearReplayTimer]);

  // ── Choreography State Machine Logic (Stage 2) ──────────────────────────
  const skipChoreography = useCallback(() => {
    clearChoreographyTimers();
    setChoreography({
      phase: activeView === 'REPLAY' ? 'REPLAYING' : activeView === 'RESPONSE' ? 'RESPONSE' : 'CONTEXT_READY',
      subStep: 'COMPLETE',
      progress: 1.0,
    });
  }, [activeView, clearChoreographyTimers]);

  const triggerCollapse = useCallback((onComplete: () => void) => {
    clearChoreographyTimers();
    setChoreography((prev) => ({ ...prev, phase: 'COLLAPSING', progress: 0 }));
    const t = setTimeout(() => {
      onComplete();
    }, 280);
    choreographyTimerRef.current.push(t);
  }, [clearChoreographyTimers]);

  // Progressive construction orchestration once data arrives
  useEffect(() => {
    if (!data || isLoading) return;

    clearChoreographyTimers();
    setChoreography({
      phase: 'INVESTIGATION_OPEN',
      subStep: 'TIMELINE_ENTRY',
      progress: 0.2,
    });

    const timers = [
      setTimeout(() => {
        setChoreography({
          phase: 'CONTEXT_BUILDING',
          subStep: 'TIMELINE_ENTRY',
          progress: 0.35,
        });
      }, 200),
      setTimeout(() => {
        setChoreography({
          phase: 'CONTEXT_BUILDING',
          subStep: 'ATTACK_PATH',
          progress: 0.5,
        });
      }, 500),
      setTimeout(() => {
        setChoreography({
          phase: 'CONTEXT_BUILDING',
          subStep: 'RADAR_SWEEP',
          progress: 0.65,
        });
      }, 800),
      setTimeout(() => {
        setChoreography({
          phase: 'CONTEXT_BUILDING',
          subStep: 'IOC_CONSTELLATION',
          progress: 0.8,
        });
      }, 1100),
      setTimeout(() => {
        setChoreography({
          phase: 'CONTEXT_BUILDING',
          subStep: 'MITRE_MATRIX',
          progress: 0.9,
        });
      }, 1400),
      setTimeout(() => {
        setChoreography((prev) => ({
          phase: prev.phase === 'COLLAPSING' ? 'COLLAPSING' : 'CONTEXT_READY',
          subStep: 'COMPLETE',
          progress: 1.0,
        }));
      }, 1700),
    ];

    choreographyTimerRef.current = timers;
    return () => clearChoreographyTimers();
  }, [data, isLoading, clearChoreographyTimers]);

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      clearReplayTimer();
      clearChoreographyTimers();
    };
  }, [clearReplayTimer, clearChoreographyTimers]);

  const handleSetActiveView = useCallback((view: InvestigationView) => {
    setActiveView(view);
    setChoreography((prev) => {
      if (prev.phase === 'COLLAPSING') return prev;
      let nextPhase: ChoreographyPhase = 'CONTEXT_READY';
      if (view === 'REPLAY') nextPhase = 'REPLAYING';
      else if (view === 'RESPONSE') nextPhase = 'RESPONSE';
      return { ...prev, phase: nextPhase };
    });
  }, []);

  const value = useMemo<InvestigationContextValue>(
    () => ({
      isLoading,
      error,
      data,
      activeView,
      setActiveView: handleSetActiveView,
      selectedEntity,
      setSelectedEntity,
      replay,
      replaySpeed,
      setReplaySpeed,
      replayPlay,
      replayPause,
      replayReset,
      replayStepForward,
      replayStepBack,
      replayJumpTo,
      choreography,
      skipChoreography,
      triggerCollapse,
    }),
    [
      isLoading, error, data, activeView, handleSetActiveView, selectedEntity, replay,
      replaySpeed, setReplaySpeed,
      replayPlay, replayPause, replayReset, replayStepForward, replayStepBack, replayJumpTo,
      choreography, skipChoreography, triggerCollapse,
    ]
  );

  return (
    <InvestigationCtx.Provider value={value}>
      {children}
    </InvestigationCtx.Provider>
  );
}

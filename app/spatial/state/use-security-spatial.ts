/**
 * use-security-spatial.ts
 *
 * React hook that:
 * 1. Bootstraps SecurityService (idempotent — safe to call multiple times).
 * 2. Loads incidents, assets, users, IOCs from the provider.
 * 3. Maps each Incident → SpatialIncident (adds position/presentation state).
 * 4. Exposes a focused-incident helper for downstream panels.
 * 5. NEVER calls setState from a RAF or camera frame.
 *
 * Performance contract:
 * - SecurityService data loads are async; results are set via normal React state.
 * - Spatial positions are computed once on load (deterministic), not per-frame.
 * - Only semantic security state lives here (not cursor/pan/zoom — that stays in spatial-transform.ts).
 */

'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { bootstrapSecurity, securityService } from '../../core/bootstrap';
import type { Incident, Severity } from '../../core/models/incident';
import type { Asset, SecurityUser, IOC } from '../../core/models/entity';
import type { ResponseAction } from '../../core/models/response';
import type { AuditRecord } from '../../core/models/audit';
import type { SecurityEvent } from '../../core/models/event';
import type { Alert } from '../../core/models/detection';
import {
  buildSecurityOperationsSnapshot,
  type SecurityOperationsSnapshot,
} from '../../core/security/threat-level-service';

// ─── Spatial presentation state ──────────────────────────────────────────────

export interface SpatialIncident {
  // Reference into the security domain — never duplicates security facts
  incidentId: string;

  // Presentation layer — derived once from security data
  position: { x: number; y: number };   // percent of universe canvas [0–100]
  orbitRadius: number;                   // visual orbit ring radius (px)
  pulseSpeed: number;                    // animation speed derived from risk score
  glowIntensity: number;                 // 0.0–1.0 derived from riskScore
  isFleet: boolean;                      // true for CRITICAL incidents

  // Convenience snapshot (never the source of truth — SecurityService is)
  title: string;
  severity: Incident['severity'];
  riskScore: number;
  status: Incident['status'];
  confidence: number;
  affectedAssetCount: number;
  affectedUserCount: number;
  iocCount: number;
  mitreTechniqueCount: number;
  createdAt: string;
  updatedAt: string;
  summary?: string;
}

export interface SecuritySpatialState {
  isReady: boolean;
  incidents: Incident[];
  spatialIncidents: SpatialIncident[];
  assets: Asset[];
  users: SecurityUser[];
  iocs: IOC[];
  responseActions: ResponseAction[];
  auditLogs: AuditRecord[];
  events: SecurityEvent[];
  alerts: Alert[];
  snapshot: SecurityOperationsSnapshot | null;
  /** Total critical incident count for HUD */
  criticalCount: number;
  /** Aggregate risk score (weighted average) */
  aggregateRisk: number;
}

// ─── Deterministic spatial layout ────────────────────────────────────────────
// Maps a list of incidents to stable spatial positions.
// Uses a spiral/constellation layout so entities don't overlap and
// high-severity incidents are visually prominent (center-adjacent).

function computeSpatialLayout(incidents: Incident[]): SpatialIncident[] {
  // Sort: CRITICAL first, then by riskScore descending
  const sorted = [...incidents].sort((a, b) => {
    const sevOrder: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    const sa = sevOrder[a.severity] ?? 5;
    const sb = sevOrder[b.severity] ?? 5;
    if (sa !== sb) return sa - sb;
    return b.riskScore - a.riskScore;
  });

  const CENTER_X = 50;
  const CENTER_Y = 50;
  const GOLDEN_ANGLE = 137.508; // degrees — sunflower spiral

  return sorted.map((incident, i) => {
    // First (most critical) incident gets center-prominent position
    const isFleet = incident.severity === 'CRITICAL';

    let x: number;
    let y: number;

    if (i === 0) {
      // Flagship incident: upper-center prominence with safe clearance
      x = CENTER_X;
      y = 34;
    } else {
      // Sunflower spiral for remaining incidents bounded within safe central field
      const angle = i * GOLDEN_ANGLE * (Math.PI / 180);
      const radius = 14 + i * 5.5;  // grows outward
      const radiusX = Math.min(radius, 22);  // clamp to central corridor so no flank overlap
      const radiusY = Math.min(radius * 0.7, 24);
      x = CENTER_X + radiusX * Math.cos(angle);
      y = CENTER_Y + radiusY * Math.sin(angle);
    }

    // Clamp to safe central canvas bounds avoiding left/right flanks and top/bottom bars
    x = Math.max(30, Math.min(70, x));
    y = Math.max(24, Math.min(78, y));

    const risk = incident.riskScore;

    return {
      incidentId: incident.id,
      position: { x, y },
      orbitRadius: isFleet ? 72 : 40 + risk * 0.3,
      pulseSpeed: 1 + (risk / 100) * 2.5,
      glowIntensity: Math.min(1, risk / 100),
      isFleet,
      // Snapshot — UI reads these; SecurityService remains authoritative
      title: incident.title,
      severity: incident.severity,
      riskScore: incident.riskScore,
      status: incident.status,
      confidence: incident.confidence,
      affectedAssetCount: incident.affectedAssets.length,
      affectedUserCount: incident.affectedUsers.length,
      iocCount: incident.iocs.length,
      mitreTechniqueCount: incident.mitreTechniques.length,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      summary: incident.summary,
    };
  });
}

// ─── Shared Store & Coalescing Coordinator ────────────────────────────────────

const INITIAL_STATE: SecuritySpatialState = {
  isReady: false,
  incidents: [],
  spatialIncidents: [],
  assets: [],
  users: [],
  iocs: [],
  responseActions: [],
  auditLogs: [],
  events: [],
  alerts: [],
  snapshot: null,
  criticalCount: 0,
  aggregateRisk: 0,
};

export class SecuritySpatialStore {
  private state: SecuritySpatialState = INITIAL_STATE;
  private listeners: Set<() => void> = new Set();
  private unsubs: (() => void)[] = [];
  private subscriberCount = 0;

  // In-flight and coalescing tracking
  private inFlightPromise: Promise<void> | null = null;
  private hasPendingReload = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Monotonically increasing sequence tokens to discard stale out-of-order responses
  private lastRequestId = 0;
  private latestAppliedRequestId = 0;

  // Telemetry metrics for verification and observability
  public reloadExecutionCount = 0;
  public coalescedTriggerCount = 0;

  public getState = (): SecuritySpatialState => {
    return this.state;
  };

  public getSubscriberCount(): number {
    return this.subscriberCount;
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.subscriberCount++;

    if (this.subscriberCount === 1) {
      // First subscriber mounted: attach single set of listeners to securityService
      this.attachSecuritySubscriptions();
      // Schedule initial load
      void this.scheduleReload(true);
    }

    return () => {
      this.listeners.delete(listener);
      this.subscriberCount = Math.max(0, this.subscriberCount - 1);

      if (this.subscriberCount === 0) {
        // All subscribers unmounted: clean up subscriptions and cancel pending timers
        this.detachSecuritySubscriptions();
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        this.hasPendingReload = false;
      }
    };
  };

  private notify() {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('[SecuritySpatialStore] Listener error:', err);
      }
    });
  }

  private attachSecuritySubscriptions() {
    this.detachSecuritySubscriptions();

    const handleEvent = () => {
      this.coalescedTriggerCount++;
      void this.scheduleReload(false);
    };

    this.unsubs = [
      securityService.on('INCIDENTS_UPDATED', handleEvent),
      securityService.on('INCIDENT_DETAIL_UPDATED', handleEvent),
      securityService.on('RESPONSE_ACTION_UPDATED', handleEvent),
      securityService.on('AUDIT_APPENDED', handleEvent),
      securityService.on('SESSION_CHANGED', handleEvent),
      securityService.on('EVENT_INGESTED', handleEvent),
      securityService.on('ALERT_CREATED', handleEvent),
      securityService.on('ALERT_UPDATED', handleEvent),
    ];
  }

  private detachSecuritySubscriptions() {
    if (this.unsubs.length > 0) {
      this.unsubs.forEach((fn) => {
        try {
          fn();
        } catch {
          // Ignore
        }
      });
      this.unsubs = [];
    }
  }

  /**
   * Coalesces rapid reload requests.
   * If immediate is true, triggers right away.
   * If immediate is false, coalesces multiple events arriving within the debounce window (16ms).
   */
  public scheduleReload(immediate = false): Promise<void> {
    if (immediate) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      return this.executeReload();
    }

    if (this.debounceTimer) {
      // Already scheduled for next tick/frame, coalescing this trigger
      return this.inFlightPromise ?? Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.executeReload().then(resolve);
      }, 16);
    });
  }

  /**
   * Refreshes security spatial data immediately.
   */
  public refresh(): Promise<void> {
    return this.scheduleReload(true);
  }

  /**
   * Executes the security service queries, coalescing concurrent in-flight requests
   * and discarding stale responses that resolve out-of-order.
   */
  public executeReload(): Promise<void> {
    if (this.inFlightPromise) {
      // A reload is already in flight. Mark pending so a single trailing reload runs when it finishes.
      this.hasPendingReload = true;
      return this.inFlightPromise;
    }

    const currentReqId = ++this.lastRequestId;

    this.inFlightPromise = (async () => {
      try {
        await bootstrapSecurity();

        const [incidents, assets, users, iocs, responseActions, auditLogs, events, alerts] =
          await Promise.all([
            securityService.getIncidents(),
            securityService.getAssets(),
            securityService.getUsers(),
            securityService.getIOCs(),
            securityService.getResponseActions(),
            securityService.getAuditLogs(),
            securityService.getEvents({ limit: 100 }),
            securityService.getAlerts({ limit: 100 }),
          ]);

        // STALE RESPONSE PROTECTION:
        // If a newer reload completed while this request was in flight, discard this older result.
        if (currentReqId < this.latestAppliedRequestId) {
          return;
        }
        this.latestAppliedRequestId = currentReqId;
        this.reloadExecutionCount++;

        const spatialIncidents = computeSpatialLayout(incidents);
        const criticalCount = incidents.filter((i) => i.severity === 'CRITICAL').length;
        const aggregateRisk =
          incidents.length > 0
            ? incidents.reduce((sum, i) => sum + i.riskScore, 0) / incidents.length
            : 0;

        const snapshot = buildSecurityOperationsSnapshot(
          incidents,
          assets,
          iocs,
          responseActions,
          auditLogs,
          events,
          alerts
        );

        this.state = {
          isReady: true,
          incidents,
          spatialIncidents,
          assets,
          users,
          iocs,
          responseActions,
          auditLogs,
          events,
          alerts,
          snapshot,
          criticalCount,
          aggregateRisk,
        };

        this.notify();
      } catch (err) {
        console.error('[useSecuritySpatial] load failed:', (err as Error).message ?? err);
      } finally {
        this.inFlightPromise = null;
        if (this.hasPendingReload) {
          this.hasPendingReload = false;
          // Trigger the coalesced trailing reload to ensure we have the absolute latest state
          void this.executeReload();
        }
      }
    })();

    return this.inFlightPromise;
  }

  /**
   * Test-only helper to reset state between isolated test runs.
   */
  public _resetForTest() {
    this.detachSecuritySubscriptions();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.state = { ...INITIAL_STATE };
    this.listeners.clear();
    this.subscriberCount = 0;
    this.inFlightPromise = null;
    this.hasPendingReload = false;
    this.lastRequestId = 0;
    this.latestAppliedRequestId = 0;
    this.reloadExecutionCount = 0;
    this.coalescedTriggerCount = 0;
  }
}

export const securitySpatialStore = new SecuritySpatialStore();

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSecuritySpatial(): SecuritySpatialState & {
  refresh: () => void;
  getFocusedIncident: (id: string | null) => Incident | null;
} {
  const state = useSyncExternalStore(
    securitySpatialStore.subscribe,
    securitySpatialStore.getState,
    securitySpatialStore.getState
  );

  const refresh = useCallback(() => {
    void securitySpatialStore.refresh();
  }, []);

  const getFocusedIncident = useCallback((id: string | null): Incident | null => {
    if (!id) return null;
    return securitySpatialStore.getState().incidents.find((i) => i.id === id) ?? null;
  }, []);

  return { ...state, refresh, getFocusedIncident };
}

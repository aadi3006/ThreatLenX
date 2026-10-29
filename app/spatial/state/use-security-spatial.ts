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
import { useEffect, useState, useCallback, useRef } from 'react';
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
      // Flagship incident: upper-center prominence
      x = CENTER_X;
      y = 32;
    } else {
      // Sunflower spiral for remaining incidents
      const angle = i * GOLDEN_ANGLE * (Math.PI / 180);
      const radius = 14 + i * 5.5;  // grows outward
      const radiusX = Math.min(radius, 36);  // clamp to canvas
      const radiusY = Math.min(radius * 0.7, 30);
      x = CENTER_X + radiusX * Math.cos(angle);
      y = CENTER_Y + radiusY * Math.sin(angle);
    }

    // Clamp to safe canvas bounds
    x = Math.max(8, Math.min(92, x));
    y = Math.max(10, Math.min(88, y));

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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSecuritySpatial(): SecuritySpatialState & {
  refresh: () => void;
  getFocusedIncident: (id: string | null) => Incident | null;
} {
  const [state, setState] = useState<SecuritySpatialState>({
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
  });

  const incidentsRef = useRef<Incident[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [incidents, assets, users, iocs, responseActions, auditLogs, events, alerts] = await Promise.all([
        securityService.getIncidents(),
        securityService.getAssets(),
        securityService.getUsers(),
        securityService.getIOCs(),
        securityService.getResponseActions(),
        securityService.getAuditLogs(),
        securityService.getEvents({ limit: 100 }),
        securityService.getAlerts({ limit: 100 }),
      ]);

      incidentsRef.current = incidents;

      const spatialIncidents = computeSpatialLayout(incidents);
      const criticalCount = incidents.filter((i) => i.severity === 'CRITICAL').length;
      const aggregateRisk = incidents.length > 0
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

      setState({
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
      });
    } catch (err) {
      console.error('[useSecuritySpatial] load failed:', (err as Error).message ?? err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    bootstrapSecurity()
      .then(() => {
        if (!cancelled) return loadData();
      })
      .catch((err) => {
        console.error('[useSecuritySpatial] bootstrap failed:', err);
      });

    // Subscribe to SecurityService events to keep state fresh
    const unsubs = [
      securityService.on('INCIDENTS_UPDATED', () => { if (!cancelled) void loadData(); }),
      securityService.on('INCIDENT_DETAIL_UPDATED', () => { if (!cancelled) void loadData(); }),
      securityService.on('RESPONSE_ACTION_UPDATED', () => { if (!cancelled) void loadData(); }),
      securityService.on('AUDIT_APPENDED', () => { if (!cancelled) void loadData(); }),
      securityService.on('SESSION_CHANGED', () => { if (!cancelled) void loadData(); }),
      securityService.on('EVENT_INGESTED', () => { if (!cancelled) void loadData(); }),
      securityService.on('ALERT_CREATED', () => { if (!cancelled) void loadData(); }),
      securityService.on('ALERT_UPDATED', () => { if (!cancelled) void loadData(); }),
    ];

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, [loadData]);

  const getFocusedIncident = useCallback((id: string | null): Incident | null => {
    if (!id) return null;
    return incidentsRef.current.find((i) => i.id === id) ?? null;
  }, []);

  return { ...state, refresh: loadData, getFocusedIncident };
}

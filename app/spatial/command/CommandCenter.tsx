/**
 * CommandCenter.tsx
 *
 * EXPLAIN-SEC SPATIAL — Stage 1 SOC Command Center.
 *
 * A spatial-native operational command layer that sits above and around
 * the Incident Universe, delivering persistent real-time situational awareness:
 * - Deterministic threat level calculation & factor breakdown.
 * - Live operational security metrics derived strictly from SecurityService.
 * - Active Incident discovery & direct transition into the existing cinematic
 *   investigation state machine (PROXIMITY -> FOCUSING -> INVESTIGATION_OPEN).
 * - Asset environment posture (Compromised, Isolated, Suspicious, Healthy).
 * - SOAR response action operational pipeline.
 * - Live chronological activity stream from real audit records and timeline events.
 *
 * Performance contract:
 * - 0 extra RAF loops (pure CSS animations and declarative React state).
 * - Adapts visual complexity to performance tier (FULL, REDUCED, LOW).
 * - 100% offline, zero network / external calls.
 */

'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Incident } from '../../core/models/incident';
import type { Asset, IOC } from '../../core/models/entity';
import type { ResponseAction } from '../../core/models/response';
import type { SecurityOperationsSnapshot, ThreatLevel } from '../../core/security/threat-level-service';
import type { PerformanceMode } from '../performance-mode';
import type { EventCategory } from '../../core/models/event';
import type { Alert, AlertStatus } from '../../core/models/detection';
import type { ThreatIntelRecord } from '../../core/models/threat-intel';
import type { SocOperationalSnapshot } from '../../core/models/metrics';
import { ThreatIntelProfile } from '../intel/ThreatIntelProfile';
import { securityService } from '../../core/security-service';
import {
  ShieldAlert,
  AlertTriangle,
  Radio,
  Server,
  Activity,
  Layers,
  Zap,
  Eye,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Lock,
  Unlock,
  CheckCircle2,
  Clock,
  ExternalLink,
  Sliders,
  Filter,
  Plus,
  Bell,
  CheckCheck,
  Check,
  AlertCircle,
  X,
  Target,
  Briefcase,
  FileCheck,
  ArrowLeft,
  Cloud,
} from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';
import './command-center.css';

interface CommandCenterProps {
  snapshot: SecurityOperationsSnapshot | null;
  incidents: Incident[];
  assets: Asset[];
  iocs: IOC[];
  responseActions: ResponseAction[];
  isFocused: boolean;
  perfMode: PerformanceMode;
  onSelectIncident: (incidentId: string) => void;
  onSelectAsset?: (assetId: string) => void;
  onCreateIncident?: () => void;
  onOpenThreatHunting?: () => void;
  onOpenCases?: () => void;
  onOpenEvidence?: () => void;
  onClose?: () => void;
  onOpenMetrics?: () => void;
}

const SIMULATION_TEMPLATES = [
  {
    eventType: 'SUSPICIOUS_EXECUTION',
    category: 'PROCESS' as const,
    severity: 'HIGH' as const,
    source: 'EDR-AGENT-FINWS027',
    sourceType: 'ENDPOINT' as const,
    assetId: 'asset-001',
    userId: 'user-001',
    incidentId: 'incident-001',
    processName: 'powershell.exe',
    commandLine: 'powershell.exe -NonI -W Hidden -Exec Bypass -Enc aW52b2tlLW1pbWlrYXR6...',
    message: 'Detected obfuscated Base64 PowerShell memory execution on FINWS-027',
  },
  {
    eventType: 'C2_BEACON_DETECTED',
    category: 'NETWORK' as const,
    severity: 'CRITICAL' as const,
    source: 'FW-CORE-01',
    sourceType: 'FIREWALL' as const,
    assetId: 'asset-001',
    incidentId: 'incident-001',
    srcIp: '10.100.4.27',
    dstIp: '185.220.101.5',
    dstPort: 443,
    protocol: 'HTTPS',
    domain: 'update-service-telemetry.com',
    message: 'Outbound beacon matching Cobalt Strike jitter profile to known malicious C2 IP',
  },
  {
    eventType: 'BRUTE_FORCE_BURST',
    category: 'AUTHENTICATION' as const,
    severity: 'MEDIUM' as const,
    source: 'AUTH-KERBEROS-DC01',
    sourceType: 'AUTH' as const,
    assetId: 'asset-004',
    userId: 'user-002',
    incidentId: 'incident-001',
    message: '12 failed Kerberos pre-authentication attempts within 10 seconds for user m.chen',
  },
  {
    eventType: 'PERSISTENCE_REGISTRY_MOD',
    category: 'ENDPOINT' as const,
    severity: 'HIGH' as const,
    source: 'EDR-AGENT-APP01',
    sourceType: 'ENDPOINT' as const,
    assetId: 'asset-002',
    processName: 'cmd.exe',
    commandLine: 'reg add HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v SecHealth /t REG_SZ /d C:\\temp\\svc.exe',
    message: 'Unauthorized Run key modification attempt detected in HKLM registry',
  },
  {
    eventType: 'SENSITIVE_FILE_EXFIL_STAGE',
    category: 'FILE' as const,
    severity: 'HIGH' as const,
    source: 'EDR-DLP-AGENT',
    sourceType: 'ENDPOINT' as const,
    assetId: 'asset-003',
    userId: 'user-003',
    incidentId: 'incident-001',
    fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    message: 'Archive utility 7z.exe created password-protected archive of confidential financial reports',
  },
];

export default function CommandCenter({
  snapshot,
  incidents,
  assets,
  iocs,
  responseActions,
  isFocused,
  perfMode,
  onSelectIncident,
  onSelectAsset,
  onCreateIncident,
  onOpenThreatHunting,
  onOpenCases,
  onOpenEvidence,
  onClose,
  onOpenMetrics,
}: CommandCenterProps) {
  const [socSnapshot, setSocSnapshot] = useState<SocOperationalSnapshot | null>(null);

  // Collapsible flank wings to let the analyst view unobstructed universe when desired
  const [wingsMinimized, setWingsMinimized] = useState(false);
  const [leftPillarMode, setLeftPillarMode] = useState<'INCIDENTS' | 'ALERTS'>('INCIDENTS');
  const [activeIncidentFilter, setActiveIncidentFilter] = useState<'ALL' | 'CRITICAL' | 'INVESTIGATING'>('ALL');
  const [alertFilter, setAlertFilter] = useState<'ALL' | 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CRITICAL'>('ALL');
  const [showAlertDrawer, setShowAlertDrawer] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [isAlertActionPending, setIsAlertActionPending] = useState(false);
  const [selectedSourceEventId, setSelectedSourceEventId] = useState<string | null>(null);
  const [showThreatDrawer, setShowThreatDrawer] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [eventCategoryFilter, setEventCategoryFilter] = useState<string>('ALL');
  const [isSimulating, setIsSimulating] = useState(false);

  // Evidence Operational Metrics
  const [evidenceStats, setEvidenceStats] = useState<{
    total: number;
    underReview: number;
    validated: number;
    mismatch: number;
  }>({ total: 0, underReview: 0, validated: 0, mismatch: 0 });

  // Threat Intelligence Operational Metrics
  const [intelRecords, setIntelRecords] = useState<ThreatIntelRecord[]>([]);
  const [selectedIntelIocId, setSelectedIntelIocId] = useState<string | null>(null);

  // SOAR Operational Metrics
  const [soarStats, setSoarStats] = useState<{
    activeExecutions: number;
    awaitingApproval: number;
    completedExecutions: number;
    failedExecutions: number;
    recentExecutions: any[];
  }>({
    activeExecutions: 0,
    awaitingApproval: 0,
    completedExecutions: 0,
    failedExecutions: 0,
    recentExecutions: [],
  });

  useEffect(() => {
    async function loadStats() {
      try {
        const evds = await securityService.getEvidence();
        const total = evds.length;
        const underReview = evds.filter((e) => e.status === 'UNDER_REVIEW').length;
        const validated = evds.filter((e) => e.status === 'VALIDATED').length;
        const mismatch = evds.filter((e) => e.integrity.verified === false).length;
        setEvidenceStats({ total, underReview, validated, mismatch });
      } catch {
        // ignore offline initialization delay
      }
    }
    async function loadIntel() {
      try {
        const recs = await securityService.getThreatIntelRecords();
        setIntelRecords(recs);
      } catch {
        // ignore offline initialization delay
      }
    }
    async function loadSoarStats() {
      try {
        const execs = await securityService.getPlaybookExecutions();
        const apps = await securityService.getApprovals();
        const active = execs.filter((e) => e.status === 'RUNNING' || e.status === 'QUEUED').length;
        const awaiting = apps.filter((a) => a.status === 'PENDING').length + execs.filter((e) => e.status === 'WAITING_APPROVAL').length;
        const completed = execs.filter((e) => e.status === 'COMPLETED').length;
        const failed = execs.filter((e) => e.status === 'FAILED' || e.status === 'CANCELLED').length;
        setSoarStats({
          activeExecutions: active,
          awaitingApproval: awaiting,
          completedExecutions: completed,
          failedExecutions: failed,
          recentExecutions: execs.slice(0, 5),
        });
      } catch {
        // ignore offline initialization delay
      }
    }
    loadStats();
    loadIntel();
    loadSoarStats();

    async function loadSnapshot() {
      try {
        const snap = await securityService.getSocOperationalSnapshot({ window: 'LAST_24_HOURS' });
        setSocSnapshot(snap);
      } catch {
        // offline init
      }
    }
    loadSnapshot();

    const unsubMetrics = securityService.subscribe('METRICS_UPDATED', () => loadSnapshot());
    const unsub1 = securityService.subscribe('EVIDENCE_COLLECTED', () => loadStats());
    const unsub2 = securityService.subscribe('EVIDENCE_UPDATED', () => loadStats());
    const unsub3 = securityService.subscribe('EVIDENCE_VERIFIED', () => loadStats());
    const unsub4 = securityService.subscribe('THREAT_INTEL_CREATED', () => loadIntel());
    const unsub5 = securityService.subscribe('THREAT_INTEL_UPDATED', () => loadIntel());
    const unsub6 = securityService.subscribe('THREAT_INTEL_ENRICHED', () => loadIntel());
    const unsub7 = securityService.subscribe('PLAYBOOK_EXECUTION_CREATED', () => loadSoarStats());
    const unsub8 = securityService.subscribe('PLAYBOOK_EXECUTION_UPDATED', () => loadSoarStats());
    const unsub9 = securityService.subscribe('PLAYBOOK_APPROVAL_UPDATED', () => loadSoarStats());
    const unsub10 = securityService.subscribe('PLAYBOOKS_UPDATED', () => loadSoarStats());
    return () => {
      unsubMetrics();
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
      unsub6();
      unsub7();
      unsub8();
      unsub9();
      unsub10();
    };
  }, []);

  const highConfIocsCount = useMemo(
    () => intelRecords.filter((r) => r.confidence === 'HIGH').length,
    [intelRecords]
  );

  // Filter active incidents
  const activeIncidents = useMemo(() => {
    return incidents.filter(
      (inc) => inc.status !== 'RESOLVED' && inc.status !== 'CLOSED' && inc.status !== 'FALSE_POSITIVE'
    );
  }, [incidents]);

  const displayedIncidents = useMemo(() => {
    if (activeIncidentFilter === 'CRITICAL') {
      return activeIncidents.filter((i) => i.severity === 'CRITICAL');
    }
    if (activeIncidentFilter === 'INVESTIGATING') {
      return activeIncidents.filter((i) => i.status === 'INVESTIGATING');
    }
    return activeIncidents;
  }, [activeIncidents, activeIncidentFilter]);

  // Alert calculations and filtering
  const alertsList = useMemo(() => snapshot?.alerts ?? [], [snapshot?.alerts]);

  const displayedAlerts = useMemo(() => {
    if (alertFilter === 'CRITICAL') {
      return alertsList.filter((a) => a.severity === 'CRITICAL');
    }
    if (alertFilter === 'NEW') {
      return alertsList.filter((a) => a.status === 'NEW');
    }
    if (alertFilter === 'ACKNOWLEDGED') {
      return alertsList.filter((a) => a.status === 'ACKNOWLEDGED');
    }
    if (alertFilter === 'RESOLVED') {
      return alertsList.filter((a) => a.status === 'RESOLVED');
    }
    return alertsList;
  }, [alertsList, alertFilter]);

  const selectedAlert = useMemo(() => {
    if (!selectedAlertId) return displayedAlerts[0] ?? null;
    return alertsList.find((a) => a.id === selectedAlertId) ?? displayedAlerts[0] ?? null;
  }, [alertsList, selectedAlertId, displayedAlerts]);

  const selectedSourceEvent = useMemo(() => {
    if (!selectedSourceEventId || !snapshot?.recentSecurityEvents) return null;
    return snapshot.recentSecurityEvents.find((e) => e.id === selectedSourceEventId) ?? null;
  }, [selectedSourceEventId, snapshot?.recentSecurityEvents]);

  // Asset breakdown
  const compromisedAssets = useMemo(() => assets.filter((a) => a.status === 'COMPROMISED'), [assets]);
  const isolatedAssets = useMemo(() => assets.filter((a) => a.status === 'ISOLATED'), [assets]);
  const suspiciousAssets = useMemo(() => assets.filter((a) => a.status === 'SUSPICIOUS'), [assets]);
  const healthyAssets = useMemo(() => assets.filter((a) => a.status === 'HEALTHY'), [assets]);

  // Priority response actions (pending or active)
  const activeResponses = useMemo(() => {
    return responseActions.filter(
      (ra) => ra.status === 'PENDING_APPROVAL' || ra.status === 'REQUESTED' || ra.status === 'EXECUTING'
    );
  }, [responseActions]);

  const handleIncidentClick = useCallback(
    (id: string) => {
      cyberAudio.playSelect();
      onSelectIncident(id);
    },
    [onSelectIncident]
  );

  const handleSelectAlert = useCallback((alertId: string) => {
    cyberAudio.playSelect();
    setSelectedAlertId(alertId);
    setSelectedSourceEventId(null);
    setShowAlertDrawer(true);
  }, []);

  const handleAcknowledgeAlert = useCallback(async (alertId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsAlertActionPending(true);
    cyberAudio.playClick();
    try {
      await securityService.acknowledgeAlert(alertId);
      cyberAudio.playSuccess();
    } catch (err) {
      console.error('[CommandCenter] Failed to acknowledge alert:', err);
    } finally {
      setIsAlertActionPending(false);
    }
  }, []);

  const handleResolveAlert = useCallback(async (alertId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsAlertActionPending(true);
    cyberAudio.playClick();
    try {
      await securityService.resolveAlert(alertId);
      cyberAudio.playSuccess();
    } catch (err) {
      console.error('[CommandCenter] Failed to resolve alert:', err);
    } finally {
      setIsAlertActionPending(false);
    }
  }, []);

  const toggleWings = useCallback(() => {
    cyberAudio.playClick();
    setWingsMinimized((prev) => !prev);
  }, []);

  const toggleThreatDrawer = useCallback(() => {
    cyberAudio.playClick();
    setShowThreatDrawer((prev) => !prev);
  }, []);

  const handleIngestSimEvent = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSimulating(true);
    cyberAudio.playClick();
    try {
      const template = SIMULATION_TEMPLATES[Math.floor(Math.random() * SIMULATION_TEMPLATES.length)];
      const simEvent = {
        ...template,
        timestamp: new Date().toISOString(),
      };
      const result = await securityService.ingestEvent(simEvent);
      if (result.success) {
        cyberAudio.playAlert();
      }
    } catch (err) {
      console.error('[CommandCenter] Failed to ingest simulated event:', err);
    } finally {
      setIsSimulating(false);
    }
  }, []);

  const displayedEvents = useMemo(() => {
    if (!snapshot) return [];
    let list = snapshot.recentEvents;
    if (eventCategoryFilter !== 'ALL') {
      list = list.filter((ev) => ev.category === eventCategoryFilter || ev.status === eventCategoryFilter);
    }
    return list.slice(0, activityExpanded ? 30 : 6);
  }, [snapshot, eventCategoryFilter, activityExpanded]);

  if (!snapshot) {
    return null;
  }

  const threatColor =
    snapshot.threatLevel === 'CRITICAL'
      ? '#ff2a2a'
      : snapshot.threatLevel === 'HIGH'
      ? '#ff7700'
      : snapshot.threatLevel === 'ELEVATED'
      ? '#ffb700'
      : '#3dffb0';

  // In focused mode (investigation open), render only an ambient top-line telemetry ribbon
  if (isFocused) {
    return (
      <aside
        className={`soc-command-center mode-focused tier-${perfMode.toLowerCase()}`}
        aria-label="SOC Operational Threat Status"
      >
        <div className="soc-threat-ribbon">
          <div className="soc-threat-pill" style={{ borderColor: threatColor, color: threatColor }}>
            <span className="soc-pulse-beacon" style={{ backgroundColor: threatColor }} />
            <span className="soc-threat-title">THREAT LEVEL // {snapshot.threatLevel}</span>
            <span className="soc-threat-score">[{snapshot.threatScore}/100]</span>
          </div>

          <div className="soc-ribbon-metrics">
            <span className="ribbon-item">
              <span className="ribbon-label">ACTIVE INCIDENTS:</span>
              <strong className="ribbon-val">{snapshot.activeIncidents}</strong>
            </span>
            <span className="ribbon-divider">·</span>
            <span className="ribbon-item">
              <span className="ribbon-label">OPEN ALERTS:</span>
              <strong className="ribbon-val">{snapshot.openAlerts}</strong>
            </span>
            <span className="ribbon-divider">·</span>
            <span className="ribbon-item">
              <span className="ribbon-label">COMPROMISED HOSTS:</span>
              <strong className="ribbon-val" style={{ color: snapshot.compromisedAssets > 0 ? '#ff2a2a' : '#3dffb0' }}>
                {snapshot.compromisedAssets}
              </strong>
            </span>
            <span className="ribbon-divider">·</span>
            <span className="ribbon-item">
              <span className="ribbon-label">PENDING SOAR:</span>
              <strong className="ribbon-val" style={{ color: snapshot.pendingApprovals > 0 ? '#ffb700' : '#00f0ff' }}>
                {snapshot.pendingApprovals}
              </strong>
            </span>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <div
      className={`soc-command-center tier-${perfMode.toLowerCase()} ${wingsMinimized ? 'wings-minimized' : ''}`}
      aria-label="SOC Command Center Operational Layer"
    >
      {/* ─── TOP SECTOR: THREAT STATE BEACON & TELEMETRY ARC ─── */}
      <header className="soc-top-sector">
        <div className="soc-threat-beacon-wrap">
          <div
            className={`soc-threat-beacon level-${snapshot.threatLevel.toLowerCase()}`}
            style={{ '--threat-accent': threatColor } as React.CSSProperties}
            onClick={toggleThreatDrawer}
            title="Click to inspect deterministic threat scoring breakdown"
            role="button"
            tabIndex={0}
          >
            <div className="beacon-radar-ring" />
            <div className="beacon-core">
              <ShieldAlert size={16} color={threatColor} />
              <div className="beacon-text-col">
                <div className="beacon-header-row">
                  <span className="beacon-sub">DEFCON STATUS</span>
                  <span className="beacon-score-tag">SCORE {snapshot.threatScore}</span>
                </div>
                <strong className="beacon-level">{snapshot.threatLevel}</strong>
              </div>
            </div>
            <button className="beacon-expand-btn" aria-label="Toggle threat breakdown">
              {showThreatDrawer ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          {/* Threat Breakdown Drawer */}
          {showThreatDrawer && (
            <div className="soc-threat-drawer">
              <div className="drawer-header">
                <span>DETERMINISTIC THREAT SCORING LOGIC</span>
                <span className="text-accent">{snapshot.threatScore} / 100</span>
              </div>
              <div className="drawer-factors">
                {snapshot.threatFactors.length === 0 ? (
                  <div className="factor-row empty">Normal security baseline. Zero active critical vectors.</div>
                ) : (
                  snapshot.threatFactors.map((f, i) => (
                    <div key={i} className="factor-row">
                      <div className="factor-desc">{f.description}</div>
                      <div className="factor-pts">+{f.contribution} pts</div>
                    </div>
                  ))
                )}
              </div>
              <div className="drawer-footer">
                Derived directly from active incidents, compromised hosts, unblocked IOCs, and pending response actions.
              </div>
            </div>
          )}
        </div>

        {/* Operational Overview Badges */}
        <div className="soc-kpi-halo">
          <div className="kpi-cell" title="Total active unclosed security incidents">
            <span className="kpi-num" style={{ color: snapshot.criticalIncidents > 0 ? '#ff2a2a' : '#00f0ff' }}>
              {snapshot.activeIncidents}
            </span>
            <span className="kpi-lbl">INCIDENTS</span>
            <span className="kpi-sub">{snapshot.criticalIncidents} CRIT</span>
          </div>

          <div
            className={`kpi-cell kpi-alerts-cell ${showAlertDrawer ? 'active' : ''}`}
            title="Correlated SIEM/EDR detection alerts — Click to open Alert Inspector"
            onClick={() => {
              cyberAudio.playClick();
              setShowAlertDrawer((prev) => !prev);
              if (!showAlertDrawer && displayedAlerts.length > 0 && !selectedAlertId) {
                setSelectedAlertId(displayedAlerts[0].id);
              }
            }}
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
          >
            <span className="kpi-num" style={{ color: snapshot.criticalAlerts > 0 ? '#ff2a2a' : '#00f0ff' }}>
              {snapshot.openAlerts}
            </span>
            <span className="kpi-lbl">OPEN ALERTS</span>
            <span className="kpi-sub">
              {snapshot.criticalAlerts} CRIT · {snapshot.highAlerts} HIGH
            </span>
          </div>

          <div className="kpi-cell" title="Compromised and isolated network hosts">
            <span className="kpi-num" style={{ color: snapshot.compromisedAssets > 0 ? '#ff2a2a' : '#3dffb0' }}>
              {snapshot.compromisedAssets}
            </span>
            <span className="kpi-lbl">COMPROMISED</span>
            <span className="kpi-sub">{snapshot.isolatedAssets} ISOLATED</span>
          </div>

          <div
            className="kpi-cell"
            style={{ cursor: 'pointer' }}
            title="Threat Intelligence & Indicators of Compromise — Click to inspect"
            onClick={() => {
              if (intelRecords.length > 0) {
                setSelectedIntelIocId(intelRecords[0].indicatorId);
              }
            }}
          >
            <span className="kpi-num" style={{ color: highConfIocsCount > 0 ? '#ff7700' : '#3dffb0' }}>
              {snapshot.activeIOCs}
            </span>
            <span className="kpi-lbl">IOC INTEL</span>
            <span className="kpi-sub" style={{ color: '#00f0ff' }}>
              {highConfIocsCount} HIGH CONF
            </span>
          </div>

          <div className="kpi-cell" title="Active SOAR playbooks and containment actions">
            <span className="kpi-num" style={{ color: snapshot.activeResponseActions > 0 ? '#ffb700' : '#3dffb0' }}>
              {snapshot.activeResponseActions}
            </span>
            <span className="kpi-lbl">RESPONSE OPS</span>
            <span className="kpi-sub">{snapshot.pendingApprovals} APPROVAL</span>
          </div>

          {/* Threat Hunting Quick-Switch Cell */}
          <div
            className="kpi-cell kpi-hunts-cell"
            title="Proactive offline threat hunting workspace [HotKey: H] — Click to enter"
            onClick={() => {
              cyberAudio.playClick();
              onOpenThreatHunting?.();
            }}
            role="button"
            tabIndex={0}
            style={{
              cursor: 'pointer',
              border: '1px solid rgba(0, 240, 255, 0.4)',
              background: 'rgba(0, 240, 255, 0.08)',
            }}
          >
            <span className="kpi-num" style={{ color: '#00f0ff' }}>
              <Target size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              HUNT
            </span>
            <span className="kpi-lbl">THREAT HUNTING</span>
            <span className="kpi-sub" style={{ color: '#3dffb0' }}>WORKSPACE [H]</span>
          </div>

          {/* Cases Management Quick-Switch Cell */}
          <div
            className="kpi-cell kpi-cases-cell"
            title="Operational Case Management workspace [HotKey: C] — Click to enter"
            onClick={() => {
              cyberAudio.playClick();
              onOpenCases?.();
            }}
            role="button"
            tabIndex={0}
            style={{
              cursor: 'pointer',
              border: '1px solid rgba(0, 240, 255, 0.4)',
              background: 'rgba(0, 240, 255, 0.08)',
            }}
          >
            <span className="kpi-num" style={{ color: '#00f0ff' }}>
              <Briefcase size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              CASES
            </span>
            <span className="kpi-lbl">OPERATIONAL</span>
            <span className="kpi-sub" style={{ color: '#3dffb0' }}>WORKSPACE [C]</span>
          </div>

          {/* Evidence Vault Quick-Switch Cell */}
          <div
            className="kpi-cell kpi-evidence-cell"
            title="Evidence Vault & Chain of Custody [HotKey: E] — Click to enter"
            onClick={() => {
              cyberAudio.playClick();
              onOpenEvidence?.();
            }}
            role="button"
            tabIndex={0}
            style={{
              cursor: 'pointer',
              border: evidenceStats.mismatch > 0 ? '1px solid #ff5555' : '1px solid rgba(0, 240, 255, 0.4)',
              background: evidenceStats.mismatch > 0 ? 'rgba(255, 75, 75, 0.12)' : 'rgba(0, 240, 255, 0.08)',
            }}
          >
            <span className="kpi-num" style={{ color: evidenceStats.mismatch > 0 ? '#ff5555' : '#00f0ff' }}>
              <FileCheck size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              {evidenceStats.total}
            </span>
            <span className="kpi-lbl">
              {evidenceStats.mismatch > 0 ? 'INTEGRITY ALERT' : 'EVIDENCE VAULT'}
            </span>
            <span className="kpi-sub" style={{ color: evidenceStats.mismatch > 0 ? '#ff5555' : '#3dffb0' }}>
              {evidenceStats.mismatch > 0
                ? `${evidenceStats.mismatch} MISMATCH`
                : `${evidenceStats.underReview} REV • ${evidenceStats.validated} VAL`}
            </span>
          </div>

          {/* SOC Metrics & Analytics Quick-Switch Cell */}
          <div
            className="kpi-cell kpi-metrics-cell"
            title="SOC Metrics & Operational Analytics workspace [HotKey: M] — Click to enter"
            onClick={() => {
              cyberAudio.playClick();
              onOpenMetrics?.();
            }}
            role="button"
            tabIndex={0}
            style={{
              cursor: 'pointer',
              border: '1px solid rgba(0, 240, 255, 0.4)',
              background: 'rgba(0, 240, 255, 0.08)',
            }}
          >
            <span className="kpi-num" style={{ color: '#00f0ff' }}>
              <Activity size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              METRICS
            </span>
            <span className="kpi-lbl">OPERATIONAL</span>
            <span className="kpi-sub" style={{ color: '#3dffb0' }}>
              {socSnapshot ? `MTTD ${socSnapshot.mttd.formattedValue}` : 'ANALYTICS [M]'}
            </span>
          </div>

          {/* Integration Seam Quick-Switch Cell (Step 14) */}
          <div
            className="kpi-cell kpi-integration-cell"
            title="External & Cloud Integration Architecture [HotKey: I] — Click to open"
            onClick={() => {
              cyberAudio.playClick();
              window.dispatchEvent(new CustomEvent('explainsec:toggle-integration-panel'));
            }}
            role="button"
            tabIndex={0}
            style={{
              cursor: 'pointer',
              border: '1px solid rgba(0, 240, 255, 0.4)',
              background: 'rgba(0, 240, 255, 0.08)',
            }}
          >
            <span className="kpi-num" style={{ color: '#00f0ff' }}>
              <Cloud size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              SEAMS
            </span>
            <span className="kpi-lbl">INTEGRATION</span>
            <span className="kpi-sub" style={{ color: '#3dffb0' }}>
              SEAM & SYNC [I]
            </span>
          </div>

          {/* Offline Incident Creation Button */}
          {onCreateIncident && (
            <button
              className="inc-create-btn"
              onClick={() => {
                cyberAudio.playClick();
                onCreateIncident();
              }}
              style={{
                background: 'rgba(0, 240, 255, 0.15)',
                border: '1px solid rgba(0, 240, 255, 0.4)',
                color: '#00f0ff',
                padding: '6px 10px',
                borderRadius: 4,
                fontSize: 9,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                letterSpacing: '0.06em',
              }}
              title="Create a new incident offline"
            >
              <Plus size={11} /> NEW INCIDENT
            </button>
          )}

                    {/* Return to Spatial Hub Button */}
          {onClose && (
            <button
              className="wings-toggle-btn hub-return-btn"
              onClick={() => {
                cyberAudio.playClick();
                onClose();
              }}
              title="Return to Spatial Command Hub [ESC]"
              style={{ borderColor: "rgba(0, 240, 255, 0.4)", color: "#00f0ff" }}
            >
              <ArrowLeft size={12} />
              <span>HUB [ESC]</span>
            </button>
          )}
          {/* Toggle Wings Button */}
          <button
            className="wings-toggle-btn"
            onClick={toggleWings}
            title={wingsMinimized ? 'Expand Command Panels' : 'Minimize Panels (Unobstructed Universe)'}
          >
            {wingsMinimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
            <span>{wingsMinimized ? 'EXPAND HUD' : 'MINIMIZE HUD'}</span>
          </button>
        </div>
      </header>

      {/* ─── LEFT FLANK: ACTIVE INCIDENT COMMAND / ALERT PILLAR ─── */}
      {!wingsMinimized && (
        <aside className="soc-left-flank" aria-label="Incident and Alert Command View">
          <div className="flank-header">
            <div className="flank-mode-selector">
              <button
                className={`flank-mode-tab ${leftPillarMode === 'INCIDENTS' ? 'active' : ''}`}
                onClick={() => {
                  cyberAudio.playClick();
                  setLeftPillarMode('INCIDENTS');
                }}
              >
                <Radio size={11} className={leftPillarMode === 'INCIDENTS' ? 'text-cyan animate-pulse' : ''} />
                <span>INCIDENTS ({activeIncidents.length})</span>
              </button>
              <button
                className={`flank-mode-tab ${leftPillarMode === 'ALERTS' ? 'active' : ''}`}
                onClick={() => {
                  cyberAudio.playClick();
                  setLeftPillarMode('ALERTS');
                }}
              >
                <Bell size={11} className={leftPillarMode === 'ALERTS' ? 'text-amber animate-pulse' : ''} />
                <span>ALERTS ({snapshot.openAlerts})</span>
              </button>
            </div>

            {/* Quick Filter for Incidents */}
            {leftPillarMode === 'INCIDENTS' && (
              <div className="flank-filter-tabs">
                <button
                  className={`filter-tab ${activeIncidentFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setActiveIncidentFilter('ALL')}
                >
                  ALL ({activeIncidents.length})
                </button>
                <button
                  className={`filter-tab ${activeIncidentFilter === 'CRITICAL' ? 'active' : ''}`}
                  onClick={() => setActiveIncidentFilter('CRITICAL')}
                >
                  CRITICAL ({snapshot.criticalIncidents})
                </button>
                <button
                  className={`filter-tab ${activeIncidentFilter === 'INVESTIGATING' ? 'active' : ''}`}
                  onClick={() => setActiveIncidentFilter('INVESTIGATING')}
                >
                  ACTIVE ({snapshot.activeInvestigations})
                </button>
              </div>
            )}

            {/* Quick Filter for Alerts */}
            {leftPillarMode === 'ALERTS' && (
              <div className="flank-filter-tabs">
                <button
                  className={`filter-tab ${alertFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('ALL')}
                >
                  ALL ({alertsList.length})
                </button>
                <button
                  className={`filter-tab ${alertFilter === 'CRITICAL' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('CRITICAL')}
                >
                  CRIT ({snapshot.criticalAlerts})
                </button>
                <button
                  className={`filter-tab ${alertFilter === 'NEW' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('NEW')}
                >
                  NEW ({alertsList.filter((a) => a.status === 'NEW').length})
                </button>
              </div>
            )}
          </div>

          {/* Body Stream: Incidents or Alerts */}
          <div className="flank-scroll-body">
            {leftPillarMode === 'INCIDENTS' ? (
              displayedIncidents.length === 0 ? (
                <div className="flank-empty">No matching active incidents.</div>
              ) : (
                displayedIncidents.map((incident) => {
                  const isCrit = incident.severity === 'CRITICAL';
                  const isHigh = incident.severity === 'HIGH';
                  const sevColor = isCrit ? '#ff2a2a' : isHigh ? '#ff7700' : '#3dffb0';

                  return (
                    <article
                      key={incident.id}
                      className={`command-incident-card ${isCrit ? 'is-critical' : ''}`}
                      onClick={() => handleIncidentClick(incident.id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open investigation for ${incident.id}`}
                    >
                      <div className="card-top-row">
                        <span className="card-id">{incident.id}</span>
                        {incident.priority && (
                          <span
                            className={`card-prio-badge prio-${incident.priority.toLowerCase()}`}
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: 3,
                              background: incident.priority === 'P1' ? 'rgba(255,42,42,0.2)' : 'rgba(255,183,0,0.2)',
                              color: incident.priority === 'P1' ? '#ff2a2a' : '#ffb700',
                              border: `1px solid ${incident.priority === 'P1' ? 'rgba(255,42,42,0.4)' : 'rgba(255,183,0,0.4)'}`,
                            }}
                          >
                            {incident.priority}
                          </span>
                        )}
                        <span className="card-sev-badge" style={{ borderColor: sevColor, color: sevColor }}>
                          {incident.severity}
                        </span>
                        <span className="card-status-badge">{incident.status}</span>
                      </div>

                      <h4 className="card-title">{incident.title}</h4>

                      <div className="card-meta-row">
                        <span title="Correlated Alerts">
                          <Bell size={10} /> {incident.alertIds?.length ?? 0} Alerts
                        </span>
                        <span title="Affected Assets">
                          <Server size={10} /> {incident.affectedAssets.length} Hosts
                        </span>
                        <span title="Correlated IOCs">
                          <Activity size={10} /> {incident.iocs.length} IOCs
                        </span>
                        <span title="Risk Score">
                          <Zap size={10} /> {incident.riskScore} Risk
                        </span>
                      </div>

                      <div className="card-action-cue">
                        <span>OPEN INVESTIGATION</span>
                        <ExternalLink size={10} />
                      </div>
                    </article>
                  );
                })
              )
            ) : (
              /* Compact Alert Stream from prompt */
              displayedAlerts.length === 0 ? (
                <div className="flank-empty">No detection alerts matching filter.</div>
              ) : (
                displayedAlerts.map((alert) => {
                  const isCrit = alert.severity === 'CRITICAL';
                  const isHigh = alert.severity === 'HIGH';
                  const sevColor = isCrit ? '#ff2a2a' : isHigh ? '#ff7700' : '#00f0ff';
                  const timeFormatted = alert.lastSeenAt.length > 11 ? alert.lastSeenAt.slice(11, 19) : alert.lastSeenAt;

                  return (
                    <article
                      key={alert.id}
                      className={`command-alert-card ${isCrit ? 'is-critical' : ''} ${selectedAlertId === alert.id ? 'is-selected' : ''}`}
                      onClick={() => handleSelectAlert(alert.id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Inspect detection alert ${alert.id}`}
                    >
                      <div className="alert-card-top-row">
                        <span className="alert-sev-tag" style={{ borderColor: sevColor, color: sevColor }}>
                          {alert.severity}
                        </span>
                        <span className="alert-time-tag">{timeFormatted}</span>
                        <span className="alert-status-pill">{alert.status}</span>
                        {alert.occurrenceCount > 1 && (
                          <span className="alert-occ-badge">x{alert.occurrenceCount}</span>
                        )}
                      </div>

                      <h4 className="alert-card-title">{alert.title}</h4>

                      <div className="alert-card-target-row">
                        <span className="alert-rule-id">{alert.ruleId}</span>
                        <span className="alert-target-label">
                          {alert.assetId ?? alert.userId ?? alert.iocIds?.[0] ?? 'UNKNOWN'}
                        </span>
                      </div>

                      <div className="alert-card-action-cue">
                        <span>INSPECT PROVENANCE</span>
                        <Eye size={10} />
                      </div>
                    </article>
                  );
                })
              )
            )}
          </div>
        </aside>
      )}

      {/* ─── RIGHT FLANK: ASSET POSTURE & SOAR RESPONSE WINGS ─── */}
      {!wingsMinimized && (
        <aside className="soc-right-flank" aria-label="Environment Posture and Response">
          {/* Top Arc: Asset Posture */}
          <section className="flank-pod asset-pod">
            <div className="pod-header">
              <Server size={12} className="text-cyan" />
              <span className="pod-title">ASSET POSTURE</span>
              <span className="pod-stat-meta">{assets.length} TOTAL</span>
            </div>

            <div className="asset-posture-bars">
              <div className="posture-chip comp" title="Compromised Assets">
                <span className="dot red" />
                <span className="lbl">COMPROMISED:</span>
                <strong>{snapshot.compromisedAssets}</strong>
              </div>
              <div className="posture-chip iso" title="Isolated Assets">
                <span className="dot amber" />
                <span className="lbl">ISOLATED:</span>
                <strong>{snapshot.isolatedAssets}</strong>
              </div>
              <div className="posture-chip susp" title="Suspicious Assets">
                <span className="dot yellow" />
                <span className="lbl">SUSPICIOUS:</span>
                <strong>{snapshot.suspiciousAssets}</strong>
              </div>
              <div className="posture-chip hlth" title="Healthy Assets">
                <span className="dot green" />
                <span className="lbl">HEALTHY:</span>
                <strong>{snapshot.healthyAssets}</strong>
              </div>
            </div>

            {/* Compromised Hosts List */}
            {compromisedAssets.length > 0 && (
              <div className="pod-sublist">
                <span className="sublist-heading">HIGH PRIORITY HOSTS:</span>
                {compromisedAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="compromised-row"
                    onClick={() => onSelectAsset?.(asset.id)}
                    title={`Asset ${asset.name} (${asset.ipAddress}) - ${asset.criticality} criticality`}
                  >
                    <div className="comp-left">
                      <span className="comp-name">{asset.name}</span>
                      <span className="comp-ip">{asset.ipAddress}</span>
                    </div>
                    <span className="comp-crit">{asset.criticality}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Bottom Arc: Active SOAR Response Actions & Playbook Executions */}
          <section className="flank-pod response-pod">
            <div className="pod-header">
              <Zap size={12} className="text-amber" />
              <span className="pod-title">SOAR RESPONSE OPERATIONS</span>
              <span className="pod-stat-meta">{soarStats.activeExecutions + activeResponses.length} IN FLIGHT</span>
            </div>

            {/* Real SOAR Operational Metrics Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '6px 8px', background: 'rgba(0,0,0,0.25)', borderRadius: 4, marginBottom: 8, textAlign: 'center', fontSize: 9 }}>
              <div>
                <div style={{ color: '#00f0ff', fontWeight: 700 }}>{soarStats.activeExecutions}</div>
                <div style={{ color: '#64748b' }}>ACTIVE</div>
              </div>
              <div>
                <div style={{ color: soarStats.awaitingApproval > 0 ? '#ffb700' : '#64748b', fontWeight: 700 }}>{soarStats.awaitingApproval}</div>
                <div style={{ color: '#64748b' }}>APPROVAL</div>
              </div>
              <div>
                <div style={{ color: '#3dffb0', fontWeight: 700 }}>{soarStats.completedExecutions}</div>
                <div style={{ color: '#64748b' }}>DONE</div>
              </div>
              <div>
                <div style={{ color: soarStats.failedExecutions > 0 ? '#ff4242' : '#64748b', fontWeight: 700 }}>{soarStats.failedExecutions}</div>
                <div style={{ color: '#64748b' }}>FAILED</div>
              </div>
            </div>

            <div className="response-list">
              {activeResponses.length === 0 && soarStats.recentExecutions.length === 0 ? (
                <div className="response-empty">All containment actions resolved.</div>
              ) : (
                <>
                  {activeResponses.map((ra) => {
                    const isApproval = ra.status === 'PENDING_APPROVAL' || ra.status === 'REQUESTED';
                    return (
                      <div key={ra.id} className={`response-action-row ${isApproval ? 'needs-approval' : ''}`}>
                        <div className="resp-status-col">
                          {isApproval ? <Lock size={11} color="#ffb700" /> : <Activity size={11} color="#00f0ff" />}
                        </div>
                        <div className="resp-info-col">
                          <div className="resp-type">{ra.type}</div>
                          <div className="resp-target">TARGET: {ra.targetLabel}</div>
                        </div>
                        <span className="resp-badge">{ra.status}</span>
                      </div>
                    );
                  })}

                  {soarStats.recentExecutions.map((exec) => (
                    <div key={exec.id} className="response-action-row" style={{ borderLeft: '2px solid #00f0ff' }}>
                      <div className="resp-status-col">
                        <Zap size={11} color={exec.status === 'COMPLETED' ? '#3dffb0' : '#ffb700'} />
                      </div>
                      <div className="resp-info-col">
                        <div className="resp-type">{exec.playbookName}</div>
                        <div className="resp-target">BY: {exec.executedBy} · {new Date(exec.startedAt).toLocaleTimeString()}</div>
                      </div>
                      <span className="resp-badge" style={{ color: exec.status === 'COMPLETED' ? '#3dffb0' : '#00f0ff' }}>
                        {exec.status}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        </aside>
      )}

      {/* ─── BOTTOM SECTOR: LIVE OPERATIONAL ACTIVITY STREAM ─── */}
      <footer className={`soc-bottom-stream ${activityExpanded ? 'is-expanded' : ''}`}>
        <div className="stream-header" onClick={() => setActivityExpanded((prev) => !prev)}>
          <div className="stream-title-group">
            <span className="stream-pulse-dot" />
            <span className="stream-title">SECURITY EVENT ENGINE TELEMETRY</span>
            <span className="stream-count">
              ({snapshot.eventStats?.totalEvents ?? snapshot.recentEvents.length} EVENTS)
            </span>

            {/* Quick Live Telemetry Metrics */}
            {snapshot.eventStats && (
              <div className="stream-stats-strip" onClick={(e) => e.stopPropagation()}>
                <span className="stream-stat-tag crit" title="Critical Events">
                  CRIT: {snapshot.eventStats.criticalCount}
                </span>
                <span className="stream-stat-tag high" title="High Severity Events">
                  HIGH: {snapshot.eventStats.highCount}
                </span>
                <span className="stream-stat-tag rate" title="Events in Last 5 Minutes">
                  5M: {snapshot.eventStats.eventsLast5Min}
                </span>
              </div>
            )}
          </div>

          <div className="stream-actions" onClick={(e) => e.stopPropagation()}>
            {/* Category Filter Pills */}
            <div className="stream-filter-tabs">
              {(['ALL', 'PROCESS', 'NETWORK', 'AUTHENTICATION', 'ENDPOINT', 'FILE'] as const).map((cat) => (
                <button
                  key={cat}
                  className={`stream-cat-btn ${eventCategoryFilter === cat ? 'active' : ''}`}
                  onClick={() => {
                    cyberAudio.playClick();
                    setEventCategoryFilter(cat);
                  }}
                >
                  {cat === 'AUTHENTICATION' ? 'AUTH' : cat}
                </button>
              ))}
            </div>

            {/* Ingest Simulation Button */}
            <button
              className={`ingest-sim-btn ${isSimulating ? 'simulating' : ''}`}
              onClick={handleIngestSimEvent}
              disabled={isSimulating}
              title="Ingest a simulated canonical security event into IndexedDB"
            >
              <Zap size={11} className={isSimulating ? 'animate-spin' : ''} />
              <span>{isSimulating ? 'INGESTING…' : '+ SIMULATE INGEST'}</span>
            </button>

            <button
              className="stream-expand-toggle"
              onClick={() => setActivityExpanded((prev) => !prev)}
              aria-label="Toggle activity stream height"
            >
              {activityExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>
          </div>
        </div>

        <div className="stream-ticker-viewport">
          <div className="stream-events-row">
            {displayedEvents.length === 0 ? (
              <div className="stream-empty">No telemetry events matching category "{eventCategoryFilter}".</div>
            ) : (
              displayedEvents.map((ev) => {
                const isCrit = ev.severity === 'CRITICAL';
                const isHigh = ev.severity === 'HIGH';
                const sevBadgeColor = isCrit ? '#ff2a2a' : isHigh ? '#ff7700' : '#00f0ff';

                return (
                  <div key={ev.id} className="stream-event-item">
                    <span className="event-time">
                      {ev.timestamp.length > 11 ? ev.timestamp.slice(11, 19) : ev.timestamp}
                    </span>
                    <span className="event-sev-dot" style={{ backgroundColor: sevBadgeColor }} />
                    {ev.category && <span className="event-cat-tag">[{ev.category}]</span>}
                    <span className="event-type">{ev.eventType}</span>
                    <span className="event-target">{ev.entityReference}</span>
                    <span className="event-desc">{ev.description}</span>
                    {ev.status && !ev.category && <span className="event-outcome">[{ev.status}]</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </footer>

      {/* ─── MODAL / FLYOUT: FULL DETECTION & ALERT INSPECTOR ─── */}
      {showAlertDrawer && (
        <div className="soc-alert-inspector-modal" role="dialog" aria-modal="true" aria-label="Detection Alert Inspector">
          <div className="inspector-backdrop" onClick={() => setShowAlertDrawer(false)} />
          <div className="inspector-window">
            <div className="inspector-header">
              <div className="inspector-header-left">
                <Bell size={15} className="text-cyan animate-pulse" />
                <div className="inspector-title-col">
                  <span className="inspector-title">DETECTION & ALERT ENGINE // PROVENANCE INSPECTOR</span>
                  <span className="inspector-sub">
                    {snapshot.openAlerts} OPEN ALERTS · {snapshot.criticalAlerts} CRITICAL · {snapshot.highAlerts} HIGH · {alertsList.length} TOTAL IN DB
                  </span>
                </div>
              </div>

              <div className="inspector-header-right">
                <div className="inspector-filter-pills">
                  {(['ALL', 'NEW', 'ACKNOWLEDGED', 'RESOLVED', 'CRITICAL'] as const).map((filter) => (
                    <button
                      key={filter}
                      className={`insp-filter-btn ${alertFilter === filter ? 'active' : ''}`}
                      onClick={() => setAlertFilter(filter)}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <button
                  className="inspector-close-btn"
                  onClick={() => setShowAlertDrawer(false)}
                  aria-label="Close Alert Inspector"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="inspector-body">
              {/* Left Column: Alert Selection List */}
              <div className="inspector-list-col">
                <div className="list-col-header">
                  <span>ACTIVE ALERTS STREAM ({displayedAlerts.length})</span>
                </div>
                <div className="list-col-scroll">
                  {displayedAlerts.length === 0 ? (
                    <div className="list-empty">No alerts match the active filter.</div>
                  ) : (
                    displayedAlerts.map((alt) => {
                      const isCrit = alt.severity === 'CRITICAL';
                      const isHigh = alt.severity === 'HIGH';
                      const sevColor = isCrit ? '#ff2a2a' : isHigh ? '#ff7700' : '#00f0ff';
                      const isSelected = selectedAlert?.id === alt.id;
                      const timeStr = alt.lastSeenAt.length > 11 ? alt.lastSeenAt.slice(11, 19) : alt.lastSeenAt;

                      return (
                        <div
                          key={alt.id}
                          className={`insp-alert-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            cyberAudio.playClick();
                            setSelectedAlertId(alt.id);
                            setSelectedSourceEventId(null);
                          }}
                        >
                          <div className="item-top">
                            <span className="item-sev" style={{ color: sevColor, borderColor: sevColor }}>
                              {alt.severity}
                            </span>
                            <span className="item-time">{timeStr}</span>
                            <span className={`item-status status-${alt.status.toLowerCase()}`}>{alt.status}</span>
                            {alt.occurrenceCount > 1 && <span className="item-count">x{alt.occurrenceCount}</span>}
                          </div>
                          <div className="item-title">{alt.title}</div>
                          <div className="item-target">
                            {alt.ruleId} ── {alt.assetId ?? alt.userId ?? alt.iocIds?.[0] ?? 'UNKNOWN'}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Detailed Provenance Inspector */}
              <div className="inspector-detail-col">
                {selectedAlert ? (
                  <div className="detail-scroll">
                    <div className="detail-hero">
                      <div className="detail-hero-top">
                        <span
                          className="detail-sev-badge"
                          style={{
                            borderColor:
                              selectedAlert.severity === 'CRITICAL'
                                ? '#ff2a2a'
                                : selectedAlert.severity === 'HIGH'
                                ? '#ff7700'
                                : '#00f0ff',
                            color:
                              selectedAlert.severity === 'CRITICAL'
                                ? '#ff2a2a'
                                : selectedAlert.severity === 'HIGH'
                                ? '#ff7700'
                                : '#00f0ff',
                          }}
                        >
                          {selectedAlert.severity}
                        </span>
                        <span className={`detail-status-badge status-${selectedAlert.status.toLowerCase()}`}>
                          {selectedAlert.status}
                        </span>
                        <span className="detail-id">{selectedAlert.id}</span>
                        {selectedAlert.occurrenceCount > 1 && (
                          <span className="detail-occ-pill">{selectedAlert.occurrenceCount} OCCURRENCES DEDUPLICATED</span>
                        )}
                      </div>
                      <h3 className="detail-title">{selectedAlert.title}</h3>
                      <p className="detail-desc">{selectedAlert.description}</p>
                    </div>

                    {/* Metadata Grid */}
                    <div className="detail-meta-grid">
                      <div className="meta-card">
                        <span className="meta-lbl">DETECTION RULE</span>
                        <strong className="meta-val text-cyan">{selectedAlert.ruleId}</strong>
                      </div>
                      <div className="meta-card">
                        <span className="meta-lbl">MITRE ATT&CK</span>
                        <strong className="meta-val text-amber">{selectedAlert.mitreTechniqueId ?? 'None'}</strong>
                      </div>
                      <div className="meta-card">
                        <span className="meta-lbl">AFFECTED ASSET</span>
                        <strong className="meta-val">{selectedAlert.assetId ?? 'N/A'}</strong>
                      </div>
                      <div className="meta-card">
                        <span className="meta-lbl">AFFECTED USER</span>
                        <strong className="meta-val">{selectedAlert.userId ?? 'N/A'}</strong>
                      </div>
                      <div className="meta-card">
                        <span className="meta-lbl">FIRST SEEN</span>
                        <strong className="meta-val">
                          {selectedAlert.firstSeenAt.replace('T', ' ').slice(0, 19)}
                        </strong>
                      </div>
                      <div className="meta-card">
                        <span className="meta-lbl">CORRELATED INCIDENT</span>
                        <strong className="meta-val text-cyan">
                          {selectedAlert.incidentId ?? 'Uncorrelated'}
                        </strong>
                      </div>
                    </div>

                    {/* Associated IOCs */}
                    {selectedAlert.iocIds && selectedAlert.iocIds.length > 0 && (
                      <div className="detail-section">
                        <h5 className="section-title">ASSOCIATED THREAT INDICATORS (IOCs)</h5>
                        <div className="ioc-tags-list">
                          {selectedAlert.iocIds.map((ioc) => (
                            <span key={ioc} className="ioc-tag">
                              {ioc}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Provenance: Source Security Events */}
                    <div className="detail-section">
                      <div className="provenance-header">
                        <h5 className="section-title">
                          CAUSAL SOURCE TELEMETRY ({selectedAlert.sourceEventIds.length} EVENTS)
                        </h5>
                        <span className="provenance-sub">Click event ID to inspect canonical payload</span>
                      </div>

                      <div className="source-events-list">
                        {selectedAlert.sourceEventIds.map((evtId) => {
                          const isSelectedEvt = selectedSourceEventId === evtId;
                          return (
                            <div key={evtId} className="source-event-wrapper">
                              <button
                                className={`source-evt-btn ${isSelectedEvt ? 'active' : ''}`}
                                onClick={() => {
                                  cyberAudio.playClick();
                                  setSelectedSourceEventId(isSelectedEvt ? null : evtId);
                                }}
                              >
                                <span className="evt-dot" />
                                <span className="evt-id">{evtId}</span>
                                <span className="evt-action">{isSelectedEvt ? 'COLLAPSE' : 'VIEW'}</span>
                              </button>

                              {/* Inline event preview if selected */}
                              {isSelectedEvt && (
                                <div className="source-evt-payload">
                                  {selectedSourceEvent ? (
                                    <div className="payload-box">
                                      <div className="payload-line">
                                        <strong>Timestamp:</strong> {selectedSourceEvent.timestamp}
                                      </div>
                                      <div className="payload-line">
                                        <strong>Type:</strong> {selectedSourceEvent.eventType} |{' '}
                                        <strong>Category:</strong> {selectedSourceEvent.category}
                                      </div>
                                      <div className="payload-line">
                                        <strong>Source:</strong> {selectedSourceEvent.source} (
                                        {selectedSourceEvent.sourceType})
                                      </div>
                                      <div className="payload-line">
                                        <strong>Message:</strong> {selectedSourceEvent.message}
                                      </div>
                                      {selectedSourceEvent.commandLine && (
                                        <div className="payload-line">
                                          <strong>Command:</strong> <code>{selectedSourceEvent.commandLine}</code>
                                        </div>
                                      )}
                                      {selectedSourceEvent.domain && (
                                        <div className="payload-line">
                                          <strong>Domain:</strong> {selectedSourceEvent.domain}
                                        </div>
                                      )}
                                      {selectedSourceEvent.dstIp && (
                                        <div className="payload-line">
                                          <strong>Dst IP:</strong> {selectedSourceEvent.dstIp}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="payload-box">
                                      <div className="payload-line">Event ID {evtId} confirmed in audit trail.</div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="detail-action-bar">
                      <button
                        className="insp-act-btn ack-btn"
                        onClick={(e) => handleAcknowledgeAlert(selectedAlert.id, e)}
                        disabled={selectedAlert.status !== 'NEW' || isAlertActionPending}
                        title="Mark alert as acknowledged (RBAC audited)"
                      >
                        <Check size={12} />
                        <span>{selectedAlert.status === 'NEW' ? 'ACKNOWLEDGE' : 'ACKNOWLEDGED'}</span>
                      </button>

                      <button
                        className="insp-act-btn resolve-btn"
                        onClick={(e) => handleResolveAlert(selectedAlert.id, e)}
                        disabled={selectedAlert.status === 'RESOLVED' || isAlertActionPending}
                        title="Mark alert as resolved (RBAC audited)"
                      >
                        <CheckCheck size={12} />
                        <span>{selectedAlert.status === 'RESOLVED' ? 'RESOLVED' : 'RESOLVE ALERT'}</span>
                      </button>

                      {selectedAlert.incidentId && (
                        <button
                          className="insp-act-btn invest-btn"
                          onClick={() => {
                            setShowAlertDrawer(false);
                            handleIncidentClick(selectedAlert.incidentId!);
                          }}
                          title="Transition directly into Spatial Incident Universe"
                        >
                          <ExternalLink size={12} />
                          <span>INVESTIGATE INCIDENT</span>
                        </button>
                      )}

                      {selectedAlert.assetId && onSelectAsset && (
                        <button
                          className="insp-act-btn asset-btn"
                          onClick={() => {
                            setShowAlertDrawer(false);
                            onSelectAsset(selectedAlert.assetId!);
                          }}
                          title="Focus affected asset in spatial environment"
                        >
                          <Target size={12} />
                          <span>FOCUS ASSET</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="detail-empty">
                    <AlertCircle size={32} color="#718096" />
                    <p>Select a detection alert to inspect rule provenance and telemetry chain.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Threat Intelligence Profile Modal */}
      {selectedIntelIocId && (
        <ThreatIntelProfile
          indicatorId={selectedIntelIocId}
          onClose={() => setSelectedIntelIocId(null)}
          onPivot={(entityId, entityType) => {
            if (entityType === 'ASSET' && onSelectAsset) {
              onSelectAsset(entityId);
              setSelectedIntelIocId(null);
            } else if (entityType === 'INCIDENT') {
              onSelectIncident(entityId);
              setSelectedIntelIocId(null);
            } else if (entityType === 'IOC') {
              setSelectedIntelIocId(entityId);
            }
          }}
        />
      )}
    </div>
  );
}

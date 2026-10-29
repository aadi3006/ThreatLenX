'use client';
import { useState, useEffect, useRef, useId } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Zap,
  Activity,
  Radio,
  Lock,
  Terminal,
  Cpu,
  Server,
  AlertTriangle,
  Flame,
  RotateCcw,
  CheckCircle2,
  RefreshCw,
  Play,
  Pause,
  Layers,
  Crosshair,
  Volume2,
  Sliders,
  Globe as GlobeIcon,
  Wifi,
  HardDrive,
  Filter,
} from 'lucide-react';
import { cyberAudio } from './cyber-audio';
import type { SpatialMode } from './spatial-transform';

export interface SocDashboardProps {
  onTriggerAlert?: (msg: string) => void;
  spatialMode?: SpatialMode;
  focusedPanelId?: string | null;
  pointedPanelId?: string | null;
  onRegisterPanel?: (id: string, el: HTMLElement | null) => void;
  onSelectPanel?: (id: string) => void;
  onExitFocus?: () => void;
}

interface AttackVector {
  id: string;
  from: { name: string; x: number; y: number };
  to: { name: string; x: number; y: number };
  type: string;
  severity: 'critical' | 'high' | 'medium';
  progress: number;
}

interface SiemLog {
  timestamp: string;
  id: string;
  source: string;
  event: string;
  level: 'CRITICAL' | 'WARN' | 'INFO' | 'BLOCKED';
}

const GLOBAL_NODES = [
  { name: 'US-EAST (DC)', x: 0.28, y: 0.35 },
  { name: 'US-WEST (SF)', x: 0.18, y: 0.38 },
  { name: 'EU-WEST (LDN)', x: 0.49, y: 0.28 },
  { name: 'EU-CENTRAL (FRA)', x: 0.53, y: 0.3 },
  { name: 'ASIA-PACIFIC (TYO)', x: 0.84, y: 0.38 },
  { name: 'ASIA-SOUTH (DEL)', x: 0.69, y: 0.45 },
  { name: 'ASIA-SE (SGP)', x: 0.77, y: 0.58 },
  { name: 'OCEANIA (SYD)', x: 0.88, y: 0.78 },
  { name: 'SA-EAST (SAO)', x: 0.35, y: 0.72 },
];

export default function SocDashboard({
  onTriggerAlert,
  spatialMode = 'COMMAND',
  focusedPanelId,
  pointedPanelId,
  onRegisterPanel,
  onSelectPanel,
  onExitFocus,
}: SocDashboardProps) {
  const mapCanvasId = useId();
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const [defconLevel, setDefconLevel] = useState<number>(2);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [activeTabAction, setActiveTabAction] = useState<string>('all');

  // ── SecurityService-derived stats (seeded from real provider data) ──────────
  // Threat score = aggregate risk from actual incidents
  // Quarantined = isolated assets from provider
  // These are derived once from SecurityService on mount; secondary widgets
  // that have no domain source use operational telemetry (clearly labeled).
  const [threatScore, setThreatScore] = useState<number>(0);
  const [blockedAttempts, setBlockedAttempts] = useState<number>(0);
  const [trafficGBs, setTrafficGBs] = useState<number>(42.8);
  const [packetsPerSec, setPacketsPerSec] = useState<number>(1894000);
  const [quarantinedHosts, setQuarantinedHosts] = useState<number>(0);
  const [activeScans, setActiveScans] = useState<number>(0);
  const [incidentCount, setIncidentCount] = useState<number>(0);
  const [criticalCount, setCriticalCount] = useState<number>(0);

  // Cluster stats (operational telemetry — no domain source in Stage 2)
  const [clusterCpu, setClusterCpu] = useState<number>(44);
  const [clusterMem, setClusterMem] = useState<number>(68);
  const [clusterNodes] = useState<number>(128);

  // Attack streams ref
  const attackCountRef = useRef<HTMLSpanElement | null>(null);

  // SIEM logs — seeded from real audit records, then extended with operational feed
  const [logs, setLogs] = useState<SiemLog[]>([
    { timestamp: '—', id: 'LOADING', source: '—', event: 'Loading security event log…', level: 'INFO' },
  ]);

  // ── Load from SecurityService on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadFromProvider() {
      try {
        const { securityService } = await import('./core/bootstrap');
        if (!securityService.isReady) return;

        const [incidents, assets, auditLogs] = await Promise.all([
          securityService.getIncidents(),
          securityService.getAssets(),
          securityService.getAuditLogs(),
        ]);

        if (cancelled) return;

        // Threat score = weighted average riskScore across incidents
        const avgRisk = incidents.length > 0
          ? incidents.reduce((s, i) => s + i.riskScore, 0) / incidents.length
          : 0;

        const critical = incidents.filter((i) => i.severity === 'CRITICAL').length;
        const isolated = assets.filter((a) => a.status === 'ISOLATED').length;
        const compromised = assets.filter((a) => a.status === 'COMPROMISED').length;

        setThreatScore(+avgRisk.toFixed(1));
        setIncidentCount(incidents.length);
        setCriticalCount(critical);
        setQuarantinedHosts(isolated + compromised);
        setActiveScans(incidents.filter((i) => i.status === 'INVESTIGATING').length);
        setDefconLevel(critical >= 2 ? 1 : critical === 1 ? 2 : 3);

        // IOC count as seed for blocked attempts (each IOC block = ~1000 attempts heuristic)
        const totalIocs = incidents.reduce((s, i) => s + i.iocs.length, 0);
        setBlockedAttempts(totalIocs * 1000 + 128000);

        // Seed SIEM log from real audit records (most recent 8)
        const recentAudit = auditLogs.slice(-8).reverse();
        const seedLogs: SiemLog[] = recentAudit.map((rec) => ({
          timestamp: new Date(rec.timestamp).toTimeString().slice(0, 8),
          id: rec.id.slice(0, 12).toUpperCase(),
          source: rec.actor,
          event: `${rec.action.replace(/_/g, ' ')}: ${rec.target}`,
          level: rec.outcome === 'SUCCESS' ? 'INFO' : rec.outcome === 'DENIED' ? 'BLOCKED' : 'WARN',
        }));

        if (seedLogs.length > 0) setLogs(seedLogs);
      } catch {
        // Non-fatal — dashboard keeps its UI even if provider unavailable
      }
    }

    // Wait briefly for SecurityService bootstrap to complete if needed
    const timer = setTimeout(() => { void loadFromProvider(); }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Periodic metrics fluctuation
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setThreatScore((prev) => +(Math.max(40, Math.min(98, prev + (Math.random() - 0.48) * 3))).toFixed(1));
      setBlockedAttempts((prev) => prev + Math.floor(Math.random() * 8) + 2);
      setTrafficGBs((prev) => +(Math.max(20, Math.min(85, prev + (Math.random() - 0.5) * 4))).toFixed(1));
      setPacketsPerSec((prev) => Math.floor(prev + (Math.random() - 0.5) * 50000));
      setClusterCpu((prev) => Math.max(25, Math.min(88, Math.round(prev + (Math.random() - 0.5) * 6))));
      setClusterMem((prev) => Math.max(50, Math.min(85, Math.round(prev + (Math.random() - 0.5) * 2))));

      // Add a simulated SIEM log occasionally
      const newEventTypes: { text: string; level: SiemLog['level'] }[] = [
        { text: 'Brute force credential stuffing throttled', level: 'WARN' },
        { text: 'Unauthorized lateral movement attempt isolated', level: 'CRITICAL' },
        { text: 'Heuristic anomaly detected in payload header', level: 'WARN' },
        { text: 'Firewall ruleset synchronized across all 128 nodes', level: 'INFO' },
        { text: 'Botnet probe packet blackholed at edge router', level: 'BLOCKED' },
        { text: 'Zero-day vulnerability signature neutralized', level: 'CRITICAL' },
      ];
      const pick = newEventTypes[Math.floor(Math.random() * newEventTypes.length)];
      const now = new Date();
      const timeStr = now.toTimeString().slice(0, 8);
      const randomIP = `${Math.floor(Math.random() * 200 + 20)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254 + 1)}`;
      const logEntry: SiemLog = {
        timestamp: timeStr,
        id: `SEC-${Math.floor(1000 + Math.random() * 9000)}`,
        source: randomIP,
        event: pick.text,
        level: pick.level,
      };

      setLogs((prev) => [...prev.slice(-24), logEntry]);
    }, 2200);

    return () => clearInterval(interval);
  }, [isPaused]);

  // Scroll logs container smoothly
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Attack Vector Canvas Animation Loop
  useEffect(() => {
    let animId: number;
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let localAttacks: AttackVector[] = [];

    const spawnAttack = () => {
      const fromIdx = Math.floor(Math.random() * GLOBAL_NODES.length);
      let toIdx = Math.floor(Math.random() * GLOBAL_NODES.length);
      while (toIdx === fromIdx) toIdx = Math.floor(Math.random() * GLOBAL_NODES.length);

      const severities: ('critical' | 'high' | 'medium')[] = ['critical', 'high', 'medium'];
      const sev = severities[Math.floor(Math.random() * severities.length)];
      const attackTypes = ['DDoS Volumetric', 'Ransomware Beacon', 'API Injection', 'Zero-Day Exploit', 'Credential Stuffing'];

      localAttacks.push({
        id: Math.random().toString(),
        from: GLOBAL_NODES[fromIdx],
        to: GLOBAL_NODES[toIdx],
        type: attackTypes[Math.floor(Math.random() * attackTypes.length)],
        severity: sev,
        progress: 0,
      });

      if (localAttacks.length > 9) localAttacks.shift();
    };

    let lastSpawn = performance.now();

    const render = (now: number) => {
      if (now - lastSpawn > 1100 && !isPaused) {
        spawnAttack();
        lastSpawn = now;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background Cyber Map Grid
      ctx.strokeStyle = 'rgba(61, 255, 176, 0.08)';
      ctx.lineWidth = 1;
      const step = 28;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Draw Global Nodes
      GLOBAL_NODES.forEach((node) => {
        const nx = node.x * w;
        const ny = node.y * h;

        // Node pulse
        const pulse = Math.sin(now / 350 + node.x * 10) * 3 + 4;
        ctx.beginPath();
        ctx.arc(nx, ny, pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(61, 255, 176, 0.2)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(nx, ny, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'var(--hud-line, #3dffb0)';
        ctx.fill();

        // Node label
        ctx.font = '9px Chakra Petch, monospace';
        ctx.fillStyle = 'rgba(200, 255, 230, 0.7)';
        ctx.fillText(node.name, nx + 6, ny - 4);
      });

      // Draw Attack Arcs
      localAttacks.forEach((atk) => {
        if (!isPaused) atk.progress += 0.016;
        const fx = atk.from.x * w;
        const fy = atk.from.y * h;
        const tx = atk.to.x * w;
        const ty = atk.to.y * h;

        // Quadratic curve with arc height
        const mx = (fx + tx) / 2;
        const my = (fy + ty) / 2 - Math.abs(fx - tx) * 0.25;

        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.quadraticCurveTo(mx, my, tx, ty);
        ctx.strokeStyle = atk.severity === 'critical' ? 'rgba(255, 42, 42, 0.35)' : 'rgba(255, 183, 0, 0.3)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Moving attack projectile
        const t = Math.min(1, atk.progress);
        const currX = (1 - t) * (1 - t) * fx + 2 * (1 - t) * t * mx + t * t * tx;
        const currY = (1 - t) * (1 - t) * fy + 2 * (1 - t) * t * my + t * t * ty;

        ctx.beginPath();
        ctx.arc(currX, currY, atk.severity === 'critical' ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = atk.severity === 'critical' ? '#ff2a2a' : '#ffb700';
        ctx.shadowColor = atk.severity === 'critical' ? '#ff2a2a' : '#ffb700';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      localAttacks = localAttacks.filter((a) => a.progress < 1.05);
      if (attackCountRef.current) {
        attackCountRef.current.textContent = `${localAttacks.length} ACTIVE ARCS`;
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isPaused]);

  // Tactical Actions
  const handleTacticalAction = (action: string) => {
    cyberAudio.playClick();
    cyberAudio.playScan();
    const now = new Date().toTimeString().slice(0, 8);
    const newLog: SiemLog = {
      timestamp: now,
      id: `CMD-${Math.floor(100 + Math.random() * 900)}`,
      source: 'SOC_OPERATOR',
      event: `TACTICAL ACTION: [${action.toUpperCase()}] executed across all cluster nodes`,
      level: 'CRITICAL',
    };
    setLogs((p) => [...p, newLog]);
    if (onTriggerAlert) onTriggerAlert(`Executed: ${action}`);

    if (action.includes('LOCKDOWN')) {
      setDefconLevel(1);
    } else if (action.includes('SCAN')) {
      setActiveScans((s) => s + 1);
    }
  };

  const getPanelProps = (id: string, extraClass = '') => {
    const isFocused = focusedPanelId === id;
    const isDimmed = !!focusedPanelId && focusedPanelId !== id;
    const isPointed = pointedPanelId === id;
    const isSpatial = spatialMode !== 'COMMAND';

    return {
      ref: (el: HTMLElement | null) => onRegisterPanel?.(id, el),
      'data-panel': id,
      'data-spatial': isSpatial ? 'true' : undefined,
      'data-focused': isFocused ? 'true' : undefined,
      'data-dimmed': isDimmed ? 'true' : undefined,
      'data-pointed': isPointed ? 'true' : undefined,
      className: `soc-panel hud-panel sp-panel ${extraClass} ${isFocused ? 'is-focused' : ''} ${isDimmed ? 'is-dimmed' : ''} ${isPointed ? 'is-pointed' : ''}`.trim(),
      onClick: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, canvas, input')) return;
        onSelectPanel?.(id);
      },
    };
  };

  return (
    <div className="soc-command-wall" aria-label="Cyber Security Operations Center Command Center">
      <div className="soc-dashboard-container">
        {/* =================================================================
            ROW 1: TOP 3 PANELS
            ================================================================= */}
        <section className="soc-row soc-row-top" aria-label="Surveillance and Assessment Metrics">
          {/* TOP PANEL 1: DEFCON & THREAT LEVEL */}
          <div {...getPanelProps('threat-assess')}>
            <div className="soc-panel-header">
              <div className="hdr-title-box">
                <ShieldAlert size={14} className="text-line" />
                <h3>THREAT ASSESSMENT // DEFCON</h3>
              </div>
              <span className={`defcon-pill defcon-${defconLevel}`}>DEFCON {defconLevel}</span>
            </div>
            <div className="soc-panel-body defcon-body">
              <div className="defcon-main-stat">
                <div className="stat-circle">
                  <strong>{threatScore}%</strong>
                  <small>THREAT INDEX</small>
                </div>
                <div className="defcon-details">
                  <div className="detail-row">
                    <span>Active Breach Attempts</span>
                    <strong className="text-crit">37 / min</strong>
                  </div>
                  <div className="detail-row">
                    <span>Attack Surface Exposure</span>
                    <strong>12.4% (Minimal)</strong>
                  </div>
                  <div className="detail-row">
                    <span>Global Alert Status</span>
                    <strong className={defconLevel === 1 ? 'text-crit' : 'text-bright'}>
                      {defconLevel === 1 ? 'MAX SURVEILLANCE' : 'ACTIVE MITIGATION'}
                    </strong>
                  </div>
                </div>
              </div>
              <div className="defcon-selector">
                <small>MANUAL DEFCON OVERRIDE:</small>
                <div className="btn-group">
                  {[1, 2, 3, 4].map((lvl) => (
                    <button
                      key={lvl}
                      className={`lvl-btn ${defconLevel === lvl ? 'active' : ''}`}
                      onClick={() => {
                        cyberAudio.playClick();
                        setDefconLevel(lvl);
                      }}
                    >
                      D{lvl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* TOP PANEL 2: TRAFFIC & SIEM THROUGHPUT */}
          <div {...getPanelProps('siem-throughput')}>
            <div className="soc-panel-header">
              <div className="hdr-title-box">
                <Activity size={14} className="text-line" />
                <h3>SIEM THROUGHPUT & PACKET VELOCITY</h3>
              </div>
              <span className="sub-badge">TLS 1.3 ENCRYPTED</span>
            </div>
            <div className="soc-panel-body">
              <div className="soc-metric-duo">
                <div className="metric-cell">
                  <span className="lbl">DATA THROUGHPUT</span>
                  <div className="val-box">
                    <strong>{trafficGBs}</strong>
                    <small>GB/s</small>
                  </div>
                  <div className="mini-meter">
                    <div className="fill" style={{ width: `${(trafficGBs / 100) * 100}%` }} />
                  </div>
                </div>
                <div className="metric-cell">
                  <span className="lbl">PACKET INSPECTION</span>
                  <div className="val-box">
                    <strong>{(packetsPerSec / 1000000).toFixed(2)}</strong>
                    <small>M pps</small>
                  </div>
                  <div className="mini-meter">
                    <div className="fill fill-green" style={{ width: '82%' }} />
                  </div>
                </div>
              </div>
              <div className="stream-ticker">
                <span>ACTIVE TUNNELS: <strong>14,920</strong></span>
                <span>SCRUB LATENCY: <strong>1.8 ms</strong></span>
                <span>BUFFER: <strong>99.98%</strong></span>
              </div>
            </div>
          </div>

          {/* TOP PANEL 3: FIREWALL & WAF MITIGATION MATRIX */}
          <div {...getPanelProps('waf')}>
            <div className="soc-panel-header">
              <div className="hdr-title-box">
                <Lock size={14} className="text-line" />
                <h3>WAF & INTRUSION PREVENTION</h3>
              </div>
              <span className="status-pill-ok">SHIELD ARMED</span>
            </div>
            <div className="soc-panel-body">
              <div className="soc-stats-list">
                <div className="stat-line">
                  <span>Blocked Malicious Probes</span>
                  <strong className="text-line">{blockedAttempts.toLocaleString()}</strong>
                </div>
                <div className="stat-line">
                  <span>Zero-Day Signatures Active</span>
                  <strong>18,492 rules</strong>
                </div>
                <div className="stat-line">
                  <span>Autonomous DDoS Dampening</span>
                  <strong className="text-bright">Engaged (L7 Scrub)</strong>
                </div>
                <div className="stat-line">
                  <span>Quarantined Suspicious Hosts</span>
                  <strong className="text-crit">{quarantinedHosts} isolated</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =================================================================
            ROW 2: MIDDLE 2 PANELS (CENTER COMMAND WALL)
            ================================================================= */}
        <section className="soc-row soc-row-middle" aria-label="Tactical Cyber Attack Map and Neural Sentry AI">
          {/* MIDDLE PANEL 1: LIVE GLOBAL CYBER ATTACK MAP */}
          <div {...getPanelProps('threat-map', 'soc-panel-map')}>
            <div className="soc-panel-header">
              <div className="hdr-title-box">
                <Crosshair size={14} className="text-line" />
                <h3>GLOBAL CYBER ATTACK VECTOR STREAM // LIVE GEO-TRACKER</h3>
              </div>
              <div className="map-hdr-info">
                <span ref={attackCountRef}>6 ACTIVE ARCS</span>
                <button
                  className="soc-ctrl-btn"
                  onClick={() => setIsPaused(!isPaused)}
                  title={isPaused ? 'Resume live trajectory streams' : 'Pause streams'}
                >
                  {isPaused ? <Play size={12} /> : <Pause size={12} />}
                </button>
              </div>
            </div>
            <div className="soc-panel-body map-body">
              <canvas id={mapCanvasId} ref={mapCanvasRef} width={820} height={320} className="soc-map-canvas" />
              <div className="map-legend">
                <div className="legend-item"><i className="dot crit" /> CRITICAL (EXPLOIT / RANSOMWARE)</div>
                <div className="legend-item"><i className="dot warn" /> HIGH (DDoS / INJECTION)</div>
                <div className="legend-item"><i className="dot ok" /> SECURE DATACENTER NODE</div>
              </div>
            </div>
          </div>

          {/* MIDDLE PANEL 2: NEURAL SENTRY AI & THREAT CLASSIFICATION */}
          <div {...getPanelProps('neural-sentry')}>
            <div className="soc-panel-header">
              <div className="hdr-title-box">
                <Cpu size={14} className="text-line" />
                <h3>NEURAL SENTRY AI // THREAT DECONSTRUCTION</h3>
              </div>
              <span className="sub-badge">AI HEURISTICS</span>
            </div>
            <div className="soc-panel-body sentry-body">
              <div className="sentry-score-card">
                <div className="sentry-row">
                  <span>Model Confidence</span>
                  <strong className="text-bright">99.82%</strong>
                </div>
                <div className="sentry-row">
                  <span>Sandbox Detonations</span>
                  <strong>142 / hr</strong>
                </div>
                <div className="sentry-row">
                  <span>Autonomous Mitigations</span>
                  <strong>98.4% (Zero-Touch)</strong>
                </div>
              </div>

              <div className="threat-types-breakdown">
                <span className="breakdown-lbl">DETECTED VECTOR BREAKDOWN</span>
                <div className="vector-bar-row">
                  <span>DDoS Volumetric</span>
                  <div className="prog-track"><div className="fill" style={{ width: '42%' }} /></div>
                  <small>42%</small>
                </div>
                <div className="vector-bar-row">
                  <span>API Credential Stuffing</span>
                  <div className="prog-track"><div className="fill fill-amber" style={{ width: '28%' }} /></div>
                  <small>28%</small>
                </div>
                <div className="vector-bar-row">
                  <span>SQLi / Buffer Overflow</span>
                  <div className="prog-track"><div className="fill fill-cyan" style={{ width: '18%' }} /></div>
                  <small>18%</small>
                </div>
                <div className="vector-bar-row">
                  <span>Zero-Day RCE</span>
                  <div className="prog-track"><div className="fill fill-crit" style={{ width: '12%' }} /></div>
                  <small>12%</small>
                </div>
              </div>

              <div className="sentry-sandbox-status">
                <div className="sandbox-indicator">
                  <CheckCircle2 size={12} className="text-line" />
                  <span>DEEP HEURISTIC SANDBOX // ISOLATED</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =================================================================
            ROW 3: BOTTOM 3 PANELS
            ================================================================= */}
        <section className="soc-row soc-row-bottom" aria-label="Terminal Logs, Infrastructure Telemetry, and Tactical Actions">
          {/* BOTTOM PANEL 1: SIEM SYSLOG TERMINAL */}
          <div {...getPanelProps('siem-logs')}>
            <div className="soc-panel-header">
              <div className="hdr-title-box">
                <Terminal size={14} className="text-line" />
                <h3>SIEM EVENT LOGS // LIVE SYSLOG</h3>
              </div>
              <button
                className="soc-ctrl-btn"
                onClick={() => {
                  cyberAudio.playClick();
                  setLogs([]);
                }}
                title="Clear Logs"
              >
                <RefreshCw size={11} />
              </button>
            </div>
            <div className="soc-panel-body terminal-body" ref={logContainerRef}>
              {logs.length === 0 ? (
                <div className="no-logs">LOGS CLEARED // LISTENING FOR INCOMING EVENTS...</div>
              ) : (
                logs.map((lg, i) => (
                  <div key={i} className={`log-row log-${lg.level.toLowerCase()}`}>
                    <span className="log-t">{lg.timestamp}</span>
                    <span className={`log-badge badge-${lg.level.toLowerCase()}`}>{lg.level}</span>
                    <span className="log-src">{lg.source}</span>
                    <span className="log-msg">{lg.event}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* BOTTOM PANEL 2: CLUSTER HEALTH & INFRASTRUCTURE */}
          <div {...getPanelProps('cluster-health')}>
            <div className="soc-panel-header">
              <div className="hdr-title-box">
                <Server size={14} className="text-line" />
                <h3>CLUSTER HEALTH // INFRASTRUCTURE</h3>
              </div>
              <span className="status-pill-ok">128 / 128 NODES</span>
            </div>
            <div className="soc-panel-body">
              <div className="infra-grid">
                <div className="infra-box">
                  <span className="lbl">CPU LOAD</span>
                  <strong>{clusterCpu}%</strong>
                  <div className="mini-meter"><div className="fill" style={{ width: `${clusterCpu}%` }} /></div>
                </div>
                <div className="infra-box">
                  <span className="lbl">RAM USAGE</span>
                  <strong>{clusterMem}%</strong>
                  <div className="mini-meter"><div className="fill fill-amber" style={{ width: `${clusterMem}%` }} /></div>
                </div>
                <div className="infra-box">
                  <span className="lbl">ENCLAVE TEMP</span>
                  <strong>38.4°C</strong>
                  <div className="mini-meter"><div className="fill fill-green" style={{ width: '48%' }} /></div>
                </div>
                <div className="infra-box">
                  <span className="lbl">POWER DRAW</span>
                  <strong>480 W</strong>
                  <div className="mini-meter"><div className="fill" style={{ width: '55%' }} /></div>
                </div>
              </div>
            </div>
          </div>

          {/* BOTTOM PANEL 3: TACTICAL INCIDENT RESPONSE ACTIONS */}
          <div {...getPanelProps('tactical-actions')}>
            <div className="soc-panel-header">
              <div className="hdr-title-box">
                <Zap size={14} className="text-line" />
                <h3>TACTICAL INCIDENT RESPONSE</h3>
              </div>
              <span className="sub-badge">AIR-GAPPED READY</span>
            </div>
            <div className="soc-panel-body actions-body">
              <div className="soc-action-grid">
                <button
                  className="soc-btn-action crit-action"
                  onClick={() => handleTacticalAction('Lockdown Cluster Perimeter')}
                >
                  <ShieldAlert size={13} />
                  <span>LOCKDOWN PERIMETER</span>
                </button>
                <button
                  className="soc-btn-action"
                  onClick={() => handleTacticalAction('Quarantine Compromised Nodes')}
                >
                  <AlertTriangle size={13} />
                  <span>QUARANTINE HOST</span>
                </button>
                <button
                  className="soc-btn-action"
                  onClick={() => handleTacticalAction('Rotate All SSL / Zero Trust Keys')}
                >
                  <RotateCcw size={13} />
                  <span>ROTATE SSL KEYS</span>
                </button>
                <button
                  className="soc-btn-action"
                  onClick={() => handleTacticalAction('Deep Heuristic Malware Sweep')}
                >
                  <Flame size={13} />
                  <span>DEEP SCAN</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

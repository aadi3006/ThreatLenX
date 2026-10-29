/**
 * app/spatial/shell/BottomTelemetryDock.tsx
 *
 * Bottom Security Event Engine Telemetry Stream Dock.
 *
 * Displays live event feed, event categories, and simulated event ingestion.
 * Collapsible from full view to a sleek operational ticker.
 */

'use client';
import React, { useState, useMemo } from 'react';
import {
  Activity,
  Zap,
  ChevronDown,
  ChevronUp,
  X,
  Filter,
} from 'lucide-react';
import { useSpatialUi } from '../state/use-spatial-ui';
import { securityService } from '../../core/security-service';
import { cyberAudio } from '../../cyber-audio';
import type { SecurityOperationsSnapshot } from '../../core/security/threat-level-service';

export interface BottomTelemetryDockProps {
  snapshot: SecurityOperationsSnapshot | null;
  onRefreshData?: () => void;
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
];

export function BottomTelemetryDock({ snapshot, onRefreshData }: BottomTelemetryDockProps) {
  const {
    bottomPanelVisible,
    setBottomPanelVisible,
  } = useSpatialUi();

  const [isExpanded, setIsExpanded] = useState(false);
  const [eventCategoryFilter, setEventCategoryFilter] = useState<string>('ALL');
  const [isSimulating, setIsSimulating] = useState(false);

  const displayedEvents = useMemo(() => {
    if (!snapshot) return [];
    let list = snapshot.recentEvents;
    if (eventCategoryFilter !== 'ALL') {
      list = list.filter((ev) => ev.category === eventCategoryFilter || ev.status === eventCategoryFilter);
    }
    return list.slice(0, isExpanded ? 30 : 6);
  }, [snapshot, eventCategoryFilter, isExpanded]);

  const handleSimulateIngest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSimulating(true);
    cyberAudio.playClick();
    try {
      const template = SIMULATION_TEMPLATES[Math.floor(Math.random() * SIMULATION_TEMPLATES.length)];
      const simEvent = {
        ...template,
        timestamp: new Date().toISOString(),
      };
      const res = await securityService.ingestEvent(simEvent);
      if (res.success) {
        cyberAudio.playAlert();
        onRefreshData?.();
      }
    } catch (err) {
      console.error('[BottomTelemetry] Failed to ingest simulated event:', err);
    } finally {
      setIsSimulating(false);
    }
  };

  if (!bottomPanelVisible) {
    return (
      <aside className="dock-launcher-strip bottom-strip" aria-label="Bottom Dock Launcher">
        <button
          className="bottom-launcher-btn"
          onClick={() => {
            cyberAudio.playClick();
            setBottomPanelVisible(true);
          }}
          title="Open Security Event Telemetry [HotKey: B]"
        >
          <Activity size={12} className="text-cyan animate-pulse" />
          <span>SECURITY TELEMETRY ({snapshot?.recentEvents?.length ?? 0} EVENTS)</span>
        </button>
      </aside>
    );
  }

  return (
    <footer className={`spatial-bottom-dock ${isExpanded ? 'is-expanded' : ''}`} aria-label="Security Telemetry Stream">
      {/* Stream Header */}
      <div className="stream-header-bar" onClick={() => setIsExpanded((prev) => !prev)}>
        <div className="stream-header-left">
          <span className="stream-live-indicator" />
          <Activity size={12} className="text-cyan" />
          <span className="stream-heading">SECURITY EVENT ENGINE TELEMETRY</span>
          <span className="stream-total">({snapshot?.recentEvents?.length ?? 0} EVENTS)</span>
        </div>

        <div className="stream-header-right" onClick={(e) => e.stopPropagation()}>
          {/* Category Filter Pills */}
          <div className="stream-cat-pills">
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

          {/* Simulate Event Ingest Button */}
          <button
            className={`stream-sim-btn ${isSimulating ? 'simulating' : ''}`}
            onClick={handleSimulateIngest}
            disabled={isSimulating}
            title="Ingest simulated canonical event into offline store"
          >
            <Zap size={11} className={isSimulating ? 'animate-spin' : ''} />
            <span>{isSimulating ? 'INGESTING…' : '+ SIMULATE INGEST'}</span>
          </button>

          {/* Expand / Minimize Toggle */}
          <button
            className="stream-ctrl-btn"
            onClick={() => setIsExpanded((prev) => !prev)}
            title={isExpanded ? 'Collapse Telemetry Stream' : 'Expand Telemetry Stream'}
            aria-label="Toggle telemetry height"
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>

          {/* Close Panel */}
          <button
            className="stream-ctrl-btn"
            onClick={() => {
              cyberAudio.playClick();
              setBottomPanelVisible(false);
            }}
            title="Close Telemetry Panel (Reopen from Dock) [HotKey: B]"
            aria-label="Close telemetry panel"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Events Stream Viewport */}
      <div className="stream-viewport">
        <div className="stream-list">
          {displayedEvents.length === 0 ? (
            <div className="stream-empty">No telemetry events matching category "{eventCategoryFilter}".</div>
          ) : (
            displayedEvents.map((ev) => {
              const isCrit = ev.severity === 'CRITICAL';
              const isHigh = ev.severity === 'HIGH';
              const dotColor = isCrit ? '#ff2a2a' : isHigh ? '#ff7700' : '#00f0ff';
              const timeFormatted = ev.timestamp?.length > 11 ? ev.timestamp.slice(11, 19) : ev.timestamp;

              return (
                <div key={ev.id} className="stream-row">
                  <span className="row-time">{timeFormatted}</span>
                  <span className="row-dot" style={{ backgroundColor: dotColor }} />
                  {ev.category && <span className="row-cat">[{ev.category}]</span>}
                  <strong className="row-type">{ev.eventType}</strong>
                  <span className="row-target">{ev.entityReference}</span>
                  <span className="row-desc">{ev.description}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </footer>
  );
}

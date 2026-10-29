/**
 * app/spatial/shell/LeftDock.tsx
 *
 * Left Flank Dock & Launcher System.
 *
 * Manages Incidents, Detection Alerts, Threat Hunting, and Rules.
 * When closed, renders an unobtrusive vertical Dock Launcher strip so the analyst
 * can immediately restore panels via pointer click, keyboard ([), or gesture pointing.
 */

'use client';
import { useState, useMemo } from 'react';
import {
  Radio,
  Bell,
  Crosshair,
  Sliders,
  Plus,
  ExternalLink,
  Server,
  Zap,
  Activity,
  Maximize2,
} from 'lucide-react';
import { DockablePanel } from './DockablePanel';
import { useSpatialUi, LeftDockTab } from '../state/use-spatial-ui';
import { spatialTransform } from '../../spatial-transform';
import { cyberAudio } from '../../cyber-audio';
import type { Incident } from '../../core/models/incident';
import type { Alert } from '../../core/models/detection';

export interface LeftDockProps {
  incidents: Incident[];
  alerts: Alert[];
  onSelectIncident: (id: string) => void;
  onSelectAlert: (id: string) => void;
  onCreateIncident?: () => void;
}

export function LeftDock({
  incidents,
  alerts,
  onSelectIncident,
  onSelectAlert,
  onCreateIncident,
}: LeftDockProps) {
  const {
    leftPanelVisible,
    leftDockTab,
    setLeftDockTab,
    toggleLeftPanel,
    setLeftPanelVisible,
  } = useSpatialUi();

  const [incidentFilter, setIncidentFilter] = useState<'ALL' | 'CRITICAL' | 'ACTIVE'>('ALL');
  const [alertFilter, setAlertFilter] = useState<'ALL' | 'CRITICAL' | 'NEW'>('ALL');

  // Filtered incidents
  const displayedIncidents = useMemo(() => {
    let list = incidents.filter((i) => i.status !== 'CLOSED');
    if (incidentFilter === 'CRITICAL') list = list.filter((i) => i.severity === 'CRITICAL');
    else if (incidentFilter === 'ACTIVE') list = list.filter((i) => i.status === 'INVESTIGATING');
    return list;
  }, [incidents, incidentFilter]);

  // Filtered alerts
  const displayedAlerts = useMemo(() => {
    let list = alerts;
    if (alertFilter === 'CRITICAL') list = list.filter((a) => a.severity === 'CRITICAL');
    else if (alertFilter === 'NEW') list = list.filter((a) => a.status === 'NEW');
    return list;
  }, [alerts, alertFilter]);

  // If dock is closed, render compact vertical launcher strip
  if (!leftPanelVisible) {
    return (
      <aside className="dock-launcher-strip left-strip" aria-label="Left Dock Launcher">
        <button
          className={`launcher-btn ${leftDockTab === 'INCIDENTS' ? 'active' : ''}`}
          onClick={() => {
            cyberAudio.playClick();
            setLeftDockTab('INCIDENTS');
          }}
          title="Open Incidents Panel [HotKey: []"
        >
          <Radio size={13} className="text-cyan" />
          <span className="launcher-label">INCIDENTS</span>
          <span className="launcher-counter">{incidents.filter((i) => i.status !== 'CLOSED').length}</span>
        </button>

        <button
          className={`launcher-btn ${leftDockTab === 'ALERTS' ? 'active' : ''}`}
          onClick={() => {
            cyberAudio.playClick();
            setLeftDockTab('ALERTS');
          }}
          title="Open Alerts Panel"
        >
          <Bell size={13} className="text-amber" />
          <span className="launcher-label">ALERTS</span>
          <span className="launcher-counter">{alerts.filter((a) => a.status !== 'RESOLVED').length}</span>
        </button>

        <button
          className="launcher-btn"
          onClick={() => {
            cyberAudio.playModeSwitch();
            spatialTransform.setMode('HUNTING');
          }}
          title="Threat Hunting Workspace [HotKey: H]"
        >
          <Crosshair size={13} className="text-line" />
          <span className="launcher-label">HUNT</span>
        </button>

        <button
          className="launcher-btn"
          onClick={() => {
            cyberAudio.playModeSwitch();
            spatialTransform.setMode('DETECTION');
          }}
          title="Detection Rules Workspace [HotKey: D]"
        >
          <Sliders size={13} className="text-line" />
          <span className="launcher-label">RULES</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="spatial-dock-container left-dock-container" aria-label="Incident and Alert Command Dock">
      <DockablePanel
        id="left-dock"
        title={leftDockTab === 'INCIDENTS' ? 'INCIDENT COMMAND' : leftDockTab === 'ALERTS' ? 'DETECTION ALERTS' : 'OPERATIONAL DOCK'}
        icon={leftDockTab === 'INCIDENTS' ? <Radio size={13} /> : <Bell size={13} />}
        isOpen={leftPanelVisible}
        onClose={() => setLeftPanelVisible(false)}
        actions={
          <div className="dock-tab-pills">
            <button
              className={`dock-tab-btn ${leftDockTab === 'INCIDENTS' ? 'active' : ''}`}
              onClick={() => {
                cyberAudio.playClick();
                setLeftDockTab('INCIDENTS');
              }}
            >
              INCIDENTS ({incidents.filter((i) => i.status !== 'CLOSED').length})
            </button>
            <button
              className={`dock-tab-btn ${leftDockTab === 'ALERTS' ? 'active' : ''}`}
              onClick={() => {
                cyberAudio.playClick();
                setLeftDockTab('ALERTS');
              }}
            >
              ALERTS ({alerts.filter((a) => a.status !== 'RESOLVED').length})
            </button>
          </div>
        }
      >
        {/* Tab 1: Incidents Stream */}
        {leftDockTab === 'INCIDENTS' && (
          <div className="dock-tab-content">
            <div className="dock-filter-toolbar">
              <div className="dock-filters">
                <button
                  className={`dock-filter-pill ${incidentFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setIncidentFilter('ALL')}
                >
                  ALL
                </button>
                <button
                  className={`dock-filter-pill ${incidentFilter === 'CRITICAL' ? 'active' : ''}`}
                  onClick={() => setIncidentFilter('CRITICAL')}
                >
                  CRIT
                </button>
                <button
                  className={`dock-filter-pill ${incidentFilter === 'ACTIVE' ? 'active' : ''}`}
                  onClick={() => setIncidentFilter('ACTIVE')}
                >
                  ACTIVE
                </button>
              </div>

              {onCreateIncident && (
                <button
                  className="dock-create-btn"
                  onClick={() => {
                    cyberAudio.playClick();
                    onCreateIncident();
                  }}
                  title="Create new incident offline"
                >
                  <Plus size={11} /> NEW
                </button>
              )}
            </div>

            <div className="dock-cards-scroll">
              {displayedIncidents.length === 0 ? (
                <div className="dock-empty">No active incidents matching filter.</div>
              ) : (
                displayedIncidents.map((incident) => {
                  const isCrit = incident.severity === 'CRITICAL';
                  const isHigh = incident.severity === 'HIGH';
                  const sevColor = isCrit ? '#ff2a2a' : isHigh ? '#ff7700' : '#3dffb0';

                  return (
                    <article
                      key={incident.id}
                      className={`dock-card incident-card soc-motion-interactive ${isCrit ? 'is-critical' : ''}`}
                      onClick={() => {
                        cyberAudio.playSelect();
                        onSelectIncident(incident.id);
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open investigation for ${incident.id}`}
                    >
                      <div className="card-top-row">
                        <span className="card-id">{incident.id}</span>
                        {incident.priority && (
                          <span className="card-prio-tag">{incident.priority}</span>
                        )}
                        <span className="card-sev-tag" style={{ borderColor: sevColor, color: sevColor }}>
                          {incident.severity}
                        </span>
                        <span className="card-status-tag">{incident.status}</span>
                      </div>

                      <h4 className="card-title">{incident.title}</h4>

                      <div className="card-metrics-row">
                        <span><Server size={10} /> {incident.affectedAssets.length} Hosts</span>
                        <span><Activity size={10} /> {incident.iocs.length} IOCs</span>
                        <span><Zap size={10} /> {incident.riskScore} Risk</span>
                      </div>

                      <div className="card-cue-row soc-motion-meta-reveal">
                        <span>INVESTIGATE IN SPATIAL</span>
                        <ExternalLink size={10} />
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Correlated Alerts Stream */}
        {leftDockTab === 'ALERTS' && (
          <div className="dock-tab-content">
            <div className="dock-filter-toolbar">
              <div className="dock-filters">
                <button
                  className={`dock-filter-pill ${alertFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('ALL')}
                >
                  ALL
                </button>
                <button
                  className={`dock-filter-pill ${alertFilter === 'CRITICAL' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('CRITICAL')}
                >
                  CRIT
                </button>
                <button
                  className={`dock-filter-pill ${alertFilter === 'NEW' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('NEW')}
                >
                  NEW
                </button>
              </div>
            </div>

            <div className="dock-cards-scroll">
              {displayedAlerts.length === 0 ? (
                <div className="dock-empty">No detection alerts matching filter.</div>
              ) : (
                displayedAlerts.map((alert) => {
                  const isCrit = alert.severity === 'CRITICAL';
                  const isHigh = alert.severity === 'HIGH';
                  const sevColor = isCrit ? '#ff2a2a' : isHigh ? '#ff7700' : '#00f0ff';
                  const timeFormatted = alert.lastSeenAt.length > 11 ? alert.lastSeenAt.slice(11, 19) : alert.lastSeenAt;

                  return (
                    <article
                      key={alert.id}
                      className={`dock-card alert-card soc-motion-interactive soc-alert-enter soc-alert-sev-${alert.severity.toLowerCase()} ${isCrit ? 'is-critical' : ''}`}
                      onClick={() => {
                        cyberAudio.playClick();
                        onSelectAlert(alert.id);
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      <div className="card-top-row soc-alert-classification">
                        <span className="card-id">{alert.id}</span>
                        <span className="card-sev-tag soc-alert-severity-active" style={{ borderColor: sevColor, color: sevColor }}>
                          {alert.severity}
                        </span>
                        <span className="card-time-tag">{timeFormatted}</span>
                      </div>

                      <h4 className="card-title">{alert.title}</h4>
                      <p className="card-desc soc-alert-body">{alert.description}</p>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        )}
      </DockablePanel>
    </aside>
  );
}

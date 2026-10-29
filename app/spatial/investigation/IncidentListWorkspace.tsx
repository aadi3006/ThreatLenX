/**
 * app/spatial/investigation/IncidentListWorkspace.tsx
 *
 * Dedicated Spatial Investigation Workspace — Incident Selection Level.
 *
 * Implements Phase C of the Spatial SOC Drill-Down:
 *   SPATIAL HUB → INVESTIGATION (Incident List) → FOCUSED INCIDENT (Timeline/Attack Graph)
 *
 * Features:
 * - Single focused view: center-dominant, no distracting side docks or permanent dashboards.
 * - Full input parity:
 *     * Cursor: hover highlight, smooth scroll, click to select.
 *     * Keyboard: ArrowUp / ArrowDown to highlight, Enter to select, Escape to return to Hub.
 *     * Hand Gestures: Card elements registered for point + dwell selection via SpatialController.
 *     * Simulator: Works through same GestureIntent pipeline.
 * - Smooth spatial transition when selecting an incident (card expands toward center, list recedes).
 */

'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSecuritySpatial } from '../state/use-security-spatial';
import { spatialNavStore, useSpatialNav } from '../state/use-spatial-nav';
import { spatialTransform } from '../../spatial-transform';
import { cyberAudio } from '../../cyber-audio';
import type { Incident } from '../../core/models/incident';
import {
  ShieldAlert,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Activity,
  AlertTriangle,
  Server,
  Fingerprint,
  FileCode2,
  Clock,
  ExternalLink,
  Crosshair,
  User,
  Layers,
  FolderArchive,
  Lock,
} from 'lucide-react';
import './investigation.css';

interface IncidentListWorkspaceProps {
  onSelectIncident: (id: string) => void;
  onBackToHub: () => void;
  onRegisterPanel?: (id: string, el: HTMLElement | null) => void;
}

export type SelectionAnimationPhase = 'IDLE' | 'LOCKED' | 'RECEDING' | 'EXPANDING' | 'ENTITIES_APPEAR';

export default function IncidentListWorkspace({
  onSelectIncident,
  onBackToHub,
  onRegisterPanel,
}: IncidentListWorkspaceProps) {
  const { incidents, isReady } = useSecuritySpatial();
  const nav = useSpatialNav();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [transitionPhase, setTransitionPhase] = useState<SelectionAnimationPhase>('IDLE');
  const [transitioningIncidentId, setTransitioningIncidentId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const transitionTimerRef = useRef<{ t1?: any; t2?: any; t3?: any; t4?: any }>({});

  const cancelTransition = useCallback(() => {
    if (transitionTimerRef.current.t1) clearTimeout(transitionTimerRef.current.t1);
    if (transitionTimerRef.current.t2) clearTimeout(transitionTimerRef.current.t2);
    if (transitionTimerRef.current.t3) clearTimeout(transitionTimerRef.current.t3);
    if (transitionTimerRef.current.t4) clearTimeout(transitionTimerRef.current.t4);
    setTransitionPhase('IDLE');
    setTransitioningIncidentId(null);
  }, []);

  // Filter out closed incidents for active investigation
  const activeIncidents = incidents.filter((i) => i.status !== 'CLOSED');
  const displayList = activeIncidents.length > 0 ? activeIncidents : incidents;

  // Sync nav store state
  useEffect(() => {
    spatialNavStore.goToWorkspace('INVESTIGATION');
    return () => cancelTransition();
  }, [cancelTransition]);

  // 5-Phase Incident Selection Animation:
  // 1. incident locks (0ms)
  // 2. target/reticle appears (0ms)
  // 3. background recedes (120ms)
  // 4. incident expands (220ms)
  // 5. related entities appear (320ms)
  // 6. investigation workspace becomes active (440ms)
  const handleSelect = useCallback(
    (incident: Incident) => {
      cancelTransition();
      cyberAudio.playSelect();
      setTransitioningIncidentId(incident.id);
      setTransitionPhase('LOCKED');

      // Phase 2: Background recedes
      transitionTimerRef.current.t1 = setTimeout(() => {
        setTransitionPhase('RECEDING');

        // Phase 3: Incident expands
        transitionTimerRef.current.t2 = setTimeout(() => {
          setTransitionPhase('EXPANDING');

          // Phase 4: Related entities appear
          transitionTimerRef.current.t3 = setTimeout(() => {
            setTransitionPhase('ENTITIES_APPEAR');

            // Phase 5: Investigation workspace constructs & activates
            transitionTimerRef.current.t4 = setTimeout(() => {
              const shortId = incident.id.toUpperCase().replace('INCIDENT-', 'INC-');
              spatialNavStore.goToItem(incident.id, `${shortId} — ${incident.title}`);
              onSelectIncident(incident.id);
            }, 120);
          }, 100);
        }, 100);
      }, 120);
    },
    [onSelectIncident, cancelTransition]
  );

  // Keyboard navigation: ArrowUp, ArrowDown, Enter, Escape (Interruptible)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cancelTransition();
        cyberAudio.playScan();
        setSelectedIndex((prev) => Math.min(displayList.length - 1, prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cancelTransition();
        cyberAudio.playScan();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (displayList[selectedIndex]) {
          handleSelect(displayList[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cyberAudio.playClick();
        if (transitioningIncidentId) {
          cancelTransition();
        } else {
          onBackToHub();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayList, selectedIndex, handleSelect, onBackToHub, transitioningIncidentId, cancelTransition]);

  // Register card elements for hand gesture hit testing (Point + Dwell)
  useEffect(() => {
    if (!onRegisterPanel) return;
    const cards = cardRefs.current;
    cards.forEach((el, id) => {
      onRegisterPanel(id, el);
    });
    return () => {
      cards.forEach((_, id) => {
        onRegisterPanel(id, null);
      });
    };
  }, [displayList, onRegisterPanel]);

  // Auto-scroll selected card into view
  useEffect(() => {
    const cur = displayList[selectedIndex];
    if (cur) {
      const el = cardRefs.current.get(cur.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedIndex, displayList]);

  if (!isReady) {
    return (
      <div className="inv-list-workspace inv-list-loading">
        <div className="inv-hub-boot-ring" />
        <span className="inv-list-loading-text">LOADING ACTIVE INCIDENTS…</span>
      </div>
    );
  }

  return (
    <div
      className={`inv-list-workspace ${transitioningIncidentId ? 'is-launching' : ''}`}
      role="region"
      aria-label="Active Security Incidents List"
    >
      {/* Workspace Header Strip */}
      <div className="inv-list-header">
        <div className="inv-list-header-left">
          <button
            className="inv-list-back-btn"
            onClick={() => {
              cyberAudio.playClick();
              onBackToHub();
            }}
            title="Return to Central Spatial Command Hub [ESC / Fist]"
          >
            <ArrowLeft size={13} />
            <span>SPATIAL HUB</span>
          </button>
          <span className="inv-list-sep">/</span>
          <span className="inv-list-title-tag">
            <ShieldAlert size={14} className="text-emerald" />
            INVESTIGATION WORKSPACE
          </span>
        </div>

        <div className="inv-list-header-right">
          <span className="inv-list-count-badge">
            {displayList.length} INCIDENT{displayList.length === 1 ? '' : 'S'} ACTIVE
          </span>
          <span className="inv-list-kbd-hint">
            [↑/↓] NAVIGATE &nbsp;·&nbsp; [ENTER] INVESTIGATE &nbsp;·&nbsp; [ESC] HUB
          </span>
        </div>
      </div>

      {/* State Preservation: Quick-recovery for active investigation */}
      {nav.preservedInvestigationItem && (
        <div className="inv-recover-banner" role="status">
          <div className="inv-recover-left">
            <Activity size={14} className="text-cyan animate-pulse" />
            <span className="inv-recover-text">
              ACTIVE SESSION PRESERVED:&nbsp;
              <strong>{nav.preservedInvestigationItem.toUpperCase().replace('INCIDENT-', 'INC-')}</strong>
              {nav.preservedInvestigationPanel && (
                <span>&nbsp;·&nbsp;PANEL: <strong>{nav.preservedInvestigationPanel}</strong></span>
              )}
            </span>
          </div>
          <button
            className="inv-recover-btn"
            onClick={() => {
              cyberAudio.playSelect();
              spatialNavStore.goToItem(nav.preservedInvestigationItem!);
              onSelectIncident(nav.preservedInvestigationItem!);
            }}
            title="Resume previously active investigation session [ENTER]"
          >
            RESUME SESSION [ENTER]
          </button>
        </div>
      )}

      {/* Centered Incident Cards Container */}
      <div className="inv-list-scroll-area">
        <div className="inv-list-cards-container">
          <div className="inv-list-subheading">
            <h2 className="inv-list-heading">SELECT INCIDENT FOR SPATIAL DRILL-DOWN</h2>
            <p className="inv-list-desc">
              Choose an incident to inspect the causal attack graph, forensic timeline, MITRE coverage, and response telemetry.
            </p>
          </div>

          <div className={`inv-list-cards-stack ${transitioningIncidentId ? 'has-locked-card' : ''}`} role="listbox" aria-label="Incidents List">
            {displayList.map((inc, index) => {
              const isSelected = selectedIndex === index;
              const isTargeted = transitioningIncidentId === inc.id;
              const isLocked = isTargeted && transitionPhase === 'LOCKED';
              const isReceding = !isTargeted && transitioningIncidentId !== null && (transitionPhase === 'RECEDING' || transitionPhase === 'EXPANDING' || transitionPhase === 'ENTITIES_APPEAR');
              const isExpanding = isTargeted && (transitionPhase === 'EXPANDING' || transitionPhase === 'ENTITIES_APPEAR');
              const isFocused = isSelected || isTargeted;
              const shortId = inc.id.toUpperCase().replace('INCIDENT-', 'INC-');
              const sevClass = inc.severity.toLowerCase();
              const confidencePct = Math.round((inc.confidence ?? 0.85) * 100);
              const riskVal = Math.round(inc.riskScore ?? 80);

              const handleQuickPivot = (e: React.MouseEvent, panel: 'ATTACK' | 'TIMELINE' | 'IOCs' | 'MITRE' | 'EVIDENCE' | 'RESPONSE') => {
                e.stopPropagation();
                cyberAudio.playClick();
                spatialNavStore.setActivePanel(panel);
                handleSelect(inc);
              };

              return (
                <div
                  key={inc.id}
                  id={`incident-${inc.id}`}
                  ref={(el) => {
                    if (el) cardRefs.current.set(inc.id, el);
                    else cardRefs.current.delete(inc.id);
                  }}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`inv-incident-card sev-${sevClass} ${isSelected ? 'is-selected' : ''} ${
                    isLocked ? 'is-card-locked' : ''
                  } ${isExpanding ? 'is-card-expanding' : ''} ${isReceding ? 'is-card-receding' : ''} ${
                    !isFocused ? 'inv-card-unselected' : 'inv-card-focused'
                  }`}
                  onMouseEnter={() => {
                    if (!transitioningIncidentId) setSelectedIndex(index);
                  }}
                  onClick={() => handleSelect(inc)}
                >
                  {/* Selection Target Reticle overlay */}
                  {isTargeted && (
                    <div className="inv-card-target-reticle" aria-hidden="true">
                      <div className="reticle-ring" />
                      <div className="reticle-crosshair-h" />
                      <div className="reticle-crosshair-v" />
                      <div className="reticle-corner tl" />
                      <div className="reticle-corner tr" />
                      <div className="reticle-corner bl" />
                      <div className="reticle-corner br" />
                      <span className="reticle-status">TARGET ACQUIRED · ENTITY COORDINATES LOCKED</span>
                    </div>
                  )}

                  {/* ── ESSENTIAL ATTRIBUTES (Always visible: ID, Title, Severity, Status, Risk) ── */}
                  <div className="inv-card-essential">
                    <div className="inv-card-essential-header">
                      <div className="inv-card-badges">
                        <span className="inv-card-id">{shortId}</span>
                        <span className={`inv-card-sev sev-${sevClass}`}>
                          {inc.severity}
                        </span>
                        <span className="inv-card-status">
                          {inc.status}
                        </span>
                      </div>

                      <div className="inv-card-risk">
                        <span className="inv-risk-label">RISK</span>
                        <div className="inv-risk-bar-wrap">
                          <div
                            className={`inv-risk-bar-fill sev-${sevClass}`}
                            style={{ width: `${Math.min(100, Math.max(10, riskVal))}%` }}
                          />
                        </div>
                        <span className="inv-risk-val">{riskVal}/100</span>
                      </div>
                    </div>

                    <div className="inv-card-title-row">
                      <h3 className="inv-card-title">{inc.title}</h3>
                      {!isFocused && (
                        <span className="inv-card-hint-click">SELECT TO EXPAND ▾</span>
                      )}
                    </div>
                  </div>

                  {/* ── SECONDARY INFORMATION (Appears ONLY when selected/focused) ── */}
                  {isFocused && (
                    <div className="inv-card-focused-details" aria-label="Expanded Incident Details">
                      {/* Severity & Confidence State Banner */}
                      <div className="inv-card-state-banner">
                        <div className="inv-state-pill">
                          <span className="inv-state-label">CONFIDENCE</span>
                          <span className="inv-state-val text-cyan">{confidencePct}%</span>
                        </div>
                        {inc.priority && (
                          <div className="inv-state-pill">
                            <span className="inv-state-label">PRIORITY</span>
                            <span className="inv-state-val" style={{ color: inc.priority === 'P1' ? '#ff2a2a' : '#ffb700' }}>
                              {inc.priority}
                            </span>
                          </div>
                        )}
                        <div className="inv-state-pill">
                          <span className="inv-state-label">RESPONSE STATE</span>
                          <span className="inv-state-val">{inc.status}</span>
                        </div>
                        <div className="inv-state-lock-tag">
                          <Lock size={10} />
                          <span>LOCKED SECURITY ENTITY</span>
                        </div>
                      </div>

                      {/* Brief Incident Summary */}
                      <p className="inv-card-summary">
                        {inc.summary || inc.description || 'Targeted multi-stage security intrusion requiring immediate containment.'}
                      </p>

                      {/* ── CONCEPTUAL RELATIONSHIP REVEAL TIERS ── */}
                      <div className="inv-entity-tiers">
                        {/* TIER 1: CORE TARGET ENTITIES (ASSET, USER, IOC) */}
                        <div className="inv-entity-tier">
                          <div className="inv-tier-header">
                            <span className="inv-tier-num">1</span>
                            <span className="inv-tier-title">TARGET ENTITIES</span>
                            <span className="inv-tier-sub">ASSET · USER · IOC</span>
                          </div>
                          <div className="inv-tier-chips">
                            {(inc.affectedAssets?.length ? inc.affectedAssets : ['srv-core-01']).slice(0, 3).map((a) => (
                              <span key={a} className="inv-tier-badge badge-asset" title={`Affected Asset: ${a}`}>
                                <Server size={10} /> {a}
                              </span>
                            ))}
                            {(inc.affectedUsers?.length ? inc.affectedUsers : ['svc-secops']).slice(0, 2).map((u) => (
                              <span key={u} className="inv-tier-badge badge-user" title={`Affected User: ${u}`}>
                                <User size={10} /> {u}
                              </span>
                            ))}
                            {(inc.iocs?.length ? inc.iocs : ['198.51.100.24']).slice(0, 3).map((ioc) => (
                              <span key={ioc} className="inv-tier-badge badge-ioc" title={`IOC: ${ioc}`}>
                                <Fingerprint size={10} /> {ioc}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* TIER 2: TELEMETRY & EVIDENCE (EVENTS, EVIDENCE, MITRE) */}
                        <div className="inv-entity-tier">
                          <div className="inv-tier-header">
                            <span className="inv-tier-num">2</span>
                            <span className="inv-tier-title">TELEMETRY & EVIDENCE</span>
                            <span className="inv-tier-sub">DETECTIONS · EVIDENCE · MITRE</span>
                          </div>
                          <div className="inv-tier-chips">
                            <span className="inv-tier-badge badge-event" title="Correlated Alerts / Detections">
                              <AlertTriangle size={10} className="text-amber" />
                              <span>{inc.alertIds?.length ?? 1} Detections</span>
                            </span>
                            <span className="inv-tier-badge badge-evidence" title="Forensic Evidence Items">
                              <FolderArchive size={10} className="text-emerald" />
                              <span>{inc.evidence?.length ?? 2} Artifacts</span>
                            </span>
                            {(inc.mitreTechniques?.length ? inc.mitreTechniques : ['T1078.002']).slice(0, 2).map((t) => (
                              <span key={t} className="inv-tier-badge badge-mitre" title={`MITRE ATT&CK: ${t}`}>
                                <FileCode2 size={10} /> {t}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* TIER 3: TEMPORAL & ATTACK GRAPH PROGRESSION */}
                        <div className="inv-entity-tier">
                          <div className="inv-tier-header">
                            <span className="inv-tier-num">3</span>
                            <span className="inv-tier-title">CAUSAL ATTACK GRAPH & TIMELINE</span>
                            <span className="inv-tier-sub">EVENTS · STAGES</span>
                          </div>
                          <div className="inv-tier-chips">
                            <span className="inv-tier-badge badge-timeline" title="Timeline Progression">
                              <Clock size={10} />
                              <span>{inc.timelineEvents?.length ?? 4} Timeline Events</span>
                            </span>
                            <span className="inv-tier-badge badge-graph" title="Attack Graph Causal Path">
                              <Layers size={10} />
                              <span>Causal Path Formed</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* ── INVESTIGATION CONTROLS ── */}
                      <div className="inv-card-controls-panel">
                        <button
                          className="inv-card-primary-investigate-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelect(inc);
                          }}
                          title="Open Full 3D Spatial Investigation [ENTER]"
                        >
                          <span>INVESTIGATE INCIDENT [ENTER]</span>
                          <ArrowRight size={13} />
                        </button>

                        <div className="inv-card-quick-pivots">
                          <span className="inv-pivot-label">QUICK DRILL:</span>
                          <button
                            className="inv-quick-pivot-btn"
                            onClick={(e) => handleQuickPivot(e, 'ATTACK')}
                            title="Directly inspect Causal Attack Graph"
                          >
                            ATTACK GRAPH
                          </button>
                          <button
                            className="inv-quick-pivot-btn"
                            onClick={(e) => handleQuickPivot(e, 'TIMELINE')}
                            title="Directly inspect Forensic Timeline"
                          >
                            TIMELINE
                          </button>
                          <button
                            className="inv-quick-pivot-btn"
                            onClick={(e) => handleQuickPivot(e, 'IOCs')}
                            title="Directly inspect IOCs & Signatures"
                          >
                            IOCs
                          </button>
                          <button
                            className="inv-quick-pivot-btn"
                            onClick={(e) => handleQuickPivot(e, 'EVIDENCE')}
                            title="Directly inspect Forensic Evidence"
                          >
                            EVIDENCE
                          </button>
                          <button
                            className="inv-quick-pivot-btn"
                            onClick={(e) => handleQuickPivot(e, 'RESPONSE')}
                            title="Directly inspect Containment & Response"
                          >
                            RESPONSE
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

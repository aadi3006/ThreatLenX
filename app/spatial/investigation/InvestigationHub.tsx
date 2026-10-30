/**
 * InvestigationHub.tsx
 *
 * The top-level investigation experience.
 * Mounts InvestigationProvider wrapping all visualizations.
 * Manages view switching (progressive disclosure).
 *
 * Progressive disclosure model:
 *   Focused Incident
 *     └─ Investigation Mode (this component)
 *          ├─ ATTACK    → AttackGraph
 *          ├─ TIMELINE  → SpatialTimeline
 *          ├─ MITRE     → SpatialMitreMatrix
 *          ├─ SYSTEMS   → SystemRadar
 *          ├─ IOCs      → IOCConstellation
 *          └─ REPLAY    → AttackReplay
 *
 * Gesture contract:
 *   - onRegister/onExitFocus are forwarded from soc-spatial.tsx
 *   - No gesture recognition inside this component
 *   - Fist gesture → onExitFocus() → closes investigation
 *   - Point+dwell on a visualization entity → setSelectedEntity (via context)
 */

'use client';
import { useEffect, useRef, useState } from 'react';
import { InvestigationProvider, useInvestigation } from './InvestigationContext';
import ContextualAiAssistant from '../ai/ContextualAiAssistant';
import AttackGraph from './attack-graph/AttackGraph';
import SpatialTimeline from './timeline/SpatialTimeline';
import SpatialMitreMatrix from './mitre/SpatialMitreMatrix';
import SystemRadar from './systems/SystemRadar';
import IOCConstellation from './iocs/IOCConstellation';
import AttackReplay from './replay/AttackReplay';
import ResponseSpace from '../response/ResponseSpace';
import IncidentEvidenceView from './IncidentEvidenceView';
import IncidentFindingsView from './IncidentFindingsView';
import IncidentNotesView from './IncidentNotesView';
import { VIEW_LABELS } from './investigation-state';
import type { InvestigationView } from './investigation-state';
import { X, ChevronRight, ShieldAlert, Briefcase, FileCheck, Brain, ArrowLeft } from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';
import { spatialTransform } from '../../spatial-transform';
import { securityService } from '../../core/security-service';
import { spatialNavStore, useSpatialNav } from '../state/use-spatial-nav';
import { socNavStore } from '../state/use-soc-nav';
import './investigation.css';

// ─── View component map ───────────────────────────────────────────────────────

const VIEW_COMPONENTS: Record<InvestigationView, React.ComponentType<any>> = {
  TIMELINE: SpatialTimeline,
  ATTACK:   AttackGraph,
  IOCs:     IOCConstellation,
  MITRE:    SpatialMitreMatrix,
  EVIDENCE: IncidentEvidenceView,
  FINDINGS: IncidentFindingsView,
  NOTES:    IncidentNotesView,
  RESPONSE: ResponseSpace,
  SYSTEMS:  SystemRadar,
  REPLAY:   AttackReplay,
};

// Canonical 9-panel compact navigator
const VIEW_ORDER: InvestigationView[] = [
  'TIMELINE',
  'ATTACK',
  'IOCs',
  'SYSTEMS',
  'MITRE',
  'EVIDENCE',
  'FINDINGS',
  'NOTES',
  'RESPONSE',
];

// ─── Inner panel (inside Provider) ───────────────────────────────────────────

interface InnerProps {
  panelId: string;
  onRegister: (id: string, el: HTMLElement | null) => void;
  onExitFocus: () => void;
}

function InvestigationHubInner({ panelId, onRegister, onExitFocus }: InnerProps) {
  const {
    isLoading,
    error,
    data,
    activeView,
    setActiveView,
    selectedEntity,
    setSelectedEntity,
    replay,
    choreography,
    skipChoreography,
    triggerCollapse,
  } = useInvestigation();

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    onRegister(panelId, el);
    return () => onRegister(panelId, null);
  }, [panelId, onRegister]);

  const [isContextualAiOpen, setIsContextualAiOpen] = useState(false);

  // Hotkey listener: Spacebar skips construction, 'A' toggles Contextual AI
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && choreography.phase === 'CONTEXT_BUILDING') {
        e.preventDefault();
        cyberAudio.playClick();
        skipChoreography();
      } else if (e.key === 'a' || e.key === 'A') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        cyberAudio.playClick();
        setIsContextualAiOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [choreography.phase, skipChoreography]);

  const ActiveView = VIEW_COMPONENTS[activeView];

  // Sync nav store panel → investigation activeView
  const nav = useSpatialNav();
  useEffect(() => {
    if (nav.activePanel && nav.activePanel !== activeView && VIEW_ORDER.includes(nav.activePanel as InvestigationView)) {
      setActiveView(nav.activePanel as InvestigationView);
    }
  }, [nav.activePanel]);

  // When investigation hub mounts with an incident, sync to nav store
  useEffect(() => {
    if (data) {
      const shortId = data.incident.id.toUpperCase().replace('INCIDENT-', 'INC-');
      spatialNavStore.goToItem(data.incident.id, `${shortId} — ${data.incident.title}`);
    }
  }, [data?.incident.id]);

  const handleSetView = (view: InvestigationView) => {
    cyberAudio.playClick();
    setActiveView(view);
    spatialNavStore.setActivePanel(view);
  };

  const handleExit = () => {
    cyberAudio.playClick();
    triggerCollapse(() => {
      onExitFocus();
    });
  };

  // ── Keyboard Navigation (Left/Right → cycle panel, Enter → activate, Escape → back to list) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        cyberAudio.playScan();
        const currentIdx = VIEW_ORDER.indexOf(activeView);
        const prevIdx = (currentIdx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length;
        handleSetView(VIEW_ORDER[prevIdx]);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        cyberAudio.playScan();
        const currentIdx = VIEW_ORDER.indexOf(activeView);
        const nextIdx = (currentIdx + 1) % VIEW_ORDER.length;
        handleSetView(VIEW_ORDER[nextIdx]);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cyberAudio.playSelect();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cyberAudio.playClick();
        const state = socNavStore.getState();
        if (state.activeInvestigationPanel !== null) {
          socNavStore.navigateBack();
        } else {
          triggerCollapse(() => {
            onExitFocus();
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="inv-hub inv-hub-loading" ref={panelRef}>
        <div className="inv-hub-boot-ring" />
        <span className="inv-hub-boot-text">INITIALIZING INVESTIGATION HUB…</span>
      </div>
    );
  }

  // ── Error: Controlled failure state with explanation and remediation ──────────
  if (error || !data) {
    return (
      <div className="inv-hub inv-hub-error soc-motion-failure soc-failure-box" ref={panelRef} style={{ maxWidth: 560, margin: '60px auto', padding: 20 }}>
        <div className="soc-failure-header">
          <ShieldAlert size={16} />
          <span>INCIDENT CONTEXT ACQUISITION FAILED</span>
        </div>
        <div className="soc-failure-explanation">{error ?? 'Incident record or telemetry is currently unavailable in local store.'}</div>
        <div className="soc-failure-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="soc-remediation-btn"
            onClick={() => {
              cyberAudio.playClick();
              spatialNavStore.navigateBack();
            }}
          >
            <ArrowLeft size={11} /> RETURN TO INCIDENTS
          </button>
          <button className="inv-exit-btn" onClick={handleExit} style={{ marginLeft: 8 }}>
            EXIT TO HUB
          </button>
        </div>
      </div>
    );
  }

  const inc = data.incident;
  const shortId = inc.id.toUpperCase().replace('INCIDENT-', 'INC-');
  const confidencePct = Math.round(
    inc.confidence != null ? (inc.confidence <= 1 ? inc.confidence * 100 : inc.confidence) : 94
  );
  const riskScore = Math.round(inc.riskScore ?? 80);

  return (
    <div
      className={`inv-hub phase-${choreography.phase.toLowerCase()} step-${choreography.subStep.toLowerCase()}${choreography.phase === 'COLLAPSING' ? ' is-collapsing' : ''}`}
      ref={panelRef}
      role="region"
      aria-label={`Investigation: ${inc.title}`}
    >
      {/* ── Choreography Construction Banner ── */}
      {choreography.phase === 'CONTEXT_BUILDING' && (
        <div className="inv-choreo-bar" aria-live="polite">
          <div className="inv-choreo-fill" style={{ width: `${Math.round(choreography.progress * 100)}%` }} />
          <div className="inv-choreo-content">
            <span className="inv-choreo-tag">SYNCHRONIZING INCIDENT CONTEXT</span>
            <span className="inv-choreo-label">{choreography.subStep.replace(/_/g, ' ')}</span>
            <button className="inv-choreo-skip" onClick={skipChoreography} title="Skip sequence to interactive canvas [SPACE]">
              FAST-FORWARD [SPACE]
            </button>
          </div>
        </div>
      )}

      {/* ── Focused Incident Header: INCIDENT ID, TITLE, SEVERITY, CONFIDENCE, RISK, STATUS ── */}
      <div className="inv-header">
        <div className="inv-header-left">
          <button
            className="inv-exit-btn inv-back-btn"
            onClick={handleExit}
            title="Return to Command Center / Incidents [ESC]"
          >
            <ArrowLeft size={11} /> {
              socNavStore.getState().previousScreen?.workspace === 'CASES' ? 'CASES' :
              socNavStore.getState().previousScreen?.workspace === 'HUNTING' ? 'HUNTING' :
              socNavStore.getState().previousScreen?.workspace === 'EVIDENCE' ? 'EVIDENCE' :
              'COMMAND CENTER'
            }
          </button>

          {/* INCIDENT ID */}
          <div className="inv-header-field">
            <span className="inv-field-label">INCIDENT ID</span>
            <span className="inv-badge-id">{shortId}</span>
          </div>

          {/* TITLE */}
          <div className="inv-header-field inv-field-title">
            <span className="inv-field-label">TITLE</span>
            <span className="inv-header-incident-title" title={inc.title}>{inc.title}</span>
          </div>

          {/* SEVERITY */}
          <div className="inv-header-field">
            <span className="inv-field-label">SEVERITY</span>
            <span className={`inv-badge-sev sev-${inc.severity.toLowerCase()}`}>{inc.severity}</span>
          </div>

          {/* CONFIDENCE */}
          <div className="inv-header-field">
            <span className="inv-field-label">CONFIDENCE</span>
            <span className="inv-confidence-badge">{confidencePct}%</span>
          </div>

          {/* RISK */}
          <div className="inv-header-field">
            <span className="inv-field-label">RISK</span>
            <span className={`inv-risk-badge sev-${inc.severity.toLowerCase()}`}>{riskScore}/100</span>
          </div>

          {/* STATUS */}
          <div className="inv-header-field">
            <span className="inv-field-label">STATUS</span>
            <span className={`inv-status-badge status-${inc.status.toLowerCase()}`}>{inc.status}</span>
          </div>
        </div>

        <div className="inv-header-right">
          {replay.status !== 'IDLE' && replay.status !== 'COMPLETED' && (
            <span className="inv-replay-indicator">
              ▶ REPLAY {replay.currentStep + 1}/{replay.totalSteps}
            </span>
          )}
          {selectedEntity && (
            <span
              className="inv-sel-indicator"
              onClick={() => {
                cyberAudio.playClick();
                setSelectedEntity(null);
              }}
              title="Click to clear entity selection [ESC]"
              style={{ cursor: 'pointer' }}
            >
              SEL: {selectedEntity.type} · {selectedEntity.id.slice(0, 12)} ✕
            </span>
          )}
          <button
            className="inv-ai-btn"
            style={{
              borderColor: isContextualAiOpen ? '#00f0ff' : 'rgba(0, 240, 255, 0.4)',
              color: '#00f0ff',
              background: isContextualAiOpen ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
              marginRight: 4,
            }}
            onClick={() => {
              cyberAudio.playClick();
              setIsContextualAiOpen((prev) => !prev);
            }}
            title="Toggle Contextual AI Incident Explanation [HotKey: A]"
          >
            <Brain size={12} /> AI EXPLANATION [A]
          </button>
          <button
            className="inv-exit-btn"
            onClick={handleExit}
            aria-label="Exit investigation mode to Spatial Hub [ESC]"
            title="Return to Spatial Command Hub [ESC]"
          >
            <X size={12} /> SPATIAL HUB [ESC]
          </button>
        </div>
      </div>

      {/* ── Compact Panel Navigation (Only 1 primary view active at a time) ── */}
      <div className="inv-tabs" role="tablist" aria-label="Incident Investigation Panels">
        <button
          className="inv-tab inv-tab-cycle-btn"
          onClick={() => {
            cyberAudio.playClick();
            spatialNavStore.previousPanel();
          }}
          title="Previous Investigation Panel [Arrow Left / ←]"
          aria-label="Previous Panel"
        >
          ◀ [←]
        </button>
        {VIEW_ORDER.map((view) => (
          <button
            key={view}
            role="tab"
            aria-selected={activeView === view}
            className={`inv-tab soc-motion-interactive${activeView === view ? ' active soc-motion-selected' : ''}${view === 'REPLAY' ? ' replay-tab' : ''}`}
            onClick={() => handleSetView(view)}
            title={`${VIEW_LABELS[view]} [Arrow Left/Right to cycle]`}
          >
            {VIEW_LABELS[view]}
            {view === 'REPLAY' && replay.status !== 'IDLE' && (
              <span className={`inv-tab-dot status-${replay.status.toLowerCase()}`} />
            )}
          </button>
        ))}
        <button
          className="inv-tab inv-tab-cycle-btn"
          onClick={() => {
            cyberAudio.playClick();
            spatialNavStore.nextPanel();
          }}
          title="Next Investigation Panel [Arrow Right / →]"
          aria-label="Next Panel"
        >
          [→] ▶
        </button>
      </div>

      {/* ── Context strip (Authoritative Security Entity Ribbon communicating all 13 properties) ── */}
      <div className="inv-context-strip" aria-label="Incident Security Entity Ribbon">
        <span className="inv-cs-item">
          <span className="inv-cs-label">INCIDENT</span>
          <span className="inv-cs-value" title={inc.title}>
            {inc.title.length > 36 ? inc.title.slice(0, 34) + '…' : inc.title}
          </span>
        </span>

        {/* 1. SEVERITY */}
        <span className="inv-cs-item">
          <span className="inv-cs-label">SEVERITY</span>
          <span className={`inv-cs-value sev-${inc.severity.toLowerCase()}`} style={{ fontWeight: 700 }}>
            {inc.severity}
          </span>
        </span>

        {/* 2. CONFIDENCE */}
        <span className="inv-cs-item">
          <span className="inv-cs-label">CONFIDENCE</span>
          <span className="inv-cs-value text-cyan">{confidencePct}%</span>
        </span>

        {/* 3. RISK */}
        <span className="inv-cs-item">
          <span className="inv-cs-label">RISK</span>
          <span className="inv-cs-value">{riskScore}/100</span>
        </span>

        {/* 4. STATUS */}
        <span className="inv-cs-item">
          <span className="inv-cs-label">STATUS</span>
          <span className="inv-cs-value">{inc.status}</span>
        </span>

        {/* 5. ASSETS */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('ATTACK')}
          title="Inspect Affected Assets in Attack Graph"
        >
          <span className="inv-cs-label">ASSETS</span>
          <span className="inv-cs-value text-cyan">{data.incident.affectedAssets.length}</span>
        </button>

        {/* 6. USERS */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('FINDINGS')}
          title="Inspect Affected Users"
        >
          <span className="inv-cs-label">USERS</span>
          <span className="inv-cs-value text-blue">{data.incident.affectedUsers?.length ?? 1}</span>
        </button>

        {/* 7. IOCS */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('IOCs')}
          title="Inspect Threat Indicators & IOCs"
        >
          <span className="inv-cs-label">IOCs</span>
          <span className="inv-cs-value" style={{ color: '#ff6b35' }}>{data.incident.iocs.length}</span>
        </button>

        {/* 8. DETECTIONS */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('TIMELINE')}
          title="Inspect Correlated Detection Alerts"
        >
          <span className="inv-cs-label">DETECTIONS</span>
          <span className="inv-cs-value" style={{ color: '#00f0ff' }}>
            {data.incident.alertIds?.length ?? 0}
          </span>
        </button>

        {/* 9. MITRE */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('MITRE')}
          title="Inspect MITRE ATT&CK Matrix"
        >
          <span className="inv-cs-label">MITRE</span>
          <span className="inv-cs-value" style={{ color: '#a78bfa' }}>{data.mitreCoverage.length}</span>
        </button>

        {/* 10. EVIDENCE */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('EVIDENCE')}
          title="Inspect Forensic Evidence"
        >
          <span className="inv-cs-label">EVIDENCE</span>
          <span className="inv-cs-value" style={{ color: '#3dffb0' }}>
            {data.incident.evidence?.length ?? 0}
          </span>
        </button>

        {/* 11. RELATED INCIDENTS */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('FINDINGS')}
          title="Inspect Related Incidents & Correlation Links"
        >
          <span className="inv-cs-label">RELATED</span>
          <span className="inv-cs-value">
            {data.incident.correlationReasons?.length ? `${data.incident.correlationReasons.length} Links` : 'None'}
          </span>
        </button>

        {/* 12. RESPONSE STATE */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('RESPONSE')}
          title="Inspect SOAR Playbooks & Containment Response"
        >
          <span className="inv-cs-label">RESPONSE</span>
          <span className="inv-cs-value" style={{ color: '#ffb700' }}>
            {data.incident.responseActions?.length
              ? `${data.incident.responseActions.filter(a => a.status === 'COMPLETED').length}/${data.incident.responseActions.length}`
              : inc.status}
          </span>
        </button>

        {/* 13. TIMELINE */}
        <button
          className="inv-cs-item inv-cs-btn"
          onClick={() => handleSetView('TIMELINE')}
          title="Inspect Chronological Attack Timeline"
        >
          <span className="inv-cs-label">TIMELINE</span>
          <span className="inv-cs-value">
            {data.incident.timelineEvents?.length ?? data.attackPath.steps.length} Events
          </span>
        </button>
      </div>

      {/* ── Active view panel ── */}
      <div className="inv-view-panel" role="tabpanel" aria-label={VIEW_LABELS[activeView]}>
        <ActiveView
          incidentId={inc.id}
          onSelectEntity={(entity: any) => setSelectedEntity(entity)}
        />
      </div>

      {/* ── Contextual AI Incident Explanation Drawer ── */}
      <ContextualAiAssistant
        mode="INCIDENT"
        targetId={inc.id}
        isOpen={isContextualAiOpen}
        onClose={() => setIsContextualAiOpen(false)}
      />
    </div>
  );
}

// ─── Exported component (wraps with Provider) ─────────────────────────────────

interface InvestigationHubProps {
  incidentId: string;
  onRegister: (id: string, el: HTMLElement | null) => void;
  onExitFocus: () => void;
}

export default function InvestigationHub({ incidentId, onRegister, onExitFocus }: InvestigationHubProps) {
  return (
    <InvestigationProvider incidentId={incidentId}>
      <InvestigationHubInner
        panelId={`inv-hub-${incidentId}`}
        onRegister={onRegister}
        onExitFocus={onExitFocus}
      />
    </InvestigationProvider>
  );
}

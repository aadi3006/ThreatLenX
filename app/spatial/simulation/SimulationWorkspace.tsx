/**
 * SimulationWorkspace.tsx
 *
 * Cyber Range & Attack Simulation Workspace for EXPLAIN-SEC SPATIAL.
 * Provides deterministic simulation control, live attack storylines, MITRE ATT&CK mapping,
 * real SOC pipeline observation, and after-action validation reports.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ShieldAlert,
  Play,
  Pause,
  SkipForward,
  Square,
  Trash2,
  X,
  Crosshair,
  Activity,
  FileCheck,
  Zap,
  CheckCircle2,
  Flame,
  Clock,
  Radio,
} from 'lucide-react';
import { securityService } from '../../core/security-service';
import {
  SimulationScenario,
  SimulationRun,
  SimulationResult,
} from '../../core/models/simulation';
import { cyberAudio } from '../../cyber-audio';
import './simulation.css';

interface SimulationWorkspaceProps {
  perfMode?: 'FULL' | 'REDUCED' | 'LOW';
  onClose: () => void;
  onInvestigateIncident?: (incidentId: string) => void;
}

export const SimulationWorkspace: React.FC<SimulationWorkspaceProps> = ({
  perfMode = 'FULL',
  onClose,
  onInvestigateIncident,
}) => {
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [activeRun, setActiveRun] = useState<SimulationRun | null>(null);
  const [latestResult, setLatestResult] = useState<SimulationResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [seedInput, setSeedInput] = useState<string>('1337');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'CONTROLS' | 'REPORT'>('CONTROLS');

  // Load scenarios and existing runs
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [scens, runs] = await Promise.all([
        securityService.getSimulationScenarios(),
        securityService.getSimulationRuns(),
      ]);
      setScenarios(scens);

      if (scens.length > 0 && !selectedScenarioId) {
        setSelectedScenarioId(scens[0].id);
      }

      // Check for active or latest run
      const running = runs.find((r) => r.status === 'RUNNING' || r.status === 'PAUSED');
      if (running) {
        setActiveRun(running);
        setSelectedScenarioId(running.scenarioId);
        const res = await securityService.getSimulationResult(running.id);
        if (res) setLatestResult(res);
      } else if (runs.length > 0) {
        setActiveRun(runs[0]);
        setSelectedScenarioId(runs[0].scenarioId);
        const res = await securityService.getSimulationResult(runs[0].id);
        if (res) setLatestResult(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cyber range data');
    } finally {
      setLoading(false);
    }
  }, [selectedScenarioId]);

  useEffect(() => {
    loadData();
  }, []);

  // Listen to live simulation events
  useEffect(() => {
    const handleUpdate = (run?: SimulationRun) => {
      if (run) {
        setActiveRun(run);
      } else {
        securityService.getSimulationRuns().then((runs) => {
          const current = runs.find((r) => r.status === 'RUNNING' || r.status === 'PAUSED') || runs[0];
          if (current) setActiveRun(current);
        });
      }
    };

    const handleCompleted = async (data?: { run: SimulationRun; result: SimulationResult }) => {
      if (data?.run) {
        setActiveRun(data.run);
        setLatestResult(data.result);
      } else {
        const runs = await securityService.getSimulationRuns();
        if (runs.length > 0) {
          setActiveRun(runs[0]);
          const res = await securityService.getSimulationResult(runs[0].id);
          if (res) setLatestResult(res);
        }
      }
      cyberAudio.playSuccess();
      setActiveTab('REPORT');
    };

    const unsubUpdate = securityService.on('SIMULATION_UPDATED', handleUpdate);
    const unsubCompleted = securityService.on('SIMULATION_COMPLETED', handleCompleted);

    return () => {
      unsubUpdate();
      unsubCompleted();
    };
  }, []);

  // Selected scenario object
  const selectedScenario = useMemo(() => {
    return scenarios.find((s) => s.id === selectedScenarioId) || scenarios[0];
  }, [scenarios, selectedScenarioId]);

  // Filtered scenario list
  const filteredScenarios = useMemo(() => {
    return scenarios.filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchCat = selectedCategory === 'ALL' || s.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [scenarios, searchQuery, selectedCategory]);

  // Controls Handlers
  const handleStartSimulation = async () => {
    if (!selectedScenario) return;
    try {
      cyberAudio.playScan();
      const seedNum = parseInt(seedInput, 10) || 1337;
      const run = await securityService.startSimulation(selectedScenario.id, {
        seed: seedNum,
        speed: 1,
        dryRunSoar: true,
      });
      setActiveRun(run);
      setLatestResult(null);
      setActiveTab('CONTROLS');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start simulation');
    }
  };

  const handlePauseSimulation = async () => {
    if (!activeRun) return;
    try {
      cyberAudio.playClick();
      const updated = await securityService.pauseSimulation(activeRun.id);
      setActiveRun(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause simulation');
    }
  };

  const handleResumeSimulation = async () => {
    if (!activeRun) return;
    try {
      cyberAudio.playClick();
      const updated = await securityService.resumeSimulation(activeRun.id);
      setActiveRun(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume simulation');
    }
  };

  const handleStepSimulation = async () => {
    if (!activeRun) return;
    try {
      cyberAudio.playSelect();
      const updated = await securityService.stepSimulation(activeRun.id);
      setActiveRun(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to step simulation');
    }
  };

  const handleCancelSimulation = async () => {
    if (!activeRun) return;
    try {
      cyberAudio.playAlert();
      const updated = await securityService.cancelSimulation(activeRun.id);
      setActiveRun(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel simulation');
    }
  };

  const handleSpeedChange = async (speed: number) => {
    if (!activeRun) return;
    try {
      cyberAudio.playClick();
      const updated = await securityService.setSimulationSpeed(activeRun.id, speed);
      setActiveRun(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set speed');
    }
  };

  const handleCleanupData = async () => {
    if (!activeRun) return;
    if (!window.confirm('Clean up all simulation-generated events, alerts, and incidents for this run?')) return;
    try {
      cyberAudio.playClick();
      await securityService.cleanupSimulationData(activeRun.id);
      setActiveRun(null);
      setLatestResult(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cleanup simulation data');
    }
  };

  // Clock Formatting
  const formatElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `T+${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const isRunning = activeRun?.status === 'RUNNING';
  const isPaused = activeRun?.status === 'PAUSED';
  const isCompleted = activeRun?.status === 'COMPLETED';

  // Defensive grade calculator
  const defenseGrade = useMemo(() => {
    if (!latestResult) return 'N/A';
    const pct = latestResult.detectionCoveragePercent;
    if (pct >= 90) return 'A+';
    if (pct >= 80) return 'A';
    if (pct >= 70) return 'B';
    if (pct >= 50) return 'C';
    return 'F';
  }, [latestResult]);

  return (
    <div className="simulation-workspace">
      {/* ─── Top Strip: Cyber Range Controls ─────────────────────────────────── */}
      <header className="sim-top-strip">
        <div className="sim-brand">
          <div className="sim-brand-title">
            <ShieldAlert size={18} color="#00f0ff" />
            <span>CYBER RANGE // SIMULATION ENGINE</span>
          </div>
          <span className={`sim-status-pill ${activeRun ? activeRun.status.toLowerCase() : 'idle'}`}>
            {activeRun ? activeRun.status : 'IDLE'}
          </span>
        </div>

        <div className="sim-top-controls">
          {/* Clock Display */}
          <div className="sim-clock-display" title="Simulation Clock">
            <Clock size={14} color="#00f0ff" />
            <span className="sim-clock-time">
              {activeRun ? formatElapsed(activeRun.virtualTimeSeconds) : 'T+00:00'}
            </span>
          </div>

          {/* Speed Selector */}
          <div className="sim-speed-selector">
            {[0.5, 1, 2, 4].map((spd) => (
              <button
                key={spd}
                className={`sim-speed-btn ${activeRun?.speed === spd ? 'active' : ''}`}
                onClick={() => handleSpeedChange(spd)}
                disabled={!activeRun || isCompleted}
              >
                {spd}x
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          {isRunning ? (
            <button className="sim-ctrl-btn" onClick={handlePauseSimulation} title="Pause Simulation">
              <Pause size={12} />
              <span>PAUSE</span>
            </button>
          ) : isPaused ? (
            <button className="sim-ctrl-btn" onClick={handleResumeSimulation} title="Resume Simulation">
              <Play size={12} />
              <span>RESUME</span>
            </button>
          ) : (
            <button
              className="sim-ctrl-btn"
              onClick={handleStartSimulation}
              disabled={isRunning || !selectedScenario}
              title="Launch Drill"
            >
              <Play size={12} />
              <span>LAUNCH</span>
            </button>
          )}

          {/* Step Button */}
          <button
            className="sim-ctrl-btn"
            onClick={handleStepSimulation}
            disabled={!isPaused}
            title="Step Forward 1 Event"
          >
            <SkipForward size={12} />
            <span>STEP</span>
          </button>

          {/* Cancel */}
          {(isRunning || isPaused) && (
            <button className="sim-ctrl-btn danger" onClick={handleCancelSimulation} title="Halt Drill">
              <Square size={12} />
              <span>HALT</span>
            </button>
          )}

          {/* Clean Drill Data */}
          {activeRun && (
            <button className="sim-ctrl-btn danger" onClick={handleCleanupData} title="Cleanup Generated Data">
              <Trash2 size={12} />
              <span>CLEAN DATA</span>
            </button>
          )}

          {/* Close Workspace */}
          <button className="sim-ctrl-btn" onClick={onClose} title="Exit Cyber Range [ESC]">
            <X size={14} />
          </button>
        </div>
      </header>

      {/* ─── Left Panel: Scenario Library ──────────────────────────────────── */}
      <aside className="sim-panel">
        <div className="sim-panel-header">
          <span className="sim-panel-title">
            <Crosshair size={13} />
            <span>SCENARIO BLUEPRINTS</span>
          </span>
          <span style={{ fontSize: 9, color: '#8899aa' }}>{scenarios.length} READY</span>
        </div>

        <div className="sim-panel-body">
          <input
            type="text"
            className="scenario-search-input"
            placeholder="Search drill scenarios..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
            {['ALL', 'ENDPOINT_COMPROMISE', 'CREDENTIAL_ACCESS', 'LATERAL_MOVEMENT'].map((cat) => (
              <button
                key={cat}
                className={`time-pill-btn ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  fontSize: 8,
                  padding: '2px 6px',
                  background: selectedCategory === cat ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                  color: selectedCategory === cat ? '#00f0ff' : '#8899aa',
                }}
              >
                {cat.replace('_', ' ')}
              </button>
            ))}
          </div>

          {filteredScenarios.map((scen) => (
            <div
              key={scen.id}
              className={`scenario-card ${selectedScenarioId === scen.id ? 'active' : ''}`}
              onClick={() => {
                cyberAudio.playSelect();
                setSelectedScenarioId(scen.id);
              }}
            >
              <div className="scenario-card-header">
                <span className="scenario-name">{scen.name}</span>
                <span className={`difficulty-badge ${scen.difficulty}`}>{scen.difficulty}</span>
              </div>
              <p className="scenario-desc">{scen.description}</p>
              <div className="scenario-meta-row">
                <span>⏱ {scen.durationSeconds}s</span>
                <span>• {scen.phases.length} Phases</span>
                <span>• {scen.eventTemplates.length} Events</span>
              </div>
            </div>
          ))}

          {/* Seed Input */}
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(0, 240, 255, 0.15)' }}>
            <label style={{ fontSize: 10, color: '#8899aa', display: 'block', marginBottom: 4 }}>
              PRNG DETERMINISTIC SEED:
            </label>
            <input
              type="text"
              className="scenario-search-input"
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              placeholder="1337"
              disabled={isRunning}
            />
          </div>
        </div>
      </aside>

      {/* ─── Center Panel: Attack Storyline & Timeline ───────────────────────── */}
      <main className="sim-panel">
        <div className="sim-panel-header">
          <span className="sim-panel-title">
            <Flame size={13} color="#00f0ff" />
            <span>
              ATTACK STORYLINE // {selectedScenario ? selectedScenario.name.toUpperCase() : 'NO SCENARIO'}
            </span>
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#00f0ff' }}>
              STEP {activeRun ? activeRun.currentStepIndex + 1 : 0} /{' '}
              {selectedScenario ? selectedScenario.eventTemplates.length : 0}
            </span>
          </div>
        </div>

        <div className="sim-panel-body">
          {selectedScenario ? (
            <div>
              <div
                style={{
                  background: 'rgba(0, 240, 255, 0.04)',
                  padding: 10,
                  borderRadius: 6,
                  border: '1px solid rgba(0, 240, 255, 0.12)',
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 10, color: '#00f0ff', fontWeight: 700, marginBottom: 4 }}>
                  MISSION OBJECTIVE:
                </div>
                <div style={{ fontSize: 11, color: '#e0f2fe' }}>{selectedScenario.objective}</div>
              </div>

              {/* Phases */}
              {selectedScenario.phases.map((phase, pIdx) => {
                const phaseTemplates = selectedScenario.eventTemplates.filter((t) =>
                  phase.eventTemplateIds.includes(t.id)
                );

                return (
                  <div key={phase.id} className="storyline-phase-card">
                    <div className="storyline-phase-header">
                      <span className="phase-title">
                        <span>PHASE {pIdx + 1}:</span>
                        <span>{phase.name.replace(/_/g, ' ')}</span>
                      </span>
                      <span className="phase-tactic-badge">{phase.name}</span>
                    </div>

                    <div>
                      {phaseTemplates.map((template) => {
                        const absIdx = selectedScenario.eventTemplates.findIndex(
                          (t) => t.id === template.id
                        );
                        const isPast = activeRun ? activeRun.currentStepIndex > absIdx : false;
                        const isCurrent = activeRun
                          ? activeRun.currentStepIndex === absIdx && isRunning
                          : false;

                        return (
                          <div key={template.id} className={`step-item ${isCurrent ? 'active' : ''}`}>
                            <div className="step-info">
                              <span className="step-summary">
                                [{template.offsetSeconds}s] {template.name}
                              </span>
                              <span className="step-telemetry-preview">
                                {template.category} • {template.source} •{' '}
                                {template.commandLine || template.message}
                              </span>
                            </div>

                            <div className="step-badges">
                              {template.mitreTechniqueId && (
                                <span className="step-technique-badge">
                                  {template.mitreTechniqueId}
                                </span>
                              )}
                              {isPast ? (
                                <CheckCircle2 size={13} color="#00ff88" />
                              ) : isCurrent ? (
                                <Zap size={13} color="#00f0ff" className="animate-spin" />
                              ) : (
                                <Radio size={13} color="#445566" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: '#8899aa' }}>
              Select a scenario blueprint from the left panel to preview the attack storyline.
            </div>
          )}
        </div>
      </main>

      {/* ─── Right Panel: Range Controller & After-Action Report ──────────────── */}
      <aside className="sim-panel">
        <div className="sim-panel-header">
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`time-pill-btn ${activeTab === 'CONTROLS' ? 'active' : ''}`}
              onClick={() => setActiveTab('CONTROLS')}
            >
              METRICS
            </button>
            <button
              className={`time-pill-btn ${activeTab === 'REPORT' ? 'active' : ''}`}
              onClick={() => setActiveTab('REPORT')}
            >
              AFTER-ACTION REPORT
            </button>
          </div>
          {latestResult && <span style={{ fontSize: 9, color: '#00ff88' }}>REPORT READY</span>}
        </div>

        <div className="sim-panel-body">
          {activeTab === 'CONTROLS' ? (
            <div>
              {/* Scorecard Gauges */}
              <div className="kpi-stat-grid">
                <div className="kpi-stat-card">
                  <div className="kpi-stat-val">
                    {activeRun ? activeRun.generatedEventCount : 0}
                  </div>
                  <div className="kpi-stat-label">Events Ingested</div>
                </div>
                <div className="kpi-stat-card">
                  <div className="kpi-stat-val" style={{ color: '#ffaa00' }}>
                    {activeRun ? activeRun.generatedAlertCount : 0}
                  </div>
                  <div className="kpi-stat-label">Alerts Triggered</div>
                </div>
                <div className="kpi-stat-card">
                  <div className="kpi-stat-val" style={{ color: '#ff3366' }}>
                    {activeRun ? activeRun.generatedIncidentCount : 0}
                  </div>
                  <div className="kpi-stat-label">Incidents Formed</div>
                </div>
                <div className="kpi-stat-card">
                  <div className="kpi-stat-val" style={{ color: '#00ff88' }}>
                    {activeRun ? activeRun.generatedResponseCount : 0}
                  </div>
                  <div className="kpi-stat-label">SOAR Dry-Runs</div>
                </div>
              </div>

              {/* Real-time Validation Status */}
              <div
                style={{
                  background: 'rgba(10, 22, 34, 0.65)',
                  padding: 10,
                  borderRadius: 6,
                  border: '1px solid rgba(0, 240, 255, 0.12)',
                  marginTop: 10,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: '#00f0ff', marginBottom: 6 }}>
                  SOC DRILL STATE
                </div>
                <div style={{ fontSize: 9, color: '#8899aa', lineHeight: 1.6 }}>
                  <div>Active Run ID: {activeRun?.id || 'NONE'}</div>
                  <div>Seed: {activeRun?.seed || seedInput}</div>
                  <div>Clock Speed: {activeRun ? `${activeRun.speed}x` : '1x'}</div>
                  <div>Generated By: LOCAL_SIMULATION_ENGINE</div>
                  <div>Network Transports: 0 (100% Offline Synthetic Telemetry)</div>
                  <div>Shell Execution: Blocked (Defensive Dry-Run)</div>
                </div>
              </div>

              {/* View Formed Incident Link */}
              {latestResult && latestResult.generatedIncidentIds.length > 0 && onInvestigateIncident && (
                <div style={{ marginTop: 14 }}>
                  <button
                    className="sim-ctrl-btn"
                    style={{ width: '100%', justifyContent: 'center', padding: '8px' }}
                    onClick={() => {
                      onInvestigateIncident(latestResult.generatedIncidentIds[0]);
                    }}
                  >
                    <span>INVESTIGATE SIMULATED INCIDENT ➜</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* After Action Report */
            <div>
              {latestResult ? (
                <div>
                  <div className="grade-box">
                    <div>
                      <div className="grade-label">DEFENSE READINESS GRADE</div>
                      <div style={{ fontSize: 11, color: '#e0f2fe', marginTop: 2 }}>
                        Coverage: {latestResult.detectionCoveragePercent}% ({latestResult.detectionCoverageRatio})
                      </div>
                    </div>
                    <div className="grade-letter">{defenseGrade}</div>
                  </div>

                  <div className="kpi-stat-grid">
                    <div className="kpi-stat-card">
                      <div className="kpi-stat-val">
                        {latestResult.actualDetectionCount} / {latestResult.expectedDetectionCount}
                      </div>
                      <div className="kpi-stat-label">Rules Matched</div>
                    </div>
                    <div className="kpi-stat-card">
                      <div className="kpi-stat-val" style={{ color: '#00ff88' }}>
                        {latestResult.soarValidation.length}
                      </div>
                      <div className="kpi-stat-label">Playbooks Tested</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#00f0ff', marginBottom: 4 }}>
                      DETECTION VALIDATION LOG:
                    </div>
                    <table className="validation-table">
                      <thead>
                        <tr>
                          <th>Rule</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestResult.detectionValidation.map((item, idx) => (
                          <tr key={idx}>
                            <td>{item.ruleName}</td>
                            <td>
                              <span className={`validation-tag ${item.verdict === 'EXPECTED_MATCH' ? 'MATCHED' : 'MISSED'}`}>
                                {item.verdict}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* SOAR Validation Items */}
                  {latestResult.soarValidation.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#00f0ff', marginBottom: 4 }}>
                        SOAR DRY-RUN EVALUATIONS:
                      </div>
                      <table className="validation-table">
                        <thead>
                          <tr>
                            <th>Playbook</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {latestResult.soarValidation.map((item, idx) => (
                            <tr key={idx}>
                              <td>{item.playbookName}</td>
                              <td>
                                <span className="validation-tag MATCHED">
                                  {item.simulatedActionCount} ACTIONS SAFE
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#8899aa' }}>
                  No after-action reports generated yet. Execute a simulation drill to produce validation grades.
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ─── Bottom Strip: Live SOC Pipeline Inspector ───────────────────────── */}
      <footer className="sim-pipeline-strip">
        <div className="pipeline-stage-node">
          <div className={`pipeline-node-icon ${isRunning ? 'active' : ''}`}>
            <Crosshair size={13} />
          </div>
          <span className="pipeline-node-title">1. Scenario Step</span>
          <span className="pipeline-node-count">
            {activeRun ? activeRun.currentStepIndex + 1 : 0}
          </span>
        </div>

        <span className="pipeline-connector-arrow">➜</span>

        <div className="pipeline-stage-node">
          <div className={`pipeline-node-icon ${activeRun && activeRun.generatedEventCount > 0 ? 'active' : ''}`}>
            <Activity size={13} />
          </div>
          <span className="pipeline-node-title">2. Ingested Event</span>
          <span className="pipeline-node-count">
            {activeRun ? activeRun.generatedEventCount : 0}
          </span>
        </div>

        <span className="pipeline-connector-arrow">➜</span>

        <div className="pipeline-stage-node">
          <div className={`pipeline-node-icon ${activeRun && activeRun.generatedAlertCount > 0 ? 'active' : ''}`}>
            <Flame size={13} />
          </div>
          <span className="pipeline-node-title">3. Correlated Alert</span>
          <span className="pipeline-node-count">
            {activeRun ? activeRun.generatedAlertCount : 0}
          </span>
        </div>

        <span className="pipeline-connector-arrow">➜</span>

        <div className="pipeline-stage-node">
          <div className={`pipeline-node-icon ${activeRun && activeRun.generatedIncidentCount > 0 ? 'active' : ''}`}>
            <ShieldAlert size={13} />
          </div>
          <span className="pipeline-node-title">4. SOC Incident</span>
          <span className="pipeline-node-count">
            {activeRun ? activeRun.generatedIncidentCount : 0}
          </span>
        </div>

        <span className="pipeline-connector-arrow">➜</span>

        <div className="pipeline-stage-node">
          <div className={`pipeline-node-icon ${activeRun && activeRun.generatedResponseCount > 0 ? 'active' : ''}`}>
            <FileCheck size={13} />
          </div>
          <span className="pipeline-node-title">5. SOAR Dry-Run</span>
          <span className="pipeline-node-count">
            {activeRun ? activeRun.generatedResponseCount : 0}
          </span>
        </div>
      </footer>
    </div>
  );
};

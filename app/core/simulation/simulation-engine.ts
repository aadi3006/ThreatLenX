/**
 * simulation-engine.ts
 *
 * Local Defensive Simulation Engine for EXPLAIN-SEC SPATIAL Cyber Range.
 *
 * Exercises the REAL SOC Pipeline:
 *   SCENARIO STEP
 *     ↓
 *   SIMULATION EVENT GENERATOR
 *     ↓
 *   LocalProvider.ingestEvent() [SAME canonical path as normal events]
 *     ↓
 *   Detection Engine (AST Rules)
 *     ↓
 *   Alerts Generation & Deduplication
 *     ↓
 *   Correlation Engine
 *     ↓
 *   Incident Auto-Creation
 *     ↓
 *   SOAR Playbook Dry-Run
 *     ↓
 *   Detection Coverage & After-Action Report
 *
 * 100% Offline. Zero real attacks, zero external calls, zero shell execution.
 */

import type { SecurityEvent } from '../models/event';
import type { Alert } from '../models/detection';
import type { Incident } from '../models/incident';
import type { RoleId } from '../models/auth';
import type { AuditRecord } from '../models/audit';
import type {
  SimulationScenario,
  SimulationRun,
  SimulationResult,
  DetectionValidationItem,
  CorrelationValidationItem,
  SoarValidationItem,
  StartSimulationOptions,
  SimulationPhaseName,
} from '../models/simulation';
import { SimulationEventGenerator } from './simulation-event-generator';
import { SimulationClock, type ClockSpeed } from './simulation-clock';
import { DeterministicPrng } from './simulation-seed-prng';
import { SEED_SIMULATION_SCENARIOS } from './simulation-scenarios';
import { put, get, getAll, deleteRecord, putMany } from '../storage/idb-store';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export interface SimulationProviderHost {
  ingestEvent(eventInput: any, actor?: string, actorRole?: RoleId): Promise<any>;
  dryRunPlaybook(playbookId: string, actor: string, targetOverride?: any): Promise<any>;
  getAlerts(query?: any): Promise<Alert[]>;
  getIncidents(query?: any): Promise<Incident[]>;
  getEvents(query?: any): Promise<SecurityEvent[]>;
  deleteEventById?(id: string): Promise<boolean>;
  deleteAlertById?(id: string): Promise<boolean>;
  deleteIncidentById?(id: string): Promise<boolean>;
}

export class SimulationEngine {
  private _host: SimulationProviderHost;
  private _scenarios: Map<string, SimulationScenario> = new Map();
  private _activeRuns: Map<string, SimulationRun> = new Map();
  private _activeClocks: Map<string, SimulationClock> = new Map();
  private _stepPromises: Map<string, Promise<void>> = new Map();

  constructor(host: SimulationProviderHost) {
    this._host = host;
    // Load default seed scenarios
    for (const s of SEED_SIMULATION_SCENARIOS) {
      this._scenarios.set(s.id, clone(s));
    }
  }

  // ─── Scenario Management ──────────────────────────────────────────────────

  public async getScenarios(): Promise<SimulationScenario[]> {
    return Array.from(this._scenarios.values());
  }

  public async getScenario(idOrScenarioId: string): Promise<SimulationScenario | null> {
    const direct = this._scenarios.get(idOrScenarioId);
    if (direct) return clone(direct);
    for (const s of this._scenarios.values()) {
      if (s.scenarioId === idOrScenarioId) return clone(s);
    }
    return null;
  }

  public async registerScenario(scenario: SimulationScenario): Promise<void> {
    this._scenarios.set(scenario.id, clone(scenario));
    await put<SimulationScenario>('simulation_scenarios', scenario);
  }

  // ─── Run Lifecycle ────────────────────────────────────────────────────────

  public async startSimulation(
    scenarioId: string,
    options: StartSimulationOptions = {},
    actor: string = 'analyst',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<SimulationRun> {
    const scenario = await this.getScenario(scenarioId);
    if (!scenario) {
      throw new Error(`Simulation scenario "${scenarioId}" not found`);
    }

    const seed = options.seed ?? 1337;
    const speed = (options.speed as ClockSpeed) ?? 1;
    const prng = new DeterministicPrng(seed);

    const runId = `sim-run-${Date.now().toString(36)}-${prng.nextHex(4)}`;
    const now = new Date().toISOString();

    const run: SimulationRun = {
      id: runId,
      runId,
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      scenarioName: scenario.name,
      status: 'RUNNING',
      seed,
      speed,
      startedAt: now,
      currentPhaseIndex: 0,
      currentPhaseName: scenario.phases[0]?.name ?? 'INITIAL_ACCESS',
      currentStepIndex: 0,
      totalSteps: scenario.eventTemplates.length,
      virtualTimeSeconds: 0,
      generatedEventCount: 0,
      generatedAlertCount: 0,
      generatedIncidentCount: 0,
      generatedCaseCount: 0,
      generatedResponseCount: 0,
    };

    this._activeRuns.set(runId, run);
    await put<SimulationRun>('simulation_runs', run);

    // Initialize Simulation Clock
    const clock = new SimulationClock(scenario.durationSeconds, speed);
    this._activeClocks.set(runId, clock);

    // Launch background asynchronous scenario executor
    this._runScenarioLoop(run, scenario, clock, actor, actorRole, options.dryRunSoar ?? true);

    return clone(run);
  }

  public async pauseSimulation(runId: string): Promise<SimulationRun> {
    const run = this._activeRuns.get(runId) ?? (await get<SimulationRun>('simulation_runs', runId));
    if (!run) throw new Error(`Simulation run "${runId}" not found`);

    const clock = this._activeClocks.get(runId);
    if (clock) clock.pause();

    run.status = 'PAUSED';
    run.pausedAt = new Date().toISOString();
    this._activeRuns.set(runId, run);
    await put<SimulationRun>('simulation_runs', run);

    return clone(run);
  }

  public async resumeSimulation(runId: string): Promise<SimulationRun> {
    const run = this._activeRuns.get(runId) ?? (await get<SimulationRun>('simulation_runs', runId));
    if (!run) throw new Error(`Simulation run "${runId}" not found`);

    const clock = this._activeClocks.get(runId);
    if (clock) clock.resume();

    run.status = 'RUNNING';
    run.pausedAt = undefined;
    this._activeRuns.set(runId, run);
    await put<SimulationRun>('simulation_runs', run);

    return clone(run);
  }

  public async cancelSimulation(runId: string): Promise<SimulationRun> {
    const run = this._activeRuns.get(runId) ?? (await get<SimulationRun>('simulation_runs', runId));
    if (!run) throw new Error(`Simulation run "${runId}" not found`);

    const clock = this._activeClocks.get(runId);
    if (clock) clock.reset();

    run.status = 'CANCELLED';
    run.completedAt = new Date().toISOString();
    this._activeRuns.set(runId, run);
    await put<SimulationRun>('simulation_runs', run);

    return clone(run);
  }

  public async setSpeed(runId: string, speed: ClockSpeed): Promise<SimulationRun> {
    const run = this._activeRuns.get(runId) ?? (await get<SimulationRun>('simulation_runs', runId));
    if (!run) throw new Error(`Simulation run "${runId}" not found`);

    const clock = this._activeClocks.get(runId);
    if (clock) clock.setSpeed(speed);

    run.speed = speed;
    this._activeRuns.set(runId, run);
    await put<SimulationRun>('simulation_runs', run);

    return clone(run);
  }

  public async stepSimulation(
    runId: string,
    actor: string = 'analyst',
    actorRole: RoleId = 'L2_ANALYST'
  ): Promise<SimulationRun> {
    const run = this._activeRuns.get(runId) ?? (await get<SimulationRun>('simulation_runs', runId));
    if (!run) throw new Error(`Simulation run "${runId}" not found`);

    const scenario = await this.getScenario(run.scenarioId);
    if (!scenario) throw new Error(`Scenario ${run.scenarioId} not found`);

    if (run.currentStepIndex >= scenario.eventTemplates.length) {
      if (run.status !== 'COMPLETED') {
        await this._finalizeSimulation(run, scenario, actor);
      }
      return clone(run);
    }

    // Process single next template
    const template = scenario.eventTemplates[run.currentStepIndex];
    const phase = scenario.phases.find((p) => p.eventTemplateIds.includes(template.id));

    const baseTimestampMs = new Date(run.startedAt).getTime() - scenario.durationSeconds * 1000;
    const generated = SimulationEventGenerator.generateEvent({
      scenarioId: scenario.scenarioId,
      runId: run.runId,
      seed: run.seed,
      template,
      phase,
      stepIndex: run.currentStepIndex,
      baseTimestampMs,
    });

    // Ingest through real pipeline via host
    const result = await this._host.ingestEvent(generated.eventInput, actor, actorRole);
    if (result && result.success) {
      run.generatedEventCount += 1;
    }

    run.currentStepIndex += 1;
    run.virtualTimeSeconds = template.offsetSeconds;
    if (phase) {
      run.currentPhaseName = phase.name;
      run.currentPhaseIndex = phase.phaseIndex;
    }

    // Refresh count of generated alerts and incidents for this run
    await this._syncRunCounts(run);

    if (run.currentStepIndex >= scenario.eventTemplates.length) {
      await this._finalizeSimulation(run, scenario, actor);
    } else {
      this._activeRuns.set(runId, run);
      await put<SimulationRun>('simulation_runs', run);
    }

    return clone(run);
  }

  public async getSimulationRun(runId: string): Promise<SimulationRun | null> {
    const active = this._activeRuns.get(runId);
    if (active) return clone(active);
    const persisted = await get<SimulationRun>('simulation_runs', runId);
    return persisted ? clone(persisted) : null;
  }

  public async getSimulationRuns(): Promise<SimulationRun[]> {
    const persisted = await getAll<SimulationRun>('simulation_runs');
    // Overlay any in-memory active runs
    const map = new Map<string, SimulationRun>();
    for (const r of persisted) map.set(r.id, r);
    for (const [id, r] of this._activeRuns.entries()) map.set(id, r);

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  public async getSimulationResult(runId: string): Promise<SimulationResult | null> {
    const all = await getAll<SimulationResult>('simulation_results');
    const found = all.find((r) => r.runId === runId || r.id === runId);
    return found ? clone(found) : null;
  }

  // ─── Scenario Loop Implementation ─────────────────────────────────────────

  private async _runScenarioLoop(
    run: SimulationRun,
    scenario: SimulationScenario,
    clock: SimulationClock,
    actor: string,
    actorRole: RoleId,
    dryRunSoar: boolean
  ): Promise<void> {
    clock.start();

    const baseTimestampMs = new Date(run.startedAt).getTime() - scenario.durationSeconds * 1000;
    const sortedTemplates = [...scenario.eventTemplates].sort((a, b) => a.offsetSeconds - b.offsetSeconds);

    let processedIndex = 0;

    const tickHandler = async (virtualSeconds: number) => {
      if (run.status !== 'RUNNING') return;

      run.virtualTimeSeconds = virtualSeconds;

      // Ingest any templates whose offsetSeconds has arrived
      while (
        processedIndex < sortedTemplates.length &&
        sortedTemplates[processedIndex].offsetSeconds <= virtualSeconds
      ) {
        const template = sortedTemplates[processedIndex];
        const phase = scenario.phases.find((p) => p.eventTemplateIds.includes(template.id));

        if (phase) {
          run.currentPhaseName = phase.name;
          run.currentPhaseIndex = phase.phaseIndex;
        }

        try {
          const generated = SimulationEventGenerator.generateEvent({
            scenarioId: scenario.scenarioId,
            runId: run.runId,
            seed: run.seed,
            template,
            phase,
            stepIndex: processedIndex,
            baseTimestampMs,
          });

          const ingestResult = await this._host.ingestEvent(generated.eventInput, actor, actorRole);
          if (ingestResult && ingestResult.success) {
            run.generatedEventCount += 1;
          }
        } catch (err) {
          console.error(`[SimulationEngine] Error ingesting event template ${template.id}:`, err);
        }

        processedIndex++;
        run.currentStepIndex = processedIndex;
      }

      await this._syncRunCounts(run);
      await put<SimulationRun>('simulation_runs', run);

      // Check if all events generated and scenario completed
      if (processedIndex >= sortedTemplates.length || virtualSeconds >= scenario.durationSeconds) {
        cleanupTick();
        await this._finalizeSimulation(run, scenario, actor, dryRunSoar);
      }
    };

    const cleanupTick = clock.addTickListener((secs) => {
      // Execute tick sequentially
      const prev = this._stepPromises.get(run.id) ?? Promise.resolve();
      const next = prev.then(() => tickHandler(secs)).catch((err) => console.error(err));
      this._stepPromises.set(run.id, next);
    });
  }

  private async _syncRunCounts(run: SimulationRun): Promise<void> {
    try {
      const allAlerts = await this._host.getAlerts();
      const allIncidents = await this._host.getIncidents();

      // Alerts belonging to this simulation run
      const simAlerts = allAlerts.filter(
        (a) =>
          a.metadata?.simulation &&
          (a.metadata.simulation as any).runId === run.runId
      );
      run.generatedAlertCount = simAlerts.length;

      // Incidents containing simAlerts or having simulation metadata
      const simAlertIds = new Set(simAlerts.map((a) => a.id));
      const simIncidents = allIncidents.filter(
        (i) =>
          (i.metadata?.simulation && (i.metadata.simulation as any).runId === run.runId) ||
          i.alertIds?.some((aid) => simAlertIds.has(aid))
      );
      run.generatedIncidentCount = simIncidents.length;
    } catch (err) {
      // Non-fatal count refresh error
    }
  }

  // ─── Finalization, Validation & Reporting ─────────────────────────────────

  private async _finalizeSimulation(
    run: SimulationRun,
    scenario: SimulationScenario,
    actor: string,
    dryRunSoar: boolean = true
  ): Promise<SimulationResult> {
    const clock = this._activeClocks.get(run.id);
    if (clock) clock.reset();

    const now = new Date().toISOString();
    run.status = 'COMPLETED';
    run.completedAt = now;
    run.virtualTimeSeconds = scenario.durationSeconds;

    // Gather generated entities
    const allEvents = await this._host.getEvents();
    const runEvents = allEvents.filter(
      (e) => e.metadata?.simulation && (e.metadata.simulation as any).runId === run.runId
    );

    const allAlerts = await this._host.getAlerts();
    const runAlerts = allAlerts.filter(
      (a) =>
        (a.metadata?.simulation && (a.metadata.simulation as any).runId === run.runId) ||
        runEvents.some((e) => a.sourceEventIds.includes(e.id))
    );

    const allIncidents = await this._host.getIncidents();
    const runAlertIds = new Set(runAlerts.map((a) => a.id));
    const runIncidents = allIncidents.filter(
      (i) =>
        (i.metadata?.simulation && (i.metadata.simulation as any).runId === run.runId) ||
        i.alertIds?.some((aid) => runAlertIds.has(aid))
    );

    run.generatedEventCount = runEvents.length;
    run.generatedAlertCount = runAlerts.length;
    run.generatedIncidentCount = runIncidents.length;

    // 1. Detection Validation & Coverage Calculation
    const detectionValidation: DetectionValidationItem[] = [];
    let expectedMatchedCount = 0;
    let expectedCount = 0;
    let missedCount = 0;
    let unexpectedCount = 0;

    for (const exp of scenario.expectedDetections) {
      if (exp.expectedAlert) expectedCount++;

      const matchingAlert = runAlerts.find((a) => a.ruleId === exp.ruleId);
      if (exp.expectedAlert) {
        if (matchingAlert) {
          expectedMatchedCount++;
          detectionValidation.push({
            ruleId: exp.ruleId,
            ruleName: exp.ruleName,
            expectedAlert: true,
            actualMatched: true,
            alertId: matchingAlert.id,
            verdict: 'EXPECTED_MATCH',
            details: `Alert "${matchingAlert.title}" observed successfully matching rule ${exp.ruleId}.`,
          });
        } else {
          missedCount++;
          detectionValidation.push({
            ruleId: exp.ruleId,
            ruleName: exp.ruleName,
            expectedAlert: true,
            actualMatched: false,
            verdict: 'MISSED_DETECTION',
            details: `Expected detection rule ${exp.ruleId} did not fire on simulated telemetry.`,
          });
        }
      } else {
        if (matchingAlert) {
          unexpectedCount++;
          detectionValidation.push({
            ruleId: exp.ruleId,
            ruleName: exp.ruleName,
            expectedAlert: false,
            actualMatched: true,
            alertId: matchingAlert.id,
            verdict: 'UNEXPECTED_MATCH',
            details: `Rule ${exp.ruleId} fired unexpectedly on simulated baseline telemetry.`,
          });
        } else {
          detectionValidation.push({
            ruleId: exp.ruleId,
            ruleName: exp.ruleName,
            expectedAlert: false,
            actualMatched: false,
            verdict: 'EXPECTED_NEGATIVE',
            details: `Rule ${exp.ruleId} correctly remained silent as expected.`,
          });
        }
      }
    }

    const coverageScore = expectedCount > 0 ? (expectedMatchedCount / expectedCount) * 100 : 100;
    const coverageRatio = `${expectedMatchedCount} / ${expectedCount}`;

    // 2. Correlation Validation
    const correlationValidation: CorrelationValidationItem[] = [];
    let correlationSuccessCount = 0;

    for (const alert of runAlerts) {
      const correlatedInc = runIncidents.find((i) => i.alertIds?.includes(alert.id));
      if (correlatedInc) {
        correlationSuccessCount++;
        correlationValidation.push({
          alertId: alert.id,
          alertTitle: alert.title,
          correlatedIncidentId: correlatedInc.id,
          correlatedIncidentTitle: correlatedInc.title,
          score: correlatedInc.correlationScore ?? 80,
          reasons: correlatedInc.correlationReasons ?? ['Automatic correlation threshold met'],
          verdict: 'CORRELATED_SUCCESSFULLY',
        });
      } else {
        correlationValidation.push({
          alertId: alert.id,
          alertTitle: alert.title,
          score: 0,
          reasons: ['No open incident met the automatic correlation threshold'],
          verdict: 'ORPHANED_ALERT',
        });
      }
    }

    // 3. SOAR Response Validation (Dry-Run by default)
    const soarValidation: SoarValidationItem[] = [];
    if (dryRunSoar && scenario.expectedResponses && runIncidents.length > 0) {
      const targetInc = runIncidents[0];
      for (const pbId of scenario.expectedResponses) {
        try {
          const dryRun = await this._host.dryRunPlaybook(pbId, actor, {
            incidentId: targetInc.id,
            assetId: targetInc.affectedAssets[0],
          });
          const isSuccess = Boolean(dryRun.success ?? dryRun.valid ?? (dryRun.errors ? dryRun.errors.length === 0 : true));
          soarValidation.push({
            playbookId: pbId,
            playbookName: dryRun.playbookName || pbId,
            dryRunSuccess: isSuccess,
            targetIncidentId: targetInc.id,
            simulatedActionCount: dryRun.simulatedSteps?.length ?? 0,
            expectedMitigationObserved: isSuccess,
            details: isSuccess
              ? `Dry-run completed successfully with ${dryRun.simulatedSteps?.length ?? 0} actions evaluated without live impact.`
              : `Dry-run failed: ${dryRun.errors?.join(', ') || dryRun.error || 'Unknown error'}`,
          });
          run.generatedResponseCount += 1;
        } catch (err: any) {
          soarValidation.push({
            playbookId: pbId,
            playbookName: pbId,
            dryRunSuccess: false,
            targetIncidentId: targetInc.id,
            simulatedActionCount: 0,
            expectedMitigationObserved: false,
            details: `SOAR dry-run threw exception: ${err.message}`,
          });
        }
      }
    }

    const resultId = `sim-res-${run.runId}`;
    const result: SimulationResult = {
      id: resultId,
      runId: run.runId,
      scenarioId: scenario.scenarioId,
      scenarioName: scenario.name,
      seed: run.seed,
      startedAt: run.startedAt,
      completedAt: now,
      durationSeconds: scenario.durationSeconds,
      generatedEventCount: runEvents.length,
      generatedAlertCount: runAlerts.length,
      generatedIncidentCount: runIncidents.length,
      generatedEventIds: runEvents.map((e) => e.id),
      generatedAlertIds: runAlerts.map((a) => a.id),
      generatedIncidentIds: runIncidents.map((i) => i.id),
      detectionValidation,
      expectedDetectionCount: expectedCount,
      actualDetectionCount: expectedMatchedCount,
      missedDetectionCount: missedCount,
      unexpectedDetectionCount: unexpectedCount,
      detectionCoverageRatio: coverageRatio,
      detectionCoveragePercent: Math.round(coverageScore * 10) / 10,
      correlationValidation,
      correlationSuccessCount,
      soarValidation,
      failures: [],
    };

    run.resultId = resultId;
    this._activeRuns.set(run.id, run);

    await put<SimulationRun>('simulation_runs', run);
    await put<SimulationResult>('simulation_results', result);

    return result;
  }

  // ─── Dependency-Aware Cleanup ─────────────────────────────────────────────

  public async cleanupSimulationData(
    runId: string,
    options: { keepResults?: boolean } = { keepResults: true }
  ): Promise<{ deletedEvents: number; deletedAlerts: number; deletedIncidents: number }> {
    const allEvents = await this._host.getEvents();
    const runEvents = allEvents.filter(
      (e) => e.metadata?.simulation && (e.metadata.simulation as any).runId === runId
    );

    const allAlerts = await this._host.getAlerts();
    const runAlerts = allAlerts.filter(
      (a) =>
        (a.metadata?.simulation && (a.metadata.simulation as any).runId === runId) ||
        runEvents.some((e) => a.sourceEventIds.includes(e.id))
    );

    const allIncidents = await this._host.getIncidents();
    const runAlertIds = new Set(runAlerts.map((a) => a.id));
    const runIncidents = allIncidents.filter(
      (i) =>
        Boolean(i.metadata?.simulation && (i.metadata.simulation as any).runId === runId) ||
        Boolean(i.alertIds && i.alertIds.length > 0 && i.alertIds.every((aid) => runAlertIds.has(aid)))
    );

    let deletedEvents = 0;
    let deletedAlerts = 0;
    let deletedIncidents = 0;

    // 1. Delete events
    for (const e of runEvents) {
      if (this._host.deleteEventById) {
        await this._host.deleteEventById(e.id);
      } else {
        await deleteRecord('events', e.id);
      }
      deletedEvents++;
    }

    // 2. Delete alerts
    for (const a of runAlerts) {
      if (this._host.deleteAlertById) {
        await this._host.deleteAlertById(a.id);
      } else {
        await deleteRecord('alerts', a.id);
      }
      deletedAlerts++;
    }

    // 3. Delete incidents
    for (const inc of runIncidents) {
      if (this._host.deleteIncidentById) {
        await this._host.deleteIncidentById(inc.id);
      } else {
        await deleteRecord('incidents', inc.id);
      }
      deletedIncidents++;
    }

    // 4. Optionally purge run and result
    if (!options.keepResults) {
      await deleteRecord('simulation_runs', runId);
      const results = await getAll<SimulationResult>('simulation_results');
      for (const res of results) {
        if (res.runId === runId || res.id === runId) {
          await deleteRecord('simulation_results', res.id);
        }
      }
      this._activeRuns.delete(runId);
    }

    return { deletedEvents, deletedAlerts, deletedIncidents };
  }

  // ─── Reload Recovery ──────────────────────────────────────────────────────

  public async recoverPersistedRuns(): Promise<void> {
    const runs = await getAll<SimulationRun>('simulation_runs');
    for (const r of runs) {
      // If a run was left in RUNNING status during a browser crash/reload, mark it PAUSED
      if (r.status === 'RUNNING') {
        r.status = 'PAUSED';
        r.pausedAt = new Date().toISOString();
        await put<SimulationRun>('simulation_runs', r);
      }
      this._activeRuns.set(r.id, r);
    }
  }
}

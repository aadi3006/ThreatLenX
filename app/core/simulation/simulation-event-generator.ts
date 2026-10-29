/**
 * simulation-event-generator.ts
 *
 * Deterministic Simulation Event Generator for EXPLAIN-SEC SPATIAL Cyber Range.
 *
 * Rules:
 * - Emits valid, canonical SecurityEventInput objects.
 * - Injects strict simulation provenance metadata:
 *     metadata.simulation = { simulationId, scenarioId, runId, generatedBy: 'LOCAL_SIMULATION_ENGINE', seed, virtualTimestamp }
 * - Uses DeterministicPrng with seed for reproducible variability (e.g. process IDs, ports).
 * - Safe telemetry only: no real attack commands, no exploits, no malicious code.
 */

import type { SecurityEventInput } from '../models/event';
import type { SimulationEventTemplate, SimulationPhase, SimulationProvenance } from '../models/simulation';
import { DeterministicPrng } from './simulation-seed-prng';

export interface GenerateEventOptions {
  scenarioId: string;
  runId: string;
  seed: number;
  template: SimulationEventTemplate;
  phase?: SimulationPhase;
  stepIndex: number;
  baseTimestampMs: number;
}

export interface GeneratedSimulationEvent {
  eventInput: SecurityEventInput;
  provenance: SimulationProvenance;
  virtualTimestamp: string;
  virtualOffsetSeconds: number;
}

export class SimulationEventGenerator {
  /**
   * Builds a single canonical SecurityEventInput from a scenario event template.
   */
  public static generateEvent(options: GenerateEventOptions): GeneratedSimulationEvent {
    const { scenarioId, runId, seed, template, phase, stepIndex, baseTimestampMs } = options;

    // Seeded PRNG unique to this event step: seed + stepIndex
    const prng = new DeterministicPrng((seed + stepIndex * 997) >>> 0);

    // Calculate virtual timestamp
    const eventTimeMs = baseTimestampMs + template.offsetSeconds * 1000;
    const virtualTimestamp = new Date(eventTimeMs).toISOString();

    // Deterministic simulation event ID
    const eventId = `sim-evt-${runId}-${template.id}`;

    // Deterministic process ID if applicable
    const processId = template.processName ? prng.nextInt(1000, 9999) : undefined;
    const parentProcessId = template.parentProcessName ? prng.nextInt(400, 999) : undefined;

    // Deterministic source port if network event
    const srcPort = template.srcPort ?? (template.srcIp ? prng.nextInt(49152, 65535) : undefined);

    const provenance: SimulationProvenance = {
      simulationId: `sim-${scenarioId}`,
      scenarioId,
      runId,
      generatedBy: 'LOCAL_SIMULATION_ENGINE',
      seed,
      phaseName: phase?.name,
      virtualTimestamp,
    };

    const eventInput: SecurityEventInput = {
      id: eventId,
      timestamp: virtualTimestamp,
      receivedAt: virtualTimestamp,
      eventType: template.eventType,
      category: template.category,
      severity: template.severity,
      source: template.source,
      sourceType: 'SIMULATION',
      assetId: template.assetId,
      userId: template.userId,
      iocIds: template.iocIds ? [...template.iocIds] : undefined,
      srcIp: template.srcIp,
      dstIp: template.dstIp,
      srcPort,
      dstPort: template.dstPort,
      protocol: template.protocol,
      domain: template.domain,
      url: template.url,
      httpMethod: template.httpMethod,
      httpStatus: template.httpStatus,
      processName: template.processName,
      processId,
      parentProcessName: template.parentProcessName,
      parentProcessId,
      commandLine: template.commandLine,
      filePath: template.filePath,
      fileHash: template.fileHash,
      message: template.message,
      metadata: {
        ...(template.metadata ?? {}),
        simulation: provenance,
        mitreTechniqueId: template.mitreTechniqueId ?? phase?.mitreTechniqueId,
        scenarioPhase: phase?.name,
        isSimulated: true,
      },
    };

    return {
      eventInput,
      provenance,
      virtualTimestamp,
      virtualOffsetSeconds: template.offsetSeconds,
    };
  }
}

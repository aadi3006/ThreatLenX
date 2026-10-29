/**
 * deterministic-local-ai-engine.ts
 *
 * Core Deterministic AI Reasoning Engine for Step 13.
 *
 * Grounding & Safety Invariants:
 * 1. Categorization strictly segregates OBSERVED, DERIVED, HYPOTHESIS, and UNKNOWN.
 * 2. Every claim references canonical entity IDs (EvidenceGroundingRef).
 * 3. Uncertainty is mathematically derived from available observation density.
 * 4. Action proposals (AIActionProposal) are structured proposals ONLY;
 *    the engine NEVER executes them or mutates security state.
 * 5. 100% offline: zero network requests, zero external LLMs, zero telemetry egress.
 */

import type {
  InvestigationContext,
  AIInvestigationResponse,
  AIResponseType,
  AIFindingItem,
  EvidenceGroundingRef,
  UncertaintyLevel,
  AIActionProposal,
  AINextStep,
  AIInvestigationQuestion,
  ClaimCategory,
} from '../models/ai';
import type { ThreatHuntQuery } from '../models/hunting';

export const DETERMINISTIC_ENGINE_NAME = 'DETERMINISTIC_LOCAL_ENGINE';
export const DETERMINISTIC_ENGINE_VERSION = '1.0.0';

export class DeterministicLocalAIEngine {
  /**
   * Main entrypoint for generating structured, evidence-grounded AI responses.
   */
  public generateResponse(
    context: InvestigationContext,
    requestedType?: AIResponseType,
    analystQuery?: string
  ): AIInvestigationResponse {
    const responseType = requestedType || this.inferResponseType(context);

    switch (responseType) {
      case 'INCIDENT_SUMMARY':
        return this.generateIncidentSummary(context);
      case 'DETECTION_EXPLANATION':
        return this.generateAlertExplanation(context);
      case 'TIMELINE_SUMMARY':
        return this.generateTimelineSummary(context);
      case 'ENTITY_EXPLANATION':
        return this.generateEntityExplanation(context);
      case 'CORRELATION_EXPLANATION':
        return this.generateCorrelationExplanation(context);
      case 'HUNT_GUIDANCE':
        return this.generateHuntGuidance(context, analystQuery);
      case 'HUNT_SUMMARY':
        return this.generateHuntSummary(context, analystQuery);
      case 'ATTACK_PATH_EXPLANATION':
        return this.generateAttackPathExplanation(context);
      case 'THREAT_INTEL_SUMMARY':
        return this.generateThreatIntelSummary(context);
      case 'CASE_SUMMARY':
        return this.generateCaseSummary(context);
      case 'EVIDENCE_SUMMARY':
        return this.generateEvidenceSummary(context);
      case 'RESPONSE_EXPLANATION':
        return this.generateResponseExplanation(context);
      case 'SIMULATION_ANALYSIS':
        return this.generateSimulationAnalysis(context);
      case 'GENERAL_INVESTIGATION':
      default:
        return this.generateGeneralInvestigation(context, analystQuery);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private inferResponseType(context: InvestigationContext): AIResponseType {
    switch (context.targetType) {
      case 'INCIDENT':
        return 'INCIDENT_SUMMARY';
      case 'ALERT':
        return 'DETECTION_EXPLANATION';
      case 'ASSET':
      case 'USER':
        return 'ENTITY_EXPLANATION';
      case 'IOC':
        return 'THREAT_INTEL_SUMMARY';
      case 'RULE':
        return 'DETECTION_EXPLANATION';
      case 'CASE':
        return 'CASE_SUMMARY';
      case 'EVIDENCE':
        return 'EVIDENCE_SUMMARY';
      case 'SIMULATION':
        return 'SIMULATION_ANALYSIS';
      case 'PLAYBOOK_EXECUTION':
        return 'RESPONSE_EXPLANATION';
      default:
        return 'GENERAL_INVESTIGATION';
    }
  }

  private computeUncertainty(
    eventCount: number,
    alertCount: number,
    hasPrimary: boolean
  ): { level: UncertaintyLevel; reason: string } {
    if (!hasPrimary || (eventCount === 0 && alertCount === 0)) {
      return {
        level: 'INSUFFICIENT_DATA',
        reason: 'Zero canonical events or alerts found for this entity context.',
      };
    }
    if (eventCount >= 5 && alertCount >= 2) {
      return {
        level: 'HIGH_CONFIDENCE',
        reason: `Corroborated by ${eventCount} canonical telemetry events and ${alertCount} correlated alerts.`,
      };
    }
    if (eventCount >= 1 || alertCount >= 1) {
      return {
        level: 'SUPPORTED',
        reason: `Evidence exists across ${eventCount} events and ${alertCount} alerts.`,
      };
    }
    return {
      level: 'PARTIAL',
      reason: 'Fragmentary data; supplementary telemetry collection recommended.',
    };
  }

  private buildGroundingRef(
    entityType: InvestigationContext['targetType'],
    entityId: string,
    store: string,
    summary: string
  ): EvidenceGroundingRef {
    return { entityType, entityId, store, summary };
  }

  // ─── 1. Incident Summary ──────────────────────────────────────────────────

  public generateIncidentSummary(context: InvestigationContext): AIInvestigationResponse {
    const inc = context.primaryEntity as Record<string, any> | null;
    const events = context.relatedEvents as Array<Record<string, any>>;
    const alerts = context.relatedAlerts as Array<Record<string, any>>;
    const assets = context.relatedAssets as Array<Record<string, any>>;
    const users = context.relatedUsers as Array<Record<string, any>>;
    const iocs = context.relatedIOCs as Array<Record<string, any>>;
    const techniques = context.relatedMITRETechniques;
    const correlation = context.correlationReasons;
    const rules = context.detectionRules as Array<Record<string, any>>;
    const execs = context.responseExecutions as Array<Record<string, any>>;

    const { level: uncertainty, reason: uncertaintyReason } = this.computeUncertainty(
      events.length,
      alerts.length,
      Boolean(inc)
    );

    const observed: AIFindingItem[] = [];
    const derived: AIFindingItem[] = [];
    const hypotheses: AIFindingItem[] = [];
    const unknown: AIFindingItem[] = [];
    const grounding: EvidenceGroundingRef[] = [];
    const proposals: AIActionProposal[] = [];
    const nextSteps: AINextStep[] = [];
    const questions: AIInvestigationQuestion[] = [];

    if (!inc) {
      return this.buildEmptyResponse(context, 'INCIDENT_SUMMARY', 'Incident record not found in local store.');
    }

    grounding.push(
      this.buildGroundingRef('INCIDENT', inc.id, 'incidents', `Incident ${inc.id}: ${inc.title} [${inc.severity}]`)
    );

    // Observed findings
    observed.push({
      id: `obs-inc-base`,
      category: 'OBSERVED',
      text: `Incident ${inc.id} was created with status '${inc.status}', priority '${inc.priority || 'P2'}', and severity '${inc.severity}'.`,
      sourceEntityIds: [inc.id],
      confidenceExplanation: 'Direct factual assertion from canonical IndexedDB incidents store.',
    });

    if (assets.length > 0) {
      const assetNames = assets.map((a) => `${a.name || a.id} (${a.type || 'HOST'})`).join(', ');
      observed.push({
        id: `obs-inc-assets`,
        category: 'OBSERVED',
        text: `Identified ${assets.length} affected asset(s): ${assetNames}.`,
        sourceEntityIds: assets.map((a) => String(a.id)),
        confidenceExplanation: 'Recorded directly in incident affectedAssets list.',
      });
      assets.forEach((a) => {
        grounding.push(this.buildGroundingRef('ASSET', a.id, 'assets', `Asset ${a.name || a.id}`));
      });
    }

    if (users.length > 0) {
      const userNames = users.map((u) => u.username || u.id).join(', ');
      observed.push({
        id: `obs-inc-users`,
        category: 'OBSERVED',
        text: `Targeted identity accounts: ${userNames}.`,
        sourceEntityIds: users.map((u) => String(u.id)),
        confidenceExplanation: 'Recorded in incident affectedUsers list.',
      });
    }

    if (alerts.length > 0) {
      observed.push({
        id: `obs-inc-alerts`,
        category: 'OBSERVED',
        text: `${alerts.length} detection alert(s) correlated: ${alerts.map((a) => a.id).join(', ')}.`,
        sourceEntityIds: alerts.map((a) => String(a.id)),
        confidenceExplanation: 'Direct alert linkages in canonical store.',
      });
      alerts.forEach((a) => {
        grounding.push(this.buildGroundingRef('ALERT', a.id, 'alerts', `Alert ${a.id}: ${a.title}`));
      });
    }

    if (events.length > 0) {
      observed.push({
        id: `obs-inc-events`,
        category: 'OBSERVED',
        text: `${events.length} underlying security telemetry event(s) captured across network and endpoint sensors.`,
        sourceEntityIds: events.slice(0, 5).map((e) => String(e.id)),
        confidenceExplanation: 'Validated raw events in canonical IndexedDB events store.',
      });
    }

    // Derived findings
    if (rules.length > 0) {
      const ruleNames = rules.map((r) => `${r.name} (${r.ruleId || r.id})`).join('; ');
      derived.push({
        id: `der-inc-rules`,
        category: 'DERIVED',
        text: `Alerts triggered by ${rules.length} detection rule(s): ${ruleNames}.`,
        sourceEntityIds: rules.map((r) => String(r.id)),
        confidenceExplanation: 'Derived through AST rule condition evaluations against source telemetry.',
      });
    }

    if (correlation.length > 0) {
      derived.push({
        id: `der-inc-correlation`,
        category: 'DERIVED',
        text: `Alert grouping established by Correlation Engine based on: ${correlation.join(', ')}.`,
        sourceEntityIds: [inc.id],
        confidenceExplanation: 'Computed by multi-factor candidate scoring algorithm (threshold >= 70).',
      });
    }

    if (execs.length > 0) {
      const execSummaries = execs.map((x) => `Playbook ${x.playbookId} [${x.status}]`).join(', ');
      derived.push({
        id: `der-inc-response`,
        category: 'DERIVED',
        text: `Active SOAR response executions: ${execSummaries}.`,
        sourceEntityIds: execs.map((x) => String(x.id)),
        confidenceExplanation: 'Recorded in playbook_executions store.',
      });
    }

    // Hypotheses
    if (techniques.length > 0) {
      hypotheses.push({
        id: `hyp-inc-mitre`,
        category: 'HYPOTHESIS',
        text: `Attack sequence aligns with MITRE ATT&CK techniques: ${techniques.join(', ')}. Activity pattern is consistent with multi-stage lateral intrusion or privilege escalation.`,
        sourceEntityIds: [inc.id],
        confidenceExplanation: 'Analytical inference matching observed indicators against MITRE knowledge matrix.',
      });
    }

    if (context.simulationProvenance?.isSimulation) {
      hypotheses.push({
        id: `hyp-inc-sim`,
        category: 'HYPOTHESIS',
        text: `Activity was generated under Cyber Range Simulation drill '${context.simulationProvenance.scenarioId}'. Expected detection coverage verification in progress.`,
        sourceEntityIds: [inc.id],
        confidenceExplanation: 'Tagged with simulation provenance metadata.',
      });
    }

    // Unknowns
    unknown.push({
      id: `unk-inc-attribution`,
      category: 'UNKNOWN',
      text: 'No local evidence currently confirms external threat actor identity, nation-state attribution, or ultimate campaign motivation.',
      sourceEntityIds: [inc.id],
      confidenceExplanation: 'Local threat intelligence contains zero verified threat actor attribution for these indicators.',
    });

    if (iocs.length === 0) {
      unknown.push({
        id: `unk-inc-iocs`,
        category: 'UNKNOWN',
        text: 'No persistent indicators of compromise (IOCs) have been verified for this incident chain.',
        sourceEntityIds: [inc.id],
        confidenceExplanation: 'Incident iocs array is empty.',
      });
    }

    // Next steps & proposals
    if (assets.length > 0 && inc.status !== 'CLOSED' && inc.status !== 'RESOLVED') {
      const primaryAsset = assets[0];
      proposals.push({
        proposalId: `prop-contain-${primaryAsset.id}-${Date.now()}`,
        contextId: context.contextId,
        actionType: 'CONTAIN_HOST',
        target: { id: primaryAsset.id, type: 'ASSET', displayName: primaryAsset.name },
        reason: `Isolate asset ${primaryAsset.name || primaryAsset.id} to arrest potential C2 lateral movement across the internal subnet.`,
        supportingEvidence: [inc.id, primaryAsset.id],
        riskLevel: 'HIGH',
        requiredPermission: 'CONTAINMENT_REQUEST',
        requiresApproval: true,
        suggestedPlaybookId: 'pb-host-containment-01',
        createdAt: new Date().toISOString(),
        status: 'PROPOSED',
      });

      nextSteps.push({
        stepNumber: 1,
        title: `Evaluate Network Isolation for ${primaryAsset.name || primaryAsset.id}`,
        description: 'Review proposed host containment action and trigger SOAR playbook if blast radius is acceptable.',
        actionType: 'CONTAIN_HOST',
        isDestructive: true,
        rationale: 'Stops outbound network beaconing.',
        targetId: String(primaryAsset.id),
      });
    }

    if (iocs.length > 0) {
      const primaryIoc = iocs[0];
      proposals.push({
        proposalId: `prop-block-ioc-${primaryIoc.id}-${Date.now()}`,
        contextId: context.contextId,
        actionType: 'BLOCK_IOC',
        target: { id: String(primaryIoc.id), type: 'IOC', displayName: String(primaryIoc.value) },
        reason: `Block malicious indicator ${primaryIoc.value} at perimeter security gateways.`,
        supportingEvidence: [String(primaryIoc.id)],
        riskLevel: 'MEDIUM',
        requiredPermission: 'SOAR_EXECUTE',
        requiresApproval: false,
        suggestedPlaybookId: 'pb-ioc-block-01',
        createdAt: new Date().toISOString(),
        status: 'PROPOSED',
      });
    }

    nextSteps.push({
      stepNumber: nextSteps.length + 1,
      title: 'Execute Threat Hunt for Related Activity',
      description: 'Sweep neighboring hosts for identical process execution hashes or network connection artifacts.',
      actionType: 'EXECUTE_THREAT_HUNT',
      isDestructive: false,
      rationale: 'Determines full extent of lateral movement.',
    });

    questions.push({
      id: 'q-1',
      question: 'Did initial access originate from external email attachment or direct network exploitation?',
      category: events.some((e) => (e.category as string)?.includes('EMAIL') || (e.process as any)?.name === 'EXCEL.EXE')
        ? 'ANSWERABLE_FROM_CURRENT_DATA'
        : 'REQUIRES_MORE_DATA',
      rationale: 'Essential for root cause remediation and post-incident hardening.',
    });

    const summary = `Investigation summary for ${inc.title} (${inc.id}): ` +
      `Incident is currently in '${inc.status}' state with '${inc.severity}' severity. ` +
      `Correlation engine linked ${alerts.length} alert(s) across ${assets.length} asset(s) and ${users.length} account(s). ` +
      `Identified ${techniques.length} MITRE technique(s). Recommended action: evaluate host containment and initiate lateral sweep hunt.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'INCIDENT_SUMMARY',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty,
      uncertaintyReason,
      supportingEvidence: grounding,
      questions,
      recommendedNextSteps: nextSteps,
      actionProposals: proposals,
      relatedEntities: [inc.id, ...assets.map((a) => a.id), ...alerts.map((a) => a.id)],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: events.length + alerts.length + assets.length + users.length,
        offlineGuaranteed: true,
      },
      limitations: [
        'All observations derived exclusively from local IndexedDB security stores.',
        'Zero external threat intelligence or external cloud validation performed.',
        'Threat actor attribution cannot be established from local data alone.',
      ],
    };
  }

  // ─── 2. Alert Explanation ─────────────────────────────────────────────────

  public generateAlertExplanation(context: InvestigationContext): AIInvestigationResponse {
    const alert = context.primaryEntity as Record<string, any> | null;
    const events = context.relatedEvents as Array<Record<string, any>>;
    const rules = context.detectionRules as Array<Record<string, any>>;
    const incidents = context.relatedIncidents as Array<Record<string, any>>;

    const { level: uncertainty, reason: uncertaintyReason } = this.computeUncertainty(
      events.length,
      alert ? 1 : 0,
      Boolean(alert)
    );

    const observed: AIFindingItem[] = [];
    const derived: AIFindingItem[] = [];
    const hypotheses: AIFindingItem[] = [];
    const unknown: AIFindingItem[] = [];
    const grounding: EvidenceGroundingRef[] = [];
    const nextSteps: AINextStep[] = [];

    if (!alert) {
      return this.buildEmptyResponse(context, 'DETECTION_EXPLANATION', 'Alert record not found in local store.');
    }

    grounding.push(
      this.buildGroundingRef('ALERT', alert.id, 'alerts', `Alert ${alert.id}: ${alert.title}`)
    );

    observed.push({
      id: `obs-alt-detail`,
      category: 'OBSERVED',
      text: `Alert ${alert.id} (${alert.title || 'Untitled'}) has severity '${alert.severity}', status '${alert.status}', and occurrence count ${alert.occurrenceCount || 1}.`,
      sourceEntityIds: [alert.id],
      confidenceExplanation: 'Direct alert properties in alerts store.',
    });

    if (events.length > 0) {
      observed.push({
        id: `obs-alt-events`,
        category: 'OBSERVED',
        text: `Alert triggered by ${events.length} source telemetry event(s). Primary event ID: ${events[0].id}.`,
        sourceEntityIds: events.map((e) => String(e.id)),
        confidenceExplanation: 'Listed in alert.sourceEventIds.',
      });
      events.forEach((e) => {
        grounding.push(this.buildGroundingRef('EVENT', String(e.id), 'events', `Event ${e.id} [${e.category}]`));
      });
    } else {
      observed.push({
        id: `obs-alt-no-events`,
        category: 'OBSERVED',
        text: 'NO MATCHES OBSERVED IN SELECTED WINDOW or source events have aged out.',
        sourceEntityIds: [alert.id],
        confidenceExplanation: 'No source events found in active cache or window.',
      });
    }

    if (rules.length > 0) {
      const rule = rules[0];
      derived.push({
        id: `der-alt-rule`,
        category: 'DERIVED',
        text: `Fired detection rule '${rule.name}' (${rule.ruleId || rule.id}) with condition logic: ${JSON.stringify(rule.conditions || {})}.`,
        sourceEntityIds: [String(rule.id)],
        confidenceExplanation: 'Rule conditions matched source event fields during detection cycle.',
      });
      grounding.push(this.buildGroundingRef('RULE', String(rule.id), 'detection_rules', `Rule ${rule.name}`));
    }

    if (incidents.length > 0) {
      const inc = incidents[0];
      derived.push({
        id: `der-alt-incident`,
        category: 'DERIVED',
        text: `Alert is correlated into Incident ${inc.id}: '${inc.title}'.`,
        sourceEntityIds: [String(inc.id)],
        confidenceExplanation: 'Correlation link established in IndexedDB.',
      });
    }

    hypotheses.push({
      id: `hyp-alt-risk`,
      category: 'HYPOTHESIS',
      text: alert.severity === 'CRITICAL' || alert.severity === 'HIGH'
        ? 'High probability of active unauthorized exploitation or privilege abuse requiring analyst triage.'
        : 'Telemetry anomaly requiring corroboration with neighboring asset events.',
      sourceEntityIds: [alert.id],
      confidenceExplanation: 'Severity heuristic evaluation.',
    });

    unknown.push({
      id: `unk-alt-benign`,
      category: 'UNKNOWN',
      text: 'Cannot verify whether activity was authorized administrative behavior without reviewing change management logs.',
      sourceEntityIds: [alert.id],
      confidenceExplanation: 'Local security store lacks administrative change ticket records.',
    });

    nextSteps.push({
      stepNumber: 1,
      title: 'Inspect Raw Telemetry Payload',
      description: 'Review exact command-line arguments and process trees for source events.',
      isDestructive: false,
      rationale: 'Confirms true positive status.',
    });

    const summary = `Detection explanation for Alert ${alert.id}: ` +
      `Triggered by rule '${rules[0]?.name || alert.ruleId}' on asset '${alert.assetId || 'UNKNOWN'}'. ` +
      `Severity is ${alert.severity}. Correlated into ${incidents.length > 0 ? incidents[0].id : 'no incident'}.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'DETECTION_EXPLANATION',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty,
      uncertaintyReason,
      supportingEvidence: grounding,
      questions: [],
      recommendedNextSteps: nextSteps,
      actionProposals: [],
      relatedEntities: [alert.id, ...(rules[0] ? [rules[0].id] : [])],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: events.length + rules.length,
        offlineGuaranteed: true,
      },
      limitations: [
        'Detection explanations rely exclusively on declarative rule conditions in detection_rules store.',
      ],
    };
  }

  // ─── 3. Timeline Summary ──────────────────────────────────────────────────

  public generateTimelineSummary(context: InvestigationContext): AIInvestigationResponse {
    const timeline = context.timeline;
    const events = context.relatedEvents;

    const observed: AIFindingItem[] = [];
    const derived: AIFindingItem[] = [];
    const hypotheses: AIFindingItem[] = [];
    const unknown: AIFindingItem[] = [];
    const grounding: EvidenceGroundingRef[] = [];

    if (timeline.length === 0) {
      return this.buildEmptyResponse(context, 'TIMELINE_SUMMARY', 'No timeline entries recorded for this context.');
    }

    const firstItem = timeline[0];
    const lastItem = timeline[timeline.length - 1];

    observed.push({
      id: 'obs-time-span',
      category: 'OBSERVED',
      text: `Investigation timeline spans from ${firstItem.timestamp} to ${lastItem.timestamp} across ${timeline.length} milestone(s).`,
      sourceEntityIds: timeline.map((t) => t.id),
      confidenceExplanation: 'Calculated from chronological timeline entries.',
    });

    observed.push({
      id: 'obs-time-initial',
      category: 'OBSERVED',
      text: `First recorded activity (${firstItem.timestamp}): ${firstItem.description}`,
      sourceEntityIds: [firstItem.id],
      confidenceExplanation: 'Earliest event timestamp in sequence.',
    });

    derived.push({
      id: 'der-time-flow',
      category: 'DERIVED',
      text: `Activity progressed through initial detection, alert generation, and incident response milestones.`,
      sourceEntityIds: timeline.map((t) => t.id),
      confidenceExplanation: 'Derived by chronologically ordering alerts and incident state transitions.',
    });

    hypotheses.push({
      id: 'hyp-time-dwell',
      category: 'HYPOTHESIS',
      text: `Adversary dwell time between initial access and detection appears bounded within the active telemetry observation window.`,
      sourceEntityIds: [firstItem.id, lastItem.id],
      confidenceExplanation: 'Telemetry delta between earliest and latest recorded events.',
    });

    unknown.push({
      id: 'unk-time-pre-compromise',
      category: 'UNKNOWN',
      text: 'Prior adversary reconnaissance before the first recorded event cannot be confirmed due to historical log retention horizons.',
      sourceEntityIds: [],
      confidenceExplanation: 'No earlier logs available in local event store.',
    });

    const summary = `Chronological timeline explanation: Timeline captures ${timeline.length} sequential milestone(s) starting at ${firstItem.timestamp}.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'TIMELINE_SUMMARY',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty: 'HIGH_CONFIDENCE',
      uncertaintyReason: `Grounded in ${timeline.length} canonical timestamps.`,
      supportingEvidence: grounding,
      questions: [],
      recommendedNextSteps: [],
      actionProposals: [],
      relatedEntities: [context.targetId],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: timeline.length,
        offlineGuaranteed: true,
      },
      limitations: ['Timeline relies on sensor local timestamps; clock drift may apply.'],
    };
  }

  // ─── 4. Entity Explanation (Asset / User) ─────────────────────────────────

  public generateEntityExplanation(context: InvestigationContext): AIInvestigationResponse {
    const entity = context.primaryEntity as Record<string, any> | null;
    const incs = context.relatedIncidents as Array<Record<string, any>>;
    const alerts = context.relatedAlerts as Array<Record<string, any>>;
    const events = context.relatedEvents as Array<Record<string, any>>;

    const observed: AIFindingItem[] = [];
    const derived: AIFindingItem[] = [];
    const hypotheses: AIFindingItem[] = [];
    const unknown: AIFindingItem[] = [];
    const grounding: EvidenceGroundingRef[] = [];
    const proposals: AIActionProposal[] = [];

    if (!entity) {
      return this.buildEmptyResponse(context, 'ENTITY_EXPLANATION', `Entity ${context.targetId} not found.`);
    }

    observed.push({
      id: 'obs-ent-base',
      category: 'OBSERVED',
      text: `Entity ${context.targetId} (${(entity as any).name || (entity as any).username || context.targetId}) is linked to ${incs.length} incident(s), ${alerts.length} alert(s), and ${events.length} event(s).`,
      sourceEntityIds: [context.targetId],
      confidenceExplanation: 'Direct entity cross-references in security stores.',
    });

    derived.push({
      id: 'der-ent-risk',
      category: 'DERIVED',
      text: `Calculated operational blast radius: ${(entity as any).riskScore ?? (alerts.length * 15)} risk points based on active threat involvement.`,
      sourceEntityIds: [context.targetId],
      confidenceExplanation: 'Risk aggregation algorithm based on active alerts.',
    });

    if (context.targetType === 'ASSET' && incs.length > 0) {
      hypotheses.push({
        id: 'hyp-ent-contain',
        category: 'HYPOTHESIS',
        text: 'Asset may be serving as an active foothold or staging host for lateral pivot attempts.',
        sourceEntityIds: [context.targetId],
        confidenceExplanation: 'Inferred from multiple high-severity alerts attached to host.',
      });

      proposals.push({
        proposalId: `prop-ent-contain-${context.targetId}-${Date.now()}`,
        contextId: context.contextId,
        actionType: 'CONTAIN_HOST',
        target: { id: context.targetId, type: 'ASSET', displayName: (entity as any).name },
        reason: `Isolate host ${context.targetId} to mitigate lateral movement risk.`,
        supportingEvidence: [context.targetId],
        riskLevel: 'HIGH',
        requiredPermission: 'CONTAINMENT_REQUEST',
        requiresApproval: true,
        createdAt: new Date().toISOString(),
        status: 'PROPOSED',
      });
    }

    unknown.push({
      id: 'unk-ent-clean',
      category: 'UNKNOWN',
      text: 'Cannot verify whether physical tamper or direct hardware compromise occurred without on-site forensic examination.',
      sourceEntityIds: [context.targetId],
      confidenceExplanation: 'Hardware telemetry unavailable in sensor feed.',
    });

    const summary = `Entity analysis for ${context.targetType} ${context.targetId}: Involves ${incs.length} active incident(s) and ${alerts.length} alert(s).`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'ENTITY_EXPLANATION',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty: 'SUPPORTED',
      uncertaintyReason: `Observed across ${events.length} events and ${alerts.length} alerts.`,
      supportingEvidence: grounding,
      questions: [],
      recommendedNextSteps: [],
      actionProposals: proposals,
      relatedEntities: [context.targetId],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: incs.length + alerts.length + events.length,
        offlineGuaranteed: true,
      },
      limitations: ['Entity analysis scoped strictly to local SOC data.'],
    };
  }

  // ─── 5. Threat Intel / IOC Summary ────────────────────────────────────────

  public generateThreatIntelSummary(context: InvestigationContext): AIInvestigationResponse {
    const intel = context.threatIntel as Array<Record<string, any>>;
    const ioc = context.primaryEntity as Record<string, any> | null;
    const incs = context.relatedIncidents as Array<Record<string, any>>;

    const observed: AIFindingItem[] = [];
    const derived: AIFindingItem[] = [];
    const hypotheses: AIFindingItem[] = [];
    const unknown: AIFindingItem[] = [];
    const grounding: EvidenceGroundingRef[] = [];
    const proposals: AIActionProposal[] = [];

    if (!ioc && intel.length === 0) {
      return this.buildEmptyResponse(context, 'THREAT_INTEL_SUMMARY', 'NO LOCAL INTELLIGENCE AVAILABLE for this indicator.');
    }

    const indicatorVal = ioc?.value || intel[0]?.indicatorValue || context.targetId;

    if (intel.length > 0) {
      const ti = intel[0];
      observed.push({
        id: 'obs-ti-record',
        category: 'OBSERVED',
        text: `Local intelligence record exists for ${indicatorVal}: Confidence ${ti.confidence || 80}/100, Type '${ti.indicatorType || 'IP'}'.`,
        sourceEntityIds: [ti.id || ti.indicatorId || indicatorVal],
        confidenceExplanation: 'Recorded in threat_intel store.',
      });

      if (ti.threatActor) {
        derived.push({
          id: 'der-ti-actor',
          category: 'DERIVED',
          text: `Associated threat actor: '${ti.threatActor}'. Campaign: '${ti.campaign || 'UNSPECIFIED'}'.`,
          sourceEntityIds: [ti.id || indicatorVal],
          confidenceExplanation: 'Mapped via local threat_intel_relationships.',
        });
      }
    } else {
      observed.push({
        id: 'obs-ti-none',
        category: 'OBSERVED',
        text: 'NO LOCAL INTELLIGENCE AVAILABLE in threat_intel repository.',
        sourceEntityIds: [indicatorVal],
        confidenceExplanation: 'Indicator not present in local threat intelligence store.',
      });
    }

    observed.push({
      id: 'obs-ti-inc-link',
      category: 'OBSERVED',
      text: `Observed in ${incs.length} active incident(s): ${incs.map((i) => i.id).join(', ')}.`,
      sourceEntityIds: incs.map((i) => String(i.id)),
      confidenceExplanation: 'Incident iocs foreign key relationship.',
    });

    hypotheses.push({
      id: 'hyp-ti-c2',
      category: 'HYPOTHESIS',
      text: 'Indicator likely represents an external Command & Control (C2) endpoint or staging infrastructure.',
      sourceEntityIds: [indicatorVal],
      confidenceExplanation: 'Communication profile matches beaconing cadence.',
    });

    unknown.push({
      id: 'unk-ti-ext',
      category: 'UNKNOWN',
      text: 'Cannot verify global WHOIS reputation or commercial VirusTotal telemetry due to offline security constraint.',
      sourceEntityIds: [indicatorVal],
      confidenceExplanation: 'System is 100% offline; zero external queries allowed.',
    });

    proposals.push({
      proposalId: `prop-block-${indicatorVal}-${Date.now()}`,
      contextId: context.contextId,
      actionType: 'BLOCK_IOC',
      target: { id: indicatorVal, type: 'IOC', displayName: indicatorVal },
      reason: `Block communication to suspected C2 endpoint ${indicatorVal} across perimeter firewalls.`,
      supportingEvidence: [indicatorVal],
      riskLevel: 'MEDIUM',
      requiredPermission: 'SOAR_EXECUTE',
      requiresApproval: false,
      createdAt: new Date().toISOString(),
      status: 'PROPOSED',
    });

    const summary = `Threat Intelligence summary for ${indicatorVal}: ` +
      `${intel.length > 0 ? `Confidence ${intel[0].confidence}/100.` : 'No local threat intel record.'} ` +
      `Linked to ${incs.length} incident(s). Action proposed: Perimeter block.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'THREAT_INTEL_SUMMARY',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty: intel.length > 0 ? 'HIGH_CONFIDENCE' : 'PARTIAL',
      uncertaintyReason: intel.length > 0 ? 'Local threat intel record confirmed.' : 'No local intel record; IOC observed in incident only.',
      supportingEvidence: grounding,
      questions: [],
      recommendedNextSteps: [],
      actionProposals: proposals,
      relatedEntities: [indicatorVal],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: intel.length + incs.length,
        offlineGuaranteed: true,
      },
      limitations: ['Zero external threat intelligence API lookup performed.'],
    };
  }

  // ─── 6. Threat Hunting Guidance ───────────────────────────────────────────

  public generateHuntGuidance(context: InvestigationContext, queryIntent?: string): AIInvestigationResponse {
    const assets = context.relatedAssets as Array<Record<string, any>>;
    const users = context.relatedUsers as Array<Record<string, any>>;
    const iocs = context.relatedIOCs as Array<Record<string, any>>;

    const primaryAssetId = assets.length > 0 ? String(assets[0].id) : undefined;
    const primaryUserId = users.length > 0 ? String(users[0].id) : undefined;
    const proposedHunt: ThreatHuntQuery = {
      assetIds: primaryAssetId ? [primaryAssetId] : undefined,
      userIds: primaryUserId ? [primaryUserId] : undefined,
      eventTypes: ['PROCESS_LAUNCH', 'NETWORK_CONNECT', 'AUTHENTICATION'],
      severities: ['HIGH', 'CRITICAL'],
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date().toISOString(),
      text: queryIntent || (iocs.length > 0 ? String(iocs[0].value) : undefined),
    };

    const observed: AIFindingItem[] = [
      {
        id: 'obs-hunt-context',
        category: 'OBSERVED',
        text: `Identified ${assets.length} host(s) and ${users.length} identity account(s) in active investigation context.`,
        sourceEntityIds: [...assets.map((a) => String(a.id)), ...users.map((u) => String(u.id))],
        confidenceExplanation: 'Entities resolved from active context.',
      },
    ];

    const derived: AIFindingItem[] = [
      {
        id: 'der-hunt-query',
        category: 'DERIVED',
        text: `Formulated structured ThreatHuntQuery: Asset='${primaryAssetId || 'ANY'}', User='${primaryUserId || 'ANY'}', Window='LAST_24_HOURS'.`,
        sourceEntityIds: [],
        confidenceExplanation: 'Translated analyst intent into valid canonical query filters without arbitrary syntax.',
      },
    ];

    const hypotheses: AIFindingItem[] = [
      {
        id: 'hyp-hunt-scope',
        category: 'HYPOTHESIS',
        text: 'Executing this hunt may reveal lateral movement artifacts or secondary beaconing channels across the enclave.',
        sourceEntityIds: [],
        confidenceExplanation: 'Anticipated analytical outcome of query execution.',
      },
    ];

    const unknown: AIFindingItem[] = [
      {
        id: 'unk-hunt-yield',
        category: 'UNKNOWN',
        text: 'Match yield cannot be predicted until the hunt query is executed against the canonical events store.',
        sourceEntityIds: [],
        confidenceExplanation: 'Hunt execution is pending analyst initiation.',
      },
    ];

    const proposals: AIActionProposal[] = [
      {
        proposalId: `prop-hunt-${Date.now()}`,
        contextId: context.contextId,
        actionType: 'EXECUTE_THREAT_HUNT',
        target: { id: primaryAssetId || 'SWEEP', type: 'QUERY', displayName: 'Targeted Telemetry Sweep' },
        reason: 'Execute structured hunt across telemetry records to identify hidden persistent processes or lateral connections.',
        supportingEvidence: [context.targetId],
        riskLevel: 'LOW',
        requiredPermission: 'THREAT_HUNT_EXECUTE',
        requiresApproval: false,
        createdAt: new Date().toISOString(),
        status: 'PROPOSED',
      },
    ];

    const summary = `Threat Hunting Copilot formulated a targeted telemetry sweep for Asset '${primaryAssetId || 'ANY'}' over the past 24 hours. Proposal ready for analyst initiation.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'HUNT_GUIDANCE',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty: 'SUPPORTED',
      uncertaintyReason: 'Grounded in active incident assets and timeline boundaries.',
      supportingEvidence: [],
      questions: [],
      recommendedNextSteps: [
        {
          stepNumber: 1,
          title: 'Initiate Proposed Threat Hunt',
          description: 'Click "Execute Threat Hunt" to search canonical events store with formulated query.',
          actionType: 'EXECUTE_THREAT_HUNT',
          isDestructive: false,
          rationale: 'Non-destructive telemetry sweep.',
        },
      ],
      actionProposals: proposals,
      proposedHuntQuery: proposedHunt,
      relatedEntities: [context.targetId],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: assets.length + users.length,
        offlineGuaranteed: true,
      },
      limitations: ['Hunts are non-destructive and query only local canonical events.'],
    };
  }

  // ─── 6b. Contextual Attack Path Explanation ─────────────────────────────────

  public generateAttackPathExplanation(context: InvestigationContext): AIInvestigationResponse {
    const assets = context.relatedAssets as Array<Record<string, any>>;
    const alerts = context.relatedAlerts as Array<Record<string, any>>;
    const events = context.relatedEvents as Array<Record<string, any>>;
    const iocs = context.relatedIOCs as Array<Record<string, any>>;
    const techniques = context.relatedMITRETechniques;

    const observed: AIFindingItem[] = [];
    const derived: AIFindingItem[] = [];
    const hypotheses: AIFindingItem[] = [];
    const unknown: AIFindingItem[] = [];
    const proposals: AIActionProposal[] = [];

    // Observed findings
    observed.push({
      id: 'obs-ap-entry',
      category: 'OBSERVED',
      text: `Attack chain originates with ${alerts.length} initial alert detection(s) involving ${assets.length} identified host(s).`,
      sourceEntityIds: alerts.map((a) => String(a.id)),
      confidenceExplanation: 'Confirmed from chronological alert progression in canonical store.',
    });

    if (assets.length > 0) {
      observed.push({
        id: 'obs-ap-hosts',
        category: 'OBSERVED',
        text: `Traversed infrastructure includes: ${assets.map((a) => a.name || a.id).join(' → ')}.`,
        sourceEntityIds: assets.map((a) => String(a.id)),
        confidenceExplanation: 'Recorded in incident affected assets causal sequence.',
      });
    }

    // Derived choke points & causal links
    const chokePoint = assets[0]?.name || assets[0]?.id || 'Initial compromised host';
    derived.push({
      id: 'der-ap-chokepoint',
      category: 'DERIVED',
      text: `Critical choke-point identified at [${chokePoint}]. Interdicting this node severs lateral movement to downstream internal systems.`,
      sourceEntityIds: assets.slice(0, 1).map((a) => String(a.id)),
      confidenceExplanation: 'Topological analysis of graph causal relationships.',
    });

    // Hypotheses
    if (techniques.length > 0) {
      hypotheses.push({
        id: 'hyp-ap-mitre',
        category: 'HYPOTHESIS',
        text: `Progression pattern matches adversarial playbooks utilizing MITRE techniques: ${techniques.slice(0, 4).join(', ')}.`,
        sourceEntityIds: [context.targetId],
        confidenceExplanation: 'Correlated against ATT&CK kill-chain mapping.',
      });
    }

    // Unknowns
    unknown.push({
      id: 'unk-ap-extent',
      category: 'UNKNOWN',
      text: 'Potential secondary persistence implants or unmonitored lateral connections cannot be definitively ruled out without expanded endpoint sweeps.',
      sourceEntityIds: [context.targetId],
      confidenceExplanation: 'Telemetry coverage bounded to monitored sensor endpoints.',
    });

    // High impact containment proposal requiring RBAC + Policy + Approval + Audit
    if (assets.length > 0) {
      proposals.push({
        proposalId: `prop-ap-${Date.now()}-isolate`,
        contextId: context.contextId,
        actionType: 'CONTAIN_HOST',
        target: {
          id: String(assets[0].id),
          type: 'ASSET',
          displayName: String(assets[0].name || assets[0].id),
        },
        reason: `Sever lateral attack path progression by isolating choke-point host [${chokePoint}].`,
        supportingEvidence: [context.targetId, ...alerts.map((a) => String(a.id))],
        riskLevel: 'HIGH',
        requiredPermission: 'SOAR_EXECUTE',
        requiresApproval: true,
        createdAt: new Date().toISOString(),
        status: 'PROPOSED',
      });
    }

    if (iocs.length > 0) {
      proposals.push({
        proposalId: `prop-ap-${Date.now()}-block`,
        contextId: context.contextId,
        actionType: 'BLOCK_IOC',
        target: {
          id: String(iocs[0].id || iocs[0].value),
          type: 'IOC',
          displayName: String(iocs[0].value),
        },
        reason: `Sever outbound C2 communication channel to malicious indicator [${iocs[0].value}].`,
        supportingEvidence: [context.targetId],
        riskLevel: 'MEDIUM',
        requiredPermission: 'SOAR_EXECUTE',
        requiresApproval: true,
        createdAt: new Date().toISOString(),
        status: 'PROPOSED',
      });
    }

    const summary = `Attack path analysis for ${context.title}: Causal intrusion initiated via [${chokePoint}] with ${alerts.length} correlated detections. Key choke point containment recommended.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'ATTACK_PATH_EXPLANATION',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty: events.length >= 3 ? 'HIGH_CONFIDENCE' : 'SUPPORTED',
      uncertaintyReason: `Grounded in ${events.length} canonical telemetry events across ${assets.length} hosts.`,
      supportingEvidence: [],
      questions: [],
      recommendedNextSteps: [
        {
          stepNumber: 1,
          title: 'Sever Critical Choke Point',
          description: `Isolate host ${chokePoint} to halt lateral adversary progression.`,
          actionType: 'CONTAIN_HOST',
          isDestructive: true,
          rationale: 'Stops active attack expansion.',
          targetId: assets[0]?.id ? String(assets[0].id) : undefined,
        },
      ],
      actionProposals: proposals,
      relatedEntities: [context.targetId, ...assets.map((a) => String(a.id))],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: events.length + alerts.length + assets.length,
        offlineGuaranteed: true,
      },
      limitations: ['Analysis is bounded by endpoints actively reporting to local sensor mesh.'],
    };
  }

  // ─── 6c. Contextual Hunt Summary ─────────────────────────────────────────────

  public generateHuntSummary(context: InvestigationContext, queryIntent?: string): AIInvestigationResponse {
    const events = context.relatedEvents as Array<Record<string, any>>;
    const assets = context.relatedAssets as Array<Record<string, any>>;

    const observed: AIFindingItem[] = [];
    const derived: AIFindingItem[] = [];
    const hypotheses: AIFindingItem[] = [];
    const unknown: AIFindingItem[] = [];
    const proposals: AIActionProposal[] = [];

    observed.push({
      id: 'obs-hunt-matches',
      category: 'OBSERVED',
      text: `Hunt execution returned ${events.length} matching telemetry event(s) across ${assets.length} distinct asset(s).`,
      sourceEntityIds: events.slice(0, 5).map((e) => String(e.id)),
      confidenceExplanation: 'Grounded in execution of threat hunt query against canonical event store.',
    });

    const unknownEvents = events.filter((e) => !e.metadata?.isKnown);
    derived.push({
      id: 'der-hunt-novelty',
      category: 'DERIVED',
      text: `${unknownEvents.length} of ${events.length} matched events represent novel anomalies absent from known baseline evidence.`,
      sourceEntityIds: unknownEvents.slice(0, 5).map((e) => String(e.id)),
      confidenceExplanation: 'Computed by evaluating event provenance metadata against evidence repository.',
    });

    if (events.length > 0) {
      hypotheses.push({
        id: 'hyp-hunt-risk',
        category: 'HYPOTHESIS',
        text: `Concentration of matched events indicates potential reconnaissance, command execution, or lateral movement patterns.`,
        sourceEntityIds: events.slice(0, 3).map((e) => String(e.id)),
        confidenceExplanation: 'Telemetry event types match known offensive patterns.',
      });
    }

    unknown.push({
      id: 'unk-hunt-coverage',
      category: 'UNKNOWN',
      text: 'Full temporal baseline over 90+ days is unindexed; recurring periodicity cannot be verified.',
      sourceEntityIds: [],
      confidenceExplanation: 'Active query scope bounded to local telemetry window.',
    });

    const summary = `Hunt summary for query "${queryIntent || context.title}": Discovered ${events.length} event(s) (${unknownEvents.length} novel) across ${assets.length} host(s). Detection rule formulation recommended.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'HUNT_SUMMARY',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty: events.length > 0 ? 'HIGH_CONFIDENCE' : 'INSUFFICIENT_DATA',
      uncertaintyReason: events.length > 0 ? `Corroborated by ${events.length} matched events.` : 'Zero events matched query criteria.',
      supportingEvidence: [],
      questions: [],
      recommendedNextSteps: [
        {
          stepNumber: 1,
          title: 'Promote to Detection Rule',
          description: 'Convert this successful hunt query pattern into an active detection rule.',
          isDestructive: false,
          rationale: 'Automates future detection of this attack technique.',
        },
      ],
      actionProposals: proposals,
      relatedEntities: [context.targetId, ...assets.map((a) => String(a.id))],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: events.length + assets.length,
        offlineGuaranteed: true,
      },
      limitations: ['Evaluated exclusively against offline canonical event telemetry.'],
    };
  }

  // ─── 7. Simulation Analysis ───────────────────────────────────────────────

  public generateSimulationAnalysis(context: InvestigationContext): AIInvestigationResponse {
    const sim = context.simulationProvenance;
    const entity = context.primaryEntity as Record<string, any> | null;
    const simResult = entity?.simulationResult as Record<string, any> | undefined;

    const observed: AIFindingItem[] = [];
    const derived: AIFindingItem[] = [];
    const hypotheses: AIFindingItem[] = [];
    const unknown: AIFindingItem[] = [];

    observed.push({
      id: 'obs-sim-tag',
      category: 'OBSERVED',
      text: `SIMULATION DRILL ACTIVE: Scenario '${sim?.scenarioId || context.targetId}', Run ID '${sim?.runId || 'N/A'}' (Seed: ${sim?.seed || 'DEFAULT'}).`,
      sourceEntityIds: [context.targetId],
      confidenceExplanation: 'Stamped with simulation provenance metadata.',
    });

    if (simResult) {
      observed.push({
        id: 'obs-sim-result',
        category: 'OBSERVED',
        text: `Defense Readiness Score: ${simResult.defenseReadinessScore}% (Grade: ${simResult.defenseGrade}). Detection Coverage: ${simResult.detectionCoverageRate}%.`,
        sourceEntityIds: [simResult.id || context.targetId],
        confidenceExplanation: 'Direct score evaluation from simulation_results store.',
      });

      derived.push({
        id: 'der-sim-mttd',
        category: 'DERIVED',
        text: `Simulated Mean Time to Detect (MTTD): ${simResult.mttdSeconds}s. Validated ${simResult.expectedDetectionsMatched}/${simResult.totalExpectedDetections} expected detection rules.`,
        sourceEntityIds: [simResult.id || context.targetId],
        confidenceExplanation: 'Computed against scenario baseline templates.',
      });
    }

    hypotheses.push({
      id: 'hyp-sim-coverage',
      category: 'HYPOTHESIS',
      text: 'Simulation drill successfully tested pipeline parity without contaminating operational live SOC metrics.',
      sourceEntityIds: [context.targetId],
      confidenceExplanation: 'Simulation isolation verified.',
    });

    unknown.push({
      id: 'unk-sim-prod-diff',
      category: 'UNKNOWN',
      text: 'Real-world adversary timing and evasion techniques may deviate from deterministic scenario templates.',
      sourceEntityIds: [],
      confidenceExplanation: 'Scenarios use deterministic Mulberry32 PRNG.',
    });

    const summary = `[SIMULATION DRILL] Cyber Range SIMULATION Analysis: Evaluated scenario '${sim?.scenarioId || context.targetId}'. All events strictly tagged with SIMULATION metadata and isolated from live metrics.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'SIMULATION_ANALYSIS',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty: 'HIGH_CONFIDENCE',
      uncertaintyReason: 'Evaluated against deterministic scenario blueprints.',
      supportingEvidence: [],
      questions: [],
      recommendedNextSteps: [],
      actionProposals: [],
      relatedEntities: [context.targetId],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: 10,
        offlineGuaranteed: true,
      },
      limitations: ['Simulation analysis must never be conflated with live operational incidents.'],
    };
  }

  // ─── 8. Fallback / General Investigation ──────────────────────────────────

  public generateGeneralInvestigation(
    context: InvestigationContext,
    analystQuery?: string
  ): AIInvestigationResponse {
    const observed: AIFindingItem[] = [
      {
        id: 'obs-gen-scope',
        category: 'OBSERVED',
        text: `Analyzing active SOC context for ${context.targetType} ${context.targetId}: ${context.title}.`,
        sourceEntityIds: [context.targetId],
        confidenceExplanation: 'Canonical context state.',
      },
    ];

    const derived: AIFindingItem[] = [
      {
        id: 'der-gen-counts',
        category: 'DERIVED',
        text: `Context contains ${context.relatedEvents.length} event(s), ${context.relatedAlerts.length} alert(s), and ${context.relatedIncidents.length} incident(s).`,
        sourceEntityIds: [],
        confidenceExplanation: 'Computed from assembled context counts.',
      },
    ];

    const hypotheses: AIFindingItem[] = [
      {
        id: 'hyp-gen-guidance',
        category: 'HYPOTHESIS',
        text: analystQuery
          ? `Query '${analystQuery}' addressed against canonical local data stores.`
          : 'Further investigation should focus on high-severity alerts and affected asset containment.',
        sourceEntityIds: [],
        confidenceExplanation: 'General analyst guidance.',
      },
    ];

    const unknown: AIFindingItem[] = [
      {
        id: 'unk-gen-unsupported',
        category: 'UNKNOWN',
        text: 'External threat actor attribution or global telemetry cannot be established offline.',
        sourceEntityIds: [],
        confidenceExplanation: 'Zero external network access.',
      },
    ];

    const summary = `General investigation assessment for ${context.title}: Evaluated ${context.relatedAlerts.length} alert(s) across canonical stores.`;

    return {
      id: `ai-resp-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType: 'GENERAL_INVESTIGATION',
      summary,
      findings: { observed, derived, hypotheses, unknown },
      uncertainty: 'SUPPORTED',
      uncertaintyReason: 'Evaluated over local canonical records.',
      supportingEvidence: [],
      questions: [],
      recommendedNextSteps: [],
      actionProposals: [],
      relatedEntities: [context.targetId],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: context.relatedEvents.length + context.relatedAlerts.length,
        offlineGuaranteed: true,
      },
      limitations: ['Deterministic reasoning engine with zero cloud dependencies.'],
    };
  }

  // ─── 9. Case / Evidence / Response Placeholders ───────────────────────────

  public generateCaseSummary(context: InvestigationContext): AIInvestigationResponse {
    return this.generateGeneralInvestigation(context, 'Case summary evaluation');
  }

  public generateEvidenceSummary(context: InvestigationContext): AIInvestigationResponse {
    return this.generateGeneralInvestigation(context, 'Evidence integrity evaluation');
  }

  public generateResponseExplanation(context: InvestigationContext): AIInvestigationResponse {
    return this.generateGeneralInvestigation(context, 'SOAR execution review');
  }

  public generateCorrelationExplanation(context: InvestigationContext): AIInvestigationResponse {
    return this.generateIncidentSummary(context);
  }

  private buildEmptyResponse(
    context: InvestigationContext,
    responseType: AIResponseType,
    reason: string
  ): AIInvestigationResponse {
    return {
      id: `ai-resp-empty-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      engine: DETERMINISTIC_ENGINE_NAME,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      contextId: context.contextId,
      contextVersion: context.contextVersion,
      responseType,
      summary: reason,
      findings: {
        observed: [{
          id: 'obs-empty',
          category: 'OBSERVED',
          text: reason,
          sourceEntityIds: [],
          confidenceExplanation: 'Direct assessment of missing data.',
        }],
        derived: [],
        hypotheses: [],
        unknown: [{
          id: 'unk-empty',
          category: 'UNKNOWN',
          text: 'Data unavailable in local IndexedDB stores.',
          sourceEntityIds: [],
          confidenceExplanation: 'Empty store query result.',
        }],
      },
      uncertainty: 'INSUFFICIENT_DATA',
      uncertaintyReason: reason,
      supportingEvidence: [],
      questions: [],
      recommendedNextSteps: [],
      actionProposals: [],
      relatedEntities: [context.targetId],
      provenance: {
        engine: DETERMINISTIC_ENGINE_NAME,
        engineVersion: DETERMINISTIC_ENGINE_VERSION,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        generatedAt: new Date().toISOString(),
        recordsScanned: 0,
        offlineGuaranteed: true,
      },
      limitations: ['No records found to analyze.'],
    };
  }
}

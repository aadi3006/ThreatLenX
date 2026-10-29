/**
 * threat-intel-engine.ts
 *
 * Deterministic Offline Threat Intelligence Engine for EXPLAIN-SEC SPATIAL.
 *
 * Architectural Principle:
 *   RAW SECURITY EVENT -> IOC -> THREAT INTELLIGENCE -> CONTEXT / RELATIONSHIPS -> INVESTIGATION
 *
 * Core Distinction:
 *   IOC = an indicator observed by the SOC (canonical indicator identity)
 *   Threat Intelligence = contextual analytical information about the indicator and
 *   its assessed relationships.
 *
 * Strictly 100% Offline:
 *   NO external feeds, NO network requests, NO VirusTotal, NO AbuseIPDB, NO cloud AI.
 *   Enrichment and confidence are derived deterministically from canonical project telemetry:
 *   Events, Alerts, Incidents, Threat Hunts, Cases, and Evidence.
 */

import type { IOC, IocType } from '../models/entity';
import type { SecurityEvent } from '../models/event';
import type { Alert } from '../models/detection';
import type { Incident } from '../models/incident';
import type { ThreatHunt } from '../models/hunting';
import type { Case } from '../models/case';
import type { Evidence } from '../models/evidence';
import type {
  ThreatIntelRecord,
  ThreatIntelRelationship,
  ThreatIntelConfidence,
  IndicatorObservations,
} from '../models/threat-intel';

export class ThreatIntelEngine {
  /**
   * Scans canonical collections to find all occurrences and linkages for an indicator.
   */
  public static deriveObservations(
    ioc: IOC,
    events: SecurityEvent[] = [],
    alerts: Alert[] = [],
    incidents: Incident[] = [],
    hunts: ThreatHunt[] = [],
    cases: Case[] = [],
    evidence: Evidence[] = []
  ): IndicatorObservations & { firstSeenAt: string; lastSeenAt: string } {
    const valLower = ioc.value.toLowerCase();
    const timestamps: string[] = [];

    if (ioc.firstSeen) timestamps.push(ioc.firstSeen);
    if (ioc.lastSeen) timestamps.push(ioc.lastSeen);

    // 1. Scan Events
    const matchingEventIds = new Set<string>();
    const matchingAssetIds = new Set<string>(ioc.relatedAssets || []);
    const matchingUserIds = new Set<string>();

    for (const e of events) {
      let isMatch = false;
      if (e.iocIds?.includes(ioc.id)) {
        isMatch = true;
      } else if (ioc.type === 'IP' && (e.srcIp === ioc.value || e.dstIp === ioc.value || e.ip === ioc.value)) {
        isMatch = true;
      } else if (ioc.type === 'DOMAIN' && e.domain?.toLowerCase() === valLower) {
        isMatch = true;
      } else if (ioc.type === 'URL' && e.url?.toLowerCase().includes(valLower)) {
        isMatch = true;
      } else if ((ioc.type === 'HASH_SHA256' || ioc.type === 'HASH_MD5') && (e.fileHash?.toLowerCase() === valLower || e.hash?.toLowerCase() === valLower)) {
        isMatch = true;
      } else if (ioc.type === 'FILE_PATH' && (e.filePath?.toLowerCase() === valLower || e.commandLine?.toLowerCase().includes(valLower))) {
        isMatch = true;
      } else if (ioc.type === 'REGISTRY_KEY' && (e.rawPayload?.toLowerCase().includes(valLower) || e.commandLine?.toLowerCase().includes(valLower))) {
        isMatch = true;
      }

      if (isMatch) {
        matchingEventIds.add(e.id);
        if (e.timestamp) timestamps.push(e.timestamp);
        if (e.assetId) matchingAssetIds.add(e.assetId);
        if (e.userId) matchingUserIds.add(e.userId);
      }
    }

    // 2. Scan Alerts
    const matchingAlertIds = new Set<string>();
    for (const a of alerts) {
      const linksIoc = a.iocIds?.includes(ioc.id);
      const linksEvent = a.sourceEventIds?.some((eid) => matchingEventIds.has(eid));
      const mentionsVal = a.description?.toLowerCase().includes(valLower) || a.title?.toLowerCase().includes(valLower);

      if (linksIoc || linksEvent || mentionsVal) {
        matchingAlertIds.add(a.id);
        if (a.createdAt) timestamps.push(a.createdAt);
        if (a.firstSeenAt) timestamps.push(a.firstSeenAt);
        if (a.lastSeenAt) timestamps.push(a.lastSeenAt);
        if (a.assetId) matchingAssetIds.add(a.assetId);
        if (a.userId) matchingUserIds.add(a.userId);
      }
    }

    // 3. Scan Incidents
    const matchingIncidentIds = new Set<string>(ioc.relatedIncidents || []);
    for (const inc of incidents) {
      const hasIoc = inc.iocs?.includes(ioc.id) || inc.iocs?.includes(ioc.value);
      const hasTimeline = inc.timelineEvents?.some(
        (t) => t.entityId === ioc.id || t.description?.toLowerCase().includes(valLower)
      );
      if (hasIoc || hasTimeline) {
        matchingIncidentIds.add(inc.id);
        if (inc.createdAt) timestamps.push(inc.createdAt);
        if (inc.firstSeenAt) timestamps.push(inc.firstSeenAt);
        if (inc.lastSeenAt) timestamps.push(inc.lastSeenAt);
      }
    }

    // 4. Scan Threat Hunts
    const matchingHuntIds = new Set<string>();
    for (const h of hunts) {
      const hasResultEvent = h.matchedEventIds?.some((eid) => matchingEventIds.has(eid));
      const hasRelatedAlert = h.relatedAlertIds?.some((aid) => matchingAlertIds.has(aid));
      const hasRelatedIncident = h.relatedIncidentIds?.some((iid) => matchingIncidentIds.has(iid));
      const hasQueryMatch =
        h.query?.text?.toLowerCase().includes(valLower) ||
        h.name?.toLowerCase().includes(valLower) ||
        h.description?.toLowerCase().includes(valLower);

      if (hasResultEvent || hasRelatedAlert || hasRelatedIncident || hasQueryMatch) {
        matchingHuntIds.add(h.id);
        if (h.createdAt) timestamps.push(h.createdAt);
        if (h.lastExecutedAt) timestamps.push(h.lastExecutedAt);
      }
    }

    // 5. Scan Cases
    const matchingCaseIds = new Set<string>();
    for (const c of cases) {
      const linksIoc = c.iocIds?.includes(ioc.id);
      const linksIncident = c.incidentIds?.some((iid) => matchingIncidentIds.has(iid));
      const linksAlert = c.alertIds?.some((aid) => matchingAlertIds.has(aid));
      const linksEvent = c.eventIds?.some((eid) => matchingEventIds.has(eid));
      const mentionsVal = c.title?.toLowerCase().includes(valLower) || c.description?.toLowerCase().includes(valLower);

      if (linksIoc || linksIncident || linksAlert || linksEvent || mentionsVal) {
        matchingCaseIds.add(c.id);
        if (c.createdAt) timestamps.push(c.createdAt);
        if (c.updatedAt) timestamps.push(c.updatedAt);
      }
    }

    // 6. Scan Evidence
    const matchingEvidenceIds = new Set<string>();
    for (const ev of evidence) {
      const linksIoc = ev.type === 'IOC_REFERENCE' && ev.sourceId === ioc.id;
      const linksEvent = ev.sourceType === 'SECURITY_EVENT' && !!ev.sourceId && matchingEventIds.has(ev.sourceId);
      const linksAlert = ev.sourceType === 'ALERT' && !!ev.sourceId && matchingAlertIds.has(ev.sourceId);
      const linksIncident = ev.sourceType === 'INCIDENT' && !!ev.sourceId && matchingIncidentIds.has(ev.sourceId);
      const mentionsVal =
        ev.description?.toLowerCase().includes(valLower) ||
        ev.title?.toLowerCase().includes(valLower) ||
        ev.notes?.toLowerCase().includes(valLower);

      if (linksIoc || linksEvent || linksAlert || linksIncident || mentionsVal) {
        matchingEvidenceIds.add(ev.id);
        if (ev.createdAt) timestamps.push(ev.createdAt);
      }
    }

    // Determine earliest (firstSeenAt) and latest (lastSeenAt)
    const validTimestamps = timestamps.filter((t) => !isNaN(Date.parse(t))).sort();
    const firstSeenAt = validTimestamps[0] || ioc.firstSeen || new Date().toISOString();
    const lastSeenAt = validTimestamps[validTimestamps.length - 1] || ioc.lastSeen || firstSeenAt;

    const eventIds = Array.from(matchingEventIds);
    const alertIds = Array.from(matchingAlertIds);
    const incidentIds = Array.from(matchingIncidentIds);
    const huntIds = Array.from(matchingHuntIds);
    const caseIds = Array.from(matchingCaseIds);
    const evidenceIds = Array.from(matchingEvidenceIds);
    const assetIds = Array.from(matchingAssetIds);
    const userIds = Array.from(matchingUserIds);

    const totalCount =
      eventIds.length + alertIds.length + incidentIds.length + huntIds.length + caseIds.length + evidenceIds.length;

    return {
      indicatorId: ioc.id,
      indicatorValue: ioc.value,
      totalObservations: totalCount,
      totalCount,
      firstSeenAt,
      lastSeenAt,
      eventsCount: eventIds.length,
      eventIds,
      alertsCount: alertIds.length,
      alertIds,
      incidentsCount: incidentIds.length,
      incidentIds,
      huntsCount: huntIds.length,
      huntIds,
      casesCount: caseIds.length,
      caseIds,
      evidenceCount: evidenceIds.length,
      evidenceIds,
      assetsCount: assetIds.length,
      assetIds,
      usersCount: userIds.length,
      userIds,
    };
  }

  /**
   * Deterministically derives intelligence confidence from canonical telemetry observations.
   * Confidence is an analytical assessment, strictly distinct from severity.
   */
  public static deriveConfidence(
    ioc: IOC,
    obs: IndicatorObservations,
    existingRecord?: ThreatIntelRecord
  ): ThreatIntelConfidence {
    // Preserve explicit analyst assessments if source is LOCAL_ANALYST
    if (existingRecord?.sourceType === 'LOCAL_ANALYST' && existingRecord.confidence) {
      return existingRecord.confidence;
    }

    // High confidence: confirmed across incident telemetry and correlated events/alerts
    if (obs.incidentIds.length >= 1 && obs.eventIds.length >= 2) {
      return 'HIGH';
    }
    if (ioc.confidence >= 0.9 || ioc.reputationScore >= 90) {
      return 'HIGH';
    }

    // Medium confidence: observed in detection alerts or multiple security events
    if (obs.alertIds.length >= 1 || obs.eventIds.length >= 1 || ioc.confidence >= 0.7) {
      return 'MEDIUM';
    }

    // Low confidence: unobserved or single unverified observable
    return 'LOW';
  }

  /**
   * Synthesizes canonical ThreatIntelRelationship edges linking the indicator
   * to assets, incidents, alerts, security events, MITRE techniques, and related indicators.
   */
  public static synthesizeRelationships(
    ioc: IOC,
    intel: ThreatIntelRecord,
    obs: IndicatorObservations,
    alerts: Alert[] = [],
    incidents: Incident[] = [],
    allIocs: IOC[] = []
  ): ThreatIntelRelationship[] {
    const relationships: ThreatIntelRelationship[] = [];
    const now = new Date().toISOString();

    // 1. IOC -> Asset (OBSERVED_ON)
    for (const assetId of obs.assetIds) {
      relationships.push({
        id: `rel-${ioc.id}-asset-${assetId}`,
        sourceType: 'IOC',
        sourceId: ioc.id,
        targetType: 'ASSET',
        targetId: assetId,
        relationshipType: 'OBSERVED_ON',
        confidence: intel.confidence,
        source: intel.sourceType,
        createdAt: now,
        createdBy: 'system:intel-engine',
        metadata: { indicatorValue: ioc.value },
      });
    }

    // 2. IOC -> User (ASSOCIATED_WITH)
    for (const userId of obs.userIds) {
      relationships.push({
        id: `rel-${ioc.id}-user-${userId}`,
        sourceType: 'IOC',
        sourceId: ioc.id,
        targetType: 'USER',
        targetId: userId,
        relationshipType: 'ASSOCIATED_WITH',
        confidence: intel.confidence,
        source: intel.sourceType,
        createdAt: now,
        createdBy: 'system:intel-engine',
        metadata: { indicatorValue: ioc.value },
      });
    }

    // 3. IOC -> Incident (ASSOCIATED_WITH)
    for (const incId of obs.incidentIds) {
      relationships.push({
        id: `rel-${ioc.id}-inc-${incId}`,
        sourceType: 'IOC',
        sourceId: ioc.id,
        targetType: 'INCIDENT',
        targetId: incId,
        relationshipType: 'ASSOCIATED_WITH',
        confidence: intel.confidence,
        source: intel.sourceType,
        createdAt: now,
        createdBy: 'system:intel-engine',
        metadata: { indicatorValue: ioc.value },
      });
    }

    // 4. IOC -> Alert (INDICATES)
    for (const alertId of obs.alertIds) {
      relationships.push({
        id: `rel-${ioc.id}-alt-${alertId}`,
        sourceType: 'IOC',
        sourceId: ioc.id,
        targetType: 'ALERT',
        targetId: alertId,
        relationshipType: 'INDICATES',
        confidence: intel.confidence,
        source: intel.sourceType,
        createdAt: now,
        createdBy: 'system:intel-engine',
        metadata: { indicatorValue: ioc.value },
      });
    }

    // 5. IOC -> MITRE Technique (MAPS_TO)
    const mitreTechniques = new Set<string>(intel.mitreTechniqueIds || []);
    // Extract MITRE techniques from matching alerts
    for (const alertId of obs.alertIds) {
      const a = alerts.find((al) => al.id === alertId);
      if (a?.mitreTechniqueId) mitreTechniques.add(a.mitreTechniqueId);
    }
    // Extract MITRE techniques from matching incidents
    for (const incId of obs.incidentIds) {
      const inc = incidents.find((i) => i.id === incId);
      inc?.mitreTechniques?.forEach((tech) => mitreTechniques.add(tech));
      inc?.timelineEvents?.forEach((t) => {
        if (t.techniqueId && (t.entityId === ioc.id || t.description?.toLowerCase().includes(ioc.value.toLowerCase()))) {
          mitreTechniques.add(t.techniqueId);
        }
      });
    }
    for (const techId of mitreTechniques) {
      relationships.push({
        id: `rel-${ioc.id}-mitre-${techId}`,
        sourceType: 'IOC',
        sourceId: ioc.id,
        targetType: 'MITRE_TECHNIQUE',
        targetId: techId,
        relationshipType: 'MAPS_TO',
        confidence: intel.confidence,
        source: intel.sourceType,
        createdAt: now,
        createdBy: 'system:intel-engine',
        metadata: { techniqueId: techId },
      });
    }

    // 6. IOC -> Malware Family (DELIVERS / USES)
    for (const fam of intel.malwareFamilies || []) {
      relationships.push({
        id: `rel-${ioc.id}-malware-${fam.toLowerCase().replace(/[\s/]+/g, '-')}`,
        sourceType: 'IOC',
        sourceId: ioc.id,
        targetType: 'MALWARE_FAMILY',
        targetId: fam,
        relationshipType: ioc.type === 'HASH_SHA256' || ioc.type === 'FILE_PATH' ? 'DELIVERS' : 'USES',
        confidence: intel.confidence,
        source: intel.sourceType,
        createdAt: now,
        createdBy: 'system:intel-engine',
      });
    }

    // 7. IOC -> Campaign (ASSOCIATED_WITH)
    for (const camp of intel.campaigns || []) {
      relationships.push({
        id: `rel-${ioc.id}-camp-${camp.toLowerCase().replace(/[\s/]+/g, '-')}`,
        sourceType: 'IOC',
        sourceId: ioc.id,
        targetType: 'CAMPAIGN',
        targetId: camp,
        relationshipType: 'ASSOCIATED_WITH',
        confidence: intel.confidence,
        source: intel.sourceType,
        createdAt: now,
        createdBy: 'system:intel-engine',
      });
    }

    // 8. IOC -> IOC (COMMUNICATES_WITH / RELATED_TO)
    // Link domain to C2 IP, or hash payload to dropped file / C2 IP if present in BlackTide telemetry
    for (const otherIoc of allIocs) {
      if (otherIoc.id === ioc.id) continue;
      let relType: 'COMMUNICATES_WITH' | 'RELATED_TO' | null = null;

      // C2 IP <-> Exfiltration Domain
      if (
        (ioc.type === 'IP' && otherIoc.type === 'DOMAIN') ||
        (ioc.type === 'DOMAIN' && otherIoc.type === 'IP')
      ) {
        relType = 'COMMUNICATES_WITH';
      }
      // Dropper Hash <-> Staged File Path or C2 IP
      else if (
        (ioc.type === 'HASH_SHA256' && (otherIoc.type === 'FILE_PATH' || otherIoc.type === 'IP')) ||
        (ioc.type === 'FILE_PATH' && otherIoc.type === 'REGISTRY_KEY')
      ) {
        relType = 'RELATED_TO';
      }

      // Only link if they share an incident or asset
      const sharesIncident = ioc.relatedIncidents?.some((i) => otherIoc.relatedIncidents?.includes(i));
      const sharesAsset = ioc.relatedAssets?.some((a) => otherIoc.relatedAssets?.includes(a));

      if (relType && (sharesIncident || sharesAsset)) {
        relationships.push({
          id: `rel-${ioc.id}-ioc-${otherIoc.id}`,
          sourceType: 'IOC',
          sourceId: ioc.id,
          targetType: 'IOC',
          targetId: otherIoc.id,
          relationshipType: relType,
          confidence: intel.confidence,
          source: intel.sourceType,
          createdAt: now,
          createdBy: 'system:intel-engine',
          metadata: { otherIndicatorValue: otherIoc.value },
        });
      }
    }

    return relationships;
  }

  /**
   * Primary offline enrichment pipeline.
   * Performs observation scanning, dynamic timestamp calculation, confidence evaluation,
   * and relationship graph synthesis.
   */
  public static enrichLocally(
    ioc: IOC,
    existingIntel: ThreatIntelRecord | undefined,
    events: SecurityEvent[] = [],
    alerts: Alert[] = [],
    incidents: Incident[] = [],
    hunts: ThreatHunt[] = [],
    cases: Case[] = [],
    evidence: Evidence[] = [],
    allIocs: IOC[] = []
  ): { record: ThreatIntelRecord; relationships: ThreatIntelRelationship[] } {
    const obs = this.deriveObservations(ioc, events, alerts, incidents, hunts, cases, evidence);
    const confidence = this.deriveConfidence(ioc, obs, existingIntel);
    const now = new Date().toISOString();

    // Preserve existing tags, MITRE techniques, malware families, campaigns or infer from IOC & alerts
    const tags = new Set<string>(existingIntel?.tags || []);
    tags.add(`type:${ioc.type.toLowerCase()}`);
    tags.add('local-soc');
    if (confidence === 'HIGH') tags.add('high-confidence');

    const mitreTechniqueIds = new Set<string>(existingIntel?.mitreTechniqueIds || []);
    // Map BlackTide canonical MITRE techniques
    if (ioc.type === 'HASH_SHA256') mitreTechniqueIds.add('T1204.002'); // User Execution: Malicious File
    if (ioc.type === 'IP') mitreTechniqueIds.add('T1071.001'); // Application Layer Protocol: Web Protocols
    if (ioc.type === 'DOMAIN') mitreTechniqueIds.add('T1567.002'); // Exfiltration Over Web Service
    if (ioc.type === 'FILE_PATH') mitreTechniqueIds.add('T1059.001'); // PowerShell / Staging
    if (ioc.type === 'REGISTRY_KEY') mitreTechniqueIds.add('T1547.001'); // Boot/Logon Autostart: Run Keys

    const malwareFamilies = new Set<string>(existingIntel?.malwareFamilies || []);
    if (ioc.threatType?.toLowerCase().includes('blackcat') || ioc.threatType?.toLowerCase().includes('alphv')) {
      malwareFamilies.add('BlackCat/ALPHV');
    }

    const campaigns = new Set<string>(existingIntel?.campaigns || []);
    if (obs.incidentIds.includes('incident-001') || ioc.relatedIncidents?.includes('incident-001')) {
      campaigns.add('Operation BlackTide');
    }

    const relatedIndicatorIds = new Set<string>(existingIntel?.relatedIndicatorIds || []);
    allIocs.forEach((other) => {
      if (other.id !== ioc.id && ioc.relatedIncidents?.some((i) => other.relatedIncidents?.includes(i))) {
        relatedIndicatorIds.add(other.id);
      }
    });

    const record: ThreatIntelRecord = {
      id: existingIntel?.id || `intel-${ioc.id}`,
      indicatorId: ioc.id,
      indicatorType: ioc.type,
      indicatorValue: ioc.value,
      title: existingIntel?.title || `Local Intelligence: ${ioc.value}`,
      description:
        existingIntel?.description ||
        `Deterministic local intelligence for indicator ${ioc.value} (${ioc.type}). Threat context: ${ioc.threatType}.`,
      confidence,
      severity: ioc.reputationScore >= 90 ? 'CRITICAL' : ioc.reputationScore >= 70 ? 'HIGH' : 'MEDIUM',
      classification: ioc.reputationScore >= 80 ? 'MALICIOUS' : ioc.reputationScore >= 50 ? 'SUSPICIOUS' : 'UNKNOWN',
      firstSeenAt: obs.firstSeenAt,
      lastSeenAt: obs.lastSeenAt,
      sourceType: existingIntel?.sourceType || 'LOCAL_SEED',
      sourceName: existingIntel?.sourceName || 'SOC Deterministic Engine',
      tags: Array.from(tags),
      threatTypes: ioc.threatType ? [ioc.threatType] : existingIntel?.threatTypes || [],
      malwareFamilies: Array.from(malwareFamilies),
      campaigns: Array.from(campaigns),
      actors: existingIntel?.actors || [], // Keep empty unless canonical data explicitly identifies
      mitreTechniqueIds: Array.from(mitreTechniqueIds),
      relatedIndicatorIds: Array.from(relatedIndicatorIds),
      observationsCount: obs.totalObservations,
      createdAt: existingIntel?.createdAt || now,
      updatedAt: now,
      metadata: {
        ...existingIntel?.metadata,
        observationDetails: {
          events: obs.eventIds.length,
          alerts: obs.alertIds.length,
          incidents: obs.incidentIds.length,
          hunts: obs.huntIds.length,
          cases: obs.caseIds.length,
          evidence: obs.evidenceIds.length,
          assets: obs.assetIds.length,
          users: obs.userIds.length,
        },
      },
    };

    const relationships = this.synthesizeRelationships(ioc, record, obs, alerts, incidents, allIocs);

    return { record, relationships };
  }
}

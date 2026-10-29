/**
 * integrity-checker.ts
 *
 * Referential Integrity Engine for EXPLAIN-SEC SPATIAL (Step 15 Hardening).
 *
 * Verifies relational consistency across all canonical entities:
 *   - Alert → Event
 *   - Alert → DetectionRule
 *   - Alert → Incident
 *   - Incident → Event
 *   - Incident → Alert
 *   - Incident → Asset
 *   - Incident → User
 *   - Incident → IOC
 *   - Case → Incident
 *   - Case → Hunt
 *   - Evidence → Case
 *   - PlaybookExecution → Playbook
 *   - PlaybookExecution → Incident
 *   - SimulationRun → Scenario
 *
 * 100% offline, zero network dependencies, purely deterministic.
 */

import type { Incident } from '../models/incident';
import type { Alert, DetectionRule } from '../models/detection';
import type { SecurityEvent } from '../models/event';
import type { Asset, SecurityUser, IOC } from '../models/entity';
import type { Case } from '../models/case';
import type { Evidence } from '../models/evidence';
import type { ThreatHunt } from '../models/hunting';
import type { Playbook, PlaybookExecution } from '../models/response';
import type { SimulationScenario, SimulationRun } from '../models/simulation';

export interface IntegrityCheckDetail {
  checkedCount: number;
  brokenCount: number;
  brokenReferences: string[];
}

export interface ReferentialIntegrityReport {
  timestamp: string;
  isConsistent: boolean;
  totalChecks: number;
  totalBroken: number;
  details: {
    alertsToEvents: IntegrityCheckDetail;
    alertsToRules: IntegrityCheckDetail;
    alertsToIncidents: IntegrityCheckDetail;
    incidentsToEvents: IntegrityCheckDetail;
    incidentsToAlerts: IntegrityCheckDetail;
    incidentsToAssets: IntegrityCheckDetail;
    incidentsToUsers: IntegrityCheckDetail;
    incidentsToIocs: IntegrityCheckDetail;
    casesToIncidents: IntegrityCheckDetail;
    casesToHunts: IntegrityCheckDetail;
    evidenceToCases: IntegrityCheckDetail;
    playbookExecutionsToPlaybooks: IntegrityCheckDetail;
    playbookExecutionsToIncidents: IntegrityCheckDetail;
    simulationRunsToScenarios: IntegrityCheckDetail;
  };
}

export interface IntegrityAuditData {
  incidents: Incident[];
  alerts: Alert[];
  events: SecurityEvent[];
  assets: Asset[];
  users: SecurityUser[];
  iocs: IOC[];
  cases: Case[];
  evidence: Evidence[];
  threatHunts: ThreatHunt[];
  detectionRules: DetectionRule[];
  playbooks: Playbook[];
  playbookExecutions: PlaybookExecution[];
  simulationScenarios: SimulationScenario[];
  simulationRuns: SimulationRun[];
}

export function checkReferentialIntegrity(data: IntegrityAuditData): ReferentialIntegrityReport {
  const eventIds = new Set(data.events.map((e) => e.id));
  const ruleIds = new Set(data.detectionRules.map((r) => r.id));
  const incidentIds = new Set(data.incidents.map((i) => i.id));
  const assetIds = new Set(data.assets.map((a) => a.id));
  const userIds = new Set(data.users.map((u) => u.id));
  const iocIds = new Set(data.iocs.map((ioc) => ioc.id));
  const caseIds = new Set(data.cases.map((c) => c.id));
  const huntIds = new Set(data.threatHunts.map((h) => h.id));
  const playbookIds = new Set(data.playbooks.map((p) => p.id));
  const scenarioIds = new Set(data.simulationScenarios.map((s) => s.id));

  // 1. Alerts -> Events
  const alertsToEvents: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const alert of data.alerts) {
    if (alert.sourceEventIds && Array.isArray(alert.sourceEventIds)) {
      for (const eid of alert.sourceEventIds) {
        alertsToEvents.checkedCount++;
        if (!eventIds.has(eid)) {
          alertsToEvents.brokenCount++;
          alertsToEvents.brokenReferences.push(`Alert "${alert.id}" references missing Event "${eid}"`);
        }
      }
    }
  }

  // 2. Alerts -> Rules
  const alertsToRules: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const alert of data.alerts) {
    if (alert.ruleId) {
      alertsToRules.checkedCount++;
      if (!ruleIds.has(alert.ruleId)) {
        alertsToRules.brokenCount++;
        alertsToRules.brokenReferences.push(`Alert "${alert.id}" references missing DetectionRule "${alert.ruleId}"`);
      }
    }
  }

  // 3. Alerts -> Incidents
  const alertsToIncidents: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const alert of data.alerts) {
    if (alert.incidentId) {
      alertsToIncidents.checkedCount++;
      if (!incidentIds.has(alert.incidentId)) {
        alertsToIncidents.brokenCount++;
        alertsToIncidents.brokenReferences.push(`Alert "${alert.id}" references missing Incident "${alert.incidentId}"`);
      }
    }
  }

  // 4. Incidents -> Events
  const incidentsToEvents: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const incident of data.incidents) {
    if (incident.eventIds && Array.isArray(incident.eventIds)) {
      for (const eid of incident.eventIds) {
        incidentsToEvents.checkedCount++;
        if (!eventIds.has(eid)) {
          incidentsToEvents.brokenCount++;
          incidentsToEvents.brokenReferences.push(`Incident "${incident.id}" references missing Event "${eid}"`);
        }
      }
    }
  }

  // 5. Incidents -> Alerts
  const incidentsToAlerts: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const incident of data.incidents) {
    if (incident.alertIds && Array.isArray(incident.alertIds)) {
      for (const aid of incident.alertIds) {
        incidentsToAlerts.checkedCount++;
        if (!data.alerts.some((a) => a.id === aid)) {
          incidentsToAlerts.brokenCount++;
          incidentsToAlerts.brokenReferences.push(`Incident "${incident.id}" references missing Alert "${aid}"`);
        }
      }
    }
  }

  // 6. Incidents -> Assets
  const incidentsToAssets: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const incident of data.incidents) {
    if (incident.affectedAssets && Array.isArray(incident.affectedAssets)) {
      for (const aid of incident.affectedAssets) {
        incidentsToAssets.checkedCount++;
        if (!assetIds.has(aid)) {
          incidentsToAssets.brokenCount++;
          incidentsToAssets.brokenReferences.push(`Incident "${incident.id}" references missing Asset "${aid}"`);
        }
      }
    }
  }

  // 7. Incidents -> Users
  const incidentsToUsers: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const incident of data.incidents) {
    if (incident.affectedUsers && Array.isArray(incident.affectedUsers)) {
      for (const uid of incident.affectedUsers) {
        incidentsToUsers.checkedCount++;
        if (!userIds.has(uid)) {
          incidentsToUsers.brokenCount++;
          incidentsToUsers.brokenReferences.push(`Incident "${incident.id}" references missing User "${uid}"`);
        }
      }
    }
  }

  // 8. Incidents -> IOCs
  const incidentsToIocs: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const incident of data.incidents) {
    if (incident.iocs && Array.isArray(incident.iocs)) {
      for (const iid of incident.iocs) {
        incidentsToIocs.checkedCount++;
        if (!iocIds.has(iid)) {
          incidentsToIocs.brokenCount++;
          incidentsToIocs.brokenReferences.push(`Incident "${incident.id}" references missing IOC "${iid}"`);
        }
      }
    }
  }

  // 9. Cases -> Incidents
  const casesToIncidents: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const c of data.cases) {
    if (c.incidentIds && Array.isArray(c.incidentIds)) {
      for (const incId of c.incidentIds) {
        casesToIncidents.checkedCount++;
        if (!incidentIds.has(incId)) {
          casesToIncidents.brokenCount++;
          casesToIncidents.brokenReferences.push(`Case "${c.id}" references missing Incident "${incId}"`);
        }
      }
    }
  }

  // 10. Cases -> Hunts
  const casesToHunts: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const c of data.cases) {
    if (c.huntIds && Array.isArray(c.huntIds)) {
      for (const hid of c.huntIds) {
        casesToHunts.checkedCount++;
        if (!huntIds.has(hid)) {
          casesToHunts.brokenCount++;
          casesToHunts.brokenReferences.push(`Case "${c.id}" references missing ThreatHunt "${hid}"`);
        }
      }
    }
  }

  // 11. Evidence -> Cases
  const evidenceToCases: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const ev of data.evidence) {
    if (ev.caseId) {
      evidenceToCases.checkedCount++;
      if (!caseIds.has(ev.caseId)) {
        evidenceToCases.brokenCount++;
        evidenceToCases.brokenReferences.push(`Evidence "${ev.id}" references missing Case "${ev.caseId}"`);
      }
    }
  }

  // 12. PlaybookExecutions -> Playbooks
  const playbookExecutionsToPlaybooks: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const exec of data.playbookExecutions) {
    if (exec.playbookId) {
      playbookExecutionsToPlaybooks.checkedCount++;
      if (!playbookIds.has(exec.playbookId)) {
        playbookExecutionsToPlaybooks.brokenCount++;
        playbookExecutionsToPlaybooks.brokenReferences.push(`PlaybookExecution "${exec.id}" references missing Playbook "${exec.playbookId}"`);
      }
    }
  }

  // 13. PlaybookExecutions -> Incidents
  const playbookExecutionsToIncidents: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const exec of data.playbookExecutions) {
    if (exec.incidentId) {
      playbookExecutionsToIncidents.checkedCount++;
      if (!incidentIds.has(exec.incidentId)) {
        playbookExecutionsToIncidents.brokenCount++;
        playbookExecutionsToIncidents.brokenReferences.push(`PlaybookExecution "${exec.id}" references missing Incident "${exec.incidentId}"`);
      }
    }
  }

  // 14. SimulationRuns -> Scenarios
  const simulationRunsToScenarios: IntegrityCheckDetail = { checkedCount: 0, brokenCount: 0, brokenReferences: [] };
  for (const run of data.simulationRuns) {
    if (run.scenarioId) {
      simulationRunsToScenarios.checkedCount++;
      if (!scenarioIds.has(run.scenarioId)) {
        simulationRunsToScenarios.brokenCount++;
        simulationRunsToScenarios.brokenReferences.push(`SimulationRun "${run.id}" references missing Scenario "${run.scenarioId}"`);
      }
    }
  }

  const allDetails = [
    alertsToEvents,
    alertsToRules,
    alertsToIncidents,
    incidentsToEvents,
    incidentsToAlerts,
    incidentsToAssets,
    incidentsToUsers,
    incidentsToIocs,
    casesToIncidents,
    casesToHunts,
    evidenceToCases,
    playbookExecutionsToPlaybooks,
    playbookExecutionsToIncidents,
    simulationRunsToScenarios,
  ];

  const totalChecks = allDetails.reduce((sum, d) => sum + d.checkedCount, 0);
  const totalBroken = allDetails.reduce((sum, d) => sum + d.brokenCount, 0);

  return {
    timestamp: new Date().toISOString(),
    isConsistent: totalBroken === 0,
    totalChecks,
    totalBroken,
    details: {
      alertsToEvents,
      alertsToRules,
      alertsToIncidents,
      incidentsToEvents,
      incidentsToAlerts,
      incidentsToAssets,
      incidentsToUsers,
      incidentsToIocs,
      casesToIncidents,
      casesToHunts,
      evidenceToCases,
      playbookExecutionsToPlaybooks,
      playbookExecutionsToIncidents,
      simulationRunsToScenarios,
    },
  };
}

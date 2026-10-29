import type { Permission, RoleDefinition, RoleId } from '../models/auth';

// ─── Role Catalogue ──────────────────────────────────────────────────────────
// Single source of truth for all RBAC definitions in EXPLAIN-SEC SPATIAL.
// Permissions are cumulative up the seniority chain, not inherited automatically.

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: 'L1_ANALYST',
    name: 'L1 SOC Analyst',
    description: 'First-line triage, alert review, basic investigation, and initial incident logging.',
    permissions: [
      'INCIDENT_READ',
      'INCIDENT_TRIAGE',
      'INCIDENT_CREATE',
      'THREAT_HUNT_READ',
      'CASE_READ',
      'CASE_CREATE',
      'CASE_UPDATE',
      'EVIDENCE_READ',
      'EVIDENCE_COLLECT',
      'EVIDENCE_ANNOTATE',
      'EVIDENCE_VERIFY',
      'THREAT_INTEL_READ',
      'THREAT_INTEL_ENRICH',
      'DETECTION_RULE_READ',
      'DETECTION_RULE_TEST',
      'PLAYBOOK_READ',
      'VIEW_SOC_METRICS',
      'VIEW_OPERATIONAL_DATA',
      'VIEW_SIMULATIONS',
      'VIEW_SIMULATION_RESULTS',
      'VIEW_AI_ASSISTANT',
      'GENERATE_AI_ANALYSIS',
      'VIEW_INTEGRATIONS',
      'VIEW_SYNC_STATUS',
    ],
  },
  {
    id: 'L2_ANALYST',
    name: 'L2 SOC Analyst',
    description: 'Deep-dive investigation, IOC correlation, containment requests, and evidence collection.',
    permissions: [
      'INCIDENT_READ',
      'INCIDENT_TRIAGE',
      'INCIDENT_CREATE',
      'INCIDENT_INVESTIGATE',
      'THREAT_HUNT_READ',
      'THREAT_HUNT_EXECUTE',
      'CONTAINMENT_REQUEST',
      'CASE_READ',
      'CASE_CREATE',
      'CASE_UPDATE',
      'EVIDENCE_READ',
      'EVIDENCE_COLLECT',
      'EVIDENCE_ANNOTATE',
      'EVIDENCE_VERIFY',
      'EVIDENCE_MANAGE',
      'THREAT_INTEL_READ',
      'THREAT_INTEL_ENRICH',
      'THREAT_INTEL_MANAGE',
      'DETECTION_RULE_READ',
      'DETECTION_RULE_TEST',
      'DETECTION_RULE_AUTHOR',
      'PLAYBOOK_READ',
      'PLAYBOOK_AUTHOR',
      'PLAYBOOK_EXECUTE',
      'VIEW_SOC_METRICS',
      'VIEW_OPERATIONAL_DATA',
      'VIEW_SIMULATIONS',
      'CREATE_SIMULATION',
      'RUN_SIMULATION',
      'CANCEL_SIMULATION',
      'VIEW_SIMULATION_RESULTS',
      'VIEW_AI_ASSISTANT',
      'GENERATE_AI_ANALYSIS',
      'PROPOSE_RESPONSE_ACTION',
      'VIEW_INTEGRATIONS',
      'VIEW_SYNC_STATUS',
      'SYNC_DATA',
      'USE_EXTERNAL_ENRICHMENT',
    ],
  },
  {
    id: 'INCIDENT_RESPONDER',
    name: 'Incident Responder',
    description: 'Executes containment actions and coordinates response playbooks.',
    permissions: [
      'INCIDENT_READ',
      'INCIDENT_TRIAGE',
      'INCIDENT_CREATE',
      'INCIDENT_INVESTIGATE',
      'INCIDENT_ESCALATE',
      'CONTAINMENT_REQUEST',
      'CONTAINMENT_APPROVE',
      'SOAR_EXECUTE',
      'CASE_READ',
      'CASE_UPDATE',
      'EVIDENCE_READ',
      'EVIDENCE_COLLECT',
      'EVIDENCE_ANNOTATE',
      'EVIDENCE_VERIFY',
      'THREAT_INTEL_READ',
      'THREAT_INTEL_ENRICH',
      'DETECTION_RULE_READ',
      'DETECTION_RULE_TEST',
      'PLAYBOOK_READ',
      'PLAYBOOK_EXECUTE',
      'PLAYBOOK_CANCEL',
      'VIEW_SOC_METRICS',
      'VIEW_OPERATIONAL_DATA',
      'VIEW_SIMULATIONS',
      'RUN_SIMULATION',
      'VIEW_SIMULATION_RESULTS',
      'VIEW_AI_ASSISTANT',
      'GENERATE_AI_ANALYSIS',
      'PROPOSE_RESPONSE_ACTION',
      'VIEW_INTEGRATIONS',
      'VIEW_SYNC_STATUS',
      'SYNC_DATA',
      'USE_EXTERNAL_RESPONSE',
      'USE_EXTERNAL_ENRICHMENT',
    ],
  },
  {
    id: 'THREAT_HUNTER',
    name: 'Threat Hunter',
    description: 'Proactive threat hunting and advanced MITRE-guided analysis. (No incident triage or direct creation rights).',
    permissions: [
      'INCIDENT_READ',
      'INCIDENT_INVESTIGATE',
      'THREAT_HUNT_READ',
      'THREAT_HUNT_EXECUTE',
      'CONTAINMENT_REQUEST',
      'CASE_READ',
      'CASE_CREATE',
      'CASE_UPDATE',
      'EVIDENCE_READ',
      'EVIDENCE_COLLECT',
      'EVIDENCE_ANNOTATE',
      'EVIDENCE_VERIFY',
      'THREAT_INTEL_READ',
      'THREAT_INTEL_ENRICH',
      'THREAT_INTEL_MANAGE',
      'DETECTION_RULE_READ',
      'DETECTION_RULE_TEST',
      'DETECTION_RULE_AUTHOR',
      'DETECTION_RULE_MANAGE',
      'PLAYBOOK_READ',
      'PLAYBOOK_AUTHOR',
      'PLAYBOOK_EXECUTE',
      'VIEW_SOC_METRICS',
      'VIEW_OPERATIONAL_DATA',
      'VIEW_SIMULATIONS',
      'CREATE_SIMULATION',
      'RUN_SIMULATION',
      'VIEW_SIMULATION_RESULTS',
      'VIEW_AI_ASSISTANT',
      'GENERATE_AI_ANALYSIS',
      'PROPOSE_RESPONSE_ACTION',
      'VIEW_INTEGRATIONS',
      'VIEW_SYNC_STATUS',
      'SYNC_DATA',
      'USE_EXTERNAL_ENRICHMENT',
    ],
  },
  {
    id: 'SOC_MANAGER',
    name: 'SOC Manager',
    description: 'Full operational authority: escalation, approval, audit access, and incident creation.',
    permissions: [
      'INCIDENT_READ',
      'INCIDENT_TRIAGE',
      'INCIDENT_CREATE',
      'INCIDENT_INVESTIGATE',
      'INCIDENT_ESCALATE',
      'CONTAINMENT_REQUEST',
      'CONTAINMENT_APPROVE',
      'SOAR_EXECUTE',
      'THREAT_HUNT_READ',
      'THREAT_HUNT_EXECUTE',
      'CASE_READ',
      'CASE_CREATE',
      'CASE_UPDATE',
      'CASE_MANAGE',
      'EVIDENCE_READ',
      'EVIDENCE_COLLECT',
      'EVIDENCE_ANNOTATE',
      'EVIDENCE_VERIFY',
      'EVIDENCE_MANAGE',
      'THREAT_INTEL_READ',
      'THREAT_INTEL_ENRICH',
      'THREAT_INTEL_MANAGE',
      'DETECTION_RULE_READ',
      'DETECTION_RULE_TEST',
      'DETECTION_RULE_AUTHOR',
      'DETECTION_RULE_MANAGE',
      'PLAYBOOK_READ',
      'PLAYBOOK_AUTHOR',
      'PLAYBOOK_MANAGE',
      'PLAYBOOK_EXECUTE',
      'PLAYBOOK_APPROVE',
      'PLAYBOOK_CANCEL',
      'AUDIT_READ',
      'VIEW_SOC_METRICS',
      'VIEW_OPERATIONAL_DATA',
      'SCENARIO_MANAGE',
      'VIEW_SIMULATIONS',
      'CREATE_SIMULATION',
      'RUN_SIMULATION',
      'CANCEL_SIMULATION',
      'DELETE_SIMULATION_DATA',
      'VIEW_SIMULATION_RESULTS',
      'VIEW_AI_ASSISTANT',
      'GENERATE_AI_ANALYSIS',
      'PROPOSE_RESPONSE_ACTION',
      'VIEW_INTEGRATIONS',
      'MANAGE_INTEGRATIONS',
      'SYNC_DATA',
      'VIEW_SYNC_STATUS',
      'RESOLVE_SYNC_CONFLICT',
      'USE_EXTERNAL_RESPONSE',
      'USE_EXTERNAL_ENRICHMENT',
    ],
  },
  {
    id: 'PLATFORM_ADMIN',
    name: 'Platform Administrator',
    description: 'Full platform configuration, all permissions.',
    permissions: [
      'INCIDENT_READ',
      'INCIDENT_TRIAGE',
      'INCIDENT_CREATE',
      'INCIDENT_INVESTIGATE',
      'INCIDENT_ESCALATE',
      'CONTAINMENT_REQUEST',
      'CONTAINMENT_APPROVE',
      'SOAR_EXECUTE',
      'THREAT_HUNT_READ',
      'THREAT_HUNT_EXECUTE',
      'CASE_READ',
      'CASE_CREATE',
      'CASE_UPDATE',
      'CASE_MANAGE',
      'EVIDENCE_READ',
      'EVIDENCE_COLLECT',
      'EVIDENCE_ANNOTATE',
      'EVIDENCE_VERIFY',
      'EVIDENCE_MANAGE',
      'THREAT_INTEL_READ',
      'THREAT_INTEL_ENRICH',
      'THREAT_INTEL_MANAGE',
      'DETECTION_RULE_READ',
      'DETECTION_RULE_TEST',
      'DETECTION_RULE_AUTHOR',
      'DETECTION_RULE_MANAGE',
      'PLAYBOOK_READ',
      'PLAYBOOK_AUTHOR',
      'PLAYBOOK_MANAGE',
      'PLAYBOOK_EXECUTE',
      'PLAYBOOK_APPROVE',
      'PLAYBOOK_CANCEL',
      'AUDIT_READ',
      'VIEW_SOC_METRICS',
      'VIEW_OPERATIONAL_DATA',
      'SCENARIO_MANAGE',
      'CONFIG_MANAGE',
      'VIEW_SIMULATIONS',
      'CREATE_SIMULATION',
      'RUN_SIMULATION',
      'CANCEL_SIMULATION',
      'DELETE_SIMULATION_DATA',
      'VIEW_SIMULATION_RESULTS',
      'VIEW_AI_ASSISTANT',
      'GENERATE_AI_ANALYSIS',
      'PROPOSE_RESPONSE_ACTION',
      'VIEW_INTEGRATIONS',
      'MANAGE_INTEGRATIONS',
      'SYNC_DATA',
      'VIEW_SYNC_STATUS',
      'RESOLVE_SYNC_CONFLICT',
      'USE_EXTERNAL_RESPONSE',
      'USE_EXTERNAL_ENRICHMENT',
    ],
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

const _roleMap = new Map<RoleId, RoleDefinition>(
  ROLE_DEFINITIONS.map((r) => [r.id, r])
);

export function getRoleDefinition(roleId: RoleId): RoleDefinition | undefined {
  return _roleMap.get(roleId);
}

export function hasPermission(roleId: RoleId, permission: Permission): boolean {
  const def = _roleMap.get(roleId);
  return def ? def.permissions.includes(permission) : false;
}

export function canCreateIncident(roleId: RoleId): boolean {
  return hasPermission(roleId, 'INCIDENT_CREATE');
}

export function canEscalate(fromRole: RoleId, _toRole: RoleId): boolean {
  return hasPermission(fromRole, 'INCIDENT_ESCALATE');
}

export function canRequestContainment(roleId: RoleId): boolean {
  return hasPermission(roleId, 'CONTAINMENT_REQUEST');
}

export function canApproveContainment(roleId: RoleId): boolean {
  return hasPermission(roleId, 'CONTAINMENT_APPROVE');
}

export function canExecuteSOAR(roleId: RoleId): boolean {
  return hasPermission(roleId, 'SOAR_EXECUTE');
}

export function canIngestEvents(roleId?: RoleId): boolean {
  if (!roleId) return true; // System / automated ingestion
  return (
    hasPermission(roleId, 'INCIDENT_CREATE') ||
    hasPermission(roleId, 'THREAT_HUNT_EXECUTE') ||
    hasPermission(roleId, 'CONFIG_MANAGE')
  );
}

export function canAcknowledgeAlert(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'INCIDENT_TRIAGE');
}

export function canResolveAlert(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'INCIDENT_TRIAGE') || hasPermission(roleId, 'CONTAINMENT_APPROVE');
}

export function canReadDetectionRules(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'DETECTION_RULE_READ') || hasPermission(roleId, 'CONFIG_MANAGE');
}

export function canTestDetectionRules(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'DETECTION_RULE_TEST') || hasPermission(roleId, 'CONFIG_MANAGE');
}

export function canAuthorDetectionRules(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return (
    hasPermission(roleId, 'DETECTION_RULE_AUTHOR') ||
    hasPermission(roleId, 'CONFIG_MANAGE') ||
    roleId === 'THREAT_HUNTER' ||
    roleId === 'SOC_MANAGER'
  );
}

export function canManageDetectionRules(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return (
    hasPermission(roleId, 'DETECTION_RULE_MANAGE') ||
    hasPermission(roleId, 'CONFIG_MANAGE') ||
    roleId === 'THREAT_HUNTER' ||
    roleId === 'SOC_MANAGER'
  );
}

export function canCorrelate(roleId?: RoleId): boolean {
  if (!roleId) return true; // System / automated correlation engine
  return hasPermission(roleId, 'INCIDENT_TRIAGE') || hasPermission(roleId, 'INCIDENT_INVESTIGATE');
}

export function canExecuteThreatHunt(roleId?: RoleId): boolean {
  if (!roleId) return true; // System / automated
  return hasPermission(roleId, 'THREAT_HUNT_EXECUTE') || hasPermission(roleId, 'THREAT_HUNT_READ');
}

export function canSaveThreatHunt(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'THREAT_HUNT_EXECUTE');
}

export function canReadCases(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'CASE_READ');
}

export function canCreateCase(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'CASE_CREATE');
}

export function canUpdateCase(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'CASE_UPDATE');
}

export function canManageCase(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'CASE_MANAGE');
}

export function canReadEvidence(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'EVIDENCE_READ');
}

export function canCollectEvidence(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'EVIDENCE_COLLECT');
}

export function canAnnotateEvidence(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'EVIDENCE_ANNOTATE');
}

export function canVerifyEvidence(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'EVIDENCE_VERIFY');
}

export function canManageEvidence(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'EVIDENCE_MANAGE');
}

export function canReadThreatIntel(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'THREAT_INTEL_READ');
}

export function canEnrichThreatIntel(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'THREAT_INTEL_ENRICH');
}

export function canManageThreatIntel(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'THREAT_INTEL_MANAGE');
}

export function canReadPlaybooks(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'PLAYBOOK_READ');
}

export function canAuthorPlaybooks(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'PLAYBOOK_AUTHOR');
}

export function canManagePlaybooks(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'PLAYBOOK_MANAGE');
}

export function canExecutePlaybooks(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'PLAYBOOK_EXECUTE');
}

export function canApprovePlaybooks(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'PLAYBOOK_APPROVE');
}

export function canCancelPlaybooks(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'PLAYBOOK_CANCEL');
}

export function canViewSocMetrics(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'VIEW_SOC_METRICS');
}

export function canViewOperationalData(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'VIEW_OPERATIONAL_DATA');
}

export function canViewSimulations(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'VIEW_SIMULATIONS');
}

export function canCreateSimulation(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'CREATE_SIMULATION');
}

export function canRunSimulation(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'RUN_SIMULATION');
}

export function canCancelSimulation(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'CANCEL_SIMULATION');
}

export function canDeleteSimulationData(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'DELETE_SIMULATION_DATA');
}

export function canViewSimulationResults(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'VIEW_SIMULATION_RESULTS');
}

export function canViewAiAssistant(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'VIEW_AI_ASSISTANT');
}

export function canGenerateAiAnalysis(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'GENERATE_AI_ANALYSIS');
}

export function canProposeResponseAction(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'PROPOSE_RESPONSE_ACTION');
}

export function canViewIntegrations(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'VIEW_INTEGRATIONS');
}

export function canManageIntegrations(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'MANAGE_INTEGRATIONS');
}

export function canSyncData(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'SYNC_DATA');
}

export function canViewSyncStatus(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'VIEW_SYNC_STATUS');
}

export function canResolveSyncConflict(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'RESOLVE_SYNC_CONFLICT');
}

export function canUseExternalResponse(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'USE_EXTERNAL_RESPONSE');
}

export function canUseExternalEnrichment(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'USE_EXTERNAL_ENRICHMENT');
}

export function canInvestigate(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'INCIDENT_INVESTIGATE') || hasPermission(roleId, 'INCIDENT_READ');
}

export function canCreateFinding(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'CASE_UPDATE') || hasPermission(roleId, 'CASE_CREATE') || hasPermission(roleId, 'EVIDENCE_ANNOTATE');
}

export function canExecuteResponse(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return canExecuteSOAR(roleId);
}

export function canApproveSensitiveAction(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return roleId === 'SOC_MANAGER' || roleId === 'PLATFORM_ADMIN';
}

export function canManagePolicies(roleId?: RoleId): boolean {
  if (!roleId) return true;
  return hasPermission(roleId, 'CONFIG_MANAGE') || roleId === 'PLATFORM_ADMIN';
}

export interface RoleCapabilitySummary {
  roleId: RoleId;
  roleTitle: string;
  allowedActions: string[];
  restrictedActions: { action: string; requiredRole: string }[];
}

export function getRoleCapabilitySummary(roleId: RoleId): RoleCapabilitySummary {
  switch (roleId) {
    case 'L1_ANALYST':
    case 'L2_ANALYST':
      return {
        roleId,
        roleTitle: 'SOC Analyst',
        allowedActions: ['Investigate telemetry', 'Collect evidence', 'Create findings & notes', 'Request containment'],
        restrictedActions: [
          { action: 'Execute response actions', requiredRole: 'Responder' },
          { action: 'Approve sensitive containment', requiredRole: 'Manager' },
          { action: 'Manage users/policies', requiredRole: 'Administrator' },
        ],
      };
    case 'INCIDENT_RESPONDER':
      return {
        roleId,
        roleTitle: 'Responder',
        allowedActions: ['Investigate telemetry', 'Execute authorized response', 'Collect evidence', 'Perform rollback'],
        restrictedActions: [
          { action: 'Approve sensitive containment', requiredRole: 'Manager' },
          { action: 'Manage users/policies', requiredRole: 'Administrator' },
        ],
      };
    case 'SOC_MANAGER':
      return {
        roleId,
        roleTitle: 'SOC Manager',
        allowedActions: ['Approve sensitive actions', 'Escalate incidents', 'Manage cases', 'Execute response'],
        restrictedActions: [
          { action: 'Manage system policies/users', requiredRole: 'Administrator' },
        ],
      };
    case 'PLATFORM_ADMIN':
      return {
        roleId,
        roleTitle: 'Administrator',
        allowedActions: ['Manage users/policies', 'Approve sensitive actions', 'Execute all SOAR', 'Investigate & Audit'],
        restrictedActions: [],
      };
    case 'THREAT_HUNTER':
    default:
      return {
        roleId,
        roleTitle: 'Security Specialist',
        allowedActions: ['Investigate telemetry', 'Execute threat hunts', 'Collect evidence'],
        restrictedActions: [
          { action: 'Approve sensitive actions', requiredRole: 'Manager' },
          { action: 'Manage system policies', requiredRole: 'Administrator' },
        ],
      };
  }
}



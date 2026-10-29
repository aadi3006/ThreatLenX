export type RoleId =
  | 'L1_ANALYST'
  | 'L2_ANALYST'
  | 'INCIDENT_RESPONDER'
  | 'THREAT_HUNTER'
  | 'SOC_MANAGER'
  | 'PLATFORM_ADMIN';

export type Permission =
  | 'INCIDENT_READ'
  | 'INCIDENT_TRIAGE'
  | 'INCIDENT_CREATE'
  | 'INCIDENT_INVESTIGATE'
  | 'INCIDENT_ESCALATE'
  | 'CONTAINMENT_REQUEST'
  | 'CONTAINMENT_APPROVE'
  | 'SOAR_EXECUTE'
  | 'THREAT_HUNT_READ'
  | 'THREAT_HUNT_EXECUTE'
  | 'CASE_READ'
  | 'CASE_CREATE'
  | 'CASE_UPDATE'
  | 'CASE_MANAGE'
  | 'EVIDENCE_READ'
  | 'EVIDENCE_COLLECT'
  | 'EVIDENCE_ANNOTATE'
  | 'EVIDENCE_VERIFY'
  | 'EVIDENCE_MANAGE'
  | 'THREAT_INTEL_READ'
  | 'THREAT_INTEL_ENRICH'
  | 'THREAT_INTEL_MANAGE'
  | 'DETECTION_RULE_READ'
  | 'DETECTION_RULE_TEST'
  | 'DETECTION_RULE_AUTHOR'
  | 'DETECTION_RULE_MANAGE'
  | 'PLAYBOOK_READ'
  | 'PLAYBOOK_AUTHOR'
  | 'PLAYBOOK_MANAGE'
  | 'PLAYBOOK_EXECUTE'
  | 'PLAYBOOK_APPROVE'
  | 'PLAYBOOK_CANCEL'
  | 'AUDIT_READ'
  | 'VIEW_SOC_METRICS'
  | 'VIEW_OPERATIONAL_DATA'
  | 'SCENARIO_MANAGE'
  | 'CONFIG_MANAGE'
  | 'VIEW_SIMULATIONS'
  | 'CREATE_SIMULATION'
  | 'RUN_SIMULATION'
  | 'CANCEL_SIMULATION'
  | 'DELETE_SIMULATION_DATA'
  | 'VIEW_SIMULATION_RESULTS'
  | 'VIEW_AI_ASSISTANT'
  | 'GENERATE_AI_ANALYSIS'
  | 'PROPOSE_RESPONSE_ACTION'
  | 'VIEW_INTEGRATIONS'
  | 'MANAGE_INTEGRATIONS'
  | 'SYNC_DATA'
  | 'VIEW_SYNC_STATUS'
  | 'RESOLVE_SYNC_CONFLICT'
  | 'USE_EXTERNAL_RESPONSE'
  | 'USE_EXTERNAL_ENRICHMENT';

export interface RoleDefinition {
  id: RoleId;
  name: string;
  description: string;
  permissions: Permission[];
}

export interface UserSession {
  token: string;
  userId: string;
  username: string;
  displayName: string;
  role: RoleId;
  tenantId: string;
  authenticatedAt: string;
  expiresAt: string;
}

export interface UserCredentials {
  username: string;
  password?: string;
  roleOverride?: RoleId;
}

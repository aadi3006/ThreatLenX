/**
 * response.ts
 *
 * Canonical models for Security Orchestration, Automation, and Response (SOAR).
 * Supports:
 * - Deterministic, reversible Action Catalog
 * - Versioned Playbook templates with strict lifecycles
 * - Isolated, persistent Playbook Execution instances
 * - RBAC-governed Approvals
 * - Dry-run simulation
 * - Backward-compatible ResponseAction entities
 */

export type ResponseActionType =
  | 'QUARANTINE_HOST'
  | 'QUARANTINE_ASSET'
  | 'ISOLATE_ASSET'
  | 'UNQUARANTINE_HOST'
  | 'RESTORE_ASSET'
  | 'DISABLE_ACCOUNT'
  | 'DISABLE_USER'
  | 'SUSPEND_USER'
  | 'ENABLE_ACCOUNT'
  | 'RESTORE_USER'
  | 'BLOCK_IOC'
  | 'UNBLOCK_IOC'
  | 'REVOKE_AUTH_TOKENS'
  | 'ISOLATE_NETWORK_SEGMENT'
  | 'TRIGGER_HEURISTIC_SWEEP'
  | 'ROTATE_CREDENTIALS'
  | 'ESCALATE_INCIDENT'
  | 'CHANGE_INCIDENT_STATUS'
  | 'ASSIGN_INCIDENT'
  | 'CREATE_CASE'
  | 'ADD_CASE_NOTE'
  | 'CREATE_EVIDENCE_REFERENCE'
  | 'ADD_INCIDENT_TAG'
  | 'ADD_IOC_TAG'
  | 'MARK_ALERT_ACKNOWLEDGED'
  | 'MARK_ALERT_RESOLVED'
  | 'RUN_HUNT'
  | 'COLLECT_EVENT_REFERENCE'
  | 'CREATE_AUDIT_ENTRY'
  | 'KILL_PROCESS'
  | 'BLOCK_DOMAIN'
  | 'COLLECT_EVIDENCE'
  | 'EXECUTE_PLAYBOOK';

export type ResponseActionStatus =
  | 'DRAFT'
  | 'REQUESTED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED'
  // Backward compatibility aliases
  | 'PENDING'
  | 'AWAITING_APPROVAL'
  | 'EXECUTED'
  | 'ROLLED_BACK'
  | 'DENIED';

export type ResponseTargetType =
  | 'ASSET'
  | 'USER'
  | 'IOC'
  | 'NETWORK'
  | 'INCIDENT'
  | 'ALERT'
  | 'CASE'
  | 'EVIDENCE'
  | 'EVENT';

export type ActionReversibility =
  | 'FULL'
  | 'PARTIAL'
  | 'IRREVERSIBLE'
  | 'REVERSIBLE'
  | 'NON_REVERSIBLE'
  | 'PARTIALLY_REVERSIBLE';

export interface ResponseAction {
  id: string;
  type: ResponseActionType;
  targetId: string;
  targetType: ResponseTargetType;
  targetLabel: string;
  incidentId: string;
  status: ResponseActionStatus;
  riskImpact: 'HIGH' | 'MEDIUM' | 'LOW';
  reversibility: ActionReversibility;
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  executedAt?: string;
  resultMessage?: string;
  consequence?: string;
  requiresApproval?: boolean;
}

export type PlaybookStepType =
  | 'TRIGGER'
  | 'CONDITION'
  | 'ACTION_REQUEST'
  | 'APPROVAL'
  | 'ACTION_EXECUTE'
  | 'ACTION'
  | 'INCIDENT_UPDATE'
  | 'AUDIT_COMMIT'
  | 'WAIT'
  | 'VERIFICATION'
  | 'NOTIFICATION';

export type PlaybookStepStatus =
  | 'PENDING'
  | 'READY'
  | 'WAITING_APPROVAL'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export interface PlaybookStep {
  id: string;
  name: string;
  type: PlaybookStepType;
  actionType?: ResponseActionType;
  order: number;
  status?: PlaybookStepStatus;
  targetType?: ResponseTargetType;
  targetId?: string;
  targetReference?: string;
  targetLabel?: string;
  description: string;
  parameters?: Record<string, any>;
  condition?: Record<string, any>;
  timeoutMs?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };
  requiresApproval?: boolean;
  continueOnFailure?: boolean;
  compensationAction?: ResponseActionType;
  verification?: {
    check: string;
    expectedValue: any;
  };
  requiredRole?: string;
  consequence?: string;
  executedAt?: string;
  resultMessage?: string;
  error?: string;
}

export type PlaybookLifecycleStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'TESTING'
  | 'PUBLISHED'
  | 'ENABLED'
  | 'DISABLED'
  | 'DEPRECATED';

export type PlaybookCategory =
  | 'CONTAINMENT'
  | 'ERADICATION'
  | 'REMEDIATION'
  | 'INVESTIGATION'
  | 'NOTIFICATION'
  | 'ESCALATION';

export type PlaybookTriggerType =
  | 'MANUAL'
  | 'ALERT_CREATED'
  | 'ALERT_CRITICAL'
  | 'INCIDENT_CREATED'
  | 'INCIDENT_SEVERITY_CHANGED'
  | 'INCIDENT_STATUS_CHANGED'
  | 'CASE_CREATED'
  | 'HUNT_SELECTED';

export interface Playbook {
  id: string;
  playbookId: string;
  version: number;
  name: string;
  description: string;
  category: PlaybookCategory;
  status: PlaybookLifecycleStatus | 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  enabled: boolean;
  triggerTypes: PlaybookTriggerType[];
  triggerConditions?: Record<string, any>;
  severity?: string;
  supportedEntityTypes: ResponseTargetType[];
  steps: PlaybookStep[];
  approvalPolicy?: {
    requiresManagerApproval: boolean;
    allowedRoles?: string[];
  };
  timeoutMs?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };
  tags?: string[];
  author: string;
  createdAt: string | number;
  updatedAt: string | number;
  publishedAt?: string | number;
  deprecatedAt?: string | number;

  // Backward compatibility fields
  incidentId?: string;
  triggerType?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PlaybookVersion {
  id: string; // `${playbookId}:v${version}`
  playbookId: string;
  version: number;
  name: string;
  description: string;
  category: PlaybookCategory;
  steps: PlaybookStep[];
  triggerTypes: PlaybookTriggerType[];
  supportedEntityTypes: ResponseTargetType[];
  author: string;
  publishedAt: string | number;
  changeDescription?: string;
}

export type PlaybookExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export interface PlaybookStepExecution {
  id: string;
  stepId: string;
  order: number;
  name: string;
  type: PlaybookStepType;
  actionType?: ResponseActionType;
  targetType?: ResponseTargetType;
  targetId?: string;
  targetLabel?: string;
  status: PlaybookStepStatus;
  parameters?: Record<string, any>;
  requiresApproval?: boolean;
  approvalId?: string;
  startedAt?: string;
  completedAt?: string;
  resultMessage?: string;
  error?: string;
  compensatedAt?: string;
  compensationResultMessage?: string;
}

export interface PlaybookExecution {
  id: string;
  playbookId: string;
  playbookVersion: number;
  playbookName: string;
  triggerSource: PlaybookTriggerType;
  incidentId?: string;
  alertId?: string;
  caseId?: string;
  targetEntity?: {
    id: string;
    type: ResponseTargetType;
    label: string;
  };
  status: PlaybookExecutionStatus;
  currentStepIndex: number;
  stepExecutions: PlaybookStepExecution[];
  startedAt: string;
  completedAt?: string;
  initiatedBy: string;
  initiatedByRole: string;
  isDryRun: boolean;
  error?: string;
  idempotencyKey: string;
}

export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface ApprovalRecord {
  id: string;
  executionId: string;
  stepId: string;
  actionType: ResponseActionType;
  targetType: ResponseTargetType;
  targetId: string;
  targetLabel: string;
  riskImpact: 'HIGH' | 'MEDIUM' | 'LOW';
  requestedBy: string;
  requestedByRole: string;
  requestedAt: string;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedByRole?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedByRole?: string;
  rejectedAt?: string;
  reason?: string;
}

export interface DryRunSimulatedStep {
  stepId: string;
  name: string;
  actionType?: ResponseActionType;
  target: string;
  wouldExecute: boolean;
  requiresApproval: boolean;
  expectedStateChange: string;
  reversibility: ActionReversibility;
}

export interface DryRunResult {
  playbookId: string;
  playbookVersion: number;
  valid: boolean;
  simulatedSteps: DryRunSimulatedStep[];
  warnings: string[];
  errors: string[];
  executedBy: string;
  simulatedAt: string;
}

export interface ResponsePolicy {
  id: string;
  name: string;
  description: string;
  minSeverityForAutoExecution?: string;
  requireApprovalActionTypes: ResponseActionType[];
  allowedRolesForExecution: string[];
  allowedRolesForApproval: string[];
  dryRunRequired: boolean;
}

export interface PlaybookValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

import type { Permission } from './auth';

export interface ActionDefinition {
  type: ResponseActionType;
  name: string;
  description: string;
  category: 'CONTAINMENT' | 'ERADICATION' | 'REMEDIATION' | 'INVESTIGATION' | 'ESCALATION' | 'NOTIFICATION';
  targetType: ResponseTargetType;
  requiredPermission: Permission;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  reversibility: ActionReversibility;
  compensationType?: ResponseActionType;
  parametersSchema?: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'array';
      required?: boolean;
      description?: string;
      allowedValues?: string[];
    };
  };
  validate: (
    targetId: string,
    params: Record<string, any>,
    stores: Record<string, any[]>
  ) => { valid: boolean; error?: string };
  simulate: (
    targetId: string,
    params: Record<string, any>,
    stores: Record<string, any[]>
  ) => { expectedStateChange: string; wouldModify: boolean };
  execute: (
    targetId: string,
    params: Record<string, any>,
    context: any,
    stores: Record<string, any[]>
  ) => Promise<any>;
  verify: (
    targetId: string,
    params: Record<string, any>,
    stores: Record<string, any[]>
  ) => Promise<{ verified: boolean; message: string }>;
  compensate?: (
    targetId: string,
    previousState: any,
    context: any,
    stores: Record<string, any[]>
  ) => Promise<any>;
}


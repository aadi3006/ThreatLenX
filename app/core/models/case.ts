/**
 * Canonical Case Management Models
 *
 * Operational container model sitting above Incidents and Threat Hunts.
 * Maintains investigations, operational ownership, tasks, findings, notes,
 * and canonical security references without duplicating telemetry.
 */

export type CaseStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED';

export type CasePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type CaseSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type CaseTaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';

/**
 * Valid lifecycle transitions for cases.
 * Direct transitions from CLOSED back to active states must go through reopenCase.
 */
export const VALID_CASE_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ['IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['PENDING', 'RESOLVED', 'CLOSED'],
  PENDING: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [], // Can only transition via explicit reopenCase -> IN_PROGRESS or OPEN
};

export function isValidCaseStatusTransition(current: CaseStatus, target: CaseStatus): boolean {
  if (current === target) return true;
  const allowed = VALID_CASE_STATUS_TRANSITIONS[current];
  return allowed ? allowed.includes(target) : false;
}

/**
 * Structured Case Note
 */
export interface CaseNote {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  content: string;
  isEdited?: boolean;
}

/**
 * Operational Analyst Task
 */
export interface CaseTask {
  id: string;
  caseId: string;
  title: string;
  description?: string;
  status: CaseTaskStatus;
  priority: CasePriority;
  assigneeId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  completedAt?: string;
}

/**
 * Concrete Investigation Finding
 * Retains clear provenance links to canonical events, alerts, and incidents.
 */
export interface CaseFinding {
  id: string;
  caseId: string;
  title: string;
  description: string;
  severity?: CaseSeverity;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  relatedEventIds?: string[];
  relatedAlertIds?: string[];
  relatedIncidentIds?: string[];
  relatedHuntIds?: string[];
  relatedEvidenceIds?: string[];
}

/**
 * Canonical Case
 */
export interface Case {
  id: string;
  caseNumber: string; // e.g. CASE-000001
  title: string;
  description: string;

  status: CaseStatus;
  priority: CasePriority;
  severity: CaseSeverity;

  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  resolvedAt?: string;

  createdBy: string;
  ownerId?: string;
  participantIds?: string[];

  // Lightweight references to canonical security entities
  incidentIds: string[];
  huntIds: string[];
  alertIds: string[];
  eventIds: string[];

  assetIds: string[];
  userIds: string[];
  iocIds: string[];

  tags: string[];

  resolution?: string;
  closureReason?: string;

  metadata?: Record<string, unknown>;
}

/**
 * Inputs for creating and updating cases
 */
export interface CreateCaseInput {
  title: string;
  description: string;
  priority?: CasePriority;
  severity?: CaseSeverity;
  ownerId?: string;
  incidentIds?: string[];
  huntIds?: string[];
  alertIds?: string[];
  eventIds?: string[];
  assetIds?: string[];
  userIds?: string[];
  iocIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateCaseInput {
  title?: string;
  description?: string;
  status?: CaseStatus;
  priority?: CasePriority;
  severity?: CaseSeverity;
  ownerId?: string;
  participantIds?: string[];
  incidentIds?: string[];
  huntIds?: string[];
  alertIds?: string[];
  eventIds?: string[];
  assetIds?: string[];
  userIds?: string[];
  iocIds?: string[];
  tags?: string[];
  resolution?: string;
  closureReason?: string;
  resolvedAt?: string;
  closedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCaseNoteInput {
  content: string;
  authorId?: string;
  authorName?: string;
}

export interface UpdateCaseNoteInput {
  content: string;
}

export interface CreateCaseTaskInput {
  title: string;
  description?: string;
  priority?: CasePriority;
  assigneeId?: string;
  dueAt?: string;
}

export interface CreateCaseFindingInput {
  title: string;
  description: string;
  severity?: CaseSeverity;
  relatedEventIds?: string[];
  relatedAlertIds?: string[];
  relatedIncidentIds?: string[];
  relatedHuntIds?: string[];
  relatedEvidenceIds?: string[];
}

export interface CaseQueryFilter {
  query?: string;
  status?: CaseStatus | CaseStatus[];
  priority?: CasePriority | CasePriority[];
  severity?: CaseSeverity | CaseSeverity[];
  ownerId?: string;
  createdBy?: string;
  incidentId?: string;
  huntId?: string;
  assetId?: string;
  userId?: string;
  iocId?: string;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

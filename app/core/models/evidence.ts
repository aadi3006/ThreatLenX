/**
 * Canonical Evidence Management Models
 *
 * Evidence is an investigation artifact or reference preserved inside a case
 * for analysis, with provenance, integrity metadata (SHA-256), ownership,
 * and append-only chain-of-custody information.
 *
 * Hierarchy:
 * EVENT / ALERT / INCIDENT / HUNT -> CASE -> EVIDENCE -> FINDING -> CASE RESOLUTION
 */

export type EvidenceType =
  | 'EVENT_REFERENCE'
  | 'ALERT_REFERENCE'
  | 'INCIDENT_REFERENCE'
  | 'HUNT_REFERENCE'
  | 'IOC_REFERENCE'
  | 'ASSET_REFERENCE'
  | 'USER_REFERENCE'
  | 'TEXT_NOTE'
  | 'FILE';

export type EvidenceStatus =
  | 'COLLECTED'
  | 'UNDER_REVIEW'
  | 'VALIDATED'
  | 'DISPUTED'
  | 'ARCHIVED';

export type EvidenceSourceType =
  | 'SECURITY_EVENT'
  | 'ALERT'
  | 'INCIDENT'
  | 'THREAT_HUNT'
  | 'IOC'
  | 'ASSET'
  | 'USER'
  | 'ANALYST'
  | 'FILE'
  | 'MANUAL';

export type CustodyAction =
  | 'COLLECTED'
  | 'VIEWED'
  | 'TRANSFERRED'
  | 'STATUS_CHANGED'
  | 'ANNOTATED'
  | 'INTEGRITY_VERIFIED'
  | 'ARCHIVED';

/**
 * Valid lifecycle transitions for evidence.
 * COLLECTED -> UNDER_REVIEW -> VALIDATED -> ARCHIVED
 * DISPUTED is an explicit investigative review state, not a deletion.
 */
export const VALID_EVIDENCE_STATUS_TRANSITIONS: Record<EvidenceStatus, EvidenceStatus[]> = {
  COLLECTED: ['UNDER_REVIEW', 'DISPUTED', 'ARCHIVED'],
  UNDER_REVIEW: ['VALIDATED', 'DISPUTED', 'ARCHIVED'],
  VALIDATED: ['UNDER_REVIEW', 'DISPUTED', 'ARCHIVED'],
  DISPUTED: ['UNDER_REVIEW', 'VALIDATED', 'ARCHIVED'],
  ARCHIVED: ['UNDER_REVIEW'], // Archived evidence can be reopened for review if authorized
};

export function isValidEvidenceStatusTransition(current: EvidenceStatus, target: EvidenceStatus): boolean {
  if (current === target) return true;
  const allowed = VALID_EVIDENCE_STATUS_TRANSITIONS[current];
  return allowed ? allowed.includes(target) : false;
}

/**
 * Cryptographic integrity verification state
 */
export interface EvidenceIntegrity {
  algorithm: 'SHA-256';
  hash?: string;
  verified?: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
}

/**
 * Append-only Chain of Custody entry
 */
export interface EvidenceCustodyEntry {
  id: string;
  evidenceId: string;
  action: CustodyAction;
  actorId: string;
  actorRole?: string;
  timestamp: string;
  fromStatus?: EvidenceStatus;
  toStatus?: EvidenceStatus;
  source?: string;
  destination?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Structured analyst investigation annotation (commentary, not modifying original evidence)
 */
export interface EvidenceAnnotation {
  id: string;
  evidenceId: string;
  authorId: string;
  authorName?: string;
  createdAt: string;
  updatedAt: string;
  content: string;
}

/**
 * Canonical Evidence Object
 */
export interface Evidence {
  id: string;
  evidenceNumber: string; // e.g. EVD-000001 (persistent, collision-safe)

  caseId: string; // Mandatory relationship to a Case

  type: EvidenceType;
  title: string;
  description?: string;

  sourceType: EvidenceSourceType;
  sourceId?: string; // Canonical ID of referenced entity (e.g. evt-001, alert-seed-001)

  collectedAt: string;
  collectedBy: string;

  createdAt: string;
  updatedAt: string;

  status: EvidenceStatus;

  integrity: EvidenceIntegrity;

  metadata: Record<string, unknown>;

  tags: string[];

  notes?: string;

  chainOfCustodyId?: string;

  // Local file / blob metadata (offline only, zero remote uploads)
  sizeBytes?: number;
  mimeType?: string;
  fileName?: string;
  storageReference?: string; // ID in evidence_blobs store if binary file

  // Safe text content for TEXT_NOTE
  textContent?: string;

  // Canonical relationship IDs
  relatedEventIds?: string[];
  relatedAlertIds?: string[];
  relatedIncidentIds?: string[];
  relatedHuntIds?: string[];
  relatedAssetIds?: string[];
  relatedUserIds?: string[];
  relatedIocIds?: string[];
}

/**
 * Input objects
 */
export interface CreateEvidenceInput {
  caseId: string;
  type: EvidenceType;
  title: string;
  description?: string;
  sourceType: EvidenceSourceType;
  sourceId?: string;
  status?: EvidenceStatus;
  metadata?: Record<string, unknown>;
  tags?: string[];
  notes?: string;

  // File or text payload
  fileName?: string;
  mimeType?: string;
  fileBytes?: ArrayBuffer;
  textContent?: string;

  // Relationships
  relatedEventIds?: string[];
  relatedAlertIds?: string[];
  relatedIncidentIds?: string[];
  relatedHuntIds?: string[];
  relatedAssetIds?: string[];
  relatedUserIds?: string[];
  relatedIocIds?: string[];
}

export interface UpdateEvidenceMetadataInput {
  title?: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  notes?: string;
  relatedEventIds?: string[];
  relatedAlertIds?: string[];
  relatedIncidentIds?: string[];
  relatedHuntIds?: string[];
  relatedAssetIds?: string[];
  relatedUserIds?: string[];
  relatedIocIds?: string[];
}

export interface CreateEvidenceAnnotationInput {
  content: string;
  authorId?: string;
  authorName?: string;
}

export interface EvidenceQueryFilter {
  query?: string;
  caseId?: string;
  status?: EvidenceStatus | EvidenceStatus[];
  type?: EvidenceType | EvidenceType[];
  sourceType?: EvidenceSourceType | EvidenceSourceType[];
  sourceId?: string;
  collectedBy?: string;
  tag?: string;
  incidentId?: string;
  eventId?: string;
  huntId?: string;
  iocId?: string;
  assetId?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

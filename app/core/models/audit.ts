export interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  action: string;
  target: string;
  previousState?: string;
  resultingState?: string;
  authorization: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  details: Record<string, unknown>;
}

export interface RiskScoreFactor {
  factor: string;
  score: number;
  weight: number;
  description: string;
}

export interface RiskScore {
  overall: number; // 0.0 - 100.0
  assetCriticalityScore: number;
  attackProgressionScore: number;
  threatActorConfidenceScore: number;
  blastRadiusScore: number;
  breakdown: RiskScoreFactor[];
}

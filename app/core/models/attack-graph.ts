import type { Severity } from './incident';

export type AttackGraphNodeType =
  | 'INCIDENT'
  | 'ALERT'
  | 'EVENT'
  | 'ASSET'
  | 'USER'
  | 'IOC'
  | 'PROCESS'
  | 'TECHNIQUE'
  | 'ACTION';

export interface AttackGraphNode {
  id: string;
  label: string;
  sublabel?: string;
  type: AttackGraphNodeType;
  severity?: Severity;
  status?: string;
  isRoot?: boolean;
  isCompromised?: boolean;
  data?: Record<string, unknown>;
  x?: number;
  y?: number;
  z?: number;
}

export type AttackRelationType =
  | 'GENERATED_BY'
  | 'AFFECTS'
  | 'EXECUTED_ON'
  | 'ASSOCIATED_WITH'
  | 'COMMUNICATED_WITH'
  | 'CORRELATED_WITH'
  | 'ATTRIBUTED_TO'
  | 'USES'
  | 'TARGETS'
  | 'PRECEDES'
  | 'MITIGATED_BY'
  | 'OBSERVED_ON'
  | 'RELATED_TO';

export interface AttackGraphEdge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
  relation: AttackRelationType;
  label?: string;
  isCriticalPath?: boolean;
  stepOrder?: number;
  timestamp?: string;
}

export interface AttackGraph {
  incidentId: string;
  rootNodeId: string;
  nodes: AttackGraphNode[];
  edges: AttackGraphEdge[];
  attackPathNodeIds: string[];
}

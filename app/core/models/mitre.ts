export interface MitreTactic {
  id: string; // e.g. 'TA0001'
  name: string;
  shortName: string;
  description: string;
}

export interface MitreTechnique {
  id: string; // e.g. 'T1078' or 'T1078.002'
  tacticId: string;
  tacticName: string;
  name: string;
  subTechniqueOf?: string;
  description: string;
  detection: string;
  platforms: string[];
}

export type MitreCoverageStatus = 'ACTIVE' | 'DETECTED' | 'MITIGATED' | 'UNOBSERVED';

export interface MitreTechniqueCoverage {
  technique: MitreTechnique;
  status: MitreCoverageStatus;
  detectedCount: number;
  associatedIncidentIds: string[];
  firstObserved?: string;
  lastObserved?: string;
}

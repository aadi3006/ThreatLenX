import type { Asset, BlastRadiusLevel, IOC } from './entity';

export interface SystemRadarNode {
  asset: Asset;
  blastRadiusLevel: BlastRadiusLevel;
  distance: number; // 0.0 (center) to 1.0 (perimeter)
  angle: number; // Radians (0 to 2PI)
  hopCount: number;
}

export interface SystemRadarData {
  incidentId: string;
  focalAssetId: string;
  totalAssetsAtRisk: number;
  compromisedCount: number;
  isolatedCount: number;
  assets: SystemRadarNode[];
}

export interface IocGraphLink {
  sourceIocId: string;
  targetEntityId: string;
  targetType: 'ASSET' | 'USER' | 'INCIDENT';
  relation: string;
}

export interface IocGraphData {
  incidentId: string;
  iocs: IOC[];
  links: IocGraphLink[];
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  threatType: string;
  initialDefcon: number;
  estimatedDurationMs: number;
}

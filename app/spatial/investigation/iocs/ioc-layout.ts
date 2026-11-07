/**
 * ioc-layout.ts
 *
 * Deterministic spatial layout calculation for the IOC Constellation graph.
 * Positions IOC nodes in an inner elliptical constellation and associated
 * entity nodes (Assets, Users, Incidents) in an outer orbital ring.
 */

import type { IOC } from '../../../core/models/entity';
import type { IocGraphLink } from '../../../core/models/spatial-structures';

export const IOC_CANVAS_WIDTH = 560;
export const IOC_CANVAS_HEIGHT = 420;
export const IOC_CANVAS_CX = IOC_CANVAS_WIDTH / 2;
export const IOC_CANVAS_CY = IOC_CANVAS_HEIGHT / 2;

export interface PlacedIOC {
  ioc: IOC;
  x: number;
  y: number;
  index: number;
}

export interface PlacedEntity {
  id: string;
  label: string;
  type: 'ASSET' | 'USER' | 'INCIDENT';
  x: number;
  y: number;
  color: string;
  index: number;
}

export function placeIOCs(iocs: IOC[]): PlacedIOC[] {
  return iocs.map((ioc, i) => {
    const angle = (i / Math.max(iocs.length, 1)) * 2 * Math.PI - Math.PI / 2;
    return {
      ioc,
      x: IOC_CANVAS_CX + 120 * Math.cos(angle),
      y: IOC_CANVAS_CY + 90 * Math.sin(angle),
      index: i,
    };
  });
}

export function placeEntities(
  links: IocGraphLink[],
  assets: { id: string; name: string }[],
  users: { id: string; displayName: string }[],
  incidentId: string
): PlacedEntity[] {
  const seen = new Set<string>();
  const entities: PlacedEntity[] = [];

  links.forEach((link) => {
    if (seen.has(link.targetEntityId)) return;
    seen.add(link.targetEntityId);

    let label = link.targetEntityId;
    let color = '#7b8ab8';

    if (link.targetType === 'ASSET') {
      const a = assets.find((a) => a.id === link.targetEntityId);
      label = a?.name ?? link.targetEntityId;
      color = '#00f0ff';
    } else if (link.targetType === 'USER') {
      const u = users.find((u) => u.id === link.targetEntityId);
      label = u?.displayName ?? link.targetEntityId;
      color = '#ffb700';
    } else if (link.targetType === 'INCIDENT') {
      label = incidentId.toUpperCase().replace('INCIDENT-', 'INC-');
      color = '#ff2a2a';
    }

    // Place entities in an outer ring
    const totalUnique = [...new Set(links.map((l) => l.targetEntityId))].length;
    const idx = [...seen].indexOf(link.targetEntityId);
    const angle = (idx / Math.max(totalUnique, 1)) * 2 * Math.PI - Math.PI / 2;
    const r = 190;

    entities.push({
      id: link.targetEntityId,
      label,
      type: link.targetType,
      x: IOC_CANVAS_CX + r * Math.cos(angle),
      y: IOC_CANVAS_CY + r * Math.sin(angle) * 0.75,
      color,
      index: idx,
    });
  });

  return entities;
}

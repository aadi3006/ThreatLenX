/**
 * IncidentFocusPanel.tsx
 *
 * Stage 3: This component now delegates entirely to InvestigationHub.
 *
 * InvestigationHub wraps InvestigationProvider which loads all canonical
 * data from SecurityService and manages the shared investigation state
 * (attack graph, timeline, MITRE, system radar, IOC constellation, replay).
 *
 * The Stage 2 detail panel is superseded by the Investigation Layer.
 * The CSS import here pulls in both the incident-universe styles and
 * the full investigation styles.
 */

'use client';
import InvestigationHub from '../investigation/InvestigationHub';
import '../investigation/investigation.css';

interface IncidentFocusPanelProps {
  incidentId: string;
  /** Not used in Stage 3 — InvestigationHub loads entities from SecurityService */
  allAssets?: unknown[];
  allUsers?: unknown[];
  allIocs?: unknown[];
  onRegister: (id: string, el: HTMLElement | null) => void;
  onExitFocus: () => void;
}

export default function IncidentFocusPanel({
  incidentId,
  onRegister,
  onExitFocus,
}: IncidentFocusPanelProps) {
  return (
    <InvestigationHub
      incidentId={incidentId}
      onRegister={onRegister}
      onExitFocus={onExitFocus}
    />
  );
}

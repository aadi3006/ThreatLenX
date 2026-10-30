'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSocNav, socNavStore } from './spatial/state/use-soc-nav';
import { spatialNavStore } from './spatial/state/use-spatial-nav';
import { useSpatialDiscreteState } from './spatial-transform';
import { spatialController } from './spatial-controller';
import { SpatialCommandHub, type SpatialHubZone } from './spatial/hub/SpatialCommandHub';
import IncidentUniverse from './spatial/incident-universe/IncidentUniverse';
import InvestigationHub from './spatial/investigation/InvestigationHub';
import ThreatHuntingWorkspace from './spatial/hunting/ThreatHuntingWorkspace';
import CaseWorkspace from './spatial/cases/CaseWorkspace';
import EvidenceWorkspace from './spatial/evidence/EvidenceWorkspace';
import { DetectionEngineeringWorkspace } from './spatial/detection/DetectionEngineeringWorkspace';
import { useSecuritySpatial } from './spatial/state/use-security-spatial';
import { cyberAudio } from './cyber-audio';
import { performanceManager, type PerformanceMode } from './spatial/performance-mode';
import './spatial/incident-universe/incident-universe.css';

interface SocSpatialWrapperProps {
  onTriggerAlert?: (msg: string) => void;
}

export default function SocSpatialWrapper({ onTriggerAlert }: SocSpatialWrapperProps) {
  const nav = useSocNav();
  const { pointedPanelId } = useSpatialDiscreteState();
  const { incidents } = useSecuritySpatial();
  const [perfMode, setPerfMode] = useState<PerformanceMode>(() => performanceManager.getMode());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__socNavStore = socNavStore;
    }
    // Initialize performance mode on client after hydration
    performanceManager?.initClient?.();
    return performanceManager.subscribe((m) => setPerfMode(m));
  }, []);

  const handleRegisterPanel = useCallback((id: string, el: HTMLElement | null) => {
    if (el) spatialController.registerPanel(id, el);
    else    spatialController.unregisterPanel(id);
  }, []);

  const handleSelectPanel = useCallback((id: string) => {
    cyberAudio.playSelect();
    socNavStore.selectIncident(id);
  }, []);

  const handleExitFocus = useCallback(() => {
    cyberAudio.playClick();
    socNavStore.selectIncident(null);
  }, []);

  const handleNavigateZone = useCallback((zone: SpatialHubZone) => {
    cyberAudio.playModeSwitch();
    if (zone === 'COMMAND') {
      socNavStore.selectIncident(null);
    }
    socNavStore.goToWorkspace(zone);
    spatialNavStore.goToWorkspace(zone as any);
  }, []);

  const handleReturnToHub = useCallback(() => {
    cyberAudio.playModeSwitch();
    socNavStore.goToHub();
  }, []);

  const effectiveIncidentId = nav.selectedIncidentId || incidents[0]?.id || '';

  return (
    <div className={`soc-spatial-wrapper mode-${nav.workspace.toLowerCase()}`}>
      {/* Workspace Stage Container with Normal Scrolling */}
      <div className="soc-stage-container">
        {nav.workspace === 'COMMAND' ? (
          <div className="spatial-universe-layer">
            <IncidentUniverse
              mode={nav.workspace}
              focusedPanelId={nav.selectedIncidentId}
              pointedPanelId={pointedPanelId}
              onRegisterPanel={handleRegisterPanel}
              onSelectPanel={handleSelectPanel}
              onExitFocus={handleExitFocus}
              onClose={handleReturnToHub}
              renderFlanks={true}
            />
          </div>
        ) : nav.workspace === 'INVESTIGATION' ? (
          <div className="spatial-investigation-layer">
            <InvestigationHub
              incidentId={effectiveIncidentId}
              onRegister={handleRegisterPanel}
              onExitFocus={() => {
                socNavStore.navigateBack();
              }}
            />
          </div>
        ) : nav.workspace === 'HUNTING' ? (
          <ThreatHuntingWorkspace
            perfMode={perfMode}
            onClose={handleReturnToHub}
            onInvestigateIncident={(incidentId) => {
              cyberAudio.playSelect();
              socNavStore.goToInvestigation(incidentId);
            }}
          />
        ) : nav.workspace === 'CASES' ? (
          <CaseWorkspace
            perfMode={perfMode}
            onClose={handleReturnToHub}
            onInvestigateIncident={(incidentId) => {
              cyberAudio.playSelect();
              socNavStore.goToInvestigation(incidentId);
            }}
            onOpenThreatHunt={() => {
              cyberAudio.playModeSwitch();
              socNavStore.goToWorkspace('HUNTING');
            }}
            onOpenEvidence={() => {
              cyberAudio.playModeSwitch();
              socNavStore.goToWorkspace('EVIDENCE');
            }}
          />
        ) : nav.workspace === 'EVIDENCE' ? (
          <EvidenceWorkspace
            perfMode={perfMode}
            onClose={handleReturnToHub}
            onNavigateToCase={() => {
              cyberAudio.playModeSwitch();
              socNavStore.goToWorkspace('CASES');
            }}
            onInvestigateIncident={(incidentId) => {
              cyberAudio.playSelect();
              socNavStore.goToInvestigation(incidentId);
            }}
            onOpenThreatHunt={() => {
              cyberAudio.playModeSwitch();
              socNavStore.goToWorkspace('HUNTING');
            }}
          />
        ) : nav.workspace === 'DETECTION' ? (
          <DetectionEngineeringWorkspace
            perfMode={perfMode}
            onClose={handleReturnToHub}
          />
        ) : (
          /* Default App First Screen: Restored Spatial Command Hub */
          <SpatialCommandHub
            perfMode={perfMode}
            activeIncidentId={nav.selectedIncidentId}
            onNavigateZone={handleNavigateZone}
            onRegisterPanel={handleRegisterPanel}
          />
        )}
      </div>
    </div>
  );
}

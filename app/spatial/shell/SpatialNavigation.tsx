/**
 * app/spatial/shell/SpatialNavigation.tsx
 *
 * Bottom Workspace Navigation Dock.
 *
 * Houses mode pills for all 8 SOC operational workspaces, AI copilot, and integrations.
 * Positioned at the bottom of the shell for maximum spatial canvas utilization.
 * Supports pointer click, keyboard shortcuts, and hand gesture navigation.
 * Collapsible via toggle button — when collapsed a floating restore pill is shown.
 */

'use client';
import {
  Minimize2,
  Crosshair,
  Briefcase,
  FileCheck,
  Sliders,
  Activity,
  ShieldAlert,
  Brain,
  Cloud,
  Compass,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react';
import { SpatialMode } from '../../spatial-transform';
import { useSpatialUi } from '../state/use-spatial-ui';
import { useSpatialNav, spatialNavStore } from '../state/use-spatial-nav';
import { cyberAudio } from '../../cyber-audio';

export interface SpatialNavigationProps {
  currentMode: SpatialMode;
  isAiOpen: boolean;
  isIntegrationOpen: boolean;
  onToggleAi: () => void;
  onToggleIntegration: () => void;
}

export function SpatialNavigation({
  currentMode,
  isAiOpen,
  isIntegrationOpen,
  onToggleAi,
  onToggleIntegration,
}: SpatialNavigationProps) {
  const { navigationVisible, toggleNavigation } = useSpatialUi();
  const nav = useSpatialNav();

  const handleModeSwitch = (mode: SpatialMode) => {
    cyberAudio.playModeSwitch();
    if (mode === 'SPATIAL') {
      spatialNavStore.goToHub();
    } else if (mode === 'INVESTIGATION') {
      spatialNavStore.goToWorkspace('INVESTIGATION');
    } else {
      spatialNavStore.goToWorkspace(mode as any);
    }
  };

  const activeWs = nav.activeWorkspace;
  const isHub = nav.navigationLevel === 'HUB' || activeWs === 'SPATIAL';

  // When navigation is hidden, render a floating restore pill at the bottom
  if (!navigationVisible) {
    return (
      <button
        className="nav-dock-restore-pill"
        onClick={() => {
          cyberAudio.playClick();
          toggleNavigation();
        }}
        title="Show Workspace Navigation Dock"
        aria-label="Show navigation"
      >
        <ChevronUp size={10} />
        <span>WORKSPACES</span>
      </button>
    );
  }

  return (
    <nav className="spatial-soc-navigation" aria-label="SOC Workspaces">
      {/* Collapse toggle */}
      <button
        className="nav-dock-toggle"
        onClick={() => {
          cyberAudio.playClick();
          toggleNavigation();
        }}
        title="Collapse Navigation Dock"
        aria-label="Collapse navigation"
      >
        <ChevronDown size={12} />
      </button>

      <div className="nav-pills-row">
        <button
          className={`nav-pill hub-pill ${isHub ? 'active' : ''}`}
          onClick={() => handleModeSwitch('SPATIAL')}
          title="CENTRAL SPATIAL COMMAND HUB [HotKey: Home / O]"
        >
          <Compass size={12} color="#00f0ff" />
          <span>SPATIAL HUB [Home]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'COMMAND' && !isHub ? 'active' : ''}`}
          onClick={() => handleModeSwitch('COMMAND')}
          title="COMMAND OVERVIEW [HotKey: F]"
        >
          <Minimize2 size={12} />
          <span>COMMAND [F]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'INVESTIGATION' && !isHub ? 'active' : ''}`}
          onClick={() => handleModeSwitch('INVESTIGATION')}
          title="INCIDENT INVESTIGATION & ATTACK GRAPH [HotKey: V]"
        >
          <Activity size={12} color={activeWs === 'INVESTIGATION' ? '#3dffb0' : 'currentColor'} />
          <span>INVESTIGATION [V]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'HUNTING' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('HUNTING')}
          title="THREAT HUNTING WORKSPACE [HotKey: H]"
        >
          <Crosshair size={12} color={activeWs === 'HUNTING' ? '#00f0ff' : 'currentColor'} />
          <span>THREAT HUNT [H]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'CASES' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('CASES')}
          title="CASE MANAGEMENT WORKSPACE [HotKey: C]"
        >
          <Briefcase size={12} color={activeWs === 'CASES' ? '#00f0ff' : 'currentColor'} />
          <span>CASES [C]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'EVIDENCE' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('EVIDENCE')}
          title="EVIDENCE VAULT & CHAIN OF CUSTODY [HotKey: E]"
        >
          <FileCheck size={12} color={activeWs === 'EVIDENCE' ? '#00f0ff' : 'currentColor'} />
          <span>EVIDENCE [E]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'DETECTION' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('DETECTION')}
          title="DETECTION ENGINEERING & YARA-L WORKSPACE [HotKey: D]"
        >
          <Sliders size={12} color={activeWs === 'DETECTION' ? '#00f0ff' : 'currentColor'} />
          <span>RULES [D]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'METRICS' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('METRICS')}
          title="SOC METRICS & OPERATIONAL ANALYTICS [HotKey: M]"
        >
          <Activity size={12} color={activeWs === 'METRICS' ? '#00f0ff' : 'currentColor'} />
          <span>METRICS [M]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'SIMULATION' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('SIMULATION')}
          title="CYBER RANGE & ATTACK SIMULATION [HotKey: S]"
        >
          <ShieldAlert size={12} color={activeWs === 'SIMULATION' ? '#00f0ff' : 'currentColor'} />
          <span>RANGE [S]</span>
        </button>

        <button
          className={`nav-pill ${activeWs === 'RESPONSE' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('RESPONSE')}
          title="SOAR INCIDENT RESPONSE & PLAYBOOKS [HotKey: Z]"
        >
          <Zap size={12} color={activeWs === 'RESPONSE' ? '#ffb700' : 'currentColor'} />
          <span>SOAR [Z]</span>
        </button>

        <div className="nav-divider" />

        <button
          className={`nav-pill ${activeWs === 'AI' || isAiOpen ? 'active' : ''}`}
          onClick={() => {
            cyberAudio.playModeSwitch();
            spatialNavStore.goToWorkspace('AI');
            onToggleAi();
          }}
          title="AI INVESTIGATION COPILOT [HotKey: A]"
        >
          <Brain size={12} color={activeWs === 'AI' || isAiOpen ? '#00f0ff' : 'currentColor'} />
          <span>AI COPILOT [A]</span>
        </button>

        <button
          className={`nav-pill ${isIntegrationOpen ? 'active' : ''}`}
          onClick={() => {
            cyberAudio.playModeSwitch();
            onToggleIntegration();
          }}
          title="EXTERNAL INTEGRATIONS & AIRGAPPED SEAMS [HotKey: I]"
        >
          <Cloud size={12} color={isIntegrationOpen ? '#00f0ff' : 'currentColor'} />
          <span>SEAMS [I]</span>
        </button>
      </div>
    </nav>
  );
}


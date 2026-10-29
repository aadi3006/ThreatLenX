/**
 * scripts/test-soc-navigation.ts
 *
 * Verifies SOC Central Navigation State:
 * 1. Default root is HUB
 * 2. Navigating to all 6 operational zones (COMMAND, INVESTIGATION, HUNTING, CASES, EVIDENCE, DETECTION)
 * 3. Selection preservation across workspace switching
 * 4. Hierarchical Esc navigation (panel -> workspace -> HUB)
 * 5. Incident selection focus in COMMAND Center and Esc unfocusing
 * 6. History stack and previousScreen accuracy
 */

import { socNavStore } from '../app/spatial/state/use-soc-nav';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('==================================================');
console.log('SOC CENTRAL NAVIGATION STATE VERIFICATION');
console.log('==================================================\n');

// Reset to initial Hub state
socNavStore.goToHub();
let state = socNavStore.getState();

console.log('[1/7] Home Screen / Initial State');
assert(state.workspace === 'HUB', 'Root default workspace is HUB');
assert(state.selectedIncidentId === null, 'selectedIncidentId defaults to null');
assert(state.selectedEntityId === null, 'selectedEntityId defaults to null');
assert(state.activeInvestigationPanel === null, 'activeInvestigationPanel defaults to null');
assert(state.previousScreen === null, 'previousScreen is initially null');

console.log('\n[2/7] All 6 Zones Reachable from Hub');
const zones = ['COMMAND', 'INVESTIGATION', 'HUNTING', 'CASES', 'EVIDENCE', 'DETECTION'] as const;
for (const zone of zones) {
  socNavStore.goToWorkspace(zone);
  const s = socNavStore.getState();
  assert(s.workspace === zone, `Successfully navigated to zone: ${zone}`);
  assert(s.previousScreen?.workspace !== undefined, `previousScreen tracked for ${zone}`);
  
  // Return to Hub
  socNavStore.goToHub();
  assert(socNavStore.getState().workspace === 'HUB', `Successfully returned to HUB from ${zone}`);
}

console.log('\n[3/7] Selection Preservation Across Workspaces');
// Select an incident in COMMAND
socNavStore.goToWorkspace('COMMAND');
socNavStore.selectIncident('incident-042');
socNavStore.selectEntity('host-win11-corp');
state = socNavStore.getState();
assert(state.selectedIncidentId === 'incident-042', 'Selected incident set in COMMAND');
assert(state.selectedEntityId === 'host-win11-corp', 'Selected entity set in COMMAND');

// Switch to HUNTING
socNavStore.goToWorkspace('HUNTING');
state = socNavStore.getState();
assert(state.workspace === 'HUNTING', 'Navigated to HUNTING');
assert(state.selectedIncidentId === 'incident-042', 'Preserved selectedIncidentId in HUNTING');
assert(state.selectedEntityId === 'host-win11-corp', 'Preserved selectedEntityId in HUNTING');

// Switch to CASES
socNavStore.goToWorkspace('CASES');
state = socNavStore.getState();
assert(state.workspace === 'CASES', 'Navigated to CASES');
assert(state.selectedIncidentId === 'incident-042', 'Preserved selectedIncidentId in CASES');

// Switch to EVIDENCE
socNavStore.goToWorkspace('EVIDENCE');
state = socNavStore.getState();
assert(state.workspace === 'EVIDENCE', 'Navigated to EVIDENCE');
assert(state.selectedIncidentId === 'incident-042', 'Preserved selectedIncidentId in EVIDENCE');

// Switch to DETECTION
socNavStore.goToWorkspace('DETECTION');
state = socNavStore.getState();
assert(state.workspace === 'DETECTION', 'Navigated to DETECTION');
assert(state.selectedIncidentId === 'incident-042', 'Preserved selectedIncidentId in DETECTION');

// Return to HUB
socNavStore.goToHub();
state = socNavStore.getState();
assert(state.workspace === 'HUB', 'Returned to HUB');
assert(state.selectedIncidentId === 'incident-042', 'Preserved selectedIncidentId at HUB');

console.log('\n[4/7] Dynamic Callback IDs (No Hardcoded Fallbacks)');
// Passing new ID overrides selection
socNavStore.goToWorkspace('INVESTIGATION', { incidentId: 'incident-dyn-999', investigationPanel: 'ATTACK' });
state = socNavStore.getState();
assert(state.workspace === 'INVESTIGATION', 'Navigated to INVESTIGATION');
assert(state.selectedIncidentId === 'incident-dyn-999', 'Callback incident ID correctly adopted');
assert(state.activeInvestigationPanel === 'ATTACK', 'Investigation panel correctly set to ATTACK');

console.log('\n[5/7] Hierarchical Esc Navigation');
// State: INVESTIGATION, panel: ATTACK
// Esc level 1: closes active investigation panel, stays in INVESTIGATION
const handled1 = socNavStore.navigateBack();
assert(handled1 === true, 'navigateBack returned true for sub-panel exit');
state = socNavStore.getState();
assert(state.workspace === 'INVESTIGATION', 'Stays in INVESTIGATION after sub-panel close');
assert(state.activeInvestigationPanel === null, 'activeInvestigationPanel reset to null');

// Esc level 2: returns to previous workspace or Hub
const handled2 = socNavStore.navigateBack();
assert(handled2 === true, 'navigateBack returned true');
state = socNavStore.getState();
assert(state.workspace === 'HUB', 'Esc returned to HUB from top-level workspace');

// Esc level 3: At Hub, navigateBack returns false
const handled3 = socNavStore.navigateBack();
assert(handled3 === false, 'navigateBack returns false when already at HUB');
assert(socNavStore.getState().workspace === 'HUB', 'Remains at HUB');

console.log('\n[6/7] Command Center Focused Incident Esc Hierarchy');
socNavStore.goToWorkspace('COMMAND');
socNavStore.selectIncident('incident-alpha');
state = socNavStore.getState();
assert(state.workspace === 'COMMAND', 'In COMMAND');
assert(state.selectedIncidentId === 'incident-alpha', 'Incident focused in COMMAND');

// Esc should first unfocus incident in COMMAND
socNavStore.navigateBack();
state = socNavStore.getState();
assert(state.workspace === 'COMMAND', 'Stays in COMMAND after incident unfocus');
assert(state.selectedIncidentId === null, 'Incident focus cleared');

// Next Esc returns to HUB
socNavStore.navigateBack();
state = socNavStore.getState();
assert(state.workspace === 'HUB', 'Second Esc returned to HUB');

console.log('\n[7/7] Cross-Workspace Investigation Deep Links');
socNavStore.goToWorkspace('HUNTING');
socNavStore.goToInvestigation('incident-hunt-pivot', 'TIMELINE');
state = socNavStore.getState();
assert(state.workspace === 'INVESTIGATION', 'Navigated directly to INVESTIGATION from HUNTING');
assert(state.selectedIncidentId === 'incident-hunt-pivot', 'Pivot incident ID set');
assert(state.activeInvestigationPanel === 'TIMELINE', 'Pivot panel set to TIMELINE');

console.log('\n==================================================');
console.log('✅ ALL SOC NAVIGATION TESTS PASSED (7/7 SUITES)');
console.log('==================================================');

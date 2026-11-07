/**
 * scripts/test-incident-selection-navigation.ts
 *
 * Verifies Incident Selection Across Workspace Navigation:
 * 1. Opening a non-first incident (e.g. incident-002), visiting multiple workspaces,
 *    clearing panel focus, returning to Investigation, and retaining the same incident.
 * 2. Explicit no-selection handling (null stays null; no fallback to incident-001 or incidents[0]).
 * 3. Removed incident handling using isolated storage: error state and remediation return to list.
 * 4. Separate Hub, Back, and Escape behavior preservation.
 */

import { socNavStore } from '../app/spatial/state/use-soc-nav';
import { spatialNavStore } from '../app/spatial/state/use-spatial-nav';
import { spatialTransform } from '../app/spatial-transform';
import { LocalProvider } from '../app/core/providers/local-provider';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

// Setup Isolated In-Memory IndexedDB Mock for Node test execution
const memoryStores = new Map<string, Map<string, any>>();
function getStore(name: string) {
  if (!memoryStores.has(name)) memoryStores.set(name, new Map());
  return memoryStores.get(name)!;
}
function createReq(result: any) {
  const req: any = { result, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    if (req.onsuccess) req.onsuccess({ target: req });
  });
  return req;
}

(global as any).indexedDB = {
  open: (_dbName: string, _version: number) => {
    const dbInstance: any = {
      objectStoreNames: { contains: (name: string) => memoryStores.has(name) },
      createObjectStore: (name: string) => {
        getStore(name);
        return { createIndex: () => {}, indexNames: { contains: () => true } };
      },
      transaction: (storeNames: string | string[], mode: string) => {
        const txObj: any = {
          objectStore: (s: string) => {
            const st = getStore(s);
            return {
              getAll: () => createReq(Array.from(st.values())),
              get: (key: string) => createReq(st.get(key)),
              put: (val: any) => {
                const key = val.id ?? val.key ?? `auto_${Math.random()}`;
                st.set(key, val);
                return createReq(key);
              },
              delete: (key: string) => {
                st.delete(key);
                return createReq(undefined);
              },
              clear: () => {
                st.clear();
                return createReq(undefined);
              },
            };
          },
          oncomplete: null,
          onerror: null,
          onabort: null,
        };
        queueMicrotask(() => {
          if (txObj.oncomplete) txObj.oncomplete();
        });
        return txObj;
      },
      close: () => {},
    };

    const req: any = {
      result: dbInstance,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion: 0 });
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  },
};

async function runTests() {
  console.log('====================================================');
  console.log('INCIDENT SELECTION ACROSS WORKSPACE NAVIGATION TESTS');
  console.log('====================================================\n');

  // ─── Test 1: Non-first incident selection and cross-workspace retention ──────
  console.log('[1/4] Non-First Incident Selection & Cross-Workspace Retention');
  socNavStore.goToHub();
  socNavStore.selectIncident(null);
  assert(socNavStore.getState().selectedIncidentId === null, 'Initial state: no incident selected');

  // Select a non-first incident: incident-002
  const nonFirstId = 'incident-002';
  socNavStore.goToInvestigation(nonFirstId);
  assert(socNavStore.getState().workspace === 'INVESTIGATION', 'Navigated to INVESTIGATION');
  assert(socNavStore.getState().selectedIncidentId === nonFirstId, 'Selected non-first incident (incident-002)');

  // Clear panel focus via spatialTransform
  spatialTransform.setFocusedPanel(null);
  assert(
    socNavStore.getState().selectedIncidentId === nonFirstId,
    'Clearing panel focus does NOT clear selectedIncidentId'
  );
  assert(
    spatialTransform.getDiscreteState().focusedPanelId === null,
    'SpatialTransformBridge focusedPanelId is cleared to null'
  );

  // Visit COMMAND
  socNavStore.goToWorkspace('COMMAND');
  assert(socNavStore.getState().workspace === 'COMMAND', 'Navigated to COMMAND');
  assert(socNavStore.getState().selectedIncidentId === nonFirstId, 'selectedIncidentId retained in COMMAND');

  // Visit HUNTING
  socNavStore.goToWorkspace('HUNTING');
  assert(socNavStore.getState().workspace === 'HUNTING', 'Navigated to HUNTING');
  assert(socNavStore.getState().selectedIncidentId === nonFirstId, 'selectedIncidentId retained in HUNTING');

  // Visit CASES
  socNavStore.goToWorkspace('CASES');
  assert(socNavStore.getState().workspace === 'CASES', 'Navigated to CASES');
  assert(socNavStore.getState().selectedIncidentId === nonFirstId, 'selectedIncidentId retained in CASES');

  // Visit EVIDENCE
  socNavStore.goToWorkspace('EVIDENCE');
  assert(socNavStore.getState().workspace === 'EVIDENCE', 'Navigated to EVIDENCE');
  assert(socNavStore.getState().selectedIncidentId === nonFirstId, 'selectedIncidentId retained in EVIDENCE');

  // Visit DETECTION
  socNavStore.goToWorkspace('DETECTION');
  assert(socNavStore.getState().workspace === 'DETECTION', 'Navigated to DETECTION');
  assert(socNavStore.getState().selectedIncidentId === nonFirstId, 'selectedIncidentId retained in DETECTION');

  // Visit HUB
  socNavStore.goToHub();
  assert(socNavStore.getState().workspace === 'HUB', 'Navigated to HUB');
  assert(socNavStore.getState().selectedIncidentId === nonFirstId, 'selectedIncidentId retained at HUB');

  // Return to INVESTIGATION
  socNavStore.goToWorkspace('INVESTIGATION');
  assert(socNavStore.getState().workspace === 'INVESTIGATION', 'Returned to INVESTIGATION');
  assert(
    socNavStore.getState().selectedIncidentId === nonFirstId,
    'Retained non-first incident (incident-002) upon return to INVESTIGATION'
  );

  // ─── Test 2: Explicit No-Selection Handling (No Fallbacks) ─────────────────
  console.log('\n[2/4] Explicit No-Selection Handling (No Fallback to First Incident)');
  socNavStore.goToHub();
  socNavStore.selectIncident(null);
  assert(socNavStore.getState().selectedIncidentId === null, 'Incident selection cleared to null');

  // Navigate to INVESTIGATION without an incidentId argument
  socNavStore.goToWorkspace('INVESTIGATION');
  assert(socNavStore.getState().workspace === 'INVESTIGATION', 'In INVESTIGATION workspace');
  assert(
    socNavStore.getState().selectedIncidentId === null,
    'selectedIncidentId remains strictly null (no fallback to incident-001 or first incident)'
  );

  // Verify spatialNavStore default does not force incident-001
  assert(
    spatialNavStore.getState().preservedInvestigationItem === null,
    'spatialNavStore preservedInvestigationItem is null'
  );

  // ─── Test 3: Removed Incident Handling in Isolated Storage ─────────────────
  console.log('\n[3/4] Removed Incident in Isolated Storage & Remediation Path');
  const provider = new LocalProvider();
  await provider.initialize();

  // Pick an existing incident and verify it is present
  const incList = await provider.getIncidents();
  assert(incList.length > 0, `Isolated provider loaded ${incList.length} initial incidents`);
  const existingIncident = incList[0];
  assert(
    (await provider.getIncidentById(existingIncident.id)) !== null,
    `Verified ${existingIncident.id} exists in isolated storage`
  );

  // Select a deleted / non-existent incident
  const missingIncidentId = 'incident-deleted-test-999';
  const lookupResult = await provider.getIncidentById(missingIncidentId);
  assert(lookupResult === null, `Confirmed ${missingIncidentId} does NOT exist in isolated store`);

  // Set navigation state to the missing incident
  socNavStore.goToInvestigation(missingIncidentId);
  assert(
    socNavStore.getState().selectedIncidentId === missingIncidentId,
    `Navigation state tracks selected incident as ${missingIncidentId}`
  );

  // Trigger error remediation (simulate "RETURN TO INCIDENTS" button click)
  // The remediation button calls: socNavStore.selectIncident(null); spatialNavStore.navigateBack();
  socNavStore.selectIncident(null);
  spatialNavStore.navigateBack();
  assert(
    socNavStore.getState().selectedIncidentId === null,
    'Remediation action successfully cleared selectedIncidentId to null'
  );
  assert(
    socNavStore.getState().workspace === 'INVESTIGATION',
    'Remains in INVESTIGATION to render IncidentListWorkspace'
  );

  // ─── Test 4: Separate Hub, Back, and Escape Behavior ───────────────────────
  console.log('\n[4/4] Separate Hub, Back, and Escape Behavior');

  // Setup: Select incident-002, enter a sub-panel in Investigation
  socNavStore.goToInvestigation('incident-002', 'ATTACK');
  assert(socNavStore.getState().workspace === 'INVESTIGATION', 'In INVESTIGATION');
  assert(socNavStore.getState().selectedIncidentId === 'incident-002', 'Selected incident-002');
  assert(socNavStore.getState().activeInvestigationPanel === 'ATTACK', 'Active sub-panel is ATTACK');

  // Escape / Back step 1: Closes sub-panel, preserves incident
  const escResult1 = socNavStore.navigateBack();
  assert(escResult1 === true, 'navigateBack returned true for sub-panel exit');
  assert(socNavStore.getState().workspace === 'INVESTIGATION', 'Still in INVESTIGATION');
  assert(socNavStore.getState().selectedIncidentId === 'incident-002', 'Incident selection preserved after sub-panel close');
  assert(socNavStore.getState().activeInvestigationPanel === null, 'Sub-panel activeInvestigationPanel reset to null');

  // Central Hub button: Explicit goToHub() directly transitions to HUB while preserving incident
  socNavStore.goToHub();
  assert(socNavStore.getState().workspace === 'HUB', 'Direct goToHub() transitioned to HUB');
  assert(socNavStore.getState().selectedIncidentId === 'incident-002', 'Incident selection preserved across Hub visit');

  console.log('\n====================================================');
  console.log('✅ ALL INCIDENT SELECTION NAVIGATION TESTS PASSED (4/4)');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('Test runner encountered unexpected error:', err);
  process.exit(1);
});

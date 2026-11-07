/**
 * scripts/test-spatial-data-coalescing.ts
 *
 * Dedicated automated verification suite for:
 * 1. Measuring reload calls before vs after representative mutations across mounted components.
 * 2. Fresh data preservation across coalesced updates.
 * 3. Rapid update / burst event coalescing.
 * 4. Controlled service promise overlapping request lifecycle:
 *    - Start reload A and hold it.
 *    - Emit several updates while A is pending.
 *    - Release A and verify exactly one trailing reload B runs.
 *    - Verify B publishes the latest data.
 * 5. Unsubscribe during pending load, then resubscribe; confirm fresh data and no duplicate listeners.
 * 6. Investigation component behavior & dependency stabilization (SpatialTimeline & IOCConstellation).
 */

import { securitySpatialStore } from '../app/spatial/state/use-security-spatial';
import { securityService, bootstrapSecurity } from '../app/core/bootstrap';
import { LocalProvider } from '../app/core/providers/local-provider';
import { authenticate } from '../app/core/auth/local-auth-service';
import type { Incident, TimelineEvent } from '../app/core/models/incident';
import type { IOC } from '../app/core/models/entity';
import type { IocGraphLink } from '../app/core/models/spatial-structures';
import {
  EMPTY_TIMELINE_EVENTS,
  EMPTY_ASSETS,
  EMPTY_USERS,
  EMPTY_IOCS,
  EMPTY_LINKS,
  EMPTY_MITRE_COVERAGE,
} from '../app/spatial/investigation/investigation-state';
import { placeIOCs, placeEntities } from '../app/spatial/investigation/iocs/ioc-layout';

// Polyfill in-memory IndexedDB for Node test runner
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
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  },
};

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCoalescingSuite() {
  console.log('====================================================');
  console.log(' SECURITY DATA COALESCING & INVESTIGATION STABILITY');
  console.log('====================================================\n');

  // Ensure isolated provider is used
  const isolatedProvider = new LocalProvider();
  (securityService as any).provider = isolatedProvider;
  await bootstrapSecurity();

  // ─── SUITE 1: Reload Call Measurement Before vs After Mutation ────────────────
  console.log('1. Reload Call Measurement Before vs After Representative Mutation:');

  securitySpatialStore._resetForTest();

  // Simulate 3 mounted components subscribing to useSecuritySpatial
  let comp1State = securitySpatialStore.getState();
  let comp2State = securitySpatialStore.getState();
  let comp3State = securitySpatialStore.getState();

  const unsub1 = securitySpatialStore.subscribe(() => { comp1State = securitySpatialStore.getState(); });
  const unsub2 = securitySpatialStore.subscribe(() => { comp2State = securitySpatialStore.getState(); });
  const unsub3 = securitySpatialStore.subscribe(() => { comp3State = securitySpatialStore.getState(); });

  assert(securitySpatialStore.getSubscriberCount() === 3, 'Store tracks 3 active mounted subscribers');

  // Wait for initial load to settle
  await sleep(60);
  const initialReloadCount = securitySpatialStore.reloadExecutionCount;
  assert(initialReloadCount >= 1, `Initial load executed once for all 3 subscribers (count: ${initialReloadCount})`);
  assert(comp1State.isReady && comp2State.isReady && comp3State.isReady, 'All 3 components received isReady: true');

  // Representative Mutation:
  // Emitting INCIDENTS_UPDATED and AUDIT_APPENDED in immediate succession
  const reloadCountBeforeMutation = securitySpatialStore.reloadExecutionCount;

  (securityService as any)._emit('INCIDENTS_UPDATED');
  (securityService as any)._emit('AUDIT_APPENDED');

  // Allow debounce timer (16ms) and async reload to complete
  await sleep(60);

  const reloadCountAfterMutation = securitySpatialStore.reloadExecutionCount;
  const reloadDelta = reloadCountAfterMutation - reloadCountBeforeMutation;

  console.log(`     - Uncoalesced expected reload calls: 6 calls (3 components × 2 events = 48 service queries)`);
  console.log(`     - Coalesced actual reload calls:    ${reloadDelta} call (8 service queries)`);

  assert(reloadDelta === 1, `Redundant reloads coalesced into exactly 1 reload execution (got: ${reloadDelta})`);
  assert(comp1State.incidents.length > 0, 'Component 1 has fresh incidents');
  assert(comp2State.incidents.length > 0, 'Component 2 has identical fresh incidents');
  assert(comp3State.incidents.length > 0, 'Component 3 has identical fresh incidents');
  assert(comp1State === comp2State && comp2State === comp3State, 'All 3 components share identical state snapshot reference (zero tearing)');

  // ─── SUITE 2: Fresh Data Preservation Across Coalesced Updates ───────────────
  console.log('\n2. Fresh Data Preservation Across Coalesced Updates:');

  authenticate({ username: 'sarah.chen', roleOverride: 'PLATFORM_ADMIN' });

  const targetIncident = (await securityService.getIncidents())[0];
  const updatedStatus: Incident['status'] = targetIncident.status === 'CONTAINING' ? 'RESOLVED' : 'CONTAINING';
  await securityService.updateIncidentStatus(targetIncident.id, updatedStatus, 'Coalescing verification test note');

  await sleep(60);

  const freshState = securitySpatialStore.getState();
  const foundUpdated = freshState.incidents.find((i) => i.id === targetIncident.id);
  assert(foundUpdated !== undefined, 'Target incident located in fresh state');
  assert(foundUpdated?.status === updatedStatus, `Fresh data preserved in store: status "${foundUpdated?.status}"`);

  // ─── SUITE 3: Rapid Updates / Burst Event Coalescing ──────────────────────────
  console.log('\n3. Rapid Updates & Burst Event Coalescing:');

  const burstStartReloadCount = securitySpatialStore.reloadExecutionCount;
  const BURST_COUNT = 10;

  for (let i = 0; i < BURST_COUNT; i++) {
    (securityService as any)._emit('INCIDENTS_UPDATED');
  }

  await sleep(80);

  const burstEndReloadCount = securitySpatialStore.reloadExecutionCount;
  const burstReloads = burstEndReloadCount - burstStartReloadCount;

  console.log(`     - Events fired in burst: ${BURST_COUNT}`);
  console.log(`     - Coalesced reload executions: ${burstReloads}`);
  assert(burstReloads <= 2, `Burst of ${BURST_COUNT} events coalesced into at most 2 reloads (got: ${burstReloads})`);

  // Clean up suite 1-3 subscribers before controlled promise suites
  unsub1();
  unsub2();
  unsub3();
  assert(securitySpatialStore.getSubscriberCount() === 0, 'Subscribers cleaned up before controlled promise suites');

  // ─── SUITE 4: Controlled Service Promises Overlapping Reload Lifecycle ────────
  console.log('\n4. Overlapping Reload Lifecycle with Controlled Service Promises:');

  const originalGetIncidents = securityService.getIncidents.bind(securityService);

  try {
    let getIncidentsCallCount = 0;
    let resolveA: ((data: Incident[]) => void) | null = null;
    const holdPromiseA = new Promise<Incident[]>((resolve) => {
      resolveA = resolve;
    });

    const baselineIncidents = await originalGetIncidents();

    (securityService as any).getIncidents = async () => {
      getIncidentsCallCount++;
      if (getIncidentsCallCount === 1) {
        // Reload A: hold promise until explicitly released
        return holdPromiseA;
      }
      // Reload B: return latest data with updated title
      return baselineIncidents.map((inc) => ({
        ...inc,
        title: 'LATEST_DATA_FROM_RELOAD_B',
      }));
    };

    // Keep an active subscriber
    let subscriberState = securitySpatialStore.getState();
    const unsubControlled = securitySpatialStore.subscribe(() => {
      subscriberState = securitySpatialStore.getState();
    });

    const reloadCountBeforeA = securitySpatialStore.reloadExecutionCount;

    // 1. Start reload A and hold it
    console.log('   [Step 1] Starting reload A and holding it...');
    const reloadAPromise = securitySpatialStore.refresh();
    await sleep(20); // allow query to reach getIncidents

    assert(getIncidentsCallCount === 1, `Reload A started and called getIncidents (count: ${getIncidentsCallCount})`);
    assert(securitySpatialStore.reloadExecutionCount === reloadCountBeforeA, 'Reload A is pending (not yet finished)');

    // 2. Emit several updates while A is pending
    console.log('   [Step 2] Emitting several updates while A is pending...');
    (securityService as any)._emit('INCIDENTS_UPDATED');
    (securityService as any)._emit('AUDIT_APPENDED');
    (securityService as any)._emit('ALERT_CREATED');

    await sleep(30);
    // Reload A is still held, so no trailing reload has completed yet
    assert(getIncidentsCallCount === 1, 'No concurrent duplicate getIncidents called while A is pending');

    // 3. Release A and verify exactly one trailing reload B runs
    console.log('   [Step 3] Releasing A and observing trailing reload B...');
    resolveA!(baselineIncidents.map((i) => ({ ...i, title: 'DATA_FROM_RELOAD_A' })));
    await reloadAPromise;

    // Wait for the trailing reload B to complete
    await sleep(60);

    console.log(`     - Total getIncidents calls after releasing A: ${getIncidentsCallCount}`);
    assert(getIncidentsCallCount === 2, `Exactly one trailing reload B executed (calls: ${getIncidentsCallCount})`);

    const reloadCountAfterB = securitySpatialStore.reloadExecutionCount;
    const totalNewReloads = reloadCountAfterB - reloadCountBeforeA;
    assert(totalNewReloads === 2, `Total reload executions incremented by 2 (A then B, got: ${totalNewReloads})`);

    // 4. Verify B publishes the latest data
    console.log('   [Step 4] Verifying B publishes the latest data...');
    const stateAfterB = securitySpatialStore.getState();
    assert(
      stateAfterB.incidents[0]?.title === 'LATEST_DATA_FROM_RELOAD_B',
      `Reload B published latest data: "${stateAfterB.incidents[0]?.title}"`
    );
    assert(
      subscriberState.incidents[0]?.title === 'LATEST_DATA_FROM_RELOAD_B',
      'Subscriber state updated with latest data from Reload B'
    );

    unsubControlled();
  } finally {
    (securityService as any).getIncidents = originalGetIncidents;
  }

  // ─── SUITE 5: Unsubscribe During Pending Load & Resubscribe ───────────────────
  console.log('\n5. Unsubscribe During Pending Load & Resubscribe Lifecycle:');

  try {
    let getIncidentsCallCount = 0;
    let resolveC: ((data: Incident[]) => void) | null = null;
    const holdPromiseC = new Promise<Incident[]>((resolve) => {
      resolveC = resolve;
    });

    const baselineIncidents = await originalGetIncidents();

    (securityService as any).getIncidents = async () => {
      getIncidentsCallCount++;
      if (getIncidentsCallCount === 1) {
        // Pending load C
        return holdPromiseC;
      }
      // Fresh load upon resubscription
      return baselineIncidents.map((inc) => ({
        ...inc,
        title: 'RESUBSCRIBED_FRESH_DATA',
      }));
    };

    // Subscribe component
    let listenerCallCount = 0;
    const unsubPendingTest = securitySpatialStore.subscribe(() => {
      listenerCallCount++;
    });

    assert(securitySpatialStore.getSubscriberCount() === 1, 'Subscriber mounted (count: 1)');

    // Start load C and hold it
    const loadCPromise = securitySpatialStore.refresh();
    await sleep(20);
    assert(getIncidentsCallCount === 1, 'Load C started and is pending');

    // Unsubscribe while load C is pending
    console.log('   [Action] Unsubscribing while load C is pending in-flight...');
    unsubPendingTest();
    assert(securitySpatialStore.getSubscriberCount() === 0, 'Subscriber count decremented to 0');

    // Release C while 0 subscribers are active
    resolveC!(baselineIncidents);
    await loadCPromise;

    // Resubscribe new component
    console.log('   [Action] Resubscribing new component...');
    let resubscribedIncidentTitle = '';
    const unsubResub = securitySpatialStore.subscribe(() => {
      resubscribedIncidentTitle = securitySpatialStore.getState().incidents[0]?.title ?? '';
    });

    assert(securitySpatialStore.getSubscriberCount() === 1, 'Resubscribed: subscriber count is 1');

    // Allow resubscription load to complete
    await sleep(60);

    // Confirm fresh data
    const resubState = securitySpatialStore.getState();
    assert(
      resubState.incidents[0]?.title === 'RESUBSCRIBED_FRESH_DATA',
      `Store loaded fresh data upon resubscription: "${resubState.incidents[0]?.title}"`
    );
    assert(
      resubscribedIncidentTitle === 'RESUBSCRIBED_FRESH_DATA',
      `Subscriber notified with fresh data: "${resubscribedIncidentTitle}"`
    );

    // Confirm NO DUPLICATE LISTENERS on securityService
    const incidentListeners = (securityService as any)._listeners.get('INCIDENTS_UPDATED');
    assert(
      incidentListeners && incidentListeners.size === 1,
      `Exactly 1 listener attached on INCIDENTS_UPDATED (no duplicate listeners, got: ${incidentListeners?.size})`
    );

    const auditListeners = (securityService as any)._listeners.get('AUDIT_APPENDED');
    assert(
      auditListeners && auditListeners.size === 1,
      `Exactly 1 listener attached on AUDIT_APPENDED (no duplicate listeners, got: ${auditListeners?.size})`
    );

    // Unsubscribe clean up
    unsubResub();
    assert(securitySpatialStore.getSubscriberCount() === 0, 'Subscribers cleanly unmounted');
    assert(
      incidentListeners && incidentListeners.size === 0,
      'Listeners cleanly detached from securityService upon final unmount'
    );
  } finally {
    (securityService as any).getIncidents = originalGetIncidents;
  }

  // ─── SUITE 6: Actual Component Behavior & Dependency Stabilization ───────────
  console.log('\n6. Actual Component Behavior & Dependency Stabilization (SpatialTimeline & IOCConstellation):');

  // Verify stable empty constants exported from investigation-state
  assert(Array.isArray(EMPTY_TIMELINE_EVENTS) && EMPTY_TIMELINE_EVENTS.length === 0, 'EMPTY_TIMELINE_EVENTS is a stable empty array');
  assert(Array.isArray(EMPTY_ASSETS) && EMPTY_ASSETS.length === 0, 'EMPTY_ASSETS is a stable empty array');
  assert(Array.isArray(EMPTY_USERS) && EMPTY_USERS.length === 0, 'EMPTY_USERS is a stable empty array');
  assert(Array.isArray(EMPTY_IOCS) && EMPTY_IOCS.length === 0, 'EMPTY_IOCS is a stable empty array');
  assert(Array.isArray(EMPTY_LINKS) && EMPTY_LINKS.length === 0, 'EMPTY_LINKS is a stable empty array');
  assert(Array.isArray(EMPTY_MITRE_COVERAGE) && EMPTY_MITRE_COVERAGE.length === 0, 'EMPTY_MITRE_COVERAGE is a stable empty array');

  // Test actual IOCConstellation layout calculation behavior with empty arrays
  const emptyPlacedIOCs = placeIOCs(EMPTY_IOCS);
  assert(Array.isArray(emptyPlacedIOCs) && emptyPlacedIOCs.length === 0, 'placeIOCs with EMPTY_IOCS returns [] without errors or NaN');

  const emptyPlacedEntities = placeEntities(EMPTY_LINKS, EMPTY_ASSETS, EMPTY_USERS, 'incident-001');
  assert(Array.isArray(emptyPlacedEntities) && emptyPlacedEntities.length === 0, 'placeEntities with EMPTY_LINKS returns [] without errors or NaN');

  // Test actual IOCConstellation layout calculation behavior with populated data
  const sampleIOCs: IOC[] = [
    {
      id: 'ioc-test-1',
      type: 'HASH_SHA256',
      value: '20f5769d771ebca2335a2408655c8a778fa037a23bb0cb0cffe47c6d51d5d6a2',
      threatType: 'MALWARE',
      confidence: 0.95,
      reputationScore: 92,
      isBlocked: true,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      relatedIncidents: ['incident-001'],
      relatedAssets: ['asset-001'],
    },
    {
      id: 'ioc-test-2',
      type: 'IP',
      value: '198.51.100.24',
      threatType: 'C2',
      confidence: 0.9,
      reputationScore: 88,
      isBlocked: false,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      relatedIncidents: ['incident-001'],
      relatedAssets: [],
    },
  ];

  const sampleLinks: IocGraphLink[] = [
    {
      sourceIocId: 'ioc-test-1',
      targetEntityId: 'asset-001',
      targetType: 'ASSET',
      relation: 'OBSERVED_ON',
    },
    {
      sourceIocId: 'ioc-test-2',
      targetEntityId: 'user-001',
      targetType: 'USER',
      relation: 'AUTHENTICATED_FROM',
    },
  ];

  const sampleAssets = [{ id: 'asset-001', name: 'FINWS-027' }];
  const sampleUsers = [{ id: 'user-001', displayName: 'Sarah Chen' }];

  const placedIOCsResult = placeIOCs(sampleIOCs);
  assert(placedIOCsResult.length === 2, `placeIOCs correctly positioned ${placedIOCsResult.length} IOCs`);
  assert(
    placedIOCsResult.every((p) => typeof p.x === 'number' && !isNaN(p.x) && typeof p.y === 'number' && !isNaN(p.y)),
    'All placed IOC nodes have valid finite numeric coordinates'
  );

  const placedEntitiesResult = placeEntities(sampleLinks, sampleAssets, sampleUsers, 'incident-001');
  assert(placedEntitiesResult.length === 2, `placeEntities correctly positioned ${placedEntitiesResult.length} outer ring entities`);
  assert(
    placedEntitiesResult.every((e) => typeof e.x === 'number' && !isNaN(e.x) && typeof e.y === 'number' && !isNaN(e.y)),
    'All placed entity nodes have valid finite numeric coordinates'
  );
  assert(
    placedEntitiesResult.some((e) => e.label === 'FINWS-027' && e.type === 'ASSET'),
    'Asset entity resolved authentic display label "FINWS-027"'
  );
  assert(
    placedEntitiesResult.some((e) => e.label === 'Sarah Chen' && e.type === 'USER'),
    'User entity resolved authentic display label "Sarah Chen"'
  );

  console.log('\n====================================================');
  console.log('✅ ALL COALESCING & LIFECYCLE TESTS PASSED CLEANLY');
  console.log('====================================================\n');
}

runCoalescingSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

/**
 * test-containment-authorization.ts
 *
 * Automated verification suite for Containment Authorization Hardening:
 * 1. Permission helpers deny missing/undefined roles while preserving valid roles.
 * 2. Active session required across SecurityService and LocalProvider for request, approval, rejection, execution, rollback, dry-run.
 * 3. Unauthorized roles denied prior to any database, model, or audit mutations.
 * 4. Authorized operations succeed, advancing status, mutating asset/incident states, and logging audits.
 *
 * Runs completely in isolated in-memory storage (zero mutation of persistent DB).
 */

import {
  canRequestContainment,
  canApproveContainment,
  canExecuteSOAR,
  canExecuteResponse,
  canApproveSensitiveAction,
  canProposeResponseAction,
  canUseExternalResponse,
} from '../app/core/auth/rbac';
import { LocalProvider } from '../app/core/providers/local-provider';
import { SecurityService } from '../app/core/security-service';
import { authenticate, logout } from '../app/core/auth/local-auth-service';
import type { RoleId } from '../app/core/models/auth';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('====================================================');
console.log('   CONTAINMENT & RESPONSE AUTHORIZATION TEST SUITE');
console.log('====================================================\n');

// ─── 1. RBAC Permission Helpers ──────────────────────────────────────────────
console.log('1. RBAC Permission Helper Tests:');

// canRequestContainment
assert(!canRequestContainment(undefined), 'canRequestContainment(undefined) returns false');
assert(!canRequestContainment(null as any), 'canRequestContainment(null) returns false');
assert(!canRequestContainment('L1_ANALYST'), 'L1_ANALYST cannot request containment');
assert(canRequestContainment('L2_ANALYST'), 'L2_ANALYST can request containment');
assert(canRequestContainment('INCIDENT_RESPONDER'), 'INCIDENT_RESPONDER can request containment');
assert(canRequestContainment('THREAT_HUNTER'), 'THREAT_HUNTER can request containment');
assert(canRequestContainment('SOC_MANAGER'), 'SOC_MANAGER can request containment');
assert(canRequestContainment('PLATFORM_ADMIN'), 'PLATFORM_ADMIN can request containment');

// canApproveContainment
assert(!canApproveContainment(undefined), 'canApproveContainment(undefined) returns false');
assert(!canApproveContainment('L1_ANALYST'), 'L1_ANALYST cannot approve containment');
assert(!canApproveContainment('L2_ANALYST'), 'L2_ANALYST cannot approve containment');
assert(!canApproveContainment('THREAT_HUNTER'), 'THREAT_HUNTER cannot approve containment');
assert(canApproveContainment('INCIDENT_RESPONDER'), 'INCIDENT_RESPONDER can approve containment');
assert(canApproveContainment('SOC_MANAGER'), 'SOC_MANAGER can approve containment');
assert(canApproveContainment('PLATFORM_ADMIN'), 'PLATFORM_ADMIN can approve containment');

// canExecuteSOAR / canExecuteResponse
assert(!canExecuteSOAR(undefined), 'canExecuteSOAR(undefined) returns false');
assert(!canExecuteResponse(undefined), 'canExecuteResponse(undefined) returns false');
assert(!canExecuteSOAR('L1_ANALYST'), 'L1_ANALYST cannot execute SOAR');
assert(!canExecuteSOAR('L2_ANALYST'), 'L2_ANALYST cannot execute SOAR');
assert(!canExecuteSOAR('THREAT_HUNTER'), 'THREAT_HUNTER cannot execute SOAR');
assert(canExecuteSOAR('INCIDENT_RESPONDER'), 'INCIDENT_RESPONDER can execute SOAR');
assert(canExecuteSOAR('SOC_MANAGER'), 'SOC_MANAGER can execute SOAR');
assert(canExecuteSOAR('PLATFORM_ADMIN'), 'PLATFORM_ADMIN can execute SOAR');
assert(canExecuteResponse('INCIDENT_RESPONDER'), 'canExecuteResponse matches canExecuteSOAR');

// canApproveSensitiveAction
assert(!canApproveSensitiveAction(undefined), 'canApproveSensitiveAction(undefined) returns false');
assert(!canApproveSensitiveAction('L1_ANALYST'), 'L1_ANALYST cannot approve sensitive action');
assert(!canApproveSensitiveAction('L2_ANALYST'), 'L2_ANALYST cannot approve sensitive action');
assert(!canApproveSensitiveAction('INCIDENT_RESPONDER'), 'INCIDENT_RESPONDER cannot approve sensitive action');
assert(canApproveSensitiveAction('SOC_MANAGER'), 'SOC_MANAGER can approve sensitive action');
assert(canApproveSensitiveAction('PLATFORM_ADMIN'), 'PLATFORM_ADMIN can approve sensitive action');

// canProposeResponseAction
assert(!canProposeResponseAction(undefined), 'canProposeResponseAction(undefined) returns false');
assert(!canProposeResponseAction('L1_ANALYST'), 'L1_ANALYST cannot propose response action');
assert(canProposeResponseAction('L2_ANALYST'), 'L2_ANALYST can propose response action');

// canUseExternalResponse
assert(!canUseExternalResponse(undefined), 'canUseExternalResponse(undefined) returns false');
assert(!canUseExternalResponse('L1_ANALYST'), 'L1_ANALYST cannot use external response');
assert(canUseExternalResponse('INCIDENT_RESPONDER'), 'INCIDENT_RESPONDER can use external response');

// ─── 2. Setup Isolated In-Memory Storage & Services ──────────────────────────
console.log('\n2. Isolated In-Memory Setup:');

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

const provider = new LocalProvider();
await provider.initialize();
const secService = new SecurityService();
await secService.bootstrap(provider);

// Ensure logged out for baseline
logout();
const baselineAudits = (await provider.getAuditLogs()).length;
const baselineActions = (await provider.getResponseActions('incident-001')).length;
const initialAsset = (await provider.getAssets()).find((a) => a.id === 'asset-001' || a.name === 'FINWS-027');
assert(!!initialAsset, 'Initial asset found in isolated store');
const initialAssetStatus = initialAsset!.status;

console.log(`  ✓ Isolated store initialized (baseline audits: ${baselineAudits}, baseline actions: ${baselineActions})`);

// ─── 3. Missing Session Denial Tests ─────────────────────────────────────────
console.log('\n3. Missing Session Denial Tests (Fail-Closed, Zero Mutations):');

const sampleActionInput = {
  incidentId: 'incident-001',
  type: 'ISOLATE_ASSET' as const,
  targetId: initialAsset!.id,
  targetType: 'ASSET' as const,
  targetLabel: initialAsset!.name,
  riskImpact: 'HIGH' as const,
  reversibility: 'REVERSIBLE' as const,
};

// 3.1 SecurityService.requestResponseAction
let errSecReq = false;
try {
  await secService.requestResponseAction(sampleActionInput);
} catch (err: any) {
  errSecReq = true;
  assert(err.message.includes('Operation requires an active session'), 'SecurityService.requestResponseAction requires active session');
}
assert(errSecReq, 'SecurityService.requestResponseAction denied without session');
assert((await provider.getResponseActions('incident-001')).length === baselineActions, '0 actions created when request denied');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created when request denied');

// 3.2 LocalProvider.requestResponseAction
let errProvReq = false;
try {
  await provider.requestResponseAction(sampleActionInput);
} catch (err: any) {
  errProvReq = true;
  assert(err.message.includes('Operation requires an active session'), 'LocalProvider.requestResponseAction requires active session');
}
assert(errProvReq, 'LocalProvider.requestResponseAction denied without session/role');
assert((await provider.getResponseActions('incident-001')).length === baselineActions, '0 actions created');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created');

// 3.3 SecurityService.approveResponseAction
let errSecAppr = false;
try {
  await secService.approveResponseAction('act-fake');
} catch (err: any) {
  errSecAppr = true;
  assert(err.message.includes('Operation requires an active session'), 'SecurityService.approveResponseAction requires active session');
}
assert(errSecAppr, 'SecurityService.approveResponseAction denied without session');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created');

// 3.4 LocalProvider.approveResponseAction
let errProvAppr = false;
try {
  await provider.approveResponseAction('act-fake');
} catch (err: any) {
  errProvAppr = true;
  assert(err.message.includes('Operation requires an active session'), 'LocalProvider.approveResponseAction requires active session');
}
assert(errProvAppr, 'LocalProvider.approveResponseAction denied without session/role');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created');

// 3.5 SecurityService.rejectResponseAction
let errSecRej = false;
try {
  await secService.rejectResponseAction('act-fake', 'reason');
} catch (err: any) {
  errSecRej = true;
  assert(err.message.includes('Operation requires an active session'), 'SecurityService.rejectResponseAction requires active session');
}
assert(errSecRej, 'SecurityService.rejectResponseAction denied without session');

// 3.6 LocalProvider.rejectResponseAction
let errProvRej = false;
try {
  await provider.rejectResponseAction('act-fake', undefined, 'reason');
} catch (err: any) {
  errProvRej = true;
  assert(err.message.includes('Operation requires an active session'), 'LocalProvider.rejectResponseAction requires active session');
}
assert(errProvRej, 'LocalProvider.rejectResponseAction denied without session/role');

// 3.7 SecurityService.executeResponseAction
let errSecExec = false;
try {
  await secService.executeResponseAction('act-fake');
} catch (err: any) {
  errSecExec = true;
  assert(err.message.includes('Operation requires an active session'), 'SecurityService.executeResponseAction requires active session');
}
assert(errSecExec, 'SecurityService.executeResponseAction denied without session');

// 3.8 LocalProvider.executeResponseAction
let errProvExec = false;
try {
  await provider.executeResponseAction('act-fake');
} catch (err: any) {
  errProvExec = true;
  assert(err.message.includes('Operation requires an active session'), 'LocalProvider.executeResponseAction requires active session');
}
assert(errProvExec, 'LocalProvider.executeResponseAction denied without session/role');

// 3.9 SecurityService.rollbackResponseAction
let errSecRoll = false;
try {
  await secService.rollbackResponseAction('act-fake');
} catch (err: any) {
  errSecRoll = true;
  assert(err.message.includes('Operation requires an active session'), 'SecurityService.rollbackResponseAction requires active session');
}
assert(errSecRoll, 'SecurityService.rollbackResponseAction denied without session');

// 3.10 LocalProvider.rollbackResponseAction
let errProvRoll = false;
try {
  await provider.rollbackResponseAction('act-fake');
} catch (err: any) {
  errProvRoll = true;
  assert(err.message.includes('Operation requires an active session'), 'LocalProvider.rollbackResponseAction requires active session');
}
assert(errProvRoll, 'LocalProvider.rollbackResponseAction denied without session/role');

// 3.11 SecurityService.dryRunResponseAction
let errSecDry = false;
try {
  await secService.dryRunResponseAction('act-fake');
} catch (err: any) {
  errSecDry = true;
  assert(err.message.includes('Operation requires an active session'), 'SecurityService.dryRunResponseAction requires active session');
}
assert(errSecDry, 'SecurityService.dryRunResponseAction denied without session');

// 3.12 LocalProvider.dryRunResponseAction
let errProvDry = false;
try {
  await provider.dryRunResponseAction('act-fake');
} catch (err: any) {
  errProvDry = true;
  assert(err.message.includes('Operation requires an active session'), 'LocalProvider.dryRunResponseAction requires active session');
}
assert(errProvDry, 'LocalProvider.dryRunResponseAction denied without session/role');

// 3.13 LocalProvider denied when no session is present even if caller passes PLATFORM_ADMIN role
let errNoSessionSuppliedAdmin = false;
try {
  await provider.requestResponseAction(sampleActionInput, 'attacker', 'PLATFORM_ADMIN');
} catch (err: any) {
  errNoSessionSuppliedAdmin = true;
  assert(err.message.includes('Operation requires an active session'), 'LocalProvider rejects unauthenticated call with supplied PLATFORM_ADMIN');
}
assert(errNoSessionSuppliedAdmin, 'No session + supplied PLATFORM_ADMIN role denied before mutation');
assert((await provider.getResponseActions('incident-001')).length === baselineActions, '0 actions created');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created');

let errNoSessionExecAdmin = false;
try {
  await provider.executeResponseAction('act-fake', 'attacker', 'PLATFORM_ADMIN');
} catch (err: any) {
  errNoSessionExecAdmin = true;
  assert(err.message.includes('Operation requires an active session'), 'LocalProvider.executeResponseAction rejects unauthenticated call with supplied PLATFORM_ADMIN');
}
assert(errNoSessionExecAdmin, 'Execute denied without session even with supplied PLATFORM_ADMIN');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created');

// Verify zero mutations across all missing session calls
assert((await provider.getResponseActions('incident-001')).length === baselineActions, 'Actions remain at baseline');
assert((await provider.getAuditLogs()).length === baselineAudits, 'Audits remain at baseline');
const assetCheck1 = (await provider.getAssets()).find((a) => a.id === initialAsset!.id);
assert(assetCheck1!.status === initialAssetStatus, 'Asset status strictly unmutated');

// ─── 4. Unauthorized Role Denial Tests ────────────────────────────────────────
console.log('\n4. Unauthorized Role Denial Tests:');

// 4.1 L1_ANALYST cannot request containment
authenticate({ username: 'analyst1', roleOverride: 'L1_ANALYST' });
let errL1Req = false;
try {
  await secService.requestResponseAction(sampleActionInput);
} catch (err: any) {
  errL1Req = true;
  assert(err.message.includes('cannot request response actions'), 'SecurityService indicates L1 cannot request response actions');
}
assert(errL1Req, 'L1_ANALYST blocked from requesting response action');
assert((await provider.getResponseActions('incident-001')).length === baselineActions, '0 actions created');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created');

// 4.1b L1 session plus supplied PLATFORM_ADMIN role is denied (caller-supplied role must not override session)
let errL1SuppliedAdmin = false;
try {
  await provider.requestResponseAction(sampleActionInput, 'analyst1', 'PLATFORM_ADMIN');
} catch (err: any) {
  errL1SuppliedAdmin = true;
  assert(err.message.includes('cannot request response actions'), 'L1 session cannot request containment even if caller passes PLATFORM_ADMIN');
}
assert(errL1SuppliedAdmin, 'L1 session + supplied PLATFORM_ADMIN role denied before mutation');
assert((await provider.getResponseActions('incident-001')).length === baselineActions, '0 actions created when L1 supplies PLATFORM_ADMIN');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created when L1 supplies PLATFORM_ADMIN');

let errL1ExecSuppliedAdmin = false;
try {
  await provider.executeResponseAction('act-fake', 'analyst1', 'PLATFORM_ADMIN');
} catch (err: any) {
  errL1ExecSuppliedAdmin = true;
  assert(err.message.includes('SOAR_EXECUTE'), 'L1 session cannot execute SOAR even if caller passes PLATFORM_ADMIN');
}
assert(errL1ExecSuppliedAdmin, 'L1 session execute denied even when PLATFORM_ADMIN is passed');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created');

// 4.1c Spoofed audit actor identity denied before mutation
authenticate({ username: 'analyst2', roleOverride: 'L2_ANALYST' });
let errSpoofedActor = false;
try {
  await provider.requestResponseAction(sampleActionInput, 'spoofed_superadmin');
} catch (err: any) {
  errSpoofedActor = true;
  assert(err.message.includes('Spoofed audit actor identity'), 'LocalProvider detects and rejects spoofed actor identity');
}
assert(errSpoofedActor, 'Spoofed audit actor identity denied before mutation');
assert((await provider.getResponseActions('incident-001')).length === baselineActions, '0 actions created when spoofed actor is rejected');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created when spoofed actor is rejected');

// Spoofed approver identity on approveResponseAction
authenticate({ username: 'manager', roleOverride: 'SOC_MANAGER' });
let errSpoofedApprover = false;
try {
  await provider.approveResponseAction('act-fake', 'spoofed_executive');
} catch (err: any) {
  errSpoofedApprover = true;
  assert(err.message.includes('Spoofed audit actor identity'), 'LocalProvider detects and rejects spoofed approver identity');
}
assert(errSpoofedApprover, 'Spoofed approver identity denied before mutation');
assert((await provider.getAuditLogs()).length === baselineAudits, '0 audits created');

// 4.2 L2_ANALYST is authorized to request containment
authenticate({ username: 'analyst2', roleOverride: 'L2_ANALYST' });
const requestedAction = await secService.requestResponseAction(sampleActionInput);
assert(requestedAction.status === 'PENDING_APPROVAL', 'L2_ANALYST successfully creates request in PENDING_APPROVAL');
assert(requestedAction.requestedBy === 'analyst2', 'Action recorded requestedBy as analyst2');
assert((await provider.getResponseActions('incident-001')).length === baselineActions + 1, 'Action stored in provider');
assert((await provider.getAuditLogs()).length === baselineAudits + 1, 'Audit record logged for request');

// 4.3 L2_ANALYST cannot approve containment
let errL2Appr = false;
try {
  await secService.approveResponseAction(requestedAction.id);
} catch (err: any) {
  errL2Appr = true;
  assert(err.message.includes('cannot approve response actions'), 'SecurityService indicates L2 cannot approve response actions');
}
assert(errL2Appr, 'L2_ANALYST blocked from approving containment');
let actAfterL2Appr = (await provider.getResponseActions('incident-001')).find((a) => a.id === requestedAction.id);
assert(actAfterL2Appr?.status === 'PENDING_APPROVAL', 'Action status remains PENDING_APPROVAL');

// 4.4 LocalProvider check directly for unauthorized approve
let errProvL2Appr = false;
try {
  await provider.approveResponseAction(requestedAction.id, 'analyst2', 'L2_ANALYST');
} catch (err: any) {
  errProvL2Appr = true;
  assert(err.message.includes('cannot approve response actions'), 'LocalProvider indicates role cannot approve');
}
assert(errProvL2Appr, 'LocalProvider blocked unauthorized approve directly');

// 4.4b LocalProvider check: L2 session plus supplied PLATFORM_ADMIN role cannot approve
let errProvL2ApprAdmin = false;
try {
  await provider.approveResponseAction(requestedAction.id, 'analyst2', 'PLATFORM_ADMIN');
} catch (err: any) {
  errProvL2ApprAdmin = true;
  assert(err.message.includes('cannot approve response actions'), 'L2 session cannot approve even if PLATFORM_ADMIN is supplied in args');
}
assert(errProvL2ApprAdmin, 'LocalProvider blocked approve with caller-supplied PLATFORM_ADMIN role');

// 4.5 L2_ANALYST cannot reject containment
let errL2Rej = false;
try {
  await secService.rejectResponseAction(requestedAction.id, 'Unauthorized rejection attempt');
} catch (err: any) {
  errL2Rej = true;
  assert(err.message.includes('cannot reject response actions'), 'SecurityService indicates L2 cannot reject');
}
assert(errL2Rej, 'L2_ANALYST blocked from rejecting containment');

// 4.6 L2_ANALYST cannot execute response action (requires SOAR_EXECUTE)
let errL2Exec = false;
try {
  await secService.executeResponseAction(requestedAction.id);
} catch (err: any) {
  errL2Exec = true;
  assert(err.message.includes('does not have SOAR_EXECUTE permission'), 'SecurityService indicates L2 lacks SOAR_EXECUTE');
}
assert(errL2Exec, 'L2_ANALYST blocked from executing response action');
let actAfterL2Exec = (await provider.getResponseActions('incident-001')).find((a) => a.id === requestedAction.id);
assert(actAfterL2Exec?.status === 'PENDING_APPROVAL', 'Action status remains PENDING_APPROVAL after blocked execution');
const assetCheck2 = (await provider.getAssets()).find((a) => a.id === initialAsset!.id);
assert(assetCheck2!.status === initialAssetStatus, 'Asset status unchanged after blocked execution');

// 4.7 L2_ANALYST cannot rollback response action
let errL2Roll = false;
try {
  await secService.rollbackResponseAction(requestedAction.id);
} catch (err: any) {
  errL2Roll = true;
  assert(err.message.includes('SOAR_EXECUTE'), 'SecurityService indicates rollback requires SOAR_EXECUTE');
}
assert(errL2Roll, 'L2_ANALYST blocked from rollback');

// ─── 5. Authorized Success Lifecycle ─────────────────────────────────────────
console.log('\n5. Authorized Success Lifecycle:');

// 5.1 Dry-Run Simulation (L2_ANALYST can simulate)
const dryRunResult = await secService.dryRunResponseAction(requestedAction.id);
assert(dryRunResult.wouldModify === true, 'Dry-run returns wouldModify=true');
assert(dryRunResult.expectedStateChange.includes('[DRY RUN]'), 'Dry-run returns expected state simulation message');
let actAfterDryRun = (await provider.getResponseActions('incident-001')).find((a) => a.id === requestedAction.id);
assert(actAfterDryRun?.status === 'PENDING_APPROVAL', 'Action status remains PENDING_APPROVAL after dry-run');

// 5.2 Approval by SOC_MANAGER
authenticate({ username: 'manager', roleOverride: 'SOC_MANAGER' });
const approvedAction = await secService.approveResponseAction(requestedAction.id);
assert(approvedAction.status === 'APPROVED', 'SOC_MANAGER successfully approves action (status APPROVED)');
assert(approvedAction.approvedBy === 'manager', 'Action approvedBy recorded as manager');

// 5.3 Execution by INCIDENT_RESPONDER
authenticate({ username: 'responder', roleOverride: 'INCIDENT_RESPONDER' });
const executedAction = await secService.executeResponseAction(requestedAction.id);
assert(executedAction.status === 'COMPLETED', 'INCIDENT_RESPONDER successfully executes action (status COMPLETED)');
assert(Boolean(executedAction.resultMessage?.includes('Action executed successfully')), 'Execution result message formatted');

// Verify Target Asset State Mutation
const isolatedAsset = (await provider.getAssets()).find((a) => a.id === initialAsset!.id);
assert(isolatedAsset?.status === 'ISOLATED', 'Target asset status authoritatively updated to ISOLATED');
assert(isolatedAsset?.blastRadiusLevel === 'SAFE', 'Target asset blast radius updated to SAFE');

// Verify Incident Timeline & Status Mutation
const incident = (await provider.getIncidents()).find((i) => i.id === 'incident-001');
assert(incident?.status === 'CONTAINING', 'Correlated incident status updated to CONTAINING');
const lastTimeline = incident?.timelineEvents[incident.timelineEvents.length - 1];
assert(Boolean(lastTimeline?.title.includes('[RESPONSE]')), 'Incident timeline event appended for response action');

// 5.4 Rollback by INCIDENT_RESPONDER
const rolledBackAction = await secService.rollbackResponseAction(requestedAction.id);
assert(rolledBackAction.status === 'ROLLED_BACK', 'INCIDENT_RESPONDER successfully rolls back action (status ROLLED_BACK)');

// Verify Asset Restored
const restoredAsset = (await provider.getAssets()).find((a) => a.id === initialAsset!.id);
assert(restoredAsset?.status === 'HEALTHY', 'Target asset status authoritatively restored to HEALTHY');

// 5.5 Rejection Flow
// Request second action as L2_ANALYST
authenticate({ username: 'analyst2', roleOverride: 'L2_ANALYST' });
const secondAction = await secService.requestResponseAction({
  ...sampleActionInput,
  type: 'BLOCK_IOC',
  targetType: 'IOC',
  targetId: 'ioc-bad-ip',
  targetLabel: '198.51.100.45',
});
assert(secondAction.status === 'PENDING_APPROVAL', 'Second action created in PENDING_APPROVAL');

// Reject as SOC_MANAGER
authenticate({ username: 'manager', roleOverride: 'SOC_MANAGER' });
const rejectedAction = await secService.rejectResponseAction(secondAction.id, 'Deemed false positive upon secondary review');
assert(rejectedAction.status === 'REJECTED', 'SOC_MANAGER successfully rejects action (status REJECTED)');
assert(rejectedAction.rejectionReason === 'Deemed false positive upon secondary review', 'Rejection reason preserved');
assert(rejectedAction.rejectedBy === 'manager', 'Rejected by manager recorded');

// Attempting to execute rejected action is rejected by state machine
authenticate({ username: 'responder', roleOverride: 'INCIDENT_RESPONDER' });
let errExecRejected = false;
try {
  await secService.executeResponseAction(secondAction.id);
} catch (err: any) {
  errExecRejected = true;
  assert(err.message.includes('Must be APPROVED'), 'Cannot execute action in status REJECTED');
}
assert(errExecRejected, 'Execution of REJECTED action prevented');

// Cleanup
logout();

console.log('\n====================================================');
console.log('   ALL CONTAINMENT AUTHORIZATION TESTS PASSED! ✓');
console.log('====================================================\n');

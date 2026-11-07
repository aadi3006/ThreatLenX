/**
 * test-cases-detection-authorization.ts
 *
 * Dedicated verification suite for Cases and Detection Engineering authorization hardening:
 * 1. RBAC permission helpers enforce fail-closed behavior on undefined/missing roles.
 * 2. Active session required across SecurityService and LocalProvider for all mutation operations.
 * 3. Unauthorized roles denied prior to any database, model, or audit mutations.
 * 4. Caller-supplied role spoofing prevented (privilege derived strictly from active session).
 * 5. Spoofed audit actor identity rejected before mutations.
 * 6. Authorized operations succeed with state transitions and authentic audit trails.
 * 7. Authorized read access preserved across all valid roles.
 *
 * Runs completely in isolated in-memory storage (zero mutation of persistent DB).
 */

import {
  canReadDetectionRules,
  canTestDetectionRules,
  canAuthorDetectionRules,
  canManageDetectionRules,
  canReadCases,
  canCreateCase,
  canUpdateCase,
  canManageCase,
} from '../app/core/auth/rbac';
import { LocalProvider } from '../app/core/providers/local-provider';
import { SecurityService } from '../app/core/security-service';
import { authenticate, logout } from '../app/core/auth/local-auth-service';
import type { RoleId } from '../app/core/models/auth';
import type { CreateDetectionRuleInput, UpdateDetectionRuleInput } from '../app/core/models/detection';
import type { CreateCaseInput, UpdateCaseInput } from '../app/core/models/case';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('====================================================');
console.log(' CASES & DETECTION AUTHORIZATION TEST SUITE');
console.log('====================================================\n');

// ─── 1. RBAC Permission Helpers (Fail-Closed & Matrix) ──────────────────────────
console.log('1. RBAC Permission Helpers (Fail-Closed & Canonical Matrix):');

// Missing/undefined roles return false
assert(!canReadDetectionRules(undefined), 'canReadDetectionRules(undefined) returns false');
assert(!canReadDetectionRules(null as any), 'canReadDetectionRules(null) returns false');
assert(!canTestDetectionRules(undefined), 'canTestDetectionRules(undefined) returns false');
assert(!canAuthorDetectionRules(undefined), 'canAuthorDetectionRules(undefined) returns false');
assert(!canManageDetectionRules(undefined), 'canManageDetectionRules(undefined) returns false');

assert(!canReadCases(undefined), 'canReadCases(undefined) returns false');
assert(!canReadCases(null as any), 'canReadCases(null) returns false');
assert(!canCreateCase(undefined), 'canCreateCase(undefined) returns false');
assert(!canUpdateCase(undefined), 'canUpdateCase(undefined) returns false');
assert(!canManageCase(undefined), 'canManageCase(undefined) returns false');

// Detection matrix checks
assert(canReadDetectionRules('L1_ANALYST'), 'L1 can read detection rules');
assert(canTestDetectionRules('L1_ANALYST'), 'L1 can test detection rules');
assert(!canAuthorDetectionRules('L1_ANALYST'), 'L1 cannot author detection rules');
assert(!canManageDetectionRules('L1_ANALYST'), 'L1 cannot manage detection rules');

assert(canAuthorDetectionRules('L2_ANALYST'), 'L2 can author detection rules');
assert(!canManageDetectionRules('L2_ANALYST'), 'L2 cannot manage detection rules');

assert(!canAuthorDetectionRules('INCIDENT_RESPONDER'), 'Responder cannot author detection rules');
assert(!canManageDetectionRules('INCIDENT_RESPONDER'), 'Responder cannot manage detection rules');

assert(canAuthorDetectionRules('THREAT_HUNTER'), 'Hunter can author detection rules');
assert(canManageDetectionRules('THREAT_HUNTER'), 'Hunter can manage detection rules');

assert(canAuthorDetectionRules('SOC_MANAGER'), 'Manager can author detection rules');
assert(canManageDetectionRules('SOC_MANAGER'), 'Manager can manage detection rules');

assert(canAuthorDetectionRules('PLATFORM_ADMIN'), 'Admin can author detection rules');
assert(canManageDetectionRules('PLATFORM_ADMIN'), 'Admin can manage detection rules');

// Cases matrix checks
assert(canReadCases('L1_ANALYST'), 'L1 can read cases');
assert(canCreateCase('L1_ANALYST'), 'L1 can create cases');
assert(canUpdateCase('L1_ANALYST'), 'L1 can update cases');
assert(!canManageCase('L1_ANALYST'), 'L1 cannot manage cases');

assert(canReadCases('INCIDENT_RESPONDER'), 'Responder can read cases');
assert(!canCreateCase('INCIDENT_RESPONDER'), 'Responder cannot create cases');
assert(canUpdateCase('INCIDENT_RESPONDER'), 'Responder can update cases');
assert(!canManageCase('INCIDENT_RESPONDER'), 'Responder cannot manage cases');

assert(canCreateCase('THREAT_HUNTER'), 'Hunter can create cases');
assert(!canManageCase('THREAT_HUNTER'), 'Hunter cannot manage cases');

assert(canCreateCase('SOC_MANAGER'), 'Manager can create cases');
assert(canManageCase('SOC_MANAGER'), 'Manager can manage cases');

assert(canCreateCase('PLATFORM_ADMIN'), 'Admin can create cases');
assert(canManageCase('PLATFORM_ADMIN'), 'Admin can manage cases');

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
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  },
};

async function runAuthorizationTests() {
  const provider = new LocalProvider();
  await provider.initialize();
  const secService = new SecurityService();
  await secService.bootstrap(provider);

  const baselineRules = (await provider.getDetectionRules()).length;
  const baselineCases = (await provider.getCases()).length;
  const baselineAudits = (await provider.getAuditLogs()).length;

  console.log(`Baseline counts - Rules: ${baselineRules}, Cases: ${baselineCases}, Audits: ${baselineAudits}`);

  const sampleRuleInput: CreateDetectionRuleInput = {
    name: 'Auth Test Discovery Rule',
    description: 'Detection rule for authorization verification testing',
    severity: 'MEDIUM',
    category: 'PROCESS',
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'PROCESS' },
      { field: 'processName', operator: 'EQUALS', value: 'whoami.exe' },
    ],
  };

  const sampleCaseInput: CreateCaseInput = {
    title: 'Auth Test Incident Case',
    description: 'Case for authorization verification testing',
    priority: 'MEDIUM',
    severity: 'MEDIUM',
  };

  // ─── 3. Missing Session Denial Tests ─────────────────────────────────────────
  console.log('\n3. Missing Session Denial Tests:');
  logout();

  // 3.1 SecurityService missing session checks
  const secServiceChecks: [string, () => Promise<any>][] = [
    ['createCase', () => secService.createCase(sampleCaseInput)],
    ['updateCase', () => secService.updateCase('case-blacktide-001', { priority: 'HIGH' })],
    ['assignCase', () => secService.assignCase('case-blacktide-001', 'analyst1')],
    ['unassignCase', () => secService.unassignCase('case-blacktide-001')],
    ['changeCasePriority', () => secService.changeCasePriority('case-blacktide-001', 'HIGH')],
    ['changeCaseStatus', () => secService.changeCaseStatus('case-blacktide-001', 'RESOLVED')],
    ['resolveCase', () => secService.resolveCase('case-blacktide-001', 'Test resolution')],
    ['closeCase', () => secService.closeCase('case-blacktide-001', 'Test closure')],
    ['reopenCase', () => secService.reopenCase('case-blacktide-001', 'Test reopen')],
    ['addCaseNote', () => secService.addCaseNote('case-blacktide-001', { content: 'Test note' })],
    ['updateCaseNote', () => secService.updateCaseNote('case-blacktide-001', 'note-001', { content: 'Updated' })],
    ['addCaseTask', () => secService.addCaseTask('case-blacktide-001', { title: 'Test task' })],
    ['updateCaseTask', () => secService.updateCaseTask('case-blacktide-001', 'task-001', { status: 'DONE' })],
    ['addCaseFinding', () => secService.addCaseFinding('case-blacktide-001', { title: 'Test finding', description: 'Desc' })],
    ['updateCaseFinding', () => secService.updateCaseFinding('case-blacktide-001', 'find-001', { title: 'Updated' })],
    ['linkIncidentToCase', () => secService.linkIncidentToCase('case-blacktide-001', 'incident-001')],
    ['unlinkIncidentFromCase', () => secService.unlinkIncidentFromCase('case-blacktide-001', 'incident-001')],
    ['linkHuntToCase', () => secService.linkHuntToCase('case-blacktide-001', 'hunt-seed-001')],
    ['unlinkHuntFromCase', () => secService.unlinkHuntFromCase('case-blacktide-001', 'hunt-seed-001')],
    ['createDetectionRuleDraft', () => secService.createDetectionRuleDraft(sampleRuleInput)],
    ['updateDetectionRuleDraft', () => secService.updateDetectionRuleDraft('DET-PROC-001', { name: 'New' })],
    ['testDetectionRule', () => secService.testDetectionRule('DET-PROC-001')],
    ['publishDetectionRule', () => secService.publishDetectionRule('DET-PROC-001', 'Publish')],
    ['enableDetectionRule', () => secService.enableDetectionRule('DET-PROC-001')],
    ['disableDetectionRule', () => secService.disableDetectionRule('DET-PROC-001')],
    ['deprecateDetectionRule', () => secService.deprecateDetectionRule('DET-PROC-001')],
  ];

  for (const [name, fn] of secServiceChecks) {
    let denied = false;
    try {
      await fn();
    } catch (err: any) {
      denied = err.message.includes('requires an active session') || err.message.includes('Unauthorized');
    }
    assert(denied, `SecurityService.${name} denied without active session`);
  }

  // 3.2 LocalProvider missing session checks (even if caller supplies role/actor args)
  const providerChecks: [string, () => Promise<any>][] = [
    ['createCase', () => provider.createCase(sampleCaseInput, 'admin', 'PLATFORM_ADMIN')],
    ['updateCase', () => provider.updateCase('case-blacktide-001', { priority: 'HIGH' }, 'admin', 'PLATFORM_ADMIN')],
    ['closeCase', () => provider.closeCase('case-blacktide-001', 'Closure', 'admin', 'PLATFORM_ADMIN')],
    ['reopenCase', () => provider.reopenCase('case-blacktide-001', 'Reopen', 'admin', 'PLATFORM_ADMIN')],
    ['addCaseNote', () => provider.addCaseNote('case-blacktide-001', { content: 'Note' }, 'admin', 'PLATFORM_ADMIN')],
    ['updateCaseNote', () => provider.updateCaseNote('case-blacktide-001', 'note-001', { content: 'New' }, 'admin', 'PLATFORM_ADMIN')],
    ['addCaseTask', () => provider.addCaseTask('case-blacktide-001', { title: 'Task' }, 'admin', 'PLATFORM_ADMIN')],
    ['updateCaseTask', () => provider.updateCaseTask('case-blacktide-001', 'task-001', { status: 'DONE' }, 'admin', 'PLATFORM_ADMIN')],
    ['addCaseFinding', () => provider.addCaseFinding('case-blacktide-001', { title: 'Finding', description: 'D' }, 'admin', 'PLATFORM_ADMIN')],
    ['updateCaseFinding', () => provider.updateCaseFinding('case-blacktide-001', 'f-001', { title: 'New' }, 'admin', 'PLATFORM_ADMIN')],
    ['linkIncidentToCase', () => provider.linkIncidentToCase('case-blacktide-001', 'incident-001', 'admin', 'PLATFORM_ADMIN')],
    ['unlinkIncidentFromCase', () => provider.unlinkIncidentFromCase('case-blacktide-001', 'incident-001', 'admin', 'PLATFORM_ADMIN')],
    ['linkHuntToCase', () => provider.linkHuntToCase('case-blacktide-001', 'hunt-seed-001', 'admin', 'PLATFORM_ADMIN')],
    ['unlinkHuntFromCase', () => provider.unlinkHuntFromCase('case-blacktide-001', 'hunt-seed-001', 'admin', 'PLATFORM_ADMIN')],
    ['createDetectionRuleDraft', () => provider.createDetectionRuleDraft(sampleRuleInput, 'admin', 'PLATFORM_ADMIN')],
    ['updateDetectionRuleDraft', () => provider.updateDetectionRuleDraft('DET-PROC-001', { name: 'New' }, 'admin', 'PLATFORM_ADMIN')],
    ['testDetectionRule', () => provider.testDetectionRule('DET-PROC-001', {}, 'admin', 'PLATFORM_ADMIN')],
    ['publishDetectionRule', () => provider.publishDetectionRule('DET-PROC-001', 'Pub', 'admin', 'PLATFORM_ADMIN')],
    ['enableDetectionRule', () => provider.enableDetectionRule('DET-PROC-001', 'admin', 'PLATFORM_ADMIN')],
    ['disableDetectionRule', () => provider.disableDetectionRule('DET-PROC-001', 'admin', 'PLATFORM_ADMIN')],
    ['deprecateDetectionRule', () => provider.deprecateDetectionRule('DET-PROC-001', 'admin', 'PLATFORM_ADMIN')],
  ];

  for (const [name, fn] of providerChecks) {
    let denied = false;
    try {
      await fn();
    } catch (err: any) {
      denied = err.message.includes('requires an active session');
    }
    assert(denied, `LocalProvider.${name} denied without active session (ignoring supplied PLATFORM_ADMIN)`);
  }

  // Verify ZERO mutations occurred during missing session checks
  assert((await provider.getDetectionRules()).length === baselineRules, 'Zero detection rules mutated without session');
  assert((await provider.getCases()).length === baselineCases, 'Zero cases mutated without session');
  assert((await provider.getAuditLogs()).length === baselineAudits, 'Zero audits created without session');

  // ─── 4. Unauthorized Role Denial Tests ────────────────────────────────────────
  console.log('\n4. Unauthorized Role Denial Tests:');

  // 4.1 INCIDENT_RESPONDER cannot create case
  authenticate({ username: 'responder', roleOverride: 'INCIDENT_RESPONDER' });
  let respCreateCaseDenied = false;
  try {
    await secService.createCase(sampleCaseInput);
  } catch (err: any) {
    respCreateCaseDenied = err.message.includes('cannot create cases');
  }
  assert(respCreateCaseDenied, 'INCIDENT_RESPONDER denied from creating cases via SecurityService');

  let respProvCreateCaseDenied = false;
  try {
    await provider.createCase(sampleCaseInput, 'responder', 'INCIDENT_RESPONDER');
  } catch (err: any) {
    respProvCreateCaseDenied = err.message.includes('cannot create cases');
  }
  assert(respProvCreateCaseDenied, 'INCIDENT_RESPONDER denied from creating cases via LocalProvider');

  // 4.2 L1_ANALYST cannot close, reopen, or reassign cases
  authenticate({ username: 'analyst1', roleOverride: 'L1_ANALYST' });

  let l1CloseDenied = false;
  try {
    await secService.closeCase('case-blacktide-001', 'Unauthorized close');
  } catch (err: any) {
    l1CloseDenied = err.message.includes('cannot close cases') || err.message.includes('Unauthorized');
  }
  assert(l1CloseDenied, 'L1_ANALYST denied from closing cases via SecurityService');

  let l1ProvCloseDenied = false;
  try {
    await provider.closeCase('case-blacktide-001', 'Unauthorized close', 'analyst1', 'L1_ANALYST');
  } catch (err: any) {
    l1ProvCloseDenied = err.message.includes('cannot close cases');
  }
  assert(l1ProvCloseDenied, 'L1_ANALYST denied from closing cases via LocalProvider');

  let l1ReopenDenied = false;
  try {
    await secService.reopenCase('case-blacktide-001', 'Unauthorized reopen');
  } catch (err: any) {
    l1ReopenDenied = err.message.includes('cannot reopen cases');
  }
  assert(l1ReopenDenied, 'L1_ANALYST denied from reopening cases via SecurityService');

  let l1AssignDenied = false;
  try {
    await secService.assignCase('case-blacktide-001', 'analyst2');
  } catch (err: any) {
    l1AssignDenied = err.message.includes('cannot assign or reassign cases');
  }
  assert(l1AssignDenied, 'L1_ANALYST denied from assigning cases via SecurityService');

  // 4.3 L1_ANALYST cannot author or publish detection rules
  let l1AuthorDenied = false;
  try {
    await secService.createDetectionRuleDraft(sampleRuleInput);
  } catch (err: any) {
    l1AuthorDenied = err.message.includes('cannot author detection rules');
  }
  assert(l1AuthorDenied, 'L1_ANALYST denied from creating detection rule drafts via SecurityService');

  let l1ProvAuthorDenied = false;
  try {
    await provider.createDetectionRuleDraft(sampleRuleInput, 'analyst1', 'L1_ANALYST');
  } catch (err: any) {
    l1ProvAuthorDenied = err.message.includes('cannot author detection rules');
  }
  assert(l1ProvAuthorDenied, 'L1_ANALYST denied from creating detection rule drafts via LocalProvider');

  let l1PublishDenied = false;
  try {
    await secService.publishDetectionRule('DET-PROC-001', 'Unauthorized release');
  } catch (err: any) {
    l1PublishDenied = err.message.includes('authority to publish detection rules');
  }
  assert(l1PublishDenied, 'L1_ANALYST denied from publishing detection rules via SecurityService');

  let l1ProvPublishDenied = false;
  try {
    await provider.publishDetectionRule('DET-PROC-001', 'Unauthorized release', 'analyst1', 'L1_ANALYST');
  } catch (err: any) {
    l1ProvPublishDenied = err.message.includes('authority to publish detection rules');
  }
  assert(l1ProvPublishDenied, 'L1_ANALYST denied from publishing detection rules via LocalProvider');

  // 4.4 L2_ANALYST cannot publish detection rules (requires DETECTION_RULE_MANAGE)
  authenticate({ username: 'analyst2', roleOverride: 'L2_ANALYST' });
  let l2PublishDenied = false;
  try {
    await secService.publishDetectionRule('DET-PROC-001', 'Unauthorized release');
  } catch (err: any) {
    l2PublishDenied = err.message.includes('authority to publish detection rules');
  }
  assert(l2PublishDenied, 'L2_ANALYST denied from publishing detection rules via SecurityService');

  let l2ProvPublishDenied = false;
  try {
    await provider.publishDetectionRule('DET-PROC-001', 'Unauthorized release', 'analyst2', 'L2_ANALYST');
  } catch (err: any) {
    l2ProvPublishDenied = err.message.includes('authority to publish detection rules');
  }
  assert(l2ProvPublishDenied, 'L2_ANALYST denied from publishing detection rules via LocalProvider');

  // Verify ZERO mutations occurred during unauthorized role attempts
  assert((await provider.getDetectionRules()).length === baselineRules, 'Zero rules mutated during unauthorized role attempts');
  assert((await provider.getCases()).length === baselineCases, 'Zero cases mutated during unauthorized role attempts');
  assert((await provider.getAuditLogs()).length === baselineAudits, 'Zero audits created during unauthorized role attempts');

  // ─── 5. Caller-Supplied Role Spoofing Tests ──────────────────────────────────
  console.log('\n5. Caller-Supplied Role Spoofing Tests:');

  // Active session is L1_ANALYST, but caller passes PLATFORM_ADMIN
  authenticate({ username: 'analyst1', roleOverride: 'L1_ANALYST' });

  let spoofL1AdminRule = false;
  try {
    await provider.createDetectionRuleDraft(sampleRuleInput, 'analyst1', 'PLATFORM_ADMIN');
  } catch (err: any) {
    spoofL1AdminRule = err.message.includes('cannot author detection rules');
  }
  assert(spoofL1AdminRule, 'L1 session + supplied PLATFORM_ADMIN role denied for rule authoring');

  let spoofL1AdminPublish = false;
  try {
    await provider.publishDetectionRule('DET-PROC-001', 'Spoofed admin publish', 'analyst1', 'PLATFORM_ADMIN');
  } catch (err: any) {
    spoofL1AdminPublish = err.message.includes('authority to publish detection rules');
  }
  assert(spoofL1AdminPublish, 'L1 session + supplied PLATFORM_ADMIN role denied for rule publishing');

  let spoofL1AdminClose = false;
  try {
    await provider.closeCase('case-blacktide-001', 'Spoofed admin closure', 'analyst1', 'PLATFORM_ADMIN');
  } catch (err: any) {
    spoofL1AdminClose = err.message.includes('cannot close cases');
  }
  assert(spoofL1AdminClose, 'L1 session + supplied PLATFORM_ADMIN role denied for case closure');

  let spoofL1AdminReopen = false;
  try {
    await provider.reopenCase('case-blacktide-001', 'Spoofed admin reopen', 'analyst1', 'PLATFORM_ADMIN');
  } catch (err: any) {
    spoofL1AdminReopen = err.message.includes('cannot reopen cases');
  }
  assert(spoofL1AdminReopen, 'L1 session + supplied PLATFORM_ADMIN role denied for case reopen');

  // Active session is INCIDENT_RESPONDER, caller passes SOC_MANAGER to createCase
  authenticate({ username: 'responder', roleOverride: 'INCIDENT_RESPONDER' });
  let spoofRespManagerCase = false;
  try {
    await provider.createCase(sampleCaseInput, 'responder', 'SOC_MANAGER');
  } catch (err: any) {
    spoofRespManagerCase = err.message.includes('cannot create cases');
  }
  assert(spoofRespManagerCase, 'Responder session + supplied SOC_MANAGER role denied for case creation');

  // Verify ZERO mutations occurred during role spoofing attempts
  assert((await provider.getDetectionRules()).length === baselineRules, 'Zero rules mutated during role spoofing');
  assert((await provider.getCases()).length === baselineCases, 'Zero cases mutated during role spoofing');
  assert((await provider.getAuditLogs()).length === baselineAudits, 'Zero audits created during role spoofing');

  // ─── 6. Spoofed Audit Actor Identity Tests ───────────────────────────────────
  console.log('\n6. Spoofed Audit Actor Identity Tests:');

  authenticate({ username: 'sarah.chen', roleOverride: 'SOC_MANAGER' });

  let spoofActorCase = false;
  try {
    await provider.createCase(sampleCaseInput, 'malicious_impersonator');
  } catch (err: any) {
    spoofActorCase = err.message.includes('Spoofed audit actor identity');
  }
  assert(spoofActorCase, 'Impersonated actor on createCase rejected before mutation');

  let spoofActorRule = false;
  try {
    await provider.createDetectionRuleDraft(sampleRuleInput, 'malicious_impersonator');
  } catch (err: any) {
    spoofActorRule = err.message.includes('Spoofed audit actor identity');
  }
  assert(spoofActorRule, 'Impersonated actor on createDetectionRuleDraft rejected before mutation');

  let spoofActorClose = false;
  try {
    await provider.closeCase('case-blacktide-001', 'Reason', 'malicious_impersonator');
  } catch (err: any) {
    spoofActorClose = err.message.includes('Spoofed audit actor identity');
  }
  assert(spoofActorClose, 'Impersonated actor on closeCase rejected before mutation');

  let spoofActorNote = false;
  try {
    await provider.addCaseNote('case-blacktide-001', { content: 'Note' }, 'malicious_impersonator');
  } catch (err: any) {
    spoofActorNote = err.message.includes('Spoofed audit actor identity');
  }
  assert(spoofActorNote, 'Impersonated actor on addCaseNote rejected before mutation');

  // Verify ZERO mutations occurred during audit actor spoofing
  assert((await provider.getDetectionRules()).length === baselineRules, 'Zero rules mutated during actor spoofing');
  assert((await provider.getCases()).length === baselineCases, 'Zero cases mutated during actor spoofing');
  assert((await provider.getAuditLogs()).length === baselineAudits, 'Zero audits created during actor spoofing');

  // ─── 7. Authorized Success Operations ────────────────────────────────────────
  console.log('\n7. Authorized Success Operations:');

  // 7.1 SOC_MANAGER creates a case, updates it, adds notes, tasks, findings, and closes/reopens it
  authenticate({ username: 'sarah.chen', roleOverride: 'SOC_MANAGER' });

  const authorizedCase = await secService.createCase({
    title: 'Authorized Investigation into Lateral Movement',
    description: 'Investigating anomalous pass-the-hash activity on database tier.',
    priority: 'HIGH',
    severity: 'HIGH',
  });
  assert(authorizedCase.status === 'OPEN', 'Authorized case created in OPEN status');
  assert(authorizedCase.createdBy === 'sarah.chen', 'Case createdBy accurately recorded as sarah.chen');

  const updatedCase = await secService.updateCase(authorizedCase.id, {
    description: 'Updated operational scope for lateral movement.',
  });
  assert(updatedCase.description.includes('Updated operational scope'), 'Authorized case updated');

  const assignedCase = await secService.assignCase(authorizedCase.id, 'analyst2');
  assert(assignedCase.ownerId === 'analyst2', 'Authorized case assigned to analyst2');

  const note = await secService.addCaseNote(authorizedCase.id, {
    content: 'Initial memory analysis confirmed LSASS dump artifacts.',
  });
  assert(note.authorId === 'sarah.chen', 'Case note authorId matches authenticated session');

  const task = await secService.addCaseTask(authorizedCase.id, {
    title: 'Revoke compromised Kerberos ticket-granting service accounts',
    priority: 'CRITICAL',
    assigneeId: 'responder',
  });
  assert(task.status === 'TODO', 'Case task created');
  assert(task.createdBy === 'sarah.chen', 'Task createdBy recorded as session user');

  const updatedTask = await secService.updateCaseTask(authorizedCase.id, task.id, {
    status: 'DONE',
  });
  assert(updatedTask.status === 'DONE', 'Task status transitioned to DONE');
  assert(!!updatedTask.completedAt, 'Task completion timestamp recorded');

  const finding = await secService.addCaseFinding(authorizedCase.id, {
    title: 'LSASS Memory Injection Confirmed',
    description: 'Mimikatz invocation via PowerShell detected on FINWS-027.',
    severity: 'CRITICAL',
    relatedEventIds: ['evt-001'],
    relatedIncidentIds: ['incident-001'],
  });
  assert(finding.authorId === 'sarah.chen', 'Finding authorId recorded as session user');

  const closedCase = await secService.closeCase(authorizedCase.id, 'Remediation completed and verified.');
  assert(closedCase.status === 'CLOSED', 'Case transitioned to CLOSED');
  assert(!!closedCase.closedAt, 'Case closedAt timestamp recorded');

  const reopenedCase = await secService.reopenCase(authorizedCase.id, 'Secondary beacon detected.');
  assert(reopenedCase.status === 'IN_PROGRESS', 'Case reopened to IN_PROGRESS');
  assert(reopenedCase.closedAt === undefined, 'Case closedAt cleared');

  // 7.2 Detection Engineering Authorized Operations
  const draftRule = await secService.createDetectionRuleDraft({
    name: 'Authorized PsExec Lateral Movement Detection',
    description: 'Detects remote service creation and named pipe connections characteristic of PsExec',
    severity: 'HIGH',
    category: 'PROCESS',
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'PROCESS' },
      { field: 'processName', operator: 'EQUALS', value: 'psexec.exe' },
    ],
    mitreTechniqueId: 'T1021.002',
    tags: ['lateral-movement', 'psexec'],
  });
  assert(draftRule.status === 'DRAFT', 'Rule created in DRAFT status');
  assert(draftRule.author === 'sarah.chen', 'Rule author recorded as session username');
  assert(draftRule.version === 1, 'Rule initial version is 1');

  const editedRule = await secService.updateDetectionRuleDraft(draftRule.id, {
    description: 'Updated PsExec detection conditions to include PsExec64.exe',
  });
  assert(editedRule.description.includes('PsExec64.exe'), 'Draft rule updated');

  const testResult = await secService.testDetectionRule(editedRule.id, { sampleLimit: 50 });
  assert(testResult.testRun.eventsEvaluated > 0, 'Simulation executed test run');
  const testedRule = await provider.getDetectionRule(draftRule.id);
  assert(testedRule?.status === 'TESTING', 'Rule status transitioned to TESTING');

  const publishedRule = await secService.publishDetectionRule(draftRule.id, 'Initial production release v1');
  assert(publishedRule.status === 'PUBLISHED', 'Rule published (status PUBLISHED)');
  assert(!!publishedRule.publishedAt, 'Publication timestamp recorded');

  const enabledRule = await secService.enableDetectionRule(draftRule.id);
  assert(enabledRule.status === 'ENABLED' && enabledRule.enabled === true, 'Rule enabled for runtime matching');

  const disabledRule = await secService.disableDetectionRule(draftRule.id);
  assert(disabledRule.status === 'DISABLED' && disabledRule.enabled === false, 'Rule disabled');

  const deprecatedRule = await secService.deprecateDetectionRule(draftRule.id);
  assert(deprecatedRule.status === 'DEPRECATED' && deprecatedRule.enabled === false, 'Rule deprecated');

  // Verify Audit Log Provenance
  const audits = await provider.getAuditLogs();
  const caseAudits = audits.filter((a) => a.target === authorizedCase.id);
  assert(caseAudits.length >= 4, 'Case lifecycle mutations recorded in audit log');
  assert(caseAudits.every((a) => a.actor === 'sarah.chen' && a.actorRole === 'SOC_MANAGER'), 'All case audits have authentic session actor and role');

  const ruleAudits = audits.filter((a) => a.target === draftRule.id);
  assert(ruleAudits.length >= 4, 'Rule lifecycle mutations recorded in audit log');
  assert(ruleAudits.every((a) => a.actor === 'sarah.chen' && a.actorRole === 'SOC_MANAGER'), 'All rule audits have authentic session actor and role');

  // ─── 8. Preserved Authorized Read Operations ──────────────────────────────────
  console.log('\n8. Preserved Authorized Read Operations:');

  const testUsers: [string, RoleId][] = [
    ['analyst1', 'L1_ANALYST'],
    ['analyst2', 'L2_ANALYST'],
    ['responder', 'INCIDENT_RESPONDER'],
    ['hunter', 'THREAT_HUNTER'],
    ['manager', 'SOC_MANAGER'],
    ['admin', 'PLATFORM_ADMIN'],
  ];

  for (const [username, role] of testUsers) {
    authenticate({ username, roleOverride: role });
    const allCases = await secService.getCases();
    assert(Array.isArray(allCases) && allCases.length > 0, `Role ${role} successfully reads cases list`);
    const singleCase = await secService.getCase('case-blacktide-001');
    assert(singleCase !== null, `Role ${role} successfully reads individual case`);
    const allRules = await secService.getDetectionRules();
    assert(Array.isArray(allRules) && allRules.length > 0, `Role ${role} successfully reads detection rules list`);
    const singleRule = await secService.getDetectionRule('DET-PROC-001');
    assert(singleRule !== null, `Role ${role} successfully reads individual detection rule`);
  }

  // Cleanup
  logout();

  console.log('\n====================================================');
  console.log('   ALL CASES & DETECTION AUTHORIZATION TESTS PASSED! ✓');
  console.log('====================================================\n');
}

runAuthorizationTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

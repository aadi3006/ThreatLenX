/**
 * test-step6-cases.ts
 *
 * Automated verification suite for Step 6: Case Management System.
 * Tests canonical models, deterministic numbering, lifecycle state machine,
 * RBAC authorization, tasks, findings, notes, linking, search, and the
 * complete Operation BlackTide operational workflow.
 */

import {
  Case,
  CaseNote,
  CaseTask,
  CaseFinding,
  CaseStatus,
  CasePriority,
  isValidCaseStatusTransition,
  VALID_CASE_STATUS_TRANSITIONS,
} from '../app/core/models/case';
import {
  canReadCases,
  canCreateCase,
  canUpdateCase,
  canManageCase,
} from '../app/core/auth/rbac';
import { LocalProvider } from '../app/core/providers/local-provider';
import { SecurityService } from '../app/core/security-service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function runStep6Tests() {
  console.log('====================================================');
  console.log('   STEP 6: CASE MANAGEMENT SYSTEM VERIFICATION');
  console.log('====================================================\n');

  // ─── SUITE 1: CANONICAL MODELS & LIFECYCLE STATE MACHINE ─────────
  console.log('--- SUITE 1: Canonical Lifecycle Transitions & State Machine ---');
  
  assert(isValidCaseStatusTransition('OPEN', 'IN_PROGRESS'), 'OPEN -> IN_PROGRESS is allowed');
  assert(isValidCaseStatusTransition('IN_PROGRESS', 'PENDING'), 'IN_PROGRESS -> PENDING is allowed');
  assert(isValidCaseStatusTransition('PENDING', 'IN_PROGRESS'), 'PENDING -> IN_PROGRESS is allowed');
  assert(isValidCaseStatusTransition('IN_PROGRESS', 'RESOLVED'), 'IN_PROGRESS -> RESOLVED is allowed');
  assert(isValidCaseStatusTransition('RESOLVED', 'CLOSED'), 'RESOLVED -> CLOSED is allowed');
  
  // Direct invalid transitions from CLOSED
  assert(!isValidCaseStatusTransition('CLOSED', 'IN_PROGRESS'), 'Direct CLOSED -> IN_PROGRESS is blocked');
  assert(!isValidCaseStatusTransition('CLOSED', 'OPEN'), 'Direct CLOSED -> OPEN is blocked');
  assert(!isValidCaseStatusTransition('CLOSED', 'PENDING'), 'Direct CLOSED -> PENDING is blocked');
  assert(!isValidCaseStatusTransition('RESOLVED', 'PENDING'), 'RESOLVED -> PENDING is blocked');

  // ─── SUITE 2: RBAC AUTHORIZATION ──────────────────────────────────
  console.log('\n--- SUITE 2: RBAC Authorization Matrix ---');
  
  // L1 Analyst
  assert(canReadCases('L1_ANALYST'), 'L1 Analyst can read cases');
  assert(canCreateCase('L1_ANALYST'), 'L1 Analyst can create cases');
  assert(canUpdateCase('L1_ANALYST'), 'L1 Analyst can update cases (notes, tasks, findings)');
  assert(!canManageCase('L1_ANALYST'), 'L1 Analyst cannot manage cases (no assignment / closure)');

  // Threat Hunter
  assert(canReadCases('THREAT_HUNTER'), 'Hunter can read cases');
  assert(canCreateCase('THREAT_HUNTER'), 'Hunter can create cases');
  assert(canUpdateCase('THREAT_HUNTER'), 'Hunter can update cases');
  assert(!canManageCase('THREAT_HUNTER'), 'Hunter cannot manage cases');

  // Incident Responder
  assert(canReadCases('INCIDENT_RESPONDER'), 'Responder can read cases');
  assert(!canCreateCase('INCIDENT_RESPONDER'), 'Responder cannot create cases');
  assert(canUpdateCase('INCIDENT_RESPONDER'), 'Responder can update cases');
  assert(!canManageCase('INCIDENT_RESPONDER'), 'Responder cannot reassign cases');

  // SOC Manager
  assert(canReadCases('SOC_MANAGER'), 'Manager can read cases');
  assert(canCreateCase('SOC_MANAGER'), 'Manager can create cases');
  assert(canUpdateCase('SOC_MANAGER'), 'Manager can update cases');
  assert(canManageCase('SOC_MANAGER'), 'Manager can manage cases (assign, reassign, close, reopen)');

  // Platform Admin
  assert(canManageCase('PLATFORM_ADMIN'), 'Admin can manage cases');

  // ─── SUITE 3: LOCAL PROVIDER INITIALIZATION & BASELINE CASE ───────
  console.log('\n--- SUITE 3: Provider Baseline & Operation BlackTide Case ---');

  // Create a headless in-memory mock for indexedDB if run in pure node
  if (typeof indexedDB === 'undefined') {
    const memoryStores = new Map<string, Map<string, unknown>>();
    const getStore = (name: string) => {
      if (!memoryStores.has(name)) memoryStores.set(name, new Map());
      return memoryStores.get(name)!;
    };

    const createReq = (result: any) => {
      const r: any = { result, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (r.onsuccess) r.onsuccess({ target: r });
      });
      return r;
    };

    (global as any).indexedDB = {
      open: (_dbName: string, _version: number) => {
        const dbInstance: any = {
          objectStoreNames: {
            contains: (name: string) => memoryStores.has(name),
          },
          createObjectStore: (name: string) => {
            getStore(name);
            return {
              createIndex: () => {},
              indexNames: { contains: () => true },
            };
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
          if (req.onupgradeneeded) {
            req.onupgradeneeded({ target: req, oldVersion: 0 });
          }
          if (req.onsuccess) {
            req.onsuccess({ target: req });
          }
        });
        return req;
      },
    };
  }

  const provider = new LocalProvider();
  await provider.initialize();

  const baselineCases = await provider.getCases();
  assert(baselineCases.length >= 1, 'Provider successfully seeded baseline case');

  const blackTideCase = baselineCases.find((c) => c.caseNumber === 'CASE-000001');
  assert(blackTideCase !== undefined, 'CASE-000001 (Operation BlackTide) exists');
  assert(blackTideCase!.title.includes('Operation BlackTide'), 'Case title matches BlackTide campaign');
  assert(blackTideCase!.status === 'IN_PROGRESS', 'Baseline case status is IN_PROGRESS');
  assert(blackTideCase!.priority === 'CRITICAL', 'Baseline case priority is CRITICAL');
  assert(blackTideCase!.severity === 'CRITICAL', 'Baseline case severity is CRITICAL');
  assert(blackTideCase!.incidentIds.includes('incident-001'), 'Case links canonical BlackTide incident (incident-001)');
  assert(blackTideCase!.huntIds.length >= 2, 'Case links related BlackTide threat hunts');

  // Baseline notes
  const initialNotes = await provider.getCaseNotes(blackTideCase!.id);
  assert(initialNotes.length >= 1, 'Baseline note present');
  assert(initialNotes[0].content.includes('C2 connection verified'), 'Note contains verified triage commentary');

  // Baseline tasks
  const initialTasks = await provider.getCaseTasks(blackTideCase!.id);
  assert(initialTasks.length >= 3, 'Baseline tasks created');
  const isolatedTask = initialTasks.find((t) => t.title.includes('Isolate FINWS-027'));
  assert(isolatedTask !== undefined && isolatedTask.status === 'DONE', 'Containment task marked DONE');

  // Baseline findings
  const initialFindings = await provider.getCaseFindings(blackTideCase!.id);
  assert(initialFindings.length >= 1, 'Baseline finding present');
  assert(Boolean(initialFindings[0].relatedIncidentIds?.includes('incident-001')), 'Finding references canonical incident-001');
  assert(Boolean(initialFindings[0].relatedHuntIds?.includes('hunt-seed-001')), 'Finding references threat hunt provenance');

  // ─── SUITE 4: DETERMINISTIC SEQUENTIAL NUMBERING ──────────────────
  console.log('\n--- SUITE 4: Deterministic Sequential Numbering ---');

  const case2 = await provider.createCase(
    {
      title: 'Investigation into Financial Subnet Anomalies',
      description: 'Secondary investigation opened by hunter.',
      priority: 'HIGH',
      severity: 'HIGH',
    },
    'hunter',
    'THREAT_HUNTER'
  );
  assert(case2.caseNumber === 'CASE-000002', `Generated sequential case number: ${case2.caseNumber}`);

  const case3 = await provider.createCase(
    {
      title: 'Executive Phishing Wave Q3',
      description: 'Spearphishing targeting finance leadership.',
      priority: 'CRITICAL',
      severity: 'HIGH',
    },
    'analyst1',
    'L1_ANALYST'
  );
  assert(case3.caseNumber === 'CASE-000003', `Generated sequential case number: ${case3.caseNumber}`);

  // ─── SUITE 5: LIFECYCLE TRANSITIONS & AUDIT LOGGING ───────────────
  console.log('\n--- SUITE 5: Lifecycle Transitions & Audit Trail ---');

  assert(case2.status === 'OPEN', 'Newly created case starts in OPEN state');

  // Transition OPEN -> IN_PROGRESS
  const inProgCase = await provider.updateCase(
    case2.id,
    { status: 'IN_PROGRESS' },
    'analyst2',
    'L2_ANALYST'
  );
  assert(inProgCase.status === 'IN_PROGRESS', 'Case successfully transitioned to IN_PROGRESS');

  // Transition IN_PROGRESS -> PENDING
  const pendingCase = await provider.updateCase(
    case2.id,
    { status: 'PENDING' },
    'analyst2',
    'L2_ANALYST'
  );
  assert(pendingCase.status === 'PENDING', 'Case successfully transitioned to PENDING');

  // Transition PENDING -> IN_PROGRESS
  const resumedCase = await provider.updateCase(
    case2.id,
    { status: 'IN_PROGRESS' },
    'analyst2',
    'L2_ANALYST'
  );
  assert(resumedCase.status === 'IN_PROGRESS', 'Case resumed to IN_PROGRESS');

  // Transition IN_PROGRESS -> RESOLVED
  const resolvedCase = await provider.updateCase(
    case2.id,
    { status: 'RESOLVED', resolution: 'Phishing infrastructure dismantled.' },
    'manager',
    'SOC_MANAGER'
  );
  assert(resolvedCase.status === 'RESOLVED', 'Case marked RESOLVED');
  assert(resolvedCase.resolvedAt !== undefined, 'Resolution timestamp recorded');

  // Transition RESOLVED -> CLOSED
  const closedCase = await provider.closeCase(
    case2.id,
    'Incident remediation confirmed across all endpoints.',
    'manager',
    'SOC_MANAGER'
  );
  assert(closedCase.status === 'CLOSED', 'Case formally CLOSED');
  assert(closedCase.closedAt !== undefined, 'Closure timestamp recorded');
  assert(closedCase.closureReason !== undefined, 'Closure reason recorded');

  // Reject direct mutation from CLOSED to IN_PROGRESS
  let rejected = false;
  try {
    await provider.updateCase(case2.id, { status: 'IN_PROGRESS' }, 'analyst2', 'L2_ANALYST');
  } catch (err) {
    rejected = true;
  }
  assert(rejected, 'Direct transition from CLOSED to IN_PROGRESS correctly rejected');

  // Explicit reopen workflow
  const reopenedCase = await provider.reopenCase(
    case2.id,
    'New outbound beacons detected from same subnet.',
    'manager',
    'SOC_MANAGER'
  );
  assert(reopenedCase.status === 'IN_PROGRESS', 'Case successfully reopened via explicit workflow');
  assert(reopenedCase.closedAt === undefined, 'closedAt cleared upon reopening');

  // ─── SUITE 6: OWNERSHIP & REASSIGNMENT ────────────────────────────
  console.log('\n--- SUITE 6: Ownership & Reassignment ---');

  // Analyst attempts to reassign (should be rejected for L1_ANALYST)
  let reassignRejected = false;
  try {
    await provider.updateCase(case3.id, { ownerId: 'responder' }, 'analyst1', 'L1_ANALYST');
  } catch {
    reassignRejected = true;
  }
  assert(reassignRejected, 'L1 Analyst prohibited from reassigning case ownership');

  // Manager reassigns case
  const assignedCase = await provider.updateCase(case3.id, { ownerId: 'responder' }, 'manager', 'SOC_MANAGER');
  assert(assignedCase.ownerId === 'responder', 'Manager successfully assigned case to responder');
  assert(Boolean(assignedCase.participantIds?.includes('responder')), 'Assignee added to participant list');

  // ─── SUITE 7: CASE NOTES, TASKS & FINDINGS ────────────────────────
  console.log('\n--- SUITE 7: Case Notes, Tasks & Findings ---');

  // Add Note
  const newNote = await provider.addCaseNote(
    case3.id,
    { content: 'Observed phishing landing page hosted on external VPS.' },
    'analyst2',
    'L2_ANALYST'
  );
  assert(newNote.caseId === case3.id, 'Note linked to case3');
  assert(newNote.authorId === 'analyst2', 'Author preserved');

  // Edit Note
  const editedNote = await provider.updateCaseNote(
    case3.id,
    newNote.id,
    { content: 'Observed phishing landing page hosted on external VPS (IP: 198.51.100.99).' },
    'analyst2',
    'L2_ANALYST'
  );
  assert(editedNote.isEdited === true, 'Note marked as edited');
  assert(editedNote.content.includes('198.51.100.99'), 'Edited content saved');

  // Add Task
  const newTask = await provider.addCaseTask(
    case3.id,
    { title: 'Block domain on perimeter secure email gateway', priority: 'HIGH', assigneeId: 'responder' },
    'analyst2',
    'L2_ANALYST'
  );
  assert(newTask.status === 'TODO', 'Task created in TODO status');

  // Complete Task
  const completedTask = await provider.updateCaseTask(
    case3.id,
    newTask.id,
    { status: 'DONE' },
    'responder',
    'INCIDENT_RESPONDER'
  );
  assert(completedTask.status === 'DONE', 'Task updated to DONE');
  assert(completedTask.completedAt !== undefined, 'Task completion timestamp recorded');

  // Add Finding with Provenance
  const newFinding = await provider.addCaseFinding(
    case3.id,
    {
      title: 'Compromised OAuth Token Identified',
      description: 'Malicious app consent granted by user-002 to rogue OAuth client.',
      severity: 'CRITICAL',
      relatedEventIds: ['evt-001', 'evt-002'],
      relatedAlertIds: ['alert-seed-001'],
      relatedIncidentIds: ['incident-001'],
      relatedHuntIds: ['hunt-seed-001'],
    },
    'analyst2',
    'L2_ANALYST'
  );
  assert(newFinding.relatedEventIds?.length === 2, 'Finding retains event provenance');
  assert(Boolean(newFinding.relatedAlertIds?.includes('alert-seed-001')), 'Finding retains alert provenance');
  assert(Boolean(newFinding.relatedIncidentIds?.includes('incident-001')), 'Finding retains incident provenance');

  // Check that case3 automatically accumulated references from finding
  const reloadedCase3 = await provider.getCaseById(case3.id);
  assert(reloadedCase3!.eventIds.includes('evt-001'), 'Case accumulated event reference from finding');
  assert(reloadedCase3!.alertIds.includes('alert-seed-001'), 'Case accumulated alert reference from finding');

  // ─── SUITE 8: LINKING & UNLINKING INCIDENTS AND HUNTS ─────────────
  console.log('\n--- SUITE 8: Incident & Threat Hunt Linking ---');

  // Link Incident
  const linkedCase = await provider.linkIncidentToCase(case2.id, 'incident-001', 'analyst2', 'L2_ANALYST');
  assert(linkedCase.incidentIds.includes('incident-001'), 'Incident linked to case');
  assert(linkedCase.assetIds.length > 0, 'Affected assets synchronized from linked incident');

  // Unlink Incident
  const unlinkedCase = await provider.unlinkIncidentFromCase(case2.id, 'incident-001', 'analyst2', 'L2_ANALYST');
  assert(!unlinkedCase.incidentIds.includes('incident-001'), 'Incident successfully unlinked');

  // Link Threat Hunt
  const huntLinkedCase = await provider.linkHuntToCase(case2.id, 'hunt-seed-001', 'hunter', 'THREAT_HUNTER');
  assert(huntLinkedCase.huntIds.includes('hunt-seed-001'), 'Threat hunt linked to case');

  // Unlink Threat Hunt
  const huntUnlinkedCase = await provider.unlinkHuntFromCase(case2.id, 'hunt-seed-001', 'hunter', 'THREAT_HUNTER');
  assert(!huntUnlinkedCase.huntIds.includes('hunt-seed-001'), 'Threat hunt successfully unlinked');

  // ─── SUITE 9: SEARCH & FILTERING ──────────────────────────────────
  console.log('\n--- SUITE 9: Search & Filtering Queries ---');

  const filterByNum = await provider.getCases({ query: 'CASE-000001' });
  assert(filterByNum.length === 1 && filterByNum[0].caseNumber === 'CASE-000001', 'Filter by caseNumber exact match');

  const filterByCrit = await provider.getCases({ priority: 'CRITICAL' });
  assert(filterByCrit.every((c) => c.priority === 'CRITICAL'), 'Filter by priority CRITICAL');

  const filterByTag = await provider.getCases({ tag: 'blacktide' });
  assert(filterByTag.length >= 1 && filterByTag[0].tags.includes('blacktide'), 'Filter by tag "blacktide"');

  // ─── SUITE 10: SECURITY SERVICE INTEGRATION & FACADE ─────────────
  console.log('\n--- SUITE 10: SecurityService Facade & Reactivity ---');

  const secService = new SecurityService();
  await secService.bootstrap(provider);

  // Authenticate session as manager
  await secService.login({ username: 'manager' });
  assert(secService.getSession()?.role === 'SOC_MANAGER', 'Session active as SOC_MANAGER');

  let casesUpdatedFired = false;
  const unsub = secService.subscribe('CASES_UPDATED', () => {
    casesUpdatedFired = true;
  });

  const svcCreated = await secService.createCase({
    title: 'SecurityService Facade Test Case',
    description: 'Verifying SecurityService event bus and reactivity.',
    priority: 'LOW',
  });
  assert(svcCreated.caseNumber.startsWith('CASE-'), 'Case created via SecurityService has canonical case number');
  assert(casesUpdatedFired, 'CASES_UPDATED event successfully broadcast to subscribers');
  unsub();

  // Test Context Queries via SecurityService
  const blackTideIncidents = await secService.getCaseIncidents('case-blacktide-001');
  assert(blackTideIncidents.length >= 1, 'getCaseIncidents returns correlated incidents');

  const blackTideHunts = await secService.getCaseHunts('case-blacktide-001');
  assert(blackTideHunts.length >= 1, 'getCaseHunts returns related threat hunts');

  const caseActivity = await secService.getCaseActivity('case-blacktide-001');
  assert(Array.isArray(caseActivity), 'getCaseActivity returns audit trail');

  console.log('\n====================================================');
  console.log('   ALL 10 STEP 6 TEST SUITES PASSED CLEANLY! ✓');
  console.log('====================================================\n');
}

runStep6Tests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

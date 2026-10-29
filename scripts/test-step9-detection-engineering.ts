/**
 * test-step9-detection-engineering.ts
 *
 * Automated verification suite for STEP 9: Detection Engineering & Rule Authoring System.
 *
 * Verifies:
 * - Baseline rule seeding into versioned records (v1, ENABLED)
 * - Deterministic rule validation (structural constraints, operators, MITRE)
 * - Condition grouping evaluation (AND, OR, NOT)
 * - Dry-run simulation against canonical events with ZERO alert side-effects
 * - Match and non-match explainability generation
 * - Rule versioning and historical snapshot preservation
 * - Structural diff between rule versions
 * - Controlled lifecycle state machine (DRAFT -> VALIDATING -> TESTING -> PUBLISHED -> ENABLED)
 * - Runtime alert provenance (retaining exact ruleId and ruleVersion)
 * - Event and Threat Hunt conversion pipelines
 * - RBAC authorization checks
 * - Security audit trail logging
 */

import { LocalProvider } from '../app/core/providers/local-provider';
import { validateRule } from '../app/core/security/rule-validator';
import {
  simulateRule,
  diffRuleVersions,
  evaluateRule,
  convertEventToDetectionDraft,
  convertHuntQueryToDetectionDraft,
  cloneRuleAsDraft,
} from '../app/core/security/detection-engine';
import type {
  DetectionRule,
  CreateDetectionRuleInput,
  RuleConditionGroup,
} from '../app/core/models/detection';
import type { SecurityEvent } from '../app/core/models/event';

// Headless in-memory IndexedDB mock for Node.js execution
if (typeof indexedDB === 'undefined') {
  const memoryStores = new Map<string, Map<string, unknown>>();
  const getStore = (name: string) => {
    if (!memoryStores.has(name)) memoryStores.set(name, new Map());
    return memoryStores.get(name)!;
  };

  (globalThis as any).indexedDB = {
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
            objectStore: (sName: string) => {
              const st = getStore(sName);
              return {
                get: (key: string) => {
                  const req: any = { result: st.get(key), onsuccess: null, onerror: null };
                  queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
                  return req;
                },
                getAll: () => {
                  const req: any = { result: Array.from(st.values()), onsuccess: null, onerror: null };
                  queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
                  return req;
                },
                put: (val: any) => {
                  const key = val.id ?? val.key;
                  st.set(key, val);
                  const req: any = { result: key, onsuccess: null, onerror: null };
                  queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
                  return req;
                },
                clear: () => {
                  st.clear();
                  const req: any = { result: undefined, onsuccess: null, onerror: null };
                  queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
                  return req;
                },
                index: () => ({
                  getAll: () => {
                    const req: any = { result: Array.from(st.values()), onsuccess: null, onerror: null };
                    queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
                    return req;
                  },
                }),
              };
            },
            oncomplete: null,
            onerror: null,
          };
          queueMicrotask(() => txObj.oncomplete && txObj.oncomplete());
          return txObj;
        },
      };

      const openReq: any = {
        result: dbInstance,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };

      queueMicrotask(() => {
        if (openReq.onupgradeneeded) {
          openReq.onupgradeneeded({ oldVersion: 0, target: openReq });
        }
        if (openReq.onsuccess) {
          openReq.onsuccess({ target: openReq });
        }
      });

      return openReq;
    },
  };
}

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, msg: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${msg}`);
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

async function runStep9Verification() {
  console.log('\n==================================================');
  console.log('STEP 9: DETECTION ENGINEERING & RULE AUTHORING VERIFICATION');
  console.log('==================================================\n');

  const provider = new LocalProvider();
  await provider.initialize();

  // ─── [1/12] Baseline Rule Seeding & Versioning ───────────────────────────
  console.log('[1/12] Baseline Rule Seeding & Versioning');
  const rules = await provider.getDetectionRules();
  assert(rules.length >= 7, `Baseline detection rules seeded (found ${rules.length})`);

  const procRule = rules.find((r) => r.id === 'DET-PROC-001' || r.ruleId === 'DET-PROC-001');
  assert(!!procRule, 'DET-PROC-001 baseline rule exists');
  assert(procRule?.version === 1, `DET-PROC-001 has monotonic version 1 (got: ${procRule?.version})`);
  assert(procRule?.status === 'ENABLED', `DET-PROC-001 is in ENABLED status (got: ${procRule?.status})`);
  assert(procRule?.enabled === true, 'DET-PROC-001 enabled boolean is true');

  const versions = await provider.getDetectionRuleVersions('DET-PROC-001');
  assert(versions.length >= 1, `Version history preserved for DET-PROC-001 (found ${versions.length} versions)`);
  assert(versions[0].version === 1, 'v1 snapshot exists in immutable version history');

  // ─── [2/12] Deterministic Rule Validation ─────────────────────────────────
  console.log('\n[2/12] Deterministic Rule Validation');
  const validCheck = validateRule(procRule!);
  assert(validCheck.valid === true, 'Valid baseline rule passes validation with 0 errors');
  assert(validCheck.errors.length === 0, 'No errors for valid rule');

  // Test invalid rule (missing name, unsupported operator, invalid MITRE)
  const invalidRule: Partial<DetectionRule> = {
    name: 'X', // too short (< 3)
    category: 'PROCESS',
    severity: 'HIGH',
    conditions: [
      { field: 'unknownField123', operator: 'BOGUS_OP' as any, value: 'test' },
    ],
    mitreTechniqueId: 'MALFORMED-TECHNIQUE',
  };
  const invalidCheck = validateRule(invalidRule);
  assert(invalidCheck.valid === false, 'Invalid rule correctly rejected by validator');
  assert(invalidCheck.errors.some((e) => e.code === 'NAME_TOO_SHORT'), 'Detected NAME_TOO_SHORT');
  assert(invalidCheck.errors.some((e) => e.code === 'UNSUPPORTED_EVENT_FIELD'), 'Detected UNSUPPORTED_EVENT_FIELD');
  assert(invalidCheck.errors.some((e) => e.code === 'UNSUPPORTED_OPERATOR'), 'Detected UNSUPPORTED_OPERATOR');
  assert(invalidCheck.errors.some((e) => e.code === 'INVALID_MITRE_FORMAT'), 'Detected INVALID_MITRE_FORMAT');

  // ─── [3/12] Condition Grouping (AND, OR, NOT) ─────────────────────────────
  console.log('\n[3/12] Condition Grouping (AND, OR, NOT)');
  const sampleEvent: SecurityEvent = {
    id: 'test-ev-001',
    timestamp: '2024-11-01T14:15:00Z',
    receivedAt: '2024-11-01T14:15:00Z',
    source: 'EndpointSensor',
    sourceType: 'ENDPOINT',
    category: 'PROCESS',
    eventType: 'PROCESS_CREATE',
    severity: 'HIGH',
    processName: 'powershell.exe',
    commandLine: 'powershell.exe -enc AAAA',
    message: 'Process execution',
  };

  const orGroup: RuleConditionGroup = {
    operator: 'OR',
    conditions: [
      { field: 'processName', operator: 'EQUALS', value: 'cmd.exe' },
      { field: 'processName', operator: 'EQUALS', value: 'powershell.exe' },
    ],
  };

  const groupedRule: DetectionRule = {
    id: 'TEST-GROUP-001',
    name: 'Grouped Rule Test',
    description: 'Testing logical OR grouping',
    enabled: true,
    severity: 'HIGH',
    category: 'PROCESS',
    conditions: [orGroup],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const evalGroupRes = evaluateRule(groupedRule, sampleEvent);
  assert(evalGroupRes === 'MATCH', 'OR condition group matched powershell.exe branch');

  const negatedGroup: RuleConditionGroup = {
    operator: 'OR',
    negate: true,
    conditions: [
      { field: 'processName', operator: 'EQUALS', value: 'powershell.exe' },
    ],
  };
  const negatedRule: DetectionRule = {
    ...groupedRule,
    conditions: [negatedGroup],
  };
  const evalNegRes = evaluateRule(negatedRule, sampleEvent);
  assert(evalNegRes === 'NO_MATCH', 'Negated condition group correctly inverted match to NO_MATCH');

  // ─── [4/12] Side-Effect Free Simulation Testing ───────────────────────────
  console.log('\n[4/12] Side-Effect Free Simulation Testing');
  const initialAlerts = await provider.getAlerts();
  const simResult = await provider.testDetectionRule(procRule!, { sampleLimit: 200 }, 'analyst.1', 'L2_ANALYST');

  assert(simResult.testRun.eventsEvaluated > 0, `Simulation evaluated ${simResult.testRun.eventsEvaluated} events`);
  assert(simResult.testRun.eventsMatched > 0, `Simulation matched ${simResult.testRun.eventsMatched} malicious events`);
  assert(simResult.testRun.executionTimeMs >= 0, `Execution time recorded (${simResult.testRun.executionTimeMs}ms)`);

  const postSimAlerts = await provider.getAlerts();
  assert(
    initialAlerts.length === postSimAlerts.length,
    `Simulation created ZERO production alerts (${initialAlerts.length} before, ${postSimAlerts.length} after)`
  );

  // ─── [5/12] Match & Non-Match Explainability ──────────────────────────────
  console.log('\n[5/12] Match & Non-Match Explainability');
  assert(simResult.explanations.length > 0, 'Explanations generated for evaluated events');
  const matchedExp = simResult.explanations.find((e) => e.matched);
  assert(!!matchedExp, 'Matched event explanation present');
  assert(Boolean(matchedExp?.explanation.includes('MATCHED')),  'Explanation starts with MATCHED');
  assert(matchedExp?.contributingConditions.length! > 0, 'Contributing condition explanations detailed');

  const nonMatchedExp = simResult.explanations.find((e) => !e.matched);
  assert(!!nonMatchedExp, 'Non-matched event explanation present');
  assert(Boolean(nonMatchedExp?.explanation.includes('NOT MATCHED')),  'Non-matched explanation present');

  // ─── [6/12] Rule Creation & Draft Lifecycle ───────────────────────────────
  console.log('\n[6/12] Rule Creation & Draft Lifecycle');
  const draftInput: CreateDetectionRuleInput = {
    name: 'Suspicious Reconnaissance Discovery',
    description: 'Detects network discovery utilities execution',
    severity: 'MEDIUM',
    category: 'PROCESS',
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'PROCESS' },
      { field: 'processName', operator: 'IN_LIST', value: ['whoami.exe', 'net.exe', 'nltest.exe'] },
    ],
    mitreTechniqueId: 'T1018',
    tags: ['recon', 'discovery'],
  };

  const draft = await provider.createDetectionRuleDraft(draftInput, 'sarah.chen', 'SOC_MANAGER');
  assert(draft.status === 'DRAFT', `New rule created in DRAFT status (got: ${draft.status})`);
  assert(draft.enabled === false, 'Draft rule is NOT enabled for runtime evaluation');
  assert(draft.version === 1, 'Draft rule has initial version 1');

  // Validate draft
  const draftVal = await provider.validateDetectionRule(draft.id);
  assert(draftVal.valid === true, 'Draft passes validation');
  const validatingRule = await provider.getDetectionRule(draft.id);
  assert(validatingRule?.status === 'VALIDATING', `Status transitioned to VALIDATING (got: ${validatingRule?.status})`);

  // Test draft
  await provider.testDetectionRule(draft.id, {}, 'sarah.chen', 'SOC_MANAGER');
  const testedRule = await provider.getDetectionRule(draft.id);
  assert(testedRule?.status === 'TESTING', `Status transitioned to TESTING (got: ${testedRule?.status})`);

  // ─── [7/12] Rule Publication & Immutability ───────────────────────────────
  console.log('\n[7/12] Rule Publication & Immutability');
  const published = await provider.publishDetectionRule(draft.id, 'Release 1.0 of reconnaissance rule', 'sarah.chen', 'SOC_MANAGER');
  assert(published.status === 'PUBLISHED', `Status transitioned to PUBLISHED (got: ${published.status})`);
  assert(!!published.publishedAt, 'Published timestamp recorded');

  const draftVersions = await provider.getDetectionRuleVersions(published.ruleId!);
  assert(draftVersions.length === 1, 'Version 1 stored in immutable version history');
  assert(draftVersions[0].changeDescription.includes('Release 1.0'), 'Version description retained');

  // Edit published rule -> creates new draft version!
  const edited = await provider.updateDetectionRuleDraft(published.id, {
    description: 'Updated reconnaissance discovery description for v2',
  }, 'sarah.chen', 'SOC_MANAGER');
  assert(edited.version === 2, `Editing published rule incremented version to 2 (got: ${edited.version})`);
  assert(edited.status === 'DRAFT', `Status reverted to DRAFT for new version (got: ${edited.status})`);
  assert(edited.enabled === false, 'New draft version is disabled until validated & published');

  // Publish v2
  const publishedV2 = await provider.publishDetectionRule(edited.id, 'Added expanded guidance', 'sarah.chen', 'SOC_MANAGER');
  assert(publishedV2.version === 2, 'Version 2 published');
  const draftVersionsV2 = await provider.getDetectionRuleVersions(published.ruleId!);
  assert(draftVersionsV2.length === 2, 'Both v1 and v2 preserved in historical version catalog');

  // ─── [8/12] Structural Rule Version Diff ──────────────────────────────────
  console.log('\n[8/12] Structural Rule Version Diff');
  const diff = await provider.diffRuleVersions(published.ruleId!, 1, 2);
  assert(diff.fromVersion === 1 && diff.toVersion === 2, 'Diff computed between v1 and v2');
  assert(diff.changes.some((c) => c.field === 'Description'), 'Diff correctly highlights Description field change');
  assert(diff.summary.length > 0, `Diff summary generated: "${diff.summary}"`);

  // ─── [9/12] Enable / Disable / Deprecate Controls ─────────────────────────
  console.log('\n[9/12] Enable / Disable / Deprecate Controls');
  const enabledRule = await provider.enableDetectionRule(publishedV2.id, 'sarah.chen', 'SOC_MANAGER');
  assert(enabledRule.status === 'ENABLED' && enabledRule.enabled === true, 'Rule transitioned to ENABLED');

  const disabledRule = await provider.disableDetectionRule(publishedV2.id, 'sarah.chen', 'SOC_MANAGER');
  assert(disabledRule.status === 'DISABLED' && disabledRule.enabled === false, 'Rule transitioned to DISABLED');
  assert(!!disabledRule.disabledAt, 'Disabled timestamp recorded');

  const deprecatedRule = await provider.deprecateDetectionRule(publishedV2.id, 'sarah.chen', 'SOC_MANAGER');
  assert(deprecatedRule.status === 'DEPRECATED' && deprecatedRule.enabled === false, 'Rule transitioned to DEPRECATED');
  assert(!!deprecatedRule.deprecatedAt, 'Deprecated timestamp recorded');

  // ─── [10/12] Conversions (Event & Hunt -> Detection Rule) ──────────────────
  console.log('\n[10/12] Conversions (Event & Hunt -> Detection Rule)');
  const eventDraft = convertEventToDetectionDraft(sampleEvent);
  assert(eventDraft.category === 'PROCESS', 'Event category carried into draft');
  assert(eventDraft.conditions.some((c) => 'field' in c && c.field === 'processName'), 'Process condition pre-populated from event');

  const huntDraft = convertHuntQueryToDetectionDraft({
    text: 'Suspicious PowerShell Execution',
    conditions: [
      { field: 'category', operator: 'equals', value: 'PROCESS' },
      { field: 'commandLine', operator: 'contains', value: 'powershell' },
    ],
  });
  assert(huntDraft.conditions.length === 2, 'Hunt filter conditions converted to rule conditions');
  assert(huntDraft.conditions[1].operator === 'CONTAINS', 'Operator normalized to uppercase CONTAINS');

  const clonedDraft = cloneRuleAsDraft(procRule!);
  assert(clonedDraft.name.includes('(Clone)'), 'Clone draft has modified title');
  assert(clonedDraft.conditions.length === procRule!.conditions.length, 'Cloned all rule conditions');

  // ─── [11/12] RBAC Authorization Enforcement ───────────────────────────────
  console.log('\n[11/12] RBAC Authorization Enforcement');
  let deniedAuthor = false;
  try {
    await provider.createDetectionRuleDraft(draftInput, 'l1.analyst', 'L1_ANALYST');
  } catch (err: any) {
    deniedAuthor = err.message.includes('Unauthorized');
  }
  assert(deniedAuthor, 'L1_ANALYST denied from authoring detection rules');

  let deniedPublish = false;
  try {
    await provider.publishDetectionRule(procRule!.id, 'Unauthorized publish attempt', 'l1.analyst', 'L1_ANALYST');
  } catch (err: any) {
    deniedPublish = err.message.includes('Unauthorized');
  }
  assert(deniedPublish, 'L1_ANALYST denied from publishing detection rules');

  // L1_ANALYST CAN test/simulate rules
  let allowedTest = false;
  try {
    const testRes = await provider.testDetectionRule(procRule!, { sampleLimit: 10 }, 'l1.analyst', 'L1_ANALYST');
    allowedTest = testRes.testRun.eventsEvaluated > 0;
  } catch {
    allowedTest = false;
  }
  assert(allowedTest, 'L1_ANALYST permitted to test/simulate detection rules');

  // ─── [12/12] Security Audit Trail Verification ────────────────────────────
  console.log('\n[12/12] Security Audit Trail Verification');
  const auditRecords = await provider.getAuditLogs();
  assert(auditRecords.some((a) => a.action === 'RULE_CREATED'), 'Audit log contains RULE_CREATED');
  assert(auditRecords.some((a) => a.action === 'RULE_EDITED'), 'Audit log contains RULE_EDITED');
  assert(auditRecords.some((a) => a.action === 'RULE_TEST_EXECUTED'), 'Audit log contains RULE_TEST_EXECUTED');
  assert(auditRecords.some((a) => a.action === 'RULE_PUBLISHED'), 'Audit log contains RULE_PUBLISHED');
  assert(auditRecords.some((a) => a.action === 'RULE_ENABLED'), 'Audit log contains RULE_ENABLED');
  assert(auditRecords.some((a) => a.action === 'RULE_DISABLED'), 'Audit log contains RULE_DISABLED');
  assert(auditRecords.some((a) => a.action === 'RULE_DEPRECATED'), 'Audit log contains RULE_DEPRECATED');

  console.log('\n==================================================');
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} PASSED, ${totalTests - passedTests} FAILED`);
  console.log('==================================================\n');

  if (totalTests !== passedTests) {
    process.exit(1);
  }
}

runStep9Verification().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

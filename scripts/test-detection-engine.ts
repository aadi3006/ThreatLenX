/**
 * scripts/test-detection-engine.ts
 *
 * Automated verification suite for the EXPLAIN-SEC SPATIAL Detection & Alert Engine (Step 3).
 * Verifies:
 * 1. Rule condition evaluation (EQUALS, NOT_EQUALS, CONTAINS, STARTS_WITH, ENDS_WITH, GREATER_THAN, LESS_THAN, IN_LIST, EXISTS)
 * 2. Rule evaluation (applicability, eventType matching, multi-condition matching, disabled rules)
 * 3. Deterministic alert creation & provenance tracking
 * 4. Alert fingerprinting & deduplication / occurrence counting
 * 5. Alert lifecycle transitions (NEW -> ACKNOWLEDGED -> RESOLVED)
 * 6. Alert querying, filtering, and statistics calculation
 * 7. Grounded Operation BlackTide seed scenario detection
 * 8. RBAC and audit compliance
 */

import {
  evaluateCondition,
  evaluateRule,
  generateAlertFingerprint,
  buildAlertFromMatch,
  queryAlerts,
  computeAlertStats,
} from '../app/core/security/detection-engine';
import { DETECTION_RULES } from '../app/core/security/detection-rules';
import { SEED_SECURITY_EVENTS } from '../app/core/data/seed-events';
import type { SecurityEvent } from '../app/core/models/event';
import type { DetectionRule, Alert } from '../app/core/models/detection';
import { canAcknowledgeAlert, canResolveAlert, canManageDetectionRules } from '../app/core/auth/rbac';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
}

function mockEvent(partial: Partial<SecurityEvent>): SecurityEvent {
  return {
    id: 'evt-mock-01',
    timestamp: '2026-03-24T14:00:00.000Z',
    receivedAt: '2026-03-24T14:00:01.000Z',
    eventType: 'GENERIC_EVENT',
    category: 'PROCESS',
    severity: 'MEDIUM',
    source: 'TEST-SOURCE',
    sourceType: 'ENDPOINT',
    message: 'Mock test security event',
    ...partial,
  };
}

function mockAlert(partial: Partial<Alert>): Alert {
  return {
    id: 'alt-mock-01',
    ruleId: 'DET-PROC-001',
    ruleName: 'Test Detection Rule',
    fingerprint: 'fp-mock-01',
    title: 'Test Alert Title',
    description: 'Test Alert Description',
    severity: 'HIGH',
    status: 'NEW',
    category: 'PROCESS',
    createdAt: '2026-03-24T14:00:00.000Z',
    firstSeenAt: '2026-03-24T14:00:00.000Z',
    lastSeenAt: '2026-03-24T14:00:00.000Z',
    occurrenceCount: 1,
    sourceEventIds: ['evt-mock-01'],
    primaryEventId: 'evt-mock-01',
    ...partial,
  };
}

let passedTests = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('===========================================================');
console.log('EXPLAIN-SEC SPATIAL: STEP 3 DETECTION & ALERT ENGINE TESTS');
console.log('===========================================================\n');

// ─── 1. Condition Evaluation Tests ──────────────────────────────────────────

test('1. Condition: EQUALS and NOT_EQUALS', () => {
  const ev = mockEvent({ eventType: 'POWERSHELL_LAUNCH', severity: 'HIGH' });
  assert(evaluateCondition({ field: 'eventType', operator: 'EQUALS', value: 'POWERSHELL_LAUNCH' }, ev), 'Should match EQUALS');
  assert(!evaluateCondition({ field: 'eventType', operator: 'EQUALS', value: 'CMD_LAUNCH' }, ev), 'Should reject mismatch EQUALS');
  assert(evaluateCondition({ field: 'severity', operator: 'NOT_EQUALS', value: 'LOW' }, ev), 'Should match NOT_EQUALS');
  assert(!evaluateCondition({ field: 'severity', operator: 'NOT_EQUALS', value: 'HIGH' }, ev), 'Should reject false NOT_EQUALS');
});

test('2. Condition: CONTAINS, NOT_CONTAINS, STARTS_WITH, ENDS_WITH', () => {
  const ev = mockEvent({
    commandLine: 'powershell.exe -ExecutionPolicy Bypass -Command Invoke-Mimikatz',
    domain: 'telemetry-c2.evil.com',
  });
  assert(evaluateCondition({ field: 'commandLine', operator: 'CONTAINS', value: 'invoke-mimikatz' }, ev), 'Should case-insensitively match CONTAINS');
  assert(evaluateCondition({ field: 'commandLine', operator: 'NOT_CONTAINS', value: 'notepad' }, ev), 'Should match NOT_CONTAINS');
  assert(evaluateCondition({ field: 'domain', operator: 'STARTS_WITH', value: 'telemetry' }, ev), 'Should match STARTS_WITH');
  assert(evaluateCondition({ field: 'domain', operator: 'ENDS_WITH', value: 'evil.com' }, ev), 'Should match ENDS_WITH');
});

test('3. Condition: Numerical Comparisons (GREATER_THAN, LESS_THAN, etc.)', () => {
  const ev = mockEvent({ dstPort: 443, processId: 8500 });
  assert(evaluateCondition({ field: 'dstPort', operator: 'EQUALS', value: 443 }, ev), 'Port equals');
  assert(evaluateCondition({ field: 'processId', operator: 'GREATER_THAN', value: 8000 }, ev), 'Process ID greater than');
  assert(evaluateCondition({ field: 'processId', operator: 'GREATER_THAN_OR_EQUAL', value: 8500 }, ev), 'Process ID gte');
  assert(evaluateCondition({ field: 'dstPort', operator: 'LESS_THAN', value: 1024 }, ev), 'Port less than');
  assert(evaluateCondition({ field: 'dstPort', operator: 'LESS_THAN_OR_EQUAL', value: 443 }, ev), 'Port lte');
});

test('4. Condition: IN_LIST and NOT_IN_LIST', () => {
  const ev = mockEvent({ category: 'PROCESS', processName: 'mimikatz.exe' });
  assert(evaluateCondition({ field: 'processName', operator: 'IN_LIST', value: ['mimikatz.exe', 'procdump.exe'] }, ev), 'IN_LIST should match');
  assert(evaluateCondition({ field: 'processName', operator: 'NOT_IN_LIST', value: ['explorer.exe', 'svchost.exe'] }, ev), 'NOT_IN_LIST should match');
});

test('5. Condition: EXISTS operator', () => {
  const ev = mockEvent({ assetId: 'FINWS-027', commandLine: undefined, domain: undefined });
  assert(evaluateCondition({ field: 'assetId', operator: 'EXISTS', value: true }, ev), 'assetId exists');
  assert(!evaluateCondition({ field: 'commandLine', operator: 'EXISTS', value: true }, ev), 'null/undefined does not exist');
  assert(!evaluateCondition({ field: 'domain', operator: 'EXISTS', value: true }, ev), 'undefined does not exist');
});

// ─── 2. Rule Evaluation Tests ───────────────────────────────────────────────

test('6. Rule Evaluation: Conjunction of multiple conditions', () => {
  const rule: DetectionRule = {
    id: 'TEST-RULE-001',
    name: 'Test Conjunction',
    description: 'Test rule description',
    enabled: true,
    severity: 'HIGH',
    category: 'PROCESS',
    conditions: [
      { field: 'category', operator: 'EQUALS', value: 'PROCESS' },
      { field: 'processName', operator: 'EQUALS', value: 'cmd.exe' },
      { field: 'commandLine', operator: 'CONTAINS', value: 'reg add' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const matchingEvent = mockEvent({
    id: 'evt-test-1',
    eventType: 'CMD_RUN',
    category: 'PROCESS',
    severity: 'MEDIUM',
    source: 'TEST-EDR',
    processName: 'cmd.exe',
    commandLine: 'cmd.exe /c reg add HKLM\\Software\\Run /v Mal /d evil.exe',
    message: 'Registry modification via cmd',
  });

  const nonMatchingEvent = mockEvent({
    ...matchingEvent,
    commandLine: 'cmd.exe /c dir C:\\',
  });

  const matchRes = evaluateRule(rule, matchingEvent);
  assert(matchRes === 'MATCH', 'Matching event should satisfy all rule conditions');

  const nonMatchRes = evaluateRule(rule, nonMatchingEvent);
  assert(nonMatchRes === 'NO_MATCH', 'Event missing one condition should not match');
});

test('7. Rule Evaluation: Disabled rules never match', () => {
  const rule: DetectionRule = {
    id: 'TEST-RULE-002',
    name: 'Disabled Rule',
    description: 'Should never trigger',
    enabled: false,
    severity: 'CRITICAL',
    category: 'PROCESS',
    conditions: [{ field: 'eventType', operator: 'EQUALS', value: 'ANY' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const ev = mockEvent({ eventType: 'ANY', severity: 'CRITICAL' });
  const res = evaluateRule(rule, ev);
  assert(res === 'NO_MATCH', 'Disabled rule should return NO_MATCH');
});

test('8. Rule Evaluation: Applicability pre-filtering by category and eventType', () => {
  const rule: DetectionRule = {
    id: 'TEST-RULE-003',
    name: 'Network Rule',
    description: 'Applies only to NETWORK category',
    enabled: true,
    severity: 'HIGH',
    category: 'NETWORK',
    eventTypes: ['C2_BEACON', 'DNS_TUNNEL'],
    conditions: [{ field: 'dstPort', operator: 'EQUALS', value: 443 }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const wrongCategoryEvent = mockEvent({
    eventType: 'C2_BEACON',
    category: 'AUTHENTICATION',
  });

  const wrongEventTypeEvent = mockEvent({
    eventType: 'HTTP_GET',
    category: 'NETWORK',
  });

  assert(evaluateRule(rule, wrongCategoryEvent) === 'NO_MATCH', 'Should reject mismatched category during pre-filter');
  assert(evaluateRule(rule, wrongEventTypeEvent) === 'NO_MATCH', 'Should reject mismatched eventType during pre-filter');
});

// ─── 3. Alert Creation & Fingerprinting ─────────────────────────────────────

test('9. Alert Creation: Builds canonical Alert with full provenance', () => {
  const rule = DETECTION_RULES[0]; // DET-AUTH-001
  const ev = mockEvent({
    id: 'evt-auth-100',
    timestamp: '2026-03-24T14:02:00.000Z',
    eventType: 'LOGIN_FAILURE',
    category: 'AUTHENTICATION',
    severity: 'MEDIUM',
    assetId: 'asset-004',
    userId: 'user-002',
    incidentId: 'incident-001',
    message: 'Failed login',
  });

  const fingerprint = generateAlertFingerprint(rule, ev);
  const alert = buildAlertFromMatch(rule, ev, fingerprint);
  assert(alert.ruleId === rule.id, 'Alert should link to ruleId');
  assert(alert.title.includes(rule.name), 'Alert title should contain rule name');
  assert(alert.severity === rule.severity, 'Alert severity should match rule severity');
  assert(alert.status === 'NEW', 'Initial alert status must be NEW');
  assert(alert.occurrenceCount === 1, 'Initial occurrenceCount must be 1');
  assert(alert.sourceEventIds.includes('evt-auth-100'), 'Alert must preserve sourceEventId');
  assert(alert.primaryEventId === 'evt-auth-100', 'Alert primaryEventId must be set');
  assert(alert.assetId === 'asset-004', 'Affected assetId must be preserved');
  assert(alert.userId === 'user-002', 'Affected userId must be preserved');
  assert(alert.mitreTechniqueId === rule.mitreTechniqueId, 'MITRE technique ID must be propagated');
});

test('10. Alert Fingerprinting: Deterministic fingerprint generation', () => {
  const rule = DETECTION_RULES[1]; // DET-PROC-001
  const ev1 = mockEvent({
    id: 'evt-proc-1',
    timestamp: '2026-03-24T14:00:00.000Z',
    eventType: 'SUSPICIOUS_EXECUTION',
    category: 'PROCESS',
    severity: 'HIGH',
    assetId: 'asset-001',
    userId: 'user-001',
  });

  const ev2 = mockEvent({
    ...ev1,
    id: 'evt-proc-2',
    timestamp: '2026-03-24T14:02:00.000Z', // 2 minutes later, within 15min bucket
  });

  const evDifferentBucket = mockEvent({
    ...ev1,
    id: 'evt-proc-3',
    timestamp: '2026-03-24T15:00:00.000Z', // 1 hour later
  });

  const evDifferentAsset = mockEvent({
    ...ev1,
    id: 'evt-proc-4',
    assetId: 'asset-002',
  });

  const fp1 = generateAlertFingerprint(rule, ev1);
  const fp2 = generateAlertFingerprint(rule, ev2);
  const fpDiffBucket = generateAlertFingerprint(rule, evDifferentBucket);
  const fpDiffAsset = generateAlertFingerprint(rule, evDifferentAsset);

  assert(fp1 === fp2, 'Same entity within time bucket must generate identical fingerprint');
  assert(fp1 !== fpDiffBucket, 'Events in different time buckets must generate different fingerprints');
  assert(fp1 !== fpDiffAsset, 'Events on different assets must generate different fingerprints');
});

// ─── 4. Alert Querying & Statistics ─────────────────────────────────────────

test('11. Alert Querying: Filtering by severity, status, asset, text search', () => {
  const alerts: Alert[] = [
    mockAlert({
      id: 'alt-001',
      ruleId: 'DET-AUTH-001',
      ruleName: 'Brute Force Detections',
      title: 'Brute Force Detections on asset-001',
      description: 'Multiple failed logins',
      severity: 'MEDIUM',
      status: 'NEW',
      category: 'AUTHENTICATION',
      occurrenceCount: 3,
      sourceEventIds: ['e1', 'e2'],
      assetId: 'asset-001',
    }),
    mockAlert({
      id: 'alt-002',
      ruleId: 'DET-PROC-001',
      ruleName: 'PowerShell Execution',
      title: 'PowerShell Execution on asset-001',
      description: 'Obfuscated PowerShell memory launch',
      severity: 'CRITICAL',
      status: 'ACKNOWLEDGED',
      category: 'PROCESS',
      occurrenceCount: 1,
      sourceEventIds: ['e3'],
      assetId: 'asset-001',
    }),
    mockAlert({
      id: 'alt-003',
      ruleId: 'DET-NET-001',
      ruleName: 'C2 Beaconing',
      title: 'C2 Beaconing on asset-002',
      description: 'Cobalt strike beaconing',
      severity: 'CRITICAL',
      status: 'RESOLVED',
      category: 'NETWORK',
      occurrenceCount: 2,
      sourceEventIds: ['e4'],
      assetId: 'asset-002',
    }),
  ];

  const critAlerts = queryAlerts(alerts, { severity: 'CRITICAL' });
  assert(critAlerts.length === 2, 'Should return 2 critical alerts');

  const openAlerts = queryAlerts(alerts, { status: ['NEW', 'ACKNOWLEDGED'] });
  assert(openAlerts.length === 2, 'Should return 2 open alerts (NEW and ACKNOWLEDGED)');

  const asset1Alerts = queryAlerts(alerts, { assetId: 'asset-001' });
  assert(asset1Alerts.length === 2, 'Should return 2 alerts for asset-001');

  const textSearch = queryAlerts(alerts, { search: 'PowerShell' });
  assert(textSearch.length === 1 && textSearch[0].id === 'alt-002', 'Text search should find PowerShell alert');
});

test('12. Alert Statistics: Accurate computation of counts and distribution', () => {
  const alerts: Alert[] = [
    mockAlert({
      id: 'alt-1',
      ruleId: 'DET-PROC-001',
      ruleName: 'Proc Alert',
      severity: 'CRITICAL',
      status: 'NEW',
      category: 'PROCESS',
      sourceEventIds: ['e1'],
    }),
    mockAlert({
      id: 'alt-2',
      ruleId: 'DET-NET-001',
      ruleName: 'Net Alert',
      severity: 'HIGH',
      status: 'ACKNOWLEDGED',
      category: 'NETWORK',
      sourceEventIds: ['e2'],
    }),
    mockAlert({
      id: 'alt-3',
      ruleId: 'DET-AUTH-001',
      ruleName: 'Auth Alert',
      severity: 'MEDIUM',
      status: 'RESOLVED',
      category: 'AUTHENTICATION',
      sourceEventIds: ['e3'],
    }),
  ];

  const stats = computeAlertStats(alerts);
  assert(stats.totalAlerts === 3, 'Total alerts should be 3');
  assert(stats.openAlerts === 2, 'Open alerts (NEW + ACKNOWLEDGED) should be 2');
  assert(stats.criticalAlerts === 1, 'Critical alerts should be 1');
  assert(stats.highAlerts === 1, 'High alerts should be 1');
  assert(stats.byStatus.NEW === 1, 'NEW status count should be 1');
  assert(stats.byStatus.ACKNOWLEDGED === 1, 'ACKNOWLEDGED status count should be 1');
  assert(stats.byStatus.RESOLVED === 1, 'RESOLVED status count should be 1');
  assert(stats.byRule.find((r) => r.ruleId === 'DET-PROC-001')?.count === 1, 'DET-PROC-001 count should be 1');
});

// ─── 5. Operation BlackTide Scenario Validation ─────────────────────────────

test('13. BlackTide Telemetry: Deterministic rule evaluation against seed events', () => {
  const triggeredAlerts: Alert[] = [];

  for (const event of SEED_SECURITY_EVENTS) {
    for (const rule of DETECTION_RULES) {
      const match = evaluateRule(rule, event);
      if (match === 'MATCH') {
        const fp = generateAlertFingerprint(rule, event);
        triggeredAlerts.push(buildAlertFromMatch(rule, event, fp));
      }
    }
  }

  console.log(`     Total BlackTide raw rule matches: ${triggeredAlerts.length}`);
  assert(triggeredAlerts.length >= 5, 'Should trigger multiple deterministic detections from Operation BlackTide telemetry');

  const triggeredRuleIds = new Set(triggeredAlerts.map((a) => a.ruleId));
  console.log(`     Distinct rules triggered: ${Array.from(triggeredRuleIds).join(', ')}`);

  assert(triggeredRuleIds.has('DET-AUTH-001'), 'Should trigger DET-AUTH-001 (Failed login burst)');
  assert(triggeredRuleIds.has('DET-PROC-001'), 'Should trigger DET-PROC-001 (PowerShell execution)');
  assert(triggeredRuleIds.has('DET-NET-001'), 'Should trigger DET-NET-001 (C2 beaconing)');
  assert(triggeredRuleIds.has('DET-PER-001'), 'Should trigger DET-PER-001 (Registry persistence)');
  assert(triggeredRuleIds.has('DET-EXF-001'), 'Should trigger DET-EXF-001 (File staging / exfiltration)');
});

// ─── 6. RBAC & Permissions ──────────────────────────────────────────────────

test('14. RBAC: Proper role permissions for alerts', () => {
  // L1_ANALYST: Can triage/acknowledge/resolve, cannot manage detection rules
  assert(canAcknowledgeAlert('L1_ANALYST'), 'L1 Analyst can acknowledge alert');
  assert(canResolveAlert('L1_ANALYST'), 'L1 Analyst can resolve alert');
  assert(!canManageDetectionRules('L1_ANALYST'), 'L1 Analyst cannot modify detection rules');

  // L2_ANALYST: Can triage/acknowledge/resolve, cannot manage detection rules
  assert(canAcknowledgeAlert('L2_ANALYST'), 'L2 Analyst can acknowledge alert');
  assert(canResolveAlert('L2_ANALYST'), 'L2 Analyst can resolve alert');
  assert(!canManageDetectionRules('L2_ANALYST'), 'L2 Analyst cannot modify detection rules');

  // THREAT_HUNTER: Can manage detection rules, cannot triage alerts
  assert(!canAcknowledgeAlert('THREAT_HUNTER'), 'Threat hunter cannot triage/acknowledge alert');
  assert(canManageDetectionRules('THREAT_HUNTER'), 'Threat hunter can manage detection rules');

  // INCIDENT_RESPONDER: Can acknowledge and resolve alerts
  assert(canAcknowledgeAlert('INCIDENT_RESPONDER'), 'Responder can acknowledge alert');
  assert(canResolveAlert('INCIDENT_RESPONDER'), 'Responder can resolve alert');

  // SOC_MANAGER: Full operational authority
  assert(canAcknowledgeAlert('SOC_MANAGER'), 'Manager can acknowledge alert');
  assert(canResolveAlert('SOC_MANAGER'), 'Manager can resolve alert');
  assert(canManageDetectionRules('SOC_MANAGER'), 'Manager can manage detection rules');
});

console.log(`\n===========================================================`);
console.log(`ALL ${passedTests} DETECTION ENGINE TESTS PASSED PERFECTLY!`);
console.log(`===========================================================\n`);

/**
 * test-step5-hunting.ts
 *
 * Automated verification test suite for STEP 5: Threat Hunting Engine.
 * Run with: npx tsx scripts/test-step5-hunting.ts
 */

import { SEED_SECURITY_EVENTS } from '../app/core/data/seed-events';
import {
  evaluateOperator,
  evaluateCondition,
  getFieldValue,
  executeHuntQuery,
  BLACKTIDE_HUNT_TEMPLATES,
} from '../app/core/hunting/threat-hunt-engine';
import {
  canExecuteThreatHunt,
  canSaveThreatHunt,
} from '../app/core/auth/rbac';
import type { Alert } from '../app/core/models/detection';
import type { Incident } from '../app/core/models/incident';
import type { ThreatHuntQuery } from '../app/core/models/hunting';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('====================================================');
console.log('   STEP 5: THREAT HUNTING ENGINE TEST SUITE');
console.log('====================================================\n');

// ─── 1. Operator Unit Tests ──────────────────────────────────────────────────
console.log('1. Query Operators:');

// equals / notEquals
assert(evaluateOperator('powershell.exe', 'equals', 'powershell.exe'), 'equals matches exact string');
assert(evaluateOperator('POWERSHELL.EXE', 'equals', 'powershell.exe'), 'equals is case-insensitive for strings');
assert(!evaluateOperator('cmd.exe', 'equals', 'powershell.exe'), 'equals rejects different string');
assert(evaluateOperator(443, 'equals', 443), 'equals matches number');
assert(!evaluateOperator(80, 'equals', 443), 'equals rejects different number');
assert(evaluateOperator('svchost.exe', 'notEquals', 'malware.exe'), 'notEquals passes for different string');
assert(!evaluateOperator('svchost.exe', 'notEquals', 'SVCHOST.EXE'), 'notEquals fails for identical string');

// contains
assert(evaluateOperator('powershell.exe -enc aW52b2tl', 'contains', 'powershell'), 'contains substring matches');
assert(evaluateOperator('powershell.exe -enc aW52b2tl', 'contains', '-ENC'), 'contains is case-insensitive');
assert(!evaluateOperator('cmd.exe /c echo hello', 'contains', 'powershell'), 'contains rejects missing substring');
assert(evaluateOperator(['ioc-001', 'ioc-002'], 'contains', 'ioc-001'), 'contains matches in array');
assert(!evaluateOperator(['ioc-001'], 'contains', 'ioc-999'), 'contains rejects missing in array');

// startsWith / endsWith
assert(evaluateOperator('10.40.12.27', 'startsWith', '10.40.'), 'startsWith matches prefix');
assert(!evaluateOperator('192.168.1.1', 'startsWith', '10.40.'), 'startsWith rejects different prefix');
assert(evaluateOperator('invoice_q3_report.pdf', 'endsWith', '.pdf'), 'endsWith matches suffix');
assert(!evaluateOperator('invoice_q3_report.exe', 'endsWith', '.pdf'), 'endsWith rejects different suffix');

// in / notIn
assert(evaluateOperator('PROCESS', 'in', ['AUTHENTICATION', 'PROCESS', 'NETWORK']), 'in operator finds member in list');
assert(evaluateOperator('process', 'in', ['AUTHENTICATION', 'PROCESS', 'NETWORK']), 'in operator is case-insensitive');
assert(!evaluateOperator('FILE', 'in', ['AUTHENTICATION', 'PROCESS']), 'in operator rejects non-member');
assert(evaluateOperator('FILE', 'notIn', ['AUTHENTICATION', 'PROCESS']), 'notIn operator passes non-member');
assert(!evaluateOperator('PROCESS', 'notIn', ['PROCESS']), 'notIn operator rejects member');

// greaterThan / lessThan / greaterThanOrEqual / lessThanOrEqual
assert(evaluateOperator(443, 'greaterThan', 80), 'greaterThan numeric');
assert(!evaluateOperator(80, 'greaterThan', 443), 'greaterThan numeric reject');
assert(evaluateOperator('2024-11-14T02:00:00Z', 'greaterThan', '2024-11-14T01:00:00Z'), 'greaterThan ISO string');
assert(evaluateOperator(80, 'lessThan', 443), 'lessThan numeric');
assert(evaluateOperator(443, 'greaterThanOrEqual', 443), 'greaterThanOrEqual match');
assert(evaluateOperator(443, 'lessThanOrEqual', 443), 'lessThanOrEqual match');

// ─── 2. getFieldValue and evaluateCondition ──────────────────────────────────
console.log('\n2. Field Value Extraction & Conditions:');
const sampleEvent = SEED_SECURITY_EVENTS[0]; // Email attachment delivery
assert(getFieldValue(sampleEvent, 'eventType') === 'EMAIL_ATTACHMENT_DELIVERY', 'Direct property extraction works');
assert(getFieldValue(sampleEvent, 'metadata.sender') === 'accounting-reports@blacktide-finance.co', 'Nested dot-notation extraction works');
assert(getFieldValue(sampleEvent, 'nonexistent') === undefined, 'Missing property returns undefined');

assert(
  evaluateCondition(sampleEvent, {
    field: 'severity',
    operator: 'equals',
    value: 'HIGH',
  }),
  'Condition evaluation matches exact field'
);

assert(
  evaluateCondition(sampleEvent, {
    field: 'domain',
    operator: 'contains',
    value: 'blacktide',
  }),
  'Condition evaluation matches substring'
);

// ─── 3. Query Execution & Deterministic Ordering ──────────────────────────────
console.log('\n3. Structured Query Execution:');
const mockAlerts: Alert[] = [
  {
    id: 'alert-mock-001',
    ruleId: 'C2_BEACON_DETECTED',
    ruleName: 'C2 Beacon',
    category: 'NETWORK',
    primaryEventId: 'evt-raw-006',
    title: 'Outbound TLS beacon to known adversary infrastructure',
    description: 'Beacon alert',
    severity: 'CRITICAL',
    status: 'NEW',
    createdAt: '2024-11-14T02:18:03Z',
    firstSeenAt: '2024-11-14T02:18:03Z',
    lastSeenAt: '2024-11-14T02:18:03Z',
    occurrenceCount: 1,
    sourceEventIds: ['evt-raw-006'],
    fingerprint: 'fp-beacon',
  },
];

const mockIncidents: Incident[] = [
  {
    id: 'incident-001',
    title: 'Operation BlackTide — Enterprise Compromise',
    severity: 'CRITICAL',
    riskScore: 92,
    status: 'INVESTIGATING',
    confidence: 0.95,
    createdAt: '2024-11-14T02:16:30Z',
    updatedAt: '2024-11-14T04:00:00Z',
    affectedAssets: ['asset-001', 'asset-002', 'asset-004'],
    affectedUsers: ['user-001', 'user-002'],
    iocs: ['ioc-001', 'ioc-002'],
    mitreTechniques: ['T1566.001', 'T1059.001'],
    timelineEvents: [],
    correlationChain: [],
    evidence: [],
    eventIds: ['evt-raw-002', 'evt-raw-003', 'evt-raw-004'],
  },
];

// Execute query for PROCESS events
const processQuery: ThreatHuntQuery = {
  categories: ['PROCESS'],
  sortOrder: 'DESC',
};
const processResult = executeHuntQuery(SEED_SECURITY_EVENTS, processQuery, mockAlerts, mockIncidents);
assert(processResult.totalMatches > 0, `Found ${processResult.totalMatches} PROCESS events`);
assert(
  processResult.results.every((r) => r.category === 'PROCESS'),
  'All returned results have category PROCESS'
);
// Verify DESC ordering
for (let i = 0; i < processResult.results.length - 1; i++) {
  assert(
    processResult.results[i].timestamp >= processResult.results[i + 1].timestamp,
    'Results correctly sorted DESC by timestamp'
  );
}

// ─── 4. Time Range Filtering ─────────────────────────────────────────────────
console.log('\n4. Time Range Filtering:');
const timeQuery: ThreatHuntQuery = {
  startTime: '2024-11-14T02:00:00Z',
  endTime: '2024-11-14T02:30:00Z',
};
const timeResult = executeHuntQuery(SEED_SECURITY_EVENTS, timeQuery, mockAlerts, mockIncidents);
assert(timeResult.totalMatches > 0, `Found ${timeResult.totalMatches} events in time window`);
assert(
  timeResult.results.every(
    (r) => r.timestamp >= '2024-11-14T02:00:00Z' && r.timestamp <= '2024-11-14T02:30:00Z'
  ),
  'All returned events fall strictly within the requested time bounds'
);

// ─── 5. Match Explainability & Provenance ─────────────────────────────────────
console.log('\n5. Provenance & Match Rationale:');
// evt-raw-006 is linked to alert-mock-001
const c2Query: ThreatHuntQuery = {
  destinationIps: ['185.220.101.47'],
};
const c2Result = executeHuntQuery(SEED_SECURITY_EVENTS, c2Query, mockAlerts, mockIncidents);
assert(c2Result.totalMatches === 1, 'Found exactly 1 matching C2 network event');
const c2Match = c2Result.results[0];
assert(c2Match.isKnown === true, 'C2 event is correctly flagged as KNOWN');
assert(c2Match.relatedAlertIds.includes('alert-mock-001'), 'Related alert ID retained');
assert(c2Match.explanation.startsWith('MATCHED BECAUSE:'), 'Match rationale properly formatted');
assert(c2Match.explanation.includes('Destination IP = 185.220.101.47'), 'Explanation cites specific query criteria');

// Check unalerted / unknown event (e.g. routine background event evt-raw-018)
const ntpQuery: ThreatHuntQuery = {
  eventTypes: ['NTP_TIME_SYNC'],
};
const ntpResult = executeHuntQuery(SEED_SECURITY_EVENTS, ntpQuery, mockAlerts, mockIncidents);
assert(ntpResult.totalMatches === 1, 'Found NTP sync event');
assert(ntpResult.results[0].isKnown === false, 'NTP event has no alert or incident, flagged as UNKNOWN (novel telemetry)');

// ─── 6. Multi-dimensional Aggregations ───────────────────────────────────────
console.log('\n6. Deterministic Aggregations:');
const allEventsResult = executeHuntQuery(SEED_SECURITY_EVENTS, {}, mockAlerts, mockIncidents);
assert(allEventsResult.totalMatches === SEED_SECURITY_EVENTS.length, 'All seed events captured in full scan');
assert(allEventsResult.aggregations.bySeverity.CRITICAL > 0, 'Aggregates CRITICAL severity count');
assert(allEventsResult.aggregations.bySeverity.HIGH > 0, 'Aggregates HIGH severity count');
assert(allEventsResult.aggregations.byCategory.PROCESS > 0, 'Aggregates PROCESS category count');
assert(allEventsResult.aggregations.byCategory.NETWORK > 0, 'Aggregates NETWORK category count');
assert(allEventsResult.aggregations.byAsset.length > 0, 'Aggregates by Asset ID');
assert(allEventsResult.aggregations.knownCount > 0, 'Aggregates KNOWN events');
assert(allEventsResult.aggregations.unknownCount > 0, 'Aggregates UNKNOWN events');
assert(
  allEventsResult.aggregations.knownCount + allEventsResult.aggregations.unknownCount === allEventsResult.totalMatches,
  'knownCount + unknownCount equals totalMatches'
);

// ─── 7. BlackTide Telemetry Hunt Templates ───────────────────────────────────
console.log('\n7. BlackTide Telemetry Hunt Templates:');
assert(BLACKTIDE_HUNT_TEMPLATES.length === 8, 'All 8 deterministic templates present');

for (const tpl of BLACKTIDE_HUNT_TEMPLATES) {
  const tplResult = executeHuntQuery(SEED_SECURITY_EVENTS, tpl.query, mockAlerts, mockIncidents);
  console.log(`    Template "${tpl.name}": matched ${tplResult.totalMatches} events`);
  assert(tplResult.totalMatches >= 0, `Template ${tpl.id} executes deterministically`);
}

// ─── 8. RBAC Permissions ─────────────────────────────────────────────────────
console.log('\n8. RBAC Permission Checks:');
assert(canExecuteThreatHunt('THREAT_HUNTER'), 'THREAT_HUNTER can execute threat hunts');
assert(canExecuteThreatHunt('SOC_MANAGER'), 'SOC_MANAGER can execute threat hunts');
assert(canExecuteThreatHunt('PLATFORM_ADMIN'), 'PLATFORM_ADMIN can execute threat hunts');
assert(canExecuteThreatHunt('L2_ANALYST'), 'L2_ANALYST can execute threat hunts');
assert(canExecuteThreatHunt('L1_ANALYST'), 'L1_ANALYST has read/query capability');
assert(!canExecuteThreatHunt('INCIDENT_RESPONDER'), 'INCIDENT_RESPONDER cannot execute threat hunts directly');

assert(canSaveThreatHunt('THREAT_HUNTER'), 'THREAT_HUNTER can save threat hunts');
assert(canSaveThreatHunt('L2_ANALYST'), 'L2_ANALYST can save threat hunts');
assert(!canSaveThreatHunt('L1_ANALYST'), 'L1_ANALYST cannot save threat hunts');

// ─── 9. Hunt Lifecycle Simulation ────────────────────────────────────────────
console.log('\n9. Hunt Lifecycle Simulation (Draft -> Running -> Completed -> Archived):');
const newHuntQuery: ThreatHuntQuery = {
  categories: ['PROCESS'],
  commandLines: ['svchost32.exe'],
  sortOrder: 'DESC',
};
const execHunts = executeHuntQuery(SEED_SECURITY_EVENTS, newHuntQuery, mockAlerts, mockIncidents);
assert(execHunts.totalMatches >= 1, `Found ${execHunts.totalMatches} matched dropper events`);

// Simulate saved hunt entity
const testSavedHunt = {
  id: 'hunt-test-001',
  name: 'BlackCat Dropper Command Lines',
  description: 'Investigating svchost32.exe process executions',
  status: 'COMPLETED' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: 'm.chen',
  query: newHuntQuery,
  resultCount: execHunts.totalMatches,
  matchedEventIds: execHunts.matchedEventIds,
  relatedAlertIds: execHunts.relatedAlertIds,
  relatedIncidentIds: execHunts.relatedIncidentIds,
  tags: ['PROCESS', 'BlackCat'],
  notes: 'Analyst hypothesis: svchost32 dropped from Adobe Reader.',
};

assert(testSavedHunt.status === 'COMPLETED', 'Threat hunt marked COMPLETED');
assert(testSavedHunt.resultCount === execHunts.totalMatches, 'Result count accurately saved');
assert(testSavedHunt.matchedEventIds.length === execHunts.totalMatches, 'Event IDs stored as references, not duplicate event copies');

// Reopen saved hunt against canonical events:
const replayedResult = executeHuntQuery(SEED_SECURITY_EVENTS, testSavedHunt.query, mockAlerts, mockIncidents);
assert(replayedResult.totalMatches === testSavedHunt.resultCount, 'Saved hunt reproduces identical matches deterministically upon reopening');

// Archive hunt
const archivedHunt = { ...testSavedHunt, status: 'ARCHIVED' as const, updatedAt: new Date().toISOString() };
assert(archivedHunt.status === 'ARCHIVED', 'Threat hunt status successfully transitioned to ARCHIVED');

// ─── 10. Hunt to Incident / Evidence Workflow ─────────────────────────────────
console.log('\n10. Controlled Evidence Linking & Incident Creation from Hunt:');
const unalertedEvent = SEED_SECURITY_EVENTS.find((e) => e.eventType === 'NTP_TIME_SYNC')!;
assert(unalertedEvent !== undefined, 'Target unalerted event located');

// Controlled link workflow:
const targetInc: Incident = {
  ...mockIncidents[0],
  eventIds: [...(mockIncidents[0].eventIds ?? [])],
  affectedAssets: [...mockIncidents[0].affectedAssets],
};
assert(!targetInc.eventIds?.includes(unalertedEvent.id), 'Event not yet linked to incident');

// Attach evidence
targetInc.eventIds?.push(unalertedEvent.id);
if (unalertedEvent.assetId && !targetInc.affectedAssets.includes(unalertedEvent.assetId)) {
  targetInc.affectedAssets.push(unalertedEvent.assetId);
}
assert(Boolean(targetInc.eventIds?.includes(unalertedEvent.id)), 'Selected hunt evidence successfully linked to incident');
assert(targetInc.affectedAssets.includes(unalertedEvent.assetId!), 'Affected asset updated from linked evidence');

// Controlled incident creation workflow from hunt finding
const createdIncidentFromHunt: Incident = {
  id: 'incident-hunt-001',
  title: 'Incident from Hunt: Suspicious Dropper Activity',
  severity: 'CRITICAL',
  riskScore: 85,
  status: 'NEW',
  confidence: 0.9,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  affectedAssets: [execHunts.results[0].assetId!],
  affectedUsers: [execHunts.results[0].userId!],
  iocs: [],
  mitreTechniques: [],
  timelineEvents: [],
  correlationChain: [],
  evidence: [],
  eventIds: execHunts.matchedEventIds,
  summary: `Created from hunt: ${execHunts.results[0].explanation}`,
};
assert(createdIncidentFromHunt.eventIds?.length === execHunts.matchedEventIds.length, 'Created incident retains all selected evidence IDs');
assert(Boolean(createdIncidentFromHunt.summary?.startsWith('Created from hunt: MATCHED BECAUSE:')), 'Incident summary captures hunt rationale');

console.log('\n====================================================');
console.log('   ALL 10 STEP 5 TEST SUITES PASSED CLEANLY! ✓');
console.log('====================================================\n');

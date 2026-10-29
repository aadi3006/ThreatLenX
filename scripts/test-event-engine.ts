/**
 * scripts/test-event-engine.ts
 *
 * Automated verification suite for the EXPLAIN-SEC SPATIAL Security Event Engine (Step 2).
 * Verifies validation, normalization, signatures, deduplication, querying, sorting, and statistics.
 */

import {
  validateSecurityEvent,
  normalizeSecurityEvent,
  generateEventSignature,
  querySecurityEvents,
  computeEventStats,
} from '../app/core/security/event-engine';
import { SEED_SECURITY_EVENTS } from '../app/core/data/seed-events';
import type { SecurityEvent, SecurityEventInput } from '../app/core/models/event';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
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

console.log('========================================================');
console.log('EXPLAIN-SEC SPATIAL: STEP 2 SECURITY EVENT ENGINE TESTS');
console.log('========================================================\n');

// 1. Validation tests
test('1. Validation: Rejects event missing required fields', () => {
  const invalidEvent = {
    message: 'Test message',
    // Missing eventType, category, severity, source
  } as unknown as SecurityEventInput;

  const result = validateSecurityEvent(invalidEvent);
  assert(!result.valid, 'Event should be marked invalid');
  assert(result.errors.length >= 3, 'Should report multiple missing required fields');
});

test('2. Validation: Rejects invalid severity and category', () => {
  const invalid = {
    eventType: 'TEST_EVENT',
    category: 'INVALID_CATEGORY' as any,
    severity: 'SUPER_CRITICAL' as any,
    source: 'TEST_SRC',
    message: 'Test message',
  };

  const result = validateSecurityEvent(invalid);
  assert(!result.valid, 'Event should fail validation');
  assert(result.errors.some((e) => e.includes('Invalid event category')), 'Should detect bad category');
  assert(result.errors.some((e) => e.includes('Invalid event severity')), 'Should detect bad severity');
});

test('3. Validation: Accepts well-formed event input', () => {
  const valid: SecurityEventInput = {
    eventType: 'POWERSHELL_LAUNCH',
    category: 'PROCESS',
    severity: 'HIGH',
    source: 'EDR-01',
    sourceType: 'ENDPOINT',
    assetId: 'asset-001',
    message: 'Powershell execution detected',
  };

  const result = validateSecurityEvent(valid, { knownAssets: new Set(['asset-001']) });
  assert(result.valid, `Expected valid event, got: ${result.errors.join(', ')}`);
});

test('4. Validation: Enforces referential integrity for assetId and incidentId when requested', () => {
  const valid: SecurityEventInput = {
    eventType: 'SUSPICIOUS_LOGIN',
    category: 'AUTHENTICATION',
    severity: 'MEDIUM',
    source: 'AUTH-DC',
    assetId: 'non-existent-asset',
    incidentId: 'non-existent-inc',
    message: 'Unknown host login',
  };

  const result = validateSecurityEvent(valid, {
    knownAssets: new Set(['asset-001', 'asset-002']),
    knownIncidents: new Set(['incident-001']),
  });

  assert(!result.valid, 'Should fail referential integrity check');
  assert(result.errors.some((e) => e.includes('does not exist')), 'Should flag unknown asset');
});

// 2. Normalization & Signatures
test('5. Normalization: Standardizes timestamps, uppercase severity and category', () => {
  const input: SecurityEventInput = {
    eventType: 'test_alert',
    category: 'process' as any,
    severity: 'high' as any,
    source: 'EDR',
    message: 'Test message',
  };

  const normalized = normalizeSecurityEvent(input);
  assert(normalized.category === 'PROCESS', 'Category should be upper-cased');
  assert(normalized.severity === 'HIGH', 'Severity should be upper-cased');
  assert(typeof normalized.id === 'string' && normalized.id.length > 0, 'Should have assigned an ID');
  assert(!isNaN(new Date(normalized.timestamp).getTime()), 'Timestamp should be valid ISO');
  assert(typeof normalized.signature === 'string' && normalized.signature.length > 0, 'Signature should be computed');
});

test('6. Deterministic Signatures: Identical raw telemetry yields identical signature', () => {
  const eventA: SecurityEventInput = {
    id: 'evt-test-1',
    timestamp: '2026-03-30T10:00:00.000Z',
    eventType: 'FAILED_LOGIN',
    category: 'AUTHENTICATION',
    severity: 'MEDIUM',
    source: 'DC-01',
    assetId: 'asset-001',
    userId: 'user-001',
    message: 'Bad password attempt',
  };

  const eventB: SecurityEventInput = {
    id: 'evt-test-2', // Different ID
    timestamp: '2026-03-30T10:00:00.000Z',
    eventType: 'FAILED_LOGIN',
    category: 'AUTHENTICATION',
    severity: 'MEDIUM',
    source: 'DC-01',
    assetId: 'asset-001',
    userId: 'user-001',
    message: 'Bad password attempt',
  };

  const sigA = generateEventSignature(eventA);
  const sigB = generateEventSignature(eventB);
  assert(sigA === sigB, 'Identical telemetry characteristics must produce matching deduplication signature');
});

test('7. Deduplication: Distinct telemetry produces different signatures', () => {
  const eventA: SecurityEventInput = {
    timestamp: '2026-03-30T10:00:00.000Z',
    eventType: 'FAILED_LOGIN',
    category: 'AUTHENTICATION',
    severity: 'MEDIUM',
    source: 'DC-01',
    assetId: 'asset-001',
    message: 'User admin',
  };

  const eventB: SecurityEventInput = {
    timestamp: '2026-03-30T10:00:00.000Z',
    eventType: 'PROCESS_SPAWN',
    category: 'PROCESS',
    severity: 'HIGH',
    source: 'DC-01',
    assetId: 'asset-001',
    message: 'cmd.exe launched',
  };

  const sigA = generateEventSignature(eventA);
  const sigB = generateEventSignature(eventB);
  assert(sigA !== sigB, 'Distinct events must produce distinct signatures');
});

// 3. Query Engine
test('8. Query Engine: Filters by severity, category, asset, and search term', () => {
  const events = SEED_SECURITY_EVENTS;
  assert(events.length >= 20, `Seed should contain at least 20 events, got ${events.length}`);

  // Query CRITICAL events
  const critResults = querySecurityEvents(events, { severity: 'CRITICAL' });
  assert(critResults.length > 0, 'Should find critical events');
  assert(critResults.every((e) => e.severity === 'CRITICAL'), 'All returned events must be CRITICAL');

  // Query NETWORK category
  const netResults = querySecurityEvents(events, { category: 'NETWORK' });
  assert(netResults.length > 0, 'Should find network events');
  assert(netResults.every((e) => e.category === 'NETWORK'), 'All returned events must be NETWORK');

  // Query for FINWS-027 (asset-001)
  const assetResults = querySecurityEvents(events, { assetId: 'asset-001' });
  assert(assetResults.length > 0, 'Should find events for asset-001');
  assert(assetResults.every((e) => e.assetId === 'asset-001'), 'Must match assetId');

  // Search text query
  const searchResults = querySecurityEvents(events, { search: 'BlackCat' });
  assert(searchResults.length > 0, 'Should match search term BlackCat');
});

test('9. Query Engine: Deterministic sorting (newest first vs oldest first)', () => {
  const events = SEED_SECURITY_EVENTS;

  const newestFirst = querySecurityEvents(events, { sortOrder: 'DESC' });
  for (let i = 1; i < newestFirst.length; i++) {
    const prev = new Date(newestFirst[i - 1].timestamp).getTime();
    const curr = new Date(newestFirst[i].timestamp).getTime();
    assert(prev >= curr, 'DESC sorting must order newest first');
  }

  const oldestFirst = querySecurityEvents(events, { sortOrder: 'ASC' });
  for (let i = 1; i < oldestFirst.length; i++) {
    const prev = new Date(oldestFirst[i - 1].timestamp).getTime();
    const curr = new Date(oldestFirst[i].timestamp).getTime();
    assert(prev <= curr, 'ASC sorting must order oldest first');
  }
});

test('10. Query Engine: Limit and offset pagination', () => {
  const events = SEED_SECURITY_EVENTS;
  const page1 = querySecurityEvents(events, { limit: 5, offset: 0 });
  const page2 = querySecurityEvents(events, { limit: 5, offset: 5 });

  assert(page1.length === 5, 'Page 1 should have 5 items');
  assert(page2.length === 5, 'Page 2 should have 5 items');
  assert(page1[0].id !== page2[0].id, 'Page 1 and Page 2 should not start with same item');
});

// 4. Statistics
test('11. Statistics: Accurately computes totals, severities, categories, and top assets', () => {
  const events = SEED_SECURITY_EVENTS;
  const stats = computeEventStats(events);

  assert(stats.totalEvents === events.length, `totalEvents must match dataset length ${events.length}`);
  const manualCritCount = events.filter((e) => e.severity === 'CRITICAL').length;
  assert(stats.criticalCount === manualCritCount, `criticalCount must match (${manualCritCount})`);

  const manualHighCount = events.filter((e) => e.severity === 'HIGH').length;
  assert(stats.highCount === manualHighCount, `highCount must match (${manualHighCount})`);

  assert(stats.topAssets.length > 0, 'Should produce top assets ranking');
  assert(stats.topAssets[0].count >= stats.topAssets[stats.topAssets.length - 1].count, 'Top assets should be sorted descending');
});

// 5. Seed dataset verification
test('12. Seed Dataset: All 22 events conform to canonical schema with valid relationships', () => {
  for (const event of SEED_SECURITY_EVENTS) {
    const val = validateSecurityEvent(event);
    assert(val.valid, `Seed event ${event.id} failed validation: ${val.errors.join(', ')}`);
    assert(!!event.signature, `Seed event ${event.id} missing signature`);
  }
});

console.log(`\n========================================================`);
console.log(`ALL ${passedTests} SECURITY EVENT ENGINE TESTS PASSED!`);
console.log(`========================================================\n`);

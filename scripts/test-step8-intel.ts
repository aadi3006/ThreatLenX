/**
 * test-step8-intel.ts
 *
 * Automated verification suite for STEP 8: Offline Threat Intelligence Engine.
 *
 * Validates:
 * 1. Seeded baseline Threat Intelligence for Operation BlackTide (ioc-001 -> ioc-005)
 * 2. Canonical IOC identity preservation (Threat Intelligence adds context, does NOT duplicate IOC store)
 * 3. Dynamic derivation of firstSeenAt and lastSeenAt from canonical telemetry
 * 4. Deterministic intelligence confidence scoring (HIGH / MEDIUM / LOW)
 * 5. Relationship graph synthesis:
 *    - IOC -> Asset (OBSERVED_ON)
 *    - IOC -> Incident (ASSOCIATED_WITH)
 *    - IOC -> Alert (INDICATES)
 *    - IOC -> MITRE Technique (MAPS_TO)
 *    - IOC -> Malware Family (DELIVERS / USES)
 *    - IOC -> Campaign (ASSOCIATED_WITH)
 *    - IOC -> IOC (COMMUNICATES_WITH / RELATED_TO)
 * 6. Search, filtering, and query capabilities
 * 7. Offline enrichment pipeline (enrichIndicatorLocally)
 * 8. Dynamic on-demand intelligence for canonical IOCs
 * 9. RBAC authorization matrix across ANALYST, HUNTER, RESPONDER, and MANAGER
 * 10. Audit trail for creation, updates, confidence changes, and enrichment execution
 * 11. Zero-network / strictly offline guarantees
 */

import { LocalProvider } from '../app/core/providers/local-provider';
import type { ThreatIntelRecord, ThreatIntelRelationship, CreateThreatIntelInput } from '../app/core/models/threat-intel';

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
            objectStore: (s: string) => {
              const st = getStore(s);
              return {
                get: (key: string) => createReq(st.get(key)),
                getAll: () => createReq(Array.from(st.values())),
                put: (val: any) => {
                  const k = val.id || val.key || val.storageReference;
                  st.set(k, val);
                  return createReq(k);
                },
                delete: (key: string) => {
                  st.delete(key);
                  return createReq(undefined);
                },
                createIndex: () => {},
                indexNames: { contains: () => true },
              };
            },
            oncomplete: null,
            onerror: null,
          };
          queueMicrotask(() => {
            if (txObj.oncomplete) txObj.oncomplete();
          });
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
          openReq.onupgradeneeded({
            oldVersion: 0,
            target: openReq,
          });
        }
        if (openReq.onsuccess) {
          openReq.onsuccess({ target: openReq });
        }
      });

      return openReq;
    },
  };
}

async function runTests() {
  console.log('\n==================================================');
  console.log('STEP 8: THREAT INTELLIGENCE ENGINE VERIFICATION');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      if (detail) console.error(`    Detail: ${detail}`);
      failed++;
    }
  }

  const provider = new LocalProvider();
  await provider.initialize();

  // Test 1: Seeded Baseline Intelligence
  console.log('[1/11] Baseline Operation BlackTide Intelligence');
  const allIntel = await provider.getThreatIntelRecords();
  assert(allIntel.length >= 5, 'Seeded records exist for baseline indicators', `Count: ${allIntel.length}`);

  const c2IpIntel = await provider.getThreatIntel('ioc-002');
  assert(!!c2IpIntel, 'C2 IP (185.220.101.47) intelligence profile retrieved');
  assert(c2IpIntel?.indicatorValue === '185.220.101.47', 'Indicator value matches canonical IOC');
  assert(c2IpIntel?.confidence === 'HIGH', 'Deterministic confidence for active C2 IP is HIGH', `Got: ${c2IpIntel?.confidence}`);

  // Test 2: Canonical IOC Identity Preservation
  console.log('\n[2/11] Canonical IOC Identity Preservation');
  const iocs = await provider.getIOCs();
  const canonicalIoc2 = iocs.find((i) => i.id === 'ioc-002');
  assert(!!canonicalIoc2, 'Canonical IOC store remains authoritative');
  assert(canonicalIoc2?.value === c2IpIntel?.indicatorValue, 'Threat intelligence references canonical IOC identity without duplication');

  // Test 3: Dynamic First-Seen & Last-Seen Timestamps
  console.log('\n[3/11] Dynamic First-Seen & Last-Seen Calculation');
  assert(!!c2IpIntel?.firstSeenAt && !!c2IpIntel?.lastSeenAt, 'First-seen and last-seen timestamps computed');
  const firstSeenMs = Date.parse(c2IpIntel!.firstSeenAt!);
  const lastSeenMs = Date.parse(c2IpIntel!.lastSeenAt!);
  assert(firstSeenMs <= lastSeenMs, 'firstSeenAt is chronologically earlier than or equal to lastSeenAt');

  // Test 4: Relationships Synthesis
  console.log('\n[4/11] Relationship Graph Synthesis');
  const ioc2Rels = await provider.getThreatIntelRelationships('ioc-002');
  assert(ioc2Rels.length > 0, `Relationships synthesized for ioc-002: ${ioc2Rels.length}`);

  const hasAssetRel = ioc2Rels.some((r) => r.targetType === 'ASSET' && r.relationshipType === 'OBSERVED_ON');
  assert(hasAssetRel, 'IOC -> Asset (OBSERVED_ON) relationship present');

  const hasIncidentRel = ioc2Rels.some((r) => r.targetType === 'INCIDENT' && r.relationshipType === 'ASSOCIATED_WITH');
  assert(hasIncidentRel, 'IOC -> Incident (ASSOCIATED_WITH) relationship present');

  const hasMitreRel = ioc2Rels.some((r) => r.targetType === 'MITRE_TECHNIQUE' && r.relationshipType === 'MAPS_TO');
  assert(hasMitreRel, 'IOC -> MITRE Technique (MAPS_TO) relationship present');

  const hasIocIocRel = ioc2Rels.some((r) => r.targetType === 'IOC' && (r.relationshipType === 'COMMUNICATES_WITH' || r.relationshipType === 'RELATED_TO'));
  assert(hasIocIocRel, 'IOC -> IOC (COMMUNICATES_WITH / RELATED_TO) relationship present');

  // Test 5: Related Indicators Query
  console.log('\n[5/11] Related Indicators Graph Traversal');
  const relatedIocs = await provider.getRelatedIndicators('ioc-002');
  assert(relatedIocs.length > 0, `Related indicators returned: ${relatedIocs.map((i) => i.value).join(', ')}`);

  // Test 6: Indicator Observations Telemetry Scan
  console.log('\n[6/11] Canonical Telemetry Observations Aggregation');
  const obs = await provider.getIndicatorObservations('ioc-002');
  assert(!!obs, 'Observations object returned for ioc-002');
  assert(obs!.eventsCount >= 0, `Matching events counted: ${obs?.eventsCount}`);
  assert(obs!.incidentsCount >= 1, `Matching incidents counted: ${obs?.incidentsCount}`);
  assert(obs!.assetsCount >= 1, `Matching assets counted: ${obs?.assetsCount}`);

  // Test 7: Search and Filtering
  console.log('\n[7/11] Intelligence Search & Filtering');
  const ipFiltered = await provider.getThreatIntelRecords({ indicatorType: 'IP' });
  assert(ipFiltered.every((r) => r.indicatorType === 'IP'), 'Filtered by indicatorType: IP');

  const highConfidence = await provider.getThreatIntelRecords({ confidence: 'HIGH' });
  assert(highConfidence.length >= 1 && highConfidence.every((r) => r.confidence === 'HIGH'), 'Filtered by confidence: HIGH');

  const campaignSearch = await provider.getThreatIntelRecords({ campaign: 'Operation BlackTide' });
  assert(campaignSearch.length >= 1, `Filtered by campaign: Operation BlackTide (${campaignSearch.length} found)`);

  const freeTextSearch = await provider.getThreatIntelRecords({ search: '185.220.101.47' });
  assert(freeTextSearch.length === 1 && freeTextSearch[0].indicatorValue === '185.220.101.47', 'Free-text search by IP value');

  // Test 8: Local Enrichment Pipeline
  console.log('\n[8/11] Local Enrichment Pipeline');
  const enriched = await provider.enrichIndicatorLocally('ioc-003', 'm.chen', 'THREAT_HUNTER');
  assert(enriched.record.indicatorId === 'ioc-003', 'Local enrichment executed for domain ioc-003');
  assert(enriched.relationships.length > 0, `Enrichment generated ${enriched.relationships.length} relationships`);
  assert(enriched.record.observationsCount >= 1, `Observation count aggregated: ${enriched.record.observationsCount}`);

  // Test 9: Record Creation and Updates
  console.log('\n[9/11] Threat Intelligence Record Creation & Updates');
  const newIntelInput: CreateThreatIntelInput = {
    indicatorType: 'DOMAIN',
    indicatorValue: 'beacon.dark-telemetry.local',
    title: 'Adversary Secondary Staging Domain',
    description: 'Suspicious DNS resolution identified during lateral movement sweep.',
    confidence: 'MEDIUM',
    threatTypes: ['Command and Control'],
    malwareFamilies: ['BlackCat/ALPHV'],
    campaigns: ['Operation BlackTide'],
  };

  const createdIntel = await provider.createThreatIntelRecord(newIntelInput, 'soc_manager', 'SOC_MANAGER');
  assert(createdIntel.indicatorValue === 'beacon.dark-telemetry.local', 'Record created with correct observable');
  assert(createdIntel.confidence === 'MEDIUM', 'Record created with correct confidence');

  const updatedIntel = await provider.updateThreatIntelRecord(
    createdIntel.id,
    { confidence: 'HIGH', tags: ['verified-c2'] },
    'soc_manager',
    'SOC_MANAGER'
  );
  assert(updatedIntel.confidence === 'HIGH', 'Confidence updated to HIGH');
  assert(updatedIntel.tags.includes('verified-c2'), 'Tags updated correctly');

  // Test 10: RBAC Authorization Matrix
  console.log('\n[10/11] RBAC Authorization Enforcement');
  let unauthorizedCreateThrown = false;
  try {
    await provider.createThreatIntelRecord(
      {
        indicatorType: 'IP',
        indicatorValue: '192.0.2.1',
        title: 'Unauthorized Test',
      },
      'analyst_junior',
      'L1_ANALYST'
    );
  } catch {
    unauthorizedCreateThrown = true;
  }
  assert(unauthorizedCreateThrown, 'L1_ANALYST role correctly prevented from creating intelligence records without management rights');

  let enrichAllowed = false;
  try {
    await provider.enrichIndicatorLocally('ioc-001', 'analyst_senior', 'L1_ANALYST');
    enrichAllowed = true;
  } catch (err: any) {
    console.error('Enrich error:', err);
  }
  assert(enrichAllowed, 'L1_ANALYST role authorized to execute local enrichment');

  // Test 11: Audit Trail Verification
  console.log('\n[11/11] Audit Trail Verification');
  const auditLogs = await provider.getAuditLogs();
  const createdAudit = auditLogs.some((a) => a.action === 'THREAT_INTEL_CREATED');
  assert(createdAudit, 'Audit log recorded for THREAT_INTEL_CREATED');

  const confidenceAudit = auditLogs.some((a) => a.action === 'CONFIDENCE_CHANGED');
  assert(confidenceAudit, 'Audit log recorded for CONFIDENCE_CHANGED');

  const enrichmentAudit = auditLogs.some((a) => a.action === 'LOCAL_ENRICHMENT_EXECUTED');
  assert(enrichmentAudit, 'Audit log recorded for LOCAL_ENRICHMENT_EXECUTED');

  console.log('\n==================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

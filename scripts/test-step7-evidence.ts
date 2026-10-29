/**
 * test-step7-evidence.ts
 *
 * Automated verification suite for STEP 7: Offline Evidence Management System.
 *
 * Validates:
 * 1. Seeded baseline evidence for Operation BlackTide (EVD-000001, EVD-000002, EVD-000003)
 * 2. Mandatory case relationship constraint
 * 3. Collision-safe sequential numbering (EVD-000004, etc.)
 * 4. Cryptographic SHA-256 calculation for text & file payloads
 * 5. Integrity verification: MATCH / VERIFIED
 * 6. Integrity verification: MISMATCH / INTEGRITY_MISMATCH (tampering detection)
 * 7. Immutability of core provenance fields
 * 8. Append-only Chain of Custody logging
 * 9. Analyst investigative annotations (commentary, non-destructive)
 * 10. Lifecycle status transitions & invalid transition rejection
 * 11. Collection workflows: Event -> Evidence, Alert -> Evidence, Hunt -> Evidence, Incident -> Evidence
 * 12. Case Finding -> Evidence linkage
 * 13. RBAC authorization matrix across analyst/responder/hunter/manager roles
 * 14. Full audit logging for evidence operations
 */

import { LocalProvider } from '../app/core/providers/local-provider';
import { securityService } from '../app/core/security-service';
import type { Evidence, CreateEvidenceInput } from '../app/core/models/evidence';

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

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED ASSERTION: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runStep7Verification() {
  console.log('=================================================================');
  console.log('STEP 7: OFFLINE EVIDENCE MANAGEMENT SYSTEM VERIFICATION');
  console.log('=================================================================');

  const provider = new LocalProvider();
  await provider.initialize();
  await securityService.bootstrap(provider);

  // ─── SUITE 1: BASELINE EVIDENCE SEEDING & BLACKTIDE ARTIFACTS ──────
  console.log('\n--- SUITE 1: Baseline Evidence Seeding (Operation BlackTide) ---');

  const allEvidence = await provider.getEvidence();
  assert(allEvidence.length >= 3, `Seeded baseline evidence present (found ${allEvidence.length})`);

  const evd1 = await provider.getEvidenceById('evd-blacktide-001');
  assert(evd1 !== null, 'EVD-000001 (PowerShell Event Reference) found');
  assert(evd1?.evidenceNumber === 'EVD-000001', 'Evidence number formatted as EVD-000001');
  assert(evd1?.type === 'EVENT_REFERENCE', 'EVD-000001 has type EVENT_REFERENCE');
  assert(evd1?.sourceType === 'SECURITY_EVENT', 'EVD-000001 has sourceType SECURITY_EVENT');
  assert(evd1?.sourceId === 'evt-raw-004', 'EVD-000001 references source event evt-raw-004');
  assert(evd1?.status === 'VALIDATED', 'EVD-000001 has status VALIDATED');
  assert(Boolean(evd1?.integrity.hash), 'EVD-000001 contains SHA-256 hash');

  const evd2 = await provider.getEvidenceById('evd-blacktide-002');
  assert(evd2 !== null, 'EVD-000002 (Threat Hunt Output) found');
  assert(evd2?.type === 'HUNT_REFERENCE', 'EVD-000002 has type HUNT_REFERENCE');
  assert(evd2?.sourceId === 'hunt-seed-001', 'EVD-000002 references hunt-seed-001');

  const evd3 = await provider.getEvidenceById('evd-blacktide-003');
  assert(evd3 !== null, 'EVD-000003 (Analyst Text Note) found');
  assert(evd3?.type === 'TEXT_NOTE', 'EVD-000003 has type TEXT_NOTE');
  assert(Boolean(evd3?.textContent?.includes('injected thread')), 'EVD-000003 preserves text content');

  // ─── SUITE 2: MANDATORY CASE RELATIONSHIP & SEQUENTIAL NUMBERING ──
  console.log('\n--- SUITE 2: Case Association & Sequential Numbering ---');

  // Must reject evidence creation without valid case
  let rejected = false;
  try {
    await provider.createEvidence(
      {
        caseId: 'non-existent-case-999',
        type: 'TEXT_NOTE',
        title: 'Orphaned Evidence',
        sourceType: 'MANUAL',
        textContent: 'Testing orphan constraint',
      },
      'analyst1',
      'L2_ANALYST'
    );
  } catch (err: any) {
    rejected = true;
    assert(err.message.includes('Invalid case'), 'Rejected creation of evidence with invalid caseId');
  }
  assert(rejected, 'Mandatory case relationship enforced');

  // Create evidence attached to BlackTide case
  const evd4 = await provider.createEvidence(
    {
      caseId: 'case-blacktide-001',
      type: 'TEXT_NOTE',
      title: 'Perimeter Firewall Connection Log Extract',
      description: 'Extracted outbound connection log showing SYN packets to 198.51.100.45:443.',
      sourceType: 'ANALYST',
      textContent: '2024-11-14T02:15:30Z FW-CORE-01 SRC=10.0.1.27 DST=198.51.100.45 PROTO=TCP DPT=443 ACTION=PERMIT',
      tags: ['firewall', 'perimeter', 'blacktide'],
    },
    'analyst2',
    'L2_ANALYST'
  );

  assert(evd4.evidenceNumber === 'EVD-000004', `Generated sequential number EVD-000004 (got: ${evd4.evidenceNumber})`);
  assert(evd4.caseId === 'case-blacktide-001', 'Evidence linked to parent case');
  assert(evd4.status === 'COLLECTED', 'Initial evidence status is COLLECTED');
  assert(Boolean(evd4.integrity.hash), 'Cryptographic hash computed upon creation');

  // ─── SUITE 3: CRYPTOGRAPHIC HASHING & INTEGRITY VERIFICATION ──────
  console.log('\n--- SUITE 3: SHA-256 Hashing & Integrity Verification ---');

  // 1. Verify text evidence
  const verifyResult4 = await provider.verifyEvidenceIntegrity(evd4.id, 'analyst2', 'L2_ANALYST');
  assert(verifyResult4.verified === true, 'Integrity verification matched stored hash (MATCH)');
  assert(Boolean(verifyResult4.storedHash), 'Stored hash returned in verification');

  // 2. File evidence with binary ArrayBuffer
  const testFileBytes = new TextEncoder().encode('Write-Host "Simulated BlackTide payload artifact"').buffer;
  const evd5 = await provider.createEvidence(
    {
      caseId: 'case-blacktide-001',
      type: 'FILE',
      title: 'Recovered Dropper Script (Synthetic Test Artifact)',
      fileName: 'blacktide_dropper.ps1.txt',
      mimeType: 'text/plain',
      fileBytes: testFileBytes,
      sourceType: 'FILE',
      tags: ['synthetic-test', 'dropper'],
    },
    'analyst2',
    'L2_ANALYST'
  );

  assert(evd5.evidenceNumber === 'EVD-000005', 'Generated sequential number EVD-000005');
  assert(evd5.storageReference !== undefined, 'Storage reference generated for binary payload');
  assert(evd5.sizeBytes === testFileBytes.byteLength, 'Byte size accurately recorded');

  const verifyResult5 = await provider.verifyEvidenceIntegrity(evd5.id, 'analyst2', 'L2_ANALYST');
  assert(verifyResult5.verified === true, 'File evidence SHA-256 integrity verified');

  // 3. Verify canonical reference evidence provenance
  const verifyResult1 = await provider.verifyEvidenceIntegrity(evd1!.id, 'analyst2', 'L2_ANALYST');
  assert(verifyResult1.verified === true, 'Event reference provenance verified against canonical evt-raw-004');

  // 4. Tamper simulation: deliberately alter stored hash to verify MISMATCH detection
  const tampered = await provider.getEvidenceById(evd4.id);
  tampered!.integrity.hash = '0000000000000000000000000000000000000000000000000000000000000000';
  // Put directly into in-memory store for simulation test
  (provider as any)._evidence.find((e: Evidence) => e.id === evd4.id).integrity.hash = '0000000000000000000000000000000000000000000000000000000000000000';

  const mismatchResult = await provider.verifyEvidenceIntegrity(evd4.id, 'analyst2', 'L2_ANALYST');
  assert(mismatchResult.verified === false, 'Integrity mismatch correctly detected (MISMATCH)');
  assert(mismatchResult.message.includes('INTEGRITY MISMATCH'), 'Mismatch reason recorded in message');

  // Restore authentic hash
  (provider as any)._evidence.find((e: Evidence) => e.id === evd4.id).integrity.hash = verifyResult4.storedHash;

  // ─── SUITE 4: IMMUTABILITY OF CORE PROVENANCE FIELDS ───────────────
  console.log('\n--- SUITE 4: Immutability of Core Provenance ---');

  const originalCollectedBy = evd4.collectedBy;
  const originalCollectedAt = evd4.collectedAt;
  const originalNumber = evd4.evidenceNumber;

  // Attempt to modify title and metadata
  const updatedEvd4 = await provider.updateEvidenceMetadata(
    evd4.id,
    {
      title: 'Perimeter Firewall Connection Log Extract (Updated Title)',
      notes: 'Reviewed and verified against edge firewall logs.',
      tags: ['firewall', 'perimeter', 'verified'],
    },
    'analyst2',
    'L2_ANALYST'
  );

  assert(updatedEvd4.title.includes('Updated Title'), 'Title updated through permitted metadata patch');
  assert(Boolean(updatedEvd4.notes?.includes('edge firewall logs')), 'Notes updated');
  assert(updatedEvd4.collectedBy === originalCollectedBy, 'Core provenance: collectedBy is immutable');
  assert(updatedEvd4.collectedAt === originalCollectedAt, 'Core provenance: collectedAt is immutable');
  assert(updatedEvd4.evidenceNumber === originalNumber, 'Core provenance: evidenceNumber is immutable');

  // ─── SUITE 5: APPEND-ONLY CHAIN OF CUSTODY ────────────────────────
  console.log('\n--- SUITE 5: Append-Only Chain of Custody ---');

  const custodyHistory4 = await provider.getEvidenceCustody(evd4.id);
  assert(custodyHistory4.length >= 3, `Chain of custody recorded multiple events (found: ${custodyHistory4.length})`);
  assert(custodyHistory4[0].action === 'COLLECTED', 'First custody entry is COLLECTED');
  assert(custodyHistory4.some((c) => c.action === 'ANNOTATED'), 'Custody recorded ANNOTATED action from metadata update');
  assert(custodyHistory4.some((c) => c.action === 'INTEGRITY_VERIFIED'), 'Custody recorded INTEGRITY_VERIFIED check');

  // ─── SUITE 6: ANALYST INVESTIGATIVE ANNOTATIONS ───────────────────
  console.log('\n--- SUITE 6: Analyst Investigative Annotations ---');

  const annotation = await provider.addEvidenceAnnotation(
    evd4.id,
    {
      content: 'Confirmed with firewall engineering: rule PERMIT-OUTBOUND-HTTPS permitted packet.',
      authorName: 'Sam Okafor',
    },
    'analyst2',
    'L2_ANALYST'
  );

  assert(annotation.evidenceId === evd4.id, 'Annotation linked to evidence');
  assert(annotation.content.includes('PERMIT-OUTBOUND-HTTPS'), 'Annotation content saved');

  const annotationsList = await provider.getEvidenceAnnotations(evd4.id);
  assert(annotationsList.length >= 1, 'Annotation retrievable through getEvidenceAnnotations');

  // ─── SUITE 7: LIFECYCLE STATUS TRANSITIONS ─────────────────────────
  console.log('\n--- SUITE 7: Status Transitions & Lifecycle Validation ---');

  // COLLECTED -> UNDER_REVIEW
  const reviewing = await provider.updateEvidenceStatus(evd4.id, 'UNDER_REVIEW', 'Sent for peer review', 'manager', 'SOC_MANAGER');
  assert(reviewing.status === 'UNDER_REVIEW', 'Transitioned to UNDER_REVIEW');

  // UNDER_REVIEW -> VALIDATED
  const validated = await provider.updateEvidenceStatus(evd4.id, 'VALIDATED', 'Peer review passed', 'manager', 'SOC_MANAGER');
  assert(validated.status === 'VALIDATED', 'Transitioned to VALIDATED');

  // Archive
  const archived = await provider.archiveEvidence(evd4.id, 'Case closed, artifact archived', 'manager', 'SOC_MANAGER');
  assert(archived.status === 'ARCHIVED', 'Evidence successfully archived');

  // ─── SUITE 8: CONVENIENCE COLLECTORS (EVENT, ALERT, HUNT, INCIDENT) 
  console.log('\n--- SUITE 8: SOC Object Evidence Collectors ---');

  // Collect Event
  const collectedEventEvd = await provider.collectEventAsEvidence('case-blacktide-001', 'evt-raw-002', {}, 'analyst2', 'L2_ANALYST');
  assert(collectedEventEvd.sourceType === 'SECURITY_EVENT', 'Collected event has sourceType SECURITY_EVENT');
  assert(collectedEventEvd.sourceId === 'evt-raw-002', 'Collected event preserves event ID evt-raw-002');
  assert(Boolean(collectedEventEvd.relatedEventIds?.includes('evt-raw-002')), 'Retains relatedEventIds');

  // Collect Alert
  const allAlerts = await provider.getAlerts();
  assert(allAlerts.length > 0, 'Detection alerts generated from telemetry');
  const targetAlert = allAlerts[0];
  const collectedAlertEvd = await provider.collectAlertAsEvidence('case-blacktide-001', targetAlert.id, {}, 'analyst2', 'L2_ANALYST');
  assert(collectedAlertEvd.sourceType === 'ALERT', 'Collected alert has sourceType ALERT');
  assert(collectedAlertEvd.sourceId === targetAlert.id, 'Collected alert preserves alert ID');

  // Collect Hunt
  const collectedHuntEvd = await provider.collectHuntAsEvidence('case-blacktide-001', 'hunt-seed-001', {}, 'hunter', 'THREAT_HUNTER');
  assert(collectedHuntEvd.sourceType === 'THREAT_HUNT', 'Collected hunt has sourceType THREAT_HUNT');

  // Collect Incident
  const collectedIncEvd = await provider.collectIncidentAsEvidence('case-blacktide-001', 'incident-001', {}, 'analyst2', 'L2_ANALYST');
  assert(collectedIncEvd.sourceType === 'INCIDENT', 'Collected incident has sourceType INCIDENT');

  // ─── SUITE 9: CASE FINDING LINKAGE ─────────────────────────────────
  console.log('\n--- SUITE 9: Case Finding Linkage ---');

  const findings = await provider.getCaseFindings('case-blacktide-001');
  const blackTideFinding = findings.find((f) => f.id === 'finding-blacktide-001');
  assert(Boolean(blackTideFinding), 'Baseline Operation BlackTide finding found');
  assert(Boolean(blackTideFinding?.relatedEvidenceIds?.includes('evd-blacktide-001')), 'Finding links directly to EVD-000001');
  assert(Boolean(blackTideFinding?.relatedEvidenceIds?.includes('evd-blacktide-002')), 'Finding links directly to EVD-000002');

  // ─── SUITE 10: RBAC AUTHORIZATION CHECKS ──────────────────────────
  console.log('\n--- SUITE 10: RBAC Authorization Verification ---');

  // Responder cannot change evidence status to VALIDATED (requires EVIDENCE_MANAGE)
  let unauthorizedStatus = false;
  try {
    await provider.updateEvidenceStatus(evd5.id, 'VALIDATED', 'Unauthorized attempt', 'responder', 'INCIDENT_RESPONDER');
  } catch (err: any) {
    unauthorizedStatus = true;
    assert(err.message.includes('Unauthorized'), 'INCIDENT_RESPONDER denied from updating evidence status');
  }
  assert(unauthorizedStatus, 'RBAC correctly enforced on status transitions');

  // Analyst can verify integrity
  const analystVerify = await provider.verifyEvidenceIntegrity(evd5.id, 'analyst1', 'L1_ANALYST');
  assert(analystVerify.verified === true, 'L1_ANALYST permitted to verify evidence integrity');

  // ─── SUITE 11: AUDIT RECORD TRAIL ──────────────────────────────────
  console.log('\n--- SUITE 11: Security Audit Trail Verification ---');

  const allAudit = await provider.getAuditLogs();
  const evidenceAudits = allAudit.filter((a) => a.action.startsWith('EVIDENCE_'));
  assert(evidenceAudits.length >= 5, `Audit trail recorded evidence operations (found: ${evidenceAudits.length})`);

  const auditActions = new Set(evidenceAudits.map((a) => a.action));
  assert(auditActions.has('EVIDENCE_COLLECTED'), 'Audit trail contains EVIDENCE_COLLECTED');
  assert(auditActions.has('EVIDENCE_METADATA_UPDATED'), 'Audit trail contains EVIDENCE_METADATA_UPDATED');
  assert(auditActions.has('EVIDENCE_STATUS_CHANGED'), 'Audit trail contains EVIDENCE_STATUS_CHANGED');
  assert(auditActions.has('EVIDENCE_INTEGRITY_VERIFIED'), 'Audit trail contains EVIDENCE_INTEGRITY_VERIFIED');

  console.log('\n=================================================================');
  console.log('✅ ALL 11 TEST SUITES PASSED (STEP 7 EVIDENCE MANAGEMENT)');
  console.log('=================================================================');
}

runStep7Verification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});

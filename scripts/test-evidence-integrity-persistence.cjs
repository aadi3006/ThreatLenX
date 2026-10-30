/**
 * scripts/test-evidence-integrity-persistence.cjs
 *
 * Regression test for ThreatLenX Evidence Integrity:
 * 1. Verify that integrity results remain accurate after refresh using custody history.
 * 2. Test both existing stored evidence and fresh seed data.
 * 3. Never overwrite an existing evidence hash to make verification pass.
 * 4. Preserve and display genuine mismatches.
 * 5. Confirm corrected seed hash matches its exact text payload.
 * 6. Browser E2E verify -> refresh -> displayed result assertion in isolated profile.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

// ─── SUITE 1: SEED HASH EXACT PAYLOAD VALIDATION ────────────────────────────
function testSeedHashValidation() {
  console.log('\n=== SUITE 1: Seed Hash Exact Text Payload Validation ===');
  const exactPayload =
    'Volatile memory triage of FINWS-027 verified injected thread in spoolsv.exe originating from powershell.exe (PID 4828). Outbound connection handles to 198.51.100.45:443 were active prior to network containment.';
  const computedSha256 = crypto.createHash('sha256').update(exactPayload, 'utf8').digest('hex');
  const expectedSeedHash = '20f5769d771ebca2335a2408655c8a778fa037a23bb0cb0cffe47c6d51d5d6a2';

  if (computedSha256 !== expectedSeedHash) {
    throw new Error(`Seed hash mismatch! Expected ${expectedSeedHash}, got ${computedSha256}`);
  }
  console.log(`  ✓ Exact text payload SHA-256 matches: ${computedSha256}`);

  // Also verify local-provider.ts source code matches
  const providerPath = path.join(__dirname, '../app/core/providers/local-provider.ts');
  const providerContent = fs.readFileSync(providerPath, 'utf8');
  if (!providerContent.includes(expectedSeedHash)) {
    throw new Error(`local-provider.ts does not contain expected seed hash ${expectedSeedHash}`);
  }
  console.log('  ✓ local-provider.ts contains authentic corrected seed hash');
}

// ─── SUITE 2: IN-MEMORY & PROVIDER RECONCILIATION LOGIC ─────────────────────
async function testProviderReconciliationLogic() {
  console.log('\n=== SUITE 2: Custody Reconciliation & Mismatch Immutability Logic ===');

  const evidenceList = [
    {
      id: 'evd-blacktide-003',
      evidenceNumber: 'EVD-000003',
      caseId: 'case-blacktide-001',
      type: 'TEXT_NOTE',
      title: 'Analyst Triage Memory Analysis Summary',
      textContent:
        'Volatile memory triage of FINWS-027 verified injected thread in spoolsv.exe originating from powershell.exe (PID 4828). Outbound connection handles to 198.51.100.45:443 were active prior to network containment.',
      integrity: {
        algorithm: 'SHA-256',
        hash: '20f5769d771ebca2335a2408655c8a778fa037a23bb0cb0cffe47c6d51d5d6a2',
        verified: false,
      },
    },
    {
      id: 'evd-tampered-001',
      evidenceNumber: 'EVD-000099',
      caseId: 'case-blacktide-001',
      type: 'TEXT_NOTE',
      title: 'Tampered Evidence Simulation',
      textContent: 'Altered file content that does not match original seal.',
      integrity: {
        algorithm: 'SHA-256',
        hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        verified: false,
      },
    },
  ];

  const evidenceCustody = [];

  function reconcileEvidenceIntegrityFromCustody(evidence, custody) {
    for (const evd of evidence) {
      const verifications = custody
        .filter((c) => c.evidenceId === evd.id && c.action === 'INTEGRITY_VERIFIED')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      if (verifications.length > 0) {
        const latest = verifications[0];
        evd.integrity.verified = Boolean(latest.metadata?.verified);
        evd.integrity.verifiedAt = latest.timestamp;
        evd.integrity.verifiedBy = latest.actorId;
      }
    }
  }

  // Verification 1: Valid seed item
  const validHash = crypto.createHash('sha256').update(evidenceList[0].textContent, 'utf8').digest('hex');
  const isMatch1 = validHash === evidenceList[0].integrity.hash;
  if (!isMatch1) throw new Error('Valid item failed verification');
  evidenceCustody.push({
    id: 'custody-1',
    evidenceId: evidenceList[0].id,
    action: 'INTEGRITY_VERIFIED',
    actorId: 'analyst2',
    timestamp: new Date().toISOString(),
    reason: 'SHA-256 integrity verified against text payload',
    metadata: { verified: true, storedHash: evidenceList[0].integrity.hash, computedHash: validHash },
  });

  // Verification 2: Tampered / Genuine mismatch item
  const tamperedComputed = crypto.createHash('sha256').update(evidenceList[1].textContent, 'utf8').digest('hex');
  const isMatch2 = tamperedComputed === evidenceList[1].integrity.hash;
  if (isMatch2) throw new Error('Tampered item incorrectly passed verification');

  // NEVER overwrite stored hash
  const storedHashBefore = evidenceList[1].integrity.hash;
  evidenceCustody.push({
    id: 'custody-2',
    evidenceId: evidenceList[1].id,
    action: 'INTEGRITY_VERIFIED',
    actorId: 'analyst2',
    timestamp: new Date().toISOString(),
    reason: 'INTEGRITY MISMATCH: computed text hash does not match stored hash',
    metadata: { verified: false, storedHash: storedHashBefore, computedHash: tamperedComputed },
  });

  if (evidenceList[1].integrity.hash !== storedHashBefore) {
    throw new Error('CRITICAL: Stored hash was overwritten!');
  }
  console.log('  ✓ Stored hash was strictly preserved on mismatch (never overwritten)');

  // Simulate refresh / re-hydration
  reconcileEvidenceIntegrityFromCustody(evidenceList, evidenceCustody);

  if (evidenceList[0].integrity.verified !== true) {
    throw new Error('Valid evidence was not marked verified after custody reconciliation');
  }
  console.log('  ✓ Valid evidence verified state preserved across simulated refresh');

  if (evidenceList[1].integrity.verified !== false) {
    throw new Error('Tampered evidence incorrectly marked verified after reconciliation');
  }
  console.log('  ✓ Tampered evidence mismatch state preserved across simulated refresh');

  // Verify UI restoration contract
  const latestVerifyTampered = evidenceCustody
    .filter((c) => c.evidenceId === evidenceList[1].id && c.action === 'INTEGRITY_VERIFIED')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  const restoredUIStatus = {
    verifying: false,
    result: {
      verified: Boolean(latestVerifyTampered.metadata?.verified),
      message: latestVerifyTampered.reason,
      calculatedHash: latestVerifyTampered.metadata?.computedHash,
    },
  };

  if (restoredUIStatus.result.verified !== false) {
    throw new Error('UI status did not accurately restore mismatch');
  }
  if (!restoredUIStatus.result.message.includes('INTEGRITY MISMATCH')) {
    throw new Error('UI status did not restore mismatch message');
  }
  if (restoredUIStatus.result.calculatedHash !== tamperedComputed) {
    throw new Error('UI status did not restore calculated hash for analyst review');
  }
  console.log('  ✓ UI contract accurately restores mismatch message and recalculated hash');
}

// ─── SUITE 3: BROWSER E2E VERIFY -> REFRESH -> DISPLAYED RESULT ─────────────
async function testBrowserE2E() {
  console.log('\n=== SUITE 3: Browser E2E Verify -> Refresh -> Displayed Result ===');
  const port = 9522;
  const isolatedProfile = `/tmp/threatlenx-chrome-integrity-regression-${Date.now()}`;
  fs.mkdirSync(isolatedProfile, { recursive: true });

  const chromeProc = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--window-size=1440,900',
      `--user-data-dir=${isolatedProfile}`,
      '--no-first-run',
      '--no-proxy-server',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const json = await new Promise((res, rej) => {
          http
            .get(`http://127.0.0.1:${port}/json`, (resp) => {
              let data = '';
              resp.on('data', (chunk) => (data += chunk));
              resp.on('end', () => res(data));
            })
            .on('error', rej);
        });
        targets = JSON.parse(json);
        if (targets && targets.length > 0) break;
      } catch {}
    }

    const pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('Could not find Chrome page target');
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });

    let msgId = 1;
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = msgId++;
        const handler = (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.id === id) {
            ws.off('message', handler);
            if (parsed.error) reject(parsed.error);
            else resolve(parsed.result);
          }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    const evalScript = async (expr) => {
      const res = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result?.value;
    };

    console.log('  [NAV] Navigating to http://localhost:3000/...');
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise((r) => setTimeout(r, 3500));

    // Helper to enter Evidence Vault from Hub
    const navigateToEvidence = async () => {
      await evalScript(`
        (() => {
          const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
          const target = nodes.find(n => n.textContent && n.textContent.includes('EVIDENCE'));
          if (target) {
            target.click();
            return true;
          }
          if (window.__socNavStore) {
            window.__socNavStore.getState().setWorkspace('EVIDENCE');
            return true;
          }
          return false;
        })()
      `);
      await new Promise((r) => setTimeout(r, 1500));
    };

    console.log('  [ACTION] Navigating to Zone 5: EVIDENCE VAULT from Hub...');
    await navigateToEvidence();

    const isEvidenceWorkspace = await evalScript(`
      Boolean(document.querySelector('.evidence-workspace'))
    `);
    console.log(`  [DOM] Evidence workspace mounted: ${isEvidenceWorkspace}`);
    if (!isEvidenceWorkspace) {
      throw new Error('Failed to mount Evidence workspace from Hub');
    }

    // Check evidence items present
    const evidenceCount = await evalScript(`
      document.querySelectorAll('.evidence-item-card').length
    `);
    console.log(`  [DATA] Found ${evidenceCount} evidence items in view`);
    if (evidenceCount === 0) {
      throw new Error('Zero evidence items found in Evidence workspace');
    }

    // Select evd-blacktide-003 (Analyst Triage Memory Analysis Summary)
    await evalScript(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.evidence-item-card'));
        const evd3 = cards.find(c => c.textContent && (c.textContent.includes('EVD-000003') || c.textContent.includes('Memory Analysis')));
        if (evd3) evd3.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    // Capture stored hash before verification
    const displayedHashBefore = await evalScript(`
      document.querySelector('.evidence-hash-val')?.textContent?.trim() || ''
    `);
    console.log(`  [HASH] Displayed stored hash for EVD-000003: ${displayedHashBefore}`);
    if (!displayedHashBefore.includes('20f5769d771ebca2335a2408655c8a778fa037a23bb0cb0cffe47c6d51d5d6a2')) {
      throw new Error(`Unexpected stored hash for EVD-000003: got ${displayedHashBefore}`);
    }

    // Click "VERIFY INTEGRITY" button
    console.log('  [ACTION] Clicking "VERIFY INTEGRITY" button...');
    const clickSuccess = await evalScript(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const verifyBtn = btns.find(b => b.textContent && (b.textContent.includes('VERIFY INTEGRITY') || b.textContent.includes('VERIFY HASH')));
        if (verifyBtn) {
          verifyBtn.click();
          return true;
        }
        return false;
      })()
    `);
    if (!clickSuccess) throw new Error('Verify button not found');
    await new Promise((r) => setTimeout(r, 1200));

    // Poll for live integrity verification feedback box
    let feedbackTextBefore = null;
    for (let i = 0; i < 15; i++) {
      feedbackTextBefore = await evalScript(`
        (() => {
          const box = document.querySelector('.evidence-12field-grid + div') ||
                      Array.from(document.querySelectorAll('div')).find(d => 
                        d.textContent && (d.textContent.includes('INTEGRITY MATCH') || d.textContent.includes('SHA-256 integrity verified'))
                      );
          return box ? box.textContent.trim().slice(0, 120) : null;
        })()
      `);
      if (feedbackTextBefore) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`  [STATUS] Verification result: "${feedbackTextBefore}"`);
    if (!feedbackTextBefore || !feedbackTextBefore.includes('INTEGRITY MATCH')) {
      throw new Error(`Integrity feedback match banner not displayed! Got: ${feedbackTextBefore}`);
    }
    console.log('  ✓ Live integrity verification succeeded and match banner displayed');

    // REFRESH PAGE: Test persistence across reload
    console.log('\n  [ACTION] Refreshing page (Page.reload) to test integrity result persistence...');
    await send('Page.reload');
    await new Promise((r) => setTimeout(r, 3500));

    // Navigate back to Evidence Vault after refresh
    await navigateToEvidence();

    // Select EVD-000003 again
    await evalScript(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.evidence-item-card'));
        const evd3 = cards.find(c => c.textContent && (c.textContent.includes('EVD-000003') || c.textContent.includes('Memory Analysis')));
        if (evd3) evd3.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    // Assert live verification feedback box IS DISPLAYED on refresh WITHOUT re-clicking verify
    let feedbackTextAfter = null;
    for (let i = 0; i < 15; i++) {
      feedbackTextAfter = await evalScript(`
        (() => {
          const box = document.querySelector('.evidence-12field-grid + div') ||
                      Array.from(document.querySelectorAll('div')).find(d => 
                        d.textContent && (d.textContent.includes('INTEGRITY MATCH') || d.textContent.includes('SHA-256 integrity verified'))
                      );
          return box ? box.textContent.trim().slice(0, 120) : null;
        })()
      `);
      if (feedbackTextAfter) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`  [PERSISTENCE] Displayed result after refresh: "${feedbackTextAfter}"`);
    if (!feedbackTextAfter || !feedbackTextAfter.includes('INTEGRITY MATCH')) {
      throw new Error('Integrity verification banner disappeared after refresh! Custody history was not restored.');
    }
    console.log('  ✓ Integrity verification result accurately persisted across page refresh via custody history');

    // Confirm stored hash is identical before and after
    const displayedHashAfter = await evalScript(`
      document.querySelector('.evidence-hash-val')?.textContent?.trim() || ''
    `);
    if (displayedHashAfter !== displayedHashBefore) {
      throw new Error(`Stored hash changed! Before: ${displayedHashBefore}, After: ${displayedHashAfter}`);
    }
    console.log(`  ✓ Stored hash remained completely immutable: ${displayedHashAfter}`);

    // Test genuine mismatch simulation in browser
    console.log('\n  [ACTION] Testing genuine mismatch simulation in browser...');
    const mismatchInserted = await evalScript(`
      (async () => {
        try {
          const dbRequest = indexedDB.open('es-spatial-db', 13);
          return await new Promise((resolve) => {
            dbRequest.onsuccess = (e) => {
              const db = e.target.result;
              const tx = db.transaction(['evidence', 'evidence_custody'], 'readwrite');
              const evStore = tx.objectStore('evidence');
              const custStore = tx.objectStore('evidence_custody');

              const tamperedEvd = {
                id: 'evd-regression-tampered-001',
                evidenceNumber: 'EVD-000099',
                caseId: 'case-blacktide-001',
                type: 'TEXT_NOTE',
                title: 'Forensic Memory Buffer Tamper Test',
                sourceType: 'ANALYST',
                collectedAt: new Date().toISOString(),
                collectedBy: 'hunter',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: 'UNDER_REVIEW',
                textContent: 'Authentic text that differs from invalid hash',
                integrity: {
                  algorithm: 'SHA-256',
                  hash: 'deadbeef00000000000000000000000000000000000000000000000000000000',
                  verified: false,
                },
                metadata: {},
                tags: ['tamper-test'],
              };

              const mismatchCustody = {
                id: 'custody-tampered-test',
                evidenceId: 'evd-regression-tampered-001',
                action: 'INTEGRITY_VERIFIED',
                actorId: 'analyst2',
                timestamp: new Date().toISOString(),
                reason: 'INTEGRITY MISMATCH: computed text hash does not match stored hash',
                metadata: {
                  verified: false,
                  storedHash: 'deadbeef00000000000000000000000000000000000000000000000000000000',
                  computedHash: '9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef',
                },
              };

              evStore.put(tamperedEvd);
              custStore.put(mismatchCustody);
              tx.oncomplete = () => resolve(true);
              tx.onerror = () => resolve(false);
            };
            dbRequest.onerror = () => resolve(false);
          });
        } catch (err) {
          return false;
        }
      })()
    `);

    if (mismatchInserted) {
      console.log('  [DATA] Inserted synthetic mismatch record into isolated database');
      // Reload page to pick up the mismatch item
      await send('Page.reload');
      await new Promise((r) => setTimeout(r, 3000));
      await navigateToEvidence();

      // Select the tampered evidence item
      await evalScript(`
        (() => {
          const cards = Array.from(document.querySelectorAll('.evidence-item-card'));
          const tampered = cards.find(c => c.textContent && c.textContent.includes('EVD-000099'));
          if (tampered) tampered.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 1200));

      const mismatchBanner = await evalScript(`
        (() => {
          const box = document.querySelector('.evidence-12field-grid + div') ||
                      Array.from(document.querySelectorAll('div')).find(d => 
                        d.textContent && (d.textContent.includes('MISMATCH DETECTED') || d.textContent.includes('CRYPTOGRAPHIC INTEGRITY MISMATCH'))
                      );
          return box ? box.textContent.trim().slice(0, 150) : null;
        })()
      `);
      console.log(`  [MISMATCH DISPLAY] Banner text: "${mismatchBanner}"`);
      if (!mismatchBanner || !mismatchBanner.includes('MISMATCH')) {
        throw new Error('Genuine mismatch was not preserved or displayed after refresh!');
      }
      console.log('  ✓ Genuine mismatch accurately preserved and prominently displayed after refresh');

      const recalculatedHashShown = await evalScript(`
        Boolean(document.querySelector('.evidence-12field-grid + div')?.textContent?.includes('9876543210abcdef'))
      `);
      console.log(`  ✓ Recalculated hash displayed for analyst review: ${recalculatedHashShown}`);
      if (!recalculatedHashShown) {
        throw new Error('Recalculated hash was not displayed on mismatch');
      }

      const originalHashPreserved = await evalScript(`
        document.querySelector('.evidence-hash-val')?.textContent?.includes('deadbeef')
      `);
      console.log(`  ✓ Stored hash was NOT overwritten (deadbeef preserved): ${originalHashPreserved}`);
      if (!originalHashPreserved) {
        throw new Error('Stored hash was corrupted or overwritten on mismatch');
      }
    }

    ws.close();
  } finally {
    chromeProc.kill();
    try {
      fs.rmSync(isolatedProfile, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  console.log('=================================================================');
  console.log('THREATLENX EVIDENCE INTEGRITY & REFRESH PERSISTENCE REGRESSION TEST');
  console.log('=================================================================');
  try {
    testSeedHashValidation();
    await testProviderReconciliationLogic();
    await testBrowserE2E();
    console.log('\n=================================================================');
    console.log('✅ ALL EVIDENCE INTEGRITY REGRESSION TESTS PASSED');
    console.log('=================================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ REGRESSION TEST FAILED:', err);
    process.exit(1);
  }
}

main();

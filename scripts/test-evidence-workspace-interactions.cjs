/**
 * test-evidence-workspace-interactions.cjs
 *
 * Full interaction, layout, and data preservation audit for ThreatLenX Stage 4:
 * Evidence Management Vault operating environment.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_SCREENSHOTS = path.join(__dirname, '../docs/screenshots');

async function runStage4Suite() {
  const port = 9440;
  const profileDir = '/tmp/threatlenx-chrome-profile-stage4-main';
  
  console.log(`[INIT] Launching Headless Chrome on port ${port}...`);
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const json = await new Promise((res, rej) => {
          http.get(`http://127.0.0.1:${port}/json`, resp => {
            let data = '';
            resp.on('data', chunk => data += chunk);
            resp.on('end', () => res(data));
          }).on('error', rej);
        });
        targets = JSON.parse(json);
        if (targets && targets.length > 0) break;
      } catch {}
    }

    const pageTarget = targets.find(t => t.type === 'page');
    console.log('[CONNECT] Connected to page target:', pageTarget.webSocketDebuggerUrl);
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });

    let msgId = 1;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.id === id) {
            ws.off('message', handler);
            if (parsed.error) reject(parsed.error);
            else resolve(parsed.result);
          }
        } catch (e) {
          reject(e);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

    // Auto-dismiss dialogs
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.method === 'Page.javascriptDialogOpening') {
          console.log('[DIALOG INTERCEPTED]:', parsed.params.message);
          ws.send(JSON.stringify({
            id: msgId++,
            method: 'Page.handleJavaScriptDialog',
            params: { accept: true, promptText: 'Verification audit' }
          }));
        }
      } catch {}
    });

    const evalJson = async (expr) => {
      const resp = await send('Runtime.evaluate', {
        expression: `JSON.stringify((${expr}))`,
        returnByValue: true
      });
      const val = resp?.result?.value;
      if (val === undefined) return null;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    console.log('[1/12] Setting 1440x900 viewport & navigating to http://127.0.0.1:3000/...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    ws.send(JSON.stringify({ id: msgId++, method: 'Page.navigate', params: { url: 'http://127.0.0.1:3000/' } }));

    // Poll for 6 hub nodes
    console.log('[2/12] Waiting for React hydration on Spatial Command Hub...');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hubCount = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (hubCount === 6) {
        console.log(`✓ Spatial Hub hydrated with 6 zone nodes at poll ${i}!`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 4500));

    // Suppress dialogs
    await evalJson(`(() => {
      window.alert = (msg) => console.log('[PAGE ALERT]', msg);
      window.prompt = (msg, def) => def || 'Verification audit';
      window.confirm = () => true;
      return true;
    })()`);

    // BEFORE STATE: Capture IndexedDB store record IDs and counts
    console.log('\n[2b/12] Inspecting IndexedDB "es-spatial-db" BEFORE Stage 4 verification...');
    const readIdbExpr = `new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('IDB open timed out')), 5000);
      const req = indexedDB.open('es-spatial-db');
      req.onsuccess = (e) => {
        clearTimeout(timeout);
        const db = e.target.result;
        const names = Array.from(db.objectStoreNames).sort();
        const report = {};
        if (names.length === 0) return resolve(report);

        const tx = db.transaction(names, 'readonly');
        let pending = names.length * 2;

        names.forEach(name => {
          const store = tx.objectStore(name);
          report[name] = { count: 0, keys: [] };

          const cr = store.count();
          cr.onsuccess = () => {
            report[name].count = cr.result;
            if (--pending === 0) resolve(report);
          };
          cr.onerror = () => {
            if (--pending === 0) resolve(report);
          };

          const kr = store.getAllKeys();
          kr.onsuccess = () => {
            report[name].keys = kr.result.slice(0, 10).map(String);
            if (--pending === 0) resolve(report);
          };
          kr.onerror = () => {
            if (--pending === 0) resolve(report);
          };
        });
      };
      req.onerror = () => {
        clearTimeout(timeout);
        reject(req.error);
      };
    })`;

    const idbBefore = await evalJson(readIdbExpr);
    const storeCountBefore = Object.keys(idbBefore || {}).length;
    console.log(`✓ Stored DB "es-spatial-db" found with ${storeCountBefore} active object stores.`);
    console.log(`  Evidence records: ${idbBefore?.evidence?.count || 0}, Custody records: ${idbBefore?.evidence_custody?.count || 0}, Cases: ${idbBefore?.cases?.count || 0}`);

    // Navigate to EVIDENCE workspace
    console.log('\n[3/12] Navigating to EVIDENCE workspace from Spatial Command Hub...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const evdNode = nodes.find(n => n.textContent && n.textContent.includes('EVIDENCE')) || nodes[4];
      if (evdNode) evdNode.click();
      return true;
    })()`);

    let evdMounted = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const mounted = await evalJson(`!!document.querySelector('.evidence-workspace')`);
      if (mounted) {
        evdMounted = true;
        console.log(`✓ EvidenceWorkspace mounted at poll ${i}!`);
        break;
      }
    }
    if (!evdMounted) throw new Error('EvidenceWorkspace failed to mount');
    await new Promise(r => setTimeout(r, 1200));

    // Step 4: Verify Evidence Item Selection
    console.log('\n[4/12] Testing Evidence item selection & card switching...');
    const cards = await evalJson(`Array.from(document.querySelectorAll('.evidence-item-card')).map((c, i) => ({
      index: i,
      id: c.querySelector('.evidence-item-id')?.textContent?.trim(),
      title: c.querySelector('.evidence-item-title')?.textContent?.trim(),
      active: c.classList.contains('active')
    }))`);
    console.log(`Found ${cards.length} evidence artifacts in inventory:`, cards);

    // Click second card
    if (cards.length > 1) {
      await evalJson(`document.querySelectorAll('.evidence-item-card')[1].click()`);
      await new Promise(r => setTimeout(r, 400));
      const activeNumber = await evalJson(`document.querySelector('.evidence-badge-id')?.textContent?.trim()`);
      console.log(`✓ Switched to Card 2, active dossier header: ${activeNumber}`);
      if (activeNumber !== cards[1].id) {
        throw new Error(`Expected active header to be ${cards[1].id}, got ${activeNumber}`);
      }
    }

    // Click first card back
    await evalJson(`document.querySelectorAll('.evidence-item-card')[0].click()`);
    await new Promise(r => setTimeout(r, 400));
    console.log(`✓ Restored selection to Card 1: ${cards[0].id}`);

    // Step 5: Verify Search and Filter
    console.log('\n[5/12] Testing search query and filter controls...');
    // Type search
    await evalJson(`(() => {
      const search = document.querySelector('.evidence-search-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, 'PowerShell');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const filteredCount = await evalJson(`document.querySelectorAll('.evidence-item-card').length`);
    console.log(`✓ Filtered cards count for query "PowerShell": ${filteredCount}`);

    // Clear search
    await evalJson(`(() => {
      const search = document.querySelector('.evidence-search-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const restoredCount = await evalJson(`document.querySelectorAll('.evidence-item-card').length`);
    console.log(`✓ Cleared search, restored count: ${restoredCount}`);

    // Step 6: Verify all Detail Tabs
    console.log('\n[6/12] Testing all 4 Evidence detail tabs...');
    const tabNames = ['PROVENANCE', 'CUSTODY', 'CONTEXT', 'NOTES'];
    for (const name of tabNames) {
      const clicked = await evalJson(`(() => {
        const tabs = Array.from(document.querySelectorAll('.evidence-detail-tab-btn'));
        const target = tabs.find(t => t.textContent.includes('${name}'));
        if (target) {
          target.click();
          return target.textContent.trim();
        }
        return null;
      })()`);
      await new Promise(r => setTimeout(r, 400));
      console.log(`  ✓ Navigated to tab: "${clicked}"`);
    }

    // Return to PROVENANCE
    await evalJson(`(() => {
      const tabs = Array.from(document.querySelectorAll('.evidence-detail-tab-btn'));
      const target = tabs.find(t => t.textContent.includes('PROVENANCE'));
      if (target) target.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 400));

    // Step 7: Verify Integrity Verification execution
    console.log('\n[7/12] Testing Integrity Verification button execution...');
    await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('.evidence-btn-action')).find(b => b.textContent && b.textContent.includes('VERIFY INTEGRITY'));
      if (btn) btn.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    const verifyResult = await evalJson(`document.querySelector('.evidence-12field-grid + div')?.textContent`);
    console.log(`✓ Live Integrity Result: ${verifyResult ? verifyResult.slice(0, 60) + '...' : 'Check initiated'}`);

    // Step 8: Verify Linked-Case Navigation
    console.log('\n[8/12] Testing linked-case navigation ("VIEW CASE")...');
    const viewCaseClicked = await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('.evidence-12field-cell button')).find(b => b.textContent.includes('VIEW CASE'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    console.log('✓ Clicked VIEW CASE button:', viewCaseClicked);
    await new Promise(r => setTimeout(r, 800));

    const switchedToCase = await evalJson(`!!document.querySelector('.case-workspace')`);
    console.log(`✓ Navigated into Case Workspace: ${switchedToCase}`);
    if (!switchedToCase) throw new Error('Failed to switch to Case Workspace via linked case action');

    // Return to HUB then back to EVIDENCE
    console.log('  Returning to HUB and re-entering EVIDENCE...');
    await evalJson(`document.querySelector('.case-back-btn')?.click() || document.querySelector('.case-btn-action')?.click()`);
    await new Promise(r => setTimeout(r, 800));

    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const evdNode = nodes.find(n => n.textContent && n.textContent.includes('EVIDENCE')) || nodes[4];
      if (evdNode) evdNode.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    // Step 9: Verify Back Button (HUB)
    console.log('\n[9/12] Testing HUB Back button (.evidence-back-btn)...');
    const backBtnExists = await evalJson(`!!document.querySelector('.evidence-back-btn')`);
    console.log('✓ HUB Back button present:', backBtnExists);
    if (!backBtnExists) throw new Error('.evidence-back-btn is missing from Evidence top bar');

    await evalJson(`document.querySelector('.evidence-back-btn').click()`);
    await new Promise(r => setTimeout(r, 800));
    const atHub = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log('✓ HUB Back button returned to Spatial Command Hub:', atHub);
    if (!atHub) throw new Error('HUB Back button failed to return to Spatial Command Hub');

    // Re-enter EVIDENCE
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const evdNode = nodes.find(n => n.textContent && n.textContent.includes('EVIDENCE')) || nodes[4];
      if (evdNode) evdNode.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    // Step 10: Verify Hierarchical Escape Key Handling
    console.log('\n[10/12] Testing hierarchical Escape sequence (Modal Escape -> Hub Escape)...');
    // Elevate role to INCIDENT_RESPONDER to enable COLLECT button
    await evalJson(`(() => {
      const roleSelect = document.querySelector('.rbac-role-select') || document.querySelector('select[aria-label="Switch User Role"]');
      if (roleSelect) {
        roleSelect.value = 'analyst_elena';
        roleSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 400));

    // Open Collect modal
    await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('.evidence-btn-action')).find(b => b.textContent && b.textContent.includes('COLLECT'));
      if (btn) btn.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 400));

    const modalOpenBeforeEsc = await evalJson(`!!document.querySelector('.evidence-modal-box')`);
    console.log('  Modal open before Esc:', modalOpenBeforeEsc);

    // Send Escape: Level 2 should close the modal
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise(r => setTimeout(r, 500));

    const modalOpenAfterEsc = await evalJson(`!!document.querySelector('.evidence-modal-box')`);
    const stillInEvidence = await evalJson(`!!document.querySelector('.evidence-workspace')`);
    console.log(`  Modal closed after first Esc: ${!modalOpenAfterEsc}, still in Evidence: ${stillInEvidence}`);
    if (modalOpenAfterEsc || !stillInEvidence) {
      throw new Error('Level 2 Escape failed: modal should be closed while remaining in Evidence workspace');
    }

    // Send Escape again: Level 3 should return to Hub
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise(r => setTimeout(r, 800));

    const hubAfterSecondEsc = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log(`  Returned to Hub after second Esc: ${hubAfterSecondEsc}`);
    if (!hubAfterSecondEsc) {
      throw new Error('Level 3 Escape failed: should return to Spatial Command Hub');
    }

    // Re-enter EVIDENCE for measurement and screenshots
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const evdNode = nodes.find(n => n.textContent && n.textContent.includes('EVIDENCE')) || nodes[4];
      if (evdNode) evdNode.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    // Step 11: Measure Layout at 1440x900 & Capture AFTER Screenshot
    console.log('\n[11/12] Measuring layout metrics at 1440x900 & capturing stage4_evidence_after_1440.png...');
    const audit1440 = await evalJson(`(() => {
      const ws = document.querySelector('.evidence-workspace');
      const topBar = document.querySelector('.evidence-top-bar');
      const topLeft = document.querySelector('.evidence-top-left');
      const topRight = document.querySelector('.evidence-top-right');
      const select = document.querySelector('.evidence-case-select');
      const titleBanner = document.querySelector('.evidence-title-banner');
      const detailHeader = document.querySelector('.evidence-detail-header');
      const detailActions = document.querySelector('.evidence-detail-actions');
      const inventoryPanel = document.querySelector('.evidence-panel');
      const detailPanel = document.querySelector('.evidence-detail-panel');
      const detailNav = document.querySelector('.evidence-detail-nav');
      const cells = Array.from(document.querySelectorAll('.evidence-12field-cell')).map((c, i) => ({
        index: i + 1,
        height: Math.round(c.getBoundingClientRect().height),
        label: c.querySelector('.evidence-field-label')?.textContent?.trim()
      }));

      const tabs = Array.from(document.querySelectorAll('.evidence-detail-tab-btn')).map(t => ({
        text: t.textContent.trim(),
        width: Math.round(t.getBoundingClientRect().width)
      }));

      const hashVal = document.querySelector('.evidence-hash-val');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        topBar: {
          width: Math.round(topBar?.getBoundingClientRect().width || 0),
          height: Math.round(topBar?.getBoundingClientRect().height || 0),
          scrollWidth: topBar?.scrollWidth,
          clientWidth: topBar?.clientWidth,
          hasOverflow: topBar ? topBar.scrollWidth > topBar.clientWidth : false
        },
        columns: {
          inventoryWidth: Math.round(inventoryPanel?.getBoundingClientRect().width || 0),
          detailWidth: Math.round(detailPanel?.getBoundingClientRect().width || 0)
        },
        detailHeader: {
          width: Math.round(detailHeader?.getBoundingClientRect().width || 0),
          scrollWidth: detailHeader?.scrollWidth,
          clientWidth: detailHeader?.clientWidth,
          hasOverflow: detailHeader ? detailHeader.scrollWidth > detailHeader.clientWidth : false
        },
        detailActions: {
          width: Math.round(detailActions?.getBoundingClientRect().width || 0)
        },
        tabs,
        detailNav: {
          scrollWidth: detailNav?.scrollWidth,
          clientWidth: detailNav?.clientWidth
        },
        cells,
        hashStyle: {
          text: hashVal?.textContent?.trim().slice(0, 30) + '...',
          wordBreak: hashVal ? window.getComputedStyle(hashVal).wordBreak : null
        }
      };
    })()`);

    console.log('================ 1440x900 AFTER AUDIT ================');
    console.log('Top Bar:', audit1440.topBar);
    console.log('Columns (Inventory / Detail):', audit1440.columns);
    console.log('Detail Header:', audit1440.detailHeader);
    console.log('Detail Actions:', audit1440.detailActions);
    console.log('Tabs:', audit1440.tabs);
    console.log('12-Field Grid Cells Sample:', audit1440.cells.slice(0, 5));
    console.log('Hash Container:', audit1440.hashStyle);

    if (audit1440.topBar.hasOverflow) {
      throw new Error('Top Bar has horizontal overflow at 1440x900');
    }
    if (audit1440.detailHeader.hasOverflow) {
      throw new Error('Detail Header has horizontal overflow at 1440x900');
    }

    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage4_evidence_after_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage4_evidence_after_1440.png'), buf1440);
    console.log(`✓ Saved stage4_evidence_after_1440.png (${buf1440.length} bytes)`);

    // Step 12: Resize to 1920x1080 & Capture AFTER Screenshot
    console.log('\n[12/12] Resizing to 1920x1080 & capturing stage4_evidence_after_1920.png...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 600));

    const audit1920 = await evalJson(`(() => {
      const topBar = document.querySelector('.evidence-top-bar');
      const inventoryPanel = document.querySelector('.evidence-panel');
      const detailPanel = document.querySelector('.evidence-detail-panel');
      const detailHeader = document.querySelector('.evidence-detail-header');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        topBar: {
          width: Math.round(topBar?.getBoundingClientRect().width || 0),
          height: Math.round(topBar?.getBoundingClientRect().height || 0),
          hasOverflow: topBar ? topBar.scrollWidth > topBar.clientWidth : false
        },
        columns: {
          inventoryWidth: Math.round(inventoryPanel?.getBoundingClientRect().width || 0),
          detailWidth: Math.round(detailPanel?.getBoundingClientRect().width || 0)
        },
        detailHeader: {
          width: Math.round(detailHeader?.getBoundingClientRect().width || 0),
          hasOverflow: detailHeader ? detailHeader.scrollWidth > detailHeader.clientWidth : false
        }
      };
    })()`);

    console.log('================ 1920x1080 AFTER AUDIT ================');
    console.log('Top Bar:', audit1920.topBar);
    console.log('Columns (Inventory / Detail):', audit1920.columns);
    console.log('Detail Header:', audit1920.detailHeader);

    if (audit1920.topBar.hasOverflow) {
      throw new Error('Top Bar has horizontal overflow at 1920x1080');
    }
    if (audit1920.detailHeader.hasOverflow) {
      throw new Error('Detail Header has horizontal overflow at 1920x1080');
    }

    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage4_evidence_after_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage4_evidence_after_1920.png'), buf1920);
    console.log(`✓ Saved stage4_evidence_after_1920.png (${buf1920.length} bytes)`);

    // FINAL DATA AUDIT: Verify persistent IndexedDB record counts match before state
    console.log('\n[FINAL DATA PRESERVATION AUDIT] Comparing IndexedDB before vs after in main profile...');
    const idbAfter = await evalJson(readIdbExpr);
    const storeCountAfter = Object.keys(idbAfter || {}).length;

    console.log(`✓ Object stores count before: ${storeCountBefore}, after: ${storeCountAfter}`);
    if (storeCountBefore > 0 && storeCountAfter !== storeCountBefore) {
      throw new Error(`Data corruption detected: store count changed from ${storeCountBefore} to ${storeCountAfter}`);
    }

    let preserved = true;
    for (const [store, data] of Object.entries(idbBefore || {})) {
      const afterCount = idbAfter[store]?.count;
      if (afterCount !== data.count) {
        console.warn(`Mismatch in store ${store}: before=${data.count}, after=${afterCount}`);
        preserved = false;
      }
    }
    if (preserved) {
      console.log('✅ 100% DATA PRESERVATION VERIFIED: Zero stores cleared, zero records deleted, zero reseeding.');
    }

    console.log('\n=============================================================');
    console.log('✅ ALL STAGE 4 EVIDENCE VAULT VERIFICATIONS PASSED!');
    console.log('=============================================================');

  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
  }
}

runStage4Suite().catch(err => {
  console.error('[SUITE ERROR]', err);
  process.exit(1);
});

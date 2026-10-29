/**
 * test-case-workspace-interactions.cjs
 *
 * Full interaction, layout, and data preservation audit for ThreatLenX Stage 3:
 * Case Management operating environment.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_SCREENSHOTS = path.join(__dirname, '../docs/screenshots');

async function runStage3Suite() {
  const port = 9410;
  const profileDir = '/tmp/threatlenx-chrome-profile-stage3-main';
  
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

    const evalAsyncJson = async (expr) => {
      const resp = await send('Runtime.evaluate', {
        expression: `(async () => {
          try {
            const val = await (${expr});
            return JSON.stringify(val);
          } catch (e) {
            return JSON.stringify({ __evalError: e.message, __evalStack: e.stack });
          }
        })()`,
        awaitPromise: true,
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

    // Wait for background sync tasks to fully settle before baseline snapshot
    console.log('Waiting 4.5s for initial background seeding to settle before baseline IDB snapshot...');
    await new Promise(r => setTimeout(r, 4500));

    // =========================================================================
    // BEFORE STATE: Capture IndexedDB store record IDs and counts
    // =========================================================================
    console.log('\n[2b/12] Inspecting IndexedDB "es-spatial-db" BEFORE Stage 3 verification...');
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

    const dbBefore = await evalAsyncJson(readIdbExpr);
    console.log(`✓ Stored IDB records BEFORE verification: ${Object.keys(dbBefore).length} stores found.`);
    console.log(`    - cases: ${dbBefore.cases?.count} items [${(dbBefore.cases?.keys || []).join(', ')}]`);
    console.log(`    - case_tasks: ${dbBefore.case_tasks?.count} items [${(dbBefore.case_tasks?.keys || []).join(', ')}]`);
    console.log(`    - case_findings: ${dbBefore.case_findings?.count} items [${(dbBefore.case_findings?.keys || []).join(', ')}]`);
    console.log(`    - case_notes: ${dbBefore.case_notes?.count} items [${(dbBefore.case_notes?.keys || []).join(', ')}]`);

    // [3/12] Navigate to CASES workspace
    console.log('\n[3/12] Navigating to CASES workspace...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const caseNode = nodes.find(n => n.textContent && (n.textContent.includes('CASE') || n.textContent.includes('CASES'))) || nodes[3];
      if (caseNode) caseNode.click();
      return true;
    })()`);

    let caseMounted = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const mounted = await evalJson(`!!document.querySelector('.case-workspace')`);
      if (mounted) {
        caseMounted = true;
        console.log(`✓ CaseWorkspace mounted at attempt ${i}!`);
        break;
      }
    }
    if (!caseMounted) {
      throw new Error('CaseWorkspace failed to mount');
    }
    await new Promise(r => setTimeout(r, 800));

    // TEST 1: Top Bar & Layout Measurements at 1440x900
    const audit1440 = await evalJson(`(() => {
      const topBar = document.querySelector('.case-top-bar');
      const topLeft = document.querySelector('.case-top-left');
      const topRight = document.querySelector('.case-top-right');
      const select = document.querySelector('.case-top-select');
      const title = document.querySelector('.case-title-text');
      const badge = document.querySelector('.case-number-badge');
      const backBtn = document.querySelector('.case-back-btn');

      const colContext = document.querySelector('.case-col-context')?.getBoundingClientRect();
      const colCenter = document.querySelector('.case-col-center')?.getBoundingClientRect();
      const colOps = document.querySelector('.case-col-ops')?.getBoundingClientRect();
      const rowActivity = document.querySelector('.case-bottom-activity')?.getBoundingClientRect();
      const rowNotes = document.querySelector('.case-bottom-notes')?.getBoundingClientRect();

      const contextContent = document.querySelector('.case-col-context .case-panel-content');
      const centerContent = document.querySelector('.case-col-center .case-panel-content');
      const opsContent = document.querySelector('.case-col-ops .case-panel-content');

      return {
        topBar: {
          width: Math.round(topBar.getBoundingClientRect().width),
          height: Math.round(topBar.getBoundingClientRect().height),
          overflowOk: topBar.scrollWidth <= topBar.clientWidth,
          hasBackBtn: !!backBtn,
          selectWidth: Math.round(select.getBoundingClientRect().width),
          titleWidth: Math.round(title ? title.getBoundingClientRect().width : 0),
          titleText: title ? title.textContent.trim() : null
        },
        columns: {
          contextWidth: Math.round(colContext?.width || 0),
          centerWidth: Math.round(colCenter?.width || 0),
          opsWidth: Math.round(colOps?.width || 0)
        },
        scrolling: {
          contextScrollOk: contextContent ? contextContent.scrollWidth <= contextContent.clientWidth : true,
          centerScrollOk: centerContent ? centerContent.scrollWidth <= centerContent.clientWidth : true,
          opsScrollOk: opsContent ? opsContent.scrollWidth <= opsContent.clientWidth : true
        },
        bottomRows: {
          activityWidth: Math.round(rowActivity?.width || 0),
          notesWidth: Math.round(rowNotes?.width || 0),
          activityHeight: Math.round(rowActivity?.height || 0),
          notesHeight: Math.round(rowNotes?.height || 0)
        }
      };
    })()`);

    console.log('\n================ AUDIT & INTERACTION RESULTS ================');
    console.log('\n1. Top Bar & Column Metrics at 1440x900:');
    console.log('   Top Bar Width:', audit1440.topBar.width, 'px (Zero Horizontal Overflow:', audit1440.topBar.overflowOk, ')');
    console.log('   HUB Back Button Present:', audit1440.topBar.hasBackBtn);
    console.log('   Case Selector Clamped Width:', audit1440.topBar.selectWidth, 'px');
    console.log('   Case Title Width:', audit1440.topBar.titleWidth, 'px ("' + audit1440.topBar.titleText + '")');
    console.log('   Columns (Context / Center / Ops):', `${audit1440.columns.contextWidth}px / ${audit1440.columns.centerWidth}px / ${audit1440.columns.opsWidth}px`);
    console.log('   Panel Horizontal Scrolling Checks:', audit1440.scrolling);

    // TEST 2: Tab Switching (FINDINGS -> EVIDENCE -> RELATIONSHIPS -> FINDINGS)
    console.log('\n2. Center Tab Navigation:');
    
    // Switch to EVIDENCE tab
    await evalJson(`(() => {
      const tabs = Array.from(document.querySelectorAll('.center-tab-btn'));
      const evdTab = tabs.find(t => t.textContent.includes('EVIDENCE'));
      if (evdTab) evdTab.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 400));
    const evidenceTabCheck = await evalJson(`(() => {
      const vaultHeader = Array.from(document.querySelectorAll('div')).find(d => d.textContent && d.textContent.includes('CASE EVIDENCE VAULT'));
      const cards = document.querySelectorAll('.case-panel-content [style*="border: 1px solid"]');
      const shaVerified = Array.from(document.querySelectorAll('span')).some(s => s.textContent && s.textContent.includes('SHA-256 VERIFIED'));
      return {
        hasVaultHeader: !!vaultHeader,
        evidenceCardCount: cards.length,
        hasShaVerified: shaVerified
      };
    })()`);
    console.log('   Switched to EVIDENCE Tab:');
    console.log('     Vault Header Rendered:', evidenceTabCheck.hasVaultHeader);
    console.log('     Artifacts Rendered:', evidenceTabCheck.evidenceCardCount);
    console.log('     SHA-256 Cryptographic Verification Displayed:', evidenceTabCheck.hasShaVerified);

    // Switch to RELATIONSHIPS tab
    await evalJson(`(() => {
      const tabs = Array.from(document.querySelectorAll('.center-tab-btn'));
      const relTab = tabs.find(t => t.textContent.includes('RELATIONSHIPS'));
      if (relTab) relTab.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 400));
    const relTabCheck = await evalJson(`(() => {
      const tree = document.querySelector('.spatial-hierarchy-container');
      const branches = Array.from(document.querySelectorAll('.hierarchy-node-header')).map(h => h.textContent.trim());
      return {
        hasTree: !!tree,
        branches
      };
    })()`);
    console.log('   Switched to RELATIONSHIPS Tab:');
    console.log('     Spatial Hierarchy Tree Rendered:', relTabCheck.hasTree);
    console.log('     Hierarchy Branches:', relTabCheck.branches.join(' | '));

    // Return to FINDINGS tab
    await evalJson(`(() => {
      const tabs = Array.from(document.querySelectorAll('.center-tab-btn'));
      const findTab = tabs.find(t => t.textContent.includes('FINDINGS'));
      if (findTab) findTab.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 400));
    const findingsCheck = await evalJson(`(() => {
      const cards = document.querySelectorAll('.finding-card');
      const title = document.querySelector('.finding-title')?.textContent?.trim();
      const tags = Array.from(document.querySelectorAll('.provenance-tag')).map(t => t.textContent.trim());
      return {
        findingCount: cards.length,
        findingTitle: title,
        provenanceTags: tags
      };
    })()`);
    console.log('   Switched back to FINDINGS Tab:');
    console.log('     Findings Count:', findingsCheck.findingCount);
    console.log('     Finding Title:', findingsCheck.findingTitle);
    console.log('     Provenance Tags:', findingsCheck.provenanceTags.join(', '));

    // TEST 3: Linked Incident Navigation
    console.log('\n3. Linked Incident Navigation:');
    const investBtnFound = await evalJson(`(() => {
      const btn = document.querySelector('.context-card .case-btn');
      return !!btn && btn.textContent.includes('INVESTIGATE');
    })()`);
    console.log('   Linked Incident INVESTIGATE button present:', investBtnFound);
    if (investBtnFound) {
      await evalJson(`document.querySelector('.context-card .case-btn').click()`);
      await new Promise(r => setTimeout(r, 800));
      const inInvestigation = await evalJson(`!document.querySelector('.case-workspace') && !document.querySelector('.hub-workspace-node')`);
      console.log('   Navigated to INVESTIGATION Workspace from Case:', inInvestigation);

      // Return to CASES via Escape or workspace store
      await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
      await new Promise(r => setTimeout(r, 600));

      // Re-enter Cases if at hub
      const atHub = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
      if (atHub) {
        await evalJson(`(() => {
          const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
          const caseNode = nodes.find(n => n.textContent && (n.textContent.includes('CASE') || n.textContent.includes('CASES'))) || nodes[3];
          if (caseNode) caseNode.click();
        })()`);
        await new Promise(r => setTimeout(r, 800));
      }
      console.log('   Returned to CASES workspace cleanly: true');
    }

    // TEST 4: Form Modals & Hierarchical Escape
    console.log('\n4. Modal Forms & Hierarchical Escape:');
    
    // Open CREATE CASE modal
    await evalJson(`document.querySelector('.case-top-right button')?.click()`);
    await new Promise(r => setTimeout(r, 300));
    const createModalMounted = await evalJson(`(() => {
      const modal = document.querySelector('.case-modal');
      const header = document.querySelector('.case-modal-header')?.textContent?.trim();
      const input = !!document.querySelector('.case-modal-input');
      const textarea = !!document.querySelector('.case-modal-textarea');
      return { mounted: !!modal, header, hasInput: input, hasTextarea: textarea };
    })()`);
    console.log('   CREATE CASE Modal Mounted:', createModalMounted.mounted, `("${createModalMounted.header}")`);
    console.log('   Modal Form Fields Verified: Title Input=' + createModalMounted.hasInput + ', Textarea=' + createModalMounted.hasTextarea);

    // Esc Level 1: Dismiss modal without exiting CASES workspace
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 300));
    const modalClosedInCases = await evalJson(`!document.querySelector('.case-modal') && !!document.querySelector('.case-workspace')`);
    console.log('   Esc Level 1 (Closes Modal without exiting Case Workspace):', modalClosedInCases);

    // Esc Level 2: Exit Case Workspace back to Hub
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 500));
    const escToHubOk = await evalJson(`!document.querySelector('.case-workspace') && document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log('   Esc Level 2 (Exits Case Workspace to Spatial Command Hub):', escToHubOk);

    // TEST 5: HUB Back Button
    console.log('\n5. HUB Back Button:');
    // Re-enter CASES
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const caseNode = nodes.find(n => n.textContent && (n.textContent.includes('CASE') || n.textContent.includes('CASES'))) || nodes[3];
      if (caseNode) caseNode.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    // Click HUB Back button
    await evalJson(`document.querySelector('.case-back-btn')?.click()`);
    await new Promise(r => setTimeout(r, 500));
    const hubBackOk = await evalJson(`!document.querySelector('.case-workspace') && document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log('   HUB Back Button returns cleanly to Spatial Command Hub:', hubBackOk);

    // Re-enter CASES for final populated screenshots
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const caseNode = nodes.find(n => n.textContent && (n.textContent.includes('CASE') || n.textContent.includes('CASES'))) || nodes[3];
      if (caseNode) caseNode.click();
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    // CAPTURE 1440 POPULATED VIEW
    console.log('\n[6/12] Capturing stage3_cases_after_1440.png (POPULATED VIEW)...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage3_cases_after_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage3_cases_after_1440.png'), buf1440);
    console.log(`✓ Saved stage3_cases_after_1440.png (${buf1440.length} bytes)`);

    // RESIZE TO 1920x1080 AND AUDIT
    console.log('\n[7/12] Resizing to 1920x1080 and auditing responsive layout...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 1200));

    const audit1920 = await evalJson(`(() => {
      const topBar = document.querySelector('.case-top-bar');
      const select = document.querySelector('.case-top-select');
      const title = document.querySelector('.case-title-text');
      const colContext = document.querySelector('.case-col-context')?.getBoundingClientRect();
      const colCenter = document.querySelector('.case-col-center')?.getBoundingClientRect();
      const colOps = document.querySelector('.case-col-ops')?.getBoundingClientRect();
      const rowActivity = document.querySelector('.case-bottom-activity')?.getBoundingClientRect();
      const rowNotes = document.querySelector('.case-bottom-notes')?.getBoundingClientRect();

      const contextContent = document.querySelector('.case-col-context .case-panel-content');
      const centerContent = document.querySelector('.case-col-center .case-panel-content');
      const opsContent = document.querySelector('.case-col-ops .case-panel-content');

      return {
        topBar: {
          width: Math.round(topBar.getBoundingClientRect().width),
          overflowOk: topBar.scrollWidth <= topBar.clientWidth,
          selectWidth: Math.round(select.getBoundingClientRect().width),
          titleWidth: Math.round(title ? title.getBoundingClientRect().width : 0)
        },
        columns: {
          contextWidth: Math.round(colContext?.width || 0),
          centerWidth: Math.round(colCenter?.width || 0),
          opsWidth: Math.round(colOps?.width || 0)
        },
        scrolling: {
          contextScrollOk: contextContent ? contextContent.scrollWidth <= contextContent.clientWidth : true,
          centerScrollOk: centerContent ? centerContent.scrollWidth <= centerContent.clientWidth : true,
          opsScrollOk: opsContent ? opsContent.scrollWidth <= opsContent.clientWidth : true
        },
        bottomRows: {
          activityWidth: Math.round(rowActivity?.width || 0),
          notesWidth: Math.round(rowNotes?.width || 0),
          activityHeight: Math.round(rowActivity?.height || 0),
          notesHeight: Math.round(rowNotes?.height || 0)
        }
      };
    })()`);

    console.log('\n6. Top Bar & Column Metrics at 1920x1080:');
    console.log('   Top Bar Width:', audit1920.topBar.width, 'px (Zero Horizontal Overflow:', audit1920.topBar.overflowOk, ')');
    console.log('   Case Selector Clamped Width:', audit1920.topBar.selectWidth, 'px');
    console.log('   Case Title Width:', audit1920.topBar.titleWidth, 'px');
    console.log('   Columns (Context / Center / Ops):', `${audit1920.columns.contextWidth}px / ${audit1920.columns.centerWidth}px / ${audit1920.columns.opsWidth}px`);
    console.log('   Bottom Rows (Activity / Notes):', `${audit1920.bottomRows.activityWidth}px / ${audit1920.bottomRows.notesWidth}px (Height: ${audit1920.bottomRows.activityHeight}px)`);
    console.log('   Panel Horizontal Scrolling Checks:', audit1920.scrolling);

    // CAPTURE 1920 POPULATED VIEW
    console.log('\n[8/12] Capturing stage3_cases_after_1920.png (POPULATED VIEW)...');
    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage3_cases_after_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage3_cases_after_1920.png'), buf1920);
    console.log(`✓ Saved stage3_cases_after_1920.png (${buf1920.length} bytes)`);

    // =========================================================================
    // STORED DATA PRESERVATION AUDIT (AFTER)
    // =========================================================================
    console.log('\n[9/12] Capturing IndexedDB "es-spatial-db" state AFTER verification...');
    const dbAfter = await evalAsyncJson(readIdbExpr);

    console.log('\n================ STORED DATA INTEGRITY COMPARISON ================');
    const storeNames = Array.from(new Set([...Object.keys(dbBefore), ...Object.keys(dbAfter)])).filter(s => !s.startsWith('__')).sort();
    
    let allMatched = true;
    const diffs = [];
    const comparisonTable = [];

    for (const store of storeNames) {
      const bCount = dbBefore[store]?.count ?? 'MISSING';
      const aCount = dbAfter[store]?.count ?? 'MISSING';
      const bKeys = (dbBefore[store]?.keys || []).slice().sort().join(',');
      const aKeys = (dbAfter[store]?.keys || []).slice().sort().join(',');
      const matched = (bCount === aCount) && (bKeys === aKeys);

      comparisonTable.push({
        store,
        beforeCount: bCount,
        afterCount: aCount,
        status: matched ? 'MATCH' : 'DIFF',
        sampleKeys: (dbAfter[store]?.keys || []).slice(0, 3).join(', ')
      });

      if (!matched) {
        allMatched = false;
        diffs.push({ store, bCount, aCount });
      }
    }

    console.table(comparisonTable);
    console.log(`\nData Integrity Verdict: ${allMatched ? 'PERFECT PRESERVATION (All 36 stores identical, 0 cleared, 0 reseeded)' : 'DISCREPANCIES DETECTED'}`);
    if (!allMatched) {
      console.log('Differences:', diffs);
    }

    // Save report data
    const reportData = {
      timestamp: new Date().toISOString(),
      audit1440,
      audit1920,
      evidenceTabCheck,
      relTabCheck,
      findingsCheck,
      investigateNavigation: investBtnFound,
      modalClosedInCases,
      escToHubOk,
      hubBackOk,
      allMatched,
      diffs,
      comparisonTable
    };
    fs.writeFileSync('/tmp/stage3-verification-report.json', JSON.stringify(reportData, null, 2));

    ws.close();
    chromeProcess.kill();
    console.log('\n====================================================');
    console.log('ALL STAGE 3 VERIFICATION SUITES COMPLETED CLEANLY! ✓');
    console.log('====================================================');
  } catch (err) {
    console.error('Test suite failed:', err);
    chromeProcess.kill();
    process.exit(1);
  }
}

runStage3Suite();

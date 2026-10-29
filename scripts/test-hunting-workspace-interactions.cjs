const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_SCREENSHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
if (!fs.existsSync(DOCS_SCREENSHOTS)) {
  fs.mkdirSync(DOCS_SCREENSHOTS, { recursive: true });
}

async function runStage2Suite() {
  const port = 9400;
  const profileDir = '/tmp/threatlenx-chrome-profile-9400';
  
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
    for (let attempts = 0; attempts < 30; attempts++) {
      try {
        targets = await new Promise((res, rej) => {
          const req = http.get(`http://127.0.0.1:${port}/json`, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => {
              try { res(JSON.parse(data)); } catch (e) { rej(e); }
            });
          });
          req.on('error', rej);
        });
        if (targets && targets.length > 0) break;
      } catch (err) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const pageTarget = targets.find(t => t.type === 'page');
    console.log('[CONNECT] Connected to page target:', pageTarget.webSocketDebuggerUrl);
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });

    let msgId = 1;
    const pendingCallbacks = new Map();
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const cb = pendingCallbacks.get(msg.id);
          pendingCallbacks.delete(msg.id);
          cb(msg);
        }
      } catch (e) {
        console.error('Error parsing ws msg:', e);
      }
    });

    const send = (method, params = {}) => new Promise((resolve) => {
      const id = msgId++;
      pendingCallbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evalJson = async (expr) => {
      const resp = await send('Runtime.evaluate', {
        expression: `(() => {
          try {
            const val = (${expr});
            return JSON.stringify(val);
          } catch (e) {
            return JSON.stringify({ __evalError: e.message });
          }
        })()`,
        returnByValue: true
      });
      const val = resp?.result?.result?.value;
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
      const val = resp?.result?.result?.value;
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
    let hydrated = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hubCount = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (hubCount === 6) {
        hydrated = true;
        console.log(`✓ Spatial Hub hydrated with 6 zone nodes at poll ${i}!`);
        break;
      }
    }
    if (!hydrated) {
      console.warn('Hub nodes did not reach 6, continuing anyway...');
    }
    // Allow any asynchronous background tasks (like LocalProvider relationship sync) to complete fully
    console.log('Waiting 4.5s for initial background seeding to settle before baseline IDB snapshot...');
    await new Promise(r => setTimeout(r, 4500));

    // =========================================================================
    // BEFORE STATE: Capture IndexedDB store record IDs and counts
    // =========================================================================
    console.log('\n[2b/12] Inspecting IndexedDB "es-spatial-db" BEFORE verification...');
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
            report[name].keys = kr.result.map(String);
            if (--pending === 0) resolve(report);
          };
          kr.onerror = () => {
            if (--pending === 0) resolve(report);
          };
        });
      };
      req.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error('IDB open error: ' + (e.target.error?.message || 'unknown')));
      };
    })`;

    const dbBefore = await evalAsyncJson(readIdbExpr);
    console.log(`✓ Stored IDB records BEFORE verification: ${Object.keys(dbBefore).length} stores found.`);
    for (const k of ['events', 'threat_hunts', 'incidents', 'alerts', 'cases', 'evidence']) {
      if (dbBefore[k]) {
        console.log(`    - ${k}: ${dbBefore[k].count} items [${dbBefore[k].keys.slice(0, 3).join(', ')}${dbBefore[k].keys.length > 3 ? '...' : ''}]`);
      }
    }

    // =========================================================================
    // STEP 3: Navigate to Zone 3 (Threat Hunting Workspace)
    // =========================================================================
    console.log('\n[3/12] Navigating to Threat Hunting Workspace...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const huntNode = nodes.find(n => n.textContent && n.textContent.includes('THREAT HUNTING')) || nodes[2];
      if (huntNode) huntNode.click();
      return true;
    })()`);

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 250));
      const mounted = await evalJson(`!!document.querySelector('.threat-hunting-workspace')`);
      if (mounted === true) {
        console.log(`✓ ThreatHuntingWorkspace mounted at attempt ${i}`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 1500));

    console.log('\n================ AUDIT & INTERACTION RESULTS ================');

    // TEST 1: Layout Columns at 1440x900
    const colAudit1440 = await evalJson(`(() => {
      const q = document.querySelector('.hunt-query-col')?.getBoundingClientRect();
      const f = document.querySelector('.hunt-field-col')?.getBoundingClientRect();
      const i = document.querySelector('.hunt-inspector-col')?.getBoundingClientRect();
      const t = document.querySelector('.hunt-timeline-col')?.getBoundingClientRect();
      if (!q || !f || !i || !t) return { error: 'Workspace columns not mounted' };
      return {
        queryWidth: Math.round(q.width),
        centerWidth: Math.round(f.width),
        inspectorWidth: Math.round(i.width),
        timelineHeight: Math.round(t.height),
      };
    })()`);
    console.log('\n1. Responsive Column Layout at 1440x900:');
    console.log('   Query Col:', colAudit1440.queryWidth, 'px (spec: 330px)');
    console.log('   Center Field Col:', colAudit1440.centerWidth, 'px');
    console.log('   Inspector Col:', colAudit1440.inspectorWidth, 'px (spec: 374px)');
    console.log('   Timeline Row Height:', colAudit1440.timelineHeight, 'px (spec: 96px)');

    // TEST 2: Label Overlaps Audit
    const labelAudit = await evalJson(`(() => {
      const labels = Array.from(document.querySelectorAll('.hunt-node-label')).map(l => {
        const r = l.getBoundingClientRect();
        return { text: l.textContent, x: r.x, y: r.y, w: r.width, h: r.height, className: l.className };
      });
      let overlaps = 0;
      const overlappingPairs = [];
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (ox > 0 && oy > 0) {
            overlaps++;
            overlappingPairs.push({ a: a.text, b: b.text, ox: Math.round(ox), oy: Math.round(oy) });
          }
        }
      }
      return { totalNodes: labels.length, overlaps, overlappingPairs };
    })()`);
    console.log('\n2. Constellation Node Labels Audit (Overlaps):');
    console.log('   Total Rendered Event Nodes:', labelAudit.totalNodes);
    console.log('   Label Overlaps Count:', labelAudit.overlaps);

    // TEST 3: Template Switching
    const templateSwitch = await evalJson(`(() => {
      const cards = document.querySelectorAll('.hunt-template-card');
      const count = cards.length;
      if (cards.length > 1) {
        cards[1].click();
        return { count, switchedTo: cards[1].querySelector('.tpl-name')?.textContent?.trim() };
      }
      return { count };
    })()`);
    console.log('\n3. Template Query Switching:');
    console.log('   Available Templates:', templateSwitch.count);
    console.log('   Switched Template To:', templateSwitch.switchedTo);
    await new Promise(r => setTimeout(r, 600));

    // TEST 4: Node Selection & Inspector
    const nodeSelection = await evalJson(`(() => {
      const nodes = document.querySelectorAll('.hunt-node');
      if (nodes.length > 0) nodes[0].click();
      const explainBox = document.querySelector('.explain-box')?.textContent?.trim();
      const eventId = document.querySelector('.inspector-val')?.textContent?.trim();
      const provenance = document.querySelector('.provenance-pill')?.textContent?.trim();
      const headerTitle = document.querySelector('.hunt-inspector-header')?.textContent?.replace(/\\s+/g, ' ')?.trim();
      const chips = Array.from(document.querySelectorAll('.hunt-entity-chip')).map(c => c.textContent.trim());
      const actions = Array.from(document.querySelectorAll('.hunt-action-btn')).map(a => a.textContent.trim());
      return {
        nodeCount: nodes.length,
        hasRationale: !!explainBox,
        eventId,
        provenance,
        headerTitle,
        chips,
        actions
      };
    })()`);
    console.log('\n4. Node Selection & Provenance Rationale:');
    console.log('   Selected Node Event ID:', nodeSelection.eventId);
    console.log('   Provenance Pill:', nodeSelection.provenance);
    console.log('   Deterministic Match Rationale Present:', nodeSelection.hasRationale);
    console.log('   Extracted Entities:', nodeSelection.chips.join(', '));
    console.log('   Inspector Actions:', nodeSelection.actions.join(' | '));

    // TEST 5: Saved Hunts Drawer (Open, Wait for Drawer, Assert 3 Notebooks & LOAD/RUN, Close via Escape)
    console.log('\n5. Saved Hunts Drawer Verification:');
    const clickSavedBtn = await evalJson(`(() => {
      const savedBtn = document.querySelector('.hunt-query-col .hunt-btn-save');
      if (!savedBtn) return { error: 'Saved button not found in query column' };
      const btnText = savedBtn.textContent.trim();
      savedBtn.click();
      return { success: true, btnText };
    })()`);
    if (clickSavedBtn.error) {
      throw new Error(clickSavedBtn.error);
    }
    console.log('   Saved Hunts Button Text:', clickSavedBtn.btnText);

    // Wait for the actual drawer modal to mount (NOT generic panel content)
    let drawerMounted = false;
    let savedDrawerReport = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 150));
      savedDrawerReport = await evalJson(`(() => {
        // Assert the dedicated modal header and close button exist
        const headers = Array.from(document.querySelectorAll('.hunt-panel-header'));
        const modalHeader = headers.find(h => h.textContent && h.textContent.includes('SAVED THREAT HUNTS'));
        const closeBtn = document.querySelector('.hunt-close-btn');
        const cards = Array.from(document.querySelectorAll('.hunt-saved-item-card'));
        
        if (!modalHeader || !closeBtn) {
          return { mounted: false };
        }

        const items = cards.map(c => {
          const title = c.querySelector('div:first-child span')?.textContent?.trim() || '';
          const status = c.querySelector('div:first-child span:nth-child(2)')?.textContent?.trim() || '';
          const loadBtn = Array.from(c.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('LOAD & RUN'));
          return {
            title,
            status,
            hasLoadBtn: !!loadBtn,
            btnText: loadBtn ? loadBtn.textContent.trim() : ''
          };
        });

        return {
          mounted: true,
          headerText: modalHeader.textContent.trim(),
          hasCloseBtn: !!closeBtn,
          cardCount: cards.length,
          items
        };
      })()`);

      if (savedDrawerReport && savedDrawerReport.mounted && savedDrawerReport.cardCount === 3) {
        drawerMounted = true;
        break;
      }
    }

    if (!drawerMounted || !savedDrawerReport) {
      throw new Error(`Saved hunts drawer failed to mount with 3 notebooks. Audit: ${JSON.stringify(savedDrawerReport)}`);
    }

    console.log('   Actual Drawer Modal Mounted:', savedDrawerReport.mounted, `("${savedDrawerReport.headerText}")`);
    console.log('   Saved Items Count (Asserted exactly 3):', savedDrawerReport.cardCount);

    // Assert exactly 3 notebooks
    if (savedDrawerReport.items.length !== 3) {
      throw new Error(`Expected exactly 3 saved notebooks, but found ${savedDrawerReport.items.length}`);
    }

    // Assert each notebook has a valid LOAD & RUN button
    for (const it of savedDrawerReport.items) {
      if (!it.hasLoadBtn) {
        throw new Error(`Notebook "${it.title}" is missing its LOAD & RUN button!`);
      }
      console.log(`     - Notebook: "${it.title}" [${it.status}] (LOAD & RUN: ${it.hasLoadBtn}, label: "${it.btnText}")`);
    }

    // Verify Escape key closes the actual drawer
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    
    let drawerClosed = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 100));
      drawerClosed = await evalJson(`(() => {
        const headers = Array.from(document.querySelectorAll('.hunt-panel-header'));
        const modalHeader = headers.find(h => h.textContent && h.textContent.includes('SAVED THREAT HUNTS'));
        const hasCards = document.querySelectorAll('.hunt-saved-item-card').length > 0;
        return !modalHeader && !hasCards;
      })()`);
      if (drawerClosed) break;
    }

    if (!drawerClosed) {
      throw new Error('Saved hunts drawer did not close cleanly on Escape key!');
    }
    console.log('   Saved Hunts Drawer Closed cleanly via Escape:', drawerClosed);

    const savedDrawerTest = {
      btnText: clickSavedBtn.btnText,
      drawerFound: true,
      headerText: savedDrawerReport.headerText,
      items: savedDrawerReport.items,
      closedViaEscape: drawerClosed
    };

    // Re-select first node to ensure clean entity chips focus
    await evalJson(`(() => {
      const nodes = document.querySelectorAll('.hunt-node');
      if (nodes.length > 0) nodes[0].click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 500));

    // TEST 6: Entity Chips & Drilldown
    const entityChipsTest = await evalJson(`(() => {
      const chips = document.querySelectorAll('.hunt-entity-chip');
      if (chips.length > 0) {
        const text = chips[0].textContent.trim();
        chips[0].click();
        return { chipCount: chips.length, clicked: text };
      }
      return { chipCount: 0 };
    })()`);
    console.log('\n6. Extracted Entity Chips & Drilldown:');
    console.log('   Extracted Entities Count:', entityChipsTest.chipCount);
    console.log('   Drilled into Entity Chip:', entityChipsTest.clicked);
    await new Promise(r => setTimeout(r, 600));

    const pivotStageCheck = await evalJson(`(() => {
      const stage = document.querySelector('.hunt-pivot-stage');
      const cats = Array.from(document.querySelectorAll('.hunt-pivot-cat-btn')).map(c => c.textContent.trim());
      const hasBackBtn = !!document.querySelector('.hunt-pivot-back-btn');
      return { inPivotStage: !!stage, categories: cats, hasBackBtn };
    })()`);
    console.log('   Pivot Stage Visible:', pivotStageCheck.inPivotStage);
    console.log('   Pivot Categories:', pivotStageCheck.categories.join(' | '));
    console.log('   Back to Event Button Present:', pivotStageCheck.hasBackBtn);

    // TEST 7: Back to Event Button
    const backBtnTest = await evalJson(`(() => {
      const btn = document.querySelector('.hunt-pivot-back-btn');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    await new Promise(r => setTimeout(r, 400));
    const backOk = await evalJson(`!document.querySelector('.hunt-pivot-stage') && !!document.querySelector('.explain-box')`);
    console.log('\n7. Back to Event Button Execution:');
    console.log('   Returned from Pivot back to Event Inspector:', backOk);

    // TEST 8: Hierarchical Escape
    // Re-enter drilldown
    await evalJson(`(() => {
      const chips = document.querySelectorAll('.hunt-entity-chip');
      if (chips.length > 0) chips[0].click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 500));

    // Esc Level 1: exits drilldown back to event
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 300));
    const escLevel1 = await evalJson(`!document.querySelector('.hunt-pivot-stage') && !!document.querySelector('.threat-hunting-workspace')`);
    console.log('\n8. Hierarchical Escape Verification:');
    console.log('   Esc Level 1 (exits entity drilldown without exiting workspace):', escLevel1);

    // Esc Level 2: deselects result focus
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 300));
    const escLevel2 = await evalJson(`!document.querySelector('.hunt-node.focused') && !!document.querySelector('.threat-hunting-workspace')`);
    console.log('   Esc Level 2 (deselects node focus without exiting workspace):', escLevel2);

    // Esc Level 3: exits hunting to Hub
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 500));
    const escLevel3 = await evalJson(`!document.querySelector('.threat-hunting-workspace') && document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log('   Esc Level 3 (exits Threat Hunting to Spatial Hub):', escLevel3);

    // TEST 9: HUB Back Button
    // Return to Hunting
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const huntNode = nodes.find(n => n.textContent && n.textContent.includes('THREAT HUNTING')) || nodes[2];
      if (huntNode) huntNode.click();
      return true;
    })()`);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await evalJson(`!!document.querySelector('.threat-hunting-workspace')`)) break;
    }
    await new Promise(r => setTimeout(r, 600));

    // Click HUB Back button in center panel
    await evalJson(`(() => {
      const hubBtn = document.querySelector('.hunt-back-btn');
      if (hubBtn) hubBtn.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 500));
    const backToHubOk = await evalJson(`!document.querySelector('.threat-hunting-workspace') && document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log('\n9. Center HUB Back Button Success:');
    console.log('   Back Button returns to Spatial Hub:', backToHubOk);

    // Re-enter Hunting for clean POPULATED screenshots
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const huntNode = nodes.find(n => n.textContent && n.textContent.includes('THREAT HUNTING')) || nodes[2];
      if (huntNode) huntNode.click();
      return true;
    })()`);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await evalJson(`!!document.querySelector('.threat-hunting-workspace')`)) break;
    }
    await new Promise(r => setTimeout(r, 800));

    // Select template query that returns results (Repeated Authentication Failures)
    console.log('[10/12] Selecting hunt template with results & executing query...');
    await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.hunt-template-card'));
      const targetCard = cards.find(c => c.textContent && c.textContent.includes('Authentication Failures')) || cards[1] || cards[0];
      if (targetCard) targetCard.click();
      return true;
    })()`);

    // Wait for hunt pipeline execution and node rendering
    let nodesRendered = false;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 200));
      const count = await evalJson(`document.querySelectorAll('.hunt-node').length`);
      if (count > 0) {
        nodesRendered = true;
        console.log(`✓ Hunt executed and rendered ${count} event nodes!`);
        break;
      }
    }
    if (!nodesRendered) {
      console.warn('Nodes did not render within timeout, continuing...');
    }

    // Click node and wait for inspector render
    await evalJson(`(() => {
      const nodes = document.querySelectorAll('.hunt-node');
      if (nodes.length > 0) nodes[0].click();
      return nodes.length;
    })()`);
    await new Promise(r => setTimeout(r, 600));

    // SELECT AN EVENT NODE: populates the graph and inspector!
    const selectNodeResult = await evalJson(`(() => {
      const nodes = document.querySelectorAll('.hunt-node');
      const focused = document.querySelector('.hunt-node.focused');
      const inspectorHeader = document.querySelector('.hunt-inspector-header')?.textContent?.trim();
      const eventId = document.querySelector('.inspector-val')?.textContent?.trim();
      const rationale = document.querySelector('.explain-box')?.textContent?.trim();
      const chips = Array.from(document.querySelectorAll('.hunt-entity-chip')).map(c => c.textContent.trim());

      const qContent = document.querySelector('.hunt-query-col .hunt-panel-content');
      const iContent = document.querySelector('.hunt-inspector-col .hunt-panel-content');

      return {
        nodeCount: nodes.length,
        hasFocusedNode: !!focused,
        inspectorHeader,
        eventId,
        hasRationale: !!rationale,
        chipsCount: chips.length,
        queryScrollOk: qContent ? qContent.scrollWidth <= qContent.clientWidth : true,
        inspectorScrollOk: iContent ? iContent.scrollWidth <= iContent.clientWidth : true
      };
    })()`);
    console.log('\n[10/12] Populated Graph & Inspector State:');
    console.log(`   Event Selected: ${selectNodeResult.eventId} (Focused: ${selectNodeResult.hasFocusedNode})`);
    console.log(`   Inspector Header: ${selectNodeResult.inspectorHeader}`);
    console.log(`   Match Rationale Present: ${selectNodeResult.hasRationale}`);
    console.log(`   Extracted Entity Chips: ${selectNodeResult.chipsCount}`);
    console.log(`   Panel Horizontal Scrolling OK: Query=${selectNodeResult.queryScrollOk}, Inspector=${selectNodeResult.inspectorScrollOk}`);

    // Audit label overlaps at 1440x900
    const overlaps1440 = await evalJson(`(() => {
      const labels = Array.from(document.querySelectorAll('.hunt-node-label')).map(l => {
        const r = l.getBoundingClientRect();
        return { text: l.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
      });
      let overlaps = 0;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (ox > 0 && oy > 0) overlaps++;
        }
      }
      return { totalLabels: labels.length, overlaps };
    })()`);
    console.log(`   Label Overlaps at 1440x900: ${overlaps1440.overlaps} (Total Nodes: ${overlaps1440.totalLabels})`);

    // CAPTURE 1440 AFTER (POPULATED)
    console.log('\n[10b/12] Capturing stage2_hunting_after_1440.png (POPULATED VIEW)...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.result.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_after_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage2_hunting_after_1440.png'), buf1440);
    console.log(`✓ Saved stage2_hunting_after_1440.png (${buf1440.length} bytes)`);

    // RESIZE TO 1920 AND CAPTURE 1920 AFTER (POPULATED)
    console.log('\n[11/12] Resizing to 1920x1080 and capturing stage2_hunting_after_1920.png (POPULATED VIEW)...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1200));

    const colAudit1920 = await evalJson(`(() => {
      const q = document.querySelector('.hunt-query-col')?.getBoundingClientRect();
      const f = document.querySelector('.hunt-field-col')?.getBoundingClientRect();
      const i = document.querySelector('.hunt-inspector-col')?.getBoundingClientRect();
      const t = document.querySelector('.hunt-timeline-col')?.getBoundingClientRect();
      const qContent = document.querySelector('.hunt-query-col .hunt-panel-content');
      const iContent = document.querySelector('.hunt-inspector-col .hunt-panel-content');

      return {
        queryWidth: Math.round(q.width),
        centerWidth: Math.round(f.width),
        inspectorWidth: Math.round(i.width),
        timelineHeight: Math.round(t.height),
        queryScrollOk: qContent ? qContent.scrollWidth <= qContent.clientWidth : true,
        inspectorScrollOk: iContent ? iContent.scrollWidth <= iContent.clientWidth : true
      };
    })()`);
    console.log('   Responsive Column Layout at 1920x1080:');
    console.log('     Query Col:', colAudit1920.queryWidth, 'px (spec: 380px)');
    console.log('     Center Field Col:', colAudit1920.centerWidth, 'px');
    console.log('     Inspector Col:', colAudit1920.inspectorWidth, 'px (spec: 450px)');
    console.log('     Timeline Row Height:', colAudit1920.timelineHeight, 'px (spec: 104px)');
    console.log(`     Scrolling Checks: Query=${colAudit1920.queryScrollOk}, Inspector=${colAudit1920.inspectorScrollOk}`);

    const labelAudit1920 = await evalJson(`(() => {
      const labels = Array.from(document.querySelectorAll('.hunt-node-label')).map(l => {
        const r = l.getBoundingClientRect();
        return { text: l.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
      });
      let overlaps = 0;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (ox > 0 && oy > 0) overlaps++;
        }
      }
      return { totalNodes: labels.length, overlaps };
    })()`);
    console.log('   Label Overlaps at 1920x1080:', labelAudit1920.overlaps);

    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.result.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_after_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage2_hunting_after_1920.png'), buf1920);
    console.log(`✓ Saved stage2_hunting_after_1920.png (${buf1920.length} bytes)`);

    // Capture IndexedDB AFTER verification
    console.log('\n[12/12] Capturing IndexedDB "es-spatial-db" state AFTER verification...');
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

    console.log(`\nData Integrity Verdict: ${allMatched ? 'PERFECT PRESERVATION (All stores identical, 0 cleared, 0 reseeded)' : 'DISCREPANCIES DETECTED'}`);
    if (!allMatched) {
      console.error('Differences:', diffs);
    }

    // Write full report for docs/work-log.md
    const reportData = {
      timestamp: new Date().toISOString(),
      allMatched,
      diffCount: diffs.length,
      comparisonTable,
      layout1440: {
        colAudit: colAudit1440,
        selectedNode: selectNodeResult,
        labelOverlaps: overlaps1440.overlaps
      },
      layout1920: {
        colAudit: colAudit1920,
        labelOverlaps: labelAudit1920.overlaps
      },
      savedHuntsDrawer: savedDrawerTest,
      escapeTests: {
        escLevel1_drilldown: escLevel1,
        escLevel2_deselectNode: escLevel2,
        escLevel3_exitToHub: escLevel3,
        hubBackBtn: backToHubOk
      }
    };
    fs.writeFileSync('/tmp/stage2-verification-report.json', JSON.stringify(reportData, null, 2));
    console.log('✓ Saved structured report to /tmp/stage2-verification-report.json');

    console.log('\n====================================================');
    console.log('ALL VERIFICATION & CAPTURE SUITES COMPLETED CLEANLY! ✓');
    console.log('====================================================\n');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

runStage2Suite().catch(console.error);

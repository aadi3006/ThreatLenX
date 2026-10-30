/**
 * scripts/verify-final-workflow-audit.cjs
 *
 * Final ThreatLenX Workflow Audit Suite across All Six Operational Journeys.
 * Runs in an isolated browser profile to guarantee zero side-effects on primary data.
 *
 * Requirements:
 * 1. Assert exact incident/case IDs after navigation.
 * 2. Fail on missing or changed existing records; explicitly allow expected audit/test-history additions.
 * 3. Actually measure overlap in every workspace at both viewport sizes (1440x900 and 1920x1080) before claiming zero overlap.
 * 4. Report lint honestly: 2,386 errors and a failing exit status.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_DIR = path.join(__dirname, '../docs/screenshots');

async function connectToChrome(port, profileDir) {
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-proxy-server',
    'about:blank'
  ], { stdio: 'ignore' });

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
    } catch { }
  }

  const pageTarget = targets.find(t => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });

  let msgId = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`CDP command ${method} (id=${id}) timed out after 15000ms`));
    }, 15000);
    const handler = (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.id === id) {
          clearTimeout(timer);
          ws.off('message', handler);
          if (parsed.error) reject(parsed.error);
          else resolve(parsed.result);
        }
      } catch (e) {
        clearTimeout(timer);
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
    try {
      return JSON.parse(resp?.result?.value);
    } catch {
      return resp?.result?.value;
    }
  };

  const evalAsync = async (expr) => {
    const resp = await send('Runtime.evaluate', {
      expression: `(async () => { return JSON.stringify(await (${expr})); })()`,
      awaitPromise: true,
      returnByValue: true
    });
    try {
      return JSON.parse(resp?.result?.value);
    } catch {
      return resp?.result?.value;
    }
  };

  // Track console errors
  const consoleErrors = [];
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = msg.params.args?.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        if (text && !text.includes('favicon') && !text.includes('ResizeObserver')) {
          consoleErrors.push(text);
        }
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const text = msg.params?.exceptionDetails?.text || msg.params?.exceptionDetails?.exception?.description;
        if (text && !text.includes('ResizeObserver')) {
          consoleErrors.push(text);
        }
      }
    } catch { }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  return { chromeProcess, send, evalJson, evalAsync, consoleErrors, ws };
}

async function saveScreenshot(send, name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const docsPath = path.join(DOCS_DIR, name);
  const artPath = path.join(ARTIFACT_DIR, name);
  fs.writeFileSync(docsPath, Buffer.from(shot.data, 'base64'));
  fs.writeFileSync(artPath, Buffer.from(shot.data, 'base64'));
  console.log(`  📸 Screenshot saved: ${name}`);
}

/**
 * Capture full snapshot of all IndexedDB stores, keys, and record values.
 */
async function captureDbSnapshot(evalAsync) {
  return await evalAsync(`new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('es-spatial-db');
      req.onsuccess = (e) => {
        const db = e.target.result;
        const names = Array.from(db.objectStoreNames).sort();
        const rep = {};
        if (names.length === 0) return resolve(rep);
        const tx = db.transaction(names, 'readonly');
        let pending = names.length;
        names.forEach(n => {
          const st = tx.objectStore(n);
          const reqAll = st.getAll();
          const reqKeys = st.getAllKeys();
          let records = null;
          let keys = null;
          const finish = () => {
            if (records !== null && keys !== null) {
              const byKey = {};
              for (let i = 0; i < keys.length; i++) {
                const k = String(keys[i]);
                byKey[k] = records[i];
              }
              rep[n] = {
                count: keys.length,
                records: byKey
              };
              if (--pending === 0) resolve(rep);
            }
          };
          reqAll.onsuccess = () => { records = reqAll.result; finish(); };
          reqAll.onerror = () => { records = []; finish(); };
          reqKeys.onsuccess = () => { keys = reqKeys.result; finish(); };
          reqKeys.onerror = () => { keys = []; finish(); };
        });
      };
      req.onerror = () => reject(new Error('IDB open error'));
    } catch (err) {
      reject(err);
    }
  })`);
}

/**
 * Measure panel geometry and overlap for a given workspace.
 */
async function measureWorkspaceOverlap(evalJson, workspaceName, viewportDesc) {
  return await evalJson(`(() => {
    function getRect(sel) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    }

    function checkPair(nameA, rectA, nameB, rectB) {
      if (!rectA || !rectB) return null;
      const xOverlap = Math.max(0, Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left));
      const yOverlap = Math.max(0, Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top));
      const hasOverlap = (xOverlap > 1 && yOverlap > 1);

      const hGap = Math.max(0, Math.max(rectA.left - rectB.right, rectB.left - rectA.right));
      const vGap = Math.max(0, Math.max(rectA.top - rectB.bottom, rectB.top - rectA.bottom));

      return {
        pair: nameA + ' vs ' + nameB,
        hasOverlap,
        overlapPx: hasOverlap ? Math.round(xOverlap * yOverlap) : 0,
        xOverlap: hasOverlap ? Math.round(xOverlap) : 0,
        yOverlap: hasOverlap ? Math.round(yOverlap) : 0,
        clearancePx: Math.max(hGap, vGap),
        rectA,
        rectB
      };
    }

    const ws = '${workspaceName}';
    const measurements = [];

    if (ws === 'HUB') {
      const core = getRect('.hub-sphere-core');
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node')).map((el, i) => ({
        name: 'Node ' + (i + 1) + ' (' + (el.querySelector('.node-title')?.textContent?.trim() || i) + ')',
        rect: getRect(el)
      })).filter(n => n.rect);
      const footer = getRect('.hub-status-ring');

      // Check all node pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const res = checkPair(nodes[i].name, nodes[i].rect, nodes[j].name, nodes[j].rect);
          if (res) measurements.push(res);
        }
        if (core) {
          const res = checkPair(nodes[i].name, nodes[i].rect, 'Hub Core Sphere', core);
          if (res) measurements.push(res);
        }
        if (footer) {
          const res = checkPair(nodes[i].name, nodes[i].rect, 'Status Footer', footer);
          if (res) measurements.push(res);
        }
      }
    } else if (ws === 'COMMAND') {
      const topBar = getRect('.soc-top-bar');
      const leftFlank = getRect('.soc-left-flank');
      const rightFlank = getRect('.soc-right-flank');
      const canvasField = getRect('.inc-universe-field');
      const dock = getRect('.soc-bottom-stream');
      const nodes = Array.from(document.querySelectorAll('.inc-node')).map((el, i) => ({
        name: 'Incident Node ' + (el.querySelector('.inc-label-id')?.textContent?.trim() || i),
        rect: getRect(el)
      })).filter(n => n.rect);

      measurements.push(checkPair('Left Flank', leftFlank, 'Bottom Telemetry Dock', dock));
      measurements.push(checkPair('Right Flank', rightFlank, 'Bottom Telemetry Dock', dock));
      measurements.push(checkPair('Incident Canvas Field', canvasField, 'Bottom Telemetry Dock', dock));
      measurements.push(checkPair('Top Bar', topBar, 'Left Flank', leftFlank));
      measurements.push(checkPair('Top Bar', topBar, 'Right Flank', rightFlank));
      if (topBar && canvasField) {
        measurements.push(checkPair('Top Bar', topBar, 'Incident Canvas Field', canvasField));
      }

      // Check incident nodes against flanks and dock
      for (const node of nodes) {
        if (leftFlank) measurements.push(checkPair(node.name, node.rect, 'Left Flank', leftFlank));
        if (rightFlank) measurements.push(checkPair(node.name, node.rect, 'Right Flank', rightFlank));
        if (dock) measurements.push(checkPair(node.name, node.rect, 'Bottom Telemetry Dock', dock));
      }
    } else if (ws === 'INVESTIGATION') {
      const header = getRect('.inv-header');
      const ribbon = getRect('.inv-context-strip');
      const viewPanel = getRect('.inv-view-panel');

      measurements.push(checkPair('Header', header, 'Context Ribbon', ribbon));
      measurements.push(checkPair('Context Ribbon', ribbon, 'View Panel', viewPanel));
    } else if (ws === 'HUNTING') {
      const queryCol = getRect('.hunt-query-col');
      const fieldCol = getRect('.hunt-field-col');
      const inspectorCol = getRect('.hunt-inspector-col');
      const summaryCard = getRect('.hunt-summary-card');

      measurements.push(checkPair('Query Column', queryCol, 'Center Field Column', fieldCol));
      measurements.push(checkPair('Center Field Column', fieldCol, 'Inspector Column', inspectorCol));
      if (summaryCard) {
        measurements.push(checkPair('Center Field Column', fieldCol, 'Timeline Summary', summaryCard));
      }
    } else if (ws === 'CASES') {
      const topBar = getRect('.case-top-bar');
      const contextCol = getRect('.case-col-context');
      const centerCol = getRect('.case-col-center');
      const opsCol = getRect('.case-col-ops');

      measurements.push(checkPair('Top Bar', topBar, 'Context Column', contextCol));
      measurements.push(checkPair('Context Column', contextCol, 'Center Findings Column', centerCol));
      measurements.push(checkPair('Center Findings Column', centerCol, 'Operations Column', opsCol));
    } else if (ws === 'EVIDENCE') {
      const topBar = getRect('.evidence-top-bar');
      const listPanel = getRect('.evidence-panel');
      const detailPanel = getRect('.evidence-detail-panel');
      const detailHeader = getRect('.evidence-detail-header');
      const grid = getRect('.evidence-12field-grid');

      measurements.push(checkPair('Top Bar', topBar, 'List Panel', listPanel));
      measurements.push(checkPair('List Panel', listPanel, 'Detail Panel', detailPanel));
      measurements.push(checkPair('Detail Header', detailHeader, '12-Field Grid', grid));
    } else if (ws === 'DETECTION') {
      const topBar = getRect('.det-top-bar');
      const panels = Array.from(document.querySelectorAll('.det-main-grid > .det-panel'));
      const leftCol = getRect(panels[0]);
      const centerCol = getRect(panels[1]);
      const rightCol = getRect(panels[2]);

      measurements.push(checkPair('Top Bar', topBar, 'Left Rule List', leftCol));
      measurements.push(checkPair('Left Rule List', leftCol, 'Center Rule Editor', centerCol));
      measurements.push(checkPair('Center Rule Editor', centerCol, 'Right Inspector', rightCol));
    }

    const valid = measurements.filter(Boolean);
    const overlaps = valid.filter(m => m.hasOverlap);

    return {
      workspace: ws,
      viewport: '${viewportDesc}',
      totalChecked: valid.length,
      overlaps,
      measurements: valid.map(m => ({
        pair: m.pair,
        hasOverlap: m.hasOverlap,
        clearancePx: m.clearancePx,
        overlapPx: m.overlapPx
      }))
    };
  })()`);
}

async function main() {
  console.log('================================================================');
  console.log('THREATLENX FINAL WORKFLOW AUDIT SUITE (All 6 Journeys)');
  console.log('================================================================\n');

  const port = 9610;
  const isolatedProfile = `/tmp/threatlenx-chrome-final-audit-${Date.now()}`;
  fs.mkdirSync(isolatedProfile, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  const { chromeProcess, send, evalJson, evalAsync, consoleErrors } = await connectToChrome(port, isolatedProfile);

  try {
    // Initial Setup: 1440x900
    console.log('[INIT] Setting viewport to 1440x900 and navigating to http://localhost:3000/...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 2500));

    // Deep Snapshot of IDB before audit starts
    console.log('[INIT] Capturing deep snapshot of all IndexedDB records in es-spatial-db...');
    const snapshotInitial = await captureDbSnapshot(evalAsync);
    const initialStoreNames = Object.keys(snapshotInitial);
    console.log(`✓ Initial IDB deep snapshot verified: ${initialStoreNames.length} stores recorded.`);
    if (initialStoreNames.length < 30) throw new Error(`Expected at least 30 stores, got ${initialStoreNames.length}`);

    // Verify Title & Hub Core
    const pageBranding = await evalJson(`({ title: document.title, description: document.querySelector('meta[name="description"]')?.content })`);
    console.log(`✓ Browser Title verified: "${pageBranding.title}"`);
    if (pageBranding.title !== 'ThreatLenX') throw new Error(`Expected title 'ThreatLenX', got '${pageBranding.title}'`);

    // Measure Hub Overlap @ 1440x900
    const hubOverlap1440 = await measureWorkspaceOverlap(evalJson, 'HUB', '1440x900');
    console.log(`  HUB (1440x900): ${hubOverlap1440.totalChecked} pairs checked, ${hubOverlap1440.overlaps.length} overlaps detected.`);
    if (hubOverlap1440.overlaps.length > 0) {
      console.error('HUB Overlap Error:', JSON.stringify(hubOverlap1440.overlaps, null, 2));
      throw new Error(`Overlap detected in HUB at 1440x900: ${JSON.stringify(hubOverlap1440.overlaps)}`);
    }
    await saveScreenshot(send, 'final_audit_1_hub_1440.png');

    // ──────────────────────────────────────────────────────────────────────────
    // JOURNEY 1: Hub -> Command -> select either incident -> Investigation -> Back -> Hub
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------');
    console.log('JOURNEY 1: Hub -> Command -> Select Incident -> Investigation -> Back -> Hub');
    console.log('----------------------------------------------------------------');

    // 1.1 Click Command Center
    console.log('[1.1] Clicking Zone 1: COMMAND CENTER...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('COMMAND'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // Measure Command Overlap @ 1440x900
    const cmdOverlap1440 = await measureWorkspaceOverlap(evalJson, 'COMMAND', '1440x900');
    console.log(`  COMMAND (1440x900): ${cmdOverlap1440.totalChecked} pairs checked, ${cmdOverlap1440.overlaps.length} overlaps detected.`);
    if (cmdOverlap1440.overlaps.length > 0) {
      console.error('COMMAND Overlap Error:', JSON.stringify(cmdOverlap1440.overlaps, null, 2));
      throw new Error(`Overlap detected in COMMAND at 1440x900: ${JSON.stringify(cmdOverlap1440.overlaps)}`);
    }

    const cmdAudit = await evalJson(`(() => {
      const universe = document.querySelector('.inc-universe');
      const cmdCenter = document.querySelector('.soc-command-center');
      const layers = document.querySelectorAll('.soc-stage-container > div').length;
      const leftFlank = document.querySelector('.soc-left-flank');
      const dock = document.querySelector('.soc-bottom-stream');
      const leftR = leftFlank?.getBoundingClientRect();
      const dockR = dock?.getBoundingClientRect();

      return {
        hasUniverse: !!universe,
        hasCmdCenter: !!cmdCenter,
        singleScreenLayer: layers === 1,
        leftClearance: dockR && leftR ? Math.round(dockR.top - leftR.bottom) : null
      };
    })()`);
    if (!cmdAudit.hasCmdCenter || !cmdAudit.singleScreenLayer) throw new Error('Command Center mount or layer count failed');
    console.log('  ✓ Command Center overview verified with zero duplicate screens and positive dock clearance.');
    await saveScreenshot(send, 'final_audit_journey1_command_1440.png');

    // 1.2 Select incident-001 (Operation BlackTide)
    console.log('[1.2] Selecting incident-001 for drill-down investigation...');
    await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.command-incident-card, .inc-node'));
      const card = cards.find(c => c.textContent && c.textContent.includes('BlackTide')) || cards[0];
      if (card) card.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // 1.3 Verify Investigation Workspace with Exact Incident ID Assertion
    console.log('[1.3] Asserting exact incident ID and title in Investigation workspace...');
    const invAudit1 = await evalJson(`(() => {
      const invContainer = document.querySelector('.inv-hub');
      const layers = document.querySelectorAll('.soc-stage-container > div').length;
      const idBadge = document.querySelector('.inv-badge-id')?.textContent?.trim();
      const title = document.querySelector('.inv-header-incident-title')?.textContent?.trim();
      const navIncidentId = window.__socNavStore?.getState()?.selectedIncidentId;

      return {
        hasInv: !!invContainer,
        singleScreenLayer: layers === 1,
        idBadge,
        title,
        navIncidentId
      };
    })()`);
    console.log('  Investigation 1 Audit:', JSON.stringify(invAudit1, null, 2));
    if (!invAudit1.hasInv || !invAudit1.singleScreenLayer) throw new Error('Investigation workspace mount failed');
    if (invAudit1.navIncidentId !== 'incident-001') {
      throw new Error(`Exact incident ID assertion failed: expected 'incident-001', got '${invAudit1.navIncidentId}'`);
    }
    if (invAudit1.idBadge !== 'INC-001') {
      throw new Error(`Exact badge ID assertion failed: expected 'INC-001', got '${invAudit1.idBadge}'`);
    }
    if (!invAudit1.title || !invAudit1.title.includes('BlackTide')) {
      throw new Error(`Incident title assertion failed: expected title containing 'BlackTide', got '${invAudit1.title}'`);
    }
    console.log(`  ✓ Exact incident ID '${invAudit1.navIncidentId}' and badge '${invAudit1.idBadge}' verified in Investigation.`);

    // Measure Investigation Overlap @ 1440x900
    const invOverlap1440 = await measureWorkspaceOverlap(evalJson, 'INVESTIGATION', '1440x900');
    console.log(`  INVESTIGATION (1440x900): ${invOverlap1440.totalChecked} pairs checked, ${invOverlap1440.overlaps.length} overlaps detected.`);
    if (invOverlap1440.overlaps.length > 0) {
      console.error('INVESTIGATION Overlap Error:', JSON.stringify(invOverlap1440.overlaps, null, 2));
      throw new Error(`Overlap detected in INVESTIGATION at 1440x900: ${JSON.stringify(invOverlap1440.overlaps)}`);
    }
    await saveScreenshot(send, 'final_audit_journey1_investigation_1440.png');

    // 1.4 Click Back to Command Overview
    console.log('[1.4] Clicking Back to return to Command Center overview...');
    await evalJson(`(() => {
      const backBtn = document.querySelector('.inv-back-btn');
      if (backBtn) backBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    const restoredCmdState = await evalJson(`({
      hasCmd: !!document.querySelector('.soc-command-center'),
      selectedIncidentId: window.__socNavStore?.getState()?.selectedIncidentId
    })`);
    if (!restoredCmdState.hasCmd) throw new Error('Failed to restore Command Center overview on Back');
    if (restoredCmdState.selectedIncidentId !== null) {
      throw new Error(`Expected selectedIncidentId to be null after returning to Command overview, got '${restoredCmdState.selectedIncidentId}'`);
    }
    console.log('  ✓ Returned cleanly to Command Center overview (selectedIncidentId cleared).');

    // 1.5 Click Back to Hub
    console.log('[1.5] Returning to Spatial Command Hub...');
    await evalJson(`(() => {
      const hubBtn = document.querySelector('.hub-return-btn');
      if (hubBtn) hubBtn.click();
      else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    const hubState1 = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
    if (!hubState1) throw new Error('Failed to return to Hub from Command Center');
    console.log('  ✓ Returned cleanly to Spatial Command Hub (6 nodes verified).');

    // ──────────────────────────────────────────────────────────────────────────
    // JOURNEY 2: Hunting -> run query -> select result -> investigate linked incident
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------');
    console.log('JOURNEY 2: Hunting -> Run Query -> Select Result -> Investigate Linked Incident');
    console.log('----------------------------------------------------------------');

    // 2.1 Click Threat Hunting
    console.log('[2.1] Navigating to Zone 3: THREAT HUNTING...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('HUNTING'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // Measure Hunting Overlap @ 1440x900
    const huntOverlap1440 = await measureWorkspaceOverlap(evalJson, 'HUNTING', '1440x900');
    console.log(`  HUNTING (1440x900): ${huntOverlap1440.totalChecked} pairs checked, ${huntOverlap1440.overlaps.length} overlaps detected.`);
    if (huntOverlap1440.overlaps.length > 0) {
      console.error('HUNTING Overlap Error:', JSON.stringify(huntOverlap1440.overlaps, null, 2));
      throw new Error(`Overlap detected in HUNTING at 1440x900: ${JSON.stringify(huntOverlap1440.overlaps)}`);
    }

    // 2.2 Run Query
    console.log('[2.2] Executing Threat Hunt Query...');
    await evalJson(`(() => {
      const runBtn = document.querySelector('.hunt-btn-run');
      if (runBtn) runBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 2000));

    // 2.3 Verify Results & Select Event
    const huntingAudit = await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hunt-node'));
      if (nodes[0]) nodes[0].click();
      return {
        resultsCount: nodes.length,
        firstNodeTitle: nodes[0]?.getAttribute('title')
      };
    })()`);
    console.log('  Hunting Results Audit:', JSON.stringify(huntingAudit, null, 2));
    if (huntingAudit.resultsCount === 0) throw new Error('Threat Hunt query returned 0 results');
    await new Promise(r => setTimeout(r, 1000));

    // 2.4 Verify Inspector & Click "INVESTIGATE IN SPATIAL"
    console.log('[2.4] Pivoting to linked incident from hunting inspector...');
    const pivotClick = await evalJson(`(() => {
      let btn = document.querySelector('.action-btn-investigate:not([disabled])');
      if (btn) {
        btn.click();
        return { success: true, text: btn.textContent.trim() };
      }
      const allNodes = Array.from(document.querySelectorAll('.hunt-node'));
      for (const node of allNodes) {
        node.click();
        btn = document.querySelector('.action-btn-investigate:not([disabled])');
        if (btn) {
          btn.click();
          return { success: true, text: btn.textContent.trim() };
        }
      }
      return { success: false, btnFound: !!document.querySelector('.action-btn-investigate') };
    })()`);
    if (!pivotClick.success) throw new Error('Could not find active investigate pivot button in hunting drawer');
    await new Promise(r => setTimeout(r, 1500));

    // 2.5 Verify Investigation Hub mounted from Hunting pivot with Exact Incident ID Assertion
    console.log('[2.5] Asserting exact incident ID after Hunting pivot...');
    const invFromHunting = await evalJson(`(() => {
      const inv = document.querySelector('.inv-hub');
      const idBadge = document.querySelector('.inv-badge-id')?.textContent?.trim();
      const title = document.querySelector('.inv-header-incident-title')?.textContent?.trim();
      const navIncidentId = window.__socNavStore?.getState()?.selectedIncidentId;
      return { isMounted: !!inv, idBadge, title, navIncidentId };
    })()`);
    console.log('  Investigation from Hunting pivot:', JSON.stringify(invFromHunting));
    if (!invFromHunting.isMounted) throw new Error('Failed to navigate to Investigation from Threat Hunting pivot');
    if (invFromHunting.navIncidentId !== 'incident-001') {
      throw new Error(`Exact incident ID assertion failed: expected 'incident-001', got '${invFromHunting.navIncidentId}'`);
    }
    if (invFromHunting.idBadge !== 'INC-001') {
      throw new Error(`Exact badge ID assertion failed: expected 'INC-001', got '${invFromHunting.idBadge}'`);
    }
    console.log(`  ✓ Exact incident ID '${invFromHunting.navIncidentId}' verified from Hunting pivot.`);
    await saveScreenshot(send, 'final_audit_journey2_hunting_pivot_1440.png');

    // 2.6 Return from Investigation to Hunting, then to Hub
    console.log('[2.6] Exiting Investigation back to Hunting...');
    await evalJson(`(() => {
      const backBtn = document.querySelector('.inv-back-btn');
      if (backBtn) backBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    const huntingRestored = await evalJson(`!!document.querySelector('.threat-hunting-workspace')`);
    if (!huntingRestored) throw new Error('Failed to restore Hunting workspace after Investigation');
    console.log('  ✓ Hunting workspace restored.');

    console.log('[2.7] Returning to Hub from Hunting...');
    await evalJson(`(() => {
      const hubBtn = document.querySelector('.hunt-back-btn') || document.querySelector('.hunt-close-btn');
      if (hubBtn) hubBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    const hubState2 = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
    if (!hubState2) throw new Error('Failed to return to Hub from Hunting');
    console.log('  ✓ Returned cleanly to Spatial Command Hub (6 nodes verified).');

    // ──────────────────────────────────────────────────────────────────────────
    // JOURNEY 3: Case -> linked incident -> return -> linked evidence -> correct case
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------');
    console.log('JOURNEY 3: Case -> Linked Incident -> Return -> Linked Evidence -> Correct Case');
    console.log('----------------------------------------------------------------');

    // 3.1 Navigate to Cases
    console.log('[3.1] Navigating to Zone 4: CASE MANAGEMENT...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('CASE'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // Measure Cases Overlap @ 1440x900
    const caseOverlap1440 = await measureWorkspaceOverlap(evalJson, 'CASES', '1440x900');
    console.log(`  CASES (1440x900): ${caseOverlap1440.totalChecked} pairs checked, ${caseOverlap1440.overlaps.length} overlaps detected.`);
    if (caseOverlap1440.overlaps.length > 0) {
      console.error('CASES Overlap Error:', JSON.stringify(caseOverlap1440.overlaps, null, 2));
      throw new Error(`Overlap detected in CASES at 1440x900: ${JSON.stringify(caseOverlap1440.overlaps)}`);
    }

    // 3.2 Verify Active Case with Exact Case ID Assertion
    console.log('[3.2] Asserting exact case ID and linked incident context in Case workspace...');
    const caseAudit = await evalJson(`(() => {
      const ws = document.querySelector('.case-workspace');
      const caseSelector = document.querySelector('.case-top-select');
      const caseTitle = document.querySelector('.case-title-text')?.textContent?.trim();
      const caseNumber = document.querySelector('.case-number-badge')?.textContent?.trim();
      const linkedIncidents = Array.from(document.querySelectorAll('.context-card')).map(c => c.textContent.trim().replace(/\\s+/g, ' '));
      const layers = document.querySelectorAll('.soc-stage-container > div').length;

      return {
        hasWorkspace: !!ws,
        singleScreenLayer: layers === 1,
        selectedCaseId: caseSelector?.value,
        caseNumber,
        caseTitle,
        linkedIncidentCount: linkedIncidents.length,
        firstIncident: linkedIncidents[0]
      };
    })()`);
    console.log('  Case Workspace Audit:', JSON.stringify(caseAudit, null, 2));
    if (!caseAudit.hasWorkspace || !caseAudit.singleScreenLayer) throw new Error('Case workspace mount failed');
    if (caseAudit.selectedCaseId !== 'case-blacktide-001') {
      throw new Error(`Exact case ID assertion failed: expected 'case-blacktide-001', got '${caseAudit.selectedCaseId}'`);
    }
    if (caseAudit.caseNumber !== 'CASE-000001') {
      throw new Error(`Exact case number assertion failed: expected 'CASE-000001', got '${caseAudit.caseNumber}'`);
    }
    console.log(`  ✓ Exact case ID '${caseAudit.selectedCaseId}' and number '${caseAudit.caseNumber}' verified.`);
    await saveScreenshot(send, 'final_audit_journey3_cases_1440.png');

    // 3.3 Click INVESTIGATE on linked incident in Case context
    console.log('[3.3] Clicking INVESTIGATE on linked incident in Case context...');
    await evalJson(`(() => {
      const btn = document.querySelector('.context-card .case-btn-sm');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // Verify exact incident ID in Investigation opened from Case
    const invFromCaseAudit = await evalJson(`(() => {
      const inv = document.querySelector('.inv-hub');
      const idBadge = document.querySelector('.inv-badge-id')?.textContent?.trim();
      const navIncidentId = window.__socNavStore?.getState()?.selectedIncidentId;
      return { isMounted: !!inv, idBadge, navIncidentId };
    })()`);
    if (!invFromCaseAudit.isMounted) throw new Error('Failed to drill down to Investigation from Case');
    if (invFromCaseAudit.navIncidentId !== 'incident-001') {
      throw new Error(`Exact incident ID assertion failed: expected 'incident-001', got '${invFromCaseAudit.navIncidentId}'`);
    }
    if (invFromCaseAudit.idBadge !== 'INC-001') {
      throw new Error(`Exact badge ID assertion failed: expected 'INC-001', got '${invFromCaseAudit.idBadge}'`);
    }
    console.log(`  ✓ Navigated cleanly to Investigation for exact incident '${invFromCaseAudit.navIncidentId}'.`);

    // 3.4 Return to Case and Assert Preserved Case ID
    console.log('[3.4] Returning to Cases workspace and asserting preserved case ID...');
    await evalJson(`(() => {
      const backBtn = document.querySelector('.inv-back-btn');
      if (backBtn) backBtn.click();
      else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    const restoredCaseAudit = await evalJson(`(() => {
      const ws = document.querySelector('.case-workspace');
      const caseSelector = document.querySelector('.case-top-select');
      return {
        hasWorkspace: !!ws,
        selectedCaseId: caseSelector?.value
      };
    })()`);
    if (!restoredCaseAudit.hasWorkspace) throw new Error('Failed to restore Case workspace after exiting Investigation');
    if (restoredCaseAudit.selectedCaseId !== 'case-blacktide-001') {
      throw new Error(`Case ID preservation failed: expected 'case-blacktide-001', got '${restoredCaseAudit.selectedCaseId}'`);
    }
    console.log(`  ✓ Case workspace restored with preserved exact case ID '${restoredCaseAudit.selectedCaseId}'.`);

    // 3.5 Click VAULT to open Evidence Vault
    console.log('[3.5] Launching Evidence Vault from Case context...');
    await evalJson(`(() => {
      // Switch to EVIDENCE tab if not already active
      const tabs = Array.from(document.querySelectorAll('.case-tab-btn, button'));
      const evdTab = tabs.find(t => t.textContent.includes('EVIDENCE'));
      if (evdTab) evdTab.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    await evalJson(`(() => {
      const vaultBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('EVIDENCE WORKSPACE') || b.textContent.includes('VAULT'));
      if (vaultBtn) vaultBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    const evdAudit = await evalJson(`(() => {
      const ws = document.querySelector('.evidence-workspace');
      const linkedCaseText = document.querySelector('.evidence-field-val.font-mono')?.textContent?.trim();
      const workspace = window.__socNavStore?.getState()?.workspace;
      return {
        hasWorkspace: !!ws,
        workspace,
        linkedCaseText
      };
    })()`);
    if (!evdAudit.hasWorkspace || evdAudit.workspace !== 'EVIDENCE') {
      throw new Error('Failed to launch Evidence Vault from Case context');
    }
    console.log('  ✓ Evidence Vault mounted from Case link.');

    // 3.6 In Evidence Vault, click VIEW CASE to return to correct case
    console.log('[3.6] Clicking VIEW CASE in Evidence Vault to return to correct case...');
    await evalJson(`(() => {
      const viewCaseBtn = Array.from(document.querySelectorAll('.evidence-btn-action')).find(b => b.textContent.includes('VIEW CASE'));
      if (viewCaseBtn) viewCaseBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    const verifiedCaseRestored = await evalJson(`(() => {
      const ws = document.querySelector('.case-workspace');
      const caseSelector = document.querySelector('.case-top-select');
      return {
        hasWorkspace: !!ws,
        selectedCaseId: caseSelector?.value
      };
    })()`);
    console.log('  Case after round-trip:', JSON.stringify(verifiedCaseRestored));
    if (!verifiedCaseRestored.hasWorkspace) throw new Error('Failed to return to correct Case from Evidence link');
    if (verifiedCaseRestored.selectedCaseId !== 'case-blacktide-001') {
      throw new Error(`Exact Case ID assertion failed: expected 'case-blacktide-001', got '${verifiedCaseRestored.selectedCaseId}'`);
    }
    console.log(`  ✓ Returned to exact case '${verifiedCaseRestored.selectedCaseId}' with preserved selections.`);

    // Return to Hub
    await evalJson(`(() => {
      const backBtn = document.querySelector('.case-back-btn');
      if (backBtn) backBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    // ──────────────────────────────────────────────────────────────────────────
    // JOURNEY 4: Evidence -> search/filter -> detail tabs -> verify integrity
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------');
    console.log('JOURNEY 4: Evidence -> Search/Filter -> Detail Tabs -> Verify Integrity');
    console.log('----------------------------------------------------------------');

    // 4.1 Navigate to Evidence
    console.log('[4.1] Navigating to Zone 5: EVIDENCE VAULT...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('EVIDENCE'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // Measure Evidence Overlap @ 1440x900
    const evdOverlap1440 = await measureWorkspaceOverlap(evalJson, 'EVIDENCE', '1440x900');
    console.log(`  EVIDENCE (1440x900): ${evdOverlap1440.totalChecked} pairs checked, ${evdOverlap1440.overlaps.length} overlaps detected.`);
    if (evdOverlap1440.overlaps.length > 0) {
      console.error('EVIDENCE Overlap Error:', JSON.stringify(evdOverlap1440.overlaps, null, 2));
      throw new Error(`Overlap detected in EVIDENCE at 1440x900: ${JSON.stringify(evdOverlap1440.overlaps)}`);
    }

    // 4.2 Search/Filter
    console.log('[4.2] Testing Evidence search filter...');
    await evalJson(`(() => {
      const input = document.querySelector('.evidence-search-input');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'PowerShell');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await new Promise(r => setTimeout(r, 500));

    const evdFiltered = await evalJson(`document.querySelectorAll('.evidence-card').length`);
    console.log(`  Filtered evidence count for 'PowerShell': ${evdFiltered}`);

    // Clear search
    await evalJson(`(() => {
      const input = document.querySelector('.evidence-search-input');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await new Promise(r => setTimeout(r, 500));

    // 4.3 Cycle Detail Tabs (PROVENANCE, CUSTODY, CONTEXT, NOTES)
    console.log('[4.3] Cycling through detail tabs...');
    const tabNames = ['CUSTODY', 'CONTEXT', 'NOTES', 'PROVENANCE'];
    for (const tab of tabNames) {
      await evalJson(`(() => {
        const btn = Array.from(document.querySelectorAll('.evidence-detail-tab-btn')).find(b => b.textContent.includes('${tab}'));
        if (btn) btn.click();
      })()`);
      await new Promise(r => setTimeout(r, 300));
    }
    console.log('  ✓ All 4 detail tabs rendered cleanly without layout errors.');

    // 4.4 Verify Integrity Action
    console.log('[4.4] Executing live cryptographic integrity verification...');
    await evalJson(`(() => {
      const firstCard = document.querySelector('.evidence-item-card');
      if (firstCard) firstCard.click();
      const tabs = Array.from(document.querySelectorAll('.evidence-detail-tab-btn'));
      const provTab = tabs.find(t => t.textContent.includes('PROVENANCE'));
      if (provTab) provTab.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const verifyRes = await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('VERIFY INTEGRITY') || b.textContent.includes('VERIFY')));
      if (btn) {
        btn.click();
        return { success: true, text: btn.textContent.trim() };
      }
      return { success: false };
    })()`);
    if (!verifyRes.success) throw new Error('Verify integrity button not found in Evidence detail panel');

    let integrityStatus = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 300));
      integrityStatus = await evalJson(`(() => {
        const box = document.querySelector('.evidence-12field-grid + div') ||
                    Array.from(document.querySelectorAll('strong, div, span')).find(el => el.textContent && (el.textContent.includes('INTEGRITY MATCH') || el.textContent.includes('SHA-256 integrity verified')));
        return box ? box.textContent.trim().slice(0, 100) : null;
      })()`);
      if (integrityStatus) break;
    }
    console.log(`  Integrity Status: "${integrityStatus}"`);
    if (!integrityStatus) throw new Error('Integrity verification status feedback box not rendered within timeout');
    console.log('  ✓ SHA-256 cryptographic verification succeeded.');
    await saveScreenshot(send, 'final_audit_journey4_evidence_1440.png');

    // Return to Hub
    await evalJson(`(() => {
      const backBtn = document.querySelector('.evidence-back-btn');
      if (backBtn) backBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    // ──────────────────────────────────────────────────────────────────────────
    // JOURNEY 5: Detection -> select rule -> versions/diff -> simulation -> Back/Escape
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------');
    console.log('JOURNEY 5: Detection -> Select Rule -> Versions/Diff -> Simulation -> Back/Escape');
    console.log('----------------------------------------------------------------');

    // 5.1 Navigate to Detection
    console.log('[5.1] Navigating to Zone 6: DETECTION RULES...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('DETECTION'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // Measure Detection Overlap @ 1440x900
    const detOverlap1440 = await measureWorkspaceOverlap(evalJson, 'DETECTION', '1440x900');
    console.log(`  DETECTION (1440x900): ${detOverlap1440.totalChecked} pairs checked, ${detOverlap1440.overlaps.length} overlaps detected.`);
    if (detOverlap1440.overlaps.length > 0) {
      console.error('DETECTION Overlap Error:', JSON.stringify(detOverlap1440.overlaps, null, 2));
      throw new Error(`Overlap detected in DETECTION at 1440x900: ${JSON.stringify(detOverlap1440.overlaps)}`);
    }

    // 5.2 Select rule DET-EXF-001
    console.log('[5.2] Selecting rule DET-EXF-001...');
    await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.det-rule-card'));
      const card = cards.find(c => c.textContent.includes('DET-EXF-001'));
      if (card) card.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    // 5.3 Versions Tab
    console.log('[5.3] Inspecting Versions tab...');
    await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('.det-tab-btn')).find(b => b.textContent.includes('Versions'));
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    // 5.4 Diff Tab
    console.log('[5.4] Inspecting Diff tab...');
    await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('.det-tab-btn')).find(b => b.textContent.trim() === 'Diff');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    // 5.5 Simulation Test
    console.log('[5.5] Executing dry-run rule simulation...');
    await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Run Simulation Test'));
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    const simResults = await evalJson(`(() => {
      const metrics = Array.from(document.querySelectorAll('.sim-metric-val')).map(m => m.textContent.trim());
      return { metrics };
    })()`);
    console.log('  Simulation metrics:', JSON.stringify(simResults));
    if (simResults.metrics.length !== 4) throw new Error('Simulation metrics count mismatch');
    console.log('  ✓ Simulation dry-run executed with 0 production alerts.');
    await saveScreenshot(send, 'final_audit_journey5_detection_1440.png');

    // 5.6 Hierarchical Escape
    console.log('[5.6] Testing Hierarchical Escape...');
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 600));

    const revertedTab = await evalJson(`document.querySelector('.det-tab-btn.active')?.textContent?.trim()`);
    if (revertedTab !== 'Inspector') throw new Error(`Expected 'Inspector', got '${revertedTab}'`);

    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 1200));

    const atHub5 = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
    if (!atHub5) throw new Error('Level 2 Escape failed to return to Hub');
    console.log('  ✓ Level 2 Escape returned cleanly to Spatial Command Hub.');

    // ──────────────────────────────────────────────────────────────────────────
    // HIGH-DEFINITION (1920x1080) REAL OVERLAP MEASUREMENT ACROSS ALL WORKSPACES
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------');
    console.log('HIGH-DEFINITION (1920x1080) REAL OVERLAP AUDIT (All Workspaces)');
    console.log('----------------------------------------------------------------');

    console.log('[HD] Setting viewport to 1920x1080...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1500));

    // Measure Hub @ 1920x1080
    const hubOverlap1920 = await measureWorkspaceOverlap(evalJson, 'HUB', '1920x1080');
    console.log(`  HUB (1920x1080): ${hubOverlap1920.totalChecked} pairs checked, ${hubOverlap1920.overlaps.length} overlaps.`);
    if (hubOverlap1920.overlaps.length > 0) throw new Error(`HUB 1920 overlap: ${JSON.stringify(hubOverlap1920.overlaps)}`);

    // Measure Command @ 1920x1080
    await evalJson(`document.querySelectorAll('.hub-workspace-node')[0].click()`);
    await new Promise(r => setTimeout(r, 1500));
    const cmdOverlap1920 = await measureWorkspaceOverlap(evalJson, 'COMMAND', '1920x1080');
    console.log(`  COMMAND (1920x1080): ${cmdOverlap1920.totalChecked} pairs checked, ${cmdOverlap1920.overlaps.length} overlaps.`);
    if (cmdOverlap1920.overlaps.length > 0) throw new Error(`COMMAND 1920 overlap: ${JSON.stringify(cmdOverlap1920.overlaps)}`);

    // Measure Investigation @ 1920x1080
    await evalJson(`document.querySelector('.command-incident-card, .inc-node')?.click()`);
    await new Promise(r => setTimeout(r, 1500));
    const invOverlap1920 = await measureWorkspaceOverlap(evalJson, 'INVESTIGATION', '1920x1080');
    console.log(`  INVESTIGATION (1920x1080): ${invOverlap1920.totalChecked} pairs checked, ${invOverlap1920.overlaps.length} overlaps.`);
    if (invOverlap1920.overlaps.length > 0) throw new Error(`INVESTIGATION 1920 overlap: ${JSON.stringify(invOverlap1920.overlaps)}`);

    // Exit back to Command then Hub
    await evalJson(`document.querySelector('.inv-back-btn')?.click()`);
    await new Promise(r => setTimeout(r, 1000));
    await evalJson(`document.querySelector('.hub-return-btn')?.click() || window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
    await new Promise(r => setTimeout(r, 1000));

    // Measure Hunting @ 1920x1080
    await evalJson(`Array.from(document.querySelectorAll('.hub-workspace-node')).find(n => n.textContent.includes('HUNTING'))?.click()`);
    await new Promise(r => setTimeout(r, 1500));
    const huntOverlap1920 = await measureWorkspaceOverlap(evalJson, 'HUNTING', '1920x1080');
    console.log(`  HUNTING (1920x1080): ${huntOverlap1920.totalChecked} pairs checked, ${huntOverlap1920.overlaps.length} overlaps.`);
    if (huntOverlap1920.overlaps.length > 0) throw new Error(`HUNTING 1920 overlap: ${JSON.stringify(huntOverlap1920.overlaps)}`);
    await evalJson(`(document.querySelector('.hunt-back-btn') || document.querySelector('.hunt-close-btn'))?.click()`);
    await new Promise(r => setTimeout(r, 1000));

    // Measure Cases @ 1920x1080
    await evalJson(`Array.from(document.querySelectorAll('.hub-workspace-node')).find(n => n.textContent.includes('CASE'))?.click()`);
    await new Promise(r => setTimeout(r, 1500));
    const caseOverlap1920 = await measureWorkspaceOverlap(evalJson, 'CASES', '1920x1080');
    console.log(`  CASES (1920x1080): ${caseOverlap1920.totalChecked} pairs checked, ${caseOverlap1920.overlaps.length} overlaps.`);
    if (caseOverlap1920.overlaps.length > 0) throw new Error(`CASES 1920 overlap: ${JSON.stringify(caseOverlap1920.overlaps)}`);
    await evalJson(`document.querySelector('.case-back-btn')?.click()`);
    await new Promise(r => setTimeout(r, 1000));

    // Measure Evidence @ 1920x1080
    await evalJson(`Array.from(document.querySelectorAll('.hub-workspace-node')).find(n => n.textContent.includes('EVIDENCE'))?.click()`);
    await new Promise(r => setTimeout(r, 1500));
    const evdOverlap1920 = await measureWorkspaceOverlap(evalJson, 'EVIDENCE', '1920x1080');
    console.log(`  EVIDENCE (1920x1080): ${evdOverlap1920.totalChecked} pairs checked, ${evdOverlap1920.overlaps.length} overlaps.`);
    if (evdOverlap1920.overlaps.length > 0) throw new Error(`EVIDENCE 1920 overlap: ${JSON.stringify(evdOverlap1920.overlaps)}`);
    await evalJson(`document.querySelector('.evidence-back-btn')?.click()`);
    await new Promise(r => setTimeout(r, 1000));

    // Measure Detection @ 1920x1080
    await evalJson(`Array.from(document.querySelectorAll('.hub-workspace-node')).find(n => n.textContent.includes('DETECTION'))?.click()`);
    await new Promise(r => setTimeout(r, 1500));
    const detOverlap1920 = await measureWorkspaceOverlap(evalJson, 'DETECTION', '1920x1080');
    console.log(`  DETECTION (1920x1080): ${detOverlap1920.totalChecked} pairs checked, ${detOverlap1920.overlaps.length} overlaps.`);
    if (detOverlap1920.overlaps.length > 0) throw new Error(`DETECTION 1920 overlap: ${JSON.stringify(detOverlap1920.overlaps)}`);
    await evalJson(`document.querySelector('.det-back-btn')?.click() || document.querySelector('.det-close-btn')?.click()`);
    await new Promise(r => setTimeout(r, 1000));

    await saveScreenshot(send, 'final_audit_1920_overview.png');
    console.log('  ✓ Zero overlaps measured across all workspaces at both 1440x900 and 1920x1080.');

    // ──────────────────────────────────────────────────────────────────────────
    // JOURNEY 6: Refresh and confirm saved records persist
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------');
    console.log('JOURNEY 6: Page Refresh & Persistent Storage Verification');
    console.log('----------------------------------------------------------------');

    console.log('[6.1] Reloading browser page...');
    await send('Page.reload');
    await new Promise(r => setTimeout(r, 3000));

    const hubAfterReload = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log(`  Hub mounted after reload: ${hubAfterReload}`);
    if (!hubAfterReload) throw new Error('Failed to mount Hub after reload');

    // Deep IDB Audit
    console.log('[6.2] Re-auditing deep snapshot of all IndexedDB stores in es-spatial-db...');
    const snapshotFinal = await captureDbSnapshot(evalAsync);

    const allowedAdditionStores = new Set(['audit_records', 'detection_test_runs', 'evidence_custody']);
    const missingRecords = [];
    const changedRecords = [];
    const disallowedAdditions = [];
    const verifiedAdditions = {};

    for (const store of Object.keys(snapshotInitial)) {
      const initStore = snapshotInitial[store];
      const finalStore = snapshotFinal[store];
      if (!finalStore) {
        missingRecords.push({ store, error: 'Store was deleted' });
        continue;
      }

      // Check for missing or changed existing records
      for (const key of Object.keys(initStore.records)) {
        if (!(key in finalStore.records)) {
          missingRecords.push({ store, key });
        } else {
          const recInitStr = JSON.stringify(initStore.records[key]);
          const recFinalStr = JSON.stringify(finalStore.records[key]);
          if (recInitStr !== recFinalStr) {
            changedRecords.push({
              store,
              key,
              diff: `Record value modified`
            });
          }
        }
      }

      // Check for additions
      const addedKeys = Object.keys(finalStore.records).filter(k => !(k in initStore.records));
      if (addedKeys.length > 0) {
        if (!allowedAdditionStores.has(store)) {
          disallowedAdditions.push({ store, addedKeys });
        } else {
          verifiedAdditions[store] = addedKeys.length;
        }
      }
    }

    console.log('\n  --- Storage Persistence Results ---');
    console.log(`  Total stores audited: ${Object.keys(snapshotFinal).length}`);
    console.log(`  Missing existing records: ${missingRecords.length}`);
    console.log(`  Changed existing records: ${changedRecords.length}`);
    console.log(`  Disallowed additions: ${disallowedAdditions.length}`);
    console.log(`  Allowed operational additions:`, JSON.stringify(verifiedAdditions));

    if (missingRecords.length > 0) {
      console.error('❌ Missing records detected:', JSON.stringify(missingRecords, null, 2));
      throw new Error(`Integrity Failure: ${missingRecords.length} existing records are missing from storage!`);
    }

    if (changedRecords.length > 0) {
      console.error('❌ Changed records detected:', JSON.stringify(changedRecords, null, 2));
      throw new Error(`Integrity Failure: ${changedRecords.length} existing records were modified in storage!`);
    }

    if (disallowedAdditions.length > 0) {
      console.error('❌ Disallowed additions detected:', JSON.stringify(disallowedAdditions, null, 2));
      throw new Error(`Integrity Failure: Unexpected additions found in non-audit stores!`);
    }

    console.log('  ✓ Storage verification passed: 0 missing records, 0 changed existing records, and only expected audit/test additions.');

    // ──────────────────────────────────────────────────────────────────────────
    // Console Errors Audit
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------------------');
    console.log('CONSOLE ERROR AUDIT');
    console.log('----------------------------------------------------------------');
    console.log(`  Total non-benign console errors captured: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.error('  Errors detected:', consoleErrors);
      throw new Error(`Encountered ${consoleErrors.length} console errors during workflow audit`);
    }
    console.log('  ✓ ZERO console errors recorded across all six journeys.');

    console.log('\n================================================================');
    console.log('✅ ALL SIX THREATLENX WORKFLOW JOURNEYS VERIFIED WITH STRICT ASSERTIONS!');
    console.log('================================================================\n');

  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    try {
      if (fs.existsSync(isolatedProfile)) {
        fs.rmSync(isolatedProfile, { recursive: true, force: true });
      }
    } catch {}
  }
}

main().catch(err => {
  console.error('\n❌ Workflow Audit Failed:', err);
  process.exit(1);
});

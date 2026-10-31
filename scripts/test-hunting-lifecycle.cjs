/**
 * scripts/test-hunting-lifecycle.cjs
 *
 * Dedicated verification suite for Threat Hunting Execution Lifecycle:
 * 1. Stop query/filter edits from automatically executing hunts.
 * 2. Preserve explicit Run Hunt, template execution, and saved-hunt Load & Run.
 * 3. Cancel pending timers on unmount and prevent older runs from overwriting newer results.
 * 4. Ensure denied execution exits the loading state cleanly.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

async function runHuntingLifecycleSuite() {
  const port = 9500 + Math.floor(Math.random() * 400);
  const profileDir = `/tmp/threatlenx-chrome-profile-hunting-lifecycle-${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });

  console.log('====================================================');
  console.log('   THREAT HUNTING EXECUTION LIFECYCLE TEST SUITE');
  console.log('====================================================\n');

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
      } catch {
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
    const consoleErrors = [];

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const cb = pendingCallbacks.get(msg.id);
          pendingCallbacks.delete(msg.id);
          cb(msg);
        }
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
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

    await send('Runtime.enable');

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

    function assert(condition, message) {
      if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
      }
      console.log(`  ✓ ${message}`);
    }

    // Navigate to local dev server
    console.log('[1/6] Navigating to http://127.0.0.1:3000/...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });

    // Wait for hydration on Spatial Command Hub
    console.log('[2/6] Waiting for React hydration on Spatial Command Hub...');
    let hydrated = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      hydrated = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
      if (hydrated) break;
    }
    assert(hydrated, 'Spatial Command Hub hydrated with 6 zone nodes');
    // Wait for React event listeners to settle
    await new Promise(r => setTimeout(r, 1500));

    // Navigate to Zone 3: Threat Hunting Workspace
    console.log('[3/6] Navigating into Threat Hunting Workspace...');
    await evalJson(`(() => {
      const target = document.querySelector('.hub-workspace-node[aria-label*="THREAT HUNTING"]') ||
        Array.from(document.querySelectorAll('.hub-workspace-node')).find(n => n.textContent && n.textContent.includes('THREAT HUNTING'));
      if (target) target.click();
    })()`);

    let workspaceMounted = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      workspaceMounted = await evalJson(`!!document.querySelector('.threat-hunting-workspace')`);
      if (workspaceMounted) break;
    }
    assert(workspaceMounted, 'ThreatHuntingWorkspace mounted successfully');

    // Wait for baseline hunt execution on mount to settle
    let baselineSettled = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      const btnText = await evalJson(`document.querySelector('.hunt-btn-run')?.textContent?.trim()`);
      if (btnText === 'RUN HUNT') {
        baselineSettled = true;
        break;
      }
    }
    assert(baselineSettled, 'Baseline mount execution completed cleanly, button shows RUN HUNT');

    // ─── TEST 1: Query & Filter edits DO NOT trigger execution ─────────────────
    console.log('\n--- TEST 1: Typing & Filter Edits Do NOT Automatically Execute Hunts ---');

    // Switch to FILTERS tab
    await evalJson(`(() => {
      const filterTab = Array.from(document.querySelectorAll('.hunt-tab-btn')).find(b => b.textContent.includes('FILTERS'));
      if (filterTab) filterTab.click();
    })()`);
    await new Promise(r => setTimeout(r, 100));

    // Type text into search input and change category dropdown
    const editResult = await evalJson(`(() => {
      const input = document.querySelector('.hunt-input');
      const select = document.querySelector('.hunt-select');
      if (!input || !select) return { error: 'Inputs not found' };

      // Set input value and dispatch input/change events
      input.value = 'svchost_suspicious_telemetry';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Set category select
      select.value = 'NETWORK';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true, inputValue: input.value, selectValue: select.value };
    })()`);
    assert(editResult.success, 'Query search input and category dropdown edited');

    // Monitor for 400ms: assert button remains 'RUN HUNT' and never enters loading state
    let triggeredAutoExecution = false;
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 50));
      const stateText = await evalJson(`document.querySelector('.hunt-btn-run')?.textContent?.trim()`);
      if (stateText && stateText !== 'RUN HUNT') {
        triggeredAutoExecution = true;
        break;
      }
    }
    assert(!triggeredAutoExecution, 'Zero automatic executions triggered during query and filter edits');

    // ─── TEST 2: Explicit Run Hunt executes with edited query ──────────────────
    console.log('\n--- TEST 2: Explicit "RUN HUNT" Button Triggers Pipeline ---');

    const clickRunResult = await evalJson(`(() => {
      const runBtn = document.querySelector('.hunt-btn-run');
      if (!runBtn) return { error: 'Run button missing' };
      runBtn.click();
      return { success: true, textImmediatelyAfter: runBtn.textContent.trim() };
    })()`);
    assert(clickRunResult.success, 'Clicked RUN HUNT button explicitly');

    // Verify it transitioned into querying/filtering/aggregating pipeline
    let sawLoadingState = false;
    let returnedToReady = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 50));
      const stateText = await evalJson(`document.querySelector('.hunt-btn-run')?.textContent?.trim()`);
      if (stateText && (stateText.includes('QUERYING') || stateText.includes('FILTERING') || stateText.includes('AGGREGATING'))) {
        sawLoadingState = true;
      }
      if (sawLoadingState && stateText === 'RUN HUNT') {
        returnedToReady = true;
        break;
      }
    }
    assert(sawLoadingState, 'Observed loading state pipeline (QUERYING / FILTERING / AGGREGATING)');
    assert(returnedToReady, 'Pipeline completed cleanly and returned to RUN HUNT state');

    // ─── TEST 3: Template Execution & Saved-Hunt Load & Run ────────────────────
    console.log('\n--- TEST 3: Template Execution & Saved-Hunt Load & Run ---');

    // Switch to TEMPLATES tab
    await evalJson(`(() => {
      const tplTab = Array.from(document.querySelectorAll('.hunt-tab-btn')).find(b => b.textContent.includes('TEMPLATES'));
      if (tplTab) tplTab.click();
    })()`);
    await new Promise(r => setTimeout(r, 100));

    // Click Template 2
    const tplClick = await evalJson(`(() => {
      const cards = document.querySelectorAll('.hunt-template-card');
      if (cards.length > 1) {
        cards[1].click();
        return { success: true, name: cards[1].querySelector('.tpl-name')?.textContent?.trim() };
      }
      return { success: false };
    })()`);
    assert(tplClick.success, `Clicked template: "${tplClick.name}"`);

    // Verify execution completes cleanly
    let tplDone = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 60));
      const stateText = await evalJson(`document.querySelector('.hunt-btn-run')?.textContent?.trim()`);
      if (stateText === 'RUN HUNT') {
        tplDone = true;
        break;
      }
    }
    assert(tplDone, 'Template execution completed cleanly');

    // Test Saved Hunt Load & Run
    const openSaved = await evalJson(`(() => {
      const savedBtn = document.querySelector('.hunt-query-col .hunt-btn-save');
      if (savedBtn) {
        savedBtn.click();
        return true;
      }
      return false;
    })()`);
    assert(openSaved, 'Opened Saved Hunts Notebook drawer');

    let loadBtnFound = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 100));
      const hasCards = await evalJson(`document.querySelectorAll('.hunt-saved-item-card').length > 0`);
      if (hasCards) {
        loadBtnFound = true;
        break;
      }
    }
    assert(loadBtnFound, 'Saved hunt cards rendered in notebook drawer');

    // Click LOAD & RUN on first notebook card
    const loadAndRunClick = await evalJson(`(() => {
      const card = document.querySelector('.hunt-saved-item-card');
      const loadBtn = Array.from(card?.querySelectorAll('button') || []).find(b => b.textContent.includes('LOAD & RUN'));
      if (loadBtn) {
        loadBtn.click();
        return true;
      }
      return false;
    })()`);
    assert(loadAndRunClick, 'Clicked LOAD & RUN on saved notebook');

    let savedRunDone = false;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 60));
      const stateText = await evalJson(`document.querySelector('.hunt-btn-run')?.textContent?.trim()`);
      if (stateText === 'RUN HUNT') {
        savedRunDone = true;
        break;
      }
    }
    assert(savedRunDone, 'Saved-hunt Load & Run completed cleanly');

    // ─── TEST 4: Rapid Consecutive Runs ───────────────────────────────────────
    console.log('\n--- TEST 4: Rapid Consecutive Runs (Timers Cancelled, No Overwrite) ---');

    // Trigger Run A then Run B rapidly
    const rapidRunResult = await evalJson(`(() => {
      const cards = document.querySelectorAll('.hunt-template-card');
      if (cards.length >= 4) {
        // Click template 2 (Run A)
        cards[2].click();
        // Immediately click template 3 (Run B) 10ms later
        setTimeout(() => {
          cards[3].click();
        }, 10);
        return {
          runA: cards[2].querySelector('.tpl-name')?.textContent?.trim(),
          runB: cards[3].querySelector('.tpl-name')?.textContent?.trim()
        };
      }
      return null;
    })()`);
    assert(rapidRunResult !== null, `Rapid consecutive runs triggered: Run A ("${rapidRunResult?.runA}") then Run B ("${rapidRunResult?.runB}")`);

    // Wait for the pipeline to settle
    let rapidDone = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 60));
      const stateText = await evalJson(`document.querySelector('.hunt-btn-run')?.textContent?.trim()`);
      if (stateText === 'RUN HUNT') {
        rapidDone = true;
        break;
      }
    }
    assert(rapidDone, 'Pipeline completed cleanly after rapid consecutive runs');

    // Verify active template matches Run B (the latest run) and was not overwritten by Run A
    const activeTemplate = await evalJson(`(() => {
      const activeCard = document.querySelector('.hunt-template-card.active .tpl-name');
      return activeCard?.textContent?.trim();
    })()`);
    assert(activeTemplate === rapidRunResult.runB, `Latest run retained without overwrite by older run (active: "${activeTemplate}")`);

    // ─── TEST 5: Unmount During Execution ─────────────────────────────────────
    console.log('\n--- TEST 5: Unmount During Execution (Pending Timers Cancelled) ---');

    const preErrorsCount = consoleErrors.length;

    // Start an execution
    await evalJson(`(() => {
      const runBtn = document.querySelector('.hunt-btn-run');
      if (runBtn) runBtn.click();
    })()`);

    // Immediately unmount by returning to Hub
    await evalJson(`(() => {
      const backBtn = document.querySelector('.hunt-back-btn');
      if (backBtn) backBtn.click();
    })()`);

    // Wait 500ms to allow all pending timers (100ms, 200ms) to elapse while unmounted
    await new Promise(r => setTimeout(r, 500));

    const isAtHub = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
    assert(isAtHub, 'Returned to Spatial Command Hub while query was in-flight');

    const newErrors = consoleErrors.slice(preErrorsCount);
    const unmountErrors = newErrors.filter(e => e.includes('unmounted') || e.includes('memory leak') || e.includes('Can\'t perform a React state update'));
    assert(unmountErrors.length === 0, 'Zero unmounted component state update warnings or errors');

    // ─── TEST 6: Denied Execution Exits Loading State Cleanly ──────────────────
    console.log('\n--- TEST 6: Denied Execution Exits Loading State Cleanly ---');

    // Navigate back to Threat Hunting Workspace
    await evalJson(`(() => {
      const target = document.querySelector('.hub-workspace-node[aria-label*="THREAT HUNTING"]') ||
        Array.from(document.querySelectorAll('.hub-workspace-node')).find(n => n.textContent && n.textContent.includes('THREAT HUNTING'));
      if (target) target.click();
    })()`);

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100));
      const mounted = await evalJson(`!!document.querySelector('.threat-hunting-workspace')`);
      if (mounted) break;
    }

    // Wait for baseline to finish
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 60));
      const text = await evalJson(`document.querySelector('.hunt-btn-run')?.textContent?.trim()`);
      if (text === 'RUN HUNT') break;
    }

    // Check window.__securityService
    const hasSecService = await evalJson(`!!window.__securityService`);
    console.log('window.__securityService available:', hasSecService);

    // Temporarily install a mock on securityService.runThreatHunt that rejects (denied execution)
    await evalJson(`(() => {
      if (window.__securityService) {
        window.__origRunThreatHunt = window.__securityService.runThreatHunt;
        window.__securityService.runThreatHunt = async () => {
          throw new Error('Unauthorized: Role lacks THREAT_HUNT_EXECUTE permission.');
        };
      }
    })()`);

    // Click RUN HUNT
    await evalJson(`document.querySelector('.hunt-btn-run')?.click()`);

    // Verify it transitions through pipeline and exits loading state back to RUN HUNT with status notice
    let deniedExitedCleanly = false;
    let noticeMessage = null;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 50));
      const res = await evalJson(`(() => {
        const btn = document.querySelector('.hunt-btn-run')?.textContent?.trim();
        const notice = document.querySelector('.hunt-status-notice')?.textContent?.trim();
        return { btn, notice };
      })()`);
      if (res && res.btn === 'RUN HUNT' && res.notice && res.notice.includes('THREAT_HUNT_EXECUTE')) {
        deniedExitedCleanly = true;
        noticeMessage = res.notice;
        break;
      }
    }

    // Restore original method
    await evalJson(`(() => {
      if (window.__origRunThreatHunt && window.__securityService) {
        window.__securityService.runThreatHunt = window.__origRunThreatHunt;
        delete window.__origRunThreatHunt;
      }
    })()`);

    assert(deniedExitedCleanly, `Denied execution exited loading state cleanly (status: "${noticeMessage}")`);

    console.log('\n====================================================');
    console.log('   ALL 6 HUNTING LIFECYCLE TESTS PASSED CLEANLY! ✓');
    console.log('====================================================\n');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

runHuntingLifecycleSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

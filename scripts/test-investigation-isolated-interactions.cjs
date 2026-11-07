const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(msg);
  }
  console.log(`  ✓ ${msg}`);
}

async function runInvestigationIsolatedInteractions() {
  console.log('======================================================================');
  console.log('INVESTIGATION INTERACTIONS & GRAPH STABILITY (ISOLATED STORAGE PROFILE)');
  console.log('======================================================================\n');

  const isolatedProfileDir = `/tmp/threatlenx-chrome-profile-inv-${Date.now()}`;
  fs.mkdirSync(isolatedProfileDir, { recursive: true });

  const port = 9480;
  console.log(`[INIT] Launching Headless Chrome on port ${port}...`);
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    `--user-data-dir=${isolatedProfileDir}`,
    '--no-first-run',
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    for (let attempts = 0; attempts < 30; attempts++) {
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
        } catch {}
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('[1/6] Navigating to http://127.0.0.1:3000/...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
    await new Promise(r => setTimeout(r, 3000));

    // Wait for Spatial Hub to hydrate
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hubCount = await send('Runtime.evaluate', {
        expression: `document.querySelectorAll('.hub-workspace-node').length`,
        returnByValue: true
      });
      if (hubCount.result?.value === 6) {
        console.log(`✓ Spatial Hub hydrated with 6 zone nodes!`);
        break;
      }
    }

    // Nav to Investigation (Zone 2)
    console.log('[2/6] Navigating to Investigation Workspace (Zone 2)...');
    const clickedZone = await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const target = nodes.find(n => n.textContent && n.textContent.includes('INVESTIGATION'));
        if (target) {
          target.click();
          return true;
        }
        return false;
      })()`,
      returnByValue: true
    });
    assert(clickedZone.result?.value === true, 'Clicked Investigation zone node');
    await new Promise(r => setTimeout(r, 1500));

    // If on Incident list, click first incident card to enter InvestigationHub
    await send('Runtime.evaluate', {
      expression: `(() => {
        const card = document.querySelector('.inc-card') || document.querySelector('.incident-card') || document.querySelector('[class*="incident"]');
        if (card) card.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1500));

    const mounted = await send('Runtime.evaluate', {
      expression: `Boolean(document.querySelector('.inv-hub') || document.querySelector('.inv-tab') || document.querySelector('.investigation-workspace'))`,
      returnByValue: true
    });
    assert(mounted.result?.value === true, 'Investigation Workspace mounted successfully');

    // 1. TIMELINE VIEW
    console.log('[3/6] Testing SpatialTimeline interaction and scrolling...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('TIMELINE'));
        if (tab) tab.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1000));

    const tlEvents = await send('Runtime.evaluate', {
      expression: `(() => {
        const events = document.querySelectorAll('.tl-event');
        return { count: events.length, firstTitle: events[0]?.querySelector('.tl-title')?.textContent.trim() };
      })()`,
      returnByValue: true
    });
    assert(tlEvents.result?.value?.count > 0, `SpatialTimeline rendered ${tlEvents.result?.value?.count} timeline events`);

    // Click first event in timeline
    await send('Runtime.evaluate', {
      expression: `(() => {
        const first = document.querySelector('.tl-event');
        if (first) {
          first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      })()`
    });
    await new Promise(r => setTimeout(r, 800));

    const selectedTl = await send('Runtime.evaluate', {
      expression: `(() => {
        const ind = document.querySelector('.inv-sel-indicator');
        return { hasIndicator: Boolean(ind), text: ind?.textContent?.trim() };
      })()`,
      returnByValue: true
    });
    console.log('Timeline event selection state:', selectedTl.result?.value);
    assert(selectedTl.result?.value?.hasIndicator === true, `Clicking timeline event sets selectedEntity: "${selectedTl.result?.value?.text}"`);

    // 2. IOC CONSTELLATION VIEW
    console.log('[4/6] Testing IOCConstellation graph rendering and interactions...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('IOC'));
        if (tab) tab.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));

    const iocNodes = await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = document.querySelectorAll('.ioc-node');
        const entities = document.querySelectorAll('.ioc-entity');
        const links = document.querySelectorAll('.ioc-link');
        return { iocCount: nodes.length, entityCount: entities.length, linkCount: links.length };
      })()`,
      returnByValue: true
    });
    assert(iocNodes.result?.value?.iocCount > 0, `IOC Constellation rendered ${iocNodes.result?.value?.iocCount} IOC nodes`);
    assert(iocNodes.result?.value?.entityCount > 0, `IOC Constellation rendered ${iocNodes.result?.value?.entityCount} entity ring nodes`);
    assert(iocNodes.result?.value?.linkCount > 0, `IOC Constellation rendered ${iocNodes.result?.value?.linkCount} relationship links`);

    // Click IOC node to inspect detail strip
    await send('Runtime.evaluate', {
      expression: `(() => {
        const firstNode = document.querySelector('.ioc-node');
        if (firstNode) firstNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`
    });
    await new Promise(r => setTimeout(r, 800));

    const detailStrip = await send('Runtime.evaluate', {
      expression: `Boolean(document.querySelector('.ioc-detail-strip'))`,
      returnByValue: true
    });
    assert(detailStrip.result?.value === true, 'Clicking IOC diamond displays IOC detail strip');

    // 3. ATTACK GRAPH VIEW
    console.log('[5/6] Testing Attack Graph rendering...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('ATTACK'));
        if (tab) tab.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));

    const agCheck = await send('Runtime.evaluate', {
      expression: `document.querySelectorAll('.ag-node').length`,
      returnByValue: true
    });
    assert(agCheck.result?.value > 0, `Attack Graph rendered ${agCheck.result?.value} attack graph nodes`);

    // 4. Return to Hub (Hierarchical: InvestigationHub -> IncidentList -> SpatialCommandHub)
    console.log('[6/6] Returning to Spatial Command Hub (Hierarchical Navigation)...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const exitBtn = document.querySelector('.inv-exit-btn');
        if (exitBtn) exitBtn.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));

    // Now in IncidentListWorkspace, click inv-list-back-btn to return to HUB
    await send('Runtime.evaluate', {
      expression: `(() => {
        const backHubBtn = document.querySelector('.inv-list-back-btn');
        if (backHubBtn) backHubBtn.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1500));

    const hubState = await send('Runtime.evaluate', {
      expression: `Boolean(window.__socNavStore?.getState().workspace === 'HUB' || document.querySelector('.mode-hub'))`,
      returnByValue: true
    });
    assert(hubState.result?.value === true, 'Returned cleanly to Spatial Command Hub via hierarchical navigation');

    console.log('\n======================================================================');
    console.log('✅ ALL INVESTIGATION INTERACTION & GRAPH STABILITY TESTS PASSED');
    console.log('======================================================================\n');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
    try {
      fs.rmSync(isolatedProfileDir, { recursive: true, force: true });
    } catch {}
  }
}

runInvestigationIsolatedInteractions().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0';

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAILED ASSERTION: ${msg}`);
    throw new Error(msg);
  }
  console.log(`  ✓ ${msg}`);
}

async function runStage1Verification() {
  console.log('======================================================================');
  console.log('STAGE 1: VERIFICATION & SCREENSHOT CAPTURE FOR ALL THREE GRAPH SCREENS');
  console.log('======================================================================\n');

  const port = 9345;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-stage1-verify-9345',
    '--no-first-run',
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

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    console.log('[1/10] Connected to Chrome CDP:', pageTarget.webSocketDebuggerUrl);
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

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        pendingCallbacks.set(id, (res) => {
          if (res.error) reject(res.error);
          else resolve(res);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    // 1440x900 viewport
    console.log('[2/10] Navigating to http://localhost:3000/ at 1440x900...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 2500));

    // Open Investigation Hub (Key 2)
    console.log('[3/10] Navigating to Zone 2 (Investigation Hub)...');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
    await new Promise(r => setTimeout(r, 2000));

    // Skip choreography if present
    await send('Runtime.evaluate', {
      expression: `(() => {
        const skip = document.querySelector('.inv-choreo-skip');
        if (skip) skip.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));

    // Helper to clear any selection
    const clearSelection = async () => {
      await send('Runtime.evaluate', {
        expression: `(() => {
          const sel = document.querySelector('.inv-sel-indicator');
          if (sel) sel.click();
        })()`
      });
      await new Promise(r => setTimeout(r, 400));
    };

    // ========================================================================
    // SCREEN 1: ATTACK GRAPH
    // ========================================================================
    console.log('\n[4/10] VERIFYING SCREEN 1: ATTACK GRAPH (Kill Chain Progression)');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('ATTACK'));
        if (tab) tab.click();
      })()`
    });
    await clearSelection();
    await new Promise(r => setTimeout(r, 2000));

    // 1440x900 evaluation
    const agEval1440 = await send('Runtime.evaluate', {
      expression: `(() => {
        const svg = document.querySelector('.ag-svg')?.getBoundingClientRect();
        const nodes = Array.from(document.querySelectorAll('.ag-node')).map(n => {
          const r = n.getBoundingClientRect();
          const card = n.querySelector('.ag-node-card')?.getBoundingClientRect();
          const label = n.querySelector('text')?.textContent || '';
          return { id: n.id, label, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), cardWidth: card ? Math.round(card.width) : 0 };
        });
        const edges = Array.from(document.querySelectorAll('.ag-edge path')).map(p => {
          const r = p.getBoundingClientRect();
          return { d: p.getAttribute('d'), width: Math.round(r.width), height: Math.round(r.height) };
        });
        return {
          svgRect: svg ? { width: Math.round(svg.width), height: Math.round(svg.height), x: Math.round(svg.x), y: Math.round(svg.y) } : null,
          nodeCount: nodes.length,
          uniqueX: new Set(nodes.map(n => n.x)).size,
          uniqueY: new Set(nodes.map(n => n.y)).size,
          nodes,
          edgeCount: edges.length,
          edgesWithData: edges.filter(e => e.d && e.d.length > 5).length
        };
      })()`,
      returnByValue: true
    });
    const ag1440 = agEval1440.result?.result?.value;
    console.log(`  Attack Graph nodes: ${ag1440.nodeCount}, edges: ${ag1440.edgeCount}`);
    console.log(`  Unique X: ${ag1440.uniqueX}, Unique Y: ${ag1440.uniqueY}`);
    assert(ag1440.nodeCount === 12, '12 canonical Attack Graph nodes rendered');
    assert(ag1440.uniqueX >= 5, 'Nodes distributed horizontally across stages (not stacked)');
    assert(ag1440.uniqueY >= 4, 'Nodes distributed vertically across lanes (not stacked)');
    assert(ag1440.edgeCount >= 11, 'All causal kill-chain attack edges rendered');
    assert(ag1440.edgesWithData === ag1440.edgeCount, 'All edges have valid path geometries');

    // Capture 1440
    console.log('  Capturing stage1_attack_graph_1440.png...');
    const agShot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage1_attack_graph_1440.png'), Buffer.from(agShot1440.result.data, 'base64'));
    console.log('  ✓ Saved stage1_attack_graph_1440.png');

    // 1920x1080 evaluation
    console.log('  Resizing to 1920x1080...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1500));

    const agEval1920 = await send('Runtime.evaluate', {
      expression: `(() => {
        const svg = document.querySelector('.ag-svg')?.getBoundingClientRect();
        const nodes = Array.from(document.querySelectorAll('.ag-node')).map(n => ({ id: n.id, x: Math.round(n.getBoundingClientRect().x) }));
        return { svgWidth: svg ? Math.round(svg.width) : 0, uniqueX: new Set(nodes.map(n => n.x)).size };
      })()`,
      returnByValue: true
    });
    const ag1920 = agEval1920.result?.result?.value;
    assert(ag1920.svgWidth >= 1600, 'Attack Graph canvas expanded responsively at 1920x1080');
    assert(ag1920.uniqueX >= 5, 'Nodes remain distinct and separated at 1920x1080');

    console.log('  Capturing stage1_attack_graph_1920.png...');
    const agShot1920 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage1_attack_graph_1920.png'), Buffer.from(agShot1920.result.data, 'base64'));
    console.log('  ✓ Saved stage1_attack_graph_1920.png');

    // Attack Graph node selection test
    console.log('  Testing Attack Graph node selection...');
    const agClickRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const node = document.querySelector('.ag-node');
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: node.id };
      })()`,
      returnByValue: true
    });
    const agTarget = agClickRes.result?.result?.value;
    if (agTarget) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: agTarget.x, y: agTarget.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: agTarget.x, y: agTarget.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 800));

      const inspectorOpen = await send('Runtime.evaluate', {
        expression: `!!document.querySelector('.ag-selection-strip')`,
        returnByValue: true
      });
      assert(inspectorOpen.result?.result?.value === true, 'Selection inspector strip opened on node click');

      // Click node again or click backdrop to deselect
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: agTarget.x, y: agTarget.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: agTarget.x, y: agTarget.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 600));
    }

    // Reset viewport to 1440x900
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 800));

    // ========================================================================
    // SCREEN 2: IOC CONSTELLATION
    // ========================================================================
    console.log('\n[5/10] VERIFYING SCREEN 2: IOC CONSTELLATION (Radial Threat Intelligence)');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('IOC'));
        if (tab) tab.click();
      })()`
    });
    // Clear selection so full baseline constellation is illuminated
    await clearSelection();
    await new Promise(r => setTimeout(r, 2000));

    const iocEval1440 = await send('Runtime.evaluate', {
      expression: `(() => {
        const container = document.querySelector('.ioc-container');
        const svg = document.querySelector('.ioc-svg')?.getBoundingClientRect();
        const iocNodes = Array.from(document.querySelectorAll('.ioc-node')).map(n => {
          const r = n.getBoundingClientRect();
          return { text: n.textContent.trim(), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        });
        const entityNodes = Array.from(document.querySelectorAll('.ioc-entity')).map(n => {
          const r = n.getBoundingClientRect();
          return { text: n.textContent.trim(), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        });
        const links = Array.from(document.querySelectorAll('.ioc-link')).map(l => {
          const r = l.getBoundingClientRect();
          return { x1: l.getAttribute('x1'), y1: l.getAttribute('y1'), x2: l.getAttribute('x2'), y2: l.getAttribute('y2'), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return {
          hasContainer: !!container,
          svgRect: svg ? { width: Math.round(svg.width), height: Math.round(svg.height), x: Math.round(svg.x), y: Math.round(svg.y) } : null,
          iocCount: iocNodes.length,
          uniqueIocX: new Set(iocNodes.map(n => n.x)).size,
          uniqueIocY: new Set(iocNodes.map(n => n.y)).size,
          iocNodes,
          entityCount: entityNodes.length,
          uniqueEntityX: new Set(entityNodes.map(n => n.x)).size,
          uniqueEntityY: new Set(entityNodes.map(n => n.y)).size,
          entityNodes,
          linkCount: links.length,
          links: links.slice(0, 3)
        };
      })()`,
      returnByValue: true
    });
    const ioc1440 = iocEval1440.result?.result?.value;
    console.log(`  IOC nodes: ${ioc1440.iocCount}, Entity nodes: ${ioc1440.entityCount}, Links: ${ioc1440.linkCount}`);
    console.log(`  IOC unique X: ${ioc1440.uniqueIocX}, unique Y: ${ioc1440.uniqueIocY}`);
    console.log(`  Entity unique X: ${ioc1440.uniqueEntityX}, unique Y: ${ioc1440.uniqueEntityY}`);
    assert(ioc1440.iocCount === 5, 'All 5 canonical IOC indicator nodes rendered');
    assert(ioc1440.uniqueIocX >= 4, 'IOC nodes form distinct constellation X coordinates (not stacked)');
    assert(ioc1440.uniqueIocY >= 3, 'IOC nodes form distinct constellation Y coordinates (not stacked)');
    assert(ioc1440.entityCount === 3, 'All 3 connected target entities rendered in outer orbit');
    assert(ioc1440.uniqueEntityX >= 3, 'Entity nodes properly spaced across outer orbit');
    assert(ioc1440.linkCount === 6, 'All 6 relationship links rendered');

    // Capture 1440
    console.log('  Capturing stage1_ioc_constellation_1440.png...');
    const iocShot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage1_ioc_constellation_1440.png'), Buffer.from(iocShot1440.result.data, 'base64'));
    console.log('  ✓ Saved stage1_ioc_constellation_1440.png');

    // 1920x1080 evaluation
    console.log('  Resizing to 1920x1080...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1500));

    console.log('  Capturing stage1_ioc_constellation_1920.png...');
    const iocShot1920 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage1_ioc_constellation_1920.png'), Buffer.from(iocShot1920.result.data, 'base64'));
    console.log('  ✓ Saved stage1_ioc_constellation_1920.png');

    // Test IOC node selection
    console.log('  Testing IOC node selection...');
    const iocClickRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const node = document.querySelector('.ioc-node');
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`,
      returnByValue: true
    });
    const iocTarget = iocClickRes.result?.result?.value;
    if (iocTarget) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: iocTarget.x, y: iocTarget.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: iocTarget.x, y: iocTarget.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 800));

      const iocDetailOpen = await send('Runtime.evaluate', {
        expression: `!!document.querySelector('.ioc-detail-strip')`,
        returnByValue: true
      });
      assert(iocDetailOpen.result?.result?.value === true, 'IOC detail strip opened on IOC node selection');

      // Deselect
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: iocTarget.x, y: iocTarget.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: iocTarget.x, y: iocTarget.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 600));
    }

    // Reset viewport to 1440x900
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 800));

    // ========================================================================
    // SCREEN 3: SYSTEM RADAR
    // ========================================================================
    console.log('\n[6/10] VERIFYING SCREEN 3: SYSTEM RADAR (Blast Radius Polar Chart)');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('SYSTEM'));
        if (tab) tab.click();
      })()`
    });
    await clearSelection();
    await new Promise(r => setTimeout(r, 2000));

    const radarEval1440 = await send('Runtime.evaluate', {
      expression: `(() => {
        const container = document.querySelector('.radar-container');
        const svg = document.querySelector('.radar-svg')?.getBoundingClientRect();
        const nodes = Array.from(document.querySelectorAll('.radar-node')).map(n => {
          const r = n.getBoundingClientRect();
          return { text: n.textContent.trim(), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        });
        const rings = document.querySelectorAll('.radar-ring');
        const sweep = document.querySelector('.radar-sweep-arm');
        const lines = document.querySelectorAll('.radar-node line');
        return {
          hasContainer: !!container,
          svgRect: svg ? { width: Math.round(svg.width), height: Math.round(svg.height), x: Math.round(svg.x), y: Math.round(svg.y) } : null,
          nodeCount: nodes.length,
          uniqueX: new Set(nodes.map(n => n.x)).size,
          uniqueY: new Set(nodes.map(n => n.y)).size,
          nodes,
          ringsCount: rings.length,
          hasSweepArm: !!sweep,
          connectionLinesCount: lines.length
        };
      })()`,
      returnByValue: true
    });
    const radar1440 = radarEval1440.result?.result?.value;
    console.log(`  System Radar nodes: ${radar1440.nodeCount}, blast rings: ${radar1440.ringsCount}, radial lines: ${radar1440.connectionLinesCount}`);
    console.log(`  Radar unique X: ${radar1440.uniqueX}, unique Y: ${radar1440.uniqueY}`);
    assert(radar1440.hasContainer === true, 'System Radar container mounted');
    assert(radar1440.nodeCount === 6, 'All 6 affected/at-risk asset nodes plotted on radar');
    assert(radar1440.uniqueX >= 4, 'Asset nodes properly placed by polar angle and hop distance (not stacked)');
    assert(radar1440.ringsCount === 4, 'All 4 concentric blast radius distance rings rendered');
    assert(radar1440.hasSweepArm === true, 'Cinematic radar sweep arm active');
    assert(radar1440.connectionLinesCount === 6, 'All 6 radial connection lines link assets to incident core');

    // Capture 1440
    console.log('  Capturing stage1_system_radar_1440.png...');
    const radarShot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage1_system_radar_1440.png'), Buffer.from(radarShot1440.result.data, 'base64'));
    console.log('  ✓ Saved stage1_system_radar_1440.png');

    // 1920x1080 evaluation
    console.log('  Resizing to 1920x1080...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1500));

    console.log('  Capturing stage1_system_radar_1920.png...');
    const radarShot1920 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage1_system_radar_1920.png'), Buffer.from(radarShot1920.result.data, 'base64'));
    console.log('  ✓ Saved stage1_system_radar_1920.png');

    // Test System Radar asset selection
    console.log('  Testing System Radar node selection...');
    const radarClickRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const node = document.querySelector('.radar-node');
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`,
      returnByValue: true
    });
    const radarTarget = radarClickRes.result?.result?.value;
    if (radarTarget) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: radarTarget.x, y: radarTarget.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: radarTarget.x, y: radarTarget.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 800));

      const selCheck = await send('Runtime.evaluate', {
        expression: `(() => {
          const selNode = document.querySelector('.radar-node.selected');
          const selHeader = document.querySelector('.inv-sel-indicator');
          return { hasSelectedClass: !!selNode, headerText: selHeader ? selHeader.textContent.trim() : null };
        })()`,
        returnByValue: true
      });
      const selVal = selCheck.result?.result?.value;
      assert(selVal.hasSelectedClass === true, 'Asset node marked selected with glow ring');
      assert(selVal.headerText && selVal.headerText.includes('ASSET'), 'Top header indicator displays selected ASSET');
    }

    // ========================================================================
    // BACK & ESCAPE NAVIGATION TESTING
    // ========================================================================
    console.log('\n[7/10] VERIFYING HIERARCHICAL ESCAPE NAVIGATION & BACK BUTTONS');
    // Test Back button
    const backBtnRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('.inv-back-btn');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      returnByValue: true
    });
    assert(backBtnRes.result?.result?.value === true, 'Clicked Back to Incidents button (.inv-back-btn)');
    await new Promise(r => setTimeout(r, 1200));

    // Re-enter Investigation Hub
    console.log('[8/10] Re-entering Investigation Hub with Key 2...');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
    await new Promise(r => setTimeout(r, 1500));

    // Test Escape key navigation back to Spatial Hub
    console.log('[9/10] Pressing Escape key to navigate back to Spatial Hub...');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise(r => setTimeout(r, 1500));

    const escCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const wrapper = document.querySelector('.soc-spatial-wrapper');
        const stage = document.querySelector('.soc-spatial-stage');
        return {
          wrapperClass: wrapper ? wrapper.className : null,
          isHub: wrapper ? wrapper.classList.contains('mode-hub') : false,
          hasStage: !!stage
        };
      })()`,
      returnByValue: true
    });
    const escVal = escCheck.result?.result?.value;
    console.log('  State after Escape:', JSON.stringify(escVal));
    assert(escVal.isHub === true, 'Escape successfully returned application to root Spatial Hub (mode-hub)');

    console.log('\n[10/10] ===============================================================');
    console.log('✅ ALL THREE GRAPH SCREENS VERIFIED & CAPTURED WITH 100% SUCCESS!');
    console.log('======================================================================');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

runStage1Verification().catch(e => {
  console.error('Stage 1 verification failed:', e);
  process.exit(1);
});

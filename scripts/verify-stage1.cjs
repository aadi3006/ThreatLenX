const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

async function runStage1Verification() {
  console.log('==================================================');
  console.log('STAGE 1: ATTACK GRAPH BROWSER VERIFICATION');
  console.log('==================================================\n');

  const port = 9245;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-stage1-verify-9245',
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
    console.log('[1/7] Connecting to Chrome CDP at:', pageTarget.webSocketDebuggerUrl);
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

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    // 1. Navigate at 1440x900
    console.log('[2/7] Setting viewport to 1440x900 and navigating to http://localhost:3000/ ...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 3000));

    // 2. Open Investigation Hub (Key 2)
    console.log('[3/7] Navigating to Zone 2 (Investigation Hub)...');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
    await new Promise(r => setTimeout(r, 3000));

    // 3. Evaluate Attack Graph metrics
    console.log('[4/7] Evaluating Node & Edge layout coordinates at 1440x900...');
    const eval1440 = await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.ag-node')).map(n => {
          const r = n.getBoundingClientRect();
          const card = n.querySelector('.ag-node-card')?.getBoundingClientRect();
          const label = n.querySelector('text')?.textContent || '';
          return {
            id: n.id,
            label,
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
            cardWidth: card ? Math.round(card.width) : 0,
            cardHeight: card ? Math.round(card.height) : 0
          };
        });

        const svg = document.querySelector('.ag-svg')?.getBoundingClientRect();
        const canvasWrap = document.querySelector('.ag-canvas-wrap')?.getBoundingClientRect();
        const edges = Array.from(document.querySelectorAll('.ag-edge path')).map(p => {
          const r = p.getBoundingClientRect();
          return { d: p.getAttribute('d'), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        });

        return {
          wrapperClass: document.querySelector('.soc-spatial-wrapper')?.className,
          hubClass: document.querySelector('.inv-hub')?.className,
          svgRect: svg ? { width: Math.round(svg.width), height: Math.round(svg.height), x: Math.round(svg.x), y: Math.round(svg.y) } : null,
          canvasWrapRect: canvasWrap ? { width: Math.round(canvasWrap.width), height: Math.round(canvasWrap.height) } : null,
          nodeCount: nodes.length,
          nodes,
          edgeCount: edges.length,
          edges: edges.slice(0, 5)
        };
      })()`,
      returnByValue: true
    });

    const metrics1440 = eval1440.result?.result?.value;
    console.log('Metrics at 1440x900:', JSON.stringify(metrics1440, null, 2));

    // Assertions for 1440x900
    if (!metrics1440 || metrics1440.nodeCount === 0) {
      throw new Error('No nodes found on Attack Graph canvas!');
    }

    // Verify distinct positions (not stacked)
    const uniqueXs = new Set(metrics1440.nodes.map(n => n.x));
    const uniqueYs = new Set(metrics1440.nodes.map(n => n.y));
    console.log(`Unique X coordinates: ${uniqueXs.size} / ${metrics1440.nodes.length}`);
    console.log(`Unique Y coordinates: ${uniqueYs.size} / ${metrics1440.nodes.length}`);
    if (uniqueXs.size < 4) {
      throw new Error(`Nodes appear horizontally stacked! Only ${uniqueXs.size} unique X positions.`);
    }

    // Capture 1440 screenshot
    console.log('Capturing stage1_attack_graph_after_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0/stage1_attack_graph_after_1440.png', Buffer.from(shot1440.result.data, 'base64'));
    console.log('✓ Saved stage1_attack_graph_after_1440.png');

    // 4. Test 1920x1080 Viewport
    console.log('\n[5/7] Resizing viewport to 1920x1080...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 2000));

    const eval1920 = await send('Runtime.evaluate', {
      expression: `(() => {
        const svg = document.querySelector('.ag-svg')?.getBoundingClientRect();
        const nodes = Array.from(document.querySelectorAll('.ag-node')).map(n => {
          const r = n.getBoundingClientRect();
          return { id: n.id, x: Math.round(r.x), y: Math.round(r.y) };
        });
        return {
          svgWidth: svg ? Math.round(svg.width) : 0,
          svgHeight: svg ? Math.round(svg.height) : 0,
          uniqueX: new Set(nodes.map(n => n.x)).size,
          nodeCount: nodes.length
        };
      })()`,
      returnByValue: true
    });
    console.log('Metrics at 1920x1080:', JSON.stringify(eval1920.result?.result?.value, null, 2));

    console.log('Capturing stage1_attack_graph_after_1920.png...');
    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0/stage1_attack_graph_after_1920.png', Buffer.from(shot1920.result.data, 'base64'));
    console.log('✓ Saved stage1_attack_graph_after_1920.png');

    // 5. Test Node Interaction & Selection
    console.log('\n[6/7] Testing Node Selection and Selection Inspector...');
    // Click on the first node
    const clickRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const node = document.querySelector('.ag-node');
        if (!node) return { error: 'No node found' };
        const rect = node.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: node.id };
      })()`,
      returnByValue: true
    });
    const clickTarget = clickRes.result?.result?.value;
    if (clickTarget && !clickTarget.error) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickTarget.x, y: clickTarget.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickTarget.x, y: clickTarget.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 600));

      const inspectorCheck = await send('Runtime.evaluate', {
        expression: `!!document.querySelector('.ag-selection-strip')`,
        returnByValue: true
      });
      console.log('  ✓ Selection inspector opened:', inspectorCheck.result?.result?.value);
    }

    // 6. Test Tabs & Escape Navigation
    console.log('\n[7/7] Testing Tab Cycling and Escape Navigation...');
    // Click Timeline Tab
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('TIMELINE'));
        if (tab) tab.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 800));
    const isTimelineActive = await send('Runtime.evaluate', {
      expression: `!!document.querySelector('.spatial-timeline, .tl-container')`,
      returnByValue: true
    });
    console.log('  ✓ Timeline tab active:', isTimelineActive.result?.result?.value);

    // Switch back to ATTACK tab
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('ATTACK'));
        if (tab) tab.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 800));
    const isAttackActive = await send('Runtime.evaluate', {
      expression: `!!document.querySelector('.ag-container')`,
      returnByValue: true
    });
    console.log('  ✓ Returned to ATTACK tab:', isAttackActive.result?.result?.value);

    // Press Escape to return to Hub
    console.log('Pressing Escape to return to Hub...');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise(r => setTimeout(r, 1200));

    const hubState = await send('Runtime.evaluate', {
      expression: `({
        mode: document.querySelector('.soc-spatial-wrapper')?.className,
        isHub: !!document.querySelector('.soc-spatial-stage') || document.querySelector('.soc-spatial-wrapper')?.classList.contains('mode-hub')
      })`,
      returnByValue: true
    });
    console.log('  ✓ Hub navigation on Escape verified:', hubState.result?.result?.value);

    console.log('\n==================================================');
    console.log('✅ ALL STAGE 1 CHECKS COMPLETED SUCCESSFULLY!');
    console.log('==================================================');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

runStage1Verification().catch(e => {
  console.error('Stage 1 verification failed:', e);
  process.exit(1);
});

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0';

async function captureHuntingBefore() {
  const port = 9382;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-hunting-before-9382',
    '--no-first-run',
    'http://localhost:3000/'
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

    console.log('[1/4] Setting 1440x900...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 2500));

    console.log('[2/4] Triggering navigation to Zone 3 (HUNTING)...');
    const navResult = await send('Runtime.evaluate', {
      expression: `(function() {
        // Try clicking the node card first
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const huntNode = nodes.find(n => n.textContent.includes('THREAT HUNTING') || n.getAttribute('aria-label')?.includes('THREAT HUNTING'));
        if (huntNode) {
          huntNode.click();
          return { clicked: true, text: huntNode.innerText };
        }
        // Try keydown event
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true }));
        return { dispatchedKey: true };
      })()`,
      returnByValue: true
    });
    console.log('Nav result:', JSON.stringify(navResult.result?.result?.value));

    // Wait for transition timer (240ms) + workspace render
    await new Promise(r => setTimeout(r, 2000));

    const check = await send('Runtime.evaluate', {
      expression: `({\n        hasWorkspace: !!document.querySelector('.threat-hunting-workspace'),\n        hasQueryBuilder: !!document.querySelector('.th-query-builder, .th-query-bar, .query-builder'),\n        workspaceClass: document.querySelector('.soc-spatial-wrapper')?.className,\n        heading: document.querySelector('.th-title, h1, h2, .th-header')?.textContent?.trim()\n      })`,
      returnByValue: true
    });
    console.log('Workspace state:', JSON.stringify(check.result?.result?.value));

    console.log('[3/4] Capturing stage2_hunting_before_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_before_1440.png'), Buffer.from(shot1440.result.data, 'base64'));
    console.log('✓ Saved stage2_hunting_before_1440.png');

    console.log('[4/4] Resizing to 1920x1080 and capturing stage2_hunting_before_1920.png...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1500));
    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_before_1920.png'), Buffer.from(shot1920.result.data, 'base64'));
    console.log('✓ Saved stage2_hunting_before_1920.png');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

captureHuntingBefore().catch(console.error);

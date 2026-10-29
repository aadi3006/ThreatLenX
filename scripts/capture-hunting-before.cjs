const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0';

async function captureHuntingBefore() {
  const port = 9380;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-hunting-before-9380',
    '--no-first-run',
    'http://localhost:3000/'
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    let pageTarget = null;
    for (let attempts = 0; attempts < 40; attempts++) {
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
        pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
        if (pageTarget) break;
      } catch (err) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (!pageTarget) {
      pageTarget = targets.find(t => t.type === 'page') || targets[0];
    }
    console.log('Using target:', pageTarget.url, pageTarget.webSocketDebuggerUrl);

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

    console.log('[1/4] Setting 1440x900 viewport...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });

    // Poll until hub workspace nodes are rendered
    console.log('Waiting for Hub rendering...');
    for (let i = 0; i < 30; i++) {
      const checkHub = await send('Runtime.evaluate', {
        expression: `document.querySelectorAll('.hub-workspace-node').length`,
        returnByValue: true
      });
      if (checkHub.result?.result?.value > 0) {
        console.log(`Hub loaded with ${checkHub.result.result.value} nodes!`);
        break;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    console.log('[2/4] Triggering navigation to Zone 3 (HUNTING)...');
    const navResult = await send('Runtime.evaluate', {
      expression: `(() => {
        // Dispatch key 3
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true }));
        // Also click node directly
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const huntNode = nodes.find(n => n.textContent.includes('THREAT HUNTING') || n.getAttribute('aria-label')?.includes('THREAT HUNTING'));
        if (huntNode) {
          huntNode.click();
          return { clicked: true, text: huntNode.innerText.replace(/\\n/g, ' ') };
        }
        return { clicked: false, totalNodes: nodes.length };
      })()`,
      returnByValue: true
    });
    console.log('Nav result:', JSON.stringify(navResult.result?.result?.value));

    // Wait for transition timer (240ms) + workspace mount and initial queries
    await new Promise(r => setTimeout(r, 2000));

    const check = await send('Runtime.evaluate', {
      expression: `({
        hasWorkspace: !!document.querySelector('.threat-hunting-workspace'),
        workspaceClass: document.querySelector('.soc-spatial-wrapper')?.className,
        heading: document.querySelector('.th-title, .hunt-panel-header, h1, h2')?.textContent?.trim(),
        resultRowCount: document.querySelectorAll('.th-result-row, tr, .hunt-result-row').length,
        panels: Array.from(document.querySelectorAll('.hunt-panel, .threat-hunting-workspace > *')).map(p => p.className)
      })`,
      returnByValue: true
    });
    console.log('Threat Hunting workspace state:', JSON.stringify(check.result?.result?.value, null, 2));

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

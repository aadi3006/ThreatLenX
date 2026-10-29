const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0';

async function capture() {
  const port = 9348;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-hunting-verify-9348',
    '--no-first-run',
    'http://localhost:3000/'
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    let pageTarget = null;
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
        pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
        if (pageTarget) break;
      } catch (err) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (!pageTarget) {
      throw new Error('Could not find localhost:3000 page target in ' + JSON.stringify(targets));
    }
    console.log('Connected to target:', pageTarget.url, pageTarget.webSocketDebuggerUrl);

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

    let msgId = 1;
    const callbacks = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && callbacks.has(msg.id)) {
        const cb = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        cb(msg);
      }
    });

    const send = (method, params = {}) => new Promise((resolve) => {
      const id = msgId++;
      callbacks.set(id, resolve);
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
    await new Promise(r => setTimeout(r, 2000));

    console.log('[2/4] Triggering navigation to Zone 3 (HUNTING)...');
    const clickRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const huntNode = nodes.find(n => n.textContent.includes('THREAT HUNTING') || n.getAttribute('aria-label')?.includes('THREAT HUNTING'));
        if (huntNode) {
          huntNode.click();
          return { clicked: true, text: huntNode.innerText.replace(/\\n/g, ' ') };
        }
        return { clicked: false, nodeCount: nodes.length };
      })()`,
      returnByValue: true
    });
    console.log('Navigation trigger:', JSON.stringify(clickRes.result?.result?.value));

    // Wait for transition animation and workspace render
    await new Promise(r => setTimeout(r, 2000));

    const wsCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const ws = document.querySelector('.threat-hunting-workspace');
        return {
          found: !!ws,
          classes: ws?.className,
          title: document.querySelector('.th-title, .th-header-title, h1, h2, .th-header')?.innerText?.slice(0, 100),
          columns: Array.from(document.querySelectorAll('.threat-hunting-workspace > *')).map(el => el.className),
          queryCount: document.querySelectorAll('.th-condition-row, .condition-row').length,
          resultRows: document.querySelectorAll('.th-result-row, tr').length
        };
      })()`,
      returnByValue: true
    });
    console.log('Threat Hunting Workspace Check:', JSON.stringify(wsCheck.result?.result?.value, null, 2));

    console.log('[3/4] Capturing stage2_hunting_before_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_before_1440.png'), Buffer.from(shot1440.result.data, 'base64'));
    console.log('✓ Saved stage2_hunting_before_1440.png');

    console.log('[4/4] Setting 1920x1080 and capturing stage2_hunting_before_1920.png...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1200));
    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_before_1920.png'), Buffer.from(shot1920.result.data, 'base64'));
    console.log('✓ Saved stage2_hunting_before_1920.png');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

capture().catch(console.error);

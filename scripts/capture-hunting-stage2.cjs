const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0';

async function runCapture() {
  const port = 9345;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-hunting-stage2-9345',
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
    console.log('[1/5] Connected to Chrome CDP:', pageTarget.webSocketDebuggerUrl);
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

    console.log('[2/5] Navigating to http://localhost:3000/ at 1440x900...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 3000));

    console.log('[3/5] Navigating to Zone 3 (Threat Hunting)...');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51 });
    await new Promise(r => setTimeout(r, 2500));

    // Fallback if not transitioned yet: click the node directly
    await send('Runtime.evaluate', {
      expression: `(() => {
        if (!document.querySelector('.threat-hunting-workspace')) {
          const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
          const hunt = nodes.find(n => n.textContent.includes('THREAT HUNTING'));
          if (hunt) hunt.click();
        }
      })()`
    });
    await new Promise(r => setTimeout(r, 1500));

    const evalCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const ws = document.querySelector('.threat-hunting-workspace');
        return {
          found: !!ws,
          classes: ws ? ws.className : null,
          title: document.querySelector('.hunt-panel-header, .th-header, h1, h2')?.textContent,
          panels: Array.from(document.querySelectorAll('.hunt-panel')).map(p => p.className),
          knownTag: document.querySelector('.tag-known')?.textContent,
          unknownTag: document.querySelector('.tag-unknown')?.textContent,
          templatesCount: document.querySelectorAll('.hunt-template-card').length,
          canvasRect: (() => {
            const c = document.querySelector('.hunt-field-canvas');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
          })(),
          queryColRect: (() => {
            const q = document.querySelector('.hunt-query-col');
            if (!q) return null;
            const r = q.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
          })(),
          inspectorRect: (() => {
            const i = document.querySelector('.hunt-inspector-col');
            if (!i) return null;
            const r = i.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
          })(),
          resultsRowRect: (() => {
            const rRow = document.querySelector('.hunt-results-row');
            if (!rRow) return null;
            const r = rRow.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
          })()
        };
      })()`,
      returnByValue: true
    });
    console.log('Threat Hunting Workspace Status:\n', JSON.stringify(evalCheck.result?.result?.value, null, 2));

    console.log('[4/5] Capturing stage2_hunting_before_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_before_1440.png'), Buffer.from(shot1440.result.data, 'base64'));
    console.log('✓ Saved stage2_hunting_before_1440.png');

    console.log('[5/5] Resizing to 1920x1080 and capturing stage2_hunting_before_1920.png...');
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

runCapture().then(() => {
  console.log('STAGE 2 BEFORE CAPTURE COMPLETE!');
  process.exit(0);
}).catch((err) => {
  console.error('Error in runCapture:', err);
  process.exit(1);
});

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0';

async function testNav() {
  const port = 9386;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-test-nav-9386',
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

    console.log('[1/4] Navigating to http://localhost:3000/ at 1440x900...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 2500));

    console.log('[2/4] Triggering navigation to Zone 3 (HUNTING)...');
    const clickRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const hunt = nodes.find(n => n.textContent.includes('THREAT HUNTING'));
        if (hunt) {
          hunt.click();
          return { clicked: true, text: hunt.textContent };
        }
        return { clicked: false, nodeCount: nodes.length };
      })()`,
      returnByValue: true
    });
    console.log('Click result:', JSON.stringify(clickRes.result?.result?.value));

    await new Promise(r => setTimeout(r, 2000));

    const check = await send('Runtime.evaluate', {
      expression: `(() => {
        const ws = document.querySelector('.threat-hunting-workspace');
        return {
          foundWorkspace: !!ws,
          classes: ws ? ws.className : null,
          title: document.querySelector('.th-title, .th-header-title, h1, h2')?.textContent,
          columns: Array.from(document.querySelectorAll('.threat-hunting-workspace > *')).map(el => el.className),
          childrenCount: ws ? ws.childElementCount : 0
        };
      })()`,
      returnByValue: true
    });
    console.log('Check result:', JSON.stringify(check.result?.result?.value, null, 2));

    if (check.result?.result?.value?.foundWorkspace) {
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
    }

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

testNav().catch(console.error);

/**
 * scripts/capture-command-before.cjs
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_DIR = path.join(__dirname, '../docs/screenshots');

async function captureBefore() {
  const port = 9580;
  const profileDir = `/tmp/threatlenx-chrome-before-${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });

  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
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
      } catch {}
    }

    const pageTarget = targets.find(t => t.type === 'page');
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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
        } catch (e) {
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

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('[BEFORE] Setting 1440x900 viewport & navigating to http://127.0.0.1:3000/...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    ws.send(JSON.stringify({ id: msgId++, method: 'Page.navigate', params: { url: 'http://127.0.0.1:3000/' } }));

    // Poll for hub nodes
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      const count = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (count === 6) break;
    }
    await new Promise(r => setTimeout(r, 1200));

    // Click COMMAND CENTER
    await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const target = nodes.find(n => n.textContent && n.textContent.includes('COMMAND CENTER'));
        if (target) target.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1500));

    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.data, 'base64');
    fs.writeFileSync(path.join(DOCS_DIR, 'stage5_command_before_1440.png'), buf1440);
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage5_command_before_1440.png'), buf1440);
    console.log(`✓ Saved stage5_command_before_1440.png (${buf1440.length} bytes)`);

    console.log('[BEFORE] Resizing to 1920x1080...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 800));

    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.data, 'base64');
    fs.writeFileSync(path.join(DOCS_DIR, 'stage5_command_before_1920.png'), buf1920);
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage5_command_before_1920.png'), buf1920);
    console.log(`✓ Saved stage5_command_before_1920.png (${buf1920.length} bytes)`);

  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

captureBefore().catch(console.error);

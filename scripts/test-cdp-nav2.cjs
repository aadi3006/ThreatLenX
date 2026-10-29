const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

async function test() {
  const port = 9352;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-test-raw-9352',
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

    await send('Runtime.enable');
    console.log('Navigating via location.href...');
    await send('Runtime.evaluate', { expression: `window.location.href = 'http://localhost:3000/'` });
    
    // Poll for .hub-workspace-node
    console.log('Waiting for .hub-workspace-node...');
    let found = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 300));
      const res = await send('Runtime.evaluate', {
        expression: `document.querySelectorAll('.hub-workspace-node').length`,
        returnByValue: true
      });
      if (res.result?.result?.value > 0) {
        found = true;
        console.log(`Found ${res.result.result.value} hub nodes at attempt ${i}!`);
        break;
      }
    }

    if (found) {
      console.log('Clicking HUNTING node...');
      const clickRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
          const hunt = nodes.find(n => n.textContent.includes('THREAT HUNTING'));
          if (hunt) {
            hunt.click();
            return { clicked: true, text: hunt.textContent };
          }
          return { clicked: false };
        })()`,
        returnByValue: true
      });
      console.log('Click res:', JSON.stringify(clickRes.result?.result?.value));

      await new Promise(r => setTimeout(r, 1500));

      const huntingCheck = await send('Runtime.evaluate', {
        expression: `(() => {
          const ws = document.querySelector('.threat-hunting-workspace');
          return {
            hasWorkspace: !!ws,
            title: document.querySelector('.th-title, .hunt-panel-header, h1, h2')?.textContent,
            panels: Array.from(document.querySelectorAll('.hunt-panel, .threat-hunting-workspace > div')).map(d => d.className)
          };
        })()`,
        returnByValue: true
      });
      console.log('Hunting check:', JSON.stringify(huntingCheck.result?.result?.value, null, 2));
    }

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

test().catch(console.error);

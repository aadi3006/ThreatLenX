const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

async function testRadar() {
  const port = 9335;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-test-radar-9335',
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
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 2500));

    // Press '2' to go to Investigation
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
    await new Promise(r => setTimeout(r, 2500));

    // Click 'SYSTEM RADAR' tab
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('SYSTEM'));
        if (tab) {
          tab.click();
          return 'Clicked SYSTEM RADAR tab';
        }
        return 'SYSTEM RADAR tab not found';
      })()`,
      returnByValue: true
    });
    await new Promise(r => setTimeout(r, 1500));

    const radarMetrics = await send('Runtime.evaluate', {
      expression: `(() => {
        const container = document.querySelector('.radar-container');
        const svg = document.querySelector('.radar-svg');
        const svgRect = svg ? svg.getBoundingClientRect() : null;
        const nodes = Array.from(document.querySelectorAll('.radar-node')).map(n => {
          const r = n.getBoundingClientRect();
          const text = n.textContent.trim();
          return { text, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        });
        const rings = document.querySelectorAll('.radar-ring');
        const sweep = document.querySelector('.radar-sweep-arm');
        return {
          hasContainer: !!container,
          svgRect: svgRect ? { width: Math.round(svgRect.width), height: Math.round(svgRect.height), x: Math.round(svgRect.x), y: Math.round(svgRect.y) } : null,
          nodeCount: nodes.length,
          uniqueX: new Set(nodes.map(n => n.x)).size,
          uniqueY: new Set(nodes.map(n => n.y)).size,
          nodes,
          ringsCount: rings.length,
          hasSweepArm: !!sweep
        };
      })()`,
      returnByValue: true
    });
    console.log('\nSystem Radar metrics:', JSON.stringify(radarMetrics.result?.result?.value, null, 2));

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

testRadar().catch(console.error);

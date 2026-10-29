const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

async function testGraphs() {
  const port = 9334;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-test-three-graphs-9334',
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

    // Check available tabs
    const tabs = await send('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('.inv-tab')).map(t => t.textContent.trim())`,
      returnByValue: true
    });
    console.log('Available tabs in InvestigationHub:', tabs.result?.result?.value);

    // 1. Attack Graph check
    const agNodes = await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.ag-node')).map(n => {
          const r = n.getBoundingClientRect();
          return { id: n.id, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        });
        return { count: nodes.length, uniqueX: new Set(nodes.map(n => n.x)).size, uniqueY: new Set(nodes.map(n => n.y)).size, nodes: nodes.slice(0, 4) };
      })()`,
      returnByValue: true
    });
    console.log('\nAttack Graph bounding metrics:', JSON.stringify(agNodes.result?.result?.value, null, 2));

    // 2. Click IOC tab
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('IOC'));
        if (tab) tab.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1500));

    const iocMetrics = await send('Runtime.evaluate', {
      expression: `(() => {
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
          iocCount: iocNodes.length,
          uniqueIocX: new Set(iocNodes.map(n => n.x)).size,
          uniqueIocY: new Set(iocNodes.map(n => n.y)).size,
          iocNodes,
          entityCount: entityNodes.length,
          uniqueEntityX: new Set(entityNodes.map(n => n.x)).size,
          entityNodes,
          linkCount: links.length,
          links: links.slice(0, 3)
        };
      })()`,
      returnByValue: true
    });
    console.log('\nIOC Constellation bounding metrics:', JSON.stringify(iocMetrics.result?.result?.value, null, 2));

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

testGraphs().catch(console.error);

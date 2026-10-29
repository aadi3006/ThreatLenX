const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

async function debugDom() {
  const port = 9384;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-debug-dom-9384',
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
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

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
      } catch (e) {}
    });

    const send = (method, params = {}) => new Promise((resolve) => {
      const id = msgId++;
      pendingCallbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 2500));

    const domInfo = await send('Runtime.evaluate', {
      expression: `(function() {
        return {
          buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText || b.className),
          nodes: Array.from(document.querySelectorAll('.hub-workspace-node, [class*="node"], [class*="hub"]')).map(n => ({
            tag: n.tagName,
            cls: n.className,
            text: n.innerText?.slice(0, 50),
            role: n.getAttribute('role'),
            aria: n.getAttribute('aria-label')
          })),
          rootClasses: document.body.className,
          firstLevelChildren: Array.from(document.body.children).map(c => c.className || c.tagName)
        };
      })()`,
      returnByValue: true
    });
    console.log('DOM info:', JSON.stringify(domInfo.result?.result?.value, null, 2));

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

debugDom().catch(console.error);

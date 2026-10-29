const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

async function inspect() {
  const port = 9340;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-inspect-9340',
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
    // Wait for hydration
    await new Promise(r => setTimeout(r, 3000));

    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node, [role="button"], button')).map(el => ({
          tag: el.tagName,
          className: el.className,
          text: el.innerText.trim(),
          aria: el.getAttribute('aria-label')
        }));
        return {
          url: window.location.href,
          title: document.title,
          nodesCount: nodes.length,
          nodes: nodes
        };
      })()`,
      returnByValue: true
    });

    console.log('Page Inspection Result:\n', JSON.stringify(res.result?.result?.value, null, 2));

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

inspect().catch(console.error);

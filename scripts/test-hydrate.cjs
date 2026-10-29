const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

async function test() {
  const port = 9355;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-test-hydrate-9355',
    '--no-first-run',
    'http://localhost:3000/'
  ], { stdio: 'ignore' });

  try {
    console.log('Waiting 4s for Chrome and React hydration...');
    await new Promise(r => setTimeout(r, 4000));

    let targets = await new Promise((res, rej) => {
      http.get(`http://127.0.0.1:${port}/json`, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });

    const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
    console.log('Page target found:', pageTarget.url, pageTarget.webSocketDebuggerUrl);

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

    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        return {
          title: document.title,
          nodes: Array.from(document.querySelectorAll('.hub-workspace-node')).map(n => n.innerText.trim().replace(/\\n/g, ' ')),
          bodyPreview: document.body.innerText.slice(0, 200)
        };
      })()`,
      returnByValue: true
    });
    console.log('Result:\n', JSON.stringify(res.result?.result?.value, null, 2));

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

test().catch(console.error);

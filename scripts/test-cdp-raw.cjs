const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

async function test() {
  const port = 9350;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-test-raw-9350',
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
    console.log('Target found:', pageTarget.webSocketDebuggerUrl);
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

    ws.on('message', (raw) => {
      const str = raw.toString();
      const obj = JSON.parse(str);
      if (obj.id) console.log('RESPONSE ID:', obj.id, obj.error ? 'ERROR: ' + JSON.stringify(obj.error) : 'OK');
      else console.log('EVENT:', obj.method);
    });

    console.log('Sending Page.enable (id 1)...');
    ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
    await new Promise(r => setTimeout(r, 500));

    console.log('Sending Page.navigate (id 2)...');
    ws.send(JSON.stringify({ id: 2, method: 'Page.navigate', params: { url: 'http://localhost:3000/' } }));
    await new Promise(r => setTimeout(r, 3000));

    console.log('Sending Runtime.evaluate (id 3)...');
    ws.send(JSON.stringify({ id: 3, method: 'Runtime.evaluate', params: { expression: 'document.title' } }));
    await new Promise(r => setTimeout(r, 1000));

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

test().catch(console.error);

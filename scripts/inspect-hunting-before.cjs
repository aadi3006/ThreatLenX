const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity-ide/brain/aedfe23e-32b2-4a37-b568-93027fdbe2b0';

async function runAudit() {
  const port = 9365;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-hunting-audit-9365',
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

    console.log('[2/4] Navigating to HUNTING workspace (Key H)...');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72 });
    await new Promise(r => setTimeout(r, 2000));

    // Fallback: if not loaded yet, click the HUNTING card in Hub
    await send('Runtime.evaluate', {
      expression: `(() => {
        if (!document.querySelector('.threat-hunting-workspace')) {
          const huntCard = Array.from(document.querySelectorAll('.hub-card')).find(c => c.textContent.includes('THREAT HUNTING'));
          if (huntCard) huntCard.click();
        }
      })()`
    });
    await new Promise(r => setTimeout(r, 1500));

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

    // Collect DOM metrics for layout audit
    const layout = await send('Runtime.evaluate', {
      expression: `(() => {
        const ws = document.querySelector('.threat-hunting-workspace');
        if (!ws) return { error: 'Threat Hunting workspace not found in DOM' };
        
        const wsRect = ws.getBoundingClientRect();
        
        // Find panels/sections
        const sections = Array.from(ws.querySelectorAll('.th-header, .th-nav-tabs, .th-controls, .th-query-bar, .th-main-grid, .th-left-col, .th-right-col, .th-results-panel, .th-inspector-panel, .th-results-table, .th-timeline-container, .th-card')).map(el => {
          const r = el.getBoundingClientRect();
          const comp = window.getComputedStyle(el);
          return {
            className: el.className,
            tag: el.tagName,
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
            scrollWidth: el.scrollWidth,
            scrollHeight: el.scrollHeight,
            overflowX: comp.overflowX,
            overflowY: comp.overflowY,
            isHorizOverflow: el.scrollWidth > el.clientWidth + 2,
            isVertOverflow: el.scrollHeight > el.clientHeight + 2
          };
        });

        // Check for text overflowing or clipped
        const clipped = [];
        ws.querySelectorAll('*').forEach(el => {
          if (el.children.length === 0 && el.textContent.trim().length > 3) {
            if (el.scrollWidth > el.clientWidth + 2) {
              clipped.push({
                tag: el.tagName,
                className: el.className,
                text: el.textContent.trim().slice(0, 30),
                clientWidth: el.clientWidth,
                scrollWidth: el.scrollWidth
              });
            }
          }
        });

        return {
          workspaceBounds: { width: Math.round(wsRect.width), height: Math.round(wsRect.height) },
          sections,
          clippedText: clipped
        };
      })()`,
      returnByValue: true
    });

    console.log('\n--- THREAT HUNTING WORKSPACE AUDIT METRICS ---');
    console.log(JSON.stringify(layout.result?.result?.value, null, 2));

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

runAudit().catch(console.error);

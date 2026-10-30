/**
 * scripts/test-command-interactions.cjs
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

async function testInteractions() {
  const port = 9570;
  const profileDir = `/tmp/threatlenx-chrome-test-cmd-interact-${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });

  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-proxy-server',
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

    const pressKey = async (key) => {
      await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', code: '${key}', bubbles: true, cancelable: true }))`);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
    await new Promise(r => setTimeout(r, 2000));

    console.log('[1] Navigate from Hub to COMMAND');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('COMMAND CENTER'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    // Verify Command Center overview is open
    const overviewCheck = await evalJson(`(() => {
      const hasUniverse = !!document.querySelector('.inc-universe');
      const hasFlanks = !!document.querySelector('.soc-left-flank');
      const hasFocusOverlay = !!document.querySelector('.inc-focus-overlay');
      const nodeCount = document.querySelectorAll('.inc-node').length;
      return { hasUniverse, hasFlanks, hasFocusOverlay, nodeCount };
    })()`);
    console.log('[1 RESULT] Command Center Overview Open:', overviewCheck);

    console.log('[2] Selecting incident INC-001 (Operation BlackTide)');
    // Click incident node or card
    await evalJson(`(() => {
      const card = document.querySelector('.command-incident-card') || document.querySelector('.inc-node');
      if (card) card.click();
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    const focusCheck = await evalJson(`(() => {
      const hasFocusOverlay = !!document.querySelector('.inc-focus-overlay');
      const hasInvHub = !!document.querySelector('.inv-hub');
      const title = document.querySelector('.inv-incident-title')?.textContent?.trim();
      const activeTab = document.querySelector('.inv-view-tab.active')?.textContent?.trim();
      return { hasFocusOverlay, hasInvHub, title, activeTab };
    })()`);
    console.log('[2 RESULT] Investigation Hub Opened:', focusCheck);

    console.log('[3] Testing Escape / Exit Focus to return to Command Center Overview');
    await evalJson(`(() => {
      const exitBtn = document.querySelector('.inv-exit-btn') || document.querySelector('button[aria-label*="Spatial Hub"]');
      if (exitBtn) exitBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    const returnCheck = await evalJson(`(() => {
      const hasFocusOverlay = !!document.querySelector('.inc-focus-overlay');
      const hasFlanks = !!document.querySelector('.soc-left-flank');
      const hasUniverse = !!document.querySelector('.inc-universe');
      const navState = window.__socNavStore ? window.__socNavStore.getState() : null;
      return { hasFocusOverlay, hasFlanks, hasUniverse, navState };
    })()`);
    console.log('[3 RESULT] Return to Command Center Overview:', returnCheck);

  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

testInteractions().catch(console.error);

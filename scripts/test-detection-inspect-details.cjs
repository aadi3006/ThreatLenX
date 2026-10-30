/**
 * scripts/test-detection-inspect-details.cjs
 *
 * Detailed inspection of tabs, simulation results, edit mode, and filters.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

async function testDetails() {
  const port = 9596;
  const profileDir = `/tmp/threatlenx-chrome-det-details-${Date.now()}`;
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

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('[1] Setting 1440x900 and navigating...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
    await new Promise(r => setTimeout(r, 2500));

    console.log('[2] Navigating to DETECTION workspace...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('DETECTION'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // Test Simulation button click
    console.log('[3] Running Simulation test...');
    const simClickRes = await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Run Simulation Test'));
      if (btn) {
        btn.click();
        return 'clicked run simulation';
      }
      return 'button not found';
    })()`);
    console.log('Simulation click:', simClickRes);
    await new Promise(r => setTimeout(r, 1500));

    const simState = await evalJson(`(() => {
      const grid = document.querySelector('.sim-grid');
      if (!grid) return { rendered: false };
      const metrics = Array.from(grid.querySelectorAll('.sim-metric-box')).map(m => ({
        val: m.querySelector('.sim-metric-val')?.textContent?.trim(),
        label: m.querySelector('.sim-metric-label')?.textContent?.trim()
      }));
      const explanations = Array.from(grid.querySelectorAll('div[style*="border-radius"]')).map(e => e.textContent.trim().replace(/\\s+/g, ' '));
      return {
        rendered: true,
        metrics,
        explanationCount: explanations.length
      };
    })()`);
    console.log('Simulation results in DOM:', JSON.stringify(simState, null, 2));

    // Test Versions Tab
    console.log('[4] Clicking Versions tab...');
    await evalJson(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const vBtn = btns.find(b => b.textContent && b.textContent.includes('Versions'));
      if (vBtn) vBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const versionsState = await evalJson(`(() => {
      const items = Array.from(document.querySelectorAll('.diff-item')).map(d => d.textContent.trim().replace(/\\s+/g, ' '));
      return { versionItemCount: items.length, items };
    })()`);
    console.log('Versions tab state:', JSON.stringify(versionsState, null, 2));

    // Test Diff Tab
    console.log('[5] Clicking Diff tab...');
    await evalJson(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const dBtn = btns.find(b => b.textContent && b.textContent.trim() === 'Diff');
      if (dBtn) dBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const diffState = await evalJson(`(() => {
      const panel = document.querySelectorAll('.det-panel')[2];
      return panel ? panel.textContent.trim().replace(/\\s+/g, ' ') : null;
    })()`);
    console.log('Diff tab state:', diffState);

    // Switch back to Inspector tab
    console.log('[6] Returning to Inspector tab...');
    await evalJson(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const iBtn = btns.find(b => b.textContent && b.textContent.trim() === 'Inspector');
      if (iBtn) iBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    // Test Edit Rule button
    console.log('[7] Clicking Edit Rule button...');
    await evalJson(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const eBtn = btns.find(b => b.textContent && b.textContent.includes('Edit Rule'));
      if (eBtn) eBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const editState = await evalJson(`(() => {
      const inputs = Array.from(document.querySelectorAll('.det-input')).map(i => ({
        tagName: i.tagName,
        placeholder: i.getAttribute('placeholder'),
        value: i.value ? i.value.slice(0, 30) : null
      }));
      return { inputCount: inputs.length, inputs };
    })()`);
    console.log('Edit state:', JSON.stringify(editState, null, 2));

  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

testDetails().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

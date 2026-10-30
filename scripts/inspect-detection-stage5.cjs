/**
 * scripts/inspect-detection-stage5.cjs
 *
 * Stage 5 Detection Rules Inspection & BEFORE screenshot capture.
 * Captures screenshots at 1440x900 and 1920x1080 (100% zoom).
 * Audits layout geometry, text clipping, overflow, scrolling, and IDB preservation.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_DIR = path.join(__dirname, '../docs/screenshots');

async function inspectDetectionRules() {
  const port = 9594;
  const profileDir = `/tmp/threatlenx-chrome-det-inspect-${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });

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

    const evalAsync = async (expr) => {
      const resp = await send('Runtime.evaluate', {
        expression: `(async () => { return JSON.stringify(await (${expr})); })()`,
        awaitPromise: true,
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
    await send('DOM.enable');

    console.log('[1/7] Setting 1440x900 viewport & navigating to http://127.0.0.1:3000/...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
    await new Promise(r => setTimeout(r, 2500));

    // Audit IDB before
    const idbBefore = await evalAsync(`new Promise((resolve) => {
      try {
        const timeout = setTimeout(() => resolve({ error: 'IDB timeout' }), 4000);
        const req = indexedDB.open('es-spatial-db');
        req.onsuccess = (e) => {
          clearTimeout(timeout);
          const db = e.target.result;
          const names = Array.from(db.objectStoreNames).sort();
          const rep = {};
          if (names.length === 0) return resolve(rep);
          const tx = db.transaction(names, 'readonly');
          let pending = names.length;
          names.forEach(n => {
            const st = tx.objectStore(n);
            const cr = st.count();
            cr.onsuccess = () => {
              rep[n] = cr.result;
              if (--pending === 0) resolve(rep);
            };
            cr.onerror = () => {
              rep[n] = -1;
              if (--pending === 0) resolve(rep);
            };
          });
        };
        req.onerror = () => {
          clearTimeout(timeout);
          resolve({ error: 'IDB open error' });
        };
      } catch (e) {
        resolve({ error: e.message });
      }
    })`);
    console.log('[2/7] Stored IndexedDB Store Counts Before:', idbBefore ? Object.keys(idbBefore).length : 0);

    // Click node 6 (DETECTION RULES)
    console.log('[3/7] Clicking DETECTION RULES node...');
    const clickResult = await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('DETECTION'));
      if (target) {
        target.click();
        return 'clicked: ' + target.textContent.trim().replace(/\\s+/g, ' ');
      }
      return 'not found';
    })()`);
    console.log('[3/7] Hub zone result:', clickResult);
    await new Promise(r => setTimeout(r, 1500));

    // Audit Detection Workspace layout at 1440x900
    const layout1440 = await evalJson(`(() => {
      const ws = document.querySelector('.detection-workspace');
      if (!ws) return { error: 'detection-workspace not rendered' };

      const rect = ws.getBoundingClientRect();
      const computedWs = window.getComputedStyle(ws);

      const panels = Array.from(ws.querySelectorAll('.det-panel')).map((p, idx) => {
        const r = p.getBoundingClientRect();
        const header = p.querySelector('.det-panel-header');
        const content = p.querySelector('.det-panel-content');
        return {
          index: idx,
          top: Math.round(r.top),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
          headerText: header ? header.textContent.trim().replace(/\\s+/g, ' ') : null,
          contentScrollHeight: content ? content.scrollHeight : null,
          contentClientHeight: content ? content.clientHeight : null,
          hasScrollbar: content ? content.scrollHeight > content.clientHeight : false
        };
      });

      const ruleCards = Array.from(ws.querySelectorAll('.det-rule-card')).map(card => {
        const r = card.getBoundingClientRect();
        const titleEl = card.querySelector('.det-rule-title');
        return {
          id: card.querySelector('span')?.textContent?.trim(),
          title: titleEl?.textContent?.trim(),
          selected: card.classList.contains('selected'),
          width: Math.round(r.width),
          height: Math.round(r.height),
          titleScrollWidth: titleEl ? titleEl.scrollWidth : 0,
          titleClientWidth: titleEl ? titleEl.clientWidth : 0,
          titleClipped: titleEl ? titleEl.scrollWidth > titleEl.clientWidth : false
        };
      });

      // Check condition rows
      const conditionRows = Array.from(ws.querySelectorAll('.condition-row')).map(r => ({
        field: r.querySelector('.condition-field')?.textContent?.trim(),
        op: r.querySelector('.condition-op')?.textContent?.trim(),
        val: r.querySelector('.condition-val')?.textContent?.trim(),
        width: Math.round(r.getBoundingClientRect().width),
        scrollWidth: r.scrollWidth,
        overflowing: r.scrollWidth > r.clientWidth
      }));

      // Check buttons
      const buttons = Array.from(ws.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim().replace(/\\s+/g, ' '),
        width: Math.round(b.getBoundingClientRect().width),
        height: Math.round(b.getBoundingClientRect().height)
      }));

      // Check canvas nodes
      const canvasNodes = Array.from(ws.querySelectorAll('.canvas-node')).map(n => {
        const r = n.getBoundingClientRect();
        return {
          header: n.querySelector('.canvas-node-header')?.textContent?.trim().replace(/\\s+/g, ' '),
          width: Math.round(r.width),
          height: Math.round(r.height),
          scrollWidth: n.scrollWidth,
          overflowing: n.scrollWidth > n.clientWidth
        };
      });

      return {
        workspace: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          padding: computedWs.padding,
          gridTemplateColumns: computedWs.gridTemplateColumns,
          gridTemplateRows: computedWs.gridTemplateRows
        },
        panelCount: panels.length,
        panels,
        ruleCount: ruleCards.length,
        selectedRule: ruleCards.find(r => r.selected)?.title,
        conditionRowCount: conditionRows.length,
        canvasNodeCount: canvasNodes.length,
        buttonCount: buttons.length
      };
    })()`);
    console.log('[4/7] Detection Workspace Audit (1440x900):', JSON.stringify(layout1440, null, 2));

    // Capture 1440x900 BEFORE
    console.log('[5/7] Capturing 1440x900 BEFORE screenshot...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const shot1440Path = path.join(DOCS_DIR, 'stage5_detection_before_1440.png');
    const art1440Path = path.join(ARTIFACT_DIR, 'stage5_detection_before_1440.png');
    fs.writeFileSync(shot1440Path, Buffer.from(shot1440.data, 'base64'));
    fs.writeFileSync(art1440Path, Buffer.from(shot1440.data, 'base64'));
    console.log('✓ Saved 1440x900 before screenshot to:', shot1440Path);

    // Switch to 1920x1080
    console.log('[6/7] Switching to 1920x1080 viewport & capturing BEFORE screenshot...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1200));

    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const shot1920Path = path.join(DOCS_DIR, 'stage5_detection_before_1920.png');
    const art1920Path = path.join(ARTIFACT_DIR, 'stage5_detection_before_1920.png');
    fs.writeFileSync(shot1920Path, Buffer.from(shot1920.data, 'base64'));
    fs.writeFileSync(art1920Path, Buffer.from(shot1920.data, 'base64'));
    console.log('✓ Saved 1920x1080 before screenshot to:', shot1920Path);

    console.log('[7/7] Inspection complete.');
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

inspectDetectionRules().catch(err => {
  console.error('Inspection failed:', err);
  process.exit(1);
});

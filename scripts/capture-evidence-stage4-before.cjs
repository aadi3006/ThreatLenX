/**
 * capture-evidence-stage4-before.cjs
 *
 * Captures BEFORE screenshots and measures layout issues in Evidence Vault Workspace.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_SCREENSHOTS = path.join(__dirname, '../docs/screenshots');

async function captureStage4Before() {
  const port = 9425;
  const profileDir = '/tmp/threatlenx-chrome-profile-stage4-before';
  
  console.log(`[INIT] Launching Headless Chrome on port ${port}...`);
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
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
    console.log('[CONNECT] Connected to page target:', pageTarget.webSocketDebuggerUrl);
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
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
      const val = resp?.result?.value;
      if (val === undefined) return null;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    console.log('[1/5] Setting 1440x900 viewport & navigating to http://127.0.0.1:3000/...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    ws.send(JSON.stringify({ id: msgId++, method: 'Page.navigate', params: { url: 'http://127.0.0.1:3000/' } }));

    // Poll for 6 hub nodes
    console.log('[2/5] Waiting for React hydration on Spatial Command Hub...');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hubCount = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (hubCount === 6) {
        console.log(`✓ Spatial Hub hydrated with 6 zone nodes at poll ${i}!`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 4500));

    // Inspect IDB
    const idbBefore = await evalJson(`new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('IDB open timed out')), 5000);
      const req = indexedDB.open('es-spatial-db');
      req.onsuccess = (e) => {
        clearTimeout(timeout);
        const db = e.target.result;
        const names = Array.from(db.objectStoreNames).sort();
        const report = {};
        if (names.length === 0) return resolve(report);
        const tx = db.transaction(names, 'readonly');
        let pending = names.length;
        names.forEach(name => {
          const store = tx.objectStore(name);
          const cr = store.count();
          cr.onsuccess = () => {
            report[name] = cr.result;
            if (--pending === 0) resolve(report);
          };
          cr.onerror = () => {
            if (--pending === 0) resolve(report);
          };
        });
      };
      req.onerror = () => {
        clearTimeout(timeout);
        reject(req.error);
      };
    })`);
    console.log(`✓ IndexedDB es-spatial-db verified (${Object.keys(idbBefore || {}).length} object stores).`);
    console.log(`  Evidence records: ${idbBefore?.evidence ?? 'N/A'}, Cases: ${idbBefore?.cases ?? 'N/A'}, Custody: ${idbBefore?.evidence_custody ?? 'N/A'}`);

    // Navigate to EVIDENCE workspace
    console.log('[3/5] Navigating to EVIDENCE workspace...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const evdNode = nodes.find(n => n.textContent && n.textContent.includes('EVIDENCE')) || nodes[4];
      if (evdNode) evdNode.click();
      return true;
    })()`);

    let evdMounted = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const mounted = await evalJson(`!!document.querySelector('.evidence-workspace')`);
      if (mounted) {
        evdMounted = true;
        console.log(`✓ EvidenceWorkspace mounted at attempt ${i}!`);
        break;
      }
    }
    if (!evdMounted) {
      throw new Error('EvidenceWorkspace failed to mount');
    }
    await new Promise(r => setTimeout(r, 1200));

    // Audit layout at 1440x900
    const audit1440 = await evalJson(`(() => {
      const ws = document.querySelector('.evidence-workspace');
      const topBar = document.querySelector('.evidence-top-bar');
      const topLeft = document.querySelector('.evidence-top-left');
      const topRight = document.querySelector('.evidence-top-right');
      const select = document.querySelector('.evidence-case-select');
      const inventoryPanel = document.querySelector('.evidence-panel');
      const detailPanel = document.querySelector('.evidence-detail-panel');
      const detailHeader = document.querySelector('.evidence-detail-panel .evidence-panel-header');
      const tabs = Array.from(document.querySelectorAll('.evidence-detail-tab-btn')).map(t => ({
        text: t.textContent.trim(),
        width: Math.round(t.getBoundingClientRect().width)
      }));
      const hashCell = document.querySelector('.evidence-12field-cell[style*="span 2"] .evidence-field-val');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        topBar: {
          width: Math.round(topBar?.getBoundingClientRect().width || 0),
          height: Math.round(topBar?.getBoundingClientRect().height || 0),
          scrollWidth: topBar?.scrollWidth,
          clientWidth: topBar?.clientWidth,
          hasOverflow: topBar ? topBar.scrollWidth > topBar.clientWidth : false
        },
        columns: {
          inventoryWidth: Math.round(inventoryPanel?.getBoundingClientRect().width || 0),
          detailWidth: Math.round(detailPanel?.getBoundingClientRect().width || 0)
        },
        detailHeader: {
          width: Math.round(detailHeader?.getBoundingClientRect().width || 0),
          scrollWidth: detailHeader?.scrollWidth,
          clientWidth: detailHeader?.clientWidth,
          hasOverflow: detailHeader ? detailHeader.scrollWidth > detailHeader.clientWidth : false
        },
        tabs,
        hashStyle: {
          text: hashCell ? hashCell.textContent.trim().slice(0, 30) + '...' : null,
          wordBreak: hashCell ? window.getComputedStyle(hashCell).wordBreak : null
        }
      };
    })()`);

    console.log('\n================ 1440x900 BEFORE AUDIT ================');
    console.log('Top Bar:', audit1440.topBar);
    console.log('Columns (Inventory / Detail):', audit1440.columns);
    console.log('Detail Header:', audit1440.detailHeader);
    console.log('Tabs:', audit1440.tabs);
    console.log('Hash Cell:', audit1440.hashStyle);

    // Capture 1440 BEFORE
    console.log('\n[4/5] Capturing stage4_evidence_before_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.data, 'base64');
    fs.mkdirSync(DOCS_SCREENSHOTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage4_evidence_before_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage4_evidence_before_1440.png'), buf1440);
    console.log(`✓ Saved stage4_evidence_before_1440.png (${buf1440.length} bytes)`);

    // Audit and capture 1920x1080
    console.log('\n[5/5] Resizing to 1920x1080 & capturing stage4_evidence_before_1920.png...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 600));

    const audit1920 = await evalJson(`(() => {
      const topBar = document.querySelector('.evidence-top-bar');
      const inventoryPanel = document.querySelector('.evidence-panel');
      const detailPanel = document.querySelector('.evidence-detail-panel');
      const detailHeader = document.querySelector('.evidence-detail-panel .evidence-panel-header');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        topBar: {
          width: Math.round(topBar?.getBoundingClientRect().width || 0),
          height: Math.round(topBar?.getBoundingClientRect().height || 0),
          hasOverflow: topBar ? topBar.scrollWidth > topBar.clientWidth : false
        },
        columns: {
          inventoryWidth: Math.round(inventoryPanel?.getBoundingClientRect().width || 0),
          detailWidth: Math.round(detailPanel?.getBoundingClientRect().width || 0)
        },
        detailHeader: {
          width: Math.round(detailHeader?.getBoundingClientRect().width || 0),
          hasOverflow: detailHeader ? detailHeader.scrollWidth > detailHeader.clientWidth : false
        }
      };
    })()`);

    console.log('\n================ 1920x1080 BEFORE AUDIT ================');
    console.log('Top Bar:', audit1920.topBar);
    console.log('Columns (Inventory / Detail):', audit1920.columns);
    console.log('Detail Header:', audit1920.detailHeader);

    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage4_evidence_before_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage4_evidence_before_1920.png'), buf1920);
    console.log(`✓ Saved stage4_evidence_before_1920.png (${buf1920.length} bytes)`);

    console.log('\n✓ Stage 4 BEFORE capture and audit successfully completed.');
  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
  }
}

captureStage4Before().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});

/**
 * capture-cases-stage3-before.cjs
 *
 * Captures BEFORE screenshots and measures layout issues in Case Management Workspace.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_SCREENSHOTS = path.join(__dirname, '../docs/screenshots');

async function captureStage3Before() {
  const port = 9405;
  const profileDir = '/tmp/threatlenx-chrome-profile-stage3-before';
  
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

    // Navigate to CASES workspace
    console.log('[3/5] Navigating to CASES workspace...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const caseNode = nodes.find(n => n.textContent && (n.textContent.includes('CASE') || n.textContent.includes('CASES'))) || nodes[3];
      if (caseNode) caseNode.click();
      return true;
    })()`);

    let caseMounted = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const mounted = await evalJson(`!!document.querySelector('.case-workspace')`);
      if (mounted) {
        caseMounted = true;
        console.log(`✓ CaseWorkspace mounted at attempt ${i}!`);
        break;
      }
    }
    if (!caseMounted) {
      throw new Error('CaseWorkspace failed to mount');
    }
    await new Promise(r => setTimeout(r, 1000));

    // Audit layout at 1440x900
    const audit1440 = await evalJson(`(() => {
      const ws = document.querySelector('.case-workspace');
      const topBar = document.querySelector('.case-top-bar');
      const topLeft = document.querySelector('.case-top-left');
      const topRight = document.querySelector('.case-top-right');
      const select = document.querySelector('.case-top-select');
      const title = document.querySelector('.case-title-text');
      const badge = document.querySelector('.case-number-badge');

      const colContext = document.querySelector('.case-col-context')?.getBoundingClientRect();
      const colCenter = document.querySelector('.case-col-center')?.getBoundingClientRect();
      const colOps = document.querySelector('.case-col-ops')?.getBoundingClientRect();
      const rowActivity = document.querySelector('.case-bottom-activity')?.getBoundingClientRect();
      const rowNotes = document.querySelector('.case-bottom-notes')?.getBoundingClientRect();

      const tabs = Array.from(document.querySelectorAll('.center-tab-btn')).map(t => ({
        text: t.textContent.trim(),
        width: Math.round(t.getBoundingClientRect().width)
      }));

      return {
        topBar: {
          width: Math.round(topBar.getBoundingClientRect().width),
          height: Math.round(topBar.getBoundingClientRect().height),
          topLeftWidth: Math.round(topLeft.getBoundingClientRect().width),
          topRightWidth: Math.round(topRight.getBoundingClientRect().width),
          selectWidth: Math.round(select.getBoundingClientRect().width),
          titleWidth: Math.round(title ? title.getBoundingClientRect().width : 0),
          titleText: title ? title.textContent.trim() : null
        },
        columns: {
          contextWidth: Math.round(colContext?.width || 0),
          centerWidth: Math.round(colCenter?.width || 0),
          opsWidth: Math.round(colOps?.width || 0)
        },
        bottomRows: {
          activityWidth: Math.round(rowActivity?.width || 0),
          notesWidth: Math.round(rowNotes?.width || 0),
          activityHeight: Math.round(rowActivity?.height || 0),
          notesHeight: Math.round(rowNotes?.height || 0)
        },
        tabs
      };
    })()`);

    console.log('\n================ 1440x900 AUDIT ================');
    console.log('Top Bar:', audit1440.topBar);
    console.log('Columns (Context / Center / Ops):', audit1440.columns);
    console.log('Bottom Rows (Activity / Notes):', audit1440.bottomRows);
    console.log('Center Tabs:', audit1440.tabs);

    // Capture 1440 BEFORE
    console.log('\n[4/5] Capturing stage3_cases_before_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage3_cases_before_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage3_cases_before_1440.png'), buf1440);
    console.log(`✓ Saved stage3_cases_before_1440.png (${buf1440.length} bytes)`);

    // Audit and capture 1920x1080
    console.log('\n[5/5] Resizing to 1920x1080 & capturing stage3_cases_before_1920.png...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 1200));

    const audit1920 = await evalJson(`(() => {
      const topBar = document.querySelector('.case-top-bar');
      const topLeft = document.querySelector('.case-top-left');
      const topRight = document.querySelector('.case-top-right');
      const colContext = document.querySelector('.case-col-context')?.getBoundingClientRect();
      const colCenter = document.querySelector('.case-col-center')?.getBoundingClientRect();
      const colOps = document.querySelector('.case-col-ops')?.getBoundingClientRect();
      const rowActivity = document.querySelector('.case-bottom-activity')?.getBoundingClientRect();
      const rowNotes = document.querySelector('.case-bottom-notes')?.getBoundingClientRect();

      return {
        topBar: {
          width: Math.round(topBar.getBoundingClientRect().width),
          topLeftWidth: Math.round(topLeft.getBoundingClientRect().width),
          topRightWidth: Math.round(topRight.getBoundingClientRect().width)
        },
        columns: {
          contextWidth: Math.round(colContext?.width || 0),
          centerWidth: Math.round(colCenter?.width || 0),
          opsWidth: Math.round(colOps?.width || 0)
        },
        bottomRows: {
          activityWidth: Math.round(rowActivity?.width || 0),
          notesWidth: Math.round(rowNotes?.width || 0),
          activityHeight: Math.round(rowActivity?.height || 0),
          notesHeight: Math.round(rowNotes?.height || 0)
        }
      };
    })()`);

    console.log('\n================ 1920x1080 AUDIT ================');
    console.log('Top Bar:', audit1920.topBar);
    console.log('Columns (Context / Center / Ops):', audit1920.columns);
    console.log('Bottom Rows (Activity / Notes):', audit1920.bottomRows);

    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage3_cases_before_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage3_cases_before_1920.png'), buf1920);
    console.log(`✓ Saved stage3_cases_before_1920.png (${buf1920.length} bytes)`);

    ws.close();
    chromeProcess.kill();
    console.log('\n✓ BEFORE capture completed successfully!');
  } catch (err) {
    console.error('Capture failed:', err);
    chromeProcess.kill();
    process.exit(1);
  }
}

captureStage3Before();

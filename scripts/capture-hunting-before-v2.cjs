const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_SCREENSHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
if (!fs.existsSync(DOCS_SCREENSHOTS)) {
  fs.mkdirSync(DOCS_SCREENSHOTS, { recursive: true });
}

async function captureHuntingBefore() {
  const port = 9385;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-hunting-before-9385',
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

    const send = (method, params = {}) => new Promise((resolve) => {
      const id = msgId++;
      pendingCallbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    console.log('[1/5] Setting 1440x900 viewport...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });

    console.log('[2/5] Polling for Hub nodes...');
    let hubFound = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 400));
      const res = await send('Runtime.evaluate', {
        expression: `document.querySelectorAll('.hub-workspace-node').length`,
        returnByValue: true
      });
      const count = res?.result?.value;
      if (count === 6) {
        hubFound = true;
        console.log(`✓ Hub rendered 6 nodes at attempt ${i}!`);
        break;
      }
    }

    if (!hubFound) {
      console.warn('Hub nodes did not reach 6, trying direct keydown H anyway...');
    }

    console.log('[3/5] Triggering navigation to Zone 3 (HUNTING)...');
    const navResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const huntNode = nodes.find(n => n.textContent && n.textContent.includes('THREAT HUNTING'));
        if (huntNode) {
          huntNode.click();
          return { method: 'click', text: huntNode.innerText.replace(/\\n/g, ' ') };
        }
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
        return { method: 'keyH' };
      })()`,
      returnByValue: true
    });
    console.log('Nav result:', JSON.stringify(navResult?.result?.value));

    // Wait for ThreatHuntingWorkspace to mount
    console.log('Waiting for ThreatHuntingWorkspace to mount...');
    let huntingMounted = false;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 300));
      const res = await send('Runtime.evaluate', {
        expression: `!!document.querySelector('.threat-hunting-workspace')`,
        returnByValue: true
      });
      if (res?.result?.value) {
        huntingMounted = true;
        console.log(`✓ ThreatHuntingWorkspace mounted at attempt ${i}!`);
        break;
      }
    }

    // Wait 1.5s for initial query to complete and results to render
    await new Promise(r => setTimeout(r, 1500));

    // Audit layout at 1440x900
    const audit1440 = await send('Runtime.evaluate', {
      expression: `(() => {
        const ws = document.querySelector('.threat-hunting-workspace');
        if (!ws) return { error: 'Not in hunting workspace' };

        const wsRect = ws.getBoundingClientRect();
        const queryCol = document.querySelector('.hunt-query-col')?.getBoundingClientRect();
        const fieldCol = document.querySelector('.hunt-field-col')?.getBoundingClientRect();
        const inspectorCol = document.querySelector('.hunt-inspector-col')?.getBoundingClientRect();
        const timelineCol = document.querySelector('.hunt-timeline-col')?.getBoundingClientRect();

        // Check clipped elements
        const clipped = [];
        ws.querySelectorAll('*').forEach(el => {
          if (el.children.length === 0 && el.textContent.trim().length > 2) {
            if (el.scrollWidth > el.clientWidth + 2) {
              const comp = window.getComputedStyle(el);
              clipped.push({
                tag: el.tagName,
                className: el.className,
                text: el.textContent.trim().slice(0, 40),
                clientWidth: el.clientWidth,
                scrollWidth: el.scrollWidth,
                overflow: comp.overflow,
                textOverflow: comp.textOverflow
              });
            }
          }
        });

        // Check node labels & overlaps
        const labels = Array.from(document.querySelectorAll('.hunt-node-label')).map(l => {
          const r = l.getBoundingClientRect();
          return { text: l.textContent, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
        });

        const labelOverlaps = [];
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            const a = labels[i].rect;
            const b = labels[j].rect;
            const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
            const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
            if (overlapX > 0 && overlapY > 0) {
              labelOverlaps.push({ a: labels[i].text, b: labels[j].text, overlapX, overlapY });
            }
          }
        }

        // Check panel headers
        const headers = Array.from(document.querySelectorAll('.hunt-panel-header')).map(h => ({
          text: h.textContent.trim().replace(/\\s+/g, ' ').slice(0, 45),
          w: Math.round(h.getBoundingClientRect().width),
          scrollW: h.scrollWidth
        }));

        // Check entity chips
        const chips = Array.from(document.querySelectorAll('.hunt-entity-chip')).map(c => ({
          text: c.textContent.trim().replace(/\\s+/g, ' '),
          w: Math.round(c.getBoundingClientRect().width),
          scrollW: c.scrollWidth
        }));

        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          wsRect: { w: Math.round(wsRect.width), h: Math.round(wsRect.height) },
          columns: {
            queryCol: queryCol ? { w: Math.round(queryCol.width), h: Math.round(queryCol.height) } : null,
            fieldCol: fieldCol ? { w: Math.round(fieldCol.width), h: Math.round(fieldCol.height) } : null,
            inspectorCol: inspectorCol ? { w: Math.round(inspectorCol.width), h: Math.round(inspectorCol.height) } : null,
            timelineCol: timelineCol ? { w: Math.round(timelineCol.width), h: Math.round(timelineCol.height) } : null
          },
          clippedCount: clipped.length,
          clippedSamples: clipped,
          labelCount: labels.length,
          labelOverlaps,
          headers,
          chipCount: chips.length,
          chips: chips.slice(0, 5)
        };
      })()`,
      returnByValue: true
    });
    console.log('\n--- 1440x900 AUDIT RESULTS ---');
    console.log(JSON.stringify(audit1440?.result?.value, null, 2));

    console.log('[4/5] Capturing stage2_hunting_before_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.result.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_before_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage2_hunting_before_1440.png'), buf1440);
    console.log('✓ Saved stage2_hunting_before_1440.png');

    console.log('[5/5] Resizing to 1920x1080 and capturing stage2_hunting_before_1920.png...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1200));

    const audit1920 = await send('Runtime.evaluate', {
      expression: `(() => {
        const ws = document.querySelector('.threat-hunting-workspace');
        if (!ws) return { error: 'Not in hunting workspace' };
        const queryCol = document.querySelector('.hunt-query-col')?.getBoundingClientRect();
        const fieldCol = document.querySelector('.hunt-field-col')?.getBoundingClientRect();
        const inspectorCol = document.querySelector('.hunt-inspector-col')?.getBoundingClientRect();
        const timelineCol = document.querySelector('.hunt-timeline-col')?.getBoundingClientRect();
        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          columns: {
            queryCol: queryCol ? { w: Math.round(queryCol.width), h: Math.round(queryCol.height) } : null,
            fieldCol: fieldCol ? { w: Math.round(fieldCol.width), h: Math.round(fieldCol.height) } : null,
            inspectorCol: inspectorCol ? { w: Math.round(inspectorCol.width), h: Math.round(inspectorCol.height) } : null,
            timelineCol: timelineCol ? { w: Math.round(timelineCol.width), h: Math.round(timelineCol.height) } : null
          }
        };
      })()`,
      returnByValue: true
    });
    console.log('\n--- 1920x1080 AUDIT RESULTS ---');
    console.log(JSON.stringify(audit1920?.result?.value, null, 2));

    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.result.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_before_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage2_hunting_before_1920.png'), buf1920);
    console.log('✓ Saved stage2_hunting_before_1920.png');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

captureHuntingBefore().then(() => {
  console.log('STAGE 2 BEFORE CAPTURE COMPLETE!');
  process.exit(0);
}).catch(console.error);

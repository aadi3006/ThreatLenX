/**
 * scripts/inspect-hub-stage5.cjs
 *
 * Inspects Spatial Command Hub layout, node geometry, bounds, overlaps, and navigation
 * across 1440x900 and 1920x1080 viewports.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_SCREENSHOTS = path.join(__dirname, '../docs/screenshots');

async function inspectHub() {
  const port = 9450;
  const profileDir = `/tmp/threatlenx-chrome-profile-hub-inspect-${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });

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

    console.log('[1/4] Setting 1440x900 viewport & navigating to http://127.0.0.1:3000/...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    ws.send(JSON.stringify({ id: msgId++, method: 'Page.navigate', params: { url: 'http://127.0.0.1:3000/' } }));

    // Poll for 6 hub nodes
    console.log('[2/4] Waiting for React hydration on Spatial Command Hub...');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hubCount = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (hubCount === 6) {
        console.log(`✓ Spatial Hub hydrated with 6 zone nodes at poll ${i}!`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 4500));

    // Audit layout function
    const auditHubLayout = async (vpName) => {
      return await evalJson(`(() => {
        const stage = document.querySelector('.spatial-hub-stage');
        const sphere = document.querySelector('.hub-sphere-core');
        const statusBar = document.querySelector('.hub-status-ring');
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));

        const stageRect = stage.getBoundingClientRect();
        const sphereRect = sphere.getBoundingClientRect();
        const statusRect = statusBar.getBoundingClientRect();

        const nodeData = nodes.map(n => {
          const rect = n.getBoundingClientRect();
          const anchor = n.querySelector('.node-anchor')?.getBoundingClientRect();
          const title = n.querySelector('.node-title')?.textContent?.trim();
          const sublabel = n.querySelector('.node-sublabel')?.textContent?.trim();
          const badge = n.querySelector('.node-badge')?.textContent?.trim();

          return {
            title,
            sublabel,
            badge,
            rect: {
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            anchorRect: anchor ? {
              left: Math.round(anchor.left),
              top: Math.round(anchor.top),
              right: Math.round(anchor.right),
              bottom: Math.round(anchor.bottom),
              width: Math.round(anchor.width),
              height: Math.round(anchor.height)
            } : null
          };
        });

        // Check for node-node overlaps
        const overlaps = [];
        for (let i = 0; i < nodeData.length; i++) {
          for (let j = i + 1; j < nodeData.length; j++) {
            const a = nodeData[i].anchorRect || nodeData[i].rect;
            const b = nodeData[j].anchorRect || nodeData[j].rect;
            const hasOverlap = !(
              a.right < b.left ||
              a.left > b.right ||
              a.bottom < b.top ||
              a.top > b.bottom
            );
            if (hasOverlap) {
              overlaps.push({ a: nodeData[i].title, b: nodeData[j].title });
            }
          }
        }

        // Check node-sphere overlaps
        const sphereOverlaps = [];
        for (const n of nodeData) {
          const a = n.anchorRect || n.rect;
          const s = sphereRect;
          const hasOverlap = !(
            a.right < s.left ||
            a.left > s.right ||
            a.bottom < s.top ||
            a.top > s.bottom
          );
          if (hasOverlap) {
            sphereOverlaps.push(n.title);
          }
        }

        // Check node-statusBar overlaps
        const statusOverlaps = [];
        for (const n of nodeData) {
          const a = n.anchorRect || n.rect;
          const s = statusRect;
          const hasOverlap = !(
            a.right < s.left ||
            a.left > s.right ||
            a.bottom < s.top ||
            a.top > s.bottom
          );
          if (hasOverlap) {
            statusOverlaps.push(n.title);
          }
        }

        // Check out of bounds (clipping)
        const clippedNodes = [];
        for (const n of nodeData) {
          const a = n.anchorRect || n.rect;
          const isClipped = (
            a.left < stageRect.left ||
            a.right > stageRect.right ||
            a.top < stageRect.top ||
            a.bottom > stageRect.bottom
          );
          if (isClipped) {
            clippedNodes.push({
              title: n.title,
              leftOverflow: Math.max(0, stageRect.left - a.left),
              rightOverflow: Math.max(0, a.right - stageRect.right),
              topOverflow: Math.max(0, stageRect.top - a.top),
              bottomOverflow: Math.max(0, a.bottom - stageRect.bottom)
            });
          }
        }

        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          stage: {
            width: Math.round(stageRect.width),
            height: Math.round(stageRect.height),
            scrollWidth: stage.scrollWidth,
            scrollHeight: stage.scrollHeight,
            clientWidth: stage.clientWidth,
            clientHeight: stage.clientHeight,
            hasHorizontalScroll: stage.scrollWidth > stage.clientWidth,
            hasVerticalScroll: stage.scrollHeight > stage.clientHeight
          },
          sphere: {
            x: Math.round(sphereRect.left + sphereRect.width / 2),
            y: Math.round(sphereRect.top + sphereRect.height / 2),
            width: Math.round(sphereRect.width),
            height: Math.round(sphereRect.height)
          },
          statusBar: {
            x: Math.round(statusRect.left),
            y: Math.round(statusRect.top),
            width: Math.round(statusRect.width),
            height: Math.round(statusRect.height),
            isCentered: Math.abs((statusRect.left + statusRect.width / 2) - stageRect.width / 2) < 5
          },
          nodeData,
          overlaps,
          sphereOverlaps,
          statusOverlaps,
          clippedNodes
        };
      })()`);
    };

    console.log('\n[3/4] Auditing Hub at 1440x900...');
    const audit1440 = await auditHubLayout('1440x900');
    console.log('Stage 1440:', audit1440.stage);
    console.log('Central Sphere 1440:', audit1440.sphere);
    console.log('Status Bar 1440:', audit1440.statusBar);
    console.log('Nodes 1440:');
    audit1440.nodeData.forEach(n => {
      console.log(`  - [${n.title}] anchor: (${n.anchorRect.left}, ${n.anchorRect.top}) ${n.anchorRect.width}x${n.anchorRect.height}, badge="${n.badge}"`);
    });
    console.log('Overlaps between nodes:', audit1440.overlaps);
    console.log('Overlaps with central sphere:', audit1440.sphereOverlaps);
    console.log('Overlaps with status bar:', audit1440.statusOverlaps);
    console.log('Clipped nodes:', audit1440.clippedNodes);

    // Capture 1440 BEFORE
    console.log('\nCapturing stage5_hub_before_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.data, 'base64');
    fs.mkdirSync(DOCS_SCREENSHOTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage5_hub_before_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage5_hub_before_1440.png'), buf1440);
    console.log(`✓ Saved stage5_hub_before_1440.png (${buf1440.length} bytes)`);

    // Audit and capture 1920x1080
    console.log('\n[4/4] Resizing to 1920x1080 & auditing Hub...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 800));

    const audit1920 = await auditHubLayout('1920x1080');
    console.log('Stage 1920:', audit1920.stage);
    console.log('Central Sphere 1920:', audit1920.sphere);
    console.log('Status Bar 1920:', audit1920.statusBar);
    console.log('Nodes 1920:');
    audit1920.nodeData.forEach(n => {
      console.log(`  - [${n.title}] anchor: (${n.anchorRect.left}, ${n.anchorRect.top}) ${n.anchorRect.width}x${n.anchorRect.height}, badge="${n.badge}"`);
    });
    console.log('Overlaps between nodes:', audit1920.overlaps);
    console.log('Overlaps with central sphere:', audit1920.sphereOverlaps);
    console.log('Overlaps with status bar:', audit1920.statusOverlaps);
    console.log('Clipped nodes:', audit1920.clippedNodes);

    // Capture 1920 BEFORE
    console.log('\nCapturing stage5_hub_before_1920.png...');
    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage5_hub_before_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage5_hub_before_1920.png'), buf1920);
    console.log(`✓ Saved stage5_hub_before_1920.png (${buf1920.length} bytes)`);

    console.log('\n✓ Hub layout inspection complete.');
  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

inspectHub().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});

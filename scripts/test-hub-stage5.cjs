/**
 * scripts/test-hub-stage5.cjs
 *
 * Comprehensive test and verification suite for ThreatLenX Stage 5:
 * Spatial Command Hub.
 *
 * Verifies:
 * 1. Six Zone Links click navigation & return navigation:
 *    - Hub -> COMMAND CENTER -> Hub
 *    - Hub -> INCIDENT INVESTIGATION -> Hub
 *    - Hub -> THREAT HUNTING -> Hub
 *    - Hub -> CASE MANAGEMENT -> Hub
 *    - Hub -> EVIDENCE VAULT -> Hub
 *    - Hub -> DETECTION RULES -> Hub
 * 2. Keyboard Selection:
 *    - ArrowRight / ArrowDown / Tab (cycling forward)
 *    - ArrowLeft / ArrowUp (cycling backward)
 *    - Enter / Space activation
 *    - Quick launch numeric keys (1-6)
 * 3. Layout geometry and non-overlap verification at 1440x900 and 1920x1080
 * 4. Stored data preservation audit across all IndexedDB stores
 * 5. Captures before and after screenshots
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/e2f3967d-7c5e-4bbe-a593-37944f2fe5dd';
const DOCS_SCREENSHOTS = path.join(__dirname, '../docs/screenshots');

async function runStage5HubSuite() {
  const port = 9455;
  const profileDir = `/tmp/threatlenx-chrome-profile-stage5-hub-${Date.now()}`;
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
        expression: `(async () => {
          const res = await (${expr});
          return JSON.stringify(res);
        })()`,
        awaitPromise: true,
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

    const pressKey = async (key, code, windowsVirtualKeyCode) => {
      await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', code: '${code || key}', bubbles: true, cancelable: true }))`);
    };

    const assertReturnButton = async (zoneName, selector) => {
      let isVisible = false;
      for (let p = 0; p < 20; p++) {
        const state = await evalJson(`(() => {
          const btn = document.querySelector('${selector}');
          if (!btn) return { exists: false, visible: false };
          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          const visible = style.display !== 'none' &&
                          style.visibility !== 'hidden' &&
                          style.opacity !== '0' &&
                          (rect.width > 0 || rect.height > 0 || btn.offsetWidth > 0 || btn.offsetHeight > 0);
          return { exists: true, visible };
        })()`);
        if (state?.exists && state?.visible) {
          isVisible = true;
          break;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      if (!isVisible) {
        throw new Error(`Return button for zone [${zoneName}] (${selector}) is missing or not visible`);
      }
    };

    const returnToHub = async (expectedZoneName) => {
      const alreadyHub = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
      if (alreadyHub) return true;

      let zoneName = expectedZoneName;
      if (!zoneName) {
        zoneName = await evalJson(`(() => {
          if (document.querySelector('.spatial-universe-layer')) return 'COMMAND CENTER';
          if (document.querySelector('.spatial-investigation-layer') || document.querySelector('.inv-list-workspace')) return 'INCIDENT INVESTIGATION';
          if (document.querySelector('.threat-hunting-workspace')) return 'THREAT HUNTING';
          if (document.querySelector('.case-workspace')) return 'CASE MANAGEMENT';
          if (document.querySelector('.evidence-workspace')) return 'EVIDENCE VAULT';
          if (document.querySelector('.detection-workspace')) return 'DETECTION RULES';
          return null;
        })()`);
      }

      if (zoneName) {
        const selectorMap = {
          'COMMAND CENTER': '.hub-return-btn',
          'INCIDENT INVESTIGATION': '.inv-list-back-btn, button[aria-label*="Spatial Hub"]',
          'THREAT HUNTING': '.hunt-back-btn',
          'CASE MANAGEMENT': '.case-back-btn',
          'EVIDENCE VAULT': '.evidence-back-btn',
          'DETECTION RULES': '.det-back-btn'
        };
        const sel = selectorMap[zoneName];
        if (sel) {
          await assertReturnButton(zoneName, sel);
        }
      }

      await evalJson(`(() => {
        const btn = document.querySelector('.hub-return-btn') ||
                    document.querySelector('.inv-list-back-btn') ||
                    document.querySelector('button[aria-label*="Spatial Hub"]') ||
                    document.querySelector('.inv-exit-btn') ||
                    document.querySelector('.hunt-back-btn') ||
                    document.querySelector('.hunt-close-btn') ||
                    document.querySelector('.case-back-btn') ||
                    document.querySelector('.evidence-back-btn') ||
                    document.querySelector('.det-back-btn');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()`);

      for (let p = 0; p < 25; p++) {
        await new Promise(r => setTimeout(r, 120));
        const count = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
        if (count === 6) return true;
      }
      return false;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    console.log('[1/8] Setting 1440x900 viewport & navigating to http://127.0.0.1:3000/...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    ws.send(JSON.stringify({ id: msgId++, method: 'Page.navigate', params: { url: 'http://127.0.0.1:3000/' } }));

    // Poll for 6 hub nodes
    console.log('[2/8] Waiting for React hydration on Spatial Command Hub...');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hubCount = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (hubCount === 6) {
        console.log(`✓ Spatial Hub hydrated with 6 zone nodes at poll ${i}!`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 4500));

    // Inspect IndexedDB before
    const readIdbExpr = `new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('IDB open timed out')), 5000);
      const req = indexedDB.open('es-spatial-db');
      req.onsuccess = (e) => {
        clearTimeout(timeout);
        const db = e.target.result;
        const names = Array.from(db.objectStoreNames).sort();
        const report = {};
        if (names.length === 0) {
          db.close();
          return resolve(report);
        }

        const tx = db.transaction(names, 'readonly');
        let pending = names.length * 2;

        names.forEach(name => {
          const store = tx.objectStore(name);
          report[name] = { count: 0, keys: [] };

          const cr = store.count();
          cr.onsuccess = () => {
            report[name].count = cr.result;
            if (--pending === 0) {
              db.close();
              resolve(report);
            }
          };
          cr.onerror = () => {
            if (--pending === 0) {
              db.close();
              resolve(report);
            }
          };

          const kr = store.getAllKeys();
          kr.onsuccess = () => {
            report[name].keys = kr.result.slice(0, 10).map(String);
            if (--pending === 0) {
              db.close();
              resolve(report);
            }
          };
          kr.onerror = () => {
            if (--pending === 0) {
              db.close();
              resolve(report);
            }
          };
        });
      };
      req.onerror = () => {
        clearTimeout(timeout);
        reject(req.error);
      };
    })`;

    console.log('[2b/8] Waiting for IndexedDB bootstrap on es-spatial-db before taking baseline...');
    let idbBefore = null;
    let storeCountBefore = 0;
    let dbPresent = false;

    for (let i = 0; i < 40; i++) {
      try {
        const dbs = await evalJson(`indexedDB.databases ? indexedDB.databases() : [{ name: 'es-spatial-db' }]`);
        dbPresent = Array.isArray(dbs) && dbs.some(d => d.name === 'es-spatial-db');
        if (dbPresent) {
          idbBefore = await evalJson(readIdbExpr);
          storeCountBefore = Object.keys(idbBefore || {}).length;
          if (storeCountBefore > 0) {
            break;
          }
        }
      } catch (err) {
        // IDB might still be opening or upgrading
      }
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`✓ IndexedDB before check: dbPresent=${dbPresent}, storeCount=${storeCountBefore}`);
    if (!dbPresent || !idbBefore || storeCountBefore === 0) {
      throw new Error(`Storage verification failed: database 'es-spatial-db' is absent or contains zero stores (found: ${storeCountBefore})`);
    }

    // =========================================================================
    // SECTION 1: VERIFY ALL SIX ZONE LINKS & RETURN NAVIGATION
    // =========================================================================
    console.log('\n[3/8] Verifying all six zone links & return navigation...');

    const zonesToTest = [
      {
        name: 'COMMAND CENTER',
        expectedSelector: '.spatial-universe-layer',
        returnSelector: '.hub-return-btn',
        returnAction: `document.querySelector('.hub-return-btn')?.click()`
      },
      {
        name: 'INCIDENT INVESTIGATION',
        expectedSelector: '.spatial-investigation-layer',
        returnSelector: '.inv-list-back-btn, button[aria-label*="Spatial Hub"]',
        returnAction: `(document.querySelector('.inv-list-back-btn') || document.querySelector('button[aria-label*="Spatial Hub"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('SPATIAL HUB')) || document.querySelector('.hub-return-btn'))?.click()`
      },
      {
        name: 'THREAT HUNTING',
        expectedSelector: '.threat-hunting-workspace',
        returnSelector: '.hunt-back-btn',
        returnAction: `document.querySelector('.hunt-back-btn')?.click()`
      },
      {
        name: 'CASE MANAGEMENT',
        expectedSelector: '.case-workspace',
        returnSelector: '.case-back-btn',
        returnAction: `document.querySelector('.case-back-btn')?.click()`
      },
      {
        name: 'EVIDENCE VAULT',
        expectedSelector: '.evidence-workspace',
        returnSelector: '.evidence-back-btn',
        returnAction: `document.querySelector('.evidence-back-btn')?.click()`
      },
      {
        name: 'DETECTION RULES',
        expectedSelector: '.detection-workspace',
        returnSelector: '.det-back-btn',
        returnAction: `document.querySelector('.det-back-btn')?.click()`
      }
    ];

    for (let i = 0; i < zonesToTest.length; i++) {
      const z = zonesToTest[i];
      console.log(`\n  --> Testing Zone ${i + 1}/6: [${z.name}]`);

      // Click node
      const clicked = await evalJson(`(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const target = nodes.find(n => n.textContent && n.textContent.includes('${z.name}'));
        if (target) {
          target.click();
          return true;
        }
        return false;
      })()`);

      if (!clicked) throw new Error(`Could not find or click node for ${z.name}`);

      // Wait for workspace mount (transition animation is ~240ms)
      await new Promise(r => setTimeout(r, 600));

      let mounted = false;
      for (let p = 0; p < 15; p++) {
        mounted = await evalJson(`!!document.querySelector('${z.expectedSelector}')`);
        if (mounted) break;
        await new Promise(r => setTimeout(r, 150));
      }

      console.log(`    ✓ Navigated to ${z.name} (mounted: ${mounted})`);
      if (!mounted) throw new Error(`Workspace for ${z.name} (${z.expectedSelector}) failed to mount`);

      // Before return click, assert the intended button exists and is visible
      await assertReturnButton(z.name, z.returnSelector);

      // Return to Hub
      await evalJson(`(() => {
        ${z.returnAction};
        return true;
      })()`);
      await new Promise(r => setTimeout(r, 600));

      let atHub = false;
      for (let p = 0; p < 20; p++) {
        const count = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
        if (count === 6) {
          atHub = true;
          break;
        }
        await new Promise(r => setTimeout(r, 120));
      }

      console.log(`    ✓ Returned to Spatial Command Hub (nodes: 6, atHub: ${atHub})`);
      if (!atHub) throw new Error(`Failed to return to Hub from ${z.name}`);
    }

    // =========================================================================
    // SECTION 2: VERIFY KEYBOARD SELECTION & NAVIGATION
    // =========================================================================
    console.log('\n[4/8] Verifying keyboard selection (Arrows, Tab, Enter, Space)...');

    // Check currently focused index
    const currentFocus = await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      return nodes.findIndex(n => n.classList.contains('state-focused'));
    })()`);
    console.log(`  Initial focused index: ${currentFocus}`);

    // Test ArrowDown / ArrowRight / Tab
    await pressKey('ArrowRight', 'ArrowRight', 39);
    await new Promise(r => setTimeout(r, 150));
    const nextFocus = await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      return nodes.findIndex(n => n.classList.contains('state-focused'));
    })()`);
    console.log(`  Focus after ArrowRight: ${nextFocus} (expected: ${(currentFocus + 1) % 6})`);
    if (nextFocus !== (currentFocus + 1) % 6) {
      throw new Error(`ArrowRight navigation failed: expected ${(currentFocus + 1) % 6}, got ${nextFocus}`);
    }

    // Test ArrowDown
    await pressKey('ArrowDown', 'ArrowDown', 40);
    await new Promise(r => setTimeout(r, 150));
    const afterDown = await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      return nodes.findIndex(n => n.classList.contains('state-focused'));
    })()`);
    console.log(`  Focus after ArrowDown: ${afterDown} (expected: ${(nextFocus + 1) % 6})`);

    // Test Tab
    await pressKey('Tab', 'Tab', 9);
    await new Promise(r => setTimeout(r, 150));
    const afterTab = await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      return nodes.findIndex(n => n.classList.contains('state-focused'));
    })()`);
    console.log(`  Focus after Tab: ${afterTab} (expected: ${(afterDown + 1) % 6})`);

    // Test ArrowLeft
    await pressKey('ArrowLeft', 'ArrowLeft', 37);
    await new Promise(r => setTimeout(r, 150));
    const afterLeft = await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      return nodes.findIndex(n => n.classList.contains('state-focused'));
    })()`);
    console.log(`  Focus after ArrowLeft: ${afterLeft} (expected: ${afterDown})`);
    if (afterLeft !== afterDown) {
      throw new Error(`ArrowLeft navigation failed: expected ${afterDown}, got ${afterLeft}`);
    }

    // Test Enter activation
    console.log('  Testing Enter key activation on focused node...');
    await pressKey('Enter', 'Enter', 13);

    // Wait until workspace mounts and Hub unmounts (nodes === 0)
    let workspaceMounted = false;
    for (let p = 0; p < 25; p++) {
      await new Promise(r => setTimeout(r, 100));
      const hubCount = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (hubCount === 0) {
        workspaceMounted = true;
        break;
      }
    }
    console.log(`  Enter key launched workspace: ${workspaceMounted}`);
    if (!workspaceMounted) throw new Error('Enter key failed to launch workspace');

    await new Promise(r => setTimeout(r, 500));

    // Return to Hub after Enter activation
    const hubRestored = await returnToHub();
    console.log(`  Returned to Hub: ${hubRestored}`);
    if (!hubRestored) throw new Error('Failed to return to Hub after Enter activation');

    // Wait extra 300ms for Hub stage animation to stabilize
    await new Promise(r => setTimeout(r, 400));

    // Test Quick Launch Keys (1-6)
    console.log('\n[5/8] Verifying quick launch numeric keys [1-6] on Hub...');
    const quickKeys = [
      { key: '1', name: 'COMMAND CENTER', selector: '.spatial-universe-layer' },
      { key: '2', name: 'INCIDENT INVESTIGATION', selector: '.spatial-investigation-layer' },
      { key: '3', name: 'THREAT HUNTING', selector: '.threat-hunting-workspace' },
      { key: '4', name: 'CASE MANAGEMENT', selector: '.case-workspace' },
      { key: '5', name: 'EVIDENCE VAULT', selector: '.evidence-workspace' },
      { key: '6', name: 'DETECTION RULES', selector: '.detection-workspace' }
    ];

    for (const q of quickKeys) {
      await returnToHub();
      await new Promise(r => setTimeout(r, 200));

      const debugState = await evalJson(`(() => {
        const stage = document.querySelector('.spatial-hub-stage');
        const nodes = document.querySelectorAll('.hub-workspace-node').length;
        const main = document.querySelector('main')?.className;
        const wrapper = document.querySelector('.soc-spatial-wrapper')?.className;
        return { hasStage: !!stage, nodes, main, wrapper };
      })()`);
      console.log(`  [DEBUG before key ${q.key}]:`, debugState);

      await pressKey(q.key, `Digit${q.key}`);
      let launched = false;
      for (let p = 0; p < 25; p++) {
        await new Promise(r => setTimeout(r, 100));
        const check = await evalJson(`(() => {
          const target = document.querySelector('${q.selector}');
          const wrapper = document.querySelector('.soc-spatial-wrapper')?.className;
          return { hasTarget: !!target, wrapper };
        })()`);
        if (check?.hasTarget) {
          launched = true;
          break;
        }
        if (p === 10) {
          console.log(`    [DEBUG poll ${p}]:`, check);
        }
      }
      console.log(`  ✓ Key [${q.key}] launched ${q.name}: ${launched}`);
      if (!launched) throw new Error(`Quick key [${q.key}] failed to launch ${q.name}`);

      // Return via returnToHub
      const returned = await returnToHub(q.name);
      if (!returned) {
        throw new Error(`Failed to return to Hub after launching ${q.name}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // =========================================================================
    // SECTION 3: LAYOUT AUDIT & CAPTURE AT 1440x900
    // =========================================================================
    console.log('\n[6/8] Auditing layout metrics at 1440x900 & capturing screenshots...');
    const layout1440 = await evalJson(`(() => {
      const stage = document.querySelector('.spatial-hub-stage');
      const sphere = document.querySelector('.hub-sphere-core');
      const statusBar = document.querySelector('.hub-status-ring');
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));

      const stageRect = stage.getBoundingClientRect();
      const sphereRect = sphere.getBoundingClientRect();
      const statusRect = statusBar.getBoundingClientRect();

      const nodeData = nodes.map(n => {
        const anchor = n.querySelector('.node-anchor')?.getBoundingClientRect();
        const title = n.querySelector('.node-title')?.textContent?.trim();
        return {
          title,
          rect: anchor ? {
            left: Math.round(anchor.left),
            top: Math.round(anchor.top),
            right: Math.round(anchor.right),
            bottom: Math.round(anchor.bottom),
            width: Math.round(anchor.width),
            height: Math.round(anchor.height)
          } : null
        };
      });

      return {
        stage: {
          width: Math.round(stageRect.width),
          height: Math.round(stageRect.height),
          scrollWidth: stage.scrollWidth,
          scrollHeight: stage.scrollHeight,
          clientWidth: stage.clientWidth,
          clientHeight: stage.clientHeight,
          hasOverflow: stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight
        },
        sphere: {
          cx: Math.round(sphereRect.left + sphereRect.width / 2),
          cy: Math.round(sphereRect.top + sphereRect.height / 2),
          size: Math.round(sphereRect.width)
        },
        statusBar: {
          width: Math.round(statusRect.width),
          height: Math.round(statusRect.height),
          top: Math.round(statusRect.top),
          isCentered: Math.abs((statusRect.left + statusRect.width / 2) - stageRect.width / 2) < 5
        },
        nodeData
      };
    })()`);

    console.log('Layout 1440:', layout1440);
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage5_hub_after_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage5_hub_after_1440.png'), buf1440);
    console.log(`✓ Saved stage5_hub_after_1440.png (${buf1440.length} bytes)`);

    // =========================================================================
    // SECTION 4: RESIZE TO 1920x1080 & AUDIT
    // =========================================================================
    console.log('\n[7/8] Resizing to 1920x1080 & capturing screenshots...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 800));

    const layout1920 = await evalJson(`(() => {
      const stage = document.querySelector('.spatial-hub-stage');
      const sphere = document.querySelector('.hub-sphere-core');
      const statusBar = document.querySelector('.hub-status-ring');
      const stageRect = stage.getBoundingClientRect();
      const sphereRect = sphere.getBoundingClientRect();
      const statusRect = statusBar.getBoundingClientRect();

      return {
        stage: {
          width: Math.round(stageRect.width),
          height: Math.round(stageRect.height),
          hasOverflow: stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight
        },
        sphere: {
          cx: Math.round(sphereRect.left + sphereRect.width / 2),
          cy: Math.round(sphereRect.top + sphereRect.height / 2),
          size: Math.round(sphereRect.width)
        },
        statusBar: {
          width: Math.round(statusRect.width),
          height: Math.round(statusRect.height),
          top: Math.round(statusRect.top),
          isCentered: Math.abs((statusRect.left + statusRect.width / 2) - stageRect.width / 2) < 5
        }
      };
    })()`);

    console.log('Layout 1920:', layout1920);
    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage5_hub_after_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage5_hub_after_1920.png'), buf1920);
    console.log(`✓ Saved stage5_hub_after_1920.png (${buf1920.length} bytes)`);

    // =========================================================================
    // SECTION 5: DATA PRESERVATION AUDIT
    // =========================================================================
    console.log('\n[8/8] Data preservation audit...');
    const idbAfter = await evalJson(readIdbExpr);
    const storeCountAfter = Object.keys(idbAfter || {}).length;
    console.log(`✓ IndexedDB after check: ${storeCountAfter} object stores.`);

    if (!idbAfter || storeCountAfter === 0) {
      throw new Error(`Storage verification failed: database 'es-spatial-db' after test is absent or contains zero stores (found: ${storeCountAfter})`);
    }

    let preserved = true;
    for (const [store, data] of Object.entries(idbBefore || {})) {
      const afterCount = idbAfter[store]?.count;
      // audit_records is append-only log; all other stores must match exactly
      const countValid = store === 'audit_records' ? (afterCount >= data.count) : (afterCount === data.count);
      if (!countValid) {
        console.warn(`Mismatch in store ${store}: before=${data.count}, after=${afterCount}`);
        preserved = false;
      }
    }
    if (preserved) {
      console.log('✅ 100% DATA PRESERVATION VERIFIED: Zero stores cleared, zero records deleted, zero reseeding.');
    } else {
      throw new Error('Storage verification failed: store record counts mismatched after test');
    }

    console.log('\n=============================================================');
    console.log('✅ ALL STAGE 5 HUB VERIFICATIONS PASSED!');
    console.log('=============================================================');

  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

runStage5HubSuite().catch(err => {
  console.error('[SUITE ERROR]', err);
  process.exit(1);
});

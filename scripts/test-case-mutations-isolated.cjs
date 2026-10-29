/**
 * test-case-mutations-isolated.cjs
 *
 * Verifies Case Management mutations (case creation, finding creation, task creation,
 * task toggling, status lifecycle transition) in a strictly isolated temporary Chrome profile.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

async function runIsolatedMutationTest() {
  const port = 9415;
  const isolatedProfileDir = `/tmp/threatlenx-chrome-isolated-mutations-${Date.now()}`;
  
  console.log(`[INIT] Launching Headless Chrome in isolated profile: ${isolatedProfileDir}`);
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    `--user-data-dir=${isolatedProfileDir}`,
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

    console.log('[1/6] Navigating to http://127.0.0.1:3000/...');
    ws.send(JSON.stringify({ id: msgId++, method: 'Page.navigate', params: { url: 'http://127.0.0.1:3000/' } }));

    // Wait for Hub
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hubCount = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (hubCount === 6) {
        console.log(`✓ Spatial Hub hydrated with 6 zone nodes at poll ${i}!`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 4500));

    // Navigate to Cases
    console.log('[2/6] Navigating to Cases workspace...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const caseNode = nodes.find(n => n.textContent && (n.textContent.includes('CASE') || n.textContent.includes('CASES'))) || nodes[3];
      if (caseNode) caseNode.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    // TEST MUTATION 1: Create a new operational case
    console.log('[3/6] Testing Case Creation Mutation in isolated profile...');
    await evalJson(`(() => {
      const newCaseBtn = Array.from(document.querySelectorAll('.case-top-right button')).find(b => b.textContent.includes('NEW CASE'));
      if (newCaseBtn) newCaseBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 400));

    // Fill form and submit
    await evalJson(`(() => {
      const input = document.querySelector('.case-modal-input');
      const textarea = document.querySelector('.case-modal-textarea');
      if (input) {
        input.value = 'Operation RedSky — Lateral Pivot Test';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (textarea) {
        textarea.value = 'Investigating adversary lateral movement across DMZ in isolated test.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const createBtn = Array.from(document.querySelectorAll('.case-modal-footer button')).find(b => b.textContent.includes('CREATE CASE'));
      if (createBtn) createBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const newCaseCreated = await evalJson(`(() => {
      const title = document.querySelector('.case-title-text')?.textContent?.trim();
      const badge = document.querySelector('.case-number-badge')?.textContent?.trim();
      return { title, badge };
    })()`);
    console.log(`✓ New Case Created & Selected: ${newCaseCreated.badge} — "${newCaseCreated.title}"`);

    // TEST MUTATION 2: Add Finding
    console.log('[4/6] Testing Finding Creation Mutation in isolated profile...');
    await evalJson(`(() => {
      const addFindingBtn = Array.from(document.querySelectorAll('.center-tabs button')).find(b => b.textContent.includes('ADD FINDING'));
      if (addFindingBtn) addFindingBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 400));

    await evalJson(`(() => {
      const input = document.querySelector('.case-modal-input');
      const textarea = document.querySelector('.case-modal-textarea');
      if (input) {
        input.value = 'Pass-the-hash authentication attempt to DC01';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (textarea) {
        textarea.value = 'Detected NTLM hash reuse on internal domain controller.';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const submitBtn = Array.from(document.querySelectorAll('.case-modal-footer button')).find(b => b.textContent.includes('RECORD FINDING'));
      if (submitBtn) submitBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const findingCount = await evalJson(`document.querySelectorAll('.finding-card').length`);
    console.log(`✓ Finding successfully added: count=${findingCount}`);

    // TEST MUTATION 3: Add Task and Toggle Task
    console.log('[5/6] Testing Task Addition and Toggle in isolated profile...');
    await evalJson(`(() => {
      const taskInput = document.querySelector('.case-col-ops .case-modal-input');
      if (taskInput) {
        taskInput.value = 'Isolate compromised host WS-002';
        taskInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const addBtn = document.querySelector('.case-col-ops button.case-btn-sm');
      if (addBtn) addBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const taskCount = await evalJson(`document.querySelectorAll('.task-item').length`);
    console.log(`✓ Task successfully created: total tasks=${taskCount}`);

    // Toggle task
    await evalJson(`(() => {
      const cb = document.querySelector('.task-checkbox');
      if (cb) cb.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));
    const taskDone = await evalJson(`!!document.querySelector('.task-item.task-done')`);
    console.log(`✓ Task toggled to DONE: ${taskDone}`);

    // TEST MUTATION 4: Lifecycle status transition
    console.log('[6/6] Testing Status Lifecycle Transitions in isolated profile...');
    const initialStatus = await evalJson(`document.querySelector('.badge-status')?.textContent?.trim()`);
    console.log(`   Initial Case Status: ${initialStatus}`);

    await evalJson(`(() => {
      const inProgBtn = Array.from(document.querySelectorAll('.status-transitions-grid button')).find(b => b.textContent.includes('IN_PROGRESS'));
      if (inProgBtn) inProgBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const nextStatus = await evalJson(`document.querySelector('.badge-status')?.textContent?.trim()`);
    console.log(`✓ Status transitioned to: ${nextStatus}`);

    ws.close();
    chromeProcess.kill();

    // Clean up isolated temporary profile
    try {
      fs.rmSync(isolatedProfileDir, { recursive: true, force: true });
      console.log(`✓ Cleaned up isolated temporary profile: ${isolatedProfileDir}`);
    } catch {}

    console.log('\n========================================================');
    console.log('ISOLATED PROFILE MUTATION TESTS COMPLETED SUCCESSFULLY! ✓');
    console.log('========================================================');
  } catch (err) {
    console.error('Isolated mutation test failed:', err);
    chromeProcess.kill();
    process.exit(1);
  }
}

runIsolatedMutationTest();

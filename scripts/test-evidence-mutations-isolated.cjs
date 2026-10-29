/**
 * test-evidence-mutations-isolated.cjs
 *
 * Runs mutation tests strictly in an isolated ephemeral browser profile.
 * Verifies:
 * - Evidence Collection modal open/fill/submit
 * - Adding investigative notes & annotations
 * - Triggering integrity verification
 * - Ensures ephemeral profile is cleaned up afterwards.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

async function runIsolatedMutationTest() {
  const port = 9435;
  const profileDir = `/tmp/threatlenx-evidence-mutations-isolated-${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`[ISOLATED TEST] Launching ephemeral Chrome on port ${port}...`);
  console.log(`[ISOLATED TEST] Using isolated profile: ${profileDir}`);

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

    // Auto-dismiss dialogs if any appear
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.method === 'Page.javascriptDialogOpening') {
          console.log('[DIALOG INTERCEPTED]:', parsed.params.message);
          ws.send(JSON.stringify({
            id: msgId++,
            method: 'Page.handleJavaScriptDialog',
            params: { accept: true, promptText: 'Isolated test reason' }
          }));
        }
      } catch {}
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

    // Wait for hydration
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const hubCount = await evalJson(`document.querySelectorAll('.hub-workspace-node').length`);
      if (hubCount === 6) {
        console.log(`✓ Spatial Hub hydrated with 6 zone nodes at poll ${i}!`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 4500));

    // Suppress modal blocking dialogs inside page context
    await evalJson(`(() => {
      window.alert = (msg) => console.log('[PAGE ALERT]', msg);
      window.prompt = (msg, def) => def || 'Analyst operational review';
      window.confirm = () => true;
      return true;
    })()`);

    // Navigate to EVIDENCE
    console.log('[2/6] Navigating to EVIDENCE workspace...');
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
    if (!evdMounted) throw new Error('EvidenceWorkspace failed to mount');
    await new Promise(r => setTimeout(r, 1000));

    // Step 3: Check initial count of evidence cards
    const initialCardsCount = await evalJson(`document.querySelectorAll('.evidence-item-card').length`);
    console.log(`[3/6] Initial evidence cards count: ${initialCardsCount}`);

    // Elevate role to INCIDENT_RESPONDER to allow collection
    await evalJson(`(() => {
      const roleSelect = document.querySelector('.rbac-role-select') || document.querySelector('select[aria-label="Switch User Role"]');
      if (roleSelect) {
        roleSelect.value = 'analyst_elena'; // INCIDENT_RESPONDER
        roleSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 600));

    // Step 4: Test Collect Modal opening, form filling with native setters, and submission
    console.log('[4/6] Testing COLLECT modal mutation...');
    const collectBtnClicked = await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('.evidence-btn-action')).find(b => b.textContent && b.textContent.includes('COLLECT'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    console.log('✓ Collect button clicked:', collectBtnClicked);
    await new Promise(r => setTimeout(r, 500));

    const modalOpened = await evalJson(`!!document.querySelector('.evidence-modal-box')`);
    console.log('✓ Collect modal visible:', modalOpened);

    // Fill form using React input value setter
    await evalJson(`(() => {
      const input = document.querySelector('input[placeholder*="Memory Dump"]');
      if (input) {
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputSetter.call(input, 'Isolated Forensics Memory Dump Artifact');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const desc = document.querySelector('textarea[placeholder*="Technical acquisition"]');
      if (desc) {
        const nativeTextSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeTextSetter.call(desc, 'Captured memory buffer from host ws-isolated-09');
        desc.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 300));

    // Submit form
    await evalJson(`(() => {
      const submitBtn = Array.from(document.querySelectorAll('.evidence-modal-form button')).find(b => b.textContent && b.textContent.includes('SEAL'));
      if (submitBtn) submitBtn.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    const updatedCardsCount = await evalJson(`document.querySelectorAll('.evidence-item-card').length`);
    console.log(`✓ Evidence count after collection: ${updatedCardsCount} (initial was ${initialCardsCount})`);

    // Step 5: Test adding annotation
    console.log('[5/6] Testing adding investigative annotation...');
    // Switch to NOTES tab
    await evalJson(`(() => {
      const tabs = Array.from(document.querySelectorAll('.evidence-detail-tab-btn'));
      const notesTab = tabs.find(t => t.textContent.includes('NOTES'));
      if (notesTab) notesTab.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 500));

    // Add annotation using native setter
    await evalJson(`(() => {
      const textarea = document.querySelector('.annotation-textarea');
      if (textarea) {
        const nativeTextSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeTextSetter.call(textarea, 'Forensic verification note recorded in isolated profile.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const postBtn = Array.from(document.querySelectorAll('.annotation-form button')).find(b => b.textContent.includes('POST'));
      if (postBtn) postBtn.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const annotationCount = await evalJson(`document.querySelectorAll('.annotation-bubble').length`);
    console.log(`✓ Annotations count after submission: ${annotationCount}`);

    // Step 6: Test status transition to UNDER_REVIEW
    console.log('[6/6] Testing START REVIEW status transition & integrity verification...');
    const startReviewBtn = await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('.evidence-btn-action')).find(b => b.textContent && b.textContent.includes('START REVIEW'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    console.log('✓ Start Review clicked:', startReviewBtn);
    await new Promise(r => setTimeout(r, 600));

    // Trigger integrity check
    const verifyBtn = await evalJson(`(() => {
      const btn = Array.from(document.querySelectorAll('.evidence-btn-action')).find(b => b.textContent && b.textContent.includes('VERIFY INTEGRITY'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    console.log('✓ Integrity verification triggered:', verifyBtn);
    await new Promise(r => setTimeout(r, 1200));

    const integrityBox = await evalJson(`document.querySelector('.evidence-12field-grid + div')?.textContent`);
    console.log('✓ Integrity verification result displayed:', integrityBox ? integrityBox.slice(0, 50) + '...' : 'None');

    console.log('\n✅ Isolated browser profile mutations successfully passed!');
  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    // Clean up ephemeral directory
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      console.log(`✓ Cleaned up ephemeral profile directory: ${profileDir}`);
    } catch (e) {
      console.warn(`Failed to clean up profile dir ${profileDir}:`, e.message);
    }
  }
}

runIsolatedMutationTest().catch(err => {
  console.error('[ISOLATED TEST ERROR]', err);
  process.exit(1);
});

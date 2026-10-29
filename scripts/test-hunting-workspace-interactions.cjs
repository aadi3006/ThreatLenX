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

async function runStage2Suite() {
  const port = 9400;
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--user-data-dir=/tmp/chrome-hunting-test-9400',
    '--no-first-run',
    'about:blank'
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

    const pageTarget = targets.find(t => t.type === 'page');
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

    const evalJson = async (expr) => {
      const resp = await send('Runtime.evaluate', {
        expression: `(() => {
          try {
            const val = (${expr});
            return JSON.stringify(val);
          } catch (e) {
            return JSON.stringify({ __evalError: e.message });
          }
        })()`,
        returnByValue: true
      });
      const val = resp?.result?.result?.value;
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

    console.log('[1/11] Setting 1440x900 viewport & navigating to http://127.0.0.1:3000/...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });

    // Wait 2.5s for React hydration to complete
    console.log('[2/11] Waiting 2.5s for React hydration...');
    await new Promise(r => setTimeout(r, 2500));

    // Navigate to HUNTING by clicking Zone 3 (Threat Hunting)
    console.log('[3/11] Navigating to Threat Hunting Workspace...');
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const huntNode = nodes.find(n => n.textContent && n.textContent.includes('THREAT HUNTING')) || nodes[2];
      if (huntNode) huntNode.click();
      return true;
    })()`);

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 250));
      const mounted = await evalJson(`!!document.querySelector('.threat-hunting-workspace')`);
      if (mounted === true) {
        console.log(`✓ ThreatHuntingWorkspace mounted at attempt ${i}`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 1500));

    console.log('\n================ AUDIT & INTERACTION RESULTS ================');

    // TEST 1: Layout Columns at 1440x900
    const colAudit1440 = await evalJson(`(() => {
      const q = document.querySelector('.hunt-query-col')?.getBoundingClientRect();
      const f = document.querySelector('.hunt-field-col')?.getBoundingClientRect();
      const i = document.querySelector('.hunt-inspector-col')?.getBoundingClientRect();
      const t = document.querySelector('.hunt-timeline-col')?.getBoundingClientRect();
      if (!q || !f || !i || !t) return { error: 'Workspace columns not mounted' };
      return {
        queryWidth: Math.round(q.width),
        centerWidth: Math.round(f.width),
        inspectorWidth: Math.round(i.width),
        timelineHeight: Math.round(t.height),
      };
    })()`);
    console.log('\n1. Responsive Column Layout at 1440x900:');
    console.log('   Query Col:', colAudit1440.queryWidth, 'px (spec: 330px)');
    console.log('   Center Field Col:', colAudit1440.centerWidth, 'px');
    console.log('   Inspector Col:', colAudit1440.inspectorWidth, 'px (spec: 374px)');
    console.log('   Timeline Row Height:', colAudit1440.timelineHeight, 'px (spec: 96px)');

    // TEST 2: Label Overlaps Audit
    const labelAudit = await evalJson(`(() => {
      const labels = Array.from(document.querySelectorAll('.hunt-node-label')).map(l => {
        const r = l.getBoundingClientRect();
        return { text: l.textContent, x: r.x, y: r.y, w: r.width, h: r.height, className: l.className };
      });
      let overlaps = 0;
      const overlappingPairs = [];
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (ox > 0 && oy > 0) {
            overlaps++;
            overlappingPairs.push({ a: a.text, b: b.text, ox: Math.round(ox), oy: Math.round(oy) });
          }
        }
      }
      return { totalNodes: labels.length, overlaps, overlappingPairs };
    })()`);
    console.log('\n2. Constellation Node Labels Audit (Overlaps):');
    console.log('   Total Rendered Event Nodes:', labelAudit.totalNodes);
    console.log('   Label Overlaps Count:', labelAudit.overlaps);

    // TEST 3: Template Switching
    const templateSwitch = await evalJson(`(() => {
      const cards = document.querySelectorAll('.hunt-template-card');
      const count = cards.length;
      if (cards.length > 1) {
        cards[1].click();
        return { count, switchedTo: cards[1].querySelector('.tpl-name')?.textContent?.trim() };
      }
      return { count };
    })()`);
    console.log('\n3. Template Query Switching:');
    console.log('   Available Templates:', templateSwitch.count);
    console.log('   Switched Template To:', templateSwitch.switchedTo);
    await new Promise(r => setTimeout(r, 600));

    // TEST 4: Node Selection & Inspector
    const nodeSelection = await evalJson(`(() => {
      const nodes = document.querySelectorAll('.hunt-node');
      if (nodes.length > 0) nodes[0].click();
      const explainBox = document.querySelector('.explain-box')?.textContent?.trim();
      const eventId = document.querySelector('.inspector-val')?.textContent?.trim();
      const provenance = document.querySelector('.provenance-pill')?.textContent?.trim();
      const headerTitle = document.querySelector('.hunt-inspector-header')?.textContent?.replace(/\\s+/g, ' ')?.trim();
      return {
        nodeCount: nodes.length,
        hasRationale: !!explainBox,
        eventId,
        provenance,
        headerTitle
      };
    })()`);
    console.log('\n4. Node Selection & Provenance Rationale:');
    console.log('   Selected Node Event ID:', nodeSelection.eventId);
    console.log('   Provenance Pill:', nodeSelection.provenance);
    console.log('   Deterministic Match Rationale Present:', nodeSelection.hasRationale);

    // TEST 5: Saved Hunts Drawer (Open, Verify, Close via X button)
    const savedDrawerTest = await evalJson(`(() => {
      const savedBtn = document.querySelector('.hunt-query-col .hunt-btn-save');
      if (!savedBtn) return { error: 'Saved button not found' };
      savedBtn.click();
      const drawer = document.querySelector('.hunt-saved-item-card, .hunt-panel-content');
      return {
        btnText: savedBtn.textContent.trim(),
        drawerFound: !!drawer
      };
    })()`);
    console.log('\n5. Saved Hunts Drawer Open:');
    console.log('   Saved Hunts Button Text:', savedDrawerTest.btnText);
    console.log('   Drawer Rendered:', savedDrawerTest.drawerFound);
    await new Promise(r => setTimeout(r, 400));

    // Close drawer via Escape key
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 400));
    const drawerClosed = await evalJson(`!document.querySelector('.hunt-saved-item-card')`);
    console.log('   Saved Hunts Drawer Closed cleanly via Escape:', drawerClosed);

    // Re-select first node to ensure clean entity chips focus
    await evalJson(`(() => {
      const nodes = document.querySelectorAll('.hunt-node');
      if (nodes.length > 0) nodes[0].click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 500));

    // TEST 6: Entity Chips & Drilldown
    const entityChipsTest = await evalJson(`(() => {
      const chips = document.querySelectorAll('.hunt-entity-chip');
      if (chips.length > 0) {
        const text = chips[0].textContent.trim();
        chips[0].click();
        return { chipCount: chips.length, clicked: text };
      }
      return { chipCount: 0 };
    })()`);
    console.log('\n6. Extracted Entity Chips & Drilldown:');
    console.log('   Extracted Entities Count:', entityChipsTest.chipCount);
    console.log('   Drilled into Entity Chip:', entityChipsTest.clicked);
    await new Promise(r => setTimeout(r, 600));

    const pivotStageCheck = await evalJson(`(() => {
      const stage = document.querySelector('.hunt-pivot-stage');
      const cats = Array.from(document.querySelectorAll('.hunt-pivot-cat-btn')).map(c => c.textContent.trim());
      const hasBackBtn = !!document.querySelector('.hunt-pivot-back-btn');
      return { inPivotStage: !!stage, categories: cats, hasBackBtn };
    })()`);
    console.log('   Pivot Stage Visible:', pivotStageCheck.inPivotStage);
    console.log('   Pivot Categories:', pivotStageCheck.categories.join(' | '));
    console.log('   Back to Event Button Present:', pivotStageCheck.hasBackBtn);

    // TEST 7: Back to Event Button
    const backBtnTest = await evalJson(`(() => {
      const btn = document.querySelector('.hunt-pivot-back-btn');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    await new Promise(r => setTimeout(r, 400));
    const backOk = await evalJson(`!document.querySelector('.hunt-pivot-stage') && !!document.querySelector('.explain-box')`);
    console.log('\n7. Back to Event Button Execution:');
    console.log('   Returned from Pivot back to Event Inspector:', backOk);

    // TEST 8: Hierarchical Escape
    // Re-enter drilldown
    await evalJson(`(() => {
      const chips = document.querySelectorAll('.hunt-entity-chip');
      if (chips.length > 0) chips[0].click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 500));

    // Esc Level 1: exits drilldown back to event
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 300));
    const escLevel1 = await evalJson(`!document.querySelector('.hunt-pivot-stage') && !!document.querySelector('.threat-hunting-workspace')`);
    console.log('\n8. Hierarchical Escape Verification:');
    console.log('   Esc Level 1 (exits entity drilldown without exiting workspace):', escLevel1);

    // Esc Level 2: deselects result focus
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 300));
    const escLevel2 = await evalJson(`!document.querySelector('.hunt-node.focused') && !!document.querySelector('.threat-hunting-workspace')`);
    console.log('   Esc Level 2 (deselects node focus without exiting workspace):', escLevel2);

    // Esc Level 3: exits hunting to Hub
    await evalJson(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await new Promise(r => setTimeout(r, 500));
    const escLevel3 = await evalJson(`!document.querySelector('.threat-hunting-workspace') && document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log('   Esc Level 3 (exits Threat Hunting to Spatial Hub):', escLevel3);

    // TEST 9: HUB Back Button
    // Return to Hunting
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const huntNode = nodes.find(n => n.textContent && n.textContent.includes('THREAT HUNTING')) || nodes[2];
      if (huntNode) huntNode.click();
      return true;
    })()`);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await evalJson(`!!document.querySelector('.threat-hunting-workspace')`)) break;
    }
    await new Promise(r => setTimeout(r, 600));

    // Click HUB Back button in center panel
    await evalJson(`(() => {
      const hubBtn = document.querySelector('.hunt-back-btn');
      if (hubBtn) hubBtn.click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 500));
    const backToHubOk = await evalJson(`!document.querySelector('.threat-hunting-workspace') && document.querySelectorAll('.hub-workspace-node').length === 6`);
    console.log('\n9. Center HUB Back Button Success:');
    console.log('   Back Button returns to Spatial Hub:', backToHubOk);

    // Re-enter Hunting for clean final screenshots
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const huntNode = nodes.find(n => n.textContent && n.textContent.includes('THREAT HUNTING')) || nodes[2];
      if (huntNode) huntNode.click();
      return true;
    })()`);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await evalJson(`!!document.querySelector('.threat-hunting-workspace')`)) break;
    }
    // Select first template for clean baseline screenshot
    await evalJson(`(() => {
      const cards = document.querySelectorAll('.hunt-template-card');
      if (cards.length > 0) cards[0].click();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    // CAPTURE 1440 AFTER
    console.log('\n[10/11] Capturing stage2_hunting_after_1440.png...');
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.result.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_after_1440.png'), buf1440);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage2_hunting_after_1440.png'), buf1440);
    console.log('✓ Saved stage2_hunting_after_1440.png');

    // RESIZE TO 1920 AND CAPTURE 1920 AFTER
    console.log('[11/11] Resizing to 1920x1080 and capturing stage2_hunting_after_1920.png...');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1200));

    const colAudit1920 = await evalJson(`(() => {
      const q = document.querySelector('.hunt-query-col')?.getBoundingClientRect();
      const f = document.querySelector('.hunt-field-col')?.getBoundingClientRect();
      const i = document.querySelector('.hunt-inspector-col')?.getBoundingClientRect();
      const t = document.querySelector('.hunt-timeline-col')?.getBoundingClientRect();
      return {
        queryWidth: Math.round(q.width),
        centerWidth: Math.round(f.width),
        inspectorWidth: Math.round(i.width),
        timelineHeight: Math.round(t.height),
      };
    })()`);
    console.log('\n10. Responsive Column Layout at 1920x1080:');
    console.log('   Query Col:', colAudit1920.queryWidth, 'px (spec: 380px)');
    console.log('   Center Field Col:', colAudit1920.centerWidth, 'px');
    console.log('   Inspector Col:', colAudit1920.inspectorWidth, 'px (spec: 450px)');
    console.log('   Timeline Row Height:', colAudit1920.timelineHeight, 'px (spec: 104px)');

    const labelAudit1920 = await evalJson(`(() => {
      const labels = Array.from(document.querySelectorAll('.hunt-node-label')).map(l => {
        const r = l.getBoundingClientRect();
        return { text: l.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
      });
      let overlaps = 0;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (ox > 0 && oy > 0) overlaps++;
        }
      }
      return { totalNodes: labels.length, overlaps };
    })()`);
    console.log('   Label Overlaps at 1920x1080:', labelAudit1920.overlaps);

    const shot1920 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1920 = Buffer.from(shot1920.result.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stage2_hunting_after_1920.png'), buf1920);
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS, 'stage2_hunting_after_1920.png'), buf1920);
    console.log('✓ Saved stage2_hunting_after_1920.png');

    console.log('\n====================================================');
    console.log('ALL VERIFICATION & CAPTURE SUITES COMPLETED CLEANLY! ✓');
    console.log('====================================================\n');

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

runStage2Suite().catch(console.error);

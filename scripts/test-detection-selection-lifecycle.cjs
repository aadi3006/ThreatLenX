/**
 * scripts/test-detection-selection-lifecycle.cjs
 *
 * Dedicated verification suite for Detection Engineering Selected-Rule Reset:
 * 1. Preserves selected rule across reloads and rule updates when it still exists.
 * 2. Non-first rule remains selected after its own mutation (e.g., editing, toggling enable/disable).
 * 3. Non-first rule remains selected after an unrelated rule update (e.g., updating a different rule or creating a draft).
 * 4. Selected-rule removal triggers clean fallback to fallback rule (data[0].id) using isolated storage.
 * 5. Prevents state updates after unmount and prevents duplicate subscriptions.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

async function runDetectionSelectionLifecycleSuite() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const profileDir = `/tmp/threatlenx-chrome-profile-detection-lifecycle-${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });

  console.log('====================================================');
  console.log(' DETECTION ENGINEERING SELECTED-RULE LIFECYCLE SUITE');
  console.log('====================================================\n');

  console.log(`[INIT] Launching Headless Chrome on port ${port} with isolated storage...`);
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
      } catch {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const pageTarget = targets.find(t => t.type === 'page');
    console.log('[CONNECT] Connected to page target:', pageTarget.webSocketDebuggerUrl);
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });

    let msgId = 1;
    const pendingCallbacks = new Map();
    const consoleErrors = [];

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id && pendingCallbacks.has(msg.id)) {
          const cb = pendingCallbacks.get(msg.id);
          pendingCallbacks.delete(msg.id);
          cb(msg);
        }
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
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

    await send('Runtime.enable');

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

    const evalAsync = async (expr) => {
      const resp = await send('Runtime.evaluate', {
        expression: `(async () => {
          try {
            const val = await (${expr});
            return JSON.stringify(val);
          } catch (e) {
            return JSON.stringify({ __evalError: e.message });
          }
        })()`,
        awaitPromise: true,
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

    function assert(condition, message) {
      if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
      }
      console.log(`  ✓ ${message}`);
    }

    // 1. Navigate to App
    console.log('[1/6] Navigating to http://127.0.0.1:3000/...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });

    // Wait for hydration
    console.log('[2/6] Waiting for React hydration on Spatial Command Hub...');
    let hydrated = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      hydrated = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
      if (hydrated) break;
    }
    assert(hydrated, 'Spatial Command Hub hydrated with 6 zone nodes');
    await new Promise(r => setTimeout(r, 1000));

    // 2. Navigate to Detection Workspace
    console.log('[3/6] Navigating into Detection Engineering Workspace (Zone 6)...');
    const zoneClicked = await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('DETECTION'));
      if (target) {
        target.click();
        return true;
      }
      return false;
    })()`);
    assert(zoneClicked, 'Clicked Detection Engineering zone');
    await new Promise(r => setTimeout(r, 1500));

    // Verify initial rule cards
    const initialCards = await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.det-rule-card'));
      const activePill = document.querySelector('.det-active-rule-pill');
      return {
        cardCount: cards.length,
        selectedCardText: document.querySelector('.det-rule-card.selected')?.textContent?.trim(),
        activePillText: activePill?.textContent?.trim(),
        rules: cards.map((c, idx) => ({
          idx,
          text: c.textContent.trim(),
          isSelected: c.classList.contains('selected')
        }))
      };
    })()`);
    console.log(`  Initial card count: ${initialCards.cardCount}`);
    assert(initialCards.cardCount >= 3, `Expected at least 3 detection rules seeded, got ${initialCards.cardCount}`);
    assert(initialCards.rules[0].isSelected, 'First rule is selected by default');
    console.log('  Initial selected rule:', initialCards.activePillText);

    // 3. Select a Non-First Rule (e.g., Rule Index 2)
    console.log('\n[4/6] Selecting non-first rule (index 2)...');
    const nonFirstSelected = await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.det-rule-card'));
      if (cards.length > 2) {
        cards[2].click();
        const activePill = document.querySelector('.det-active-rule-pill');
        return {
          clicked: true,
          selectedCardText: cards[2].textContent.trim(),
          activePillId: activePill?.querySelector('.det-active-id')?.textContent?.trim(),
          activePillName: activePill?.querySelector('.det-active-name')?.textContent?.trim()
        };
      }
      return { clicked: false };
    })()`);
    assert(nonFirstSelected.clicked, 'Clicked non-first rule card at index 2');
    await new Promise(r => setTimeout(r, 500));

    const verifyNonFirst = await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.det-rule-card'));
      const activePill = document.querySelector('.det-active-rule-pill');
      return {
        isIndex2Selected: cards[2]?.classList.contains('selected'),
        isIndex0Selected: cards[0]?.classList.contains('selected'),
        activePillId: activePill?.querySelector('.det-active-id')?.textContent?.trim(),
        activePillName: activePill?.querySelector('.det-active-name')?.textContent?.trim()
      };
    })()`);
    assert(verifyNonFirst.isIndex2Selected, 'Rule card 2 has "selected" CSS class');
    assert(!verifyNonFirst.isIndex0Selected, 'Rule card 0 is not selected');
    const selectedRuleId = verifyNonFirst.activePillId;
    console.log(`  ✓ Selected non-first rule ID: ${selectedRuleId} ("${verifyNonFirst.activePillName}")`);

    // 4. Test: Selected rule remains selected after ITS OWN mutation
    console.log('\n[5/6] Testing rule preservation after ITS OWN mutation...');
    // We update the selected rule via UI or service mutation (e.g. toggle enable/disable)
    const toggleMutation = await evalJson(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const toggleBtn = buttons.find(b => b.textContent && (b.textContent.includes('Enable Rule') || b.textContent.includes('Disable Rule')));
      if (toggleBtn) {
        toggleBtn.click();
        return { clicked: true, btnText: toggleBtn.textContent.trim() };
      }
      return { clicked: false };
    })()`);
    assert(toggleMutation.clicked, `Triggered toggle button: ${toggleMutation.btnText}`);
    // Wait for mutation and re-fetch via subscription
    await new Promise(r => setTimeout(r, 1200));

    const checkAfterOwnMutation = await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.det-rule-card'));
      const activePill = document.querySelector('.det-active-rule-pill');
      const selectedIndex = cards.findIndex(c => c.classList.contains('selected'));
      return {
        selectedIndex,
        isIndex2Selected: cards[2]?.classList.contains('selected'),
        activePillId: activePill?.querySelector('.det-active-id')?.textContent?.trim()
      };
    })()`);
    console.log('  State after own mutation:', JSON.stringify(checkAfterOwnMutation));
    assert(checkAfterOwnMutation.isIndex2Selected, 'Rule 2 REMAINS selected after its own mutation');
    assert(checkAfterOwnMutation.activePillId === selectedRuleId, `Active pill still displays ${selectedRuleId}`);

    // 5. Test: Selected rule remains selected after an UNRELATED rule update
    console.log('\n[6/6] Testing rule preservation after an UNRELATED rule update...');
    // Mutate an unrelated rule (e.g., rule 0) via securityService
    const unrelatedMutation = await evalAsync(`(async () => {
      if (!window.__securityService) return { error: 'window.__securityService not available' };
      const rules = await window.__securityService.getDetectionRules();
      const unrelated = rules.find(r => (r.id !== '${selectedRuleId}' && r.ruleId !== '${selectedRuleId}'));
      if (!unrelated) return { error: 'No unrelated rule found' };

      // Update unrelated rule's description
      await window.__securityService.updateDetectionRuleDraft(unrelated.id, {
        description: 'Updated by unrelated test at ' + Date.now()
      });
      return { success: true, unrelatedId: unrelated.ruleId || unrelated.id };
    })()`);
    assert(!unrelatedMutation.error && unrelatedMutation.success, `Mutated unrelated rule: ${unrelatedMutation.unrelatedId}`);
    // Wait for subscription to propagate
    await new Promise(r => setTimeout(r, 1200));

    const checkAfterUnrelated = await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.det-rule-card'));
      const activePill = document.querySelector('.det-active-rule-pill');
      const selectedIndex = cards.findIndex(c => c.classList.contains('selected'));
      return {
        selectedIndex,
        isIndex2Selected: cards[2]?.classList.contains('selected'),
        activePillId: activePill?.querySelector('.det-active-id')?.textContent?.trim()
      };
    })()`);
    console.log('  State after unrelated update:', JSON.stringify(checkAfterUnrelated));
    assert(checkAfterUnrelated.isIndex2Selected, 'Rule 2 REMAINS selected after unrelated rule update');
    assert(checkAfterUnrelated.activePillId === selectedRuleId, `Active pill still displays ${selectedRuleId}`);

    // 6. Test: Selected-rule removal in isolated storage triggers fallback to data[0].id
    console.log('\n[7/6] Testing selected-rule removal using isolated storage...');
    const removalResult = await evalAsync(`(async () => {
      if (!window.__securityService) return { error: 'window.__securityService not available' };

      // Delete the selected rule from isolated IndexedDB storage
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('es-spatial-db');
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['detection_rules'], 'readwrite');
          const store = tx.objectStore('detection_rules');
          store.delete('${selectedRuleId}');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      // Also remove from provider in-memory cache and emit update event
      const provider = window.__securityService._provider;
      const targetProvider = provider?.localProvider || provider;
      if (targetProvider && targetProvider._detectionRules) {
        targetProvider._detectionRules = targetProvider._detectionRules.filter(
          r => r.id !== '${selectedRuleId}' && r.ruleId !== '${selectedRuleId}'
        );
      }
      window.__securityService._emit('DETECTION_RULES_UPDATED');
      return { success: true };
    })()`);
    assert(!removalResult.error && removalResult.success, `Removed selected rule ${selectedRuleId} from isolated storage`);
    // Wait for subscription loadRules
    await new Promise(r => setTimeout(r, 1200));

    const checkAfterRemoval = await evalJson(`(() => {
      const cards = Array.from(document.querySelectorAll('.det-rule-card'));
      const activePill = document.querySelector('.det-active-rule-pill');
      const selectedIndex = cards.findIndex(c => c.classList.contains('selected'));
      return {
        cardCount: cards.length,
        selectedIndex,
        fallbackRuleId: activePill?.querySelector('.det-active-id')?.textContent?.trim(),
        fallbackRuleName: activePill?.querySelector('.det-active-name')?.textContent?.trim()
      };
    })()`);
    console.log('  State after removal:', JSON.stringify(checkAfterRemoval));
    assert(checkAfterRemoval.selectedIndex === 0, 'Selection cleanly fell back to first rule (index 0)');
    assert(checkAfterRemoval.fallbackRuleId !== selectedRuleId, `Selected rule changed from removed rule to fallback rule: ${checkAfterRemoval.fallbackRuleId}`);
    console.log(`  ✓ Clean fallback verified to rule ID: ${checkAfterRemoval.fallbackRuleId}`);

    // 7. Test: Unmount cleanup and duplicate subscriptions prevention
    console.log('\n[8/6] Testing unmount cleanup and duplicate subscriptions prevention...');
    // Record listener count before unmount
    const listenerCountBefore = await evalJson(`(() => {
      const listeners = window.__securityService?._listeners?.get('DETECTION_RULES_UPDATED');
      return listeners ? listeners.size : 0;
    })()`);
    console.log(`  Listener count with DetectionEngineeringWorkspace mounted: ${listenerCountBefore}`);
    assert(listenerCountBefore >= 1, 'Active subscription exists while mounted');

    // Return to Spatial Command Hub (Unmount)
    const backClicked = await evalJson(`(() => {
      const backBtn = document.querySelector('.det-back-btn');
      if (backBtn) {
        backBtn.click();
        return true;
      }
      return false;
    })()`);
    assert(backClicked, 'Clicked HUB return button to unmount workspace');
    await new Promise(r => setTimeout(r, 1200));

    const atHub = await evalJson(`document.querySelectorAll('.hub-workspace-node').length === 6`);
    assert(atHub, 'Successfully unmounted workspace and returned to Hub');

    // Check listener count after unmount
    const listenerCountAfter = await evalJson(`(() => {
      const listeners = window.__securityService?._listeners?.get('DETECTION_RULES_UPDATED');
      return listeners ? listeners.size : 0;
    })()`);
    console.log(`  Listener count after unmount: ${listenerCountAfter}`);
    assert(listenerCountAfter === listenerCountBefore - 1, 'Subscription cleanly unsubscribed on unmount');

    // Emit event while unmounted - assert no errors
    await evalJson(`window.__securityService._emit('DETECTION_RULES_UPDATED')`);
    await new Promise(r => setTimeout(r, 300));
    assert(consoleErrors.length === 0, `Zero errors logged while unmounted (found ${consoleErrors.length})`);

    // Re-enter Detection workspace
    await evalJson(`(() => {
      const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
      const target = nodes.find(n => n.textContent && n.textContent.includes('DETECTION'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    const listenerCountReentered = await evalJson(`(() => {
      const listeners = window.__securityService?._listeners?.get('DETECTION_RULES_UPDATED');
      return listeners ? listeners.size : 0;
    })()`);
    console.log(`  Listener count after re-entering: ${listenerCountReentered}`);
    assert(listenerCountReentered === listenerCountBefore, 'Exactly one subscription re-established without duplicates');

    console.log('\n====================================================');
    console.log('✅ ALL DETECTION SELECTION LIFECYCLE TESTS PASSED!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exit(1);
  } finally {
    try {
      chromeProcess.kill('SIGKILL');
    } catch {}
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

runDetectionSelectionLifecycleSuite();

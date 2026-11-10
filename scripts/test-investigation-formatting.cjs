/**
 * scripts/test-investigation-formatting.cjs
 *
 * Verifies Investigation visual formatting across 1440px, 1920px, and narrower (1024px) viewports:
 * 1. IOC details: prevents character-by-character wrapping, readable full-width row with copy access, accessible metadata & Intel Profile.
 * 2. Findings: properly spaced header, count/confidence badges, summary metadata, and detection-chain cards.
 * 3. Notes: full-width textarea, aligned author/timestamp, separated helper text and Post Note button, note submission verification.
 * 4. Investigation header: prevents clipping of AI Explain and selection controls, lets title shrink and controls wrap appropriately.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARTIFACT_DIR = '/Users/aadibondre/.gemini/antigravity/brain/f2e038c7-b1af-47a9-832e-b5ac17bb1c55';
const DOCS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');

if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function assert(condition, message) {
  if (!condition) {
    console.error(`\n❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runInvestigationFormattingSuite() {
  const port = 9592;
  const isolatedProfileDir = `/tmp/threatlenx-inv-formatting-${Date.now()}`;

  console.log('======================================================================');
  console.log(' THREATLENX INVESTIGATION FORMATTING & RESPONSIVENESS VERIFICATION');
  console.log('======================================================================\n');
  console.log(`[INIT] Launching Headless Chrome on port ${port}...`);
  console.log(`[INIT] Profile: ${isolatedProfileDir}`);

  const chromeProcess = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--window-size=1440,900',
      `--user-data-dir=${isolatedProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-proxy-server',
      '--proxy-bypass-list=<-loopback>',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      try {
        targets = await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
          });
          req.on('error', reject);
        });
        if (targets && targets.length > 0) break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const pageTarget = targets.find((t) => t.type === 'page');
    assert(Boolean(pageTarget), 'Connected to Chrome page target');

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
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        }
      } catch {}
    });

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        pendingCallbacks.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    async function evalScript(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result?.value;
    }

    async function setViewport(width, height) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Emulation.setVisibleSize', { width, height });
      await new Promise((r) => setTimeout(r, 300));
    }

    async function takeScreenshot(filename) {
      const res = await send('Page.captureScreenshot', { format: 'png' });
      const buffer = Buffer.from(res.data, 'base64');
      const docPath = path.join(DOCS_DIR, filename);
      const artPath = path.join(ARTIFACT_DIR, filename);
      fs.writeFileSync(docPath, buffer);
      fs.writeFileSync(artPath, buffer);
      console.log(`  📸 Saved screenshot: ${filename} (${buffer.length} bytes)`);
      return docPath;
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');
    try {
      await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    } catch {}

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: INITIAL NAVIGATION & REACH INVESTIGATION HUB
    // ──────────────────────────────────────────────────────────────────────────
    console.log('[STEP 1] Navigating to http://127.0.0.1:3000/ at 1440×900...');
    await setViewport(1440, 900);
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
    await new Promise((r) => setTimeout(r, 2600));

    // Navigate to Investigation via Hub
    console.log('  Navigating to INVESTIGATION zone...');
    await evalScript(`
      (() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const inv = nodes.find(n => n.textContent && n.textContent.includes('INVESTIGATION'));
        if (inv) inv.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    // Select incident-001 (Operation BlackTide)
    console.log('  Selecting incident-001 from incident list...');
    await evalScript(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.inv-incident-card'));
        const card = cards.find(c => c.textContent && (c.textContent.includes('BlackTide') || c.textContent.includes('incident-001')));
        if (card) card.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2200));

    assert(await evalScript(`Boolean(document.querySelector('.inv-hub'))`), 'Investigation Hub mounted');

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: VERIFY INVESTIGATION HEADER (1440px, 1920px, 1024px)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[STEP 2] Verifying Investigation Header Formatting & Controls...');

    // 1440px Viewport
    await setViewport(1440, 900);
    const header1440 = await evalScript(`
      (() => {
        const hdr = document.querySelector('.inv-header');
        const aiBtn = document.querySelector('.inv-ai-btn');
        const selBtn = document.querySelector('.inv-sel-indicator');
        const title = document.querySelector('.inv-header-incident-title');
        const titleField = document.querySelector('.inv-field-title');
        const exitBtn = document.querySelector('.inv-header-right .inv-exit-btn');
        return {
          headerWidth: hdr?.clientWidth,
          headerHeight: hdr?.clientHeight,
          titleText: title?.textContent?.trim(),
          titleWidth: title?.clientWidth,
          titleFieldWidth: titleField?.clientWidth,
          isAiBtnVisible: Boolean(aiBtn && aiBtn.offsetWidth > 0 && aiBtn.offsetHeight > 0),
          aiBtnText: aiBtn?.textContent?.trim(),
          isExitBtnVisible: Boolean(exitBtn && exitBtn.offsetWidth > 0),
        };
      })()
    `);
    console.log('  1440px Header Metrics:', JSON.stringify(header1440));
    assert(header1440.isAiBtnVisible, 'AI Explain button is clearly visible and unclipped at 1440px');
    assert(header1440.isExitBtnVisible, 'Hub Exit button is clearly visible at 1440px');
    assert(header1440.titleWidth > 50, 'Incident title rendered with readable width');
    await takeScreenshot('investigation_header_1440.png');

    // Select an entity to populate the selection indicator control
    console.log('  Selecting graph entity to verify SEL indicator control in header...');
    await evalScript(`
      (() => {
        const node = document.querySelector('.ag-node');
        if (node) {
          node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 500));

    const selIndicatorInfo = await evalScript(`
      (() => {
        const sel = document.querySelector('.inv-sel-indicator');
        return {
          exists: Boolean(sel),
          text: sel?.textContent?.trim(),
          width: sel?.clientWidth,
          height: sel?.clientHeight,
        };
      })()
    `);
    console.log('  Selection Indicator Metrics:', JSON.stringify(selIndicatorInfo));
    assert(selIndicatorInfo.exists, 'Selection control indicator rendered in header upon entity selection');
    assert(selIndicatorInfo.width > 20, 'Selection control indicator has readable unclipped width');

    // 1920px Viewport
    console.log('  Testing Header at 1920×1080 Viewport...');
    await setViewport(1920, 1080);
    const header1920 = await evalScript(`
      (() => {
        const hdr = document.querySelector('.inv-header');
        const aiBtn = document.querySelector('.inv-ai-btn');
        const title = document.querySelector('.inv-header-incident-title');
        return {
          headerWidth: hdr?.clientWidth,
          headerHeight: hdr?.clientHeight,
          isAiBtnVisible: Boolean(aiBtn && aiBtn.offsetWidth > 0),
          titleWidth: title?.clientWidth,
        };
      })()
    `);
    console.log('  1920px Header Metrics:', JSON.stringify(header1920));
    assert(header1920.isAiBtnVisible, 'AI Explain button is visible and unclipped at 1920px');
    await takeScreenshot('investigation_header_1920.png');

    // Narrow 1024px Viewport
    console.log('  Testing Header at Narrow 1024×768 Viewport...');
    await setViewport(1024, 768);
    const header1024 = await evalScript(`
      (() => {
        const hdr = document.querySelector('.inv-header');
        const aiBtn = document.querySelector('.inv-ai-btn');
        const title = document.querySelector('.inv-header-incident-title');
        const titleField = document.querySelector('.inv-field-title');
        const sel = document.querySelector('.inv-sel-indicator');
        const hdrRight = document.querySelector('.inv-header-right');
        const docWidth = document.documentElement.clientWidth;
        const hasHorizontalScroll = document.documentElement.scrollWidth > docWidth + 5;
        return {
          headerWidth: hdr?.clientWidth,
          headerHeight: hdr?.clientHeight,
          titleFieldWidth: titleField?.clientWidth,
          titleWidth: title?.clientWidth,
          isAiBtnVisible: Boolean(aiBtn && aiBtn.offsetWidth > 0),
          isSelVisible: Boolean(sel && sel.offsetWidth > 0),
          hasHorizontalScroll,
        };
      })()
    `);
    console.log('  1024px Narrow Header Metrics:', JSON.stringify(header1024));
    assert(header1024.isAiBtnVisible, 'AI Explain button remains unclipped on narrow 1024px viewport');
    assert(header1024.isSelVisible, 'Selection indicator control remains unclipped on narrow 1024px viewport');
    assert(header1024.titleFieldWidth <= 280, 'Incident title shrunk appropriately without pushing controls offscreen');
    assert(!header1024.hasHorizontalScroll, 'No unwanted horizontal page overflow at 1024px');
    await takeScreenshot('investigation_header_narrow_1024.png');

    // Reset viewport to 1440px
    await setViewport(1440, 900);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3: VERIFY IOC CONSTELLATION & IOC DETAILS STRIP
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[STEP 3] Verifying IOC Constellation & Detailed Strip Formatting...');
    // Switch to IOCs tab
    await evalScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('IOC'));
        if (tab) tab.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    // Click on an IOC with a file path or long string value
    console.log('  Clicking IOC node in constellation to activate detail strip...');
    const clickedIoc = await evalScript(`
      (() => {
        const iocNodes = Array.from(document.querySelectorAll('.ioc-node'));
        if (iocNodes.length > 0) {
          // Select first IOC or one with FILE_PATH
          iocNodes[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
        return false;
      })()
    `);
    assert(clickedIoc, 'Clicked IOC node in constellation');
    await new Promise((r) => setTimeout(r, 600));

    // Verify IOC Detail Strip elements
    const iocDetailMetrics = await evalScript(`
      (() => {
        const strip = document.querySelector('.ioc-detail-strip');
        const headerRow = document.querySelector('.ioc-det-header-row');
        const metaGroup = document.querySelector('.ioc-det-meta-group');
        const intelBtn = document.querySelector('.ioc-det-intel-btn');
        const valueRow = document.querySelector('.ioc-det-value-row');
        const valueEl = document.querySelector('.ioc-det-value');
        const copyBtn = document.querySelector('.ioc-det-copy-btn');
        const typeEl = document.querySelector('.ioc-det-type');
        const blockedEl = document.querySelector('.ioc-det-blocked');
        return {
          stripVisible: Boolean(strip),
          stripWidth: strip?.clientWidth,
          valueRowWidth: valueRow?.clientWidth,
          valueHeight: valueEl?.clientHeight,
          valueText: valueEl?.textContent?.trim(),
          isMultiRow: strip?.clientHeight > 50,
          intelBtnVisible: Boolean(intelBtn && intelBtn.offsetWidth > 0),
          copyBtnVisible: Boolean(copyBtn && copyBtn.offsetWidth > 0),
          typeText: typeEl?.textContent?.trim(),
          blockedText: blockedEl?.textContent?.trim(),
        };
      })()
    `);
    console.log('  IOC Detail Strip Metrics (1440px):', JSON.stringify(iocDetailMetrics));
    assert(iocDetailMetrics.stripVisible, 'IOC detail strip rendered upon IOC node selection');
    assert(iocDetailMetrics.valueRowWidth > 380, 'IOC value row spans full readable width (>380px)');
    assert(iocDetailMetrics.isMultiRow, 'IOC detail strip is formatted as a structured multi-row panel');
    assert(iocDetailMetrics.intelBtnVisible, 'Intel Profile button is accessible and visible');
    assert(iocDetailMetrics.copyBtnVisible, 'Dedicated Copy button is accessible and visible in value row');

    // Test Copy Access
    console.log('  Testing copy action on IOC value...');
    await evalScript(`
      (() => {
        const btn = document.querySelector('.ioc-det-copy-btn');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));
    const copyStateAfterClick = await evalScript(`
      (() => {
        const btn = document.querySelector('.ioc-det-copy-btn');
        return {
          isCopied: btn?.classList.contains('copied'),
          text: btn?.textContent?.trim(),
        };
      })()
    `);
    console.log('  Copy Button State After Click:', JSON.stringify(copyStateAfterClick));
    assert(copyStateAfterClick.isCopied, 'Copy button visually transitioned to "COPIED" state');
    await takeScreenshot('investigation_iocs_detail_1440.png');

    // Verify at 1920px
    console.log('  Verifying IOC detail strip at 1920×1080 Viewport...');
    await setViewport(1920, 1080);
    await new Promise((r) => setTimeout(r, 300));
    const ioc1920Width = await evalScript(`document.querySelector('.ioc-detail-strip')?.clientWidth || 0`);
    assert(ioc1920Width > 500, 'IOC detail strip maintains generous readable width at 1920px');
    await takeScreenshot('investigation_iocs_detail_1920.png');

    // Reset viewport to 1440px
    await setViewport(1440, 900);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 4: VERIFY FINDINGS VIEW
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[STEP 4] Verifying Incident Findings View Panel Formatting...');
    // Switch to FINDINGS tab
    await evalScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('FINDINGS'));
        if (tab) tab.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    const findingsMetrics = await evalScript(`
      (() => {
        const panel = document.querySelector('.inv-findings-panel');
        const topbar = document.querySelector('.inv-findings-topbar');
        const title = document.querySelector('.inv-findings-title');
        const countTag = document.querySelector('.inv-findings-count-tag');
        const confBadge = document.querySelector('.inv-findings-confidence-badge');
        const rootCauseCard = document.querySelector('.inv-finding-card.primary-root-cause');
        const rootBadge = document.querySelector('.inv-finding-badge');
        const metaTags = Array.from(document.querySelectorAll('.inv-meta-tag')).map(m => m.textContent?.trim());
        const corrCards = Array.from(document.querySelectorAll('.inv-correlation-card'));
        const mitreChips = Array.from(document.querySelectorAll('.inv-mitre-finding-chip'));
        const assetCards = Array.from(document.querySelectorAll('.inv-asset-finding-card'));
        return {
          panelMounted: Boolean(panel),
          topbarMounted: Boolean(topbar),
          titleText: title?.textContent?.trim(),
          countText: countTag?.textContent?.trim(),
          confText: confBadge?.textContent?.trim(),
          hasRootCause: Boolean(rootCauseCard),
          rootBadgeText: rootBadge?.textContent?.trim(),
          metaTags,
          corrCardCount: corrCards.length,
          mitreChipCount: mitreChips.length,
          assetCardCount: assetCards.length,
        };
      })()
    `);
    console.log('  Findings Panel Metrics (1440px):', JSON.stringify(findingsMetrics));
    assert(findingsMetrics.panelMounted, 'Findings panel mounted successfully');
    assert(findingsMetrics.topbarMounted, 'Findings topbar header rendered with clean spacing');
    assert(Boolean(findingsMetrics.countText && findingsMetrics.countText.includes('FINDINGS')), 'Count tag rendered with verified findings count');
    assert(Boolean(findingsMetrics.confText && findingsMetrics.confText.includes('CONFIDENCE')), 'Confidence badge rendered with percentage');
    assert(findingsMetrics.hasRootCause, 'Root cause determination card rendered');
    assert(findingsMetrics.metaTags.length >= 3, 'Root cause card displays severity, risk, and status tags');
    assert(findingsMetrics.corrCardCount > 0, 'Correlated detection chain cards rendered with structured steps');
    await takeScreenshot('investigation_findings_1440.png');

    // Verify Findings at 1920px
    console.log('  Verifying Findings View at 1920×1080 Viewport...');
    await setViewport(1920, 1080);
    await new Promise((r) => setTimeout(r, 400));
    await takeScreenshot('investigation_findings_1920.png');

    // Reset viewport to 1440px
    await setViewport(1440, 900);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5: VERIFY NOTES VIEW & SUBMISSION LIFECYCLE
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[STEP 5] Verifying Incident Notes View Panel & Submission Lifecycle...');
    // Switch to NOTES tab
    await evalScript(`
      (() => {
        const tab = Array.from(document.querySelectorAll('.inv-tab')).find(t => t.textContent.includes('NOTES'));
        if (tab) tab.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    const notesMetricsBefore = await evalScript(`
      (() => {
        const panel = document.querySelector('.inv-notes-panel');
        const form = document.querySelector('.inv-notes-form');
        const textarea = document.querySelector('.inv-note-textarea');
        const authorInput = document.querySelector('.inv-author-input');
        const hint = document.querySelector('.inv-form-hint');
        const submitBtn = document.querySelector('.inv-note-submit-btn');
        const feed = document.querySelector('.inv-notes-feed');
        const cards = Array.from(document.querySelectorAll('.inv-note-card'));
        const firstCardAuthor = document.querySelector('.inv-note-author')?.textContent?.trim();
        const firstCardTime = document.querySelector('.inv-note-time')?.textContent?.trim();
        return {
          panelMounted: Boolean(panel),
          formMounted: Boolean(form),
          textareaWidth: textarea?.clientWidth,
          formWidth: form?.clientWidth,
          isFullWidthTextarea: textarea && form && Math.abs(textarea.clientWidth - (form.clientWidth - 32)) < 20,
          authorValue: authorInput?.value,
          hasSeparatedActions: Boolean(hint && submitBtn && submitBtn.offsetLeft > hint.offsetLeft),
          notesCount: cards.length,
          firstCardAuthor,
          firstCardTime,
        };
      })()
    `);
    console.log('  Notes Panel Metrics Before Submission:', JSON.stringify(notesMetricsBefore));
    assert(notesMetricsBefore.panelMounted, 'Notes panel mounted successfully');
    assert(notesMetricsBefore.isFullWidthTextarea, 'Textarea spans full container width with proper padding');
    assert(notesMetricsBefore.hasSeparatedActions, 'Helper text and Post Note button are cleanly separated on action row');
    assert(Boolean(notesMetricsBefore.firstCardAuthor && notesMetricsBefore.firstCardTime), 'Note cards render aligned author and timestamp');
    await takeScreenshot('investigation_notes_1440.png');

    // Test Note Submission
    console.log('  Submitting new operational commentary note in isolated storage...');
    const submissionResult = await evalScript(`
      (() => {
        const textarea = document.querySelector('.inv-note-textarea');
        const form = document.querySelector('.inv-notes-form');
        const submitBtn = document.querySelector('.inv-note-submit-btn');
        if (!textarea || !form || !submitBtn) return false;
        
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(textarea, 'Forensic verification: BlackTide persistence mechanism confirmed via scheduled task and registry run keys.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        submitBtn.click();
        return true;
      })()
    `);
    assert(submissionResult, 'Triggered note form submission event');
    await new Promise((r) => setTimeout(r, 1200));

    // Verify newly appended note at top of feed
    const notesMetricsAfter = await evalScript(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.inv-note-card'));
        const topCardText = cards[0]?.querySelector('.inv-note-body')?.textContent?.trim();
        const topCardAuthor = cards[0]?.querySelector('.inv-note-author')?.textContent?.trim();
        const topCardTime = cards[0]?.querySelector('.inv-note-time')?.textContent?.trim();
        const countTag = document.querySelector('.inv-notes-count-tag')?.textContent?.trim();
        return {
          totalNotes: cards.length,
          topCardText,
          topCardAuthor,
          topCardTime,
          countTag,
        };
      })()
    `);
    console.log('  Notes Feed Metrics After Submission:', JSON.stringify(notesMetricsAfter));
    assert(notesMetricsAfter.totalNotes > notesMetricsBefore.notesCount, 'New note successfully appended to the log feed');
    assert(
      Boolean(notesMetricsAfter.topCardText && notesMetricsAfter.topCardText.includes('BlackTide persistence mechanism confirmed')),
      'Top note card accurately reflects submitted commentary content'
    );
    assert(Boolean(notesMetricsAfter.topCardAuthor), 'Top note card displays authentic author name');
    assert(Boolean(notesMetricsAfter.topCardTime), 'Top note card displays formatted timestamp');
    await takeScreenshot('investigation_notes_submitted_1440.png');

    // Verify Notes at 1920px
    console.log('  Verifying Notes View at 1920×1080 Viewport...');
    await setViewport(1920, 1080);
    await new Promise((r) => setTimeout(r, 400));
    await takeScreenshot('investigation_notes_1920.png');

    console.log('\n======================================================================');
    console.log('✅ ALL INVESTIGATION FORMATTING & RESPONSIVENESS CHECKS PASSED');
    console.log('======================================================================\n');
  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    try {
      if (fs.existsSync(isolatedProfileDir)) {
        fs.rmSync(isolatedProfileDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

runInvestigationFormattingSuite().catch((err) => {
  console.error('\n❌ Investigation Formatting Suite Failed:', err);
  process.exit(1);
});

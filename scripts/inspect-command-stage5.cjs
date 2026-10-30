/**
 * scripts/inspect-command-stage5.cjs
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

async function inspectCommandCenter() {
  const port = 9550;
  const profileDir = `/tmp/threatlenx-chrome-inspect-cmd-${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });

  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-proxy-server',
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
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    console.log('[1] Navigating to http://127.0.0.1:3000/...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
    await new Promise(r => setTimeout(r, 2500));

    console.log('[2] Clicking COMMAND CENTER node...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const target = nodes.find(n => n.textContent && n.textContent.includes('COMMAND CENTER'));
        if (target) target.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));

    const evalJson = async (expr) => {
      const resp = await send('Runtime.evaluate', {
        expression: `JSON.stringify((${expr}))`,
        returnByValue: true
      });
      try {
        return JSON.parse(resp?.result?.value);
      } catch {
        return resp?.result?.value;
      }
    };

    const domInfo = await evalJson(`(() => {
      const universe = document.querySelector('.inc-universe');
      const cmdCenter = document.querySelector('.soc-command-center');
      const header = document.querySelector('.soc-top-sector');
      const leftFlank = document.querySelector('.soc-left-flank');
      const rightFlank = document.querySelector('.soc-right-flank');
      const telemetryDock = document.querySelector('.soc-bottom-stream');
      const streamHeader = document.querySelector('.stream-header');
      const streamActions = document.querySelector('.stream-actions');
      const backBtn = document.querySelector('.hub-return-btn');
      const hint = document.querySelector('.inc-universe-hint');
      const nodes = Array.from(document.querySelectorAll('.inc-node')).map(n => {
        const rect = n.getBoundingClientRect();
        return {
          id: n.getAttribute('data-incident-id') || n.id,
          title: n.querySelector('.inc-node-title')?.textContent?.trim() || n.innerText.slice(0, 30),
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      });

      return {
        hasUniverse: !!universe,
        hasCmdCenter: !!cmdCenter,
        hasHeader: !!header,
        headerRect: header ? header.getBoundingClientRect() : null,
        hasLeftFlank: !!leftFlank,
        leftFlankRect: leftFlank ? leftFlank.getBoundingClientRect() : null,
        hasRightFlank: !!rightFlank,
        rightFlankRect: rightFlank ? rightFlank.getBoundingClientRect() : null,
        hasTelemetryDock: !!telemetryDock,
        telemetryDockRect: telemetryDock ? telemetryDock.getBoundingClientRect() : null,
        streamHeaderRect: streamHeader ? streamHeader.getBoundingClientRect() : null,
        streamActionsRect: streamActions ? streamActions.getBoundingClientRect() : null,
        hasBackBtn: !!backBtn,
        backBtnRect: backBtn ? backBtn.getBoundingClientRect() : null,
        hasHint: !!hint,
        hintRect: hint ? hint.getBoundingClientRect() : null,
        nodeCount: nodes.length,
        nodes,
        wrapperClass: document.querySelector('.soc-spatial-wrapper')?.className,
        universeRect: universe ? universe.getBoundingClientRect() : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
        scrollHeight: document.body.scrollHeight,
        clientHeight: document.body.clientHeight
      };
    })()`);

    console.log('Command Center DOM Info:', JSON.stringify(domInfo, null, 2));

    // Capture screenshot at 1440x900
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/test_cmd_1440.png', Buffer.from(shot1440.data, 'base64'));
    console.log('Saved /tmp/test_cmd_1440.png');

  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

inspectCommandCenter().catch(console.error);


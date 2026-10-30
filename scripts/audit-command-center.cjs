/**
 * scripts/audit-command-center.cjs
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

async function auditCommandCenter() {
  const port = 9560;
  const profileDir = `/tmp/threatlenx-chrome-audit-cmd-${Date.now()}`;
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

    const runAuditForViewport = async (w, h) => {
      console.log(`\n================ AUDIT VIEWPORT ${w}x${h} ================`);
      await send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: false
      });
      await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
      await new Promise(r => setTimeout(r, 2500));

      // Click Command Center from Hub
      await evalJson(`(() => {
        const nodes = Array.from(document.querySelectorAll('.hub-workspace-node'));
        const target = nodes.find(n => n.textContent && n.textContent.includes('COMMAND CENTER'));
        if (target) target.click();
      })()`);
      await new Promise(r => setTimeout(r, 1200));

      const audit = await evalJson(`(() => {
        const stage = document.querySelector('.soc-stage-container');
        const universe = document.querySelector('.inc-universe');
        const cmdCenter = document.querySelector('.soc-command-center');
        const topSector = document.querySelector('.soc-top-sector');
        const threatBeacon = document.querySelector('.soc-threat-beacon-wrap');
        const kpiHalo = document.querySelector('.soc-kpi-halo');
        const leftFlank = document.querySelector('.soc-left-flank');
        const rightFlank = document.querySelector('.soc-right-flank');
        const backBtns = Array.from(document.querySelectorAll('.hub-return-btn'));
        const nodes = Array.from(document.querySelectorAll('.inc-node'));

        const getBox = el => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
            r: Math.round(r.right),
            b: Math.round(r.bottom)
          };
        };

        const kpiCells = Array.from(document.querySelectorAll('.kpi-cell')).map(c => {
          const r = c.getBoundingClientRect();
          const lbl = c.querySelector('.kpi-lbl')?.textContent?.trim();
          const num = c.querySelector('.kpi-num')?.textContent?.trim();
          const sub = c.querySelector('.kpi-sub')?.textContent?.trim();
          return {
            lbl, num, sub,
            box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
            isClipped: c.scrollWidth > c.clientWidth || c.scrollHeight > c.clientHeight
          };
        });

        const nodeAudits = nodes.map(n => {
          const box = getBox(n);
          const labelStrip = n.querySelector('.inc-label-strip');
          const titleEl = n.querySelector('.inc-label-title');
          const idEl = n.querySelector('.inc-label-id');
          const hexEl = n.querySelector('.inc-hex');

          // Check overlap with left flank or right flank or top sector
          const overlapsLeft = leftFlank ? (box.x < leftFlank.getBoundingClientRect().right) : false;
          const overlapsRight = rightFlank ? (box.r > rightFlank.getBoundingClientRect().left) : false;
          const overlapsTop = topSector ? (box.y < topSector.getBoundingClientRect().bottom) : false;

          return {
            title: titleEl?.textContent?.trim(),
            id: idEl?.textContent?.trim(),
            box,
            overlapsLeft,
            overlapsRight,
            overlapsTop,
            labelClipped: labelStrip ? labelStrip.scrollWidth > labelStrip.clientWidth : false
          };
        });

        // Check if topSector has wrap/overflow
        const topSectorOverflow = topSector ? (topSector.scrollWidth > topSector.clientWidth) : false;
        const kpiHaloOverflow = kpiHalo ? (kpiHalo.scrollWidth > kpiHalo.clientWidth) : false;

        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          stage: {
            scrollW: stage?.scrollWidth,
            clientW: stage?.clientWidth,
            scrollH: stage?.scrollHeight,
            clientH: stage?.clientHeight,
            hasHScroll: stage ? stage.scrollWidth > stage.clientWidth : false,
            hasVScroll: stage ? stage.scrollHeight > stage.clientHeight : false
          },
          topSector: {
            box: getBox(topSector),
            overflow: topSectorOverflow
          },
          threatBeacon: getBox(threatBeacon),
          kpiHalo: {
            box: getBox(kpiHalo),
            overflow: kpiHaloOverflow,
            cellCount: kpiCells.length
          },
          kpiCells,
          leftFlank: getBox(leftFlank),
          rightFlank: getBox(rightFlank),
          backButtons: backBtns.map(b => ({
            text: b.textContent.trim(),
            box: getBox(b),
            classes: b.className
          })),
          nodes: nodeAudits
        };
      })()`);

      console.log('AUDIT RESULT:', JSON.stringify(audit, null, 2));

      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const filename = `/tmp/cmd_audit_${w}.png`;
      fs.writeFileSync(filename, Buffer.from(shot.data, 'base64'));
      console.log(`Captured ${filename}`);
      return audit;
    };

    await runAuditForViewport(1440, 900);
    await runAuditForViewport(1920, 1080);

  } finally {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

auditCommandCenter().catch(console.error);

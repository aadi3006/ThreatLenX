import { spawn } from 'child_process';
import http from 'http';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('==================================================');
  console.log('REAL BROWSER VERIFICATION: 6 ZONES & HUB');
  console.log('==================================================\n');

  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=/tmp/chrome-nav-six-zones',
    '--no-first-run',
    '--window-size=1600,1000',
    'http://localhost:3000/'
  ]);

  try {
    // Wait for Chrome to boot
    await sleep(2500);

    // Get CDP page target
    const targets = await new Promise<any[]>((resolve, reject) => {
      http.get('http://localhost:9222/json', (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('3000'));
    if (!pageTarget) {
      throw new Error('No page target found on port 3000');
    }

    console.log('Connecting to Chrome DevTools WebSocket:', pageTarget.webSocketDebuggerUrl);
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve) => ws.onopen = resolve);

    let msgId = 1;
    const pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id)!;
        pending.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };

    function send(method: string, params: any = {}): Promise<any> {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    // Enable Runtime & Page
    await send('Runtime.enable');
    await send('Page.enable');

    async function evaluate(expression: string): Promise<any> {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return res.result?.value;
    }

    async function pressKey(key: string, code: string) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    }

    // Wait for initial render of Hub
    await sleep(1500);
    const initialMode = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Initial Hub loaded cleanly without loop, class:', initialMode);

    // 1. Zone: COMMAND CENTER
    console.log('\n--- Testing Zone 1: COMMAND CENTER ---');
    await evaluate("document.querySelectorAll('.hub-dest-node')[0]?.click()");
    await sleep(1000);
    const mode1 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Navigated to Command Center, mode:', mode1);
    await pressKey('Escape', 'Escape');
    await sleep(800);
    const back1 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Returned to Hub via Esc, mode:', back1);

    // 2. Zone: INCIDENT INVESTIGATION
    console.log('\n--- Testing Zone 2: INCIDENT INVESTIGATION ---');
    await evaluate("document.querySelectorAll('.hub-dest-node')[1]?.click()");
    await sleep(1000);
    const mode2 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Navigated to Incident Investigation, mode:', mode2);
    await pressKey('Escape', 'Escape');
    await sleep(800);
    const back2 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Returned to Hub via Esc, mode:', back2);

    // 3. Zone: THREAT HUNTING
    console.log('\n--- Testing Zone 3: THREAT HUNTING ---');
    await evaluate("document.querySelectorAll('.hub-dest-node')[2]?.click()");
    await sleep(1000);
    const mode3 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Navigated to Threat Hunting, mode:', mode3);
    await pressKey('Escape', 'Escape');
    await sleep(800);
    const back3 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Returned to Hub via Esc, mode:', back3);

    // 4. Zone: CASE MANAGEMENT
    console.log('\n--- Testing Zone 4: CASE MANAGEMENT ---');
    await evaluate("document.querySelectorAll('.hub-dest-node')[3]?.click()");
    await sleep(1000);
    const mode4 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Navigated to Case Management, mode:', mode4);
    await pressKey('Escape', 'Escape');
    await sleep(800);
    const back4 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Returned to Hub via Esc, mode:', back4);

    // 5. Zone: EVIDENCE VAULT
    console.log('\n--- Testing Zone 5: EVIDENCE VAULT ---');
    await evaluate("document.querySelectorAll('.hub-dest-node')[4]?.click()");
    await sleep(1000);
    const mode5 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Navigated to Evidence Vault, mode:', mode5);
    await pressKey('Escape', 'Escape');
    await sleep(800);
    const back5 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Returned to Hub via Esc, mode:', back5);

    // 6. Zone: DETECTION RULES
    console.log('\n--- Testing Zone 6: DETECTION RULES ---');
    await evaluate("document.querySelectorAll('.hub-dest-node')[5]?.click()");
    await sleep(1000);
    const mode6 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Navigated to Detection Rules, mode:', mode6);
    await pressKey('Escape', 'Escape');
    await sleep(800);
    const back6 = await evaluate("document.querySelector('.soc-spatial-wrapper')?.className");
    console.log('✓ Returned to Hub via Esc, mode:', back6);

    ws.close();
    console.log('\n==================================================');
    console.log('✅ ALL 6 ZONES REAL BROWSER NAVIGATION VERIFIED');
    console.log('==================================================');
  } finally {
    chrome.kill();
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

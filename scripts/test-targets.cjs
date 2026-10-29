const { spawn } = require('child_process');
const http = require('http');

const port = 9342;
const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-inspect-9342',
  '--no-first-run',
  'http://localhost:3000/'
], { stdio: 'ignore' });

setTimeout(async () => {
  http.get(`http://127.0.0.1:${port}/json`, (r) => {
    let data = '';
    r.on('data', chunk => data += chunk);
    r.on('end', () => {
      console.log('Targets:', JSON.parse(data));
      chromeProcess.kill('SIGKILL');
    });
  });
}, 2500);

const http = require('http');

http.get('http://127.0.0.1:9384/json', (r) => {
  let data = '';
  r.on('data', chunk => data += chunk);
  r.on('end', () => console.log('Targets:', data));
}).on('error', (e) => console.log('Error:', e.message));

// Platin Touch – kleiner Webserver für den eigenen PC (ohne Zusatzpakete, nur Node.js).
//
//   node serve.js                      -> http://localhost:8080 (und die WLAN-Adresse wird angezeigt)
//   node serve.js --rom ..\pokeplatinum.us.nds --port 8080
//
// Liegt eine ROM bereit (../pokeplatinum-touch.nds oder ../build/pokeplatinum.us.nds),
// lädt die App sie automatisch über /__rom. Die ROM wird nur an Geräte in deinem Netz ausgeliefert,
// die diese Seite öffnen – sie wird nirgends hochgeladen.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = +opt('port', 8080);
const ROOT = __dirname;
const romCandidates = [opt('rom', ''), path.join(ROOT, '..', 'pokeplatinum-touch.nds'), path.join(ROOT, '..', 'build', 'pokeplatinum.us.nds'), path.join(ROOT, 'pokeplatinum.us.nds')].filter(Boolean);
const ROM = romCandidates.find((p) => fs.existsSync(p)) || null;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.endsWith('/__rom')) {
    if (!ROM) {
      res.writeHead(404);
      return res.end();
    }
    const st = fs.statSync(ROM);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'X-Rom-Mtime': String(st.mtimeMs | 0), 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(ROM).pipe(res);
  }
  let file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || /\.(nds|sav|dsv)$/i.test(file)) {
    res.writeHead(404);
    return res.end('nicht gefunden');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Platin Touch läuft:');
  console.log('  am PC:      http://localhost:' + PORT);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log('  im WLAN:    http://' + a.address + ':' + PORT);
  }
  console.log(ROM ? '  ROM:        ' + ROM : '  ROM:        keine gefunden – in der App auswählen (oder --rom <Datei>)');
  console.log('Beenden mit Strg+C.');
});

// Ejecuta apps-script/Code.gs tal cual, con imitaciones de los servicios de Google,
// para probar la app de punta a punta sin desplegar nada.
// Uso: node tests/gas-server.js [puerto] [estado.json]
const fs = require('fs'), vm = require('vm'), http = require('http'), crypto = require('crypto'), path = require('path');
const port = Number(process.argv[2] || 8766);
const statePath = process.argv[3] || path.join(__dirname, 'fixture-state.json');

let column = [];
const sheet = {
  getLastRow: () => column.length,
  hideSheet: () => {},
  getRange: (a, c, n) => {
    if (typeof a === 'string') return { getValue: () => column[1] || '' };
    const start = a - 1;
    return {
      setNumberFormat: () => {},
      getValues: () => column.slice(start, start + n).map(v => [v]),
      setValues: rows => { rows.forEach((r, i) => { column[start + i] = r[0]; }); while (column.length && column[column.length - 1] === '') column.pop(); }
    };
  }
};
const initial = fs.readFileSync(statePath, 'utf8');
column = ['MI_DINERO_STATE_V1', '2026-11-01T00:00:00.000Z', initial];
const props = {};
const ctx = {
  JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, console, encodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'dueno@ejemplo.com' }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Logger: { log: console.log },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s).digest()].map(b => (b > 127 ? b - 256 : b))
  },
  UrlFetchApp: {
    // Token de Google simulado: "fake:<correo>" (o "fake-otro-cliente:<correo>").
    fetch: url => {
      const tok = decodeURIComponent(url.split('id_token=')[1] || '');
      const m = tok.match(/^fake(-otro-cliente)?:(.+)$/);
      if (!m) return { getResponseCode: () => 400, getContentText: () => '{}' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ aud: m[1] ? 'otro' : vm.runInContext('CLIENT_ID', ctx), email: m[2], email_verified: 'true' }) };
    }
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);

let delayMs = 0;
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url.startsWith('/debug/state')) { res.writeHead(200, cors); return res.end(column.slice(2).join('')); }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => setTimeout(() => {
    const out = req.method === 'GET' ? ctx.doGet() : ctx.doPost({ postData: { contents: body } });
    res.writeHead(200, cors); res.end(out.text);
  }, delayMs));
}).listen(port, "127.0.0.1", () => console.log(`Apps Script simulado en http://localhost:${port}/exec`));

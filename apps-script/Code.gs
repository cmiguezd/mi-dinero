/* Mi Dinero · Google Apps Script. Archivo generado: no editar el bloque SYNC-CORE a mano (viene de sync-core.js). */
/* ==== SYNC-CORE: inicio (este bloque se copia idéntico en apps-script/Code.gs) ==== */
/*
 * Sincronización registro por registro.
 * Cada cambio se describe como una operación con la hora en que se hizo:
 *   up   = crear o editar un registro (transacción, cuenta, préstamo…)
 *   del  = borrar un registro
 *   add / rem = agregar o quitar una categoría
 *   path = marcar o desmarcar un recurrente
 *   set  = cambiar un ajuste general
 * Regla: si dos dispositivos tocan el MISMO registro, gana el cambio más reciente.
 * Cambios en registros distintos se conservan todos.
 */
var SYNC_COLLECTIONS = ["transactions", "accounts", "budgets", "transfers", "loans", "recurrings"];
var SYNC_SKIP_KEYS = { __sync: true, cloud: true, country: true };

function syncClone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function syncSame(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function syncNewId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

function syncDiff(prev, next, at, device) {
  prev = prev || {}; next = next || {};
  var ops = [];
  var push = function (op) { op.at = at; op.dev = device || ""; op.id = op.id || syncNewId(); ops.push(op); };
  SYNC_COLLECTIONS.forEach(function (c) {
    var before = {}, after = {};
    (prev[c] || []).forEach(function (r) { if (r && r.id != null) before[String(r.id)] = r; });
    (next[c] || []).forEach(function (r) { if (r && r.id != null) after[String(r.id)] = r; });
    Object.keys(after).forEach(function (rid) { if (!before[rid] || !syncSame(before[rid], after[rid])) push({ t: "up", c: c, rid: rid, v: syncClone(after[rid]) }); });
    Object.keys(before).forEach(function (rid) { if (!after[rid]) push({ t: "del", c: c, rid: rid }); });
  });
  var pc = Array.isArray(prev.categories) ? prev.categories : [], nc = Array.isArray(next.categories) ? next.categories : [];
  if (Array.isArray(next.categories) || Array.isArray(prev.categories)) {
    nc.forEach(function (v) { if (pc.indexOf(v) < 0) push({ t: "add", k: "categories", v: v }); });
    pc.forEach(function (v) { if (nc.indexOf(v) < 0) push({ t: "rem", k: "categories", v: v }); });
  }
  var prc = prev.recurringChecks || {}, nrc = next.recurringChecks || {};
  var countries = {}; Object.keys(prc).concat(Object.keys(nrc)).forEach(function (k) { countries[k] = true; });
  Object.keys(countries).forEach(function (country) {
    var a = prc[country] || {}, b = nrc[country] || {}, ids = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { ids[k] = true; });
    Object.keys(ids).forEach(function (rid) { if (Boolean(a[rid]) !== Boolean(b[rid])) push({ t: "path", p: ["recurringChecks", country, rid], v: b[rid] ? true : null }); });
  });
  var keys = {}; Object.keys(prev).concat(Object.keys(next)).forEach(function (k) { keys[k] = true; });
  Object.keys(keys).forEach(function (k) {
    if (SYNC_SKIP_KEYS[k] || SYNC_COLLECTIONS.indexOf(k) >= 0 || k === "categories" || k === "recurringChecks") return;
    if (!syncSame(prev[k], next[k])) push({ t: "set", k: k, v: syncClone(next[k]) });
  });
  return ops;
}

/* Aplica operaciones sobre un estado (lo modifica). Devuelve las que no se aplicaron porque
   el mismo registro se cambió después en otro dispositivo. */
function syncApply(state, ops) {
  var meta = state.__sync || (state.__sync = {});
  meta.r = meta.r || {}; meta.d = meta.d || {}; meta.k = meta.k || {}; meta.seen = meta.seen || {};
  var rejected = [];
  (ops || []).forEach(function (op) {
    if (!op || meta.seen[op.id]) return;
    var at = Number(op.at) || 0, key;
    if (op.t === "up" || op.t === "del") {
      key = op.c + ":" + op.rid;
      var last = Math.max(meta.r[key] || 0, meta.d[key] || 0);
      if (at < last) { rejected.push(op); return; }
      var list = state[op.c] || (state[op.c] = []);
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(op.rid)) { idx = i; break; }
      if (op.t === "up") { if (idx >= 0) list[idx] = syncClone(op.v); else list.push(syncClone(op.v)); meta.r[key] = at; delete meta.d[key]; }
      else { if (idx >= 0) list.splice(idx, 1); meta.d[key] = at; delete meta.r[key]; }
    } else if (op.t === "add" || op.t === "rem") {
      key = "cat:" + op.v;
      if (at < (meta.k[key] || 0)) { rejected.push(op); return; }
      var cats = Array.isArray(state.categories) ? state.categories : (state.categories = []);
      var pos = cats.indexOf(op.v);
      if (op.t === "add" && pos < 0) { cats.push(op.v); cats.sort(function (a, b) { return String(a).localeCompare(String(b), "es"); }); }
      if (op.t === "rem" && pos >= 0) cats.splice(pos, 1);
      meta.k[key] = at;
    } else if (op.t === "path") {
      key = "p:" + op.p.join("/");
      if (at < (meta.k[key] || 0)) { rejected.push(op); return; }
      var node = state;
      for (var j = 0; j < op.p.length - 1; j++) { if (!node[op.p[j]] || typeof node[op.p[j]] !== "object") node[op.p[j]] = {}; node = node[op.p[j]]; }
      var leaf = op.p[op.p.length - 1];
      if (op.v === null || op.v === undefined) delete node[leaf]; else node[leaf] = op.v;
      meta.k[key] = at;
    } else if (op.t === "set") {
      key = "k:" + op.k;
      if (at < (meta.k[key] || 0)) { rejected.push(op); return; }
      if (op.v === undefined) delete state[op.k]; else state[op.k] = syncClone(op.v);
      meta.k[key] = at;
    }
    meta.seen[op.id] = at;
  });
  // Recordar operaciones de los últimos 7 días (reintentos) y borrados de los últimos 6 meses.
  var cutoff = Date.now() - 7 * 864e5, old = Date.now() - 180 * 864e5;
  Object.keys(meta.seen).forEach(function (k) { if (meta.seen[k] < cutoff) delete meta.seen[k]; });
  Object.keys(meta.d).forEach(function (k) { if (meta.d[k] < old) delete meta.d[k]; });
  return rejected;
}
/* ==== SYNC-CORE: fin ==== */

/* ===================== Servidor de Mi Dinero ===================== */
/*
 * Instalación (una sola vez): abre tu Google Sheet de Mi Dinero → Extensiones → Apps Script,
 * pega TODO este archivo en Code.gs y publícalo como aplicación web (ver apps-script/README.md).
 * Se ejecuta con TU cuenta y solo acepta dispositivos que vinculaste iniciando sesión con Google.
 */
var CLIENT_ID = "391123335180-vj22bb8f64hqq3mnur27037njseiopfi.apps.googleusercontent.com";
var SHEET_NAME = "_AppState";
var HEADER = "MI_DINERO_STATE_V1";
var CHUNK = 45000;

function doGet() { return json_({ ok: true, app: "mi-dinero", message: "Servidor de Mi Dinero activo." }); }

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action === "pair") return json_(pair_(body));
    var device = auth_(body.token);
    if (!device) return json_({ ok: false, error: "UNAUTHORIZED" });
    if (body.action === "version") return json_({ ok: true, version: readVersion_() });
    if (body.action === "pull") { var s = readState_(); return json_({ ok: true, version: s.version, state: s.state }); }
    if (body.action === "push") return json_(push_(body.ops || []));
    if (body.action === "devices") return json_({ ok: true, devices: listDevices_(device) });
    if (body.action === "revoke") { revoke_(body.deviceId); return json_({ ok: true, devices: listDevices_(device) }); }
    return json_({ ok: false, error: "UNKNOWN_ACTION" });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- Dispositivos vinculados ---------- */
function allowedEmails_() {
  var owner = String(Session.getEffectiveUser().getEmail() || "").toLowerCase();
  var extra = String(PropertiesService.getScriptProperties().getProperty("ALLOWED_EMAILS") || "")
    .split(",").map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  return [owner].concat(extra);
}
function pair_(body) {
  var res = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(body.idToken || ""), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: "INVALID_GOOGLE_TOKEN" };
  var info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID) return { ok: false, error: "WRONG_CLIENT" };
  if (String(info.email_verified) !== "true" || allowedEmails_().indexOf(String(info.email).toLowerCase()) < 0) return { ok: false, error: "NOT_ALLOWED" };
  var token = Utilities.getUuid() + "-" + Utilities.getUuid();
  var id = Utilities.getUuid().slice(0, 8), now = new Date().toISOString();
  var devices = getDevices_();
  devices[hash_(token)] = { id: id, name: String(body.deviceName || "Dispositivo").slice(0, 60), email: info.email, created: now, lastSeen: now };
  saveDevices_(devices);
  return { ok: true, token: token, deviceId: id };
}
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)
    .map(function (b) { return ("0" + ((b + 256) % 256).toString(16)).slice(-2); }).join("");
}
function getDevices_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty("DEVICES") || "{}"); }
function saveDevices_(d) { PropertiesService.getScriptProperties().setProperty("DEVICES", JSON.stringify(d)); }
function auth_(token) {
  if (!token) return null;
  var devices = getDevices_(), h = hash_(String(token)), d = devices[h];
  if (!d) return null;
  if (!d.lastSeen || Date.now() - Date.parse(d.lastSeen) > 3600e3) { d.lastSeen = new Date().toISOString(); devices[h] = d; saveDevices_(devices); }
  return d;
}
function listDevices_(current) {
  var d = getDevices_();
  return Object.keys(d).map(function (k) { var x = d[k]; return { id: x.id, name: x.name, created: x.created, lastSeen: x.lastSeen, current: x.id === current.id }; });
}
function revoke_(id) {
  var d = getDevices_();
  Object.keys(d).forEach(function (k) { if (d[k].id === id) delete d[k]; });
  saveDevices_(d);
}

/* ---------- Lectura y escritura en la hoja (mismo formato que usa la app) ---------- */
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.hideSheet(); }
  return sh;
}
function readVersion_() { return String(sheet_().getRange("A2").getValue() || ""); }
function readState_() {
  var sh = sheet_(), last = sh.getLastRow();
  if (last < 3) return { version: "", state: null };
  var values = sh.getRange(1, 1, last, 1).getValues().map(function (r) { return String(r[0]); });
  if (values[0] !== HEADER) throw new Error("La hoja _AppState no tiene un estado válido de Mi Dinero.");
  return { version: values[1], state: JSON.parse(values.slice(2).join("")) };
}
function chunks_(text) {
  var out = [], i = 0;
  while (i < text.length) {
    var end = Math.min(text.length, i + CHUNK);
    // Ningún trozo puede empezar con = + - @ (la hoja lo tomaría como fórmula).
    while (end < text.length && /[=+\-@]/.test(text.charAt(end)) && end > i + 1) end--;
    out.push(text.slice(i, end)); i = end;
  }
  return out;
}
function writeState_(state, version) {
  var sh = sheet_();
  var rows = [HEADER, version].concat(chunks_(JSON.stringify(state)));
  var total = Math.max(rows.length, sh.getLastRow());
  while (rows.length < total) rows.push("");
  var range = sh.getRange(1, 1, total, 1);
  range.setNumberFormat("@");
  range.setValues(rows.map(function (v) { return [v]; }));
}
function push_(ops) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var cur = readState_();
    var state = cur.state || { version: 3, country: "CN", transactions: [], accounts: [], budgets: [], transfers: [], loans: [], recurrings: [], recurringChecks: {}, settings: {} };
    if (!ops.length) return { ok: true, version: cur.version, state: state, rejected: [] };
    var rejected = syncApply(state, ops);
    var version = new Date().toISOString();
    state.cloud = { updatedAt: version };
    writeState_(state, version);
    return { ok: true, version: version, state: state, rejected: rejected.map(function (o) { return { id: o.id, t: o.t, c: o.c, rid: o.rid, k: o.k }; }) };
  } finally {
    lock.releaseLock();
  }
}

/* Prueba manual desde el editor: Ejecutar → probarLectura. Debe mostrar cuántos movimientos hay. */
function probarLectura() {
  var s = readState_();
  Logger.log("Versión: " + s.version + " · movimientos: " + (s.state ? s.state.transactions.length : 0));
}

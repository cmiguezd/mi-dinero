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

// Escenarios de sincronización entre dispositivos. Uso: node tests/sync.test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { JSON, Date, Math, Object, Array, String, Number, Boolean, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sync-core.js'), 'utf8'), ctx);
const { syncDiff, syncApply } = ctx;
const clone = x => JSON.parse(JSON.stringify(x));
let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log('FALLA:', msg); } };

// Servidor simulado: aplica operaciones con la misma función que el Apps Script.
function makeServer(initial) {
  const srv = { state: clone(initial), version: 1 };
  srv.push = ops => { const rejected = syncApply(srv.state, clone(ops)); srv.version++; return { state: clone(srv.state), version: srv.version, rejected }; };
  return srv;
}
// Dispositivo: guarda local, encola, envía cuando hay conexión, y al bajar re-aplica lo pendiente.
function makeDevice(name, srv, clock) {
  const d = { name, state: clone(srv.state), outbox: [], online: true };
  d.edit = fn => { const prev = clone(d.state); fn(d.state); d.outbox.push(...syncDiff(prev, d.state, clock(), name)); };
  d.sync = () => {
    if (!d.online) return null;
    const res = srv.push(d.outbox); d.outbox = [];
    d.state = res.state; return res.rejected;
  };
  return d;
}
const base = { version: 3, transactions: [{ id: 't1', type: 'gasto', amount: 10, description: 'Didi', category: 'Transporte', date: '2026-11-01', country: 'CN' }], accounts: [], budgets: [], transfers: [], loans: [], recurrings: [{ id: 'r1' }, { id: 'r2' }], categories: ['Alimentación', 'Transporte'], recurringChecks: {}, settings: { user: 'X' } };
let t = Date.now(); const clock = () => ++t;

// 1) Teléfono sin conexión agrega un gasto; computador con conexión agrega otro → se conservan ambos.
{
  const srv = makeServer(base), phone = makeDevice('iphone', srv, clock), pc = makeDevice('pc', srv, clock);
  phone.online = false;
  phone.edit(s => s.transactions.push({ id: 'p1', type: 'gasto', amount: 50, description: 'Hema', category: 'Alimentación', date: '2026-11-02', country: 'CN' }));
  pc.edit(s => s.transactions.push({ id: 'c1', type: 'gasto', amount: 70, description: 'Taobao', category: 'Compras', date: '2026-11-02', country: 'CN' }));
  pc.sync();
  ok(phone.state.transactions.length === 2 && phone.outbox.length === 1, '1: el teléfono offline conserva su cambio local pendiente');
  phone.online = true; phone.sync(); pc.sync();
  const ids = s => s.transactions.map(x => x.id).sort().join(',');
  ok(ids(phone.state) === 'c1,p1,t1' && ids(pc.state) === 'c1,p1,t1', '1: ambos dispositivos terminan con los 3 movimientos');
}
// 2) Mismo movimiento editado en los dos: gana la edición más reciente, y el otro se entera.
{
  const srv = makeServer(base), phone = makeDevice('iphone', srv, clock), pc = makeDevice('pc', srv, clock);
  phone.online = false;
  phone.edit(s => { s.transactions[0].amount = 11; });   // hecho antes
  pc.edit(s => { s.transactions[0].amount = 12; });      // hecho después
  pc.sync(); phone.online = true; const rej = phone.sync(); pc.sync();
  ok(phone.state.transactions[0].amount === 12 && pc.state.transactions[0].amount === 12, '2: gana la edición más reciente (12)');
  ok(rej.length === 1, '2: el teléfono recibe aviso de que su edición más vieja no se aplicó');
}
// 3) Borrado en un dispositivo y edición posterior en otro → gana la acción más reciente (la edición).
{
  const srv = makeServer(base), phone = makeDevice('iphone', srv, clock), pc = makeDevice('pc', srv, clock);
  phone.online = false;
  phone.edit(s => { s.transactions = []; });            // borra primero
  pc.edit(s => { s.transactions[0].amount = 99; });      // edita después
  phone.online = true; phone.sync(); pc.sync(); phone.sync();
  ok(pc.state.transactions.length === 1 && pc.state.transactions[0].amount === 99, '3: la edición posterior gana sobre el borrado anterior');
  // y al revés: edita primero, borra después → queda borrado
  const srv2 = makeServer(base), a = makeDevice('a', srv2, clock), b = makeDevice('b', srv2, clock);
  a.online = false; a.edit(s => { s.transactions[0].amount = 5; }); b.edit(s => { s.transactions = []; }); b.sync(); a.online = true; a.sync();
  ok(a.state.transactions.length === 0, '3: el borrado posterior gana sobre la edición anterior');
}
// 4) Un borrado no "revive" cuando otro dispositivo reenvía su copia vieja completa.
{
  const srv = makeServer(base), a = makeDevice('a', srv, clock), b = makeDevice('b', srv, clock);
  a.edit(s => { s.transactions = []; }); a.sync();
  b.edit(s => { s.transactions.push({ id: 'n1', amount: 1 }); }); b.sync();
  ok(b.state.transactions.map(x => x.id).join() === 'n1', '4: el movimiento borrado no reaparece');
}
// 5) Checks de recurrentes distintos en cada dispositivo → se conservan ambos.
{
  const srv = makeServer(base), a = makeDevice('a', srv, clock), b = makeDevice('b', srv, clock);
  a.online = false;
  a.edit(s => { s.recurringChecks = { CN: { r1: true } }; });
  b.edit(s => { s.recurringChecks = { CN: { r2: true } }; }); b.sync(); a.online = true; a.sync(); b.sync();
  ok(a.state.recurringChecks.CN.r1 && a.state.recurringChecks.CN.r2 && b.state.recurringChecks.CN.r1, '5: ambos checks se conservan');
}
// 6) Categorías nuevas creadas en cada dispositivo → aparecen ambas.
{
  const srv = makeServer(base), a = makeDevice('a', srv, clock), b = makeDevice('b', srv, clock);
  a.online = false;
  a.edit(s => { s.categories.push('Mascotas'); }); b.edit(s => { s.categories.push('Gimnasio'); }); b.sync(); a.online = true; a.sync(); b.sync();
  ok(b.state.categories.includes('Mascotas') && b.state.categories.includes('Gimnasio'), '6: ambas categorías nuevas quedan');
}
// 7) Reintento: si el envío llegó pero la respuesta se perdió, reenviar no duplica nada.
{
  const srv = makeServer(base), a = makeDevice('a', srv, clock);
  a.edit(s => s.transactions.push({ id: 'x1', amount: 3 }));
  const ops = clone(a.outbox); srv.push(ops); const res = srv.push(ops);
  ok(res.state.transactions.filter(x => x.id === 'x1').length === 1, '7: reenviar las mismas operaciones no duplica');
}
// 8) Abono de préstamo: crea transacción + actualiza préstamo → ambos viajan juntos.
{
  const s0 = clone(base); s0.loans = [{ id: 'l1', amount: 100, balance: 100, payments: [] }];
  const srv = makeServer(s0), a = makeDevice('a', srv, clock), b = makeDevice('b', srv, clock);
  a.online = false;
  a.edit(s => { s.loans[0].balance = 80; s.loans[0].payments.push({ id: 'lp1', amount: 20, transactionId: 'tx9' }); s.transactions.push({ id: 'tx9', type: 'ajuste', amount: 20, cashEffect: -20, loanId: 'l1' }); });
  a.online = true; a.sync(); b.sync();
  ok(b.state.loans[0].balance === 80 && b.state.transactions.some(x => x.id === 'tx9'), '8: abono y su movimiento llegan juntos');
}
console.log(fails ? `${fails} de ${n} pruebas FALLARON` : `OK: ${n} pruebas de sincronización`);
if (fails) process.exit(1);

// El bloque de sincronización del Apps Script debe ser idéntico al de la app.
{
  const core = s => s.slice(s.indexOf('/* ==== SYNC-CORE: inicio'), s.indexOf('/* ==== SYNC-CORE: fin ==== */'));
  const a = core(fs.readFileSync(path.join(__dirname, '..', 'sync-core.js'), 'utf8')), b = core(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'));
  if (a !== b || !a.length) { console.log('FALLA: apps-script/Code.gs no tiene el mismo núcleo que sync-core.js'); process.exit(1); }
  console.log('OK: Code.gs usa el mismo núcleo de sincronización');
}

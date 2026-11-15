// Uso: node calc-snapshot.js <app.js> <state.json> [--migrate]
// Carga app.js con un DOM simulado y vuelca los resultados de todas las funciones de cálculo.
const fs = require('fs'), vm = require('vm');
const [appPath, statePath] = process.argv.slice(2);
const migrate = process.argv.includes('--migrate');
const el = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : k === Symbol.iterator ? [][Symbol.iterator] : el, apply: () => el, set: () => true, construct: () => el });
const store = {};
const storage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const ctx = { console, structuredClone, Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, Symbol, Promise, setTimeout, clearTimeout, URL, Blob: function () {},
  localStorage: storage, sessionStorage: storage, requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false }), addEventListener: () => {}, scrollTo: () => {}, confirm: () => false,
  document: { querySelector: () => el, querySelectorAll: () => [], getElementById: () => el, createElement: () => el, addEventListener: () => {}, documentElement: el, body: el, contains: () => false } };
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
ctx.MI_DINERO_INITIAL_DATA = state;
if (process.env.PRELOAD) vm.runInContext(fs.readFileSync(process.env.PRELOAD, 'utf8'), ctx, { filename: process.env.PRELOAD });
vm.runInContext(fs.readFileSync(appPath, 'utf8'), ctx, { filename: appPath });
const out = vm.runInContext(`(() => {
  state = { ...blankState(), ...structuredClone(window.MI_DINERO_INITIAL_DATA) };
  if (${migrate} && typeof migrateMerchantDetail === 'function') migrateMerchantDetail(state);
  const R = {};
  const months = [...new Set(state.transactions.map(x => x.date.slice(0, 7)))].sort();
  for (const c of ['CN', 'CO']) {
    state.country = c;
    for (const ym of months) {
      const [y, m] = ym.split('-');
      dashboardYear = y; dashboardMonth = m; dashboardCategory = ''; dashboardMerchant = '';
      const periodTx = dashboardTransactions({ ignoreCategory: true });
      R[c + ':' + ym] = {
        balance: calculateMonthlyBalance(y, m, c, periodTx),
        opening: openingBalanceForMonth(y, m, c),
        totals: totals(dashboardTransactions()),
        groups: expenseGroups(periodTx),
        spentAlim: spentByCategory('Alimentación'),
        daily: typeof dailyBalancePoints === 'function' ? (dailyBalancePoints() || []).map(p => Math.round(p.value * 100) / 100) : [...dailyBalanceChart().matchAll(/aria-label="(?:Inicio|Día \\d+) · ([^"]+)"/g)].map(x => Math.round(Number(x[1].replace(/[^0-9.\u2212-]/g, '').replace('\u2212', '-')) * 100) / 100)
      };
    }
    dashboardMonth = 'all';
    for (const y of [...new Set(months.map(x => x.slice(0, 4)))]) { dashboardYear = y; R[c + ':' + y] = { totals: totals(dashboardTransactions()), groups: expenseGroups(dashboardTransactions({ ignoreCategory: true })) }; }
    R[c + ':latest'] = latestDashboardBalance(c);
    R[c + ':alltime'] = totals();
  }
  R.loans = state.loans.map(l => ({ id: l.id, history: loanPaymentHistory(l).map(p => [p.amount, p.date, !!p.untracked]) }));
  R.loanGroups = loanEntityGroups(state.loans).map(g => [g.key, g.amount, g.balance, g.paid]);
  return JSON.stringify(R);
})()`, ctx);
process.stdout.write(out);

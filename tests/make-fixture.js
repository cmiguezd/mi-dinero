// Genera un estado sintético realista para pruebas de cálculos (no son datos reales).
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const r2 = v => Math.round(v * 100) / 100;
const pad = n => String(n).padStart(2, '0');
let n = 0; const id = p => `${p}_${++n}`;
const S = { version: 3, country: 'CN', transactions: [], accounts: [], budgets: [], transfers: [], loans: [], recurrings: [], recurringChecks: {}, settings: { user: 'Prueba', email: 'x', dataSource: 'x' } };
const MERCH = {
  CN: [['Didi', 'Transporte', 15, 45], ['Hema Supermercado', 'Alimentación', 80, 300], ['Luckin Coffee', 'Alimentación', 15, 30], ['Meituan', 'Alimentación', 40, 120], ['Taobao', 'Compras', 50, 600], ['Taobao · audífonos', 'Compras', 200, 400], ['Almuerzo en Wagas', 'Alimentación', 60, 120], ['China Mobile', 'Servicios', 128, 128], ['Cine Wanda', 'Entretenimiento', 80, 160], ['Farmacia - vitaminas', 'Salud', 40, 150], ['Comisión ICBC', 'Comisión bancaria', 5, 15]],
  CO: [['Uber', 'Transporte', 12000, 40000], ['Éxito', 'Alimentación', 80000, 350000], ['Rappi', 'Alimentación', 30000, 90000], ['Claro hogar', 'Servicios', 129900, 129900], ['Falabella: zapatos', 'Compras', 150000, 300000], ['Droguería', 'Salud', 20000, 90000], ['Administración edificio', 'Vivienda', 385000, 385000]]
};
const months = []; for (let i = 0; i < 13; i++) { const d = new Date(Date.UTC(2025, 10 + i, 1)); months.push([d.getUTCFullYear(), d.getUTCMonth() + 1]); }
const bal = { CN: 15000, CO: 1800000 };
months.forEach(([y, m], mi) => {
  const ym = `${y}-${pad(m)}`;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (const c of ['CN', 'CO']) {
    // saldo trasladado (excepto a veces el primer mes de CO para probar nulos)
    if (!(c === 'CO' && mi === 0)) S.transactions.push({ id: id('t'), country: c, type: 'ajuste', amount: r2(bal[c]), category: 'Ajuste', description: 'Saldo trasladado del mes anterior', date: `${ym}-01` });
    if (c === 'CN') { S.transactions.push({ id: id('t'), country: c, type: 'ingreso', amount: 22000 + (mi % 3) * 1000, category: 'Salario', description: 'Salario', date: `${ym}-05` }); bal.CN += 22000 + (mi % 3) * 1000;
      S.transactions.push({ id: id('t'), country: c, type: 'gasto', amount: 5200, category: 'Vivienda', description: 'Arriendo', date: `${ym}-01` }); bal.CN -= 5200; }
    const count = c === 'CN' ? 30 : 14;
    for (let k = 0; k < count; k++) {
      const [d, cat, lo, hi] = pick(MERCH[c]);
      const amt = c === 'CO' ? Math.round((lo + rnd() * (hi - lo)) / 100) * 100 : r2(lo + rnd() * (hi - lo));
      S.transactions.push({ id: id('t'), country: c, type: 'gasto', amount: amt, category: cat, description: d, date: `${ym}-${pad(1 + Math.floor(rnd() * dim))}` });
      bal[c] -= amt;
    }
    if (rnd() < .5) { const a = c === 'CN' ? r2(30 + rnd() * 100) : 50000; S.transactions.push({ id: id('t'), country: c, type: 'cobro', amount: a, category: 'Compras', description: 'Reembolso Taobao', date: `${ym}-${pad(10)}` }); bal[c] += a; }
    if (mi % 4 === 2) { const a = c === 'CN' ? 300 : 120000; S.transactions.push({ id: id('t'), country: c, type: 'ajuste', amount: a, cashEffect: -a, category: 'Ajuste', description: 'Corrección de saldo', date: `${ym}-20` }); bal[c] -= a; }
  }
  // transferencia CN -> CO
  const sent = 8000 + (mi % 2) * 200, fee = 50, received = Math.round(sent * (525 + rnd() * 20) / 1000) * 1000;
  S.transfers.push({ id: id('x'), from: 'CN', to: 'CO', sent, fee, received, date: `${ym}-08`, arrivalDate: mi % 3 === 0 ? `${ym}-10` : undefined });
  bal.CN -= sent + fee; bal.CO += received;
});
// Préstamos con abonos (algunos con transacción, otros documentales)
const loan1 = { id: id('l'), country: 'CN', direction: 'owed', person: 'Banco ICBC', note: 'Carro', amount: 30000, balance: 30000, date: '2025-11-03', payments: [] };
const loan2 = { id: id('l'), country: 'CN', direction: 'receivable', person: 'Compañero', note: '', amount: 2000, balance: 2000, date: '2026-03-12', payments: [] };
const loan3 = { id: id('l'), country: 'CO', direction: 'owed', person: 'Tío', note: 'Moto', amount: 3000000, balance: 1800000, date: '2025-06-01', payments: [] };
S.loans.push(loan1, loan2, loan3);
S.transactions.push({ id: id('t'), country: 'CN', type: 'ajuste', amount: 30000, cashEffect: 30000, category: 'Préstamos y deudas', description: 'Préstamo recibido · Banco ICBC', date: '2025-11-03', loanId: loan1.id, loanStage: 'opening' });
months.slice(1).forEach(([y, m], i) => {
  const date = `${y}-${pad(m)}-14`, tx = { id: id('t'), country: 'CN', type: 'ajuste', amount: 1500, cashEffect: -1500, category: 'Préstamos y deudas', description: 'Abono pagado · Banco ICBC', date, loanId: loan1.id, loanStage: 'payment' };
  S.transactions.push(tx); loan1.payments.push({ id: id('lp'), amount: 1500, date, affectBalance: true, transactionId: tx.id }); loan1.balance -= 1500;
  if (i % 3 === 0 && i > 3) { loan2.payments.push({ id: id('lp'), amount: 400, date: `${y}-${pad(m)}-20`, affectBalance: false, transactionId: null }); loan2.balance -= 400; }
});
S.transactions.push({ id: id('t'), country: 'CO', type: 'gasto', amount: 200000, category: 'Otros', description: 'Pago deuda tarjeta', date: '2026-04-15' });
S.budgets.push({ id: id('b'), country: 'CN', category: 'Alimentación', amount: 3000 }, { id: id('b'), country: 'CN', category: 'Transporte', amount: 800 }, { id: id('b'), country: 'CN', category: 'Compras', amount: 1500 }, { id: id('b'), country: 'CO', category: 'Alimentación', amount: 900000 });
S.accounts.push({ id: id('a'), country: 'CN', name: 'ICBC', balance: 12850, updatedAt: '2026-11-13T10:00:00Z' }, { id: id('a'), country: 'CN', name: 'Alipay', balance: 3420.6, updatedAt: '2026-11-01T10:00:00Z' }, { id: id('a'), country: 'CO', name: 'Nequi', balance: 950000, updatedAt: '2026-11-10T10:00:00Z' });
S.recurrings.push({ id: id('r'), country: 'CN', description: 'Arriendo', type: 'gasto', amount: 5200, frequency: 'Mensual', day: 1 }, { id: id('r'), country: 'CN', description: 'China Mobile', type: 'gasto', amount: 128, frequency: 'Mensual', day: 6 }, { id: id('r'), country: 'CN', description: 'Internet', type: 'gasto', amount: 150, frequency: 'Mensual', day: 18 }, { id: id('r'), country: 'CO', description: 'Administración', type: 'gasto', amount: 385000, frequency: 'Mensual', day: 10 });
S.recurringChecks = { CN: { [S.recurrings[0].id]: true } };
process.stdout.write(JSON.stringify(S));

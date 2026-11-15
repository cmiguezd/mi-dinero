/*
 * Mi Dinero · capa visual (gráficos, formularios y uso histórico).
 * Se carga antes de app.js y usa sus funciones globales en tiempo de ejecución
 * (state, money, meta, calculateMonthlyBalance, etc.). No modifica ningún cálculo:
 * solo los presenta.
 */

/* ---------- Utilidades de moneda ---------- */
function currencyMeta(country = state.country) { return meta[country] || meta.CN; }
function compactMoney(value, country = state.country) {
  const m = currencyMeta(country);
  const n = Number(value) || 0;
  const fmt = new Intl.NumberFormat(country === "CO" ? "es-CO" : "en-US", { notation: "compact", maximumFractionDigits: 1 });
  return `${n < 0 ? "−" : ""}${m.symbol}${fmt.format(Math.abs(n))}`;
}
function moneyStep(country) { return country === "CO" ? "1" : "0.01"; }
function moneyField(label, name, value, country, { help = "", required = true, full = false, extra = "", allowNegative = false } = {}) {
  if (!allowNegative) extra += ' min="0"';
  const m = currencyMeta(country);
  const v = value === undefined || value === null || value === "" ? "" : Number(value);
  return `<div class="field ${full ? "full" : ""}" data-money-field="${name}">
    <label for="mf_${name}">${label}</label>
    <div class="money-input"><span class="money-sym" data-money-sym>${m.symbol}</span><input class="money-value" id="mf_${name}" name="${name}" type="number" inputmode="decimal" step="${moneyStep(country)}" value="${escapeAttr(v)}" data-money-country="${country}" ${required ? "required" : ""} ${extra}><span class="money-code" data-money-code>${m.currency}</span></div>
    <small class="money-preview" data-money-preview>${help ? escapeHtml(help) + " · " : ""}Se guardará como <b>${money(v || 0, country)}</b></small>
  </div>`;
}
function refreshMoneyPreview(input) {
  const field = input.closest("[data-money-field]"); if (!field) return;
  const country = input.dataset.moneyCountry || state.country;
  const b = field.querySelector("[data-money-preview] b");
  if (b) b.textContent = money(Number(input.value) || 0, country);
}
function setMoneyCountry(field, country) {
  if (!field) return;
  const m = currencyMeta(country), input = field.querySelector("input");
  input.dataset.moneyCountry = country; input.step = moneyStep(country);
  field.querySelector("[data-money-sym]").textContent = m.symbol;
  field.querySelector("[data-money-code]").textContent = m.currency;
  refreshMoneyPreview(input);
}

/* ---------- Uso histórico (atajos ordenados por cuántas veces se usan) ---------- */
function monthsWithData(country = state.country) {
  return Math.max(1, new Set(state.transactions.filter(x => x.country === country && x.date).map(x => x.date.slice(0, 7))).size);
}
function categoryUsageFor(country, type) {
  const counts = {};
  state.transactions.forEach(x => {
    if (x.country !== country || !x.category || x.loanId) return;
    if (type && x.type !== type) return;
    counts[x.category] = (counts[x.category] || 0) + 1;
  });
  return counts;
}
function rankedCategories(country, type) {
  const counts = categoryUsageFor(country, type);
  return availableCategories().slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b, "es")).map(name => ({ name, count: counts[name] || 0 }));
}
function usageLabel(count, country) {
  if (!count) return "sin uso";
  const perMonth = count / monthsWithData(country);
  return perMonth >= 1 ? `≈${Math.round(perMonth)}/mes` : `${count} en total`;
}
function topMerchants(country, limit = 5) {
  const map = new Map();
  state.transactions.forEach(x => {
    if (x.country !== country || x.type !== "gasto" || x.loanId || !x.description) return;
    const key = merchantKey(x.description);
    const cur = map.get(key) || { label: String(x.description).trim(), count: 0, cats: {} };
    cur.count++; cur.cats[x.category || ""] = (cur.cats[x.category || ""] || 0) + 1; map.set(key, cur);
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es")).slice(0, limit)
    .map(x => ({ label: x.label, count: x.count, category: Object.entries(x.cats).sort((a, b) => b[1] - a[1])[0]?.[0] || "" }));
}
function topLoanPeople(country, limit = 4) {
  const counts = {};
  state.loans.forEach(l => { if (l.country === country && l.person) { const p = String(l.person).trim(); counts[p] = (counts[p] || 0) + 1; } });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).slice(0, limit).map(x => x[0]);
}

/* ---------- Comercio y detalle: migración del historial ---------- */
const MERCHANT_MIGRATION_VERSION = 1;
function merchantMigrationSkip(x) {
  return !x || x.detail || x.type === "ajuste" || x.loanId || isLoanTransaction(x) || isCarryForwardTransaction(x) || !x.description;
}
function inferMerchantDetail(description, knownMerchants) {
  const text = String(description).trim().replace(/\s+/g, " ");
  // 1) Separadores explícitos: "Taobao · audífonos", "Farmacia - vitaminas", "Falabella: zapatos"
  const sep = text.match(/^(.{2,40}?)(?:\s*·\s*|\s*\|\s*|:\s+|\s[-–—]\s)(.+)$/);
  if (sep && /\p{L}/u.test(sep[1]) && sep[2].trim().length >= 2) return { merchant: sep[1].trim(), detail: sep[2].trim() };
  // 2) "Almuerzo en Wagas" → comercio Wagas, detalle Almuerzo
  const en = text.match(/^(almuerzo|cena|desayuno|compra|compras|pago|mercado|café|cafe)\s+en\s+(.{2,40})$/i);
  if (en) return { merchant: en[2].trim(), detail: en[1].charAt(0).toUpperCase() + en[1].slice(1).toLowerCase() };
  // 3) Empieza por un comercio que ya usas solo: "Taobao audífonos" → Taobao + audífonos
  const lower = text.toLocaleLowerCase("es");
  const known = knownMerchants.filter(k => lower.startsWith(k.key + " ") && text.length > k.label.length + 1).sort((a, b) => b.key.length - a.key.length)[0];
  if (known) return { merchant: known.label, detail: text.slice(known.label.length).trim() };
  return null;
}
function migrateMerchantDetail(target) {
  if (!target || target.merchantMigration?.version >= MERCHANT_MIGRATION_VERSION) return 0;
  const changes = [];
  for (const country of ["CN", "CO"]) {
    const standalone = new Map();
    target.transactions.forEach(x => {
      if (x.country !== country || merchantMigrationSkip(x)) return;
      const t = String(x.description).trim().replace(/\s+/g, " "), k = t.toLocaleLowerCase("es");
      if (!/[·|:]|\s[-–—]\s|\sen\s/.test(t)) standalone.set(k, { key: k, label: t, count: (standalone.get(k)?.count || 0) + 1 });
    });
    const known = [...standalone.values()].filter(x => x.count >= 2 && x.label.length >= 3);
    target.transactions.forEach(x => {
      if (x.country !== country || merchantMigrationSkip(x)) return;
      const r = inferMerchantDetail(x.description, known);
      if (!r || !r.merchant || r.merchant.toLocaleLowerCase("es") === String(x.description).trim().toLocaleLowerCase("es")) return;
      changes.push({ id: x.id, original: x.description });
      x.description = r.merchant; x.detail = r.detail;
    });
  }
  target.merchantMigration = { version: MERCHANT_MIGRATION_VERSION, at: new Date().toISOString(), changes };
  return changes.length;
}
function undoMerchantMigration(target) {
  const changes = target.merchantMigration?.changes || [];
  const byId = new Map(changes.map(c => [c.id, c.original]));
  target.transactions.forEach(x => { if (byId.has(x.id)) { x.description = byId.get(x.id); delete x.detail; } });
  target.merchantMigration = { version: MERCHANT_MIGRATION_VERSION, at: new Date().toISOString(), changes: [], undone: true };
  return byId.size;
}

/* ---------- Datos para el Resumen ---------- */
function periodMonths() {
  if (dashboardMonth !== "all") return [`${dashboardYear}-${dashboardMonth}`];
  return Array.from({ length: 12 }, (_, i) => `${dashboardYear}-${String(i + 1).padStart(2, "0")}`);
}
function monthFlow(monthsList, country = state.country) {
  const set = new Set(monthsList);
  const f = { income: 0, received: 0, loanIn: 0, adjustIn: 0, expense: 0, sent: 0, loanOut: 0, adjustOut: 0, sentCount: 0, receivedCount: 0 };
  state.transactions.forEach(x => {
    if (x.country !== country || !x.date || !set.has(x.date.slice(0, 7)) || isCarryForwardTransaction(x)) return;
    const amount = Number(x.amount) || 0;
    if (isLoanTransaction(x)) { const v = transactionCashChange(x); if (v >= 0) f.loanIn += v; else f.loanOut -= v; return; }
    if (x.type === "ingreso" || x.type === "cobro") f.income += amount;
    else if (x.type === "gasto") f.expense += amount;
    else if (x.type === "ajuste") { const v = transactionCashChange(x); if (v >= 0) f.adjustIn += v; else f.adjustOut -= v; }
  });
  state.transfers.forEach(x => {
    if (x.from === country && x.date && set.has(x.date.slice(0, 7))) { f.sent += (Number(x.sent) || 0) + (Number(x.fee) || 0); f.sentCount++; }
    const rd = x.arrivalDate || x.date;
    if (x.to === country && rd && set.has(rd.slice(0, 7))) { f.received += Number(x.received) || 0; f.receivedCount++; }
  });
  f.totalIn = f.income + f.received + f.loanIn + f.adjustIn;
  f.totalOut = f.expense + f.sent + f.loanOut + f.adjustOut;
  f.net = f.totalIn - f.totalOut;
  return f;
}
function lastMonthWithData(year, country = state.country) {
  const months = state.transactions.filter(x => x.country === country && x.date?.startsWith(`${year}-`)).map(x => x.date.slice(5, 7));
  return months.length ? months.sort().pop() : null;
}
function periodBalance() {
  const country = state.country;
  const month = dashboardMonth !== "all" ? dashboardMonth : lastMonthWithData(dashboardYear, country);
  if (!month) return null;
  const tx = state.transactions.filter(x => x.country === country && x.date?.slice(0, 7) === `${dashboardYear}-${month}`);
  return { ...calculateMonthlyBalance(dashboardYear, month, country, tx), month };
}
/* Misma matemática que el gráfico diario original: solo cambia la presentación. */
function dailyBalancePoints() {
  if (dashboardMonth === "all") return null;
  const opening = openingBalanceForMonth(dashboardYear, dashboardMonth);
  if (opening === null) return null;
  const ym = `${dashboardYear}-${dashboardMonth}`;
  const now = new Date();
  const daysInMonth = new Date(Number(dashboardYear), Number(dashboardMonth), 0).getDate();
  const isCurrentMonth = String(now.getFullYear()) === dashboardYear && String(now.getMonth() + 1).padStart(2, "0") === dashboardMonth;
  const maxDay = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
  const changes = Array.from({ length: maxDay + 1 }, () => 0);
  countryItems(state.transactions).forEach(x => {
    if (!x.date?.startsWith(ym) || isCarryForwardTransaction(x)) return;
    const day = Number(x.date.slice(8, 10));
    if (day < 1 || day > maxDay) return;
    changes[day] += transactionCashChange(x);
  });
  state.transfers.forEach(x => {
    if (x.from === state.country && x.date?.startsWith(ym)) {
      const day = Number(x.date.slice(8, 10));
      if (day >= 1 && day <= maxDay) changes[day] -= (Number(x.sent) || 0) + (Number(x.fee) || 0);
    }
    const receivedDate = x.arrivalDate || x.date;
    if (x.to === state.country && receivedDate?.startsWith(ym)) {
      const day = Number(receivedDate.slice(8, 10));
      if (day >= 1 && day <= maxDay) changes[day] += Number(x.received) || 0;
    }
  });
  const next = shiftedMonth(dashboardYear, dashboardMonth, 1);
  const recordedClosing = openingBalanceForMonth(next.year, next.month);
  const points = [{ day: 0, label: "Inicio", value: opening }];
  let running = opening;
  for (let day = 1; day <= maxDay; day++) { running += changes[day]; points.push({ day, label: `Día ${day}`, value: running }); }
  if (recordedClosing !== null && !isCurrentMonth && points.length > 1) points[points.length - 1].value = recordedClosing;
  return points;
}
function dailyEvents(maxDay) {
  const ym = `${dashboardYear}-${dashboardMonth}`, ev = [];
  const tx = countryItems(state.transactions).filter(x => x.date?.startsWith(ym) && !isCarryForwardTransaction(x));
  const incomes = tx.filter(x => (x.type === "ingreso") && !isLoanTransaction(x)).sort((a, b) => Number(b.amount) - Number(a.amount));
  if (incomes[0]) ev.push({ day: Number(incomes[0].date.slice(8, 10)), kind: "inc", text: `${incomes[0].description || "Ingreso"} · +${money(incomes[0].amount)}` });
  tx.filter(isLoanTransaction).forEach(x => ev.push({ day: Number(x.date.slice(8, 10)), kind: "loan", text: `${x.description || "Préstamo"} · ${signedMoney(transactionCashChange(x))}` }));
  state.transfers.forEach(x => {
    if (x.from === state.country && x.date?.startsWith(ym)) ev.push({ day: Number(x.date.slice(8, 10)), kind: "snd", text: `Envío a ${meta[x.to].name} · −${money((Number(x.sent) || 0) + (Number(x.fee) || 0))}` });
    const rd = x.arrivalDate || x.date;
    if (x.to === state.country && rd?.startsWith(ym)) ev.push({ day: Number(rd.slice(8, 10)), kind: "snd", text: `Recibido de ${meta[x.from].name} · +${money(x.received)}` });
  });
  return ev.filter(e => e.day >= 1 && e.day <= maxDay);
}

/* ---------- Componentes del Resumen ---------- */
function dot(kind) { return `<i class="dz-dot is-${kind}" aria-hidden="true"></i>`; }
function tip(title, detail = "") { return `data-tip="${escapeAttr(title)}" data-tip-detail="${escapeAttr(detail)}"`; }
function pctChange(cur, prev) {
  if (!prev) return "";
  const d = Math.round((cur - prev) / prev * 100);
  return d === 0 ? "igual que antes" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%`;
}
function previousPeriodMonths() {
  if (dashboardMonth !== "all") { const p = shiftedMonth(dashboardYear, dashboardMonth, -1); return { months: [`${p.year}-${p.month}`], label: p.label.split(" ")[0].toLowerCase() }; }
  const y = String(Number(dashboardYear) - 1);
  return { months: Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`), label: y };
}
function dashKpis(flow, prevFlow, prevLabel, balance) {
  const other = state.country === "CN" ? "CO" : "CN";
  const closing = balance?.closing;
  const closingCard = closing === null || closing === undefined
    ? `<article class="dz-card dz-hero"><p class="dz-eyebrow">Saldo al cierre</p><strong class="dz-hero-value">No disponible</strong><p class="dz-sub">Falta un saldo trasladado para calcularlo.</p></article>`
    : `<article class="dz-card dz-hero"><p class="dz-eyebrow">Saldo al cierre · ${balance.verified ? "conciliado" : "estimado"}</p><strong class="dz-hero-value num">${money(closing)}</strong><p class="dz-sub">${balance.opening !== null ? `<b class="dz-pos num">${signedMoney(closing - balance.opening)}</b> desde el saldo trasladado (${money(balance.opening)})` : "Sin saldo trasladado al inicio"}</p></article>`;
  const transferCard = state.country === "CN" || flow.sent
    ? `<article class="dz-card"><p class="dz-eyebrow">${dot("snd")}Enviado a ${meta[other].name}</p><strong class="dz-value num">${money(flow.sent)}</strong><p class="dz-sub">${flow.sentCount} ${flow.sentCount === 1 ? "envío" : "envíos"} · incluye comisiones</p></article>`
    : `<article class="dz-card"><p class="dz-eyebrow">${dot("snd")}Recibido de ${meta[other].name}</p><strong class="dz-value num">${money(flow.received)}</strong><p class="dz-sub">${flow.receivedCount} ${flow.receivedCount === 1 ? "transferencia" : "transferencias"}</p></article>`;
  return `<section class="dz-kpis" aria-label="Indicadores del periodo">${closingCard}
    <article class="dz-card"><p class="dz-eyebrow">${dot("inc")}Ingresos</p><strong class="dz-value num">${money(flow.income)}</strong><p class="dz-sub">${pctChange(flow.income, prevFlow.income) ? `${pctChange(flow.income, prevFlow.income)} vs ${prevLabel} · ` : ""}sin préstamos</p></article>
    <article class="dz-card"><p class="dz-eyebrow">${dot("exp")}Gastaste</p><strong class="dz-value num">${money(flow.expense)}</strong><p class="dz-sub">${pctChange(flow.expense, prevFlow.expense) ? `${pctChange(flow.expense, prevFlow.expense)} vs ${prevLabel}` : "consumo del periodo"}</p></article>
    ${transferCard}</section>`;
}
function firstMonthWithData(year, country = state.country) {
  const months = state.transactions.filter(x => x.country === country && x.date?.startsWith(`${year}-`)).map(x => x.date.slice(5, 7));
  return months.length ? months.sort()[0] : null;
}
/* Saldo con el que empezó el periodo: el saldo trasladado del mes (o del primer mes del año). */
function periodOpening() {
  if (dashboardMonth !== "all") return openingBalanceForMonth(dashboardYear, dashboardMonth);
  const first = firstMonthWithData(dashboardYear);
  return first ? openingBalanceForMonth(dashboardYear, first) : null;
}
function flowCard(flow, balance) {
  const other = state.country === "CN" ? "CO" : "CN";
  const opening = periodOpening();
  const closing = balance?.closing ?? null;
  const tol = state.country === "CO" ? 1 : 0.01;
  const ins = [["inc", "Ingresos", flow.income, "sin préstamos"], ["snd", `Recibido de ${meta[other].name}`, flow.received, "transferencias"], ["loan", "Préstamos recibidos", flow.loanIn, "no es ingreso"], ["adj", "Ajustes", flow.adjustIn, "correcciones"]].filter(x => x[2] > 0);
  const outs = [["exp", "Gastos", flow.expense, "consumo"], ["snd", `Envíos a ${meta[other].name}`, flow.sent, "no es gasto"], ["loan", "Préstamos", flow.loanOut, "abonos a capital"], ["adj", "Ajustes", flow.adjustOut, "correcciones"]].filter(x => x[2] > 0);
  if (!ins.length && !outs.length && opening === null) return `<article class="dz-panel"><div class="dz-head"><div><h3>Flujo del periodo</h3><p>Lo que entró frente a lo que salió</p></div></div>${empty("Sin movimientos", "No hay entradas ni salidas en este periodo.")}</article>`;
  const hasBalance = opening !== null && closing !== null;
  const top = hasBalance ? [["open", dashboardMonth === "all" ? "Saldo al iniciar el año" : "Saldo del mes anterior", opening, "ya lo tenías"], ...ins] : ins;
  const bottom = hasBalance ? [...outs, ["saldo", "Saldo al cierre", closing, balance.verified ? "conciliado" : "estimado"]] : outs;
  let gapNote = "";
  if (hasBalance) {
    // Si el cierre conciliado no cuadra con lo registrado, la diferencia se muestra para que ambas barras sumen lo mismo.
    const diff = (opening + flow.totalIn) - (flow.totalOut + closing);
    if (Math.abs(diff) >= tol) {
      if (diff > 0) bottom.splice(bottom.length - 1, 0, ["gap", "Salida sin registrar", diff, "falta anotar"]);
      else top.push(["gap", "Entrada sin registrar", -diff, "falta anotar"]);
      gapNote = `<p class="dz-gap"><i class="bi bi-exclamation-circle" aria-hidden="true"></i>El cierre conciliado no cuadra con lo registrado: hay <b class="num">${money(Math.abs(diff))}</b> de ${diff > 0 ? "salida" : "entrada"} sin anotar.</p>`;
    }
  }
  const sum = list => list.reduce((a, x) => a + x[2], 0);
  const topTotal = sum(top), bottomTotal = sum(bottom), scale = Math.max(topTotal, bottomTotal, 1);
  const seg = list => list.map(([k, l, v]) => `<span class="dz-seg is-${k}" style="width:calc(${(v / scale * 100).toFixed(3)}% - 2px)" ${tip(l, money(v))}></span>`).join("");
  const equation = hasBalance ? `<div class="dz-eq" aria-label="Cuenta del periodo">
      <div><span>${dot("open")}${dashboardMonth === "all" ? "Saldo al iniciar" : "Saldo anterior"}</span><strong class="num">${money(opening)}</strong></div><b class="dz-op" aria-hidden="true">+</b>
      <div><span>Entró</span><strong class="num">${money(flow.totalIn)}</strong></div><b class="dz-op" aria-hidden="true">−</b>
      <div><span>Salió</span><strong class="num">${money(flow.totalOut)}</strong></div><b class="dz-op" aria-hidden="true">=</b>
      <div class="is-result"><span>${dot("saldo")}Saldo al cierre</span><strong class="num">${money(closing)}</strong></div>
    </div>` : `<p class="dz-sub">Sin saldo trasladado en este periodo: solo se muestra lo que entró y salió.</p>`;
  const legend = list => list.map(([k, l, v, note]) => `<div><span>${dot(k)}${escapeHtml(l)}</span><strong class="num">${money(v)}</strong><small>${note}</small></div>`).join("");
  return `<article class="dz-panel">
    <div class="dz-head"><div><h3>Flujo del periodo</h3><p>De dónde partiste, qué entró, qué salió y con cuánto cierras</p></div><div class="dz-net"><span>${hasBalance ? "Cambio del saldo" : "Resultado"}</span><strong class="num ${flow.net < 0 ? "is-neg" : ""}">${signedMoney(flow.net)}</strong></div></div>
    ${equation}
    <div class="dz-flow">
      <div class="dz-flow-line"><span class="dz-flow-label">${hasBalance ? "Tenías + entró" : "Entró"}</span><div class="dz-flow-bar">${seg(top)}</div><strong class="num">${money(topTotal)}</strong></div>
      <div class="dz-flow-line"><span class="dz-flow-label">${hasBalance ? "Salió + te quedó" : "Salió"}</span><div class="dz-flow-bar">${seg(bottom)}</div><strong class="num">${money(bottomTotal)}</strong></div>
    </div>
    <div class="dz-flow-legend"><div class="dz-legend-group"><em>De dónde vino</em>${legend(top)}</div><div class="dz-legend-group"><em>A dónde fue</em>${legend(bottom)}</div></div>${gapNote}
    ${hasBalance && flow.net < 0 ? `<p class="dz-sub">Este periodo salió más de lo que entró: la diferencia (${money(-flow.net)}) se cubrió con el saldo que ya tenías.</p>` : ""}
  </article>`;
}
function dailyCard() {
  const head = `<div class="dz-head"><div><h3>Saldo día a día</h3><p>${dashboardMonth === "all" ? "Selecciona un mes para ver cómo se movió tu saldo." : "Los puntos marcan salario, envíos y préstamos"}</p></div>${dashboardMonth === "all" ? "" : `<div class="dz-legend"><span>${dot("inc")}Ingreso</span><span>${dot("snd")}Envío</span><span>${dot("loan")}Préstamo</span></div>`}</div>`;
  if (dashboardMonth === "all") return `<article class="dz-panel">${head}<div class="dz-empty-chart">Elige un mes en el selector de periodo.</div></article>`;
  const points = dailyBalancePoints();
  if (!points) return `<article class="dz-panel">${head}<div class="dz-empty-chart"><strong>Saldo inicial no disponible</strong>Este mes no tiene un saldo trasladado con el cual iniciar el cálculo diario.</div></article>`;
  const values = points.map(p => p.value);
  const rawMin = Math.min(0, ...values), rawMax = Math.max(...values);
  const span = Math.max(1, rawMax - rawMin), min = rawMin, max = rawMax + span * 0.1;
  const X = i => i / Math.max(1, points.length - 1) * 100;
  const Y = v => (1 - (v - min) / (max - min)) * 100;
  const line = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(3)} ${Y(p.value).toFixed(3)}`).join(" ");
  const area = `${line} L100 ${Y(min).toFixed(3)} L0 ${Y(min).toFixed(3)} Z`;
  const ticks = [0, 1, 2, 3].map(i => min + (max - min) * i / 3);
  const lowest = points.reduce((a, p) => p.value < a.value ? p : a, points[0]);
  const events = dailyEvents(points[points.length - 1].day);
  const markers = events.map(e => { const p = points[e.day]; return p ? `<button type="button" class="dz-marker is-${e.kind}" style="left:${X(e.day)}%;top:${Y(p.value)}%" ${tip(`${e.day} de ${periodLabel().split(" ")[0].toLowerCase()}`, `${e.text} · saldo ${money(p.value)}`)} aria-label="${escapeAttr(`Día ${e.day}: ${e.text}`)}"></button>` : ""; }).join("");
  const hits = points.map((p, i) => `<button type="button" class="dz-hit" style="left:${X(i)}%;top:${Y(p.value)}%" ${tip(p.day ? `Día ${p.day}` : "Inicio del mes", money(p.value))} aria-label="${escapeAttr(`${p.label}: ${money(p.value)}`)}"></button>`).join("");
  const xLabels = points.filter((p, i) => i === 1 || i === points.length - 1 || (p.day && p.day % 7 === 1 && p.day < points.length - 3)).map(p => `<span style="left:${X(p.day)}%">${p.day}</span>`).join("");
  return `<article class="dz-panel">${head}
    <div class="dz-line-wrap">
      <div class="dz-yaxis">${ticks.slice().reverse().map(v => `<span>${compactMoney(v)}</span>`).join("")}</div>
      <div class="dz-line" role="img" aria-label="${escapeAttr(`Saldo diario de ${periodLabel()}: empieza en ${money(points[0].value)}, mínimo ${money(lowest.value)} el día ${lowest.day} y termina en ${money(points[points.length - 1].value)}`)}">
        <div class="dz-grid">${ticks.map(() => "<i></i>").join("")}</div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="dzArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--saldo)" stop-opacity=".28"/><stop offset="1" stop-color="var(--saldo)" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#dzArea)"/><path d="${line}" class="dz-line-path" fill="none" vector-effect="non-scaling-stroke"/></svg>
        ${hits}${markers}
      </div>
      <div class="dz-xaxis">${xLabels}</div>
    </div>
    <p class="dz-foot num">Mínimo <b>${money(lowest.value)}</b>${lowest.day ? ` el día ${lowest.day}` : " al inicio"} · cierre ${money(points[points.length - 1].value)}</p>
  </article>`;
}
function categoryCard(groups, total, prevGroups) {
  if (!groups.length) return `<article class="dz-panel"><div class="dz-head"><div><h3>Gasto por categoría</h3><p>Solo consumo</p></div></div>${empty("Sin gastos", "No hay categorías en este periodo.")}</article>`;
  const prev = Object.fromEntries(prevGroups);
  const max = groups[0][1] || 1;
  const rising = groups.filter(([c, v]) => prev[c] && v > prev[c] * 1.15 && v > total * 0.04).sort((a, b) => (b[1] / prev[b[0]]) - (a[1] / prev[a[0]]))[0];
  return `<article class="dz-panel">
    <div class="dz-head"><div><h3>Gasto por categoría</h3><p>Solo consumo · toca una para filtrar todo</p></div>${dashboardCategory ? `<button type="button" class="dz-chip-clear" data-clear-chart-filters>${escapeHtml(dashboardCategory)} ×</button>` : ""}</div>
    <div class="dz-cats">${groups.map(([c, v]) => {
      const sel = dashboardCategory === c, dim = dashboardCategory && !sel;
      const d = prev[c] ? Math.round((v - prev[c]) / prev[c] * 100) : null;
      return `<button type="button" class="dz-cat ${sel ? "is-selected" : ""} ${dim ? "is-dimmed" : ""}" data-category-filter="${escapeAttr(c)}" aria-pressed="${sel}">
        <span class="dz-cat-top"><span>${escapeHtml(c)}</span><b class="num">${money(v)}</b></span>
        <span class="dz-track"><span style="width:${(v / max * 100).toFixed(2)}%"></span></span>
        <span class="dz-cat-foot num"><span>${Math.round(v / total * 100)}% del gasto</span><span>${d === null ? "nuevo" : d === 0 ? "igual que antes" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%`}</span></span>
      </button>`;
    }).join("")}</div>
    ${rising ? `<p class="dz-note">${escapeHtml(rising[0])} subió ${Math.round((rising[1] - prev[rising[0]]) / prev[rising[0]] * 100)}% frente al periodo anterior.</p>` : ""}
  </article>`;
}
function monthlyCard() {
  const country = state.country, other = country === "CN" ? "CO" : "CN";
  const rows = Array.from({ length: 12 }, (_, i) => {
    const ym = `${dashboardYear}-${String(i + 1).padStart(2, "0")}`;
    const f = monthFlow([ym], country);
    return { m: String(i + 1).padStart(2, "0"), label: new Date(Date.UTC(Number(dashboardYear), i, 1)).toLocaleString("es", { month: "short", timeZone: "UTC" }).replace(".", ""), f };
  });
  const max = Math.max(1, ...rows.map(r => Math.max(r.f.totalIn, r.f.totalOut)));
  const ticks = [max, max * 2 / 3, max / 3, 0];
  const stack = (parts) => parts.filter(p => p[1] > 0).map(([k, v]) => `<i class="is-${k}" style="height:${(v / max * 100).toFixed(2)}%"></i>`).join("");
  const detail = (f) => {
    const ins = [["Ingresos", f.income], [`Recibido de ${meta[other].name}`, f.received], ["Préstamos recibidos", f.loanIn], ["Ajustes", f.adjustIn]].filter(x => x[1] > 0).map(([l, v]) => `${l} ${money(v)}`).join(", ");
    const outs = [["Gastos", f.expense], [`Envíos a ${meta[other].name}`, f.sent], ["Abonos a préstamos", f.loanOut], ["Ajustes", f.adjustOut]].filter(x => x[1] > 0).map(([l, v]) => `${l} ${money(v)}`).join(", ");
    return `Entró ${money(f.totalIn)}${ins ? ` (${ins})` : ""} · Salió ${money(f.totalOut)}${outs ? ` (${outs})` : ""} · Tu saldo cambió ${signedMoney(f.net)}`;
  };
  return `<article class="dz-panel">
    <div class="dz-head"><div><h3>Entradas y salidas por mes</h3><p>${dashboardYear} · barra izquierda: lo que entró · derecha: lo que salió · arriba, cuánto cambió tu saldo</p></div><div class="dz-legend"><span>${dot("inc")}Ingresos</span><span>${dot("exp")}Gastos</span><span>${dot("snd")}Transferencias</span><span>${dot("loan")}Préstamos</span></div></div>
    <div class="dz-months-wrap"><div class="dz-yaxis is-bars">${ticks.map(v => `<span>${compactMoney(v)}</span>`).join("")}</div>
    <div class="dz-months">${rows.map(r => {
      const f = r.f, none = !f.totalIn && !f.totalOut, sel = dashboardMonth === r.m;
      return `<button type="button" class="dz-month ${sel ? "is-selected" : ""}" data-month-filter="${r.m}" ${tip(`${r.label} ${dashboardYear}`, none ? "Sin datos" : detail(f))} aria-label="${escapeAttr(none ? `${r.label}: sin datos` : `${r.label}: ${detail(f)}`)}">
        <span class="dz-month-net num ${f.net < 0 ? "is-neg" : ""}">${none ? "" : compactMoney(f.net).replace(/^(?!−)/, "+")}</span>
        <span class="dz-month-bars"><span class="dz-stack">${stack([["inc", f.income], ["snd", f.received], ["loan", f.loanIn], ["adj", f.adjustIn]])}</span><span class="dz-stack">${stack([["exp", f.expense], ["snd", f.sent], ["loan", f.loanOut], ["adj", f.adjustOut]])}</span></span>
        <span class="dz-month-label">${r.label}</span>
      </button>`;
    }).join("")}</div></div>
  </article>`;
}
function budgetPace() {
  if (dashboardMonth === "all") return null;
  const now = new Date();
  const isCurrent = String(now.getFullYear()) === dashboardYear && String(now.getMonth() + 1).padStart(2, "0") === dashboardMonth;
  if (!isCurrent) return null;
  const days = new Date(Number(dashboardYear), Number(dashboardMonth), 0).getDate();
  return { day: now.getDate(), days, ratio: now.getDate() / days };
}
/* Un pago único que ya cubre casi todo (arriendo, matrícula) no se proyecta: ya está hecho. */
function budgetIsFixed(category) {
  const tx = dashboardTransactions({ ignoreCategory: true }).filter(x => x.type === "gasto" && x.category === category);
  const spent = tx.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  return spent > 0 && Math.max(...tx.map(x => Number(x.amount) || 0)) >= spent * 0.8;
}
function budgetRow(b, { compact = false } = {}) {
  const months = dashboardMonth === "all" ? 12 : 1;
  const limit = (Number(b.amount) || 0) * months, spent = spentByCategory(b.category);
  const pace = budgetPace(), fixed = budgetIsFixed(b.category);
  const proj = pace && pace.ratio > 0 && !fixed ? spent / pace.ratio : spent;
  const scale = Math.max(limit, proj, spent, 1) * 1.06;
  const over = spent > limit, risk = !over && pace && proj > limit * 1.001, warn = !over && !risk && limit && spent / limit >= 0.9;
  const state_ = over ? "over" : risk ? "risk" : warn ? "warn" : "ok";
  const msg = over ? `Excedido por ${money(spent - limit)}` : risk ? `A este ritmo te pasas ${money(proj - limit)}` : warn ? `Casi al límite · quedan ${money(limit - spent)}` : `Quedan ${money(Math.max(0, limit - spent))}${pace && !fixed ? ` · cerrarías en ${money(proj)}` : pace && fixed ? " · pago fijo ya hecho" : ""}`;
  const icon = state_ === "ok" ? "bi-check-circle" : state_ === "warn" ? "bi-exclamation-circle" : "bi-exclamation-triangle";
  return `<div class="dz-budget is-${state_}">
    <div class="dz-budget-top"><span>${escapeHtml(b.category)}</span><span class="num"><b>${money(spent)}</b> <small>de ${money(limit)}</small></span></div>
    <div class="dz-bullet">${pace ? `<span class="dz-bullet-proj" style="width:${(proj / scale * 100).toFixed(2)}%"></span>` : ""}<span class="dz-bullet-fill" style="width:${(spent / scale * 100).toFixed(2)}%"></span><span class="dz-bullet-limit" style="left:${(limit / scale * 100).toFixed(2)}%"></span></div>
    <p class="dz-budget-msg num"><i class="bi ${icon}" aria-hidden="true"></i>${msg}${compact ? "" : ` · ${limit ? Math.round(spent / limit * 100) : 0}%`}</p>
  </div>`;
}
function budgetsCard() {
  const items = countryItems(state.budgets).filter(b => Number(b.amount) > 0);
  return `<article class="dz-panel"><div class="dz-head"><div><h3>Presupuestos</h3><p>${budgetPace() ? "Gastado y proyección al cierre del mes" : "Gastado frente al límite"}</p></div><button type="button" class="dz-link" data-go="presupuestos">Ver todos</button></div>
    ${items.length ? `<div class="dz-budgets">${items.map(b => budgetRow(b, { compact: true })).join("")}</div>` : empty("Sin presupuestos", "Crea uno desde la sección Presupuestos.")}</article>`;
}
function merchantsCard(groups, total) {
  if (!groups.length) return "";
  const max = Math.max(...groups.map(g => g.amount), 1);
  return `<article class="dz-panel dz-merchants-panel"><div class="dz-head"><div><h3>Dónde se va</h3><p>Comercios donde más compras · toca uno para filtrar</p></div>${dashboardMerchant ? `<button type="button" class="dz-chip-clear" data-merchant-filter="${escapeAttr(dashboardMerchant)}">Quitar filtro ×</button>` : ""}</div>
    <div class="dz-merchants">${groups.slice(0, 5).map(g => {
      const sel = dashboardMerchant === g.key;
      return `<button type="button" class="dz-merchant ${sel ? "is-selected" : ""}" data-merchant-filter="${escapeAttr(g.key)}" aria-pressed="${sel}">
        <span class="dz-merchant-name"><span class="dz-initial" aria-hidden="true">${escapeHtml(g.label.charAt(0).toUpperCase())}</span>${escapeHtml(g.label)}</span>
        <strong class="num">${money(g.amount)}</strong>
        <span class="dz-track is-thin"><span style="width:${(g.amount / max * 100).toFixed(2)}%"></span></span>
        <small class="num">${g.count} ${g.count === 1 ? "compra" : "compras"}${total ? ` · ${Math.round(g.amount / total * 100)}% del gasto` : ""}</small>
      </button>`;
    }).join("")}</div></article>`;
}

/* ---------- Tooltips de los gráficos ---------- */
function bindChartTips(root = document) {
  let tipEl = document.getElementById("chartTip");
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.id = "chartTip"; tipEl.className = "chart-tip"; tipEl.setAttribute("role", "tooltip"); tipEl.innerHTML = "<strong></strong><span></span>"; document.body.appendChild(tipEl); }
  const show = el => {
    tipEl.querySelector("strong").textContent = el.dataset.tip || "";
    tipEl.querySelector("span").textContent = el.dataset.tipDetail || "";
    tipEl.classList.add("show");
    const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    const top = r.top - t.height - 10 < 8 ? r.bottom + 10 : r.top - t.height - 10;
    tipEl.style.left = `${left}px`; tipEl.style.top = `${top}px`;
  };
  const hide = () => tipEl.classList.remove("show");
  root.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("pointerenter", () => show(el));
    el.addEventListener("pointerleave", hide);
    el.addEventListener("focus", () => show(el));
    el.addEventListener("blur", hide);
  });
  window.addEventListener("scroll", hide, { passive: true, once: true });
}

/* ---------- Formulario de movimiento ---------- */
const TX_TYPES = [["gasto", "Gasto", "exp"], ["ingreso", "Ingreso", "inc"], ["cobro", "Reembolso", "inc"], ["ajuste", "Ajuste", "adj"]];
function txCategoryChips(type, selected, showAll) {
  const country = state.country;
  const ranked = rankedCategories(country, type);
  let list = showAll ? ranked : ranked.slice(0, 5);
  if (selected && !list.some(x => x.name === selected)) list = list.concat(ranked.find(x => x.name === selected) || [{ name: selected, count: 0 }]);
  const chips = list.map(c => `<label class="tx-chip"><input type="radio" name="category" value="${escapeAttr(c.name)}" ${c.name === selected ? "checked" : ""} required><span>${escapeHtml(c.name)}<small>${usageLabel(c.count, country)}</small></span></label>`).join("");
  const more = ranked.length > 5 ? `<button type="button" class="tx-chip is-more" data-cat-more="${showAll ? "less" : "more"}">${showAll ? "Menos ▴" : "Más categorías ▾"}</button>` : "";
  return chips + more;
}
function transactionFormHtml(item) {
  const country = item?.country || state.country, m = currencyMeta(country);
  const type = item?.type || "gasto";
  const merchants = topMerchants(country);
  const selectedCat = item?.category || rankedCategories(country, type)[0]?.name || "";
  return `<input type="hidden" name="__country" value="${country}">
  <div class="tx-form">
    <div class="field full"><span class="tx-label">Tipo</span><div class="tx-types" role="radiogroup" aria-label="Tipo de movimiento">${TX_TYPES.map(([v, l, k]) => `<label class="tx-type"><input type="radio" name="type" value="${v}" ${v === type ? "checked" : ""}><span>${dot(k)}${l}</span></label>`).join("")}</div></div>
    ${moneyField(`Monto en ${m.currency}`, "amount", item?.amount ?? "", country, { full: true })}
    <div class="field full"><label for="txMerchant">Comercio o persona</label><input class="input" id="txMerchant" name="description" maxlength="80" value="${escapeAttr(item?.description || "")}" placeholder="¿Dónde? Ej. ${escapeAttr(merchants.slice(0, 2).map(x => x.label).join(", ") || "supermercado")}" autocomplete="off" required>
      ${merchants.length ? `<small class="tx-help">Los que más registras · tocar uno también elige su categoría</small><div class="tx-quick">${merchants.map(x => `<button type="button" class="tx-pill" data-merchant-pick="${escapeAttr(x.label)}" data-merchant-cat="${escapeAttr(x.category)}">${escapeHtml(x.label)}</button>`).join("")}</div>` : ""}</div>
    <div class="field full"><label for="txDetail">Qué compraste <span class="tx-optional">· opcional</span></label><input class="input" id="txDetail" name="detail" maxlength="120" value="${escapeAttr(item?.detail || "")}" placeholder="Ej. mercado de la semana" autocomplete="off"></div>
    <div class="field full"><span class="tx-label" data-cat-hint>Categoría · las 5 que más usas en ${m.name}</span><div class="tx-cats" data-tx-cats>${txCategoryChips(type, selectedCat, false)}</div>
      <div class="tx-newcat hidden" data-newcat><input class="input" data-newcat-input maxlength="60" placeholder="Crear categoría nueva" autocomplete="off"><button type="button" class="button ghost" data-newcat-add>Crear</button></div></div>
    <div class="field full"><label for="txDate">Fecha</label><div class="tx-dates"><button type="button" class="tx-pill" data-date-pick="0">Hoy</button><button type="button" class="tx-pill" data-date-pick="-1">Ayer</button><input class="input" id="txDate" name="date" type="date" value="${escapeAttr(item?.date || today())}" required></div><small class="tx-help">Si fue otro día, elige la fecha: esa es la que cuenta para el cierre del mes.</small></div>
  </div>`;
}
function bindTransactionForm(form) {
  const country = form.querySelector('[name="__country"]')?.value || state.country;
  let showAll = false;
  const cats = form.querySelector("[data-tx-cats]"), hint = form.querySelector("[data-cat-hint]");
  const newBox = form.querySelector("[data-newcat]");
  const currentType = () => form.querySelector('[name="type"]:checked')?.value || "gasto";
  const currentCat = () => form.querySelector('[name="category"]:checked')?.value || "";
  const redraw = (keep = currentCat()) => {
    cats.innerHTML = txCategoryChips(currentType(), keep, showAll);
    hint.textContent = showAll ? "Categoría · todas, de más a menos usada" : `Categoría · las 5 que más usas en ${meta[country].name}`;
    newBox.classList.toggle("hidden", !showAll);
  };
  form.addEventListener("change", e => { if (e.target.name === "type") { showAll = false; redraw(rankedCategories(country, currentType())[0]?.name || ""); } });
  form.addEventListener("click", e => {
    const more = e.target.closest("[data-cat-more]");
    if (more) { showAll = more.dataset.catMore === "more"; redraw(); return; }
    const mp = e.target.closest("[data-merchant-pick]");
    if (mp) {
      form.querySelector('[name="description"]').value = mp.dataset.merchantPick;
      const gasto = form.querySelector('[name="type"][value="gasto"]'); if (gasto && !gasto.checked) { gasto.checked = true; showAll = false; }
      redraw(mp.dataset.merchantCat || currentCat());
      form.querySelector('[name="amount"]')?.focus();
      return;
    }
    const dp = e.target.closest("[data-date-pick]");
    if (dp) { const d = new Date(); d.setDate(d.getDate() + Number(dp.dataset.datePick)); form.querySelector('[name="date"]').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; return; }
    if (e.target.closest("[data-newcat-add]")) {
      const input = form.querySelector("[data-newcat-input]"), name = input.value.trim().replace(/\s+/g, " ");
      if (!name) { input.focus(); return; }
      const existing = availableCategories().find(x => x.localeCompare(name, "es", { sensitivity: "accent" }) === 0);
      const finalName = existing || name;
      if (!existing) { cats.insertAdjacentHTML("afterbegin", `<label class="tx-chip"><input type="radio" name="category" value="${escapeAttr(finalName)}" required><span>${escapeHtml(finalName)}<small>nueva</small></span></label>`); }
      const radio = [...form.querySelectorAll('[name="category"]')].find(r => r.value === finalName); if (radio) radio.checked = true;
      input.value = "";
    }
  });
}

/* ---------- Ayudas de otros formularios ---------- */
function bindMoneyInputs(form) {
  form.querySelectorAll(".money-value").forEach(input => { input.addEventListener("input", () => refreshMoneyPreview(input)); });
}
function transferRateStats(from, to, excludeId = "") {
  const rates = state.transfers.filter(x => x.from === from && x.to === to && x.id !== excludeId && Number(x.sent) > 0 && Number(x.received) > 0)
    .map(x => Number(x.received) / ((Number(x.sent) || 0) + (Number(x.fee) || 0)));
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
}
function formatRate(rate, from, to) {
  if (!rate) return "—";
  const digits = rate >= 100 ? 1 : 4;
  return `${rate.toLocaleString(to === "CO" ? "es-CO" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${meta[to].symbol} por ${meta[from].symbol}`;
}
function bindTransferForm(form, editingId = "") {
  const from = form.querySelector('[name="from"]'), to = form.querySelector('[name="to"]');
  const out = form.querySelector("[data-transfer-rate]");
  const update = () => {
    if (from.value === to.value) to.value = from.value === "CN" ? "CO" : "CN";
    setMoneyCountry(form.querySelector('[data-money-field="sent"]'), from.value);
    setMoneyCountry(form.querySelector('[data-money-field="fee"]'), from.value);
    setMoneyCountry(form.querySelector('[data-money-field="received"]'), to.value);
    const sent = Number(form.querySelector('[name="sent"]').value) || 0, fee = Number(form.querySelector('[name="fee"]').value) || 0, rec = Number(form.querySelector('[name="received"]').value) || 0;
    const rate = sent + fee > 0 && rec > 0 ? rec / (sent + fee) : 0, avg = transferRateStats(from.value, to.value, editingId);
    if (out) {
      out.querySelector("strong").textContent = rate ? formatRate(rate, from.value, to.value) : "Escribe los montos";
      const d = rate && avg ? (rate - avg) / avg * 100 : null;
      out.querySelector("small").textContent = d === null ? (avg ? `Tu promedio: ${formatRate(avg, from.value, to.value)}` : "Incluye la comisión") : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}% frente a tu promedio (${formatRate(avg, from.value, to.value)})`;
      out.dataset.tone = d === null ? "" : d >= 0 ? "good" : "bad";
    }
  };
  [from, to].forEach(s => s.addEventListener("change", update));
  form.addEventListener("input", update);
  update();
}
function bindLoanForm(form) {
  const help = form.querySelector("[data-loan-affect-help]");
  const prior = form.querySelector('[name="hasPrior"]'), priorBox = form.querySelector("[data-loan-prior]");
  const update = () => {
    const dir = form.querySelector('[name="direction"]:checked')?.value || "owed";
    const amount = Number(form.querySelector('[name="amount"]')?.value) || 0;
    const country = form.querySelector('[name="amount"]')?.dataset.moneyCountry || state.country;
    const affect = form.querySelector('[name="affectBalance"]')?.checked;
    if (help) help.textContent = !affect ? "Apagado: solo documentas la deuda; tu saldo no cambia. Úsalo para deudas anteriores."
      : dir === "owed" ? `Registra una ENTRADA de ${money(amount, country)} en tu saldo porque recibiste ese dinero. No cuenta como ingreso.`
      : `Registra una SALIDA de ${money(amount, country)} de tu saldo porque prestaste ese dinero. No cuenta como gasto.`;
    if (prior && priorBox) { priorBox.classList.toggle("hidden", !prior.checked); const bal = priorBox.querySelector("input"); if (bal) bal.required = prior.checked; }
  };
  form.addEventListener("input", update); form.addEventListener("change", update);
  form.addEventListener("click", e => { const p = e.target.closest("[data-person-pick]"); if (p) { form.querySelector('[name="person"]').value = p.dataset.personPick; } });
  update();
}
function bindLoanPaymentForm(form, loan) {
  const input = form.querySelector('[name="amount"]'), out = form.querySelector("[data-payment-preview]");
  const pending = Number(loan.balance) || 0, original = Number(loan.amount) || 0;
  const update = () => {
    const v = Number(input.value) || 0, after = Math.max(0, pending - v), over = v > pending + 1e-9;
    const paidBefore = Math.max(0, original - pending);
    out.querySelector("[data-after]").textContent = money(after, loan.country);
    out.querySelector("[data-bar-paid]").style.width = `${original ? paidBefore / original * 100 : 0}%`;
    out.querySelector("[data-bar-now]").style.width = `${original ? Math.min(v, pending) / original * 100 : 0}%`;
    const msg = out.querySelector("[data-msg]");
    msg.textContent = over ? `El abono supera lo pendiente (${money(pending, loan.country)}).` : v && after === 0 ? "Con este abono el préstamo queda liquidado." : `Pagado después del abono: ${original ? Math.round((paidBefore + v) / original * 100) : 0}%`;
    out.dataset.tone = over ? "bad" : v && after === 0 ? "good" : "";
  };
  input.addEventListener("input", update);
  form.addEventListener("click", e => { const c = e.target.closest("[data-pay-pick]"); if (c) { input.value = c.dataset.payPick; refreshMoneyPreview(input); update(); } });
  update();
}

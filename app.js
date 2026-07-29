const STORAGE_KEY = "mi-dinero-v3";
const blankState = () => ({
  version: 3, country: "CN",
  transactions: [], budgets: [], transfers: [], loans: [], recurrings: [],
  settings: { user: "Carlos", email: "Cuenta local", dataSource: "Este dispositivo" }
});
let state = loadState();
let currentPage = "resumen";
let pendingDelete = null;
let dashboardYear = "";
let dashboardMonth = "all";
let dashboardCategory = "";
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const meta = {
  CN:{name:"China",currency:"CNY",symbol:"¥",locale:"zh-CN"},
  CO:{name:"Colombia",currency:"COP",symbol:"$",locale:"es-CO"}
};
const fallbackCategories = ["Alimentación","Vivienda","Transporte","Servicios","Salud","Compras","Entretenimiento","Viajes","Educación","Comisión bancaria","Otros"];
const pageNames={resumen:"Resumen",transacciones:"Transacciones",presupuestos:"Presupuestos",transferencias:"Transferencias",prestamos:"Préstamos",recurrentes:"Recurrentes",configuracion:"Configuración"};

function initialState(){return window.MI_DINERO_INITIAL_DATA?structuredClone(window.MI_DINERO_INITIAL_DATA):blankState()}
function loadState(){try{const saved=localStorage.getItem(STORAGE_KEY);return saved?{...blankState(),...JSON.parse(saved)}:initialState()}catch{return initialState()}}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));window.MiDineroCloud?.queueSave(state)}
function uid(prefix="r"){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`}
function money(value,country=state.country){return new Intl.NumberFormat(meta[country].locale,{style:"currency",currency:meta[country].currency,maximumFractionDigits:country==="CO"?0:2}).format(Number(value)||0)}
function dateLabel(date){if(!date)return "";return new Intl.DateTimeFormat("es",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`))}
function today(){return new Date().toISOString().slice(0,10)}
function toast(text){const el=$("#toast");el.textContent=text;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
function countryItems(arr){return arr.filter(x=>x.country===state.country)}
function availableCategories(){const imported=countryItems(state.transactions).map(x=>x.category).filter(Boolean);return [...new Set([...imported,...fallbackCategories])].sort((a,b)=>a.localeCompare(b,"es"))}
function pageHead(title,description,action=""){return `<div class="page-head"><div><h2>${title}</h2><p>${description}</p></div>${action}</div>`}
function empty(title,text){return `<div class="empty"><div><strong>${title}</strong>${text}</div></div>`}

function periodOptions(){
  const tx=countryItems(state.transactions).filter(x=>x.date);
  const years=[...new Set(tx.map(x=>x.date.slice(0,4)))].sort((a,b)=>b.localeCompare(a));
  if(!dashboardYear||!years.includes(dashboardYear))dashboardYear=years[0]||String(new Date().getFullYear());
  return years;
}
function dashboardTransactions({ignoreMonth=false,ignoreCategory=false}={}){
  return countryItems(state.transactions).filter(x=>{
    if(!x.date||x.date.slice(0,4)!==dashboardYear)return false;
    if(!ignoreMonth&&dashboardMonth!=="all"&&x.date.slice(5,7)!==dashboardMonth)return false;
    if(!ignoreCategory&&dashboardCategory&&(x.category||"Sin categoría")!==dashboardCategory)return false;
    return true;
  });
}
function periodLabel(){
  if(dashboardMonth==="all")return `Año ${dashboardYear}`;
  const label=new Date(`${dashboardYear}-${dashboardMonth}-01T12:00:00`).toLocaleString("es",{month:"long"});
  return `${label.charAt(0).toUpperCase()+label.slice(1)} ${dashboardYear}`;
}
function isCarryForwardTransaction(x){
  if(x.type!=="ajuste")return false;
  const text=`${x.category||""} ${x.description||""}`;
  return /(mes anterior|saldo inicial|nuevo mes|saldo trasladado)/i.test(text);
}
function transactionCashChange(x){
  const amount=Number(x.amount)||0;
  if(["ingreso","cobro"].includes(x.type))return Math.abs(amount);
  if(x.type==="gasto")return -Math.abs(amount);
  if(x.type!=="ajuste"||isCarryForwardTransaction(x))return 0;
  const explicit=[x.cashEffect,x.balanceEffect,x.saldoEffect,x.signedAmount,x.cashFlow]
    .map(Number).find(Number.isFinite);
  if(explicit!==undefined)return explicit;
  const direction=String(x.cashDirection||x.balanceDirection||x.flowDirection||x.direction||"").toLowerCase();
  if(/^(out|salida|egreso|debit|decrease|negative|-1)$/.test(direction))return -Math.abs(amount);
  if(/^(in|entrada|ingreso|credit|increase|positive|1)$/.test(direction))return Math.abs(amount);
  return amount;
}
function shiftedMonth(year,month,delta=0){
  const date=new Date(Date.UTC(Number(year),Number(month)-1+delta,1));
  const label=date.toLocaleString("es",{month:"long",timeZone:"UTC"});
  return {
    year:String(date.getUTCFullYear()),
    month:String(date.getUTCMonth()+1).padStart(2,"0"),
    label:`${label.charAt(0).toUpperCase()+label.slice(1)} ${date.getUTCFullYear()}`
  };
}
function openingBalanceForMonth(year,month){
  const ym=`${year}-${month}`;
  const rows=countryItems(state.transactions)
    .filter(x=>x.date?.slice(0,7)===ym&&isCarryForwardTransaction(x))
    .sort((a,b)=>a.date.localeCompare(b.date));
  return rows.length?Number(rows[0].amount)||0:null;
}
function isLoanTransaction(x){
  const text=`${x.category||""} ${x.description||""} ${x.originalType||x.tipoOriginal||x.Tipo_original||""}`;
  return /(pr[eé]stamo|deuda|nos pagan|capital prestado|pago de capital)/i.test(text);
}
function monthlyBalanceReconciliation(){
  if(dashboardMonth==="all")return null;
  const opening=openingBalanceForMonth(dashboardYear,dashboardMonth);
  const periodTx=dashboardTransactions({ignoreCategory:true});
  const operatingTx=periodTx.filter(x=>!isLoanTransaction(x));
  const periodTotals=totals(operatingTx);
  const directFlow=periodTotals.income-periodTotals.expense;
  const loanTx=periodTx.filter(isLoanTransaction);
  const loanFlow=loanTx.reduce((sum,x)=>sum+transactionCashChange(x),0);
  const adjustmentFlow=periodTx
    .filter(x=>x.type==="ajuste"&&!isLoanTransaction(x))
    .reduce((sum,x)=>sum+transactionCashChange(x),0);
  const ym=`${dashboardYear}-${dashboardMonth}`;
  const transferFlow=state.transfers.reduce((sum,x)=>{
    if(x.from===state.country&&x.date?.startsWith(ym))sum-=(Number(x.sent)||0)+(Number(x.fee)||0);
    const receivedDate=x.arrivalDate||x.date;
    if(x.to===state.country&&receivedDate?.startsWith(ym))sum+=Number(x.received)||0;
    return sum;
  },0);
  const next=shiftedMonth(dashboardYear,dashboardMonth,1);
  const recordedClosing=openingBalanceForMonth(next.year,next.month);
  const calculatedOther=adjustmentFlow+transferFlow;
  const closing=recordedClosing!==null?recordedClosing:(opening!==null?opening+directFlow+loanFlow+calculatedOther:null);
  const transferAndAdjustments=opening!==null&&recordedClosing!==null
    ?recordedClosing-opening-directFlow-loanFlow
    :calculatedOther;
  return {
    opening,closing,loanFlow,transferAndAdjustments,
    income:periodTotals.income,expense:periodTotals.expense,
    loanCount:loanTx.length,verified:recordedClosing!==null,nextLabel:next.label
  };
}
function signedMoney(value){
  const number=Number(value)||0;
  return `${number>0?"+":number<0?"−":""}${money(Math.abs(number))}`;
}
function balanceReconciliation(balance){
  const item=(label,value,detail,tone="")=>`<div class="balance-flow-item ${tone}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`;
  const opening=balance.opening===null
    ?item("1. Mes anterior","No disponible","No existe un saldo trasladado")
    :item("1. Mes anterior",money(balance.opening),"Punto de partida; no cuenta como ingreso");
  const income=item("2. Ingresos del mes",`+${money(balance.income)}`,"Ingresos reales, sin préstamos","in");
  const loans=item("3. Préstamos y deudas",signedMoney(balance.loanFlow),balance.loanCount?"Entradas y pagos de capital del mes":"Sin movimientos de deuda",balance.loanFlow<0?"out":balance.loanFlow>0?"in":"");
  const transfers=item("4. Transferencias y ajustes",signedMoney(balance.transferAndAdjustments),"Movimientos de caja fuera de ingresos y gastos",balance.transferAndAdjustments<0?"out":balance.transferAndAdjustments>0?"in":"");
  const expenses=item("5. Gastos del mes",`−${money(balance.expense)}`,"Consumo y gastos reales","out");
  const closing=balance.closing===null
    ?item("6. Saldo final","No disponible","Falta un saldo de apertura o cierre")
    :item(balance.verified?"6. Saldo final":"6. Saldo final estimado",money(balance.closing),balance.verified?`Conciliado con ${balance.nextLabel}`:"Resultado de las cinco tarjetas anteriores",balance.closing<0?"out":"in");
  return `<div class="balance-flow">${opening}${income}${loans}${transfers}${expenses}${closing}</div>`;
}
function expenseGroups(tx=dashboardTransactions()){
  const map={};
  tx.filter(x=>x.type==="gasto").forEach(x=>{const k=x.category||"Sin categoría";map[k]=(map[k]||0)+Number(x.amount||0)});
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}
function isFlexibleCategory(category=""){
  return /(restaur|comida|aliment|mercado|compra|entreten|ocio|viaje|belleza|hormiga|transporte|delivery|ropa|regalo|suscrip)/i.test(category);
}
function render(){
  document.body.dataset.country=state.country;
  $("#pageTitle").textContent=pageNames[currentPage];
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===currentPage));
  document.querySelectorAll("#countrySwitch button").forEach(x=>x.classList.toggle("active",x.dataset.country===state.country));
  const views={resumen:renderDashboard,transacciones:renderTransactions,presupuestos:renderBudgets,transferencias:renderTransfers,prestamos:renderLoans,recurrentes:renderRecurrings,configuracion:renderSettings};
  $("#content").innerHTML=views[currentPage]();
  bindPage();
}
function totals(tx=countryItems(state.transactions)){
  const income=tx.filter(x=>["ingreso","cobro"].includes(x.type)).reduce((a,b)=>a+Number(b.amount),0);
  const expense=tx.filter(x=>x.type==="gasto").reduce((a,b)=>a+Number(b.amount),0);
  return {income,expense,balance:income-expense,count:tx.length};
}
function renderDashboard(){
  const years=periodOptions(), tx=dashboardTransactions(), categoryTx=dashboardTransactions({ignoreCategory:true}), timelineTx=dashboardTransactions({ignoreMonth:true}), t=totals(tx), allTime=totals(), balance=monthlyBalanceReconciliation(t);
  const groups=expenseGroups(categoryTx), selectedGroups=expenseGroups(tx), categoryTotal=totals(categoryTx).expense, flexible=selectedGroups.filter(([c])=>isFlexibleCategory(c)).reduce((a,[,v])=>a+v,0);
  const largest=tx.filter(x=>x.type==="gasto").sort((a,b)=>Number(b.amount)-Number(a.amount)).slice(0,5);
  const monthNames=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const filters=`<div class="period-filters"><label>Año<select class="select" id="dashboardYear">${years.map(y=>`<option ${y===dashboardYear?"selected":""}>${y}</option>`).join("")}</select></label><label>Mes<select class="select" id="dashboardMonth"><option value="all">Todo el año</option>${monthNames.map((m,i)=>`<option value="${String(i+1).padStart(2,"0")}" ${dashboardMonth===String(i+1).padStart(2,"0")?"selected":""}>${m}</option>`).join("")}</select></label></div>`;
  const activeFilters=dashboardMonth!=="all"||dashboardCategory?`<div class="chart-filter-status" aria-live="polite"><div><span>Vista filtrada</span>${dashboardMonth!=="all"?`<strong>${monthNames[Number(dashboardMonth)-1]} ${dashboardYear}</strong>`:""}${dashboardCategory?`<strong>${escapeHtml(dashboardCategory)}</strong>`:""}</div><button class="button ghost" data-clear-chart-filters>Limpiar filtros</button></div>`:`<div class="chart-filter-hint">Puedes hacer clic en un mes o una categoría para filtrar las demás visuales.</div>`;
  return `${pageHead("¿En qué se está yendo tu dinero?",`Análisis de ${periodLabel()} en ${meta[state.country].name}.`,filters)}
  ${activeFilters}
  ${balance?balanceReconciliation(balance):`<div class="balance-note"><span>Balance acumulado de movimientos clasificados</span><strong>${money(allTime.balance)}</strong><small>Entradas menos gastos de ${meta[state.country].name}; no representa un saldo bancario conciliado.</small></div>`}
  <div class="analysis-grid">
    <div class="panel category-panel"><div class="panel-head"><div><h3>Participación por categoría</h3><small>Qué categorías concentran el gasto</small></div></div>${categoryParticipation(groups,categoryTotal)}</div>
    <div class="panel"><div class="panel-head"><div><h3>${dashboardMonth==="all"?"Gasto por mes":"Gasto por semana"}</h3><small>Valores del periodo seleccionado</small></div></div>${spendingTimeline(timelineTx)}</div>
  </div>
  <div class="analysis-grid lower">
    <div class="panel"><div class="panel-head"><div><h3>Gastos con margen de ajuste</h3><small>Restaurantes, compras, ocio y categorías similares</small></div></div>${flexibleBreakdown(selectedGroups,t.expense)}</div>
    <div class="panel"><div class="panel-head"><h3>Mayores gastos individuales</h3><button class="button ghost" data-go="transacciones">Ver todos</button></div>${largest.length?transactionRows(largest):empty("Sin gastos","No hay salidas en este periodo.")}</div>
  </div>
  <div class="panel daily-balance-panel"><div class="panel-head"><div><h3>Saldo día a día</h3><small>${dashboardMonth==="all"?"Selecciona un mes para ver cómo fluctuó tu saldo.":"Saldo conciliado al cierre de cada día; incluye entradas, gastos, transferencias y conciliación mensual."}</small></div></div>${dailyBalanceChart()}</div>`;
}
function metric(label,value,small,color){return `<article class="metric"><div class="metric-label"><span>${label}</span><i class="dot ${color}"></i></div><div class="metric-value">${value}</div><small>${small}</small></article>`}
function chartMoney(value){
  const decimals=state.country==="CO"?0:2;
  const number=Number(value)||0;
  const formatted=new Intl.NumberFormat("en-US",{minimumFractionDigits:0,maximumFractionDigits:decimals}).format(Math.abs(number));
  return `${number<0?"−":""}${meta[state.country].symbol}${formatted}`;
}
function categoryParticipation(groups,total){
  if(!groups.length)return empty("Sin gastos","No hay categorías para el periodo seleccionado.");
  const colors=["var(--accent)","#ff8a65","#8c7ae6","#36c5b4","#e6b94c","#67a8e4","#d36c9d","#8caa5b","#ef7aaf","#55b6c2"];
  let cursor=0;
  const segments=groups.map(([category,value],i)=>{
    const percent=total?value/total*100:0,offset=-cursor;cursor+=percent;
    const label=`${category} · ${Math.round(percent)}% · ${money(value)}`;
    const selected=dashboardCategory===category,dimmed=dashboardCategory&&!selected;
    return `<circle class="donut-segment ${selected?"is-selected":""} ${dimmed?"is-dimmed":""}" cx="50" cy="50" r="40" pathLength="100" fill="none" stroke="${colors[i%colors.length]}" stroke-width="18" stroke-dasharray="${percent} ${100-percent}" stroke-dashoffset="${offset}" data-category-filter="${escapeAttr(category)}" tabindex="0" role="button" aria-label="${escapeAttr(label)}"><title>${escapeHtml(label)}</title></circle>`;
  }).join("");
  const legend=groups.map(([category,value],i)=>{
    const percent=total?Math.round(value/total*100):0,selected=dashboardCategory===category,dimmed=dashboardCategory&&!selected;
    const label=`${category} · ${percent}% · ${money(value)}`;
    return `<button type="button" class="${selected?"is-selected":""} ${dimmed?"is-dimmed":""}" data-category-filter="${escapeAttr(category)}" title="${escapeAttr(label)}"><i style="background:${colors[i%colors.length]}"></i><span>${escapeHtml(category)}</span><strong>${percent}%</strong><small>${money(value)}</small></button>`;
  }).join("");
  return `<div class="category-visual"><div class="donut-wrap"><svg class="donut-svg" viewBox="0 0 100 100" aria-label="Participación del gasto por categoría">${segments}</svg><div class="donut-center"><strong>${money(total)}</strong><span>Total gastado</span></div></div><div class="category-legend">${legend}</div></div>`;
}
function spendingTimeline(tx){
  const expenses=tx.filter(x=>x.type==="gasto");
  let buckets=[];
  if(dashboardMonth==="all"){
    buckets=Array.from({length:12},(_,i)=>({label:new Date(Number(dashboardYear),i,1).toLocaleString("es",{month:"short"}),value:expenses.filter(x=>Number(x.date.slice(5,7))===i+1).reduce((a,b)=>a+Number(b.amount),0),month:String(i+1).padStart(2,"0")}));
  }else{
    buckets=Array.from({length:5},(_,i)=>({label:`Sem. ${i+1}`,value:expenses.filter(x=>Math.min(4,Math.floor((Number(x.date.slice(8,10))-1)/7))===i).reduce((a,b)=>a+Number(b.amount),0),month:""}));
  }
  const max=Math.max(1,...buckets.map(x=>x.value));
  return `<div class="labeled-bars">${buckets.map(x=>{const height=x.value?Math.max(5,x.value/max*72):2;return `<button type="button" class="labeled-bar ${x.month?"is-clickable":""}" ${x.month?`data-month-filter="${x.month}"`:""} title="${escapeAttr(`${x.label}: ${money(x.value)}`)}"><span class="bar-value">${x.value?chartMoney(x.value):"—"}</span><span class="bar-fill" style="height:${height}%"></span><small>${x.label}</small></button>`}).join("")}</div>`;
}
function dailyBalanceChart(){
  if(dashboardMonth==="all")return `<div class="daily-balance-empty"><strong>Selecciona un mes</strong><span>El gráfico mostrará un punto por cada día y el valor exacto al pasar el cursor.</span></div>`;
  const opening=openingBalanceForMonth(dashboardYear,dashboardMonth);
  if(opening===null)return `<div class="daily-balance-empty"><strong>Saldo inicial no disponible</strong><span>Este mes no tiene un saldo trasladado con el cual iniciar el cálculo diario.</span></div>`;
  const ym=`${dashboardYear}-${dashboardMonth}`;
  const now=new Date();
  const daysInMonth=new Date(Number(dashboardYear),Number(dashboardMonth),0).getDate();
  const isCurrentMonth=String(now.getFullYear())===dashboardYear&&String(now.getMonth()+1).padStart(2,"0")===dashboardMonth;
  const maxDay=isCurrentMonth?Math.min(now.getDate(),daysInMonth):daysInMonth;
  const changes=Array.from({length:maxDay+1},()=>0);
  countryItems(state.transactions).forEach(x=>{
    if(!x.date?.startsWith(ym)||isCarryForwardTransaction(x))return;
    const day=Number(x.date.slice(8,10));
    if(day<1||day>maxDay)return;
    changes[day]+=transactionCashChange(x);
  });
  state.transfers.forEach(x=>{
    if(x.from===state.country&&x.date?.startsWith(ym)){
      const day=Number(x.date.slice(8,10));
      if(day>=1&&day<=maxDay)changes[day]-=(Number(x.sent)||0)+(Number(x.fee)||0);
    }
    const receivedDate=x.arrivalDate||x.date;
    if(x.to===state.country&&receivedDate?.startsWith(ym)){
      const day=Number(receivedDate.slice(8,10));
      if(day>=1&&day<=maxDay)changes[day]+=Number(x.received)||0;
    }
  });
  const next=shiftedMonth(dashboardYear,dashboardMonth,1);
  const recordedClosing=openingBalanceForMonth(next.year,next.month);
  const points=[{day:0,label:"Inicio",value:opening}];
  let running=opening;
  for(let day=1;day<=maxDay;day++){
    running+=changes[day];
    points.push({day,label:`Día ${day}`,value:running});
  }
  if(recordedClosing!==null&&!isCurrentMonth&&points.length>1){
    points[points.length-1].value=recordedClosing;
  }
  const width=960,height=300,pad={left:82,right:24,top:18,bottom:42};
  const values=points.map(x=>x.value),rawMin=Math.min(...values),rawMax=Math.max(...values);
  const spread=Math.max(1,rawMax-rawMin),min=rawMin-spread*.12,max=rawMax+spread*.12;
  const x=i=>pad.left+(i/(points.length-1||1))*(width-pad.left-pad.right);
  const y=value=>pad.top+(max-value)/(max-min)*(height-pad.top-pad.bottom);
  const coordinates=points.map((p,i)=>({...p,x:x(i),y:y(p.value)}));
  const path=coordinates.map((p,i)=>`${i?"L":"M"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const area=`${path} L ${coordinates[coordinates.length-1].x.toFixed(2)} ${height-pad.bottom} L ${coordinates[0].x.toFixed(2)} ${height-pad.bottom} Z`;
  const tickCount=4;
  const yTicks=Array.from({length:tickCount+1},(_,i)=>{
    const value=max-(max-min)*i/tickCount,py=pad.top+(height-pad.top-pad.bottom)*i/tickCount;
    return `<g><line x1="${pad.left}" y1="${py}" x2="${width-pad.right}" y2="${py}" class="daily-grid-line"/><text x="${pad.left-12}" y="${py+4}" text-anchor="end" class="daily-axis-label">${escapeHtml(chartMoney(value))}</text></g>`;
  }).join("");
  const labelEvery=Math.max(1,Math.ceil(maxDay/7));
  const xTicks=coordinates.filter((p,i)=>i===0||i===coordinates.length-1||p.day%labelEvery===0).map(p=>`<text x="${p.x}" y="${height-14}" text-anchor="middle" class="daily-axis-label">${p.day===0?"Inicio":p.day}</text>`).join("");
  const hits=coordinates.map((p,i)=>{
    const alignment=i<2?"is-left":i>coordinates.length-3?"is-right":"";
    const label=`${p.label} · ${chartMoney(p.value)}`;
    return `<button type="button" class="daily-balance-hit ${alignment}" style="left:${p.x/width*100}%;top:${p.y/height*100}%" data-tooltip="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"></button>`;
  }).join("");
  return `<div class="daily-balance-scroll"><div class="daily-balance-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución diaria del saldo en ${escapeAttr(periodLabel())}"><defs><linearGradient id="dailyBalanceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".30"/><stop offset="100%" stop-color="var(--accent)" stop-opacity=".02"/></linearGradient></defs>${yTicks}<path d="${area}" class="daily-balance-area"/><path d="${path}" class="daily-balance-line"/>${coordinates.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="3.5" class="daily-balance-dot"/>`).join("")}${xTicks}</svg>${hits}</div></div><div class="daily-balance-summary"><span>Saldo inicial <strong>${chartMoney(opening)}</strong></span><span>${recordedClosing!==null&&!isCurrentMonth?"Saldo final conciliado":"Saldo al último día registrado"} <strong>${chartMoney(points[points.length-1].value)}</strong></span></div>`;
}
function flexibleBreakdown(groups,total){
  const items=groups.filter(([c])=>isFlexibleCategory(c)).slice(0,7);
  if(!items.length)return empty("Sin gastos ajustables","No se detectaron restaurantes, compras, ocio u otras categorías variables.");
  const max=Math.max(...items.map(([,v])=>v));
  return `<div class="rank-list">${items.map(([c,v],i)=>`<div class="rank-item"><span class="rank-number">${i+1}</span><div><div class="rank-label"><strong>${escapeHtml(c)}</strong><span>${money(v)} · ${total?Math.round(v/total*100):0}%</span></div><div class="rank-track"><i style="width:${v/max*100}%"></i></div></div></div>`).join("")}</div>`;
}
function renderTransactions(){
  const tx=countryItems(state.transactions).sort((a,b)=>b.date.localeCompare(a.date));
  return `${pageHead("Todos tus movimientos",`${tx.length} registros en ${meta[state.country].name}.`,`<button class="button" data-add="transaction">+ Nueva transacción</button>`)}
  <div class="filters"><input class="input" id="searchTx" placeholder="Buscar por descripción o categoría"><select class="select" id="typeFilter"><option value="">Todos los tipos</option><option value="gasto">Gastos</option><option value="ingreso">Ingresos</option><option value="cobro">Cobros</option><option value="ajuste">Ajustes</option></select></div>
  <div class="panel table-panel" id="txList">${tx.length?transactionRows(tx):empty("Aún no hay transacciones","Registra un gasto, ingreso, cobro o ajuste.")}</div>`;
}
function transactionRows(tx){return `<div class="transaction-list">${tx.map(x=>`<div class="transaction-row" data-search="${(x.description+" "+x.category+" "+x.type).toLowerCase()}" data-type="${x.type}"><div class="tx-icon">${x.type==="gasto"?"↓":"↑"}</div><div><strong>${escapeHtml(x.description)}</strong><small>${escapeHtml(x.category)} · ${dateLabel(x.date)}</small></div><span class="amount ${x.type}">${x.type==="gasto"?"−":"+"}${money(x.amount,x.country)}</span><div class="row-actions"><button data-edit="transaction" data-id="${x.id}" title="Editar">✎</button><button data-delete="transaction" data-id="${x.id}" title="Eliminar">⌫</button></div></div>`).join("")}</div>`}
function spentByCategory(category){return countryItems(state.transactions).filter(x=>x.type==="gasto"&&x.category===category).reduce((a,b)=>a+Number(b.amount),0)}
function renderBudgets(){
  const items=countryItems(state.budgets);
  return `${pageHead("Presupuestos",`Controla cuánto puedes gastar por categoría.`,`<button class="button" data-add="budget">+ Nuevo presupuesto</button>`)}
  <div class="budget-grid">${items.length?items.map(x=>{const spent=spentByCategory(x.category),pct=Math.min(100,Math.round(spent/Number(x.amount)*100)||0);return `<article class="panel budget-card"><div class="budget-top"><div><small class="muted">${escapeHtml(x.category)}</small><h3>${money(x.amount)}</h3></div><div class="row-actions"><button data-edit="budget" data-id="${x.id}">✎</button><button data-delete="budget" data-id="${x.id}">⌫</button></div></div><div class="progress"><span style="width:${pct}%"></span></div><div class="budget-values"><span>Usado ${money(spent)}</span><span>${pct}%</span></div></article>`}).join(""):empty("Sin presupuestos","Define un límite para comenzar.")}</div>`;
}
function renderTransfers(){
  const items=state.transfers.filter(x=>x.from===state.country||x.to===state.country).sort((a,b)=>b.date.localeCompare(a.date));
  return `${pageHead("Transferencias",`Movimientos vinculados que no cuentan como ingreso ni gasto.`,`<button class="button" data-add="transfer">+ Nueva transferencia</button>`)}
  <div class="panel table-panel">${items.length?`<div class="transaction-list">${items.map(x=>`<div class="transaction-row"><div class="tx-icon">⇄</div><div><strong>${meta[x.from].name} → ${meta[x.to].name}</strong><small>${dateLabel(x.date)} · Comisión ${money(x.fee||0,x.from)}</small></div><span class="amount">${money(x.sent,x.from)} → ${money(x.received,x.to)}</span><div class="row-actions"><button data-edit="transfer" data-id="${x.id}">✎</button><button data-delete="transfer" data-id="${x.id}">⌫</button></div></div>`).join("")}</div>`:empty("Sin transferencias","Registra manualmente los valores enviados y recibidos.")}</div>`;
}
function renderLoans(){
  const items=countryItems(state.loans);
  return `${pageHead("Préstamos",`Dinero que debemos y dinero que nos deben.`,`<button class="button" data-add="loan">+ Nuevo préstamo</button>`)}
  <div class="loan-grid">${items.length?items.map(x=>`<article class="panel budget-card"><div class="budget-top"><div><small class="muted">${x.direction==="owed"?"DINERO QUE DEBEMOS":"DINERO QUE NOS DEBEN"}</small><h3>${escapeHtml(x.person)}</h3></div><div class="row-actions"><button data-edit="loan" data-id="${x.id}">✎</button><button data-delete="loan" data-id="${x.id}">⌫</button></div></div><div class="metric-value">${money(x.balance)}</div><small class="muted">De ${money(x.amount)} · ${dateLabel(x.date)}</small><div class="form-actions"><button class="button ghost" data-pay="${x.id}">Registrar pago</button></div></article>`).join(""):empty("Sin préstamos activos","Registra una obligación o cuenta por cobrar.")}</div>`;
}
function renderRecurrings(){
  const items=countryItems(state.recurrings);
  return `${pageHead("Pagos recurrentes",`Recordatorios de gastos e ingresos periódicos.`,`<button class="button" data-add="recurring">+ Nuevo recurrente</button>`)}
  <div class="panel table-panel">${items.length?`<div class="transaction-list">${items.map(x=>`<div class="transaction-row"><div class="tx-icon">↻</div><div><strong>${escapeHtml(x.description)}</strong><small>${escapeHtml(x.frequency)} · Próximo: día ${x.day}</small></div><span class="amount ${x.type}">${money(x.amount)}</span><div class="row-actions"><button data-edit="recurring" data-id="${x.id}">✎</button><button data-delete="recurring" data-id="${x.id}">⌫</button></div></div>`).join("")}</div>`:empty("Sin pagos recurrentes","Agrega recordatorios; no crean transacciones automáticamente.")}</div>`;
}
function renderSettings(){const cloud=window.MiDineroCloud,connected=cloud?.isConnected(),status=window.miDineroCloudStatus?.text||"Falta configurar Google OAuth";return `${pageHead("Configuración","Administra la sincronización y las copias de seguridad.")}
  <div class="settings-grid"><div class="panel"><h3>Cuenta</h3><div class="settings-row"><span>Nombre</span><strong>${escapeHtml(state.settings.user)}</strong></div><div class="settings-row"><span>Almacenamiento</span><strong>${connected?"Google Sheets + dispositivo":"Este dispositivo"}</strong></div><div class="cloud-status" id="cloudStatus">${escapeHtml(status)}</div><div class="form-actions" style="justify-content:flex-start">${connected?`<button class="button" id="syncNow">Sincronizar ahora</button><button class="button ghost" id="disconnectGoogle">Desconectar</button>`:`<button class="button" id="connectGoogle">Conectar Google Sheets</button>`}</div></div>
  <div class="panel"><h3>Configuración privada</h3><p class="muted">Estos valores quedan solamente en este navegador; no se publican en GitHub.</p><div class="field"><label>Google OAuth Client ID</label><input class="input" id="googleClientId" value="${escapeAttr(window.MI_DINERO_CLOUD_CONFIG?.clientId||"")}" placeholder="...apps.googleusercontent.com"></div><div class="field" style="margin-top:12px"><label>ID del Google Sheet</label><input class="input" id="googleSheetId" value="${escapeAttr(window.MI_DINERO_CLOUD_CONFIG?.spreadsheetId||"")}" placeholder="Identificador del archivo maestro"></div><div class="form-actions"><button class="button" id="saveCloudConfig">Guardar configuración</button></div></div>
  <div class="panel"><h3>Respaldos</h3><p class="muted">Descarga un respaldo completo o importa uno anterior.</p><div class="form-actions" style="justify-content:flex-start"><button class="button" id="exportData">Exportar respaldo</button><label class="button ghost" for="importData">Importar respaldo</label><input class="file-input" type="file" id="importData" accept=".json"></div><div class="settings-row"><span>Reiniciar aplicación</span><button class="button danger" id="resetData">Borrar datos locales</button></div></div></div>`}

function bindPage(){
  $$("[data-add]").forEach(b=>b.onclick=()=>openForm(b.dataset.add));
  $$("[data-edit]").forEach(b=>b.onclick=()=>openForm(b.dataset.edit,b.dataset.id));
  $$("[data-delete]").forEach(b=>b.onclick=()=>askDelete(b.dataset.delete,b.dataset.id));
  $$("[data-go]").forEach(b=>b.onclick=()=>{currentPage=b.dataset.go;render()});
  $$("[data-pay]").forEach(b=>b.onclick=()=>payLoan(b.dataset.pay));
  const search=$("#searchTx"),filter=$("#typeFilter");if(search)search.oninput=filterTransactions;if(filter)filter.onchange=filterTransactions;
  const year=$("#dashboardYear"),month=$("#dashboardMonth");if(year)year.onchange=()=>{dashboardYear=year.value;dashboardCategory="";render()};if(month)month.onchange=()=>{dashboardMonth=month.value;render()};
  $$("[data-month-filter]").forEach(b=>b.onclick=()=>{dashboardMonth=dashboardMonth===b.dataset.monthFilter?"all":b.dataset.monthFilter;render()});
  $$("[data-category-filter]").forEach(b=>{b.onclick=()=>{dashboardCategory=dashboardCategory===b.dataset.categoryFilter?"":b.dataset.categoryFilter;render()};b.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();b.click()}}});
  const clearChartFilters=$("[data-clear-chart-filters]");if(clearChartFilters)clearChartFilters.onclick=()=>{dashboardMonth="all";dashboardCategory="";render()};
  if($("#exportData"))$("#exportData").onclick=exportData;if($("#importData"))$("#importData").onchange=importData;if($("#resetData"))$("#resetData").onclick=()=>askDelete("all","all");
  if($("#connectGoogle"))$("#connectGoogle").onclick=()=>window.MiDineroCloud?.connect();if($("#disconnectGoogle"))$("#disconnectGoogle").onclick=()=>window.MiDineroCloud?.disconnect();if($("#syncNow"))$("#syncNow").onclick=()=>window.MiDineroCloud?.pull();if($("#saveCloudConfig"))$("#saveCloudConfig").onclick=saveCloudConfig;
}
function filterTransactions(){const q=$("#searchTx").value.toLowerCase(),type=$("#typeFilter").value;$$(".transaction-row",$("#txList")).forEach(r=>r.style.display=(!q||r.dataset.search.includes(q))&&(!type||r.dataset.type===type)?"grid":"none")}
function formField(label,name,type="text",value="",options=null,full=false){return `<div class="field ${full?"full":""}"><label>${label}</label>${options?`<select class="select" name="${name}" required>${options.map(o=>`<option value="${o.value}" ${String(o.value)===String(value)?"selected":""}>${o.label}</option>`).join("")}</select>`:`<input class="input" name="${name}" type="${type}" value="${escapeAttr(value)}" ${type==="number"?'min="0" step="0.01"':""} required>`}</div>`}
function openForm(kind,id=null){
  const map={transaction:"Transacción",budget:"Presupuesto",transfer:"Transferencia",loan:"Préstamo",recurring:"Pago recurrente"};
  const collection={transaction:"transactions",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[kind];
  const item=id?state[collection].find(x=>x.id===id):null;
  $("#modalEyebrow").textContent=id?"EDITAR":"NUEVO";$("#modalTitle").textContent=map[kind];
  const typeOpts=[{value:"gasto",label:"Gasto"},{value:"ingreso",label:"Ingreso"},{value:"cobro",label:"Cobro / reembolso"},{value:"ajuste",label:"Ajuste"}];
  const categoryNames=availableCategories(),catOpts=categoryNames.map(x=>({value:x,label:x}));
  let html="";
  if(kind==="transaction")html=formField("Descripción","description","text",item?.description||"",null,true)+formField("Tipo","type","text",item?.type||"gasto",typeOpts)+formField(`Monto (${meta[state.country].currency})`,"amount","number",item?.amount||"")+formField("Categoría","category","text",item?.category||categoryNames[0],catOpts)+formField("Fecha","date","date",item?.date||today());
  if(kind==="budget")html=formField("Categoría","category","text",item?.category||categoryNames[0],catOpts)+formField(`Límite (${meta[state.country].currency})`,"amount","number",item?.amount||"");
  if(kind==="transfer")html=formField("Desde","from","text",item?.from||state.country,[{value:"CN",label:"China (RMB)"},{value:"CO",label:"Colombia (COP)"}])+formField("Hacia","to","text",item?.to||(state.country==="CN"?"CO":"CN"),[{value:"CO",label:"Colombia (COP)"},{value:"CN",label:"China (RMB)"}])+formField("Monto enviado","sent","number",item?.sent||"")+formField("Monto recibido","received","number",item?.received||"")+formField("Comisión opcional","fee","number",item?.fee||0)+formField("Fecha","date","date",item?.date||today());
  if(kind==="loan")html=formField("Tipo","direction","text",item?.direction||"owed",[{value:"owed",label:"Dinero que debemos"},{value:"receivable",label:"Dinero que nos deben"}])+formField("Persona o entidad","person","text",item?.person||"")+formField("Monto original","amount","number",item?.amount||"")+formField("Saldo pendiente","balance","number",item?.balance??item?.amount??"")+formField("Fecha","date","date",item?.date||today());
  if(kind==="recurring")html=formField("Descripción","description","text",item?.description||"",null,true)+formField("Tipo","type","text",item?.type||"gasto",typeOpts.slice(0,2))+formField("Monto","amount","number",item?.amount||"")+formField("Frecuencia","frequency","text",item?.frequency||"Mensual",[{value:"Mensual",label:"Mensual"},{value:"Semanal",label:"Semanal"},{value:"Anual",label:"Anual"}])+formField("Día de cobro","day","number",item?.day||1);
  $("#recordForm").innerHTML=`<div class="form-grid">${html}</div><div class="form-actions"><button type="button" class="button ghost" data-close>Cancelar</button><button class="button" type="submit">Guardar</button></div>`;
  $("#recordForm").dataset.kind=kind;$("#recordForm").dataset.id=id||"";$("#modal").classList.remove("hidden");$$("[data-close]",$("#modal")).forEach(x=>x.onclick=closeForm);
}
function closeForm(){$("#modal").classList.add("hidden")}
$("#recordForm").onsubmit=e=>{e.preventDefault();const kind=e.currentTarget.dataset.kind,id=e.currentTarget.dataset.id,data=Object.fromEntries(new FormData(e.currentTarget));const collection={transaction:"transactions",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[kind];["amount","sent","received","fee","balance","day"].forEach(k=>{if(k in data)data[k]=Number(data[k])});if(kind==="transfer"&&data.from===data.to){toast("El origen y el destino deben ser distintos");return}if(kind==="loan"&&!id)data.balance=data.amount;const record={...data,id:id||uid(kind[0]),country:kind==="transfer"?undefined:state.country,updatedAt:new Date().toISOString()};if(id){state[collection]=state[collection].map(x=>x.id===id?{...x,...record}:x)}else state[collection].push(record);saveState();closeForm();render();toast(id?"Registro actualizado":"Registro guardado")};
function askDelete(kind,id){pendingDelete={kind,id};let label="este registro";if(kind!=="all"){const collection={transaction:"transactions",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[kind];const x=state[collection].find(i=>i.id===id);label=x?.description||x?.category||x?.person||"este registro"}$("#confirmText").textContent=kind==="all"?"Se eliminarán todos los datos guardados en este dispositivo.":`Se eliminará “${label}”. Esta acción no se puede deshacer.`;$("#confirmModal").classList.remove("hidden")}
$("[data-cancel]").onclick=()=>{$("#confirmModal").classList.add("hidden");pendingDelete=null};
$("#confirmDelete").onclick=()=>{if(!pendingDelete)return;if(pendingDelete.kind==="all")state=blankState();else{const collection={transaction:"transactions",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[pendingDelete.kind];state[collection]=state[collection].filter(x=>x.id!==pendingDelete.id)}saveState();$("#confirmModal").classList.add("hidden");pendingDelete=null;render();toast("Registro eliminado")};
function payLoan(id){const loan=state.loans.find(x=>x.id===id);const input=prompt(`Monto del pago. Saldo actual: ${money(loan.balance)}`);if(input===null)return;const value=Number(input);if(!value||value<0||value>loan.balance){toast("Ingresa un monto válido");return}loan.balance-=value;loan.updatedAt=new Date().toISOString();saveState();render();toast("Pago aplicado")}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`mi-dinero-respaldo-${today()}.json`;a.click();URL.revokeObjectURL(a.href);toast("Respaldo exportado")}
function saveCloudConfig(){const clientId=$("#googleClientId").value.trim(),spreadsheetId=$("#googleSheetId").value.trim();if(!clientId.endsWith(".apps.googleusercontent.com")||!spreadsheetId){toast("Revisa el Client ID y el Sheet ID");return}localStorage.setItem("mi-dinero-cloud-config",JSON.stringify({clientId,spreadsheetId,sheetName:"_AppState"}));toast("Configuración guardada; recargando…");setTimeout(()=>location.reload(),700)}
function importData(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const imported=JSON.parse(reader.result);if(!imported.transactions||!imported.version)throw Error();state={...blankState(),...imported};saveState();render();toast("Respaldo importado")}catch{toast("El archivo no es un respaldo válido")}};reader.readAsText(file)}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function escapeAttr(v=""){return escapeHtml(v)}

$("#nav").onclick=e=>{const b=e.target.closest("[data-page]");if(!b)return;currentPage=b.dataset.page;$("#sidebar").classList.remove("open");render()};
$("#countrySwitch").onclick=e=>{const b=e.target.closest("[data-country]");if(!b)return;state.country=b.dataset.country;saveState();render()};
$("#menuButton").onclick=()=>$("#sidebar").classList.toggle("open");
$("#refreshButton").onclick=()=>{if(window.MiDineroCloud?.isConnected())window.MiDineroCloud.pull();else{state=loadState();render();toast("Datos actualizados")}};
window.miDineroGetState=()=>structuredClone(state);
window.miDineroApplyState=next=>{state={...blankState(),...next};localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();toast("Datos sincronizados")};
window.miDineroRefresh=render;
render();

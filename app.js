const STORAGE_KEY = "mi-dinero-v3";
const PERIOD_KEY = "mi-dinero-global-period";
const THEME_KEY = "mi-dinero-theme";
const LEGACY_RECURRING_CHECKS_KEY = "mi-dinero-recurring-checks";
const RECURRING_CHECKS_MIGRATION_KEY = "mi-dinero-recurring-checks-migrated-v1";
const LOAN_SETTLED_FILTER_KEY = "mi-dinero-hide-settled-loans";
const blankState = () => ({
  version: 3, country: "CN",
  transactions: [], budgets: [], transfers: [], loans: [], recurrings: [], recurringChecks: {},
  settings: { user: "Carlos", email: "Cuenta local", dataSource: "Este dispositivo" }
});
let state = loadState();
let currentPage = "resumen";
let colorTheme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
let pendingDelete = null;
let pendingLegacyRecurringChecksMigration = false;
let hideSettledLoans = localStorage.getItem(LOAN_SETTLED_FILTER_KEY) !== "false";
const savedPeriod = (()=>{try{return JSON.parse(localStorage.getItem(PERIOD_KEY)||"{}")}catch{return {}}})();
let dashboardYear = savedPeriod.year||"";
let dashboardMonth = savedPeriod.month||"all";
let dashboardCategory = "";
let dashboardMerchant = "";
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
async function saveState(previousState){
  const cloud=window.MiDineroCloud;
  try{
    if(!cloud?.configured())throw new Error("Configura Google Sheets antes de guardar registros.");
    await cloud.push(structuredClone(state));
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    return true;
  }catch(error){
    if(previousState)state=previousState;
    const message=cloud?.friendlyError?.(error)||error?.message||"No se pudo guardar en Google Sheets";
    toast(`No se guardó: ${message}`);
    return false;
  }
}
function uid(prefix="r"){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`}
function money(value,country=state.country){return new Intl.NumberFormat(meta[country].locale,{style:"currency",currency:meta[country].currency,maximumFractionDigits:country==="CO"?0:2}).format(Number(value)||0)}
function dateLabel(date){if(!date)return "";return new Intl.DateTimeFormat("es",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`))}
function today(){return new Date().toISOString().slice(0,10)}
function toast(text){const el=$("#toast");el.textContent=text;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
function setButtonBusy(button,busy,label="Guardando…"){
  if(!button)return;
  if(busy){button.dataset.originalText=button.textContent;button.textContent=label;button.disabled=true;button.setAttribute("aria-busy","true")}
  else{button.textContent=button.dataset.originalText||button.textContent;button.disabled=false;button.removeAttribute("aria-busy");delete button.dataset.originalText}
}
function countryItems(arr){return arr.filter(x=>x.country===state.country)}
function categoryRegistry(){
  if(!Array.isArray(state.categories)){
    const saved=state.categories&&typeof state.categories==="object"
      ?[...(state.categories.CN||[]),...(state.categories.CO||[])]
      :[];
    const imported=state.transactions.map(x=>x.category).filter(Boolean);
    state.categories=[...new Set([...fallbackCategories,...saved,...imported])].sort((a,b)=>a.localeCompare(b,"es"));
  }
  return state.categories;
}
function availableCategories(){
  const assigned=state.transactions.map(x=>x.category).filter(Boolean);
  return [...new Set([...categoryRegistry(),...assigned])].sort((a,b)=>a.localeCompare(b,"es"));
}
function categoryUsage(name){return state.transactions.filter(x=>x.category===name).length}
async function addCategory(){
  const input=$("#newCategoryName"),name=input?.value.trim().replace(/\s+/g," ");
  if(!name){toast("Escribe el nombre de la categoría");return}
  if(availableCategories().some(x=>x.localeCompare(name,"es",{sensitivity:"accent"})===0)){toast("La categoría ya existe");return}
  const previousState=structuredClone(state);
  categoryRegistry().push(name);categoryRegistry().sort((a,b)=>a.localeCompare(b,"es"));
  if(await saveState(previousState)){render();toast("Categoría guardada en Google Sheets")}
}
async function applyCategoryRename(oldName,name){
  name=name.trim().replace(/\s+/g," ");
  if(!name){toast("El nombre no puede quedar vacío");return false}
  if(name!==oldName&&availableCategories().some(x=>x.localeCompare(name,"es",{sensitivity:"accent"})===0)){toast("Ya existe una categoría con ese nombre");return false}
  const previousState=structuredClone(state);
  state.categories=categoryRegistry().map(x=>x===oldName?name:x);
  ["transactions","budgets","recurrings"].forEach(collection=>{
    state[collection]=state[collection].map(x=>x.category===oldName?{...x,category:name,updatedAt:new Date().toISOString()}:x);
  });
  if(dashboardCategory===oldName)dashboardCategory=name;
  if(await saveState(previousState)){render();toast("Categoría actualizada en Google Sheets");return true}
  return false;
}
async function removeCategory(name){
  const previousState=structuredClone(state);
  state.categories=categoryRegistry().filter(x=>x!==name);
  if(await saveState(previousState)){render();toast("Categoría eliminada de Google Sheets")}
}
function openCategoryActionDialog(mode,name){
  const modal=$("#categoryActionModal"),card=$("#categoryActionCard");
  if(!modal||!card)return;
  const usage=categoryUsage(name);
  if(mode==="rename"){
    card.innerHTML=`<div class="modal-head"><div><p class="eyebrow">CATEGORÍA</p><h2>Editar nombre</h2></div><button type="button" class="icon-button" data-category-action-close aria-label="Cerrar">×</button></div>
      <form id="categoryRenameForm"><label>Nombre de la categoría<input class="input" id="categoryRenameInput" maxlength="60" value="${escapeAttr(name)}" autocomplete="off"></label><div class="form-actions"><button type="button" class="button ghost" data-category-action-close>Cancelar</button><button type="submit" class="button">Guardar cambios</button></div></form>`;
  }else if(usage){
    card.innerHTML=`<div class="modal-head"><div><p class="eyebrow">CATEGORÍA</p><h2>No se puede eliminar</h2></div><button type="button" class="icon-button" data-category-action-close aria-label="Cerrar">×</button></div>
      <div class="category-action-message"><div class="danger-icon">!</div><p><strong>“${escapeHtml(name)}” tiene ${usage} ${usage===1?"transacción":"transacciones"} asignada${usage===1?"":"s"}.</strong><span>Primero debes reasignarlas a otra categoría en China o Colombia.</span></p></div>
      <div class="form-actions"><button type="button" class="button" data-category-action-close>Entendido</button></div>`;
  }else{
    card.innerHTML=`<div class="modal-head"><div><p class="eyebrow">CATEGORÍA</p><h2>Eliminar categoría</h2></div><button type="button" class="icon-button" data-category-action-close aria-label="Cerrar">×</button></div>
      <div class="category-action-message"><div class="danger-icon">!</div><p><strong>¿Eliminar “${escapeHtml(name)}”?</strong><span>Esta categoría se quitará del catálogo compartido de China y Colombia.</span></p></div>
      <div class="form-actions"><button type="button" class="button ghost" data-category-action-close>Cancelar</button><button type="button" class="button danger" id="confirmCategoryDelete">Eliminar</button></div>`;
  }
  modal.classList.remove("hidden");
  requestAnimationFrame(()=>{const input=$("#categoryRenameInput",card);if(input)input.select();else $("[data-category-action-close]",card)?.focus()});
  const close=()=>modal.classList.add("hidden");
  card.querySelectorAll("[data-category-action-close]").forEach(button=>button.onclick=close);
  modal.onclick=e=>{if(e.target===modal)close()};
  modal.onkeydown=e=>{if(e.key==="Escape"){e.stopPropagation();close()}};
  const form=$("#categoryRenameForm",card);
  if(form)form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type="submit"]');setButtonBusy(button,true);const saved=await applyCategoryRename(name,$("#categoryRenameInput",card).value);if(!saved)setButtonBusy(button,false)};
  const confirm=$("#confirmCategoryDelete",card);
  if(confirm)confirm.onclick=async()=>{setButtonBusy(confirm,true,"Eliminando…");await removeCategory(name);if(document.body.contains(confirm))setButtonBusy(confirm,false)};
}
function pageHead(title,description,action=""){return `<div class="page-head"><div><h2>${title}</h2><p>${description}</p></div>${action}</div>`}
function empty(title,text){return `<div class="empty"><div><strong>${title}</strong>${text}</div></div>`}
function savePeriod(){localStorage.setItem(PERIOD_KEY,JSON.stringify({year:dashboardYear,month:dashboardMonth}))}
function storedLegacyRecurringChecks(){
  if(localStorage.getItem(RECURRING_CHECKS_MIGRATION_KEY)==="complete")return {};
  try{
    const saved=JSON.parse(localStorage.getItem(LEGACY_RECURRING_CHECKS_KEY)||"{}");
    return saved&&typeof saved==="object"?saved:{};
  }catch{return {}}
}
function checkedRecurringCount(checks={}){
  return ["CN","CO"].reduce((total,country)=>total+Object.values(checks[country]||{}).filter(Boolean).length,0);
}
function restoreLegacyRecurringChecks(next){
  const legacy=storedLegacyRecurringChecks();
  if(!checkedRecurringCount(legacy))return next;
  const current=next?.recurringChecks&&typeof next.recurringChecks==="object"?structuredClone(next.recurringChecks):{};
  let restored=false;
  ["CN","CO"].forEach(country=>{
    if(!Object.values(current[country]||{}).some(Boolean)&&Object.values(legacy[country]||{}).some(Boolean)){
      current[country]=structuredClone(legacy[country]);
      restored=true;
    }
  });
  if(!restored)return next;
  pendingLegacyRecurringChecksMigration=true;
  return {...next,recurringChecks:current};
}
function recurringChecks(){return state.recurringChecks||{}}
function isRecurringChecked(id){
  return Boolean(recurringChecks()[state.country]?.[id]);
}
function setRecurringChecked(id,checked){
  const saved=structuredClone(recurringChecks());
  saved[state.country]={...(saved[state.country]||{})};
  if(checked)saved[state.country][id]=true;
  else delete saved[state.country][id];
  state.recurringChecks=saved;
}
function clearRecurringChecks(){
  const saved=structuredClone(recurringChecks());
  delete saved[state.country];
  state.recurringChecks=saved;
}
function applyTheme(theme=colorTheme){
  colorTheme=theme==="light"?"light":"dark";
  document.documentElement.dataset.theme=colorTheme;
  document.documentElement.style.colorScheme=colorTheme;
  const themeColor=document.querySelector('meta[name="theme-color"]');
  if(themeColor)themeColor.content=colorTheme==="light"?"#f4f5f8":"#101117";
}
applyTheme();

function periodOptions(){
  const tx=countryItems(state.transactions).filter(x=>x.date);
  const years=[...new Set(tx.map(x=>x.date.slice(0,4)))].sort((a,b)=>b.localeCompare(a));
  if(!dashboardYear||!years.includes(dashboardYear))dashboardYear=years[0]||String(new Date().getFullYear());
  return years;
}
function merchantKey(value=""){return String(value).trim().replace(/\s+/g," ").toLocaleLowerCase("es")}
function dashboardTransactions({ignoreMonth=false,ignoreCategory=false,ignoreMerchant=false}={}){
  return countryItems(state.transactions).filter(x=>{
    if(!x.date||x.date.slice(0,4)!==dashboardYear)return false;
    if(!ignoreMonth&&dashboardMonth!=="all"&&x.date.slice(5,7)!==dashboardMonth)return false;
    if(!ignoreCategory&&dashboardCategory&&(x.category||"Sin categoría")!==dashboardCategory)return false;
    if(!ignoreMerchant&&dashboardMerchant&&merchantKey(x.description)!==dashboardMerchant)return false;
    return true;
  });
}
function periodLabel(){
  if(dashboardMonth==="all")return `Año ${dashboardYear}`;
  const label=new Date(`${dashboardYear}-${dashboardMonth}-01T12:00:00`).toLocaleString("es",{month:"long"});
  return `${label.charAt(0).toUpperCase()+label.slice(1)} ${dashboardYear}`;
}
function globalPeriodBar(){
  if(!["resumen","transacciones","presupuestos"].includes(currentPage))return "";
  const years=periodOptions();
  const monthNames=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return `<div class="global-period" aria-label="Periodo global">
    <label>Año<select class="select" id="globalYear">${years.map(y=>`<option ${y===dashboardYear?"selected":""}>${y}</option>`).join("")}</select></label>
    <label>Mes<select class="select" id="globalMonth"><option value="all">Todo el año</option>${monthNames.map((m,i)=>{const value=String(i+1).padStart(2,"0");return `<option value="${value}" ${dashboardMonth===value?"selected":""}>${m}</option>`}).join("")}</select></label>
    <button type="button" class="button ghost" data-clear-period>Limpiar</button>
  </div>`;
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
    ?item("Mes anterior","No disponible","No existe un saldo trasladado")
    :item("Mes anterior",money(balance.opening),"Punto de partida; no cuenta como ingreso");
  const income=item("Ingresos del mes",`+${money(balance.income)}`,"Ingresos reales, sin préstamos","in");
  const loans=item("Préstamos y deudas",signedMoney(balance.loanFlow),balance.loanCount?"Entradas y pagos de capital del mes":"Sin movimientos de deuda",balance.loanFlow<0?"out":balance.loanFlow>0?"in":"");
  const transfers=item("Transferencias y ajustes",signedMoney(balance.transferAndAdjustments),"Movimientos de caja fuera de ingresos y gastos",balance.transferAndAdjustments<0?"out":balance.transferAndAdjustments>0?"in":"");
  const expenses=item("Gastos del mes",`−${money(balance.expense)}`,"Consumo y gastos reales","out");
  const closing=balance.closing===null
    ?item("Saldo final","No disponible","Falta un saldo de apertura o cierre")
    :item(balance.verified?"Saldo final":"Saldo final estimado",money(balance.closing),balance.verified?`Conciliado con ${balance.nextLabel}`:"Resultado de las cinco tarjetas anteriores",balance.closing<0?"out":"in");
  return `<div class="balance-flow">${opening}${income}${loans}${transfers}${expenses}${closing}</div>`;
}
function expenseGroups(tx=dashboardTransactions()){
  const map={};
  tx.filter(x=>x.type==="gasto").forEach(x=>{const k=x.category||"Sin categoría";map[k]=(map[k]||0)+Number(x.amount||0)});
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}
function merchantGroups(tx=dashboardTransactions({ignoreMerchant:true})){
  const map=new Map();
  tx.filter(x=>x.type==="gasto").forEach(x=>{
    const label=String(x.description||"Sin descripción").trim().replace(/\s+/g," ")||"Sin descripción";
    const key=merchantKey(label),current=map.get(key)||{key,label,count:0,amount:0};
    current.count+=1;current.amount+=Number(x.amount||0);map.set(key,current);
  });
  return [...map.values()]
    .sort((a,b)=>b.count-a.count||b.amount-a.amount||a.label.localeCompare(b.label,"es"))
    .slice(0,10)
    .sort((a,b)=>b.amount-a.amount||b.count-a.count||a.label.localeCompare(b.label,"es"));
}
function isFlexibleCategory(category=""){
  return /(restaur|comida|aliment|mercado|compra|entreten|ocio|viaje|belleza|hormiga|transporte|delivery|ropa|regalo|suscrip)/i.test(category);
}
function render(){
  applyTheme();
  document.body.dataset.country=state.country;
  $("#pageTitle").textContent=pageNames[currentPage];
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===currentPage));
  document.querySelectorAll("#countrySwitch button").forEach(x=>x.classList.toggle("active",x.dataset.country===state.country));
  const views={resumen:renderDashboard,transacciones:renderTransactions,presupuestos:renderBudgets,transferencias:renderTransfers,prestamos:renderLoans,recurrentes:renderRecurrings,configuracion:renderSettings};
  $("#globalPeriodSlot").innerHTML=globalPeriodBar();
  $("#content").innerHTML=views[currentPage]();
  bindPage();
}
function totals(tx=countryItems(state.transactions)){
  const income=tx.filter(x=>["ingreso","cobro"].includes(x.type)).reduce((a,b)=>a+Number(b.amount),0);
  const expense=tx.filter(x=>x.type==="gasto").reduce((a,b)=>a+Number(b.amount),0);
  return {income,expense,balance:income-expense,count:tx.length};
}
function renderDashboard(){
  const tx=dashboardTransactions(), categoryTx=dashboardTransactions({ignoreCategory:true}), timelineTx=dashboardTransactions({ignoreCategory:true}), t=totals(tx), allTime=totals(), balance=monthlyBalanceReconciliation(t);
  const groups=expenseGroups(categoryTx), selectedGroups=expenseGroups(tx), merchants=merchantGroups(dashboardTransactions({ignoreMerchant:true})), categoryTotal=totals(categoryTx).expense, flexible=selectedGroups.filter(([c])=>isFlexibleCategory(c)).reduce((a,[,v])=>a+v,0);
  const largest=tx.filter(x=>x.type==="gasto").sort((a,b)=>Number(b.amount)-Number(a.amount)).slice(0,5);
  const monthNames=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return `${pageHead("¿En qué se está yendo tu dinero?",`Análisis de ${periodLabel()} en ${meta[state.country].name}.`,`<button class="button" data-add="transaction">+ Nueva transacción</button>`)}
  ${balance?balanceReconciliation(balance):`<div class="balance-note"><span>Balance acumulado de movimientos clasificados</span><strong>${money(allTime.balance)}</strong><small>Entradas menos gastos de ${meta[state.country].name}; no representa un saldo bancario conciliado.</small></div>`}
  <div class="analysis-grid analysis-grid-three">
    <div class="panel category-panel"><div class="panel-head"><div><h3>Participación por categoría</h3><small>Qué categorías concentran el gasto</small></div></div>${categoryParticipation(groups,categoryTotal)}</div>
    <div class="panel timeline-panel"><div class="panel-head"><div><h3>${dashboardMonth==="all"?"Gasto por mes":"Gasto por semana"}</h3><small>Valores del periodo seleccionado</small></div></div>${spendingTimeline(timelineTx)}</div>
    <div class="panel category-panel merchant-panel"><div class="panel-head"><div><h3>Gasto por nombre</h3><small>Top 10 por frecuencia, ordenado por valor gastado</small></div></div>${merchantParticipation(merchants)}</div>
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
    return `<circle class="donut-segment ${selected?"is-selected":""} ${dimmed?"is-dimmed":""}" cx="50" cy="50" r="40" pathLength="100" fill="none" stroke="${colors[i%colors.length]}" stroke-width="18" stroke-dasharray="${percent} ${100-percent}" stroke-dashoffset="${offset}" data-category-filter="${escapeAttr(category)}" data-tooltip-title="${escapeAttr(category)}" data-tooltip-detail="${Math.round(percent)}% · ${escapeAttr(money(value))}" data-tooltip-color="${colors[i%colors.length]}" tabindex="0" role="button" aria-label="${escapeAttr(label)}"></circle>`;
  }).join("");
  const legend=groups.map(([category,value],i)=>{
    const percent=total?Math.round(value/total*100):0,selected=dashboardCategory===category,dimmed=dashboardCategory&&!selected;
    const label=`${category} · ${percent}% · ${money(value)}`;
    return `<button type="button" class="${selected?"is-selected":""} ${dimmed?"is-dimmed":""}" data-category-filter="${escapeAttr(category)}" title="${escapeAttr(label)}"><i style="background:${colors[i%colors.length]}"></i><span>${escapeHtml(category)}</span><strong>${percent}%</strong><small>${money(value)}</small></button>`;
  }).join("");
  return `<div class="category-visual"><div class="donut-wrap"><svg class="donut-svg" viewBox="0 0 100 100" aria-label="Participación del gasto por categoría">${segments}</svg><div class="donut-center"><strong>${money(total)}</strong><span>Total gastado</span></div><div class="donut-tooltip" role="tooltip" aria-hidden="true"><strong></strong><span></span></div></div><div class="category-legend">${legend}</div></div>`;
}
function merchantParticipation(groups){
  if(!groups.length)return empty("Sin gastos","No hay nombres de gastos para el periodo seleccionado.");
  const colors=["var(--accent)","#ff8a65","#8c7ae6","#36c5b4","#e6b94c","#67a8e4","#d36c9d","#8caa5b","#ef7aaf","#55b6c2"];
  const totalAmount=groups.reduce((sum,x)=>sum+x.amount,0);
  const totalCount=groups.reduce((sum,x)=>sum+x.count,0);
  let cursor=0;
  const segments=groups.map((item,i)=>{
    const percent=totalAmount?item.amount/totalAmount*100:0,offset=-cursor;cursor+=percent;
    const selected=dashboardMerchant===item.key,dimmed=dashboardMerchant&&!selected;
    const detail=`${item.count} movimiento${item.count===1?"":"s"}`;
    return `<circle class="donut-segment ${selected?"is-selected":""} ${dimmed?"is-dimmed":""}" cx="50" cy="50" r="40" pathLength="100" fill="none" stroke="${colors[i%colors.length]}" stroke-width="18" stroke-dasharray="${percent} ${100-percent}" stroke-dashoffset="${offset}" data-merchant-filter="${escapeAttr(item.key)}" data-tooltip-title="${escapeAttr(`${item.label} · ${Math.round(percent)}% · ${money(item.amount)}`)}" data-tooltip-detail="${escapeAttr(detail)}" data-tooltip-color="${colors[i%colors.length]}" tabindex="0" role="button" aria-label="${escapeAttr(item.label+" · "+detail)}"></circle>`;
  }).join("");
  const legend=groups.map((item,i)=>{
    const percent=totalAmount?Math.round(item.amount/totalAmount*100):0,selected=dashboardMerchant===item.key,dimmed=dashboardMerchant&&!selected;
    const detail=`${percent}% · ${money(item.amount)} · ${item.count} movimiento${item.count===1?"":"s"}`;
    return `<button type="button" class="${selected?"is-selected":""} ${dimmed?"is-dimmed":""}" data-merchant-filter="${escapeAttr(item.key)}" title="${escapeAttr(item.label+" · "+detail)}"><i style="background:${colors[i%colors.length]}"></i><span>${escapeHtml(item.label)}</span><strong>${percent}%</strong><small>${money(item.amount)}</small></button>`;
  }).join("");
  return `<div class="category-visual merchant-visual"><div class="donut-wrap"><svg class="donut-svg" viewBox="0 0 100 100" aria-label="Los diez nombres más frecuentes, ordenados por valor gastado">${segments}</svg><div class="donut-center"><strong>${money(totalAmount)}</strong><span>${totalCount} movimientos</span></div><div class="donut-tooltip" role="tooltip" aria-hidden="true"><strong></strong><span></span></div></div><div class="category-legend">${legend}</div></div>`;
}
function spendingTimeline(tx){
  const expenses=tx.filter(x=>x.type==="gasto");
  let buckets=[];
  if(dashboardMonth==="all"){
    buckets=Array.from({length:12},(_,i)=>{
      const month=String(i+1).padStart(2,"0");
      const fullLabel=new Date(Number(dashboardYear),i,1).toLocaleString("es",{month:"long"});
      return {label:fullLabel.slice(0,3),detail:`${fullLabel.charAt(0).toUpperCase()+fullLabel.slice(1)} ${dashboardYear}`,value:expenses.filter(x=>x.date?.slice(5,7)===month).reduce((a,b)=>a+Number(b.amount),0),month};
    });
  }else{
    const year=Number(dashboardYear),monthIndex=Number(dashboardMonth)-1;
    const daysInMonth=new Date(Date.UTC(year,monthIndex+1,0)).getUTCDate();
    const shortDay=date=>date.toLocaleDateString("es",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}).replace(/\./g,"");
    let startDay=1,week=1;
    while(startDay<=daysInMonth){
      const startDate=new Date(Date.UTC(year,monthIndex,startDay));
      const daysUntilSaturday=(6-startDate.getUTCDay()+7)%7;
      const endDay=Math.min(daysInMonth,startDay+daysUntilSaturday);
      const endDate=new Date(Date.UTC(year,monthIndex,endDay));
      const value=expenses.filter(x=>{
        const day=Number(x.date?.slice(8,10));
        return day>=startDay&&day<=endDay;
      }).reduce((a,b)=>a+Number(b.amount),0);
      buckets.push({label:`Sem. ${week}`,detail:`${shortDay(startDate)} – ${shortDay(endDate)}`,value,month:""});
      startDay=endDay+1;
      week++;
    }
  }
  const max=Math.max(1,...buckets.map(x=>x.value));
  return `<div class="labeled-bars">${buckets.map(x=>{const height=x.value?Math.max(5,x.value/max*72):2,tooltip=`${x.detail} · ${money(x.value)}`;return `<button type="button" class="labeled-bar ${x.month?"is-clickable":""}" ${x.month?`data-month-filter="${x.month}"`:""} data-bar-tooltip="${escapeAttr(tooltip)}" aria-label="${escapeAttr(tooltip)}"><span class="bar-value">${x.value?chartMoney(x.value):"—"}</span><span class="bar-fill" style="height:${height}%"></span><small>${x.label}</small></button>`}).join("")}<div class="bar-tooltip" role="tooltip" aria-hidden="true"></div></div>`;
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
  const tx=dashboardTransactions({ignoreCategory:true}).sort((a,b)=>b.date.localeCompare(a.date)||Number(b.amount||0)-Number(a.amount||0));
  const categories=[...new Set(tx.map(x=>x.category||"Sin categoría"))].sort((a,b)=>a.localeCompare(b,"es"));
  const actions=`<div class="page-head-actions"><button class="button ghost" type="button" id="exportTransactions">↓ Exportar Excel</button><button class="button" data-add="transaction">+ Nueva transacción</button></div>`;
  return `${pageHead("Todos tus movimientos",`<span id="transactionCount">${tx.length}</span> registros de ${periodLabel()} en ${meta[state.country].name}.`,actions)}
  <div class="filters transaction-filters"><input class="input" id="searchTx" placeholder="Buscar por descripción o categoría" aria-label="Buscar transacciones"><select class="select" id="typeFilter" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="gasto">Gastos</option><option value="ingreso">Ingresos</option><option value="cobro">Cobros</option><option value="ajuste">Ajustes</option></select><select class="select" id="categoryFilter" aria-label="Filtrar por categoría"><option value="">Todas las categorías</option>${categories.map(category=>`<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("")}</select></div>
  <div class="panel table-panel" id="txList">${tx.length?transactionRows(tx):empty("Aún no hay transacciones","Registra un gasto, ingreso, cobro o ajuste.")}</div>`;
}
function transactionRows(tx){return `<div class="transaction-list">${tx.map(x=>`<div class="transaction-row" data-transaction-id="${x.id}" data-search="${escapeAttr(`${x.description||""} ${x.category||""} ${x.type||""}`.toLocaleLowerCase("es"))}" data-type="${escapeAttr(x.type||"")}" data-category="${escapeAttr(x.category||"Sin categoría")}"><div class="tx-icon">${x.type==="gasto"?"↓":"↑"}</div><div><strong>${escapeHtml(x.description)}</strong><small>${escapeHtml(x.category)} · ${dateLabel(x.date)}</small></div><span class="amount ${x.type}">${x.type==="gasto"?"−":"+"}${money(x.amount,x.country)}</span><div class="row-actions"><button data-edit="transaction" data-id="${x.id}" title="Editar">✎</button><button data-delete="transaction" data-id="${x.id}" title="Eliminar">⌫</button></div></div>`).join("")}</div>`}
function spentByCategory(category){return dashboardTransactions({ignoreCategory:true}).filter(x=>x.type==="gasto"&&x.category===category).reduce((a,b)=>a+Number(b.amount),0)}
function renderBudgets(){
  const items=countryItems(state.budgets);
  const months=dashboardMonth==="all"?12:1;
  return `${pageHead("Presupuestos",`Límites y gastos de ${periodLabel()} en ${meta[state.country].name}.`,`<button class="button" data-add="budget">+ Nuevo presupuesto</button>`)}
  <div class="budget-grid">${items.length?items.map(x=>{const monthly=Number(x.amount)||0,limit=monthly*months,spent=spentByCategory(x.category),rawPct=limit?Math.round(spent/limit*100):0,pct=Math.min(100,rawPct);return `<article class="panel budget-card"><div class="budget-top"><div><small class="muted">${escapeHtml(x.category)} · ${escapeHtml(periodLabel())}</small><h3>${money(limit)}</h3><small class="muted">${dashboardMonth==="all"?`${money(monthly)} al mes × 12 meses`:"Límite mensual"}</small></div><div class="row-actions"><button data-edit="budget" data-id="${x.id}">✎</button><button data-delete="budget" data-id="${x.id}">⌫</button></div></div><div class="progress"><span style="width:${pct}%;background:${rawPct>100?"var(--red)":"var(--green)"}"></span></div><div class="budget-values"><span>Usado ${money(spent)}</span><span>${rawPct}%</span></div></article>`}).join(""):empty("Sin presupuestos","Define un límite para comenzar.")}</div>`;
}
function renderTransfers(){
  const items=state.transfers.filter(x=>x.from===state.country||x.to===state.country).sort((a,b)=>b.date.localeCompare(a.date));
  return `${pageHead("Transferencias",`Movimientos vinculados que no cuentan como ingreso ni gasto.`,`<button class="button" data-add="transfer">+ Nueva transferencia</button>`)}
  <div class="panel table-panel">${items.length?`<div class="transaction-list">${items.map(x=>`<div class="transaction-row"><div class="tx-icon">⇄</div><div><strong>${meta[x.from].name} → ${meta[x.to].name}</strong><small>${dateLabel(x.date)} · Comisión ${money(x.fee||0,x.from)}</small></div><span class="amount">${money(x.sent,x.from)} → ${money(x.received,x.to)}</span><div class="row-actions"><button data-edit="transfer" data-id="${x.id}">✎</button><button data-delete="transfer" data-id="${x.id}">⌫</button></div></div>`).join("")}</div>`:empty("Sin transferencias","Registra manualmente los valores enviados y recibidos.")}</div>`;
}
function loanPaymentHistory(loan){
  const saved=Array.isArray(loan.payments)?loan.payments.map(x=>({...x,amount:Number(x.amount)||0})):[],savedTransactionIds=new Set(saved.map(x=>x.transactionId).filter(Boolean));
  const linked=state.transactions.filter(x=>x.loanId===loan.id&&x.loanStage==="payment"&&!savedTransactionIds.has(x.id)).map(x=>({id:`legacy_${x.id}`,amount:Number(x.amount)||0,date:x.date,affectBalance:true,transactionId:x.id,legacy:true}));
  const known=[...saved,...linked],paid=Math.max(0,Number(loan.amount||0)-Number(loan.balance||0)),knownTotal=known.reduce((sum,x)=>sum+Number(x.amount||0),0),untracked=Math.max(0,paid-knownTotal);
  if(untracked>.0001)known.push({id:`historic_${loan.id}`,amount:untracked,date:"",legacy:true,untracked:true});
  return known.sort((a,b)=>(b.date||"").localeCompare(a.date||""));
}
function loanEntityGroups(items){
  const groups=new Map();
  items.forEach(loan=>{
    const person=String(loan.person||"Sin nombre").trim()||"Sin nombre",key=`${loan.direction}::${person.toLocaleLowerCase("es")}`;
    const group=groups.get(key)||{key,person,direction:loan.direction,loans:[],amount:0,balance:0};
    group.loans.push(loan);group.amount+=Number(loan.amount)||0;group.balance+=Number(loan.balance)||0;groups.set(key,group);
  });
  return [...groups.values()].map(x=>({...x,paid:Math.max(0,x.amount-x.balance)})).sort((a,b)=>b.balance-a.balance||a.person.localeCompare(b.person,"es"));
}
function loanDetailModal(){
  return `<div class="modal-backdrop hidden" id="loanDetailModal" role="dialog" aria-modal="true" aria-labelledby="loanDetailTitle"><div class="modal-card loan-detail-modal" id="loanDetailCard"></div></div>`;
}
function renderLoanDetail(group){
  const operations=group.loans.flatMap(loan=>{
    const opening={kind:"opening",date:loan.date,amount:Number(loan.amount)||0,balance:Number(loan.amount)||0,loan,note:loan.note||""};
    let running=Number(loan.amount)||0;
    const payments=loanPaymentHistory(loan).slice().sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999")).map(payment=>{running=Math.max(0,running-Number(payment.amount||0));return {kind:"payment",date:payment.date,amount:Number(payment.amount)||0,balance:running,loan,payment}});
    return [opening,...payments];
  }).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(a.kind==="payment"?-1:1));
  return `<div class="modal-head"><div><p class="eyebrow">${group.direction==="owed"?"DINERO QUE DEBEMOS":"DINERO QUE NOS DEBEN"}</p><h2 id="loanDetailTitle">${escapeHtml(group.person)}</h2></div><button type="button" class="icon-button" data-close-loan-detail aria-label="Cerrar">×</button></div>
    <div class="loan-detail-totals"><div><span>Deuda original</span><strong>${money(group.amount)}</strong></div><div><span>Abonos</span><strong>${money(group.paid)}</strong></div><div class="remaining"><span>Saldo restante</span><strong>${money(group.balance)}</strong></div></div>
    <div class="loan-detail-list">${operations.map(op=>`<article class="loan-history-row ${op.kind}"><span class="loan-history-dot" aria-hidden="true"></span><div class="loan-history-copy"><div><strong>${op.kind==="opening"?"Operación inicial":op.payment?.untracked?"Abonos anteriores":"Abono"}</strong><time>${op.date?dateLabel(op.date):"Sin fecha registrada"}</time></div><p>${op.kind==="opening"?(op.note?escapeHtml(op.note):"Préstamo registrado"):op.payment?.affectBalance?"Con movimiento en Transacciones":"Registro documental"}</p></div><div class="loan-history-values"><strong class="${op.kind==="payment"?"paid":""}">${op.kind==="payment"?"−":""}${money(op.amount)}</strong><small>Saldo: ${money(op.balance)}</small></div></article>`).join("")}</div>`;
}
function openLoanDetail(key,loanId=""){
  let group=loanEntityGroups(countryItems(state.loans)).find(x=>x.key===key);
  if(group&&loanId){
    const loan=group.loans.find(x=>x.id===loanId);
    if(loan)group=loanEntityGroups([loan])[0];
  }
  const modal=$("#loanDetailModal"),card=$("#loanDetailCard");if(!group||!modal||!card)return;
  card.innerHTML=renderLoanDetail(group);modal.classList.remove("hidden");document.body.classList.add("modal-open");$("[data-close-loan-detail]",modal)?.focus();
  const close=()=>{modal.classList.add("hidden");document.body.classList.remove("modal-open")};
  $("[data-close-loan-detail]",modal).onclick=close;modal.onclick=e=>{if(e.target===modal)close()};modal.onkeydown=e=>{if(e.key==="Escape")close()};
}
function renderLoans(){
  const allItems=countryItems(state.loans),items=hideSettledLoans?allItems.filter(x=>Number(x.balance)>0):allItems,groups=loanEntityGroups(items);
  const totalWeOwe=allItems.filter(x=>x.direction==="owed").reduce((sum,x)=>sum+Math.max(0,Number(x.balance)||0),0);
  const totalOwedToUs=allItems.filter(x=>x.direction!=="owed").reduce((sum,x)=>sum+Math.max(0,Number(x.balance)||0),0);
  const loanOverviewTotals=`<div class="loan-overview-totals" aria-label="Totales pendientes"><div><span>Debemos</span><strong>${money(totalWeOwe)}</strong></div><div><span>Nos deben</span><strong>${money(totalOwedToUs)}</strong></div></div>`;
  const actions=`<div class="page-head-actions loan-page-actions"><label class="loan-settled-filter" title="Oculta las deudas cuyo saldo pendiente es cero"><input type="checkbox" data-hide-settled-loans ${hideSettledLoans?"checked":""}><span class="loan-filter-check" aria-hidden="true">✓</span><span>Ocultar saldados</span></label><button class="button" data-add="loan">+ Nuevo préstamo</button></div>`;
  return `${pageHead("Préstamos",`Dinero que debemos y dinero que nos deben.`,actions)}
  <section class="loan-summary-section loan-summary-overview"><div class="loan-section-head"><div><span class="loan-section-kicker">VISTA GENERAL</span><h3>Resumen consolidado por persona o entidad</h3><p class="muted">Agrupa todas las deudas de una misma persona. Selecciona una tarjeta para ver su historial conjunto.</p></div>${loanOverviewTotals}</div>${groups.length?`<div class="loan-summary-grid">${groups.map(group=>`<button type="button" class="panel loan-summary-card ${group.direction==="owed"?"loan-tone-owed":"loan-tone-receivable"}" data-loan-summary="${escapeAttr(group.key)}"><div class="loan-summary-top"><div><small>${group.direction==="owed"?"DEBEMOS":"NOS DEBEN"}</small><h3>${escapeHtml(group.person)}</h3></div><span aria-hidden="true">›</span></div><strong class="loan-summary-balance">${money(group.balance)}</strong><span class="loan-summary-label">Saldo pendiente consolidado</span><div class="loan-summary-meta"><span>Original <b>${money(group.amount)}</b></span><span>Abonado <b>${money(group.paid)}</b></span></div><small>${group.loans.length} ${group.loans.length===1?"operación":"operaciones"} agrupadas</small></button>`).join("")}</div>`:`<div class="loan-overview-empty"><span>Sin deudas registradas</span><small>Los totales aparecerán aquí cuando agregues un préstamo.</small></div>`}</section>
  <section class="loan-individual-section"><div class="loan-section-head loan-individual-head"><div><span class="loan-section-kicker">DETALLE</span><h3>Préstamos individuales</h3><p class="muted">Cada tarjeta representa una deuda particular. Haz clic para consultar su operación y sus abonos.</p></div></div>
  <div class="loan-grid">${items.length?items.map(x=>{const key=`${x.direction}::${String(x.person||"Sin nombre").trim().toLocaleLowerCase("es")}`;return `<article class="panel budget-card loan-item-card ${x.direction==="owed"?"loan-tone-owed":"loan-tone-receivable"}" role="button" tabindex="0" data-loan-detail="${x.id}" data-loan-key="${escapeAttr(key)}" aria-label="Ver historial de ${escapeAttr(x.person)}"><div class="budget-top"><div><small class="muted">${x.direction==="owed"?"DINERO QUE DEBEMOS":"DINERO QUE NOS DEBEN"}</small><h3>${escapeHtml(x.person)}</h3>${x.note?`<p class="loan-description">${escapeHtml(x.note)}</p>`:""}</div><div class="row-actions"><button data-edit="loan" data-id="${x.id}" aria-label="Editar préstamo">✎</button><button data-delete="loan" data-id="${x.id}" aria-label="Eliminar préstamo">⌫</button></div></div><div class="metric-value">${money(x.balance)}</div><small class="muted">De ${money(x.amount)} · ${dateLabel(x.date)}</small><div class="loan-card-footer"><span class="loan-history-link">Ver historial <b aria-hidden="true">›</b></span><button class="button ghost" data-pay="${x.id}">Registrar abono</button></div></article>`}).join(""):empty(hideSettledLoans&&allItems.length?"No hay préstamos pendientes":"Sin préstamos registrados",hideSettledLoans&&allItems.length?"Desactiva “Ocultar saldados” para consultar el historial completo.":"Registra una obligación o cuenta por cobrar.")}</div></section>${loanDetailModal()}`;
}
function renderRecurrings(){
  const items=countryItems(state.recurrings);
  const checkedCount=items.filter(x=>isRecurringChecked(x.id)).length;
  const totalRecurring=items.reduce((sum,x)=>sum+(Number(x.amount)||0),0);
  const totalPending=items.filter(x=>!isRecurringChecked(x.id)).reduce((sum,x)=>sum+(Number(x.amount)||0),0);
  const recurringTotals=`<div class="recurring-total-cards" aria-label="Resumen de pagos recurrentes"><div><span>Total recurrentes</span><strong>${money(totalRecurring)}</strong></div><div class="pending"><span>Pendientes</span><strong>${money(totalPending)}</strong></div></div>`;
  const actions=`<div class="page-head-actions recurring-page-actions">${recurringTotals}<div class="recurring-action-buttons"><button class="button ghost" type="button" data-clear-recurring-checks ${checkedCount?"":"disabled"}>Reiniciar manualmente</button><button class="button" data-add="recurring">+ Nuevo recurrente</button></div></div>`;
  return `${pageHead("Pagos recurrentes",`Recordatorios de gastos e ingresos periódicos.`,actions)}
  <div class="panel table-panel">${items.length?`<div class="recurring-check-summary"><span><strong>${checkedCount}</strong> de ${items.length} pagados</span><small>Estado manual: el día de referencia nunca cambia los checks.</small></div><div class="transaction-list recurring-list">${items.map(x=>{const checked=isRecurringChecked(x.id);return `<div class="transaction-row recurring-row ${checked?"is-paid":""}" data-recurring-row="${x.id}"><label class="recurring-check" title="${checked?"Marcar como pendiente":"Marcar como pagado"}"><input type="checkbox" data-recurring-check="${x.id}" ${checked?"checked":""} aria-label="${checked?"Marcar como pendiente":"Marcar como pagado"}: ${escapeAttr(x.description)}"><span aria-hidden="true">✓</span></label><div class="tx-icon">↻</div><div><strong>${escapeHtml(x.description)}</strong><small>${escapeHtml(x.frequency)} · Día de referencia: ${x.day}</small></div><span class="amount ${x.type}">${money(x.amount)}</span><div class="row-actions"><button data-edit="recurring" data-id="${x.id}">✎</button><button data-delete="recurring" data-id="${x.id}">⌫</button></div></div>`}).join("")}</div>`:empty("Sin pagos recurrentes","Agrega recordatorios; no crean transacciones automáticamente.")}</div>`;
}
function renderSettings(){const cloud=window.MiDineroCloud,connected=cloud?.isConnected(),status=window.miDineroCloudStatus?.text||"Falta configurar Google OAuth";const categories=availableCategories();return `${pageHead("Configuración","Administra categorías, apariencia, sincronización y copias de seguridad.")}
  <div class="panel category-manager-panel">
    <div class="category-manager-head"><div><h3>Categorías compartidas</h3><p class="muted">Un solo catálogo para China y Colombia.</p></div><div class="category-manager-actions"><button type="button" class="button" id="showAddCategory">+ Agregar</button><button type="button" class="button ghost" id="openCategoryManager">Editar</button></div></div>
    <div class="category-add hidden" id="categoryAddForm"><input class="input" id="newCategoryName" maxlength="60" placeholder="Nombre de la nueva categoría"><button type="button" class="button" id="addCategory">Guardar</button><button type="button" class="button ghost" id="cancelAddCategory">Cancelar</button></div>
  </div>
  <div class="modal-backdrop hidden" id="categoryManagerModal" role="dialog" aria-modal="true" aria-labelledby="categoryManagerTitle">
    <div class="modal-card category-manager-modal">
      <div class="modal-head"><div><p class="eyebrow">CONFIGURACIÓN</p><h2 id="categoryManagerTitle">Editar categorías</h2></div><button type="button" class="icon-button" id="closeCategoryManager" aria-label="Cerrar">×</button></div>
      <div class="info-notice"><span aria-hidden="true">i</span><p><strong>Importante:</strong> no puedes eliminar una categoría si tiene transacciones asignadas en China o Colombia. Primero debes reasignarlas a otra categoría.</p></div>
      <div class="category-manager-list">${categories.map(name=>{const usage=categoryUsage(name);return `<div class="category-manager-row"><div><strong>${escapeHtml(name)}</strong><small>${usage} ${usage===1?"transacción":"transacciones"}</small></div><div class="row-actions category-row-actions"><button type="button" data-category-rename="${escapeAttr(name)}" aria-label="Editar ${escapeAttr(name)}" title="Editar categoría">✎</button><button type="button" data-category-delete="${escapeAttr(name)}" class="${usage?"is-disabled":""}" aria-label="Eliminar ${escapeAttr(name)}" title="${usage?"Ver por qué no se puede eliminar":"Eliminar categoría"}">⌫</button></div></div>`}).join("")}</div>
      <div class="modal-backdrop hidden category-action-backdrop" id="categoryActionModal" role="dialog" aria-modal="true">
        <div class="confirm-card category-action-card" id="categoryActionCard"></div>
      </div>
    </div>
  </div>
  <div class="settings-grid"><div class="panel appearance-panel"><h3>Apariencia</h3><p class="muted">Elige cómo quieres ver la aplicación en este dispositivo.</p><div class="theme-selector" role="group" aria-label="Modo de apariencia"><button type="button" data-theme-option="light" class="${colorTheme==="light"?"active":""}" aria-pressed="${colorTheme==="light"}"><span aria-hidden="true">☀</span><strong>Modo día</strong><small>Fondo claro</small></button><button type="button" data-theme-option="dark" class="${colorTheme==="dark"?"active":""}" aria-pressed="${colorTheme==="dark"}"><span aria-hidden="true">☾</span><strong>Modo noche</strong><small>Fondo oscuro</small></button></div></div><div class="panel"><h3>Cuenta</h3><div class="settings-row"><span>Nombre</span><strong>${escapeHtml(state.settings.user)}</strong></div><div class="settings-row"><span>Almacenamiento</span><strong>Google Sheets obligatorio</strong></div><div class="cloud-status" id="cloudStatus">${escapeHtml(status)}</div><div class="form-actions" style="justify-content:flex-start">${connected?`<button class="button" id="syncNow">Sincronizar ahora</button><button class="button ghost" id="disconnectGoogle">Desconectar</button>`:`<button class="button" id="connectGoogle">Conectar Google Sheets</button>`}</div></div>
  <div class="panel private-config-panel"><div class="private-config-head"><div><span class="private-config-kicker">Acceso y sincronización</span><h3>Configuración privada</h3></div><span class="private-config-badge" aria-label="Valores ocultos por defecto">Protegida</span></div><p class="muted private-config-intro">Los identificadores se ocultan para evitar que otras personas los vean en tu pantalla. Los permisos de Google Sheets continúan siendo la protección real de tus datos.</p><div class="private-config-fields"><div class="field"><label for="googleClientId">Google OAuth Client ID</label><div class="secret-input-wrap"><input class="input secret-input" type="password" id="googleClientId" value="${escapeAttr(window.MI_DINERO_CLOUD_CONFIG?.clientId||"")}" placeholder="...apps.googleusercontent.com" autocomplete="off" spellcheck="false"><button type="button" class="secret-toggle" data-secret-toggle="googleClientId" aria-label="Mostrar Google OAuth Client ID" aria-pressed="false"><span class="secret-toggle-icon" aria-hidden="true">◉</span><span class="secret-toggle-label">Mostrar</span></button></div><small class="field-help">Identifica la aplicación ante Google; no es una contraseña.</small></div><div class="field"><label for="googleSheetId">ID del Google Sheet</label><div class="secret-input-wrap"><input class="input secret-input" type="password" id="googleSheetId" value="${escapeAttr(window.MI_DINERO_CLOUD_CONFIG?.spreadsheetId||"")}" placeholder="Identificador del archivo maestro" autocomplete="off" spellcheck="false"><button type="button" class="secret-toggle" data-secret-toggle="googleSheetId" aria-label="Mostrar ID del Google Sheet" aria-pressed="false"><span class="secret-toggle-icon" aria-hidden="true">◉</span><span class="secret-toggle-label">Mostrar</span></button></div><small class="field-help">Solo las cuentas autorizadas en Google pueden acceder al archivo.</small></div></div><div class="private-config-footer"><span class="private-config-note"><span aria-hidden="true">●</span> Se guardan en este navegador al pulsar el botón.</span><button class="button" id="saveCloudConfig">Guardar configuración</button></div></div>
  <div class="panel"><h3>Respaldos</h3><p class="muted">Descarga un respaldo completo o importa uno anterior.</p><div class="form-actions" style="justify-content:flex-start"><button class="button" id="exportData">Exportar respaldo</button><label class="button ghost" for="importData">Importar respaldo</label><input class="file-input" type="file" id="importData" accept=".json"></div><div class="settings-row"><span>Reiniciar aplicación</span><button class="button danger" id="resetData">Borrar todos los datos</button></div></div></div>`}

function bindPage(){
  $$("[data-add]").forEach(b=>b.onclick=()=>openForm(b.dataset.add));
  $$("[data-edit]").forEach(b=>b.onclick=()=>openForm(b.dataset.edit,b.dataset.id));
  $$("[data-delete]").forEach(b=>b.onclick=()=>askDelete(b.dataset.delete,b.dataset.id));
  $$("[data-go]").forEach(b=>b.onclick=()=>{currentPage=b.dataset.go;render()});
  $$("[data-pay]").forEach(b=>b.onclick=()=>payLoan(b.dataset.pay));
  const settledFilter=$("[data-hide-settled-loans]");if(settledFilter)settledFilter.onchange=()=>{hideSettledLoans=settledFilter.checked;localStorage.setItem(LOAN_SETTLED_FILTER_KEY,String(hideSettledLoans));render()};
  document.querySelectorAll("[data-loan-summary]").forEach(b=>b.onclick=()=>openLoanDetail(b.dataset.loanSummary));
  document.querySelectorAll("[data-loan-detail]").forEach(card=>{
    const open=e=>{if(e.target.closest("button, a, input, select, textarea"))return;openLoanDetail(card.dataset.loanKey,card.dataset.loanDetail)};
    card.onclick=open;
    card.onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&!e.target.closest("button, a, input, select, textarea")){e.preventDefault();openLoanDetail(card.dataset.loanKey,card.dataset.loanDetail)}};
  });
  $$("[data-recurring-check]").forEach(input=>input.onchange=async()=>{
    const previousState=structuredClone(state),checked=input.checked;
    input.disabled=true;
    setRecurringChecked(input.dataset.recurringCheck,checked);
    if(await saveState(previousState)){render();toast(checked?"Recurrente guardado como pagado":"Recurrente guardado como pendiente")}
    else{input.checked=!checked;input.disabled=false}
  });
  const clearRecurring=$("[data-clear-recurring-checks]");
  if(clearRecurring)clearRecurring.onclick=async()=>{
    const marked=countryItems(state.recurrings).filter(x=>isRecurringChecked(x.id)).length;
    if(!marked)return;
    if(window.confirm(`¿Reiniciar manualmente ${marked} check${marked===1?"":"s"} de ${meta[state.country].name}? Solo esta acción los marcará como pendientes.`)){
      const previousState=structuredClone(state);setButtonBusy(clearRecurring,true);clearRecurringChecks();
      if(await saveState(previousState)){render();toast("Checks reiniciados en Google Sheets")}else setButtonBusy(clearRecurring,false);
    }
  };
  const search=$("#searchTx"),typeFilter=$("#typeFilter"),categoryFilter=$("#categoryFilter");if(search)search.oninput=filterTransactions;if(typeFilter)typeFilter.onchange=filterTransactions;if(categoryFilter)categoryFilter.onchange=filterTransactions;const exportTransactionsButton=$("#exportTransactions");if(exportTransactionsButton)exportTransactionsButton.onclick=exportVisibleTransactions;
  const year=$("#globalYear"),month=$("#globalMonth");if(year)year.onchange=()=>{dashboardYear=year.value;dashboardCategory="";dashboardMerchant="";savePeriod();render()};if(month)month.onchange=()=>{dashboardMonth=month.value;dashboardCategory="";dashboardMerchant="";savePeriod();render()};
  $$("[data-month-filter]").forEach(b=>b.onclick=()=>{dashboardMonth=dashboardMonth===b.dataset.monthFilter?"all":b.dataset.monthFilter;savePeriod();render()});
  $$("[data-category-filter]").forEach(b=>{b.onclick=()=>{dashboardCategory=dashboardCategory===b.dataset.categoryFilter?"":b.dataset.categoryFilter;render()};b.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();b.click()}}});
  $$("[data-merchant-filter]").forEach(b=>{b.onclick=()=>{dashboardMerchant=dashboardMerchant===b.dataset.merchantFilter?"":b.dataset.merchantFilter;render()};b.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();b.click()}}});
  $$(".donut-wrap").forEach(donutWrap=>{
    const donutTooltip=$(".donut-tooltip",donutWrap);if(!donutTooltip)return;
    const showDonutTooltip=(segment,x,y)=>{
      donutTooltip.querySelector("strong").textContent=segment.dataset.tooltipTitle;
      donutTooltip.querySelector("span").textContent=segment.dataset.tooltipDetail;
      donutTooltip.style.setProperty("--tooltip-color",segment.dataset.tooltipColor);
      donutTooltip.style.removeProperty("--tooltip-shift-x");
      donutTooltip.style.removeProperty("--tooltip-max-width");
      donutTooltip.style.left=`${x}px`;donutTooltip.style.top=`${y}px`;
      donutTooltip.classList.add("show");donutTooltip.setAttribute("aria-hidden","false");
      const merchantPanel=donutWrap.closest(".merchant-panel");
      if(merchantPanel){
        const panelRect=merchantPanel.getBoundingClientRect();
        donutTooltip.style.setProperty("--tooltip-max-width",`${Math.max(180,panelRect.width-32)}px`);
        const tipRect=donutTooltip.getBoundingClientRect();
        const safeLeft=panelRect.left+12,safeRight=panelRect.right-12;
        let shift=0;
        if(tipRect.left<safeLeft)shift=safeLeft-tipRect.left;
        else if(tipRect.right>safeRight)shift=safeRight-tipRect.right;
        donutTooltip.style.setProperty("--tooltip-shift-x",`${shift}px`);
      }
    };
    const hideDonutTooltip=()=>{donutTooltip.classList.remove("show");donutTooltip.setAttribute("aria-hidden","true")};
    $$(".donut-segment",donutWrap).forEach(segment=>{
      segment.onpointerenter=e=>showDonutTooltip(segment,e.clientX-donutWrap.getBoundingClientRect().left,e.clientY-donutWrap.getBoundingClientRect().top);
      segment.onpointermove=e=>showDonutTooltip(segment,e.clientX-donutWrap.getBoundingClientRect().left,e.clientY-donutWrap.getBoundingClientRect().top);
      segment.onpointerleave=hideDonutTooltip;
      segment.onfocus=()=>{const wrapRect=donutWrap.getBoundingClientRect(),rect=segment.getBoundingClientRect();showDonutTooltip(segment,rect.left+rect.width/2-wrapRect.left,rect.top-wrapRect.top)};
      segment.onblur=hideDonutTooltip;
    });
  });
  const barsWrap=$(".labeled-bars"),barTooltip=$(".bar-tooltip");
  if(barsWrap&&barTooltip){
    const positionBarTooltip=(bar,clientX,clientY)=>{
      barTooltip.textContent=bar.dataset.barTooltip;
      barTooltip.classList.add("show");
      barTooltip.setAttribute("aria-hidden","false");
      const wrapRect=barsWrap.getBoundingClientRect();
      const tipRect=barTooltip.getBoundingClientRect();
      const half=tipRect.width/2;
      const x=Math.max(half+8,Math.min(wrapRect.width-half-8,clientX-wrapRect.left));
      const pointerY=clientY-wrapRect.top;
      const below=pointerY<tipRect.height+22;
      barTooltip.classList.toggle("is-below",below);
      barTooltip.style.left=`${x}px`;
      barTooltip.style.top=`${Math.max(8,Math.min(wrapRect.height-8,pointerY+(below?14:-14)))}px`;
    };
    const hideBarTooltip=()=>{barTooltip.classList.remove("show","is-below");barTooltip.setAttribute("aria-hidden","true")};
    [...barsWrap.querySelectorAll(".labeled-bar")].forEach(bar=>{
      bar.onpointerenter=e=>positionBarTooltip(bar,e.clientX,e.clientY);
      bar.onpointermove=e=>positionBarTooltip(bar,e.clientX,e.clientY);
      bar.onpointerleave=hideBarTooltip;
      bar.addEventListener("focus",()=>{const rect=bar.getBoundingClientRect();positionBarTooltip(bar,rect.left+rect.width/2,rect.top+Math.max(48,rect.height*.42))});
      bar.addEventListener("blur",hideBarTooltip);
    });
  }
  const clearChartFilters=$("[data-clear-chart-filters]");if(clearChartFilters)clearChartFilters.onclick=()=>{dashboardCategory="";render()};
  const clearPeriod=$("[data-clear-period]");if(clearPeriod)clearPeriod.onclick=()=>{dashboardYear=periodOptions()[0]||String(new Date().getFullYear());dashboardMonth="all";dashboardCategory="";savePeriod();render()};
  $$("[data-theme-option]").forEach(button=>button.onclick=()=>{localStorage.setItem(THEME_KEY,button.dataset.themeOption);applyTheme(button.dataset.themeOption);render();toast(button.dataset.themeOption==="light"?"Modo día activado":"Modo noche activado")});
  const categoryAddForm=$("#categoryAddForm"),categoryManagerModal=$("#categoryManagerModal");
  if($("#showAddCategory"))$("#showAddCategory").onclick=()=>{categoryAddForm.classList.remove("hidden");$("#newCategoryName")?.focus()};
  if($("#cancelAddCategory"))$("#cancelAddCategory").onclick=()=>{categoryAddForm.classList.add("hidden");$("#newCategoryName").value=""};
  if($("#openCategoryManager"))$("#openCategoryManager").onclick=()=>{categoryManagerModal.classList.remove("hidden");document.body.classList.add("modal-open");$("#closeCategoryManager")?.focus()};
  const closeCategoryManager=()=>{categoryManagerModal?.classList.add("hidden");document.body.classList.remove("modal-open");$("#openCategoryManager")?.focus()};
  if($("#closeCategoryManager"))$("#closeCategoryManager").onclick=closeCategoryManager;
  if(categoryManagerModal)categoryManagerModal.onclick=e=>{if(e.target===categoryManagerModal)closeCategoryManager()};
  if($("#addCategory"))$("#addCategory").onclick=async e=>{setButtonBusy(e.currentTarget,true);await addCategory();if(document.body.contains(e.currentTarget))setButtonBusy(e.currentTarget,false)};
  if($("#newCategoryName"))$("#newCategoryName").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addCategory()}};
  document.querySelectorAll("[data-category-rename]").forEach(button=>button.onclick=()=>openCategoryActionDialog("rename",button.dataset.categoryRename));
  document.querySelectorAll("[data-category-delete]").forEach(button=>button.onclick=()=>openCategoryActionDialog("delete",button.dataset.categoryDelete));
  if(categoryManagerModal)categoryManagerModal.onkeydown=e=>{if(e.key==="Escape"&&$("#categoryActionModal")?.classList.contains("hidden"))closeCategoryManager()};
  if($("#exportData"))$("#exportData").onclick=exportData;if($("#importData"))$("#importData").onchange=importData;if($("#resetData"))$("#resetData").onclick=()=>askDelete("all","all");
  if($("#connectGoogle"))$("#connectGoogle").onclick=()=>window.MiDineroCloud?.connect();if($("#disconnectGoogle"))$("#disconnectGoogle").onclick=()=>window.MiDineroCloud?.disconnect();if($("#syncNow"))$("#syncNow").onclick=()=>window.MiDineroCloud?.pull();if($("#saveCloudConfig"))$("#saveCloudConfig").onclick=saveCloudConfig;
  [...document.querySelectorAll("[data-secret-toggle]")].forEach(button=>{button.onclick=()=>{const input=document.getElementById(button.dataset.secretToggle);if(!input)return;const reveal=input.type==="password";input.type=reveal?"text":"password";button.setAttribute("aria-pressed",String(reveal));button.setAttribute("aria-label",`${reveal?"Ocultar":"Mostrar"} ${input.id==="googleClientId"?"Google OAuth Client ID":"ID del Google Sheet"}`);const label=$(".secret-toggle-label",button);if(label)label.textContent=reveal?"Ocultar":"Mostrar";}});
}
function filterTransactions(){
  const q=($("#searchTx")?.value||"").trim().toLocaleLowerCase("es");
  const type=$("#typeFilter")?.value||"";
  const category=$("#categoryFilter")?.value||"";
  let visible=0;
  $("#txList")?.querySelectorAll(".transaction-row[data-transaction-id]").forEach(row=>{
    const matchesSearch=!q||(row.dataset.search||"").includes(q);
    const matchesType=!type||row.dataset.type===type;
    const matchesCategory=!category||row.dataset.category===category;
    const show=matchesSearch&&matchesType&&matchesCategory;
    row.style.display=show?"grid":"none";
    if(show)visible++;
  });
  const count=$("#transactionCount");
  if(count)count.textContent=String(visible);
}
function exportVisibleTransactions(){
  const visibleIds=$$(".transaction-row[data-transaction-id]",$("#txList")).filter(row=>row.style.display!=="none").map(row=>row.dataset.transactionId);
  const byId=new Map(state.transactions.map(x=>[String(x.id),x]));
  const rows=visibleIds.map(id=>byId.get(String(id))).filter(Boolean);
  if(!rows.length){toast("No hay transacciones visibles para exportar");return}
  const xmlEscape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[char]));
  const headers=["Fecha","Tipo","Descripción","Categoría","Monto","Moneda","País"];
  const values=rows.map(x=>[
    x.date||"",
    ({gasto:"Gasto",ingreso:"Ingreso",cobro:"Cobro / reembolso",ajuste:"Ajuste"})[x.type]||x.type||"",
    x.description||"",
    x.category||"",
    Number(x.amount)||0,
    meta[x.country||state.country].currency,
    meta[x.country||state.country].name
  ]);
  const cell=(value,isNumber=false)=>`<Cell><Data ss:Type="${isNumber?"Number":"String"}">${xmlEscape(value)}</Data></Cell>`;
  const table=[headers,...values].map((row,rowIndex)=>`<Row>${row.map((value,columnIndex)=>cell(value,rowIndex>0&&columnIndex===4)).join("")}</Row>`).join("");
  const workbook=`<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Transacciones"><Table>${table}</Table></Worksheet></Workbook>`;
  const blob=new Blob([workbook],{type:"application/vnd.ms-excel;charset=utf-8"});
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob);
  const month=dashboardMonth==="all"?"todo-el-ano":dashboardMonth;
  link.download=`transacciones-${state.country.toLowerCase()}-${dashboardYear}-${month}.xls`;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),0);
  toast(`${rows.length} transacciones exportadas`);
}
function formField(label,name,type="text",value="",options=null,full=false){return `<div class="field ${full?"full":""}"><label>${label}</label>${options?`<select class="select" name="${name}" required>${options.map(o=>`<option value="${o.value}" ${String(o.value)===String(value)?"selected":""}>${o.label}</option>`).join("")}</select>`:`<input class="input" name="${name}" type="${type}" value="${escapeAttr(value)}" ${type==="number"?'min="0" step="0.01"':""} ${type==="date"?'title="Haz clic para elegir una fecha"':""} required>`}</div>`}
function bindDatePickers(root){
  $$('input[type="date"]',root).forEach(input=>{
    input.addEventListener("click",()=>{
      if(typeof input.showPicker==="function"){
        try{input.showPicker()}catch{}
      }
    });
  });
}
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
  if(kind==="loan")html=formField("Tipo","direction","text",item?.direction||"owed",[{value:"owed",label:"Dinero que debemos"},{value:"receivable",label:"Dinero que nos deben"}])+formField("Persona o entidad","person","text",item?.person||"")+formField("Descripción / motivo (opcional)","note","text",item?.note||"")+formField("Monto original","amount","number",item?.amount||"")+formField("Saldo pendiente","balance","number",item?.balance??item?.amount??"")+formField("Fecha","date","date",item?.date||today())+(!id?`<label class="form-check full"><input type="checkbox" name="affectBalance" value="yes"><span aria-hidden="true">✓</span><div><strong>Crear también una transacción</strong><small>Actívalo solo si el dinero entra o sale de tu saldo ahora. Déjalo apagado si solo documentas una deuda anterior.</small></div></label>`:"");
  if(kind==="recurring")html=formField("Descripción","description","text",item?.description||"",null,true)+formField("Tipo","type","text",item?.type||"gasto",typeOpts.slice(0,2))+formField("Monto","amount","number",item?.amount||"")+formField("Frecuencia","frequency","text",item?.frequency||"Mensual",[{value:"Mensual",label:"Mensual"},{value:"Semanal",label:"Semanal"},{value:"Anual",label:"Anual"}])+formField("Día de cobro","day","number",item?.day||1);
  $("#recordForm").innerHTML=`<div class="form-grid">${html}</div><div class="form-actions"><button type="button" class="button ghost" data-close>Cancelar</button><button class="button" type="submit">Guardar</button></div>`;
  $("#recordForm").dataset.kind=kind;$("#recordForm").dataset.id=id||"";$("#modal").classList.remove("hidden");bindDatePickers($("#recordForm"));$$("[data-close]",$("#modal")).forEach(x=>x.onclick=closeForm);
}
function closeForm(){$("#modal").classList.add("hidden")}
function createLoanCashTransaction({loan,amount,date,stage}){
  const isOpening=stage==="opening";
  const cashIn=isOpening?loan.direction==="owed":loan.direction==="receivable";
  const label=isOpening
    ?(cashIn?"Préstamo recibido":"Dinero prestado")
    :(cashIn?"Abono recibido":"Abono pagado");
  const transaction={
    id:uid("t"),country:loan.country,type:"ajuste",amount:Math.abs(Number(amount)||0),
    cashEffect:(cashIn?1:-1)*Math.abs(Number(amount)||0),
    category:"Préstamos y deudas",description:`${label} · ${loan.person}`,date,
    loanId:loan.id,loanStage:stage,updatedAt:new Date().toISOString()
  };state.transactions.push(transaction);return transaction;
}
$("#recordForm").onsubmit=async e=>{
  e.preventDefault();
  const form=e.currentTarget,submitButton=form.querySelector('[type="submit"]'),previousState=structuredClone(state);
  const kind=e.currentTarget.dataset.kind,id=e.currentTarget.dataset.id,data=Object.fromEntries(new FormData(e.currentTarget));
  if(kind==="loanPayment"){
    const loan=state.loans.find(x=>x.id===id),value=Number(data.amount);
    if(!loan||!value||value<=0||value>Number(loan.balance)){toast("Ingresa un abono válido, sin superar el saldo pendiente");return}
    loan.balance=Number(loan.balance)-value;loan.updatedAt=new Date().toISOString();
    const transaction=data.affectBalance==="yes"?createLoanCashTransaction({loan,amount:value,date:data.date,stage:"payment"}):null;
    if(!Array.isArray(loan.payments))loan.payments=[];
    loan.payments.push({id:uid("lp"),amount:value,date:data.date,affectBalance:data.affectBalance==="yes",transactionId:transaction?.id||null,createdAt:new Date().toISOString()});
    setButtonBusy(submitButton,true);
    if(await saveState(previousState)){closeForm();render();toast(data.affectBalance==="yes"?"Abono y transacción guardados en Google Sheets":"Abono guardado en Google Sheets")}
    else setButtonBusy(submitButton,false);
    return;
  }
  const collection={transaction:"transactions",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[kind];
  ["amount","sent","received","fee","balance","day"].forEach(k=>{if(k in data)data[k]=Number(data[k])});
  if(kind==="transfer"&&data.from===data.to){toast("El origen y el destino deben ser distintos");return}
  const affectBalance=data.affectBalance==="yes";delete data.affectBalance;
  if(kind==="loan"&&!id)data.balance=data.amount;
  const record={...data,id:id||uid(kind[0]),country:kind==="transfer"?undefined:state.country,updatedAt:new Date().toISOString()};
  if(id)state[collection]=state[collection].map(x=>x.id===id?{...x,...record}:x);
  else{state[collection].push(record);if(kind==="loan"&&affectBalance)createLoanCashTransaction({loan:record,amount:record.amount,date:record.date,stage:"opening"});}
  setButtonBusy(submitButton,true);
  if(await saveState(previousState)){closeForm();render();toast(kind==="loan"&&affectBalance?"Préstamo y transacción guardados en Google Sheets":id?"Registro actualizado en Google Sheets":"Registro guardado en Google Sheets")}
  else setButtonBusy(submitButton,false);
};
function askDelete(kind,id){pendingDelete={kind,id};let label="este registro";if(kind!=="all"){const collection={transaction:"transactions",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[kind];const x=state[collection].find(i=>i.id===id);label=x?.description||x?.category||x?.person||"este registro"}$("#confirmText").textContent=kind==="all"?"Se eliminarán todos los datos de la aplicación en Google Sheets.":`Se eliminará “${label}” de Google Sheets. Esta acción no se puede deshacer.`;$("#confirmModal").classList.remove("hidden")}
$("[data-cancel]").onclick=()=>{$("#confirmModal").classList.add("hidden");pendingDelete=null};
$("#confirmDelete").onclick=async e=>{if(!pendingDelete)return;const previousState=structuredClone(state),deleteRequest={...pendingDelete};if(deleteRequest.kind==="all")state=blankState();else{const collection={transaction:"transactions",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[deleteRequest.kind];state[collection]=state[collection].filter(x=>x.id!==deleteRequest.id)}setButtonBusy(e.currentTarget,true,"Eliminando…");if(await saveState(previousState)){$("#confirmModal").classList.add("hidden");pendingDelete=null;render();toast("Registro eliminado de Google Sheets")}else setButtonBusy(e.currentTarget,false)};
function payLoan(id){
  const loan=state.loans.find(x=>x.id===id);if(!loan)return;
  $("#modalEyebrow").textContent="PRÉSTAMO";$("#modalTitle").textContent="Registrar abono";
  $("#recordForm").innerHTML=`<div class="loan-payment-summary"><span>${loan.direction==="owed"?"Le debemos a":"Nos debe"} ${escapeHtml(loan.person)}</span><strong>Saldo pendiente: ${money(loan.balance,loan.country)}</strong></div><div class="form-grid">${formField(`Monto del abono (${meta[loan.country].currency})`,"amount","number","")}${formField("Fecha","date","date",today())}<label class="form-check full"><input type="checkbox" name="affectBalance" value="yes"><span aria-hidden="true">✓</span><div><strong>Crear también una transacción</strong><small>${loan.direction==="owed"?"Registra una salida porque estás devolviendo dinero.":"Registra una entrada porque estás recibiendo el abono."}</small></div></label></div><div class="form-actions"><button type="button" class="button ghost" data-close>Cancelar</button><button class="button" type="submit">Registrar abono</button></div>`;
  $("#recordForm").dataset.kind="loanPayment";$("#recordForm").dataset.id=id;$("#modal").classList.remove("hidden");bindDatePickers($("#recordForm"));$("[data-close]",$("#modal")).forEach(x=>x.onclick=closeForm);
}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`mi-dinero-respaldo-${today()}.json`;a.click();URL.revokeObjectURL(a.href);toast("Respaldo exportado")}
function saveCloudConfig(){const clientId=$("#googleClientId").value.trim(),spreadsheetId=$("#googleSheetId").value.trim();if(!clientId.endsWith(".apps.googleusercontent.com")||!spreadsheetId){toast("Revisa el Client ID y el Sheet ID");return}localStorage.setItem("mi-dinero-cloud-config",JSON.stringify({clientId,spreadsheetId,sheetName:"_AppState"}));toast("Configuración guardada; recargando…");setTimeout(()=>location.reload(),700)}
function importData(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{const previousState=structuredClone(state);try{const imported=JSON.parse(reader.result);if(!imported.transactions||!imported.version)throw Error();state={...blankState(),...imported};if(await saveState(previousState)){render();toast("Respaldo importado en Google Sheets")}}catch{state=previousState;toast("El archivo no es un respaldo válido")}};reader.readAsText(file)}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function escapeAttr(v=""){return escapeHtml(v)}

$("#nav").onclick=e=>{const b=e.target.closest("[data-page]");if(!b)return;currentPage=b.dataset.page;$("#sidebar").classList.remove("open");render()};
$("#countrySwitch").onclick=e=>{const b=e.target.closest("[data-country]");if(!b)return;state.country=b.dataset.country;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render()};
$("#menuButton").onclick=()=>$("#sidebar").classList.toggle("open");
$("#refreshButton").onclick=()=>{const cloud=window.MiDineroCloud;if(!cloud?.isConnected()){toast("Conecta Google Sheets para actualizar los datos");cloud?.showLogin?.();return}cloud.pull()};
window.miDineroGetState=()=>structuredClone(state);
window.miDineroApplyState=(next,{silent=false}={})=>{state={...blankState(),...restoreLegacyRecurringChecks(next)};localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();if(!silent)toast("Datos sincronizados desde Google Sheets")};
window.miDineroGetPendingRecurringChecksMigration=()=>pendingLegacyRecurringChecksMigration?structuredClone(state):null;
window.miDineroCompleteRecurringChecksMigration=()=>{
  pendingLegacyRecurringChecksMigration=false;
  localStorage.setItem(RECURRING_CHECKS_MIGRATION_KEY,"complete");
  localStorage.removeItem(LEGACY_RECURRING_CHECKS_KEY);
};
window.miDineroRefresh=render;
render();

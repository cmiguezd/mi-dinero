const STORAGE_KEY = "mi-dinero-v3";
const PERIOD_KEY = "mi-dinero-global-period";
const THEME_KEY = "mi-dinero-theme";
const LEGACY_RECURRING_CHECKS_KEY = "mi-dinero-recurring-checks";
const RECURRING_CHECKS_MIGRATION_KEY = "mi-dinero-recurring-checks-migrated-v1";
const LOAN_SETTLED_FILTER_KEY = "mi-dinero-hide-settled-loans";
const LAST_SYNC_KEY = "mi-dinero-last-successful-sync";
const blankState = () => ({
  version: 3, country: "CN",
  transactions: [], accounts: [], budgets: [], transfers: [], loans: [], recurrings: [], recurringChecks: {},
  settings: { user: "Carlos", email: "Cuenta local", dataSource: "Este dispositivo" }
});
let state = loadState();
let currentPage = "resumen";
let colorTheme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
let pendingDelete = null;
let recordModalReturnFocus = null;
let pendingLegacyRecurringChecksMigration = false;
let hideSettledLoans = localStorage.getItem(LOAN_SETTLED_FILTER_KEY) !== "false";
let loanDetailContext = null;
let loanDetailReturnContext = null;
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
const pageNames={resumen:"Resumen",cuentas:"Cuentas",transacciones:"Transacciones",presupuestos:"Presupuestos",transferencias:"Transferencias",prestamos:"Préstamos",recurrentes:"Recurrentes",configuracion:"Configuración"};
const mobilePrimaryActions={
  resumen:{kind:"transaction",label:"Nuevo movimiento"},
  cuentas:{kind:"account",label:"Nueva cuenta"},
  transacciones:{kind:"transaction",label:"Nuevo movimiento"},
  presupuestos:{kind:"budget",label:"Nuevo presupuesto"},
  recurrentes:{kind:"recurring",label:"Nuevo recurrente"},
  transferencias:{kind:"transfer",label:"Nueva transferencia"},
  prestamos:{kind:"loan",label:"Nuevo préstamo"}
};

function initialState(){return window.MI_DINERO_INITIAL_DATA?{...blankState(),...structuredClone(window.MI_DINERO_INITIAL_DATA)}:blankState()}
function loadState(){try{const saved=localStorage.getItem(STORAGE_KEY);return saved?{...blankState(),...JSON.parse(saved)}:initialState()}catch{return initialState()}}
function displayLastSync(){
  const el=$("#liveSyncTime");if(!el)return;
  const saved=localStorage.getItem(LAST_SYNC_KEY),value=Number(saved)||Date.parse(saved||"");
  const text=value?new Intl.DateTimeFormat("es",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"Sin sincronización previa";
  el.textContent=value?`Última sincronización ${new Intl.DateTimeFormat("es",{hour:"2-digit",minute:"2-digit"}).format(new Date(value))}`:text;
  const settingsTime=$("#settingsLastSync");if(settingsTime)settingsTime.textContent=text;
  el.title=value?new Intl.DateTimeFormat("es",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"Aún no se ha confirmado una sincronización";
}
window.miDineroMarkSynced=()=>{localStorage.setItem(LAST_SYNC_KEY,String(Date.now()));displayLastSync()};
window.miDineroRefreshSyncTime=displayLastSync;
async function saveState(previousState){
  const cloud=window.MiDineroCloud;
  try{
    if(!cloud?.configured())throw new Error("Configura Google Sheets antes de guardar registros.");
    await cloud.push(structuredClone(state),previousState?structuredClone(previousState):undefined);
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    displayLastSync();
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
// Fecha local del dispositivo (toISOString usa UTC: en China antes de las 8:00 daba el día anterior).
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function toast(text){if(window.MI_DINERO_SCRIPT_MODE)text=text.replace(/(guardad[oa]s?|actualizad[oa]s?|eliminad[oa]s?) en Google Sheets/gi,"$1 localmente; sincronización en segundo plano");const el=$("#toast");el.textContent=text;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
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
    card.innerHTML=`<div class="modal-head"><div><p class="eyebrow">CATEGORÍA</p><h2>Editar nombre</h2></div><button type="button" class="icon-button" data-category-action-close aria-label="Cerrar"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
      <form id="categoryRenameForm"><label>Nombre de la categoría<input class="input" id="categoryRenameInput" maxlength="60" value="${escapeAttr(name)}" autocomplete="off"></label><div class="form-actions"><button type="button" class="button ghost" data-category-action-close>Cancelar</button><button type="submit" class="button">Guardar cambios</button></div></form>`;
  }else if(usage){
    card.innerHTML=`<div class="modal-head"><div><p class="eyebrow">CATEGORÍA</p><h2>No se puede eliminar</h2></div><button type="button" class="icon-button" data-category-action-close aria-label="Cerrar"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
      <div class="category-action-message"><div class="danger-icon"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></div><p><strong>“${escapeHtml(name)}” tiene ${usage} ${usage===1?"transacción":"transacciones"} asignada${usage===1?"":"s"}.</strong><span>Primero debes reasignarlas a otra categoría en China o Colombia.</span></p></div>
      <div class="form-actions"><button type="button" class="button" data-category-action-close>Entendido</button></div>`;
  }else{
    card.innerHTML=`<div class="modal-head"><div><p class="eyebrow">CATEGORÍA</p><h2>Eliminar categoría</h2></div><button type="button" class="icon-button" data-category-action-close aria-label="Cerrar"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
      <div class="category-action-message"><div class="danger-icon"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></div><p><strong>¿Eliminar “${escapeHtml(name)}”?</strong><span>Esta categoría se quitará del catálogo compartido de China y Colombia.</span></p></div>
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
  if(themeColor)themeColor.content=colorTheme==="light"?"#f3f4f6":"#0a0b0e";
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
function openingBalanceForMonth(year,month,country=state.country){
  const ym=`${year}-${month}`;
  const rows=state.transactions.filter(x=>x.country===country)
    .filter(x=>x.date?.slice(0,7)===ym&&isCarryForwardTransaction(x))
    .sort((a,b)=>a.date.localeCompare(b.date));
  return rows.length?Number(rows[0].amount)||0:null;
}
function isLoanTransaction(x){
  const text=`${x.category||""} ${x.description||""} ${x.originalType||x.tipoOriginal||x.Tipo_original||""}`;
  return /(pr[eé]stamo|deuda|nos pagan|capital prestado|pago de capital)/i.test(text);
}
function calculateMonthlyBalance(year,month,country,periodTx){
  const opening=openingBalanceForMonth(year,month,country);
  const ym=`${year}-${month}`;
  const operatingTx=periodTx.filter(x=>!isLoanTransaction(x));
  const periodTotals=totals(operatingTx);
  const directFlow=periodTotals.income-periodTotals.expense;
  const loanTx=periodTx.filter(isLoanTransaction);
  const loanFlow=loanTx.reduce((sum,x)=>sum+transactionCashChange(x),0);
  const adjustmentFlow=periodTx
    .filter(x=>x.type==="ajuste"&&!isLoanTransaction(x))
    .reduce((sum,x)=>sum+transactionCashChange(x),0);
  const transferFlow=state.transfers.reduce((sum,x)=>{
    if(x.from===country&&x.date?.startsWith(ym))sum-=(Number(x.sent)||0)+(Number(x.fee)||0);
    const receivedDate=x.arrivalDate||x.date;
    if(x.to===country&&receivedDate?.startsWith(ym))sum+=Number(x.received)||0;
    return sum;
  },0);
  const next=shiftedMonth(year,month,1);
  const recordedClosing=openingBalanceForMonth(next.year,next.month,country);
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
function monthlyBalanceReconciliation(){
  if(dashboardMonth==="all")return null;
  return calculateMonthlyBalance(dashboardYear,dashboardMonth,state.country,dashboardTransactions({ignoreCategory:true}));
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
  document.body.dataset.page=currentPage;
  $("#pageTitle").textContent=pageNames[currentPage];
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===currentPage));
  document.querySelectorAll("#countrySwitch button").forEach(x=>x.classList.toggle("active",x.dataset.country===state.country));
  const views={resumen:renderDashboard,cuentas:renderAccounts,transacciones:renderTransactions,presupuestos:renderBudgets,transferencias:renderTransfers,prestamos:renderLoans,recurrentes:renderRecurrings,configuracion:renderSettings};
  $("#globalPeriodSlot").innerHTML=globalPeriodBar();
  $("#content").innerHTML=views[currentPage]();
  displayLastSync();
  bindPage();
  updateMobileNavigation();
}
function totals(tx=countryItems(state.transactions)){
  const income=tx.filter(x=>["ingreso","cobro"].includes(x.type)).reduce((a,b)=>a+Number(b.amount),0);
  const expense=tx.filter(x=>x.type==="gasto").reduce((a,b)=>a+Number(b.amount),0);
  return {income,expense,balance:income-expense,count:tx.length};
}
function renderDashboard(){
  const months=periodMonths(),prev=previousPeriodMonths();
  const flow=monthFlow(months),prevFlow=monthFlow(prev.months),balance=periodBalance();
  const categoryTx=dashboardTransactions({ignoreCategory:true}),groups=expenseGroups(categoryTx),catTotal=totals(categoryTx).expense;
  const prevTx=countryItems(state.transactions).filter(x=>x.date&&prev.months.includes(x.date.slice(0,7))&&(!dashboardMerchant||merchantKey(x.description)===dashboardMerchant));
  const merchantTx=dashboardTransactions({ignoreMerchant:true}),merchants=merchantGroups(merchantTx);
  return `${pageHead("¿En qué se está yendo tu dinero?",`${periodLabel()} en ${meta[state.country].name}.`,`<button class="button" data-add="transaction"><i class="bi bi-plus-lg" aria-hidden="true"></i>Nuevo movimiento</button>`)}
  ${dashKpis(flow,prevFlow,prev.label,balance)}
  <div class="dz-cols"><div class="dz-col">${flowCard(flow,balance).replace('class="dz-panel"','class="dz-panel dz-o1"')}${dailyCard().replace('class="dz-panel"','class="dz-panel dz-o3"')}${monthlyCard().replace('class="dz-panel"','class="dz-panel dz-o4"')}</div><div class="dz-col">${categoryCard(groups,catTotal,expenseGroups(prevTx)).replace('class="dz-panel"','class="dz-panel dz-o2"')}${budgetsCard().replace('class="dz-panel"','class="dz-panel dz-o5"')}${merchantsCard(merchants,totals(merchantTx).expense).replace('class="dz-panel ','class="dz-panel dz-o6 ')}</div></div>`;
}
function metric(label,value,small,color){return `<article class="metric"><div class="metric-label"><span>${label}</span><i class="dot ${color}"></i></div><div class="metric-value">${value}</div><small>${small}</small></article>`}
function latestDashboardBalance(country=state.country){
  const periods=[];
  state.transactions.forEach(x=>{if(x.country===country&&x.date)periods.push(x.date.slice(0,7))});
  state.transfers.forEach(x=>{
    if(x.from===country&&x.date)periods.push(x.date.slice(0,7));
    const receivedDate=x.arrivalDate||x.date;
    if(x.to===country&&receivedDate)periods.push(receivedDate.slice(0,7));
  });
  const sortedPeriods=[...new Set(periods.filter(x=>/^\d{4}-\d{2}$/.test(x)))].sort();
  const latest=sortedPeriods[sortedPeriods.length-1];
  if(!latest)return {value:null,label:"Sin periodo disponible",verified:false};
  const [year,month]=latest.split("-");
  const periodTx=state.transactions.filter(x=>x.country===country&&x.date?.slice(0,7)===latest);
  const balance=calculateMonthlyBalance(year,month,country,periodTx);
  return {value:balance?.closing??null,label:shiftedMonth(year,month).label,verified:Boolean(balance?.verified)};
}

const ACCOUNT_BRAND_CATALOG=[
  {key:"nequi",label:"Nequi",match:["nequi"],mark:"N",bg:"#260029",fg:"#ff2f92"},
  {key:"daviplata",label:"DaviPlata",match:["daviplata","davi plata"],mark:"D",bg:"#ed1c24",fg:"#ffffff"},
  {key:"davivienda",label:"Davivienda",match:["davivienda"],mark:"D",bg:"#d71920",fg:"#ffffff"},
  {key:"bbva",label:"BBVA",match:["bbva"],mark:"BBVA",bg:"#072146",fg:"#ffffff"},
  {key:"bancolombia",label:"Bancolombia",match:["bancolombia","a la mano"],mark:"B",bg:"#ffd800",fg:"#111111"},
  {key:"bogota",label:"Banco de Bogotá",match:["banco de bogota","banco bogota"],mark:"B",bg:"#004b93",fg:"#ffffff"},
  {key:"occidente",label:"Banco de Occidente",match:["banco de occidente","banco occidente"],mark:"O",bg:"#ffffff",fg:"#d71920"},
  {key:"popular",label:"Banco Popular",match:["banco popular"],mark:"P",bg:"#00853e",fg:"#ffffff"},
  {key:"avvillas",label:"AV Villas",match:["av villas","avvillas"],mark:"AV",bg:"#e30613",fg:"#ffffff"},
  {key:"falabella",label:"Banco Falabella",match:["falabella"],mark:"F",bg:"#7ab800",fg:"#ffffff"},
  {key:"lulo",label:"Lulo Bank",match:["lulo"],mark:"L",bg:"#6723d7",fg:"#d9ff53"},
  {key:"dale",label:"dale!",match:["dale!","dale banco","billetera dale"],mark:"d!",bg:"#ed1e79",fg:"#ffffff"},
  {key:"rappipay",label:"RappiPay",match:["rappipay","rappi pay"],mark:"R",bg:"#ff5a1f",fg:"#ffffff"},
  {key:"tpaga",label:"Tpaga",match:["tpaga"],mark:"T",bg:"#1665d8",fg:"#ffffff"},
  {key:"nubank",label:"Nubank",match:["nubank","nu bank"],path:"M7.2795 5.4336c-1.1815 0-2.1846.4628-2.9432 1.252h-.002c-.0541-.0022-.1074-.002-.162-.002-1.5436 0-2.9925.8835-3.699 2.2559-.3088.5996-.4234 1.2442-.459 1.9003-.0321.589 0 1.1863 0 1.7696v5.6523H3.184s.0022-2.784 0-5.1777c-.0014-1.6112-.0118-3.0471 0-3.3418.056-1.3937.4372-2.3053 1.1484-3.0508 2.3585.0018 3.8852 1.6091 3.9705 4.168.0196.5874.0254 3.7304.0254 3.7304v3.672h3.1678v-4.965c0-1.5007.0127-2.8006-.0918-3.6952-.292-2.5-1.821-4.168-4.1248-4.168zm8.3903.3008l-3.166.0039v4.9648c0 1.5009-.0127 2.8007.0919 3.6953.2921 2.5001 1.821 4.168 4.1248 4.168 1.1815 0 2.1846-.4628 2.9432-1.252.0003-.0003.0016.0004.002 0 .0542.0023.1093.002.164.002 1.5435 0 2.9905-.8835 3.6971-2.2558.3088-.5997.4233-1.2442.459-1.9004.032-.5889 0-1.1862 0-1.7695V5.7383H20.816s-.0022 2.784 0 5.1777c.0015 1.6113.0119 3.047 0 3.3418-.056 1.3935-.4372 2.3053-1.1483 3.0508-2.3586-.0018-3.8853-1.6091-3.9706-4.168-.0196-.5874-.0273-2.0437-.0273-3.7324Z",bg:"#820ad1",fg:"#ffffff"},
  {key:"alipay",label:"Alipay",match:["alipay","zhi fu bao","zhifubao","支付宝"],path:"M19.695 15.07c3.426 1.158 4.203 1.22 4.203 1.22V3.846c0-2.124-1.705-3.845-3.81-3.845H3.914C1.808.001.102 1.722.102 3.846v16.31c0 2.123 1.706 3.845 3.813 3.845h16.173c2.105 0 3.81-1.722 3.81-3.845v-.157s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333m-13.81-2.032c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809",bg:"#1677ff",fg:"#ffffff"},
  {key:"wechat",label:"WeChat Pay",match:["wechat","we chat","weixin","微信"],path:"M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z",bg:"#07c160",fg:"#ffffff"},
  {key:"bankofchina",label:"Bank of China",match:["bank of china","banco de china","中国银行","boc china"],mark:"中",bg:"#b50923",fg:"#ffffff"},
  {key:"icbc",label:"ICBC",match:["icbc","industrial and commercial bank","工商银行"],mark:"工",bg:"#c8102e",fg:"#ffffff"},
  {key:"ccb",label:"China Construction Bank",match:["china construction bank","construction bank","ccb","建设银行"],mark:"CCB",bg:"#005baa",fg:"#ffffff"},
  {key:"abc",label:"Agricultural Bank of China",match:["agricultural bank of china","agriculture bank","abc bank","农业银行"],mark:"ABC",bg:"#008675",fg:"#ffffff"},
  {key:"cmb",label:"China Merchants Bank",match:["china merchants bank","cmb","招商银行"],mark:"CMB",bg:"#c8102e",fg:"#ffffff"},
  {key:"unionpay",label:"UnionPay",match:["unionpay","union pay","银联"],mark:"UP",bg:"#1768a5",fg:"#ffffff"},
  {key:"bocom",label:"Bank of Communications",match:["bank of communications","bocom","交通银行"],mark:"BC",bg:"#005ca9",fg:"#ffffff"},
  {key:"psbc",label:"Postal Savings Bank of China",match:["postal savings bank","psbc","邮储银行"],mark:"PS",bg:"#008264",fg:"#ffffff"},
  {key:"pingan",label:"Ping An Bank",match:["ping an","pingan","平安银行"],mark:"PA",bg:"#f05a28",fg:"#ffffff"},
  {key:"paypal",label:"PayPal",match:["paypal","pay pal"],path:"M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z",bg:"#ffffff",fg:"#003087"},
  {key:"wise",label:"Wise",match:["wise","transferwise"],path:"M6.488 7.469 0 15.05h11.585l1.301-3.576H7.922l3.033-3.507.01-.092L8.993 4.48h8.873l-6.878 18.925h4.706L24 .595H2.543l3.945 6.874Z",bg:"#9fe870",fg:"#163300"},
  {key:"applepay",label:"Apple Pay",match:["apple pay","applepay"],mark:"Apple",bg:"#ffffff",fg:"#111111"},
  {key:"googlepay",label:"Google Pay",match:["google pay","googlepay","gpay"],mark:"G Pay",bg:"#ffffff",fg:"#3c4043"},
  {key:"mercadopago",label:"Mercado Pago",match:["mercado pago","mercadopago"],mark:"MP",bg:"#009ee3",fg:"#ffffff"},
  {key:"visa",label:"Visa",match:["visa"],path:"M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z",bg:"#ffffff",fg:"#1a1f71"},
  {key:"mastercard",label:"Mastercard",match:["mastercard","master card"],mark:"MC",bg:"#111111",fg:"#ff5f00"},
  {key:"revolut",label:"Revolut",match:["revolut"],mark:"R",bg:"#ffffff",fg:"#111111"}
];
function normalizeAccountName(value=""){
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
}
function accountBrandFor(name){
  const normalized=normalizeAccountName(name);
  const brand=ACCOUNT_BRAND_CATALOG.find(item=>item.match.some(term=>normalized.includes(normalizeAccountName(term))));
  if(brand)return brand;
  const fallbacks=[
    {key:"cash",label:"Efectivo",match:/efectivo|cash|caja|caja menor/,icon:"bi-cash-stack",bg:"var(--accent-soft)",fg:"var(--accent)"},
    {key:"card",label:"Tarjeta",match:/tarjeta|credito|debito|card/,icon:"bi-credit-card",bg:"var(--accent-soft)",fg:"var(--accent)"},
    {key:"savings",label:"Ahorros",match:/ahorro|savings|deposito/,icon:"bi-piggy-bank",bg:"var(--accent-soft)",fg:"var(--accent)"},
    {key:"investment",label:"Inversiones",match:/inversion|investment|broker|fondo|cdt/,icon:"bi-graph-up-arrow",bg:"var(--accent-soft)",fg:"var(--accent)"},
    {key:"crypto",label:"Cripto",match:/crypto|cripto|bitcoin|ethereum|binance/,icon:"bi-currency-bitcoin",bg:"var(--accent-soft)",fg:"var(--accent)"},
    {key:"bank",label:"Banco",match:/banco|bank|cuenta corriente|checking/,icon:"bi-bank",bg:"var(--accent-soft)",fg:"var(--accent)"},
    {key:"wallet",label:"Billetera",match:/billetera|wallet|pay/,icon:"bi-wallet2",bg:"var(--accent-soft)",fg:"var(--accent)"}
  ];
  return fallbacks.find(item=>item.match.test(normalized))||{key:"generic",label:"Cuenta",icon:"bi-wallet2",bg:"var(--accent-soft)",fg:"var(--accent)"};
}
function accountBrandMark(name){
  const brand=accountBrandFor(name);
  const content=brand.path
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${brand.path}"></path></svg>`
    : brand.mark
      ? `<span class="account-brand-mark ${brand.mark.length>2?"is-word":""}">${escapeHtml(brand.mark)}</span>`
      : `<i class="bi ${brand.icon}" aria-hidden="true"></i>`;
  return `<span class="account-card-icon account-brand-icon" data-brand="${escapeAttr(brand.key)}" style="--brand-bg:${brand.bg};--brand-fg:${brand.fg}" role="img" aria-label="Logo de ${escapeAttr(brand.label)}">${content}</span>`;
}

function accountIsStale(value){const t=new Date(value).getTime();return Boolean(value)&&Number.isFinite(t)&&Date.now()-t>7*864e5}
function accountUpdateLabel(value){
  if(!value)return "Sin actualización registrada";
  const date=new Date(value);if(Number.isNaN(date.getTime()))return "Actualización reciente";
  return `Actualizada ${new Intl.DateTimeFormat("es",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(date)}`;
}
function renderAccounts(){
  const items=countryItems(Array.isArray(state.accounts)?state.accounts:[]).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"es"));
  const manualTotal=items.reduce((sum,item)=>sum+(Number(item.balance)||0),0);
  const dashboard=latestDashboardBalance();
  const difference=!items.length||dashboard.value===null?null:manualTotal-dashboard.value;
  const tolerance=state.country==="CO"?.5:.005;
  const matches=difference!==null&&Math.abs(difference)<tolerance;
  const differenceTone=difference===null?"is-unavailable":matches?"is-match":difference>0?"is-over":"is-under";
  const differenceValue=!items.length?"Pendiente":difference===null?"No disponible":matches?money(0):signedMoney(difference);
  const differenceCopy=!items.length
    ?"Agrega al menos una cuenta para iniciar la comparación."
    :difference===null
      ?"El tablero aún no tiene un saldo final disponible para comparar."
    :matches
      ?"El total manual coincide con el saldo del tablero."
      :difference>0
        ?`Hay ${money(Math.abs(difference))} más en tus cuentas que en el tablero.`
        :`Faltan ${money(Math.abs(difference))} en tus cuentas frente al tablero.`;
  const dashboardCopy=dashboard.value===null?dashboard.label:`${dashboard.label} · ${dashboard.verified?"Saldo conciliado":"Saldo estimado"}`;
  const actions=`<button class="button" data-add="account"><i class="bi bi-plus-lg" aria-hidden="true"></i>Nueva cuenta</button>`;
  return `${pageHead("Control de cuentas",`Comprueba que tus saldos reales coincidan con el tablero de ${meta[state.country].name}.`,actions)}
    <div class="account-notice"><i class="bi bi-shield-check" aria-hidden="true"></i><span>Estos valores son independientes: no crean transacciones ni modifican ningún cálculo del tablero.</span></div>
    <section class="account-reconciliation" aria-label="Comparación de saldos">
      <article class="panel account-summary-card"><span>Saldo del tablero</span><strong>${dashboard.value===null?"No disponible":money(dashboard.value)}</strong><small>${escapeHtml(dashboardCopy)}</small></article>
      <article class="panel account-summary-card"><span>Total en cuentas</span><strong>${money(manualTotal)}</strong><small>${items.length} ${items.length===1?"cuenta registrada":"cuentas registradas"}</small></article>
      <article class="panel account-summary-card account-difference ${differenceTone}" aria-live="polite"><span>Diferencia por conciliar</span><strong>${differenceValue}</strong><small>${escapeHtml(differenceCopy)}</small></article>
    </section>
    <div class="account-section-head"><div><h3>Tus cuentas en ${meta[state.country].name}</h3><p class="muted">Edita el saldo cada vez que quieras comprobarlo. El valor anterior será reemplazado.</p></div></div>
    <section class="account-grid">${items.length?items.map(item=>`<article class="panel account-card"><div class="account-card-top">${accountBrandMark(item.name)}<div class="row-actions"><button data-edit="account" data-id="${item.id}" title="Editar cuenta" aria-label="Editar ${escapeAttr(item.name)}"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button data-delete="account" data-id="${item.id}" title="Eliminar cuenta" aria-label="Eliminar ${escapeAttr(item.name)}"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></div><h3>${escapeHtml(item.name)}</h3><strong class="account-card-balance">${money(item.balance)}</strong><small class="${accountIsStale(item.updatedAt)?"is-stale":""}">${escapeHtml(accountUpdateLabel(item.updatedAt))}${accountIsStale(item.updatedAt)?" · actualízala antes de conciliar":""}</small></article>`).join(""):empty("Aún no tienes cuentas registradas",`Agrega bancos, billeteras o efectivo de ${meta[state.country].name} para comparar su total.`)}</section>`;
}
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
function transactionTotalsHtml(tx){
  const exp=tx.filter(x=>x.type==="gasto"),expSum=exp.reduce((a,x)=>a+(Number(x.amount)||0),0);
  const incSum=tx.filter(x=>x.type==="ingreso"||x.type==="cobro").reduce((a,x)=>a+(Number(x.amount)||0),0);
  return `<div><span>Movimientos</span><strong class="num">${tx.length}</strong></div><div><span><i class="dz-dot is-exp" aria-hidden="true"></i>Gastos</span><strong class="num">${money(expSum)}</strong></div><div><span><i class="dz-dot is-inc" aria-hidden="true"></i>Ingresos y reembolsos</span><strong class="num">${money(incSum)}</strong></div><div><span>Gasto promedio</span><strong class="num">${exp.length?money(expSum/exp.length):"—"}</strong></div>`;
}
function renderTransactions(){
  const tx=dashboardTransactions({ignoreCategory:true}).sort((a,b)=>b.date.localeCompare(a.date)||Number(b.amount||0)-Number(a.amount||0));
  const used={};tx.forEach(x=>{const c=x.category||"Sin categoría";used[c]=(used[c]||0)+1});
  const categories=Object.keys(used).sort((a,b)=>used[b]-used[a]||a.localeCompare(b,"es"));
  const actions=`<div class="page-head-actions"><button class="button ghost" type="button" id="exportTransactions"><i class="bi bi-download" aria-hidden="true"></i>Exportar Excel</button><button class="button" data-add="transaction"><i class="bi bi-plus-lg" aria-hidden="true"></i>Nuevo movimiento</button></div>`;
  return `${pageHead("Todos tus movimientos",`<span id="transactionCount">${tx.length}</span> registros de ${periodLabel()} en ${meta[state.country].name}.`,actions)}
  <div class="filters transaction-filters"><input class="input" id="searchTx" placeholder="Buscar comercio, detalle o categoría" aria-label="Buscar transacciones"><select class="select" id="typeFilter" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="gasto">Gastos</option><option value="ingreso">Ingresos</option><option value="cobro">Reembolsos</option><option value="ajuste">Ajustes</option></select><select class="select" id="categoryFilter" aria-label="Filtrar por categoría"><option value="">Todas las categorías</option>${categories.map(category=>`<option value="${escapeAttr(category)}">${escapeHtml(category)} · ${used[category]}</option>`).join("")}</select></div>
  <div class="tx-totals" id="txTotals" aria-live="polite">${transactionTotalsHtml(tx)}</div>
  <div class="panel table-panel" id="txList">${tx.length?transactionRows(tx,{grouped:true}):empty("Aún no hay transacciones","Registra un gasto, ingreso, cobro o ajuste.")}</div>`;
}
function loanPaymentLinkedToTransaction(transaction){
  if(transaction.loanStage!=="payment"||!transaction.loanId)return null;
  const loan=state.loans.find(x=>x.id===transaction.loanId);if(!loan)return null;
  const payment=loanPaymentHistory(loan).find(x=>x.transactionId===transaction.id);if(!payment)return null;
  return {loan,payment};
}
function transactionRows(tx,{grouped=false}={}){let lastDay="";return `<div class="transaction-list">${tx.map(x=>{
  let dayHead="";
  if(grouped&&x.date!==lastDay){lastDay=x.date;const dayTx=tx.filter(t=>t.date===x.date),net=dayTx.reduce((a,t)=>a+(t.type==="gasto"?-Number(t.amount||0):t.type==="ajuste"?0:Number(t.amount||0)),0),label=new Intl.DateTimeFormat("es",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"}).format(new Date(`${x.date}T12:00:00Z`));dayHead=`<div class="tx-day" data-day="${escapeAttr(x.date)}"><span>${escapeHtml(label.charAt(0).toUpperCase()+label.slice(1))}</span><span class="num">${net?signedMoney(net):""}</span></div>`}
  const linkedPayment=loanPaymentLinkedToTransaction(x);
  const actions=linkedPayment
    ?`<div class="row-actions"><button data-edit-loan-payment="${linkedPayment.payment.id}" data-loan-id="${linkedPayment.loan.id}" title="Editar abono vinculado" aria-label="Editar abono vinculado"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button data-delete-loan-payment="${linkedPayment.payment.id}" data-loan-id="${linkedPayment.loan.id}" title="Eliminar abono vinculado" aria-label="Eliminar abono vinculado"><i class="bi bi-trash3" aria-hidden="true"></i></button></div>`
    :`<div class="row-actions"><button data-edit="transaction" data-id="${x.id}" title="Editar"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button data-delete="transaction" data-id="${x.id}" title="Eliminar"><i class="bi bi-trash3" aria-hidden="true"></i></button></div>`;
  return `${dayHead}<div class="transaction-row" data-transaction-id="${x.id}" data-search="${escapeAttr(`${x.description||""} ${x.detail||""} ${x.category||""} ${x.type||""}`.toLocaleLowerCase("es"))}" data-type="${escapeAttr(x.type||"")}" data-category="${escapeAttr(x.category||"Sin categoría")}" data-date="${escapeAttr(x.date||"")}"><div class="tx-icon is-${escapeAttr(x.type||"")}"><i class="bi ${x.type==="gasto"?"bi-arrow-down":x.type==="ajuste"?"bi-sliders":"bi-arrow-up"}" aria-hidden="true"></i></div><div><strong>${escapeHtml(x.description)}</strong><small>${x.detail?`${escapeHtml(x.detail)} · `:""}${escapeHtml(x.category)}${grouped?"":` · ${dateLabel(x.date)}`}</small></div><span class="amount ${x.type}">${x.type==="gasto"?"−":x.type==="ajuste"?"":"+"}${money(x.amount,x.country)}</span>${actions}</div>`;
}).join("")}</div>`}
function spentByCategory(category){return dashboardTransactions({ignoreCategory:true}).filter(x=>x.type==="gasto"&&x.category===category).reduce((a,b)=>a+Number(b.amount),0)}
function renderBudgets(){
  const allBudgets=countryItems(state.budgets),items=allBudgets.filter(x=>Number(x.amount)>0),unset=allBudgets.filter(x=>!(Number(x.amount)>0)),pace=budgetPace(),months=dashboardMonth==="all"?12:1;
  const spentAll=items.reduce((s,x)=>s+spentByCategory(x.category),0),limitAll=items.reduce((s,x)=>s+(Number(x.amount)||0)*months,0);
  const projOf=x=>{const spent=spentByCategory(x.category);return pace&&pace.ratio>0&&!budgetIsFixed(x.category)?spent/pace.ratio:spent};
  const risky=items.filter(x=>projOf(x)>(Number(x.amount)||0)*months*1.001);
  const summary=items.length?`<section class="bd-summary">
    <article class="dz-card"><p class="dz-eyebrow">Gastado de lo presupuestado</p><strong class="dz-value num">${money(spentAll)} <small>de ${money(limitAll)}</small></strong><div class="dz-bullet">${pace?`<span class="dz-bullet-today" style="left:${(pace.ratio*100).toFixed(2)}%"></span>`:""}<span class="dz-bullet-fill" style="width:${limitAll?Math.min(100,spentAll/limitAll*100).toFixed(2):0}%"></span></div><p class="dz-sub">${pace?`Día ${pace.day} de ${pace.days} · la línea marca hoy`:periodLabel()}</p></article>
    <article class="dz-card"><p class="dz-eyebrow">${pace?"Proyección al cierre":"Total del periodo"}</p><strong class="dz-value num">${money(items.reduce((s,x)=>s+projOf(x),0))}</strong><p class="dz-sub">${pace?"Si sigues gastando al ritmo actual":"Gastado en categorías con presupuesto"}</p></article>
    <article class="dz-card ${risky.length?"is-risk":""}"><p class="dz-eyebrow">${risky.length?"En riesgo":"Todo en orden"}</p><strong class="dz-value">${risky.length?`${risky.length} ${risky.length===1?"categoría":"categorías"}`:"Sin alertas"}</strong><p class="dz-sub">${risky.length?escapeHtml(risky.map(x=>x.category).join(", "))+(pace?" superarían su límite":" superaron su límite"):"Ningún presupuesto va a pasarse"}</p></article>
  </section>`:"";
  return `${pageHead("Presupuestos",`¿Cómo vas a terminar ${periodLabel().toLowerCase()}? · ${meta[state.country].name}`,`<button class="button" data-add="budget"><i class="bi bi-plus-lg" aria-hidden="true"></i>Nuevo presupuesto</button>`)}
  ${summary}
  <div class="budget-grid">${items.length?items.map(x=>`<article class="panel budget-card bd-card"><div class="row-actions bd-actions"><button data-edit="budget" data-id="${x.id}" aria-label="Editar presupuesto de ${escapeAttr(x.category)}"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button data-delete="budget" data-id="${x.id}" aria-label="Eliminar presupuesto de ${escapeAttr(x.category)}"><i class="bi bi-trash3" aria-hidden="true"></i></button></div>${budgetRow(x)}</article>`).join(""):empty("Sin presupuestos","Define un límite para comenzar.")}</div>
  ${unset.length?`<details class="bd-unset"><summary>Sin límite asignado (${unset.length}) · no se muestran en el Resumen</summary><div class="bd-unset-list">${unset.map(x=>`<div class="bd-unset-row"><span>${escapeHtml(x.category)}<small>Gastado: ${money(spentByCategory(x.category))}</small></span><span class="row-actions"><button data-edit="budget" data-id="${x.id}" aria-label="Asignar límite a ${escapeAttr(x.category)}"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button data-delete="budget" data-id="${x.id}" aria-label="Eliminar presupuesto de ${escapeAttr(x.category)}"><i class="bi bi-trash3" aria-hidden="true"></i></button></span></div>`).join("")}</div></details>`:""}
  ${pace&&items.length?`<p class="bd-legend"><span><i class="is-fill"></i>Gastado</span><span><i class="is-proj"></i>Proyección al cierre</span><span><i class="is-limit"></i>Límite</span></p>`:""}`;
}
function renderTransfers(){
  const items=state.transfers.filter(x=>x.from===state.country||x.to===state.country).sort((a,b)=>b.date.localeCompare(a.date));
  const rateOf=x=>{const base=(Number(x.sent)||0)+(Number(x.fee)||0);return base>0&&Number(x.received)>0?Number(x.received)/base:null};
  const outgoing=items.filter(x=>x.from===state.country&&rateOf(x)).slice(0,8).reverse();
  let chart="";
  if(outgoing.length>=2){
    const rates=outgoing.map(rateOf),avg=rates.reduce((a,b)=>a+b,0)/rates.length,min=Math.min(...rates),max=Math.max(...rates),pad=(max-min||max*.01)*.25,lo=min-pad,hi=max+pad;
    const X=i=>outgoing.length===1?50:i/(outgoing.length-1)*100,Y=v=>(1-(v-lo)/(hi-lo))*100,best=rates.indexOf(max),to=outgoing[0].to;
    const path=rates.map((r,i)=>`${i?"L":"M"}${X(i).toFixed(3)} ${Y(r).toFixed(3)}`).join(" ");
    chart=`<article class="dz-panel tr-chart"><div class="dz-head"><div><h3>${meta[to].symbol} recibidos por cada ${meta[state.country].symbol} enviado</h3><p>Incluye la comisión · últimos ${outgoing.length} envíos</p></div><div class="dz-net"><span>Tu promedio</span><strong class="num">${formatRate(avg,state.country,to)}</strong></div></div>
      <div class="dz-line-wrap"><div class="dz-yaxis"><span>${formatRate(hi,state.country,to).split(" ")[0]}</span><span>${formatRate((hi+lo)/2,state.country,to).split(" ")[0]}</span><span>${formatRate(lo,state.country,to).split(" ")[0]}</span></div>
      <div class="dz-line is-short"><div class="dz-grid"><i></i><i></i><i></i></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="100" y1="${Y(avg).toFixed(3)}" y2="${Y(avg).toFixed(3)}" class="tr-avg" vector-effect="non-scaling-stroke"/><path d="${path}" class="tr-path" fill="none" vector-effect="non-scaling-stroke"/></svg>
      ${outgoing.map((x,i)=>`<button type="button" class="dz-marker ${i===best?"is-best":"is-snd"}" style="left:${X(i)}%;top:${Y(rates[i])}%" ${tip(dateLabel(x.date),`${money(x.sent,x.from)} → ${money(x.received,x.to)} · ${formatRate(rates[i],x.from,x.to)}`)} aria-label="${escapeAttr(`${dateLabel(x.date)}: ${formatRate(rates[i],x.from,x.to)}`)}"></button>`).join("")}</div>
      <div class="dz-xaxis">${outgoing.map((x,i)=>`<span style="left:${X(i)}%">${new Intl.DateTimeFormat("es",{month:"short",timeZone:"UTC"}).format(new Date(`${x.date}T12:00:00Z`)).replace(".","")}</span>`).join("")}</div></div>
      <p class="dz-foot">El punto verde fue tu mejor envío: ${formatRate(max,state.country,to)} el ${dateLabel(outgoing[best].date)}.</p></article>`;
  }
  return `${pageHead("Transferencias",`Lo que mandaste y lo que realmente llegó. No cuentan como ingreso ni gasto.`,`<button class="button" data-add="transfer"><i class="bi bi-plus-lg" aria-hidden="true"></i>Nueva transferencia</button>`)}
  ${chart}
  <div class="panel table-panel">${items.length?`<div class="tr-table"><div class="tr-row tr-headrow"><span>Fecha</span><span>Enviado</span><span>Recibido</span><span>Comisión</span><span>Tasa</span><span></span></div>${items.map(x=>{const r=rateOf(x);return `<div class="tr-row"><span class="tr-date"><i class="bi bi-arrow-left-right" aria-hidden="true"></i>${dateLabel(x.date)}<small>${meta[x.from].name} → ${meta[x.to].name}</small></span><span class="num" data-label="Enviado">${money(x.sent,x.from)}</span><span class="num" data-label="Recibido">${money(x.received,x.to)}</span><span class="num muted" data-label="Comisión">${money(x.fee||0,x.from)}</span><span class="num" data-label="Tasa">${r?formatRate(r,x.from,x.to):"—"}</span><div class="row-actions"><button data-edit="transfer" data-id="${x.id}" aria-label="Editar transferencia"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button data-delete="transfer" data-id="${x.id}" aria-label="Eliminar transferencia"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></div>`}).join("")}</div>`:empty("Sin transferencias","Registra los valores enviados y recibidos.")}</div>`;
}
function loanPaymentHistory(loan){
  const saved=Array.isArray(loan.payments)?loan.payments.map(x=>({...x,amount:Number(x.amount)||0})):[],savedTransactionIds=new Set(saved.map(x=>x.transactionId).filter(Boolean));
  const linked=state.transactions.filter(x=>x.loanId===loan.id&&x.loanStage==="payment"&&!savedTransactionIds.has(x.id)).map(x=>({id:`legacy_${x.id}`,amount:Number(x.amount)||0,date:x.date,affectBalance:true,transactionId:x.id,legacy:true}));
  const known=[...saved,...linked],paid=Math.max(0,Number(loan.amount||0)-Number(loan.balance||0)),knownTotal=known.reduce((sum,x)=>sum+Number(x.amount||0),0),untracked=Math.max(0,paid-knownTotal);
  if(untracked>.0001)known.push({id:`historic_${loan.id}`,amount:untracked,date:"",legacy:true,untracked:true});
  return known.sort((a,b)=>(b.date||"").localeCompare(a.date||""));
}
function findLoanPayment(loan,paymentId){return loanPaymentHistory(loan).find(x=>String(x.id)===String(paymentId))||null}
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
  return `<div class="modal-head"><div><p class="eyebrow">${group.direction==="owed"?"DINERO QUE DEBEMOS":"DINERO QUE NOS DEBEN"}</p><h2 id="loanDetailTitle">${escapeHtml(group.person)}</h2></div><button type="button" class="icon-button" data-close-loan-detail aria-label="Cerrar"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
    <div class="loan-detail-totals"><div><span>Deuda original</span><strong>${money(group.amount)}</strong></div><div><span>Abonos</span><strong>${money(group.paid)}</strong></div><div class="remaining"><span>Saldo restante</span><strong>${money(group.balance)}</strong></div></div>
    <div class="loan-detail-list">${operations.map(op=>`<article class="loan-history-row ${op.kind}"><span class="loan-history-dot" aria-hidden="true"></span><div class="loan-history-copy"><div><strong>${op.kind==="opening"?"Operación inicial":op.payment?.untracked?"Abonos anteriores":"Abono"}</strong><time>${op.date?dateLabel(op.date):"Sin fecha registrada"}</time></div><p>${op.kind==="opening"?(op.note?escapeHtml(op.note):"Préstamo registrado"):op.payment?.affectBalance?"Con movimiento en Transacciones":"Registro documental"}</p></div><div class="loan-history-side"><div class="loan-history-values"><strong class="${op.kind==="payment"?"paid":""}">${op.kind==="payment"?"−":""}${money(op.amount)}</strong><small>Saldo: ${money(op.balance)}</small></div>${op.kind==="payment"?`<div class="loan-history-actions"><button type="button" data-edit-loan-payment="${op.payment.id}" data-loan-id="${op.loan.id}" title="Editar abono" aria-label="Editar abono de ${escapeAttr(op.loan.person)}"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button type="button" data-delete-loan-payment="${op.payment.id}" data-loan-id="${op.loan.id}" title="Eliminar abono" aria-label="Eliminar abono de ${escapeAttr(op.loan.person)}"><i class="bi bi-trash3" aria-hidden="true"></i></button></div>`:""}</div></article>`).join("")}</div>`;
}
function hideLoanDetail({preserveContext=false}={}){
  const modal=$("#loanDetailModal");
  modal?.classList.add("hidden");document.body.classList.remove("modal-open");
  if(!preserveContext)loanDetailContext=null;
}
function restoreLoanDetail(){
  const context=loanDetailReturnContext;loanDetailReturnContext=null;
  if(context&&currentPage==="prestamos")openLoanDetail(context.key,context.loanId);
}
function bindLoanPaymentActions(root=document){
  $$('[data-edit-loan-payment]',root).forEach(button=>button.onclick=()=>openLoanPaymentEditor(button.dataset.loanId,button.dataset.editLoanPayment));
  $$('[data-delete-loan-payment]',root).forEach(button=>button.onclick=()=>askLoanPaymentDelete(button.dataset.loanId,button.dataset.deleteLoanPayment));
}
function openLoanDetail(key,loanId=""){
  let group=loanEntityGroups(countryItems(state.loans)).find(x=>x.key===key);
  if(group&&loanId){
    const loan=group.loans.find(x=>x.id===loanId);
    if(loan)group=loanEntityGroups([loan])[0];
  }
  const modal=$("#loanDetailModal"),card=$("#loanDetailCard");if(!group||!modal||!card)return;
  loanDetailContext={key,loanId};
  card.innerHTML=renderLoanDetail(group);modal.classList.remove("hidden");document.body.classList.add("modal-open");$("[data-close-loan-detail]",modal)?.focus();
  bindLoanPaymentActions(modal);
  const close=()=>hideLoanDetail();
  $("[data-close-loan-detail]",modal).onclick=close;modal.onclick=e=>{if(e.target===modal)close()};modal.onkeydown=e=>{if(e.key==="Escape")close()};
}
function renderLoans(){
  const allItems=countryItems(state.loans),items=hideSettledLoans?allItems.filter(x=>Number(x.balance)>0):allItems,groups=loanEntityGroups(items);
  const totalWeOwe=allItems.filter(x=>x.direction==="owed").reduce((sum,x)=>sum+Math.max(0,Number(x.balance)||0),0);
  const totalOwedToUs=allItems.filter(x=>x.direction!=="owed").reduce((sum,x)=>sum+Math.max(0,Number(x.balance)||0),0);
  const loanOverviewTotals=`<div class="loan-overview-totals" aria-label="Totales pendientes"><div><span>Debemos</span><strong>${money(totalWeOwe)}</strong></div><div><span>Nos deben</span><strong>${money(totalOwedToUs)}</strong></div></div>`;
  const actions=`<div class="page-head-actions loan-page-actions"><label class="loan-settled-filter" title="Oculta las deudas cuyo saldo pendiente es cero"><input type="checkbox" data-hide-settled-loans ${hideSettledLoans?"checked":""}><span class="loan-filter-check" aria-hidden="true"><i class="bi bi-check-lg"></i></span><span>Ocultar saldados</span></label><button class="button" data-add="loan"><i class="bi bi-plus-lg" aria-hidden="true"></i>Nuevo préstamo</button></div>`;
  return `${pageHead("Préstamos",`Dinero que debemos y dinero que nos deben.`,actions)}
  <section class="loan-summary-section loan-summary-overview"><div class="loan-section-head"><div><span class="loan-section-kicker">VISTA GENERAL</span><h3>Resumen consolidado por persona o entidad</h3><p class="muted">Agrupa todas las deudas de una misma persona. Selecciona una tarjeta para ver su historial conjunto.</p></div>${loanOverviewTotals}</div>${groups.length?`<div class="loan-summary-grid">${groups.map(group=>`<button type="button" class="panel loan-summary-card ${group.direction==="owed"?"loan-tone-owed":"loan-tone-receivable"}" data-loan-summary="${escapeAttr(group.key)}"><div class="loan-summary-top"><div><small>${group.direction==="owed"?"DEBEMOS":"NOS DEBEN"}</small><h3>${escapeHtml(group.person)}</h3></div><span aria-hidden="true"><i class="bi bi-chevron-right"></i></span></div><strong class="loan-summary-balance">${money(group.balance)}</strong><span class="loan-summary-label">Saldo pendiente consolidado</span><div class="loan-summary-meta"><span>Original <b>${money(group.amount)}</b></span><span>Abonado <b>${money(group.paid)}</b></span></div><small>${group.loans.length} ${group.loans.length===1?"operación":"operaciones"} agrupadas</small></button>`).join("")}</div>`:`<div class="loan-overview-empty"><span>Sin deudas registradas</span><small>Los totales aparecerán aquí cuando agregues un préstamo.</small></div>`}</section>
  <section class="loan-individual-section"><div class="loan-section-head loan-individual-head"><div><span class="loan-section-kicker">DETALLE</span><h3>Préstamos individuales</h3><p class="muted">Cada tarjeta representa una deuda particular. Haz clic para consultar su operación y sus abonos.</p></div></div>
  <div class="loan-grid">${items.length?items.map(x=>{const key=`${x.direction}::${String(x.person||"Sin nombre").trim().toLocaleLowerCase("es")}`;return `<article class="panel budget-card loan-item-card ${x.direction==="owed"?"loan-tone-owed":"loan-tone-receivable"}" role="button" tabindex="0" data-loan-detail="${x.id}" data-loan-key="${escapeAttr(key)}" aria-label="Ver historial de ${escapeAttr(x.person)}"><div class="budget-top"><div><small class="muted">${x.direction==="owed"?"DINERO QUE DEBEMOS":"DINERO QUE NOS DEBEN"}</small><h3>${escapeHtml(x.person)}</h3>${x.note?`<p class="loan-description">${escapeHtml(x.note)}</p>`:""}</div><div class="row-actions"><button data-edit="loan" data-id="${x.id}" aria-label="Editar préstamo"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button data-delete="loan" data-id="${x.id}" aria-label="Eliminar préstamo"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></div><div class="metric-value">${money(x.balance)}</div><small class="muted">De ${money(x.amount)} · ${dateLabel(x.date)}</small><div class="loan-card-footer"><span class="loan-history-link">Ver historial <b aria-hidden="true"><i class="bi bi-chevron-right"></i></b></span><button class="button ghost" data-pay="${x.id}">Registrar abono</button></div></article>`}).join(""):empty(hideSettledLoans&&allItems.length?"No hay préstamos pendientes":"Sin préstamos registrados",hideSettledLoans&&allItems.length?"Desactiva “Ocultar saldados” para consultar el historial completo.":"Registra una obligación o cuenta por cobrar.")}</div></section>${loanDetailModal()}`;
}
function renderRecurrings(){
  const items=countryItems(state.recurrings);
  const checkedCount=items.filter(x=>isRecurringChecked(x.id)).length;
  const totalRecurring=items.reduce((sum,x)=>sum+(Number(x.amount)||0),0);
  const totalPending=items.filter(x=>!isRecurringChecked(x.id)).reduce((sum,x)=>sum+(Number(x.amount)||0),0);
  const recurringTotals=`<div class="recurring-total-cards" aria-label="Resumen de pagos recurrentes"><div><span>Total recurrentes</span><strong>${money(totalRecurring)}</strong></div><div class="pending"><span>Pendientes</span><strong>${money(totalPending)}</strong></div></div>`;
  const actions=`<div class="page-head-actions recurring-page-actions">${recurringTotals}<div class="recurring-action-buttons"><button class="button ghost" type="button" data-clear-recurring-checks ${checkedCount?"":"disabled"}>Reiniciar manualmente</button><button class="button" data-add="recurring"><i class="bi bi-plus-lg" aria-hidden="true"></i>Nuevo recurrente</button></div></div>`;
  return `${pageHead("Pagos recurrentes",`Recordatorios de gastos e ingresos periódicos.`,actions)}
  <div class="panel table-panel">${items.length?`<div class="recurring-check-summary"><span><strong>${checkedCount}</strong> de ${items.length} pagados</span><span class="rc-progress" aria-hidden="true"><i style="width:${items.length?checkedCount/items.length*100:0}%"></i></span><small>Estado manual: el día de referencia nunca cambia los checks.</small></div><div class="transaction-list recurring-list">${items.map(x=>{const checked=isRecurringChecked(x.id);return `<div class="transaction-row recurring-row ${checked?"is-paid":""}" data-recurring-row="${x.id}"><label class="recurring-check" title="${checked?"Marcar como pendiente":"Marcar como pagado"}"><input type="checkbox" data-recurring-check="${x.id}" ${checked?"checked":""} aria-label="${checked?"Marcar como pendiente":"Marcar como pagado"}: ${escapeAttr(x.description)}"><span aria-hidden="true"><i class="bi bi-check-lg"></i></span></label><div class="tx-icon"><i class="bi bi-arrow-repeat" aria-hidden="true"></i></div><div><strong>${escapeHtml(x.description)}</strong><small>${escapeHtml(x.frequency)} · Día ${x.day}${(()=>{const d=Number(x.day)-new Date().getDate();return !checked&&x.frequency==="Mensual"&&d>=0&&d<=5?` <b class="rc-soon">${d===0?"Vence hoy":`Vence en ${d} ${d===1?"día":"días"}`}</b>`:""})()}</small></div><span class="amount ${x.type}">${money(x.amount)}</span><div class="row-actions"><button data-edit="recurring" data-id="${x.id}"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button data-delete="recurring" data-id="${x.id}"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></div>`}).join("")}</div>`:empty("Sin pagos recurrentes","Agrega recordatorios; no crean transacciones automáticamente.")}</div>`;
}
function renderSettings(){const cloud=window.MiDineroCloud,connected=cloud?.isConnected(),status=window.miDineroCloudStatus?.text||"Falta configurar Google OAuth";const categories=availableCategories();return `${pageHead("Configuración","Administra categorías, apariencia, sincronización y copias de seguridad.")}
  <div class="panel category-manager-panel">
    <div class="category-manager-head"><div><h3>Categorías compartidas</h3><p class="muted">Un solo catálogo para China y Colombia.</p></div><div class="category-manager-actions"><button type="button" class="button" id="showAddCategory"><i class="bi bi-plus-lg" aria-hidden="true"></i>Agregar</button><button type="button" class="button ghost" id="openCategoryManager">Editar</button></div></div>
    <div class="category-add hidden" id="categoryAddForm"><input class="input" id="newCategoryName" maxlength="60" placeholder="Nombre de la nueva categoría"><button type="button" class="button" id="addCategory">Guardar</button><button type="button" class="button ghost" id="cancelAddCategory">Cancelar</button></div>
  </div>
  <div class="modal-backdrop hidden" id="categoryManagerModal" role="dialog" aria-modal="true" aria-labelledby="categoryManagerTitle">
    <div class="modal-card category-manager-modal">
      <div class="modal-head"><div><p class="eyebrow">CONFIGURACIÓN</p><h2 id="categoryManagerTitle">Editar categorías</h2></div><button type="button" class="icon-button" id="closeCategoryManager" aria-label="Cerrar"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
      <div class="info-notice"><span aria-hidden="true"><i class="bi bi-info-circle"></i></span><p><strong>Importante:</strong> no puedes eliminar una categoría si tiene transacciones asignadas en China o Colombia. Primero debes reasignarlas a otra categoría.</p></div>
      <div class="category-manager-list">${categories.map(name=>{const usage=categoryUsage(name);return `<div class="category-manager-row"><div><strong>${escapeHtml(name)}</strong><small>${usage} ${usage===1?"transacción":"transacciones"}</small></div><div class="row-actions category-row-actions"><button type="button" data-category-rename="${escapeAttr(name)}" aria-label="Editar ${escapeAttr(name)}" title="Editar categoría"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button type="button" data-category-delete="${escapeAttr(name)}" class="${usage?"is-disabled":""}" aria-label="Eliminar ${escapeAttr(name)}" title="${usage?"Ver por qué no se puede eliminar":"Eliminar categoría"}"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></div>`}).join("")}</div>
      <div class="modal-backdrop hidden category-action-backdrop" id="categoryActionModal" role="dialog" aria-modal="true">
        <div class="confirm-card category-action-card" id="categoryActionCard"></div>
      </div>
    </div>
  </div>
  <div class="settings-grid"><div class="panel appearance-panel"><h3>Apariencia</h3><p class="muted">Elige cómo quieres ver la aplicación en este dispositivo.</p><div class="theme-selector" role="group" aria-label="Modo de apariencia"><button type="button" data-theme-option="light" class="${colorTheme==="light"?"active":""}" aria-pressed="${colorTheme==="light"}"><span aria-hidden="true"><i class="bi bi-sun"></i></span><strong>Modo día</strong><small>Fondo claro</small></button><button type="button" data-theme-option="dark" class="${colorTheme==="dark"?"active":""}" aria-pressed="${colorTheme==="dark"}"><span aria-hidden="true"><i class="bi bi-moon-stars"></i></span><strong>Modo noche</strong><small>Fondo oscuro</small></button></div></div><div class="panel"><h3>Cuenta</h3><div class="settings-row"><span>Nombre</span><strong>${escapeHtml(state.settings.user)}</strong></div><div class="settings-row"><span>Almacenamiento</span><strong>Google Sheets obligatorio</strong></div><div class="settings-row"><span>Última sincronización confirmada</span><strong id="settingsLastSync">Sin sincronización previa</strong></div><div class="cloud-status" id="cloudStatus">${escapeHtml(status)}</div><div class="form-actions" style="justify-content:flex-start">${connected?`<button class="button" id="syncNow">Sincronizar ahora</button><button class="button ghost" id="disconnectGoogle">Desconectar</button>`:`<button class="button" id="connectGoogle">Conectar Google Sheets</button>`}</div></div>
  <div class="panel private-config-panel"><div class="private-config-head"><div><span class="private-config-kicker">Acceso y sincronización</span><h3>Configuración privada</h3></div><span class="private-config-badge" aria-label="Valores ocultos por defecto">Protegida</span></div><p class="muted private-config-intro">Los identificadores se ocultan para evitar que otras personas los vean en tu pantalla. Los permisos de Google Sheets continúan siendo la protección real de tus datos.</p><div class="private-config-fields"><div class="field"><label for="googleClientId">Google OAuth Client ID</label><div class="secret-input-wrap"><input class="input secret-input" type="password" id="googleClientId" value="${escapeAttr(window.MI_DINERO_CLOUD_CONFIG?.clientId||"")}" placeholder="...apps.googleusercontent.com" autocomplete="off" spellcheck="false"><button type="button" class="secret-toggle" data-secret-toggle="googleClientId" aria-label="Mostrar Google OAuth Client ID" aria-pressed="false"><span class="secret-toggle-icon" aria-hidden="true"><i class="bi bi-eye"></i></span><span class="secret-toggle-label">Mostrar</span></button></div><small class="field-help">Identifica la aplicación ante Google; no es una contraseña.</small></div><div class="field"><label for="googleSheetId">ID del Google Sheet</label><div class="secret-input-wrap"><input class="input secret-input" type="password" id="googleSheetId" value="${escapeAttr(window.MI_DINERO_CLOUD_CONFIG?.spreadsheetId||"")}" placeholder="Identificador del archivo maestro" autocomplete="off" spellcheck="false"><button type="button" class="secret-toggle" data-secret-toggle="googleSheetId" aria-label="Mostrar ID del Google Sheet" aria-pressed="false"><span class="secret-toggle-icon" aria-hidden="true"><i class="bi bi-eye"></i></span><span class="secret-toggle-label">Mostrar</span></button></div><small class="field-help">Solo las cuentas autorizadas en Google pueden acceder al archivo.</small></div></div><div class="private-config-footer"><span class="private-config-note"><span aria-hidden="true">●</span> Se guardan en este navegador al pulsar el botón.</span><button class="button" id="saveCloudConfig">Guardar configuración</button></div></div>
  ${syncModePanel()}
  ${merchantMigrationPanel()}
  <div class="panel"><h3>Respaldos</h3><p class="muted">Descarga un respaldo completo o importa uno anterior.</p><div class="form-actions" style="justify-content:flex-start"><button class="button" id="exportData">Exportar respaldo</button><label class="button ghost" for="importData">Importar respaldo</label><input class="file-input" type="file" id="importData" accept=".json"></div><div class="settings-row"><span>Reiniciar aplicación</span><button class="button danger" id="resetData">Borrar todos los datos</button></div></div></div>`}

function syncModePanel(){
  const cloud=window.MiDineroCloud,script=cloud?.mode==="script";
  if(script){const globalScript=Boolean(window.MI_DINERO_GLOBAL_SCRIPT_URL);return `<div class="panel sync-panel"><h3>Modo rápido y sincronización</h3><p class="muted">Los movimientos se guardan al instante en este dispositivo y se envían en segundo plano. El vínculo de Google se conserva por dispositivo; la URL del servidor se configura una sola vez para toda la app.</p><div class="settings-row"><span>Cambios pendientes de enviar</span><strong>${cloud.pendingCount()}</strong></div><div class="sync-devices" id="syncDevices"><small class="muted">Cargando dispositivos vinculados…</small></div>${globalScript?`<p class="field-help">Este modo está activado para todos los dispositivos.</p>`:`<div class="form-actions" style="justify-content:flex-start"><button type="button" class="button ghost" id="leaveScriptMode">Volver al modo anterior</button></div>`}</div>`}
  return `<div class="panel sync-panel"><h3>Modo rápido y sincronización</h3><p class="muted">El modo rápido guarda cada movimiento en este dispositivo y lo sincroniza en segundo plano. Para que se active automáticamente en todos tus dispositivos, la URL del servidor se configura una sola vez en la app. Si aún no está configurada, puedes vincular este dispositivo aquí. Guía: <a href="https://github.com/cmiguezd/mi-dinero/blob/main/apps-script/README.md" target="_blank" rel="noopener">cómo instalarlo</a>.</p><div class="field"><label for="scriptUrlInput">URL de la aplicación web</label><input class="input" id="scriptUrlInput" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false"></div><div class="form-actions" style="justify-content:flex-start"><button type="button" class="button" id="enableScriptMode">Activar en este dispositivo</button></div></div>`;
}
async function renderSyncDevices(){
  const box=$("#syncDevices"),cloud=window.MiDineroCloud;if(!box||cloud?.mode!=="script")return;
  try{
    const {devices}=await cloud.devices();
    box.innerHTML=devices.map(d=>`<div class="sync-device"><span><strong>${escapeHtml(d.name)}${d.current?" · este":""}</strong><small>Vinculado ${dateLabel(String(d.created).slice(0,10))} · visto ${dateLabel(String(d.lastSeen).slice(0,10))}</small></span>${d.current?"":`<button type="button" class="button ghost" data-revoke-device="${escapeAttr(d.id)}">Desvincular</button>`}</div>`).join("")||`<small class="muted">Sin dispositivos.</small>`;
    $$("[data-revoke-device]",box).forEach(b=>b.onclick=async()=>{if(!window.confirm("¿Desvincular ese dispositivo? Tendrá que volver a iniciar sesión con Google."))return;await cloud.revoke(b.dataset.revokeDevice);renderSyncDevices()});
  }catch(error){box.innerHTML=`<small class="muted">No se pudo cargar la lista (${escapeHtml(cloud.friendlyError(error))}).</small>`}
}
function merchantMigrationPanel(){
  const mm=state.merchantMigration,count=mm?.changes?.length||0;
  const copy=mm?.undone?"Se deshizo la separación automática; las descripciones volvieron a su texto original.":count?`Separamos automáticamente ${count} ${count===1?"descripción antigua":"descripciones antiguas"} en comercio + detalle (por ejemplo, “Taobao · audífonos” → Taobao + audífonos). El texto original quedó guardado.`:"No hubo descripciones antiguas que separar en comercio y detalle.";
  return `<div class="panel"><h3>Comercio y detalle</h3><p class="muted">${copy}</p>${count?`<div class="form-actions" style="justify-content:flex-start"><button type="button" class="button ghost" id="reviewMerchantMigration">Revisar ${count}</button><button type="button" class="button ghost" id="undoMerchantMigration">Deshacer</button></div>`:""}</div>`;
}
function openMerchantMigrationReview(){
  const changes=state.merchantMigration?.changes||[],byId=new Map(state.transactions.map(x=>[x.id,x]));
  $("#modalEyebrow").textContent="CONFIGURACIÓN";$("#modalTitle").textContent="Comercio y detalle separados";
  $("#recordForm").innerHTML=`<div class="mm-list">${changes.map(c=>{const x=byId.get(c.id);if(!x)return "";return `<div class="mm-row"><span class="muted">${escapeHtml(c.original)}</span><i class="bi bi-arrow-right" aria-hidden="true"></i><span><strong>${escapeHtml(x.description)}</strong>${x.detail?` · ${escapeHtml(x.detail)}`:""}<small>${meta[x.country].name} · ${dateLabel(x.date)}</small></span></div>`}).join("")}</div><div class="form-actions"><button type="button" class="button" data-close>Cerrar</button></div>`;
  $("#recordForm").dataset.kind="info";$("#modal").classList.remove("hidden");$$("[data-close]",$("#modal")).forEach(x=>x.onclick=closeForm);
}
function bindPage(){
  bindChartTips($("#content"));
  if(currentPage==="configuracion")renderSyncDevices();
  if($("#enableScriptMode"))$("#enableScriptMode").onclick=()=>{const url=$("#scriptUrlInput").value.trim();if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)){toast("Pega la URL completa que termina en /exec");return}let saved={};try{saved=JSON.parse(localStorage.getItem("mi-dinero-cloud-config")||"{}")}catch{}localStorage.setItem("mi-dinero-cloud-config",JSON.stringify({...saved,scriptUrl:url}));toast("Activado; recargando…");setTimeout(()=>location.reload(),600)};
  if($("#leaveScriptMode"))$("#leaveScriptMode").onclick=()=>{const n=window.MiDineroCloud?.pendingCount?.()||0;if(n){toast(`Espera a que se envíen ${n} cambios pendientes`);return}if(!window.confirm("¿Volver al inicio de sesión con Google cada hora? Este dispositivo dejará de usar el Apps Script."))return;let saved={};try{saved=JSON.parse(localStorage.getItem("mi-dinero-cloud-config")||"{}")}catch{}delete saved.scriptUrl;localStorage.setItem("mi-dinero-cloud-config",JSON.stringify(saved));location.reload()};

  if($("#reviewMerchantMigration"))$("#reviewMerchantMigration").onclick=openMerchantMigrationReview;
  if($("#undoMerchantMigration"))$("#undoMerchantMigration").onclick=async()=>{if(!window.confirm("¿Volver a dejar las descripciones como estaban antes de separarlas?"))return;const previousState=structuredClone(state);const n=undoMerchantMigration(state);if(await saveState(previousState)){render();toast(`${n} descripciones restauradas`)}};
  $$("[data-add]").forEach(b=>b.onclick=()=>openForm(b.dataset.add));
  $$("[data-edit]").forEach(b=>b.onclick=()=>openForm(b.dataset.edit,b.dataset.id));
  $$("[data-delete]").forEach(b=>b.onclick=()=>askDelete(b.dataset.delete,b.dataset.id));
  $$("[data-go]").forEach(b=>b.onclick=()=>{currentPage=b.dataset.go;render()});
  $$("[data-pay]").forEach(b=>b.onclick=()=>payLoan(b.dataset.pay));
  bindLoanPaymentActions();
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
  $$(".tx-day",$("#txList")).forEach(head=>{
    const any=$$(`.transaction-row[data-date="${CSS.escape(head.dataset.day)}"]`,$("#txList")).some(row=>row.style.display!=="none");
    head.style.display=any?"":"none";
  });
  const list=$("#txList");
  if(list&&list.querySelector(".transaction-row")){
    let none=$("#txNoResults",list);
    if(!none){list.insertAdjacentHTML("beforeend",`<div id="txNoResults" class="empty hidden"><div><strong>Sin resultados</strong>Ningún movimiento coincide con estos filtros.</div></div>`);none=$("#txNoResults",list)}
    none.classList.toggle("hidden",visible>0);
  }
  const totalsBox=$("#txTotals");
  if(totalsBox){
    const ids=new Set($$(".transaction-row[data-transaction-id]",$("#txList")).filter(row=>row.style.display!=="none").map(row=>row.dataset.transactionId));
    totalsBox.innerHTML=transactionTotalsHtml(state.transactions.filter(x=>ids.has(String(x.id))));
  }
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
  const map={transaction:"Movimiento",account:"Cuenta",budget:"Presupuesto",transfer:"Transferencia",loan:"Préstamo",recurring:"Pago recurrente"};
  const collection={transaction:"transactions",account:"accounts",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[kind];
  const item=id?state[collection].find(x=>x.id===id):null;
  const country=item?.country||state.country,cur=meta[country].currency;
  $("#modalEyebrow").textContent=id?"EDITAR":"NUEVO";
  $("#modalTitle").textContent=kind==="transaction"?`${id?"Editar movimiento":"Nuevo movimiento"} · ${meta[country].name}`:map[kind];
  const typeOpts=[{value:"gasto",label:"Gasto"},{value:"ingreso",label:"Ingreso"},{value:"cobro",label:"Cobro / reembolso"},{value:"ajuste",label:"Ajuste"}];
  const categoryNames=availableCategories(),catOpts=categoryNames.map(x=>({value:x,label:x}));
  const countryOpts=[{value:"CN",label:"China (CNY ¥)"},{value:"CO",label:"Colombia (COP $)"}];
  let html="";
  if(kind==="transaction")html=transactionFormHtml(item);
  if(kind==="account")html=`<div class="field full"><label for="accountCountry">País de la cuenta</label><select class="select" id="accountCountry" name="country" data-account-country>${countryOpts.map(o=>`<option value="${o.value}" ${o.value===country?"selected":""}>${o.label}</option>`).join("")}</select></div><div class="field full"><label for="accountName">Nombre de la cuenta</label><input class="input" id="accountName" name="name" type="text" maxlength="80" value="${escapeAttr(item?.name||"")}" placeholder="Ej. ICBC, Nequi o Efectivo" autocomplete="off" required></div>${moneyField(`Saldo actual (${cur})`,"balance",item?.balance??"",country,{full:true,allowNegative:true,help:"Reemplaza el saldo anterior"})}`;
  if(kind==="budget")html=formField("Categoría","category","text",item?.category||categoryNames[0],catOpts)+moneyField(`Límite mensual (${cur})`,"amount",item?.amount??"",country);
  if(kind==="transfer"){
    const from=item?.from||state.country,to=item?.to||(from==="CN"?"CO":"CN");
    html=formField("Desde","from","text",from,countryOpts)+formField("Hacia","to","text",to,countryOpts.slice().reverse())
      +moneyField("Enviaste","sent",item?.sent??"",from)+moneyField("Comisión (opcional)","fee",item?.fee??0,from,{required:false})
      +moneyField("Llegó","received",item?.received??"",to)+formField("Fecha de envío","date","date",item?.date||today())
      +`<div class="field"><label for="arrivalDate">Fecha de llegada <span class="tx-optional">· opcional</span></label><input class="input" id="arrivalDate" name="arrivalDate" type="date" value="${escapeAttr(item?.arrivalDate||"")}"></div>`
      +`<div class="field full tr-rate" data-transfer-rate><span>Recibiste por cada unidad enviada</span><strong>—</strong><small></small></div>`;
  }
  if(kind==="loan"){
    const people=topLoanPeople(country),direction=item?.direction||"owed";
    html=`<div class="field full"><span class="tx-label">¿Quién le debe a quién?</span><div class="loan-dirs">${[["owed","Nosotros debemos","Nos prestaron dinero"],["receivable","Nos deben","Nosotros prestamos"]].map(([v,l,h])=>`<label class="loan-dir"><input type="radio" name="direction" value="${v}" ${direction===v?"checked":""}><span><strong>${l}</strong><small>${h}</small></span></label>`).join("")}</div></div>
      <div class="field full"><label for="loanPerson">Persona o entidad</label><input class="input" id="loanPerson" name="person" maxlength="80" value="${escapeAttr(item?.person||"")}" placeholder="Ej. banco, compañero, familiar" autocomplete="off" required>${people.length?`<div class="tx-quick">${people.map(p=>`<button type="button" class="tx-pill" data-person-pick="${escapeAttr(p)}">${escapeHtml(p)}</button>`).join("")}</div>`:""}</div>
      <div class="field full"><label for="loanNote">Motivo <span class="tx-optional">· opcional</span></label><input class="input" id="loanNote" name="note" maxlength="120" value="${escapeAttr(item?.note||"")}" placeholder="Ej. compra del carro" autocomplete="off"></div>
      ${moneyField(`Monto prestado (${cur})`,"amount",item?.amount??"",country)}${formField("Fecha","date","date",item?.date||today())}
      ${id?moneyField(`Saldo pendiente (${cur})`,"balance",item?.balance??item?.amount??"",country,{full:true}):`<label class="form-check full"><input type="checkbox" name="hasPrior" value="yes"><span aria-hidden="true"><i class="bi bi-check-lg"></i></span><div><strong>Ya tiene abonos anteriores</strong><small>Actívalo si registras una deuda vieja y quieres poner lo que falta hoy.</small></div></label><div class="full hidden" data-loan-prior>${moneyField(`Saldo pendiente hoy (${cur})`,"balance","",country,{required:false,full:true})}</div>
      <label class="form-check full"><input type="checkbox" name="affectBalance" value="yes"><span aria-hidden="true"><i class="bi bi-check-lg"></i></span><div><strong>Crear también el movimiento de dinero</strong><small data-loan-affect-help></small></div></label>`}`;
  }
  if(kind==="recurring")html=formField("Descripción","description","text",item?.description||"",null,true)+formField("Tipo","type","text",item?.type||"gasto",typeOpts.slice(0,2))+moneyField(`Monto (${cur})`,"amount",item?.amount??"",country)+formField("Frecuencia","frequency","text",item?.frequency||"Mensual",[{value:"Mensual",label:"Mensual"},{value:"Semanal",label:"Semanal"},{value:"Anual",label:"Anual"}])+formField("Día de cobro","day","number",item?.day||1);
  const form=$("#recordForm");
  form.innerHTML=`<div class="form-grid">${html}</div><div class="form-actions"><button type="button" class="button ghost" data-close>Cancelar</button><button class="button" type="submit">Guardar</button></div>`;
  form.dataset.kind=kind;form.dataset.id=id||"";form.dataset.country=country;
  const modal=$("#modal");recordModalReturnFocus=document.activeElement;modal.classList.remove("hidden");
  requestAnimationFrame(()=>form.querySelector('input:not([type="hidden"]),select,textarea,button')?.focus());
  modal.onkeydown=e=>{
    if(e.key==="Escape"){e.stopPropagation();closeForm();return}
    if(e.key!=="Tab")return;
    const focusable=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x=>!x.closest(".hidden"));
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  };
  bindDatePickers(form);$$("[data-close]",modal).forEach(x=>x.onclick=closeForm);
  bindMoneyInputs(form);
  if(kind==="transaction")bindTransactionForm(form);
  if(kind==="transfer")bindTransferForm(form,id||"");
  if(kind==="loan")bindLoanForm(form);
  const accountCountry=form.querySelector("[data-account-country]");
  if(accountCountry)accountCountry.onchange=()=>setMoneyCountry(form.querySelector('[data-money-field="balance"]'),accountCountry.value);
}
function closeForm(){$("#modal").classList.add("hidden");if(recordModalReturnFocus?.isConnected)recordModalReturnFocus.focus();recordModalReturnFocus=null}
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
function updateLoanPaymentTransaction({loan,payment,amount,date,affectBalance}){
  let transaction=payment.transactionId?state.transactions.find(x=>x.id===payment.transactionId):null;
  if(!affectBalance){
    if(payment.transactionId)state.transactions=state.transactions.filter(x=>x.id!==payment.transactionId);
    payment.transactionId=null;payment.affectBalance=false;return;
  }
  if(!transaction)transaction=createLoanCashTransaction({loan,amount,date,stage:"payment"});
  else{
    const cashIn=loan.direction==="receivable";
    Object.assign(transaction,{country:loan.country,type:"ajuste",amount:Math.abs(amount),cashEffect:(cashIn?1:-1)*Math.abs(amount),category:"Préstamos y deudas",description:`${cashIn?"Abono recibido":"Abono pagado"} · ${loan.person}`,date,loanId:loan.id,loanStage:"payment",updatedAt:new Date().toISOString()});
  }
  payment.transactionId=transaction.id;payment.affectBalance=true;
}
$("#recordForm").onsubmit=async e=>{
  e.preventDefault();
  const form=e.currentTarget,submitButton=form.querySelector('[type="submit"]'),previousState=structuredClone(state);
  const kind=e.currentTarget.dataset.kind,id=e.currentTarget.dataset.id,data=Object.fromEntries(new FormData(e.currentTarget));
  if(kind==="info"){closeForm();return}
  delete data.__country;
  if(kind==="transaction"){
    data.description=String(data.description||"").trim().replace(/\s+/g," ");data.detail=String(data.detail||"").trim().replace(/\s+/g," ");
    if(!data.description){toast("Escribe el comercio o persona");return}
    if(!data.category){toast("Elige una categoría");return}
    if(!availableCategories().some(x=>x===data.category)){categoryRegistry().push(data.category);categoryRegistry().sort((a,b)=>a.localeCompare(b,"es"))}
  }
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
  if(kind==="loanPaymentEdit"){
    const loan=state.loans.find(x=>x.id===id),paymentId=form.dataset.paymentId,payment=loan&&findLoanPayment(loan,paymentId),value=Number(data.amount),affectBalance=data.affectBalance==="yes";
    if(!loan||!payment){toast("No se encontró el abono que quieres editar");return}
    const available=Number(loan.balance)||0,previousAmount=Number(payment.amount)||0;
    if(!value||value<=0||value>available+previousAmount){toast("Ingresa un abono válido, sin superar el saldo disponible");return}
    if(affectBalance&&!data.date){toast("La fecha es obligatoria cuando el abono crea una transacción");return}
    const savedPayment=Array.isArray(loan.payments)?loan.payments.find(x=>String(x.id)===String(paymentId)):null;
    const nextPayment=savedPayment||{id:uid("lp"),createdAt:payment.createdAt||new Date().toISOString(),transactionId:payment.transactionId||null};
    nextPayment.amount=value;nextPayment.date=data.date||"";nextPayment.updatedAt=new Date().toISOString();
    updateLoanPaymentTransaction({loan,payment:nextPayment,amount:value,date:nextPayment.date,affectBalance});
    if(!savedPayment){if(!Array.isArray(loan.payments))loan.payments=[];loan.payments.push(nextPayment)}
    loan.balance=Math.max(0,Math.min(Number(loan.amount)||0,available+previousAmount-value));loan.updatedAt=new Date().toISOString();
    setButtonBusy(submitButton,true);
    if(await saveState(previousState)){
      $("#modal").classList.add("hidden");const context=loanDetailReturnContext;loanDetailReturnContext=null;render();if(context&&currentPage==="prestamos")openLoanDetail(context.key,context.loanId);
      toast(affectBalance?"Abono y transacción actualizados en Google Sheets":"Abono actualizado en Google Sheets");
    }else setButtonBusy(submitButton,false);
    return;
  }
  const collection={transaction:"transactions",account:"accounts",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[kind];
  ["amount","sent","received","fee","balance","day"].forEach(k=>{if(k in data)data[k]=Number(data[k])});
  if(kind==="account"){
    data.name=String(data.name||"").trim().replace(/\s+/g," ");
    if(!data.name||!Number.isFinite(data.balance)){toast("Escribe un nombre y un saldo válido");return}
    const duplicate=(Array.isArray(state.accounts)?state.accounts:[]).filter(x=>x.country===(data.country||form.dataset.country||state.country)).some(x=>x.id!==id&&String(x.name||"").localeCompare(data.name,"es",{sensitivity:"accent"})===0);
    if(duplicate){toast("Ya existe una cuenta con ese nombre");return}
  }
  if(kind==="transfer"&&data.from===data.to){toast("El origen y el destino deben ser distintos");return}
  const movedToCountry=kind==="account"&&data.country&&data.country!==state.country?data.country:null;
  const affectBalance=data.affectBalance==="yes";delete data.affectBalance;
  const hasPrior=data.hasPrior==="yes";delete data.hasPrior;
  if(kind==="loan"&&!id&&!hasPrior)data.balance=data.amount;
  if(kind==="loan"&&(!(data.balance>=0)||data.balance>data.amount)){toast("El saldo pendiente no puede ser mayor al monto prestado");return}
  const formCountry=data.country||form.dataset.country||state.country;
  const record={...data,id:id||uid(kind[0]),country:kind==="transfer"?undefined:formCountry,updatedAt:new Date().toISOString()};
  if(id)state[collection]=state[collection].map(x=>x.id===id?{...x,...record}:x);
  else{state[collection].push(record);if(kind==="loan"&&affectBalance)createLoanCashTransaction({loan:record,amount:record.amount,date:record.date,stage:"opening"});}
  setButtonBusy(submitButton,true);
  if(await saveState(previousState)){closeForm();if(movedToCountry){state.country=movedToCountry;localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}render();toast(movedToCountry?`Cuenta guardada en ${meta[movedToCountry].name}`:kind==="loan"&&affectBalance?"Préstamo y transacción guardados en Google Sheets":kind==="account"?(id?"Cuenta actualizada en Google Sheets":"Cuenta guardada en Google Sheets"):id?"Registro actualizado en Google Sheets":"Registro guardado en Google Sheets")}
  else setButtonBusy(submitButton,false);
};
function askDelete(kind,id){pendingDelete={kind,id};let label="este registro";if(kind!=="all"){const collection={transaction:"transactions",account:"accounts",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[kind];const x=state[collection].find(i=>i.id===id);label=x?.name||x?.description||x?.category||x?.person||"este registro"}$("#confirmText").textContent=kind==="all"?"Se eliminarán todos los datos de la aplicación en Google Sheets.":`Se eliminará “${label}” de Google Sheets. Esta acción no se puede deshacer.`;$("#confirmModal").classList.remove("hidden")}
function askLoanPaymentDelete(loanId,paymentId){
  const loan=state.loans.find(x=>x.id===loanId),payment=loan&&findLoanPayment(loan,paymentId);if(!loan||!payment)return;
  loanDetailReturnContext=loanDetailContext?{...loanDetailContext}:null;hideLoanDetail({preserveContext:true});
  pendingDelete={kind:"loanPayment",loanId,paymentId};
  $("#confirmText").textContent=`Se eliminará el abono de ${money(payment.amount,loan.country)}. El saldo pendiente se recalculará${payment.transactionId?" y también se eliminará su movimiento vinculado de Transacciones":""}.`;
  $("#confirmModal").classList.remove("hidden");
}
function removeLoanPayment(loan,payment){
  const amount=Number(payment.amount)||0;
  loan.balance=Math.max(0,Math.min(Number(loan.amount)||0,(Number(loan.balance)||0)+amount));loan.updatedAt=new Date().toISOString();
  if(Array.isArray(loan.payments))loan.payments=loan.payments.filter(x=>String(x.id)!==String(payment.id));
  if(payment.transactionId)state.transactions=state.transactions.filter(x=>x.id!==payment.transactionId);
}
$("[data-cancel]").onclick=()=>{$("#confirmModal").classList.add("hidden");pendingDelete=null;restoreLoanDetail()};
$("#confirmDelete").onclick=async e=>{
  if(!pendingDelete)return;
  const previousState=structuredClone(state),deleteRequest={...pendingDelete};
  if(deleteRequest.kind==="all")state=blankState();
  else if(deleteRequest.kind==="loanPayment"){
    const loan=state.loans.find(x=>x.id===deleteRequest.loanId),payment=loan&&findLoanPayment(loan,deleteRequest.paymentId);
    if(!loan||!payment){toast("No se encontró el abono que quieres eliminar");return}
    removeLoanPayment(loan,payment);
  }else{
    const collection={transaction:"transactions",account:"accounts",budget:"budgets",transfer:"transfers",loan:"loans",recurring:"recurrings"}[deleteRequest.kind];
    state[collection]=state[collection].filter(x=>x.id!==deleteRequest.id);
  }
  setButtonBusy(e.currentTarget,true,"Eliminando…");
  if(await saveState(previousState)){
    $("#confirmModal").classList.add("hidden");pendingDelete=null;const context=loanDetailReturnContext;loanDetailReturnContext=null;render();if(context&&currentPage==="prestamos")openLoanDetail(context.key,context.loanId);toast(deleteRequest.kind==="loanPayment"?"Abono eliminado y saldo actualizado en Google Sheets":"Registro eliminado de Google Sheets");
  }else setButtonBusy(e.currentTarget,false);
};
function openLoanPaymentEditor(loanId,paymentId){
  const loan=state.loans.find(x=>x.id===loanId),payment=loan&&findLoanPayment(loan,paymentId);if(!loan||!payment){toast("No se encontró el abono que quieres editar");return}
  loanDetailReturnContext=loanDetailContext?{...loanDetailContext}:null;hideLoanDetail({preserveContext:true});
  $("#modalEyebrow").textContent="PRÉSTAMO";$("#modalTitle").textContent=payment.untracked?"Editar abonos anteriores":"Editar abono";
  const optionalDate=`<div class="field"><label>Fecha (opcional)</label><input class="input" name="date" type="date" value="${escapeAttr(payment.date||"")}" title="Haz clic para elegir una fecha"></div>`;
  $("#recordForm").innerHTML=`<div class="loan-payment-summary"><span>${loan.direction==="owed"?"Le debemos a":"Nos debe"} ${escapeHtml(loan.person)}</span><strong>Saldo actual: ${money(loan.balance,loan.country)}</strong></div><div class="form-grid">${moneyField(`Monto del abono (${meta[loan.country].currency})`,"amount",payment.amount,loan.country)}${optionalDate}<label class="form-check full"><input type="checkbox" name="affectBalance" value="yes" ${payment.affectBalance?"checked":""}><span aria-hidden="true"><i class="bi bi-check-lg"></i></span><div><strong>Reflejar también en Transacciones</strong><small>${loan.direction==="owed"?"Mantiene una salida vinculada al pago de la deuda.":"Mantiene una entrada vinculada al cobro de la deuda."}</small></div></label></div><div class="form-actions"><button type="button" class="button ghost" data-close-loan-payment>Cancelar</button><button class="button" type="submit">Guardar cambios</button></div>`;
  $("#recordForm").dataset.kind="loanPaymentEdit";$("#recordForm").dataset.id=loanId;$("#recordForm").dataset.paymentId=paymentId;$("#modal").classList.remove("hidden");bindDatePickers($("#recordForm"));bindMoneyInputs($("#recordForm"));
  const cancel=()=>{$("#modal").classList.add("hidden");restoreLoanDetail()};
  $("[data-close]",$("#modal")).onclick=cancel;$("[data-close-loan-payment]",$("#modal")).onclick=cancel;
}
function payLoan(id){
  const loan=state.loans.find(x=>x.id===id);if(!loan)return;
  const pending=Number(loan.balance)||0,last=loanPaymentHistory(loan).find(x=>!x.untracked&&Number(x.amount)>0);
  const chips=[last&&Number(last.amount)<pending?[`Como el último · ${money(last.amount,loan.country)}`,last.amount]:null,[`Todo · ${money(pending,loan.country)}`,pending]].filter(Boolean);
  $("#modalEyebrow").textContent="PRÉSTAMO";$("#modalTitle").textContent="Registrar abono";
  $("#recordForm").innerHTML=`<div class="loan-payment-summary"><span>${loan.direction==="owed"?"Le debemos a":"Nos debe"} ${escapeHtml(loan.person)}</span><strong>Saldo pendiente: ${money(pending,loan.country)}</strong></div><div class="form-grid">${moneyField(`Monto del abono (${meta[loan.country].currency})`,"amount","",loan.country,{full:true,extra:`max="${pending}"`})}<div class="field full tx-quick">${chips.map(([l,v])=>`<button type="button" class="tx-pill" data-pay-pick="${v}">${escapeHtml(l)}</button>`).join("")}</div>
  <div class="pay-preview full" data-payment-preview><div class="pay-preview-row"><span>Saldo pendiente</span><span class="num"><s>${money(pending,loan.country)}</s> → <b data-after></b></span></div><div class="pay-bar" aria-hidden="true"><i data-bar-paid></i><i data-bar-now></i></div><small data-msg></small></div>
  ${formField("Fecha","date","date",today())}<label class="form-check full"><input type="checkbox" name="affectBalance" value="yes" checked><span aria-hidden="true"><i class="bi bi-check-lg"></i></span><div><strong>Crear también el movimiento de dinero</strong><small>${loan.direction==="owed"?"Registra una salida (abono a capital). No cuenta como gasto del mes.":"Registra una entrada porque te devolvieron dinero. No cuenta como ingreso del mes."}</small></div></label></div><div class="form-actions"><button type="button" class="button ghost" data-close>Cancelar</button><button class="button" type="submit">Registrar abono</button></div>`;
  $("#recordForm").dataset.kind="loanPayment";$("#recordForm").dataset.id=id;$("#recordForm").dataset.paymentId="";$("#modal").classList.remove("hidden");bindDatePickers($("#recordForm"));$$("[data-close]",$("#modal")).forEach(x=>x.onclick=closeForm);
  bindMoneyInputs($("#recordForm"));bindLoanPaymentForm($("#recordForm"),loan);
}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`mi-dinero-respaldo-${today()}.json`;a.click();URL.revokeObjectURL(a.href);toast("Respaldo exportado")}
function saveCloudConfig(){const clientId=$("#googleClientId").value.trim(),spreadsheetId=$("#googleSheetId").value.trim();if(!clientId.endsWith(".apps.googleusercontent.com")||!spreadsheetId){toast("Revisa el Client ID y el Sheet ID");return}localStorage.setItem("mi-dinero-cloud-config",JSON.stringify({clientId,spreadsheetId,sheetName:"_AppState"}));toast("Configuración guardada; recargando…");setTimeout(()=>location.reload(),700)}
function importData(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{const previousState=structuredClone(state);try{const imported=JSON.parse(reader.result);if(!imported.transactions||!imported.version)throw Error();state={...blankState(),...imported};if(await saveState(previousState)){render();toast("Respaldo importado en Google Sheets")}}catch{state=previousState;toast("El archivo no es un respaldo válido")}};reader.readAsText(file)}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function escapeAttr(v=""){return escapeHtml(v)}

const sidebar=$("#sidebar"),menuButton=$("#menuButton");
const mobileBottomNav=$("#mobileBottomNav"),mobileMoreButton=$("#mobileMoreButton"),mobileMoreBackdrop=$("#mobileMoreBackdrop"),mobileContextAction=$("#mobileContextAction");
const usesHamburgerMenu=()=>window.matchMedia("(max-width: 780px)").matches;
const usesBottomNavigation=()=>window.matchMedia("(max-width: 700px)").matches;
const mobileMorePages=new Set(["cuentas","transferencias","prestamos","configuracion"]);
function setMobileMenuOpen(open){
  sidebar.classList.toggle("open",open);
  menuButton.setAttribute("aria-expanded",String(open));
  menuButton.setAttribute("aria-label",open?"Cerrar menú":"Abrir menú");
}
function setMobileMoreOpen(open,{restoreFocus=false}={}){
  mobileMoreBackdrop.classList.toggle("hidden",!open);
  mobileMoreButton.setAttribute("aria-expanded",String(open));
  document.body.classList.toggle("mobile-more-open",open);
  updateMobileNavigation();
  if(open)requestAnimationFrame(()=>$("#mobileMoreMenu [data-mobile-page]")?.focus());
  else if(restoreFocus)mobileMoreButton.focus();
}
function updateMobileNavigation(){
  const grouped=mobileMorePages.has(currentPage);
  $$("[data-mobile-page]",mobileBottomNav).forEach(button=>{
    const active=button.dataset.mobilePage===currentPage;
    button.classList.toggle("active",active);
    if(active)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");
  });
  $$("[data-mobile-page]",$("#mobileMoreMenu")).forEach(button=>{
    const active=button.dataset.mobilePage===currentPage;
    button.classList.toggle("active",active);
    if(active)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");
  });
  mobileMoreButton.classList.toggle("active",grouped||!mobileMoreBackdrop.classList.contains("hidden"));
  if(grouped)mobileMoreButton.setAttribute("aria-current","page");else mobileMoreButton.removeAttribute("aria-current");
  const action=mobilePrimaryActions[currentPage];
  mobileContextAction.classList.toggle("hidden",!action);
  mobileContextAction.dataset.add=action?.kind||"";
  mobileContextAction.querySelector("span").textContent=action?.label||"";
  mobileContextAction.setAttribute("aria-label",action?.label||"Acción principal");
}
function navigateToPage(page){
  if(!pageNames[page])return;
  currentPage=page;
  setMobileMenuOpen(false);
  setMobileMoreOpen(false);
  render();
  if(usesBottomNavigation())window.scrollTo({top:0,behavior:"auto"});
}
$("#nav").onclick=e=>{const b=e.target.closest("[data-page]");if(!b)return;navigateToPage(b.dataset.page)};
mobileBottomNav.onclick=e=>{
  const pageButton=e.target.closest("[data-mobile-page]");
  if(pageButton){navigateToPage(pageButton.dataset.mobilePage);return}
  if(e.target.closest("#mobileMoreButton"))setMobileMoreOpen(mobileMoreBackdrop.classList.contains("hidden"));
};
$("#mobileMoreMenu").onclick=e=>{const b=e.target.closest("[data-mobile-page]");if(b)navigateToPage(b.dataset.mobilePage)};
$("#closeMobileMore").onclick=()=>setMobileMoreOpen(false,{restoreFocus:true});
mobileMoreBackdrop.onclick=e=>{if(e.target===mobileMoreBackdrop)setMobileMoreOpen(false,{restoreFocus:true})};
mobileContextAction.onclick=()=>{const kind=mobileContextAction.dataset.add;if(kind)openForm(kind)};
$("#countrySwitch").onclick=e=>{const b=e.target.closest("[data-country]");if(!b)return;state.country=b.dataset.country;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render()};
menuButton.onclick=e=>{e.stopPropagation();setMobileMenuOpen(!sidebar.classList.contains("open"))};
document.addEventListener("click",e=>{
  if(usesHamburgerMenu()&&sidebar.classList.contains("open")&&!sidebar.contains(e.target)&&!menuButton.contains(e.target))setMobileMenuOpen(false);
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    if(usesHamburgerMenu())setMobileMenuOpen(false);
    if(!mobileMoreBackdrop.classList.contains("hidden"))setMobileMoreOpen(false,{restoreFocus:true});
  }
});
window.addEventListener("resize",()=>{
  if(!usesHamburgerMenu())setMobileMenuOpen(false);
  if(!usesBottomNavigation()&&!mobileMoreBackdrop.classList.contains("hidden"))setMobileMoreOpen(false);
});
$("#refreshButton").onclick=()=>{const cloud=window.MiDineroCloud;if(!cloud?.isConnected()){toast("Conecta Google Sheets para actualizar los datos");cloud?.showLogin?.();return}cloud.pull()};
window.miDineroGetState=()=>structuredClone(state);
let pendingMerchantMigration=false;
window.miDineroApplyState=(next,{silent=false}={})=>{const viewingCountry=state?.country;state={...blankState(),...restoreLegacyRecurringChecks(next)};if(viewingCountry)state.country=viewingCountry;if(migrateMerchantDetail(state)>0)pendingMerchantMigration=true;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();if(!silent)toast("Datos sincronizados desde Google Sheets")};
window.miDineroGetPendingRecurringChecksMigration=()=>pendingLegacyRecurringChecksMigration||pendingMerchantMigration?structuredClone(state):null;
window.miDineroCompleteRecurringChecksMigration=()=>{
  pendingLegacyRecurringChecksMigration=false;pendingMerchantMigration=false;
  localStorage.setItem(RECURRING_CHECKS_MIGRATION_KEY,"complete");
  localStorage.removeItem(LEGACY_RECURRING_CHECKS_KEY);
};
window.miDineroRefresh=render;
render();

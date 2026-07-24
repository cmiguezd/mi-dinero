const STORAGE_KEY = "mi-dinero-v3";
const blankState = () => ({
  version: 3, country: "CN",
  transactions: [], budgets: [], transfers: [], loans: [], recurrings: [],
  settings: { user: "Carlos", email: "Cuenta local", dataSource: "Este dispositivo" }
});
let state = loadState();
let currentPage = "resumen";
let pendingDelete = null;
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
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function uid(prefix="r"){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`}
function money(value,country=state.country){return new Intl.NumberFormat(meta[country].locale,{style:"currency",currency:meta[country].currency,maximumFractionDigits:country==="CO"?0:2}).format(Number(value)||0)}
function dateLabel(date){if(!date)return "";return new Intl.DateTimeFormat("es",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`))}
function today(){return new Date().toISOString().slice(0,10)}
function toast(text){const el=$("#toast");el.textContent=text;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
function countryItems(arr){return arr.filter(x=>x.country===state.country)}
function availableCategories(){const imported=countryItems(state.transactions).map(x=>x.category).filter(Boolean);return [...new Set([...imported,...fallbackCategories])].sort((a,b)=>a.localeCompare(b,"es"))}
function pageHead(title,description,action=""){return `<div class="page-head"><div><h2>${title}</h2><p>${description}</p></div>${action}</div>`}
function empty(title,text){return `<div class="empty"><div><strong>${title}</strong>${text}</div></div>`}

function render(){
  $("#pageTitle").textContent=pageNames[currentPage];
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===currentPage));
  $$("#countrySwitch button").forEach(x=>x.classList.toggle("active",x.dataset.country===state.country));
  const views={resumen:renderDashboard,transacciones:renderTransactions,presupuestos:renderBudgets,transferencias:renderTransfers,prestamos:renderLoans,recurrentes:renderRecurrings,configuracion:renderSettings};
  $("#content").innerHTML=views[currentPage]();
  bindPage();
}
function totals(){
  const tx=countryItems(state.transactions);
  const income=tx.filter(x=>["ingreso","cobro"].includes(x.type)).reduce((a,b)=>a+Number(b.amount),0);
  const expense=tx.filter(x=>x.type==="gasto").reduce((a,b)=>a+Number(b.amount),0);
  return {income,expense,balance:income-expense,count:tx.length};
}
function renderDashboard(){
  const t=totals(), budgets=countryItems(state.budgets), used=budgets.reduce((a,b)=>a+spentByCategory(b.category),0), budget=budgets.reduce((a,b)=>a+Number(b.amount),0);
  const tx=countryItems(state.transactions).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
  return `${pageHead(`Hola, Carlos 👋`,`Así se ven tus finanzas en ${meta[state.country].name}.`,`<button class="button" data-add="transaction">+ Nueva transacción</button>`)}
  <div class="cards">
    ${metric("Saldo actual",money(t.balance),"Disponible",t.balance>=0?"green":"red")}
    ${metric("Ingresos",money(t.income),"Total registrado","green")}
    ${metric("Gastos",money(t.expense),`${t.count} movimientos`,"red")}
    ${metric("Presupuesto disponible",money(Math.max(0,budget-used)),budget?`${Math.round(used/budget*100)}% utilizado`:"Sin presupuestos","yellow")}
  </div>
  <div class="dashboard-grid">
    <div class="panel"><div class="panel-head"><h3>Ingresos y gastos</h3><div class="legend"><span><i></i>Ingresos</span><span><i class="gray"></i>Gastos</span></div></div>${chart()}</div>
    <div class="panel"><div class="panel-head"><h3>Movimientos recientes</h3><button class="button ghost" data-go="transacciones">Ver todos</button></div>${tx.length?transactionRows(tx):empty("Sin movimientos","Crea tu primera transacción.")}</div>
  </div>`;
}
function metric(label,value,small,color){return `<article class="metric"><div class="metric-label"><span>${label}</span><i class="dot ${color}"></i></div><div class="metric-value">${value}</div><small>${small}</small></article>`}
function chart(){
  const months=[];const now=new Date();
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:d.toISOString().slice(0,7),label:d.toLocaleString("es",{month:"short"})})}
  const vals=months.map(m=>{const list=countryItems(state.transactions).filter(x=>x.date.startsWith(m.key));return {income:list.filter(x=>x.type!=="gasto").reduce((a,b)=>a+Number(b.amount),0),expense:list.filter(x=>x.type==="gasto").reduce((a,b)=>a+Number(b.amount),0)}});const max=Math.max(1,...vals.flatMap(x=>[x.income,x.expense]));
  return `<div class="bars">${months.map((m,i)=>`<div class="bar-group"><div class="bar" style="height:${vals[i].income/max*100}%"></div><div class="bar expense" style="height:${vals[i].expense/max*100}%"></div><span class="bar-label">${m.label}</span></div>`).join("")}</div>`;
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
function renderSettings(){return `${pageHead("Configuración","Administra tus datos y copias de seguridad.")}
  <div class="settings-grid"><div class="panel"><h3>Cuenta</h3><div class="settings-row"><span>Nombre</span><strong>${escapeHtml(state.settings.user)}</strong></div><div class="settings-row"><span>Correo</span><strong>${escapeHtml(state.settings.email)}</strong></div><div class="settings-row"><span>Almacenamiento</span><strong>Este dispositivo</strong></div></div>
  <div class="panel"><h3>Datos</h3><p class="muted">Descarga un respaldo completo o importa uno anterior.</p><div class="form-actions" style="justify-content:flex-start"><button class="button" id="exportData">Exportar respaldo</button><label class="button ghost" for="importData">Importar respaldo</label><input class="file-input" type="file" id="importData" accept=".json"></div><div class="settings-row"><span>Reiniciar aplicación</span><button class="button danger" id="resetData">Borrar datos locales</button></div></div></div>`}

function bindPage(){
  $$("[data-add]").forEach(b=>b.onclick=()=>openForm(b.dataset.add));
  $$("[data-edit]").forEach(b=>b.onclick=()=>openForm(b.dataset.edit,b.dataset.id));
  $$("[data-delete]").forEach(b=>b.onclick=()=>askDelete(b.dataset.delete,b.dataset.id));
  $$("[data-go]").forEach(b=>b.onclick=()=>{currentPage=b.dataset.go;render()});
  $$("[data-pay]").forEach(b=>b.onclick=()=>payLoan(b.dataset.pay));
  const search=$("#searchTx"),filter=$("#typeFilter");if(search)search.oninput=filterTransactions;if(filter)filter.onchange=filterTransactions;
  if($("#exportData"))$("#exportData").onclick=exportData;if($("#importData"))$("#importData").onchange=importData;if($("#resetData"))$("#resetData").onclick=()=>askDelete("all","all");
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
function importData(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const imported=JSON.parse(reader.result);if(!imported.transactions||!imported.version)throw Error();state={...blankState(),...imported};saveState();render();toast("Respaldo importado")}catch{toast("El archivo no es un respaldo válido")}};reader.readAsText(file)}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function escapeAttr(v=""){return escapeHtml(v)}

$("#nav").onclick=e=>{const b=e.target.closest("[data-page]");if(!b)return;currentPage=b.dataset.page;$("#sidebar").classList.remove("open");render()};
$("#countrySwitch").onclick=e=>{const b=e.target.closest("[data-country]");if(!b)return;state.country=b.dataset.country;saveState();render()};
$("#menuButton").onclick=()=>$("#sidebar").classList.toggle("open");
$("#refreshButton").onclick=()=>{state=loadState();render();toast("Datos actualizados")};
render();

import { auth, db, WORKSPACE_ID } from "./firebase.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, onSnapshot, serverTimestamp, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const workspacePath = ["workspaces", WORKSPACE_ID];
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
let currentUser = null;
let unsubscribers = [];
let cache = {
  stages: [], tasks: [], roles: [], products: [], audit: [], competitors: [], promotion: [], files: [], decisions: [], activity: [], settings: {},
  investments: [], equityPayments: [], salesEntries: [], adEntries: [], channelMetrics: []
};

const stageSeeds = [
  {
    id: "stage_01_roles",
    title: "Etapa 1 — Roles y sistema de trabajo",
    objective: "Definir responsabilidades, límites, flujo de revisión y carga de trabajo del equipo.",
    status: "active",
    order: 1,
    tasks: [
      ["Definir participantes y posiciones actuales", ["Crear perfil de cada persona", "Definir posición temporal", "Registrar si aporta capital, trabajo o ambos", "Registrar punto pendiente legal/contable"]],
      ["Crear perfil de Christopher", ["Definir correo de usuario", "Asignar rol principal", "Registrar fortalezas", "Registrar tareas que debe evitar"]],
      ["Crear perfil del colega", ["Definir correo de usuario", "Asignar rol principal", "Registrar fortalezas", "Registrar tareas que debe evitar"]],
      ["Definir flujo de trabajo", ["Idea", "Diseño inicial", "Retoque final", "Revisión", "Publicación", "Registro de decisión"]],
      ["Registrar primera decisión del equipo", ["Escribir decisión", "Explicar por qué", "Asignar impacto", "Guardar en Decision Log"]]
    ]
  },
  {
    id: "stage_02_strategy",
    title: "Etapa 2 — Base estratégica",
    objective: "Ordenar la promesa, cliente inicial, palabras de marca y documentos base antes de crecer.",
    status: "planned",
    order: 2,
    tasks: [
      ["Crear inventario general de productos", ["Crear colecciones", "Registrar producto", "Registrar precio", "Registrar margen", "Clasificar Hero/Support/Conversion"]],
      ["Definir palabras de marca", ["Palabras núcleo", "Palabras visuales", "Palabras emocionales", "Palabras prohibidas"]],
      ["Definir cliente ideal inicial", ["Line cook", "Chef serio", "Service insider", "Objeciones principales"]]
    ]
  },
  {
    id: "stage_03_shopify",
    title: "Etapa 3 — Shopify y auditoría",
    objective: "Revisar la tienda por secciones con evidencias, puntuación y recomendaciones.",
    status: "planned",
    order: 3,
    tasks: [
      ["Capturar pantallas de la tienda", ["Home desktop", "Home mobile", "Menú", "Producto", "Carrito", "Popup"]],
      ["Auditar página de producto", ["Primera imagen", "Descripción", "Tallas", "Colores", "CTA", "Confianza"]],
      ["Auditar mobile", ["Navegación", "Galería", "Botones", "Carrito", "Velocidad visual"]]
    ]
  },
  {
    id: "stage_04_promotion",
    title: "Etapa 4 — Plan de promoción",
    objective: "Ordenar canales, campañas activas, responsables, contenido y resultados.",
    status: "planned",
    order: 4,
    tasks: [
      ["Definir canales activos", ["Instagram", "Email", "Shopify", "Contactos directos", "Canales futuros"]],
      ["Crear campaña Drop 00", ["Objetivo", "Producto", "Oferta", "UTM", "Contenido", "Responsable"]]
    ]
  },
  {
    id: "stage_05_numbers",
    title: "Etapa 5 — Finanzas, ventas y dirección",
    objective: "Registrar inversiones, ventas, gasto publicitario y señales para tomar decisiones de negocio.",
    status: "planned",
    order: 5,
    tasks: [
      ["Registrar inversiones iniciales", ["Marca", "Muestras", "Dominio", "Shopify", "Banco", "Otros gastos"]],
      ["Definir aportes y participación estimada", ["Definir socios", "Registrar aportes de capital", "Registrar abonos entre socios", "Revisar participación estimada"]],
      ["Registrar primeros datos comerciales", ["Ventas Shopify", "Meta Ads", "Etsy si aplica", "Canales orgánicos"]]
    ]
  }
];

const viewTitles = {
  dashboard: "The 86 Club Workspace",
  stages: "Etapas de trabajo",
  roles: "Roles del equipo",
  products: "Productos y colecciones",
  audit: "Auditoría de tienda",
  competitors: "Investigación de competidores",
  promotion: "Plan de promoción",
  investments: "Inversiones y participación",
  commercial: "Ventas y datos comerciales",
  stats: "Estadísticas del negocio",
  diagnosis: "Diagnóstico estratégico",
  files: "Archivos y recursos de Drive",
  decisions: "Registro de decisiones",
  activity: "Actividad del equipo"
};

function workspaceDoc(...parts) { return doc(db, ...workspacePath, ...parts); }
function workspaceCol(...parts) { return collection(db, ...workspacePath, ...parts); }
function money(n) { return `$${Number(n || 0).toFixed(2)}`; }
function num(n) { return Number(n || 0); }
function pct(n) { return `${Number(n || 0).toFixed(1)}%`; }

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("the86_theme", theme);
  $("#themeToggle").textContent = theme === "dark" ? "Modo día" : "Modo noche";
}

$("#themeToggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
setTheme(localStorage.getItem("the86_theme") || "dark");

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("#loginEmail").value.trim(), $("#loginPassword").value);
  } catch (err) {
    $("#loginError").textContent = "No se pudo iniciar sesión. Revisa correo, contraseña o permisos.";
  }
});

$("#signOutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  unsubscribers.forEach(fn => fn());
  unsubscribers = [];
  if (!user) {
    $("#loginView").classList.remove("hidden");
    $("#workspaceView").classList.add("hidden");
    $("#signOutBtn").classList.add("hidden");
    return;
  }
  $("#loginView").classList.add("hidden");
  $("#workspaceView").classList.remove("hidden");
  $("#signOutBtn").classList.remove("hidden");
  $("#userChip").textContent = user.email;
  await ensureWorkspaceSeed();
  await logActivity("login", "auth", `Inició sesión: ${user.email}`);
  subscribeAll();
});

async function ensureWorkspaceSeed() {
  const rootRef = workspaceDoc();
  const snap = await getDoc(rootRef);
  if (!snap.exists()) {
    await setDoc(rootRef, { name: "The 86 Club Workspace", status: "active", version: "1.0", fileStorageMode: "google_drive_links", createdBy: currentUser.email, createdAt: serverTimestamp() });
  }
  for (const seed of stageSeeds) {
    const sref = workspaceDoc("stages", seed.id);
    const ssnap = await getDoc(sref);
    if (!ssnap.exists()) {
      await setDoc(sref, { title: seed.title, objective: seed.objective, status: seed.status, order: seed.order, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      for (let i=0; i<seed.tasks.length; i++) {
        await addDoc(workspaceCol("tasks"), {
          stageId: seed.id,
          title: seed.tasks[i][0],
          status: "pending",
          order: i + 1,
          assignedTo: "",
          reviewer: "",
          linkedModule: "",
          subtasks: seed.tasks[i][1].map(title => ({ title, done: false })),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    }
  }
}

function subscribeCol(name, opts = {}) {
  let q = workspaceCol(name);
  if (opts.order) q = query(q, orderBy(opts.order, opts.dir || "asc"));
  const unsub = onSnapshot(q, (snap) => {
    cache[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });
  unsubscribers.push(unsub);
}

function subscribeAll() {
  const rootUnsub = onSnapshot(workspaceDoc(), (snap) => { cache.settings = snap.exists() ? snap.data() : {}; renderAll(); });
  unsubscribers.push(rootUnsub);
  subscribeCol("stages", { order: "order" });
  subscribeCol("tasks", { order: "order" });
  subscribeCol("roles");
  subscribeCol("products");
  subscribeCol("audit");
  subscribeCol("competitors");
  subscribeCol("promotion");
  subscribeCol("files");
  subscribeCol("decisions");
  subscribeCol("investments");
  subscribeCol("equityPayments");
  subscribeCol("salesEntries");
  subscribeCol("adEntries");
  subscribeCol("channelMetrics");
  const activityQ = query(workspaceCol("activityLog"), orderBy("createdAt", "desc"), limit(50));
  const activityUnsub = onSnapshot(activityQ, snap => { cache.activity = snap.docs.map(d => ({id:d.id, ...d.data()})); renderAll(); });
  unsubscribers.push(activityUnsub);
}

$$(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
function switchView(view) {
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("active-view", v.id === view));
  $("#viewTitle").textContent = viewTitles[view] || "Workspace";
  $("#currentViewEyebrow").textContent = view;
  localStorage.setItem("the86_view", view);
}

function renderAll() {
  if (!currentUser) return;
  renderDashboard();
  renderStages();
  renderGeneric("roles", "Rol", ["title", "owner", "status", "notes"]);
  renderGeneric("products", "Producto", ["name", "collection", "heroStatus", "status", "notes"]);
  renderGeneric("audit", "Auditoría", ["section", "score", "status", "notes"]);
  renderGeneric("competitors", "Competidor", ["brand", "url", "score", "notes"]);
  renderGeneric("promotion", "Campaña/canal", ["name", "channel", "status", "notes"]);
  renderInvestments();
  renderCommercial();
  renderStats();
  renderDiagnosis();
  renderFiles();
  renderGeneric("decisions", "Decisión", ["title", "impact", "status", "notes"]);
  renderActivity();
  switchView(localStorage.getItem("the86_view") || "dashboard");
}

function stageProgress(stageId) {
  const tasks = cache.tasks.filter(t => t.stageId === stageId);
  const total = tasks.reduce((a,t) => a + (t.subtasks?.length || 1), 0);
  const done = tasks.reduce((a,t) => a + ((t.subtasks || []).filter(s => s.done).length || (t.status === "done" ? 1 : 0)), 0);
  return total ? Math.round(done / total * 100) : 0;
}

function getFinanceSummary() {
  const investments = cache.investments || [];
  const equityPayments = cache.equityPayments || [];
  const sales = cache.salesEntries || [];
  const ads = cache.adEntries || [];
  const totalInvestment = investments.reduce((a,x)=>a+num(x.amount),0);
  const totalEquityInvestment = investments.filter(x=>x.countsAsEquity !== "no").reduce((a,x)=>a+num(x.amount),0);
  const totalRevenue = sales.reduce((a,x)=>a+num(x.netSales || x.grossSales),0);
  const totalEstimatedCost = sales.reduce((a,x)=>a+num(x.estimatedCost),0);
  const adSpend = ads.reduce((a,x)=>a+num(x.amountSpent),0);
  const estimatedProfit = sales.reduce((a,x)=>a+num(x.estimatedProfit),0) || (totalRevenue - totalEstimatedCost - adSpend);
  const netBalance = totalRevenue - totalInvestment - adSpend;
  const people = {};
  investments.filter(x=>x.countsAsEquity !== "no").forEach(x => { const p = x.investedBy || "Sin persona"; people[p] = (people[p] || 0) + num(x.amount); });
  equityPayments.filter(x=>x.affectsEquity !== "no").forEach(x => {
    const payer = x.paidBy || "Sin pagador";
    const receiver = x.paidTo || "Sin receptor";
    people[payer] = (people[payer] || 0) + num(x.amount);
    people[receiver] = (people[receiver] || 0) - num(x.amount);
  });
  const totalNetCapital = Object.values(people).reduce((a,b)=>a+Math.max(0,b),0);
  const equity = Object.entries(people).map(([person, amount]) => ({ person, amount, percent: totalNetCapital ? Math.max(0, amount) / totalNetCapital * 100 : 0 }));
  return { totalInvestment, totalEquityInvestment, totalRevenue, totalEstimatedCost, adSpend, estimatedProfit, netBalance, equity, totalNetCapital };
}

function renderDashboard() {
  const totalTasks = cache.tasks.length;
  const doneTasks = cache.tasks.filter(t => t.status === "done" || (t.subtasks?.length && t.subtasks.every(s => s.done))).length;
  const avg = cache.stages.length ? Math.round(cache.stages.reduce((a,s) => a + stageProgress(s.id), 0) / cache.stages.length) : 0;
  const f = getFinanceSummary();
  $("#dashboard").innerHTML = `
    <div class="grid grid-3">
      <div class="card"><span class="eyebrow">Progreso total</span><div class="stat">${avg}%</div><div class="progress-track"><div class="progress-fill" style="width:${avg}%"></div></div></div>
      <div class="card"><span class="eyebrow">Tareas</span><div class="stat">${doneTasks}/${totalTasks}</div><p>Completadas según subtareas y estados.</p></div>
      <div class="card"><span class="eyebrow">Drive</span><p>${cache.settings.driveRootUrl ? `<a href="${cache.settings.driveRootUrl}" target="_blank" rel="noreferrer">Abrir carpeta madre</a>` : "Pendiente conectar carpeta madre."}</p></div>
    </div>
    <div class="grid grid-3" style="margin-top:16px">
      <div class="card"><span class="eyebrow">Inversión registrada</span><div class="stat">${money(f.totalInvestment)}</div><p>Incluye aportes y gastos registrados.</p></div>
      <div class="card"><span class="eyebrow">Ingresos registrados</span><div class="stat">${money(f.totalRevenue)}</div><p>Desde Shopify, Etsy, ventas directas u otros.</p></div>
      <div class="card"><span class="eyebrow">Balance simple</span><div class="stat">${money(f.netBalance)}</div><p>Ingresos menos inversiones y ads registrados.</p></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h3>Próximas etapas</h3>${cache.stages.map(stageCard).join("")}</div>
      <div class="card"><h3>Última actividad</h3>${activityList(6)}</div>
    </div>`;
}

function stageCard(s) { const p = stageProgress(s.id); return `<div class="item"><div class="item-head"><strong>${s.title}</strong><span class="badge">${p}%</span></div><p>${s.objective || ""}</p><div class="progress-track"><div class="progress-fill" style="width:${p}%"></div></div></div>`; }

function renderStages() {
  $("#stages").innerHTML = `<div class="toolbar"><button class="primary-btn" id="addStageBtn">Agregar etapa</button></div><div class="item-list">${cache.stages.map(s => {
    const tasks = cache.tasks.filter(t => t.stageId === s.id).sort((a,b)=>(a.order||0)-(b.order||0));
    return `<div class="card"><div class="item-head"><div><h3>${s.title}</h3><p>${s.objective || ""}</p></div><span class="badge">${stageProgress(s.id)}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${stageProgress(s.id)}%"></div></div><div class="modal-panel">${tasks.map(taskBlock).join("")}</div><button class="soft-btn" data-add-task="${s.id}">Agregar tarea</button></div>`;
  }).join("")}</div>`;
  $("#addStageBtn")?.addEventListener("click", addStage);
  $$(`[data-add-task]`).forEach(b => b.addEventListener("click", () => addTask(b.dataset.addTask)));
  $$(`[data-task] input[type="checkbox"]`).forEach(cb => cb.addEventListener("change", onSubtaskToggle));
  $$(`[data-module]`).forEach(b => b.addEventListener("click", () => switchView(b.dataset.module)));
}

function taskBlock(t) {
  return `<div class="item" data-task="${t.id}"><div class="item-head"><strong>${t.title}</strong><span class="badge">${t.status || "pending"}</span></div>${(t.subtasks||[]).map((s,i)=>`<label class="checkrow"><input type="checkbox" data-index="${i}" ${s.done ? "checked" : ""}/> ${s.title}</label>`).join("")}<div class="small-actions"><button class="soft-btn" data-module="files">Ir a archivos</button><button class="soft-btn" data-module="decisions">Ir a decisiones</button><button class="soft-btn" data-module="investments">Ir a inversiones</button><button class="soft-btn" data-module="stats">Ir a estadísticas</button></div></div>`;
}

async function onSubtaskToggle(e) {
  const taskEl = e.target.closest("[data-task]");
  const task = cache.tasks.find(t => t.id === taskEl.dataset.task);
  const index = Number(e.target.dataset.index);
  const subtasks = [...(task.subtasks || [])];
  subtasks[index] = { ...subtasks[index], done: e.target.checked };
  const status = subtasks.every(s => s.done) ? "done" : "in_progress";
  await updateDoc(workspaceDoc("tasks", task.id), { subtasks, status, updatedAt: serverTimestamp() });
  await logActivity("update_task", "stages", `Actualizó subtarea en: ${task.title}`);
}

async function addStage() {
  const title = prompt("Nombre de la etapa:"); if (!title) return;
  await addDoc(workspaceCol("stages"), { title, objective: "", status: "planned", order: cache.stages.length + 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await logActivity("create_stage", "stages", `Creó etapa: ${title}`);
}
async function addTask(stageId) {
  const title = prompt("Nombre de la tarea:"); if (!title) return;
  await addDoc(workspaceCol("tasks"), { stageId, title, status: "pending", order: cache.tasks.filter(t=>t.stageId===stageId).length + 1, subtasks: [{title:"Primer paso", done:false}], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await logActivity("create_task", "stages", `Creó tarea: ${title}`);
}

function renderGeneric(view, label, fields) {
  const container = $(`#${view}`); if (!container) return;
  const items = cache[view] || [];
  container.innerHTML = `<div class="toolbar"><button class="primary-btn" id="add-${view}">Agregar ${label.toLowerCase()}</button></div>${items.length ? `<div class="item-list">${items.map(item => `<div class="item"><div class="item-head"><strong>${item[fields[0]] || label}</strong><span class="badge">${item.status || item.impact || "registro"}</span></div>${fields.slice(1).map(f => `<p><strong>${f}:</strong> ${formatValue(item[f])}</p>`).join("")}</div>`).join("")}</div>` : emptyState()}`;
  $(`#add-${view}`)?.addEventListener("click", () => addGeneric(view, label, fields));
}

async function addGeneric(view, label, fields) {
  const data = { createdAt: serverTimestamp(), createdBy: currentUser.email, status: "active" };
  for (const field of fields) {
    const val = prompt(`${label} - ${field}:`);
    if (val !== null) data[field] = val;
  }
  await addDoc(workspaceCol(view), data);
  await logActivity(`create_${view}`, view, `Agregó ${label}: ${data[fields[0]] || "sin título"}`);
}

function renderInvestments() {
  const f = getFinanceSummary();
  const equityRows = f.equity.length ? f.equity.map(e => `<div class="item"><div class="item-head"><strong>${e.person}</strong><span class="badge">${pct(e.percent)}</span></div><p>Capital neto estimado: ${money(e.amount)}</p><div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, e.percent))}%"></div></div></div>`).join("") : emptyState();
  const invList = cache.investments.length ? cache.investments.map(i => `<div class="item"><div class="item-head"><strong>${i.name || "Inversión"}</strong><span class="badge">${money(i.amount)}</span></div><p><strong>Quién invirtió:</strong> ${i.investedBy || "—"}</p><p><strong>Categoría:</strong> ${i.category || "—"} · <strong>Fecha:</strong> ${i.date || "—"}</p><p><strong>Cuenta para participación:</strong> ${i.countsAsEquity === "no" ? "No" : "Sí"}</p><p>${formatValue(i.receiptUrl || "")}</p><p class="muted">${i.notes || ""}</p></div>`).join("") : emptyState();
  const payList = cache.equityPayments.length ? cache.equityPayments.map(p => `<div class="item"><div class="item-head"><strong>${p.paidBy || "Pagador"} → ${p.paidTo || "Receptor"}</strong><span class="badge">${money(p.amount)}</span></div><p><strong>Motivo:</strong> ${p.reason || "Abono de compensación"}</p><p><strong>Afecta participación:</strong> ${p.affectsEquity === "no" ? "No" : "Sí"}</p><p class="muted">${p.notes || ""}</p></div>`).join("") : emptyState();
  $("#investments").innerHTML = `
    <div class="notice"><strong>Nota interna:</strong> esta sección calcula una participación estimada según aportes netos registrados. No reemplaza contrato, abogado, contador ni acuerdo legal de socios.</div>
    <div class="grid grid-3">
      <div class="card"><span class="eyebrow">Inversión total</span><div class="stat">${money(f.totalInvestment)}</div></div>
      <div class="card"><span class="eyebrow">Capital estimado</span><div class="stat">${money(f.totalNetCapital)}</div><p>Aportes que cuentan para participación.</p></div>
      <div class="card"><span class="eyebrow">Abonos entre socios</span><div class="stat">${money(cache.equityPayments.reduce((a,x)=>a+num(x.amount),0))}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><div class="item-head"><h3>Participación estimada</h3><button class="primary-btn" id="addEquityPayment">Agregar abono</button></div>${equityRows}</div>
      <div class="card"><h3>Cómo funciona</h3><p>Si una persona invirtió $1,000 y otra le abona $300 como compensación que afecta participación, el sistema estima $700 para la primera y $300 para la segunda. Eso daría 70% / 30% sobre capital neto registrado.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="item-head"><h3>Inversiones y gastos</h3><button class="primary-btn" id="addInvestment">Agregar inversión</button></div>${invList}</div>
    <div class="card" style="margin-top:16px"><h3>Abonos / compensaciones entre socios</h3>${payList}</div>`;
  $("#addInvestment")?.addEventListener("click", addInvestment);
  $("#addEquityPayment")?.addEventListener("click", addEquityPayment);
}

async function addInvestment() {
  const name = prompt("Nombre de la inversión o gasto:"); if (!name) return;
  const amount = prompt("Monto en USD:"); if (amount === null) return;
  const investedBy = prompt("Quién invirtió/pagó:", "the86sclub@gmail.com") || "";
  const category = prompt("Categoría:", "Legal / marca") || "Otros";
  const date = prompt("Fecha:", new Date().toISOString().slice(0,10)) || "";
  const countsAsEquity = prompt("¿Cuenta para participación estimada? escribe yes/no", "yes") || "yes";
  const isReimbursable = prompt("¿Es reembolsable? escribe yes/no", "no") || "no";
  const relatedTo = prompt("Relacionado con:", "General") || "General";
  const receiptUrl = prompt("Link de comprobante en Drive, si existe:") || "";
  const notes = prompt("Notas:") || "";
  await addDoc(workspaceCol("investments"), { name, amount: Number(amount)||0, investedBy, category, date, countsAsEquity: countsAsEquity.toLowerCase().startsWith("n") ? "no" : "yes", isReimbursable, relatedTo, receiptUrl, notes, createdBy: currentUser.email, createdAt: serverTimestamp(), status: "active" });
  await logActivity("create_investment", "investments", `Registró inversión: ${name} (${money(amount)})`);
}

async function addEquityPayment() {
  const paidBy = prompt("Quién paga/abona:"); if (!paidBy) return;
  const paidTo = prompt("A quién le paga/compensa:"); if (!paidTo) return;
  const amount = prompt("Monto en USD:"); if (amount === null) return;
  const reason = prompt("Motivo:", "Abono de compensación de inversión inicial") || "Abono de compensación";
  const affectsEquity = prompt("¿Este abono afecta participación estimada? yes/no", "yes") || "yes";
  const date = prompt("Fecha:", new Date().toISOString().slice(0,10)) || "";
  const notes = prompt("Notas:") || "";
  await addDoc(workspaceCol("equityPayments"), { paidBy, paidTo, amount: Number(amount)||0, reason, affectsEquity: affectsEquity.toLowerCase().startsWith("n") ? "no" : "yes", date, notes, createdBy: currentUser.email, createdAt: serverTimestamp(), status: "active" });
  await logActivity("create_equity_payment", "investments", `Registró abono entre socios: ${paidBy} → ${paidTo} (${money(amount)})`);
}

function renderCommercial() {
  const sales = cache.salesEntries || [];
  const ads = cache.adEntries || [];
  const salesList = sales.length ? sales.map(s => `<div class="item"><div class="item-head"><strong>${s.source || "Venta"} · ${s.date || ""}</strong><span class="badge">${money(s.netSales || s.grossSales)}</span></div><p><strong>Canal:</strong> ${s.channel || "—"} · <strong>Producto:</strong> ${s.productName || "—"}</p><p><strong>Órdenes:</strong> ${s.orders || 0} · <strong>Unidades:</strong> ${s.unitsSold || 0}</p><p class="muted">${s.notes || ""}</p></div>`).join("") : emptyState();
  const adList = ads.length ? ads.map(a => `<div class="item"><div class="item-head"><strong>${a.platform || "Ads"} · ${a.campaignName || "Campaña"}</strong><span class="badge">${money(a.amountSpent)}</span></div><p><strong>Producto:</strong> ${a.productName || "—"} · <strong>Ingresos atribuidos:</strong> ${money(a.attributedRevenue)}</p><p><strong>Clicks:</strong> ${a.clicks || 0} · <strong>ROAS:</strong> ${a.amountSpent ? (num(a.attributedRevenue)/num(a.amountSpent)).toFixed(2) : "—"}</p><p class="muted">${a.notes || ""}</p></div>`).join("") : emptyState();
  $("#commercial").innerHTML = `
    <div class="grid grid-2">
      <div class="card"><div class="item-head"><h3>Ventas / ingresos</h3><button class="primary-btn" id="addSale">Agregar venta/dato</button></div>${salesList}</div>
      <div class="card"><div class="item-head"><h3>Publicidad / Meta / Ads</h3><button class="primary-btn" id="addAd">Agregar gasto ads</button></div>${adList}</div>
    </div>`;
  $("#addSale")?.addEventListener("click", addSaleEntry);
  $("#addAd")?.addEventListener("click", addAdEntry);
}

async function addSaleEntry() {
  const source = prompt("Fuente:", "Shopify") || "Shopify";
  const date = prompt("Fecha:", new Date().toISOString().slice(0,10)) || "";
  const channel = prompt("Canal:", "Online store") || "";
  const productName = prompt("Producto relacionado:", "") || "";
  const grossSales = Number(prompt("Ventas brutas USD:", "0") || 0);
  const discounts = Number(prompt("Descuentos USD:", "0") || 0);
  const netSales = Number(prompt("Ventas netas USD:", String(Math.max(0, grossSales - discounts))) || 0);
  const orders = Number(prompt("Número de órdenes:", "0") || 0);
  const unitsSold = Number(prompt("Unidades vendidas:", "0") || 0);
  const estimatedCost = Number(prompt("Costo estimado USD:", "0") || 0);
  const estimatedProfit = Number(prompt("Ganancia estimada USD:", String(netSales - estimatedCost)) || 0);
  const notes = prompt("Notas:") || "";
  await addDoc(workspaceCol("salesEntries"), { source, date, channel, productName, grossSales, discounts, netSales, orders, unitsSold, estimatedCost, estimatedProfit, notes, createdBy: currentUser.email, createdAt: serverTimestamp(), status: "active" });
  await logActivity("create_sale", "commercial", `Registró venta/dato comercial: ${source} ${money(netSales)}`);
}

async function addAdEntry() {
  const platform = prompt("Plataforma:", "Meta Ads") || "Meta Ads";
  const campaignName = prompt("Campaña:", "") || "Campaña";
  const date = prompt("Fecha:", new Date().toISOString().slice(0,10)) || "";
  const productName = prompt("Producto relacionado:", "") || "";
  const amountSpent = Number(prompt("Gasto USD:", "0") || 0);
  const impressions = Number(prompt("Impresiones:", "0") || 0);
  const clicks = Number(prompt("Clicks:", "0") || 0);
  const attributedRevenue = Number(prompt("Ingresos atribuidos USD:", "0") || 0);
  const attributedSales = Number(prompt("Ventas atribuidas:", "0") || 0);
  const notes = prompt("Notas:") || "";
  await addDoc(workspaceCol("adEntries"), { platform, campaignName, date, productName, amountSpent, impressions, clicks, attributedRevenue, attributedSales, notes, createdBy: currentUser.email, createdAt: serverTimestamp(), status: "active" });
  await logActivity("create_ad", "commercial", `Registró gasto publicitario: ${platform} ${money(amountSpent)}`);
}

function barList(items, labelKey, valueKey, emptyText="Sin datos") {
  if (!items.length) return `<p class="muted">${emptyText}</p>`;
  const max = Math.max(...items.map(i=>num(i[valueKey])), 1);
  return items.map(i => `<div class="item"><div class="item-head"><strong>${i[labelKey]}</strong><span class="badge">${money(i[valueKey])}</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.round(num(i[valueKey])/max*100)}%"></div></div></div>`).join("");
}

function groupSum(items, key, value) {
  const out = {};
  items.forEach(i => { const k = i[key] || "Sin clasificar"; out[k] = (out[k] || 0) + num(i[value]); });
  return Object.entries(out).map(([name, amount]) => ({ name, amount })).sort((a,b)=>b.amount-a.amount);
}

function renderStats() {
  const f = getFinanceSummary();
  const invByCat = groupSum(cache.investments, "category", "amount");
  const salesByProduct = groupSum(cache.salesEntries, "productName", "netSales");
  const salesByChannel = groupSum(cache.salesEntries, "channel", "netSales");
  const adsByPlatform = groupSum(cache.adEntries, "platform", "amountSpent");
  $("#stats").innerHTML = `
    <div class="grid grid-4">
      <div class="card"><span class="eyebrow">Inversión</span><div class="stat">${money(f.totalInvestment)}</div></div>
      <div class="card"><span class="eyebrow">Ingresos</span><div class="stat">${money(f.totalRevenue)}</div></div>
      <div class="card"><span class="eyebrow">Ads</span><div class="stat">${money(f.adSpend)}</div></div>
      <div class="card"><span class="eyebrow">Ganancia estimada</span><div class="stat">${money(f.estimatedProfit)}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h3>Inversión por categoría</h3>${barList(invByCat, "name", "amount")}</div>
      <div class="card"><h3>Ventas por producto</h3>${barList(salesByProduct, "name", "amount")}</div>
      <div class="card"><h3>Ventas por canal</h3>${barList(salesByChannel, "name", "amount")}</div>
      <div class="card"><h3>Gasto publicitario por plataforma</h3>${barList(adsByPlatform, "name", "amount")}</div>
    </div>`;
}

function renderDiagnosis() {
  const f = getFinanceSummary();
  const designTasks = cache.tasks.filter(t => /diseñ|mockup|producto|photoshop|arte/i.test(`${t.title} ${(t.subtasks||[]).map(s=>s.title).join(" ")}`)).length;
  const marketingTasks = cache.tasks.filter(t => /marketing|promoci|campaña|canal|email|instagram|meta|etsy|contenido/i.test(`${t.title} ${(t.subtasks||[]).map(s=>s.title).join(" ")}`)).length;
  const promotedProducts = groupSum(cache.adEntries, "productName", "amountSpent");
  const sellingProducts = groupSum(cache.salesEntries, "productName", "netSales");
  const alerts = [];
  if (f.totalInvestment > 0 && f.totalRevenue === 0) alerts.push(["Alta", "Hay inversión registrada pero todavía no hay ventas registradas.", "Revisar oferta, página de producto, tráfico y primeros canales de promoción."]);
  if (f.adSpend > 0 && f.totalRevenue === 0) alerts.push(["Alta", "Hay gasto publicitario registrado sin ingresos registrados.", "Pausar o revisar anuncios hasta confirmar página, producto, audiencia y medición."]);
  if (designTasks > marketingTasks * 2 && designTasks >= 3) alerts.push(["Media", "La actividad parece inclinada hacia diseño/producto más que hacia promoción.", "Asignar tareas de divulgación, contenido, email y canales antes de crear más diseños."]);
  if (marketingTasks === 0 && cache.tasks.length > 4) alerts.push(["Media", "No se detectan tareas fuertes de marketing en el sistema.", "Crear tareas para canales, calendario de contenido, email y revisión de campañas."]);
  if (promotedProducts[0] && !sellingProducts.find(p => p.name === promotedProducts[0].name)) alerts.push(["Media", `${promotedProducts[0].name} tiene gasto/promoción registrada pero no ventas registradas.`, "Revisar si el producto, creatividad, precio o audiencia necesitan ajuste."]);
  if (sellingProducts[0]) alerts.push(["Oportunidad", `${sellingProducts[0].name} lidera ventas registradas.`, "Considerar convertirlo en producto hero temporal o crear campaña específica."]);
  if (!alerts.length) alerts.push(["Base", "Todavía faltan datos para diagnóstico fuerte.", "Registra inversiones, ventas, ads y tareas durante unos días para que el sistema empiece a dar señales."]);
  $("#diagnosis").innerHTML = `<div class="card"><h3>Lectura estratégica automática</h3><p class="muted">Reglas simples conectadas a inversiones, ventas, ads, productos y tareas. No reemplaza criterio humano, pero sirve como alarma temprana.</p>${alerts.map(([sev,msg,rec]) => `<div class="item"><div class="item-head"><strong>${msg}</strong><span class="badge">${sev}</span></div><p><strong>Recomendación:</strong> ${rec}</p></div>`).join("")}</div>`;
}

function renderFiles() {
  const items = cache.files || [];
  $("#files").innerHTML = `<div class="toolbar"><button class="primary-btn" id="add-file">Agregar recurso Drive</button>${cache.settings.driveRootUrl ? `<a class="soft-btn" href="${cache.settings.driveRootUrl}" target="_blank" rel="noreferrer">Abrir Drive madre</a>` : ""}</div>${items.length ? `<div class="item-list">${items.map(f => `<div class="item"><div class="item-head"><strong>${f.name || "Recurso"}</strong><span class="badge">${f.category || "link"}</span></div><p>${f.notes || ""}</p><p><a href="${f.url}" target="_blank" rel="noreferrer">Abrir recurso</a></p><p class="muted">Relacionado con: ${f.relatedTo || "general"}</p></div>`).join("")}</div>` : emptyState()}`;
  $("#add-file")?.addEventListener("click", addFileRecord);
}
async function addFileRecord() {
  const name = prompt("Nombre del recurso:"); if (!name) return;
  const url = prompt("Pega el link de Google Drive:"); if (!url) return;
  const category = prompt("Categoría:", "01_Shopify_Captures") || "General";
  const relatedTo = prompt("Relacionado con:", "Auditoría tienda") || "General";
  const notes = prompt("Notas:") || "";
  await addDoc(workspaceCol("files"), { name, url, category, relatedTo, notes, createdBy: currentUser.email, createdAt: serverTimestamp(), status: "active" });
  await logActivity("create_file_link", "files", `Agregó recurso Drive: ${name}`);
}

function renderActivity() { $("#activity").innerHTML = `<div class="card"><h3>Actividad reciente</h3>${activityList(50)}</div>`; }
function activityList(n) { return cache.activity.slice(0,n).map(a => `<div class="item"><strong>${a.summary || a.action}</strong><p class="muted">${a.userEmail || "usuario"} · ${a.module || "workspace"}</p></div>`).join("") || emptyState(); }
async function logActivity(action, module, summary) {
  if (!currentUser) return;
  await addDoc(workspaceCol("activityLog"), { action, module, summary, userId: currentUser.uid, userEmail: currentUser.email, createdAt: serverTimestamp() });
}
function emptyState() { return document.querySelector("#emptyStateTemplate").innerHTML; }
function formatValue(v) { return v ? (String(v).startsWith("http") ? `<a href="${v}" target="_blank" rel="noreferrer">Abrir link</a>` : v) : "—"; }

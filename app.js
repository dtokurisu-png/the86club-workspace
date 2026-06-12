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


const COLLECTION_LABELS = {
  roles: "Rol", products: "Producto", audit: "Auditoría", competitors: "Competidor", promotion: "Campaña/canal", decisions: "Decisión",
  files: "Recurso Drive", investments: "Inversión", equityPayments: "Abono / compensación", salesEntries: "Venta / dato", adEntries: "Gasto publicitario"
};

const FIELD_SCHEMAS = {
  roles: [
    {name:"title", label:"Título del rol", required:true, placeholder:"Dirección visual / Marketing / Editor"},
    {name:"owner", label:"Responsable", placeholder:"Christopher / Socio / Cuenta empresa"},
    {name:"status", label:"Estado", type:"select", options:["active","pending","paused"]},
    {name:"notes", label:"Notas, límites y responsabilidades", type:"textarea"}
  ],
  products: [
    {name:"name", label:"Nombre del producto", required:true},
    {name:"collection", label:"Colección", placeholder:"Drop 00 — Essentials"},
    {name:"heroStatus", label:"Tipo estratégico", type:"select", options:["Hero","Support","Conversion","Testing"]},
    {name:"status", label:"Estado", type:"select", options:["active","draft","review","paused"]},
    {name:"notes", label:"Notas", type:"textarea"}
  ],
  audit: [
    {name:"section", label:"Sección auditada", required:true, placeholder:"Home / Producto / Carrito / Mobile"},
    {name:"score", label:"Puntuación 0-100", type:"number"},
    {name:"status", label:"Estado", type:"select", options:["No revisado","En revisión","Necesita mejora","Aprobado","Crítico"]},
    {name:"notes", label:"Hallazgos y recomendaciones", type:"textarea"}
  ],
  competitors: [
    {name:"brand", label:"Marca / competidor", required:true},
    {name:"url", label:"URL", type:"url"},
    {name:"score", label:"Puntuación comparativa", type:"number"},
    {name:"notes", label:"Qué hacen bien, qué hacen mal, qué aprendemos", type:"textarea"}
  ],
  promotion: [
    {name:"name", label:"Nombre de campaña o canal", required:true},
    {name:"channel", label:"Canal", placeholder:"Instagram / Email / Shopify / Etsy"},
    {name:"status", label:"Estado", type:"select", options:["Activo","Pausado","Futuro","Completado"]},
    {name:"notes", label:"Objetivo, contenido, responsable y resultados", type:"textarea"}
  ],
  decisions: [
    {name:"title", label:"Decisión", required:true},
    {name:"impact", label:"Impacto", type:"select", options:["Alto","Medio","Bajo","Pendiente"]},
    {name:"status", label:"Estado", type:"select", options:["active","review","closed"]},
    {name:"notes", label:"Por qué se tomó, opciones descartadas y efecto", type:"textarea"}
  ],
  files: [
    {name:"name", label:"Nombre del recurso", required:true},
    {name:"url", label:"Link de Google Drive", type:"url", required:true},
    {name:"category", label:"Categoría", type:"select", options:["01_Shopify_Captures","02_Product_Mockups","03_Ad_Materials","04_Competitor_Screenshots","05_Brand_References","06_Design_Finals","07_Campaign_Assets","08_Exports","09_Documents","10_To_Review","Otro"]},
    {name:"relatedTo", label:"Relacionado con", placeholder:"Auditoría tienda / Drop 00 / Campaña"},
    {name:"notes", label:"Notas", type:"textarea"}
  ],
  investments: [
    {name:"name", label:"Nombre de inversión o gasto", required:true},
    {name:"amount", label:"Monto USD", type:"number", required:true},
    {name:"investedBy", label:"Quién invirtió / pagó", placeholder:"the86sclub@gmail.com"},
    {name:"category", label:"Categoría", type:"select", options:["Legal / marca","Shopify","Printful / muestras","Dominio","Banco","Publicidad","Diseño","Software","Fotografía","Herramientas IA","Material de marketing","Etsy","Otros marketplaces","Otros"]},
    {name:"date", label:"Fecha", type:"date"},
    {name:"countsAsEquity", label:"Cuenta para participación estimada", type:"select", options:["yes","no"]},
    {name:"isReimbursable", label:"Es reembolsable", type:"select", options:["no","yes"]},
    {name:"relatedTo", label:"Relacionado con", placeholder:"General / Drop 00 / Shopify"},
    {name:"receiptUrl", label:"Link de comprobante en Drive", type:"url"},
    {name:"notes", label:"Notas", type:"textarea"}
  ],
  equityPayments: [
    {name:"paidBy", label:"Quién paga / abona", required:true},
    {name:"paidTo", label:"A quién compensa", required:true},
    {name:"amount", label:"Monto USD", type:"number", required:true},
    {name:"reason", label:"Motivo", placeholder:"Abono de compensación de inversión inicial"},
    {name:"affectsEquity", label:"Afecta participación estimada", type:"select", options:["yes","no"]},
    {name:"date", label:"Fecha", type:"date"},
    {name:"notes", label:"Notas", type:"textarea"}
  ],
  salesEntries: [
    {name:"source", label:"Fuente", type:"select", options:["Shopify","Etsy","Venta directa","Instagram","Otro"]},
    {name:"date", label:"Fecha", type:"date"},
    {name:"channel", label:"Canal", placeholder:"Online store / Instagram / Email"},
    {name:"productName", label:"Producto relacionado"},
    {name:"grossSales", label:"Ventas brutas USD", type:"number"},
    {name:"discounts", label:"Descuentos USD", type:"number"},
    {name:"netSales", label:"Ventas netas USD", type:"number"},
    {name:"orders", label:"Número de órdenes", type:"number"},
    {name:"unitsSold", label:"Unidades vendidas", type:"number"},
    {name:"estimatedCost", label:"Costo estimado USD", type:"number"},
    {name:"estimatedProfit", label:"Ganancia estimada USD", type:"number"},
    {name:"notes", label:"Notas", type:"textarea"}
  ],
  adEntries: [
    {name:"platform", label:"Plataforma", type:"select", options:["Meta Ads","Instagram organic","TikTok","Pinterest","Google","Otro"]},
    {name:"campaignName", label:"Campaña", required:true},
    {name:"date", label:"Fecha", type:"date"},
    {name:"productName", label:"Producto relacionado"},
    {name:"amountSpent", label:"Gasto USD", type:"number"},
    {name:"impressions", label:"Impresiones", type:"number"},
    {name:"clicks", label:"Clicks", type:"number"},
    {name:"attributedRevenue", label:"Ingresos atribuidos USD", type:"number"},
    {name:"attributedSales", label:"Ventas atribuidas", type:"number"},
    {name:"notes", label:"Notas", type:"textarea"}
  ],
  stages: [
    {name:"title", label:"Nombre de la etapa", required:true},
    {name:"objective", label:"Objetivo", type:"textarea"},
    {name:"status", label:"Estado", type:"select", options:["active","planned","paused","done"]}
  ],
  tasks: [
    {name:"title", label:"Nombre de la tarea", required:true},
    {name:"status", label:"Estado", type:"select", options:["pending","in_progress","done"]},
    {name:"assignedTo", label:"Responsable"},
    {name:"reviewer", label:"Revisor"},
    {name:"subtasksText", label:"Subtareas, una por línea", type:"textarea", placeholder:"Primer paso\nSegundo paso"}
  ]
};

function ensureModalRoot() {
  let root = document.querySelector("#appModalRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "appModalRoot";
    document.body.appendChild(root);
  }
  return root;
}

function openRecordModal({ title, collectionName, schema, initial = {}, onSave }) {
  return new Promise((resolve) => {
    const root = ensureModalRoot();
    const isEdit = Boolean(initial?.id);
    const fieldsHtml = schema.map(fieldInputHtml).join("");
    root.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <div class="record-modal">
          <div class="modal-header">
            <div><span class="eyebrow">${collectionName || "Registro"}</span><h2>${title}</h2></div>
            <button class="icon-btn" data-modal-close aria-label="Cerrar">×</button>
          </div>
          <form id="recordModalForm" class="modal-form">
            <div class="form-grid">${fieldsHtml}</div>
            <div class="modal-actions">
              <button type="button" class="soft-btn" data-modal-close>Cancelar</button>
              <button type="submit" class="primary-btn">${isEdit ? "Guardar cambios" : "Agregar"}</button>
            </div>
          </form>
        </div>
      </div>`;
    const form = root.querySelector("#recordModalForm");
    schema.forEach(f => {
      const el = form.elements[f.name];
      if (!el) return;
      let val = initial[f.name];
      if (f.name === "subtasksText" && initial.subtasks) val = (initial.subtasks || []).map(s => s.title).join("\n");
      if (val === undefined || val === null || val === "") val = defaultForField(f);
      el.value = val;
    });
    root.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", () => { closeModal(); resolve(null); }));
    root.querySelector(".modal-backdrop").addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) { closeModal(); resolve(null); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = {};
      schema.forEach(f => {
        const el = form.elements[f.name];
        if (!el) return;
        let value = el.value.trim();
        if (f.type === "number") value = Number(value || 0);
        data[f.name] = value;
      });
      if (data.subtasksText !== undefined) {
        data.subtasks = data.subtasksText.split("\n").map(x => x.trim()).filter(Boolean).map(title => ({ title, done: false }));
        delete data.subtasksText;
      }
      await onSave(data);
      closeModal();
      resolve(data);
    });
    setTimeout(() => root.querySelector("input, textarea, select")?.focus(), 30);
  });
}

function closeModal() { const root = document.querySelector("#appModalRoot"); if (root) root.innerHTML = ""; }
function defaultForField(f) {
  if (f.type === "date") return new Date().toISOString().slice(0,10);
  if (f.type === "select") return f.options?.[0] || "";
  if (f.name === "investedBy") return currentUser?.email || "";
  if (f.name === "createdBy") return currentUser?.email || "";
  return "";
}
function fieldInputHtml(f) {
  const required = f.required ? "required" : "";
  const placeholder = f.placeholder ? `placeholder="${escapeAttr(f.placeholder)}"` : "";
  if (f.type === "textarea") return `<label class="field full"><span>${f.label}</span><textarea name="${f.name}" ${placeholder} ${required}></textarea></label>`;
  if (f.type === "select") return `<label class="field"><span>${f.label}</span><select name="${f.name}" ${required}>${(f.options||[]).map(o=>`<option value="${escapeAttr(o)}">${o}</option>`).join("")}</select></label>`;
  return `<label class="field"><span>${f.label}</span><input name="${f.name}" type="${f.type || "text"}" ${placeholder} ${required}/></label>`;
}
function escapeAttr(v) { return String(v || "").replaceAll('"', '&quot;'); }
function recordActions(view, id) { return `<div class="small-actions"><button class="soft-btn" data-edit-record="${view}:${id}">Editar</button></div>`; }


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
  await openRecordModal({
    title: "Agregar etapa",
    collectionName: "Etapas",
    schema: FIELD_SCHEMAS.stages,
    onSave: async (data) => {
      await addDoc(workspaceCol("stages"), { ...data, order: cache.stages.length + 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await logActivity("create_stage", "stages", `Creó etapa: ${data.title}`);
    }
  });
}
async function addTask(stageId) {
  await openRecordModal({
    title: "Agregar tarea",
    collectionName: "Etapas",
    schema: FIELD_SCHEMAS.tasks,
    onSave: async (data) => {
      await addDoc(workspaceCol("tasks"), { ...data, stageId, order: cache.tasks.filter(t=>t.stageId===stageId).length + 1, subtasks: data.subtasks?.length ? data.subtasks : [{title:"Primer paso", done:false}], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await logActivity("create_task", "stages", `Creó tarea: ${data.title}`);
    }
  });
}

function renderGeneric(view, label, fields) {
  const container = $(`#${view}`); if (!container) return;
  const items = cache[view] || [];
  container.innerHTML = `<div class="toolbar"><button class="primary-btn" id="add-${view}">Agregar ${label.toLowerCase()}</button></div>${items.length ? `<div class="item-list">${items.map(item => `<div class="item"><div class="item-head"><strong>${item[fields[0]] || label}</strong><span class="badge">${item.status || item.impact || "registro"}</span></div>${fields.slice(1).map(f => `<p><strong>${f}:</strong> ${formatValue(item[f])}</p>`).join("")}${recordActions(view, item.id)}</div>`).join("")}</div>` : emptyState()}`;
  $(`#add-${view}`)?.addEventListener("click", () => addGeneric(view, label, fields));
  $$(`[data-edit-record^="${view}:"]`).forEach(btn => btn.addEventListener("click", () => editGeneric(btn.dataset.editRecord.split(":")[0], btn.dataset.editRecord.split(":")[1])));
}

async function addGeneric(view, label, fields) {
  const schema = FIELD_SCHEMAS[view] || fields.map(f => ({ name:f, label:f }));
  await openRecordModal({
    title: `Agregar ${label.toLowerCase()}`,
    collectionName: label,
    schema,
    onSave: async (data) => {
      await addDoc(workspaceCol(view), { ...data, createdBy: currentUser.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), status: data.status || "active" });
      await logActivity("create_record", view, `Agregó ${label}: ${data[fields[0]] || data.title || data.name || label}`);
    }
  });
}

async function editGeneric(view, id) {
  const item = (cache[view] || []).find(x => x.id === id);
  if (!item) return;
  const label = COLLECTION_LABELS[view] || "Registro";
  const schema = FIELD_SCHEMAS[view] || Object.keys(item).filter(k => !["id","createdAt","updatedAt"].includes(k)).map(k => ({name:k,label:k}));
  await openRecordModal({
    title: `Editar ${label.toLowerCase()}`,
    collectionName: label,
    schema,
    initial: item,
    onSave: async (data) => {
      await updateDoc(workspaceDoc(view, id), { ...data, updatedAt: serverTimestamp() });
      await logActivity("edit_record", view, `Editó ${label}: ${data.title || data.name || item.title || item.name || id}`);
    }
  });
}

function renderInvestments() {
  const f = getFinanceSummary();
  const equityRows = f.equity.length ? f.equity.map(e => `<div class="item"><div class="item-head"><strong>${e.person}</strong><span class="badge">${pct(e.percent)}</span></div><p>Capital neto estimado: ${money(e.amount)}</p><div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, e.percent))}%"></div></div></div>`).join("") : emptyState();
  const invList = cache.investments.length ? cache.investments.map(i => `<div class="item"><div class="item-head"><strong>${i.name || "Inversión"}</strong><span class="badge">${money(i.amount)}</span></div><p><strong>Quién invirtió:</strong> ${i.investedBy || "—"}</p><p><strong>Categoría:</strong> ${i.category || "—"} · <strong>Fecha:</strong> ${i.date || "—"}</p><p><strong>Cuenta para participación:</strong> ${i.countsAsEquity === "no" ? "No" : "Sí"}</p><p>${formatValue(i.receiptUrl || "")}</p><p class="muted">${i.notes || ""}</p>${recordActions("investments", i.id)}</div>`).join("") : emptyState();
  const payList = cache.equityPayments.length ? cache.equityPayments.map(p => `<div class="item"><div class="item-head"><strong>${p.paidBy || "Pagador"} → ${p.paidTo || "Receptor"}</strong><span class="badge">${money(p.amount)}</span></div><p><strong>Motivo:</strong> ${p.reason || "Abono de compensación"}</p><p><strong>Afecta participación:</strong> ${p.affectsEquity === "no" ? "No" : "Sí"}</p><p class="muted">${p.notes || ""}</p>${recordActions("equityPayments", p.id)}</div>`).join("") : emptyState();
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
  $("#addInvestment")?.addEventListener("click", () => addInvestment());
  $("#addEquityPayment")?.addEventListener("click", () => addEquityPayment());
  $$(`[data-edit-record^="investments:"]`).forEach(btn => btn.addEventListener("click", () => addInvestment(btn.dataset.editRecord.split(":")[1])));
  $$(`[data-edit-record^="equityPayments:"]`).forEach(btn => btn.addEventListener("click", () => addEquityPayment(btn.dataset.editRecord.split(":")[1])));
}

async function addInvestment(existingId=null) {
  const item = existingId ? cache.investments.find(x=>x.id===existingId) : null;
  await openRecordModal({
    title: item ? "Editar inversión" : "Agregar inversión",
    collectionName: "Inversiones",
    schema: FIELD_SCHEMAS.investments,
    initial: item || {},
    onSave: async (data) => {
      const payload = { ...data, amount: Number(data.amount)||0, createdBy: item?.createdBy || currentUser.email, updatedAt: serverTimestamp(), status: item?.status || "active" };
      if (item) await updateDoc(workspaceDoc("investments", item.id), payload);
      else await addDoc(workspaceCol("investments"), { ...payload, createdAt: serverTimestamp() });
      await logActivity(item ? "edit_investment" : "create_investment", "investments", `${item ? "Editó" : "Registró"} inversión: ${data.name}`);
    }
  });
}

async function addEquityPayment(existingId=null) {
  const item = existingId ? cache.equityPayments.find(x=>x.id===existingId) : null;
  await openRecordModal({
    title: item ? "Editar abono / compensación" : "Agregar abono / compensación",
    collectionName: "Participación estimada",
    schema: FIELD_SCHEMAS.equityPayments,
    initial: item || {},
    onSave: async (data) => {
      const payload = { ...data, amount: Number(data.amount)||0, createdBy: item?.createdBy || currentUser.email, updatedAt: serverTimestamp(), status: item?.status || "active" };
      if (item) await updateDoc(workspaceDoc("equityPayments", item.id), payload);
      else await addDoc(workspaceCol("equityPayments"), { ...payload, createdAt: serverTimestamp() });
      await logActivity(item ? "edit_equity_payment" : "create_equity_payment", "investments", `${item ? "Editó" : "Registró"} abono: ${data.paidBy} → ${data.paidTo}`);
    }
  });
}

function renderCommercial() {
  const sales = cache.salesEntries || [];
  const ads = cache.adEntries || [];
  const salesList = sales.length ? sales.map(s => `<div class="item"><div class="item-head"><strong>${s.source || "Venta"} · ${s.date || ""}</strong><span class="badge">${money(s.netSales || s.grossSales)}</span></div><p><strong>Canal:</strong> ${s.channel || "—"} · <strong>Producto:</strong> ${s.productName || "—"}</p><p><strong>Órdenes:</strong> ${s.orders || 0} · <strong>Unidades:</strong> ${s.unitsSold || 0}</p><p class="muted">${s.notes || ""}</p>${recordActions("salesEntries", s.id)}</div>`).join("") : emptyState();
  const adList = ads.length ? ads.map(a => `<div class="item"><div class="item-head"><strong>${a.platform || "Ads"} · ${a.campaignName || "Campaña"}</strong><span class="badge">${money(a.amountSpent)}</span></div><p><strong>Producto:</strong> ${a.productName || "—"} · <strong>Ingresos atribuidos:</strong> ${money(a.attributedRevenue)}</p><p><strong>Clicks:</strong> ${a.clicks || 0} · <strong>ROAS:</strong> ${a.amountSpent ? (num(a.attributedRevenue)/num(a.amountSpent)).toFixed(2) : "—"}</p><p class="muted">${a.notes || ""}</p>${recordActions("adEntries", a.id)}</div>`).join("") : emptyState();
  $("#commercial").innerHTML = `
    <div class="grid grid-2">
      <div class="card"><div class="item-head"><h3>Ventas / ingresos</h3><button class="primary-btn" id="addSale">Agregar venta/dato</button></div>${salesList}</div>
      <div class="card"><div class="item-head"><h3>Publicidad / Meta / Ads</h3><button class="primary-btn" id="addAd">Agregar gasto ads</button></div>${adList}</div>
    </div>`;
  $("#addSale")?.addEventListener("click", () => addSaleEntry());
  $("#addAd")?.addEventListener("click", () => addAdEntry());
  $$(`[data-edit-record^="salesEntries:"]`).forEach(btn => btn.addEventListener("click", () => addSaleEntry(btn.dataset.editRecord.split(":")[1])));
  $$(`[data-edit-record^="adEntries:"]`).forEach(btn => btn.addEventListener("click", () => addAdEntry(btn.dataset.editRecord.split(":")[1])));
}

async function addSaleEntry(existingId=null) {
  const item = existingId ? cache.salesEntries.find(x=>x.id===existingId) : null;
  await openRecordModal({
    title: item ? "Editar venta / dato comercial" : "Agregar venta / dato comercial",
    collectionName: "Ventas y datos",
    schema: FIELD_SCHEMAS.salesEntries,
    initial: item || {},
    onSave: async (data) => {
      const payload = { ...data, grossSales:Number(data.grossSales)||0, discounts:Number(data.discounts)||0, netSales:Number(data.netSales)||0, orders:Number(data.orders)||0, unitsSold:Number(data.unitsSold)||0, estimatedCost:Number(data.estimatedCost)||0, estimatedProfit:Number(data.estimatedProfit)||0, createdBy: item?.createdBy || currentUser.email, updatedAt: serverTimestamp(), status: item?.status || "active" };
      if (item) await updateDoc(workspaceDoc("salesEntries", item.id), payload);
      else await addDoc(workspaceCol("salesEntries"), { ...payload, createdAt: serverTimestamp() });
      await logActivity(item ? "edit_sale" : "create_sale", "commercial", `${item ? "Editó" : "Registró"} venta/dato comercial: ${data.source} ${money(data.netSales)}`);
    }
  });
}

async function addAdEntry(existingId=null) {
  const item = existingId ? cache.adEntries.find(x=>x.id===existingId) : null;
  await openRecordModal({
    title: item ? "Editar gasto publicitario" : "Agregar gasto publicitario",
    collectionName: "Publicidad / Ads",
    schema: FIELD_SCHEMAS.adEntries,
    initial: item || {},
    onSave: async (data) => {
      const payload = { ...data, amountSpent:Number(data.amountSpent)||0, impressions:Number(data.impressions)||0, clicks:Number(data.clicks)||0, attributedRevenue:Number(data.attributedRevenue)||0, attributedSales:Number(data.attributedSales)||0, createdBy: item?.createdBy || currentUser.email, updatedAt: serverTimestamp(), status: item?.status || "active" };
      if (item) await updateDoc(workspaceDoc("adEntries", item.id), payload);
      else await addDoc(workspaceCol("adEntries"), { ...payload, createdAt: serverTimestamp() });
      await logActivity(item ? "edit_ad" : "create_ad", "commercial", `${item ? "Editó" : "Registró"} gasto publicitario: ${data.platform} ${money(data.amountSpent)}`);
    }
  });
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
  $("#files").innerHTML = `<div class="toolbar"><button class="primary-btn" id="add-file">Agregar recurso Drive</button>${cache.settings.driveRootUrl ? `<a class="soft-btn" href="${cache.settings.driveRootUrl}" target="_blank" rel="noreferrer">Abrir Drive madre</a>` : ""}</div>${items.length ? `<div class="item-list">${items.map(f => `<div class="item"><div class="item-head"><strong>${f.name || "Recurso"}</strong><span class="badge">${f.category || "link"}</span></div><p>${f.notes || ""}</p><p><a href="${f.url}" target="_blank" rel="noreferrer">Abrir recurso</a></p><p class="muted">Relacionado con: ${f.relatedTo || "general"}</p>${recordActions("files", f.id)}</div>`).join("")}</div>` : emptyState()}`;
  $("#add-file")?.addEventListener("click", () => addFileRecord());
  $$(`[data-edit-record^="files:"]`).forEach(btn => btn.addEventListener("click", () => addFileRecord(btn.dataset.editRecord.split(":")[1])));
}
async function addFileRecord(existingId=null) {
  const item = existingId ? cache.files.find(x=>x.id===existingId) : null;
  await openRecordModal({
    title: item ? "Editar recurso Drive" : "Agregar recurso Drive",
    collectionName: "Archivos Drive",
    schema: FIELD_SCHEMAS.files,
    initial: item || {},
    onSave: async (data) => {
      const payload = { ...data, createdBy: item?.createdBy || currentUser.email, updatedAt: serverTimestamp(), status: item?.status || "active" };
      if (item) await updateDoc(workspaceDoc("files", item.id), payload);
      else await addDoc(workspaceCol("files"), { ...payload, createdAt: serverTimestamp() });
      await logActivity(item ? "edit_file_link" : "create_file_link", "files", `${item ? "Editó" : "Agregó"} recurso Drive: ${data.name}`);
    }
  });
}

function renderActivity() { $("#activity").innerHTML = `<div class="card"><h3>Actividad reciente</h3>${activityList(50)}</div>`; }
function activityList(n) { return cache.activity.slice(0,n).map(a => `<div class="item"><strong>${a.summary || a.action}</strong><p class="muted">${a.userEmail || "usuario"} · ${a.module || "workspace"}</p></div>`).join("") || emptyState(); }
async function logActivity(action, module, summary) {
  if (!currentUser) return;
  await addDoc(workspaceCol("activityLog"), { action, module, summary, userId: currentUser.uid, userEmail: currentUser.email, createdAt: serverTimestamp() });
}
function emptyState() { return document.querySelector("#emptyStateTemplate").innerHTML; }
function formatValue(v) { return v ? (String(v).startsWith("http") ? `<a href="${v}" target="_blank" rel="noreferrer">Abrir link</a>` : v) : "—"; }

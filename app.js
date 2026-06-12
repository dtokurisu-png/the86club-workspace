import { auth, db, WORKSPACE_ID } from "./firebase.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, onSnapshot, serverTimestamp, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const workspacePath = ["workspaces", WORKSPACE_ID];
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
let currentUser = null;
let bootError = null;
let unsubscribers = [];

window.addEventListener("error", (event) => {
  bootError = event.message || "Error desconocido";
  console.error("The86 workspace error:", event.error || event.message);
  const loginError = document.querySelector("#loginError");
  if (loginError) loginError.textContent = `Error de carga: ${bootError}`;
});

window.addEventListener("unhandledrejection", (event) => {
  bootError = event.reason?.message || String(event.reason || "Error desconocido");
  console.error("The86 workspace promise error:", event.reason);
  const loginError = document.querySelector("#loginError");
  if (loginError) loginError.textContent = `Error de conexión/carga: ${bootError}`;
});
let cache = {
  stages: [], tasks: [], profiles: [], roles: [], products: [], audit: [], competitors: [], promotion: [], files: [], decisions: [], activity: [], settings: {},
  investments: [], equityPayments: [], salesEntries: [], adEntries: [], channelMetrics: [], profileWeeklyTasks: []
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
      ["Crear perfil de Adrián", ["Definir correo de usuario", "Asignar rol principal", "Registrar fortalezas", "Registrar tareas que debe evitar"]],
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

const WEEK_DAYS = [
  { key: "monday", label: "Lunes" },
  { key: "tuesday", label: "Martes" },
  { key: "wednesday", label: "Miércoles" },
  { key: "thursday", label: "Jueves" },
  { key: "friday", label: "Viernes" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" }
];

const DAY_MODE_OPTIONS = [
  { value: "external_only", label: "Trabajo externo", capacity: "baja" },
  { value: "external_plus_business", label: "Trabajo externo + The 86 Club", capacity: "media" },
  { value: "business_available", label: "Disponible para The 86 Club", capacity: "normal" },
  { value: "light", label: "Día ligero", capacity: "suave" },
  { value: "protected", label: "Día protegido de descanso", capacity: "descanso" }
];

function defaultAvailability() {
  return {
    weeklyCloseDay: "sunday",
    maxDailyBusinessHours: 3,
    notes: "",
    days: WEEK_DAYS.reduce((acc, d) => {
      acc[d.key] = { mode: d.key === "sunday" ? "protected" : "external_plus_business", customHours: "" };
      return acc;
    }, {})
  };
}

function normalizeAvailability(availability = {}) {
  const base = defaultAvailability();
  const out = {
    weeklyCloseDay: availability.weeklyCloseDay || base.weeklyCloseDay,
    maxDailyBusinessHours: Number(availability.maxDailyBusinessHours || base.maxDailyBusinessHours || 3),
    notes: availability.notes || "",
    days: { ...base.days }
  };
  WEEK_DAYS.forEach(d => {
    out.days[d.key] = {
      ...base.days[d.key],
      ...(availability.days?.[d.key] || {})
    };
  });
  return out;
}

function dayModeLabel(mode) {
  return DAY_MODE_OPTIONS.find(o => o.value === mode)?.label || "Sin definir";
}

function availabilityStats(availability = {}) {
  const av = normalizeAvailability(availability);
  const values = WEEK_DAYS.map(d => av.days[d.key]?.mode || "external_plus_business");
  const available = values.filter(v => v === "business_available" || v === "external_plus_business").length;
  const light = values.filter(v => v === "light").length;
  const protectedDays = values.filter(v => v === "protected").length;
  const external = values.filter(v => v === "external_only" || v === "external_plus_business").length;
  const maxHours = Number(av.maxDailyBusinessHours || 0);
  let status = "Disponibilidad sana";
  let className = "status-green";
  if (!availability || !availability.days) { status = "Sin configurar"; className = "status-neutral"; }
  else if (available < 2 && light < 2) { status = "Disponibilidad limitada"; className = "status-yellow"; }
  else if (available + light >= 6 || maxHours > 4 || protectedDays === 0) { status = "Riesgo de sobrecarga"; className = "status-red"; }
  return { available, light, protectedDays, external, maxHours, closeDay: av.weeklyCloseDay, status, className };
}

function dayStateClass(mode) {
  if (mode === "protected") return "day-protected";
  if (mode === "light") return "day-light";
  if (mode === "business_available") return "day-available";
  if (mode === "external_plus_business") return "day-mixed";
  return "day-external";
}


function dayPlanningText(mode) {
  const map = {
    business_available: "Puede recibir tareas normales del negocio.",
    external_plus_business: "Tiene trabajo externo: conviene asignar tareas cortas o bien definidas.",
    external_only: "Día de trabajo externo: no debería recibir tareas automáticas.",
    light: "Día ligero: ideal para revisión, notas o planificación suave.",
    protected: "Día protegido: descanso real, salvo decisión manual."
  };
  return map[mode] || "Día sin lectura definida.";
}

function getProfileWeeklyTasks(profileId) {
  return (cache.profileWeeklyTasks || [])
    .filter(t => t.profileId === profileId)
    .sort((a,b) => WEEK_DAYS.findIndex(d => d.key === a.assignedDay) - WEEK_DAYS.findIndex(d => d.key === b.assignedDay));
}

function intensityLabel(value = "medium") {
  const map = { low: "Baja", medium: "Media", high: "Alta" };
  return map[value] || value;
}

function taskStatusLabel(status = "pending") {
  return status === "completed" ? "Completada" : "Pendiente";
}

function weeklyCalendarSummary(profile, tasks) {
  const availability = normalizeAvailability(profile.availability);
  const stats = availabilityStats(profile.availability);
  const completed = tasks.filter(t => t.status === "completed").length;
  return {
    available: stats.available,
    light: stats.light,
    protectedDays: stats.protectedDays,
    maxHours: stats.maxHours || 3,
    closeDay: stats.closeDay,
    taskCount: tasks.length,
    completed
  };
}


const PROFILE_SEEDS = [
  {
    id: "christopher",
    name: "Christopher",
    email: "",
    avatarUrl: "",
    primaryRole: "Pendiente",
    subRoles: "",
    weeklyLoadStatus: "Sin configurar",
    availability: defaultAvailability(),
    notes: "Perfil base para dirección y operación de The 86 Club. Completar con rol principal, disponibilidad semanal y límites de trabajo."
  },
  {
    id: "adrian",
    name: "Adrián",
    email: "",
    avatarUrl: "",
    primaryRole: "Pendiente",
    subRoles: "",
    weeklyLoadStatus: "Sin configurar",
    availability: defaultAvailability(),
    notes: "Perfil base para definir responsabilidades, disponibilidad semanal, ritmo creativo y participación dentro del sistema."
  }
];

const STAGE_GUIDANCE = {
  stage_01_roles: {
    area: "Equipo / Dirección interna",
    lesson: "Esta etapa enseña a separar responsabilidades antes de acelerar. Un equipo pequeño puede hacer muchas cosas, pero si nadie tiene un carril claro, el proyecto se vuelve impulso, cansancio y doble trabajo.",
    why: "Ayuda a que Christopher y Adrián sepan qué decisiones les corresponden, qué deben revisar juntos y qué límites protegen la energía creativa y comercial del negocio.",
    outcome: "Perfiles base, responsabilidades claras, flujo inicial de revisión y primeras decisiones del equipo."
  },
  stage_02_strategy: {
    area: "Marca / Posicionamiento",
    lesson: "Esta etapa enseña a convertir una marca bonita en una marca entendible. Antes de producir más piezas, el negocio necesita saber qué promete, a quién le habla y qué palabras no debe usar.",
    why: "Una estrategia clara evita diseños desconectados, mensajes flojos y campañas que no explican por qué alguien debería comprar The 86 Club.",
    outcome: "Lenguaje de marca, cliente inicial, producto base y dirección comercial para el Drop."
  },
  stage_03_shopify: {
    area: "Tienda / Conversión",
    lesson: "Esta etapa enseña a mirar Shopify como un vendedor silencioso. Cada imagen, botón, descripción y flujo móvil debe ayudar a que una persona entienda, confíe y compre.",
    why: "Si la tienda no comunica valor rápido, el marketing trae visitas que se evaporan. Auditar evita gastar energía en promoción antes de arreglar puntos que frenan la compra.",
    outcome: "Capturas, revisión por sección, problemas detectados y mejoras priorizadas para vender mejor."
  },
  stage_04_promotion: {
    area: "Marketing / Divulgación",
    lesson: "Esta etapa enseña a promover con intención. No se trata de publicar por ansiedad, sino de conectar producto, mensaje, canal y seguimiento.",
    why: "Un negocio POD necesita visibilidad constante, pero también necesita evitar ruido. Esta etapa ayuda a publicar con propósito y medir qué canal merece atención.",
    outcome: "Canales definidos, campaña inicial, responsables, mensajes y señales de rendimiento."
  },
  stage_05_numbers: {
    area: "Finanzas / Decisión",
    lesson: "Esta etapa enseña a tomar decisiones con números. Invertir, vender y gastar en ads debe verse junto para saber si el proyecto está avanzando o solo consumiendo recursos.",
    why: "Sin datos financieros básicos, el negocio puede sentirse activo aunque esté desequilibrado. Esta etapa conecta inversión, ventas y participación estimada.",
    outcome: "Aportes, ventas, ads, balance simple y señales para decidir qué ajustar."
  }
};

function getStageGuide(stage) {
  return STAGE_GUIDANCE[stage.id] || {
    area: "Área de trabajo",
    lesson: "Esta etapa ordena una parte del negocio para que el equipo aprenda, ejecute y revise con más claridad.",
    why: "La etapa existe para evitar trabajo suelto: cada tarea debe conectar con una mejora real del negocio.",
    outcome: "Tareas claras, progreso visible y próximos pasos mejor definidos."
  };
}

function isStageCollapsed(stageId) {
  return localStorage.getItem(`the86_stage_${stageId}`) !== "open";
}

function setStageCollapsed(stageId, collapsed) {
  localStorage.setItem(`the86_stage_${stageId}`, collapsed ? "closed" : "open");
}

const viewTitles = {
  dashboard: "The 86 Club Workspace",
  stages: "Etapas de trabajo",
  profiles: "Perfiles del equipo",
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


function renderWeeklyCalendar(profile) {
  const availability = normalizeAvailability(profile.availability);
  const tasks = getProfileWeeklyTasks(profile.id);
  const summary = weeklyCalendarSummary(profile, tasks);
  const closeDayMode = availability.days[availability.weeklyCloseDay]?.mode;
  const closeWarning = closeDayMode === "protected"
    ? `<div class="calendar-warning">El cierre semanal cae en un día protegido. Puedes mantenerlo, pero sería mejor moverlo a un día ligero o disponible para revisar la semana sin invadir descanso.</div>`
    : "";
  return `<section class="weekly-calendar">
    <div class="calendar-topline">
      <div>
        <span class="eyebrow">Calendario semanal</span>
        <h4>Semana de trabajo del perfil</h4>
      </div>
      <button class="soft-btn" data-calendar-help="${profile.id}">Cómo leer este calendario</button>
    </div>
    <div class="calendar-summary-strip">
      <span><b>${summary.available}</b> disponibles</span>
      <span><b>${summary.light}</b> ligeros</span>
      <span><b>${summary.protectedDays}</b> protegidos</span>
      <span><b>${summary.maxHours}</b> h/día máx.</span>
      <span><b>${summary.taskCount}</b> tareas</span>
      <span><b>${summary.completed}</b> completadas</span>
    </div>
    ${closeWarning}
    <div class="week-board">
      ${WEEK_DAYS.map(d => {
        const mode = availability.days[d.key]?.mode || "external_plus_business";
        const dayTasks = tasks.filter(t => t.assignedDay === d.key);
        const isClose = availability.weeklyCloseDay === d.key;
        return `<article class="week-day-card ${dayStateClass(mode)} ${isClose ? "is-close-day" : ""}">
          <div class="week-day-head">
            <div><strong>${d.label}</strong>${isClose ? `<small class="close-day-tag">Cierre semanal</small>` : ""}</div>
            <span>${dayModeLabel(mode)}</span>
          </div>
          <p class="day-planning-text">${dayPlanningText(mode)}</p>
          <div class="planned-task-zone">
            <div class="zone-label">Tareas planificadas</div>
            ${dayTasks.length ? dayTasks.map(task => weeklyTaskHtml(task)).join("") : `<div class="empty-day">Sin tareas asignadas todavía.</div>`}
          </div>
          <button class="tiny-btn" data-add-weekly-task="${profile.id}:${d.key}">Agregar tarea manual</button>
        </article>`;
      }).join("")}
    </div>
  </section>`;
}

function weeklyTaskHtml(task) {
  const statusClass = task.status === "completed" ? "task-completed" : "task-pending";
  return `<div class="weekly-task ${statusClass}">
    <div class="weekly-task-head">
      <strong>${escapeHtml(task.title || "Tarea sin título")}</strong>
      <span>${taskStatusLabel(task.status)}</span>
    </div>
    ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
    <div class="weekly-task-meta">
      <span>${Number(task.estimatedMinutes || 0)} min</span>
      <span>Intensidad ${intensityLabel(task.intensity)}</span>
      <span>${task.source || "manual"}</span>
    </div>
    <div class="small-actions compact-actions">
      <button class="soft-btn" data-move-weekly-task="${task.id}">Mover</button>
      <button class="soft-btn" data-toggle-weekly-task="${task.id}">${task.status === "completed" ? "Reabrir" : "Completar"}</button>
    </div>
  </div>`;
}

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
    console.error("Login error", err);
    $("#loginError").textContent = `No se pudo iniciar sesión: ${err?.code || err?.message || "revisa correo, contraseña o dominio autorizado"}.`;
  }
});

$("#signOutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  try {
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
  } catch (err) {
    console.error("Auth boot error", err);
    $("#loginView").classList.add("hidden");
    $("#workspaceView").classList.remove("hidden");
    $("#signOutBtn").classList.remove("hidden");
    $("#userChip").textContent = currentUser?.email || "Sesión detectada";
    $("#dashboard").innerHTML = `<div class="card"><span class="eyebrow">Error de arranque</span><h3>No se pudo cargar el workspace completo</h3><p>${escapeHtml(err?.message || err)}</p><p class="muted">Copia este mensaje y envíamelo si vuelve a pasar. El login no debería quedar bloqueado.</p></div>`;
    switchView("dashboard");
  }
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
  for (const profile of PROFILE_SEEDS) {
    const pref = workspaceDoc("profiles", profile.id);
    const psnap = await getDoc(pref);
    if (!psnap.exists()) {
      await setDoc(pref, { ...profile, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: currentUser.email });
    }
  }
}

function subscribeCol(name, opts = {}) {
  let q = workspaceCol(name);
  if (opts.order) q = query(q, orderBy(opts.order, opts.dir || "asc"));
  const unsub = onSnapshot(q, (snap) => {
    cache[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => {
    console.error(`Firestore subscription error in ${name}`, err);
    const target = document.querySelector("#dashboard");
    if (target) target.insertAdjacentHTML("afterbegin", `<div class="notice error-notice">No se pudo cargar ${name}: ${escapeHtml(err?.message || err)}</div>`);
  });
  unsubscribers.push(unsub);
}

function subscribeAll() {
  const rootUnsub = onSnapshot(workspaceDoc(), (snap) => { cache.settings = snap.exists() ? snap.data() : {}; renderAll(); }, (err) => console.error("Workspace root subscription error", err));
  unsubscribers.push(rootUnsub);
  subscribeCol("stages", { order: "order" });
  subscribeCol("tasks", { order: "order" });
  subscribeCol("profiles");
  subscribeCol("profileWeeklyTasks");
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
  const activityUnsub = onSnapshot(activityQ, snap => { cache.activity = snap.docs.map(d => ({id:d.id, ...d.data()})); renderAll(); }, (err) => console.error("Activity subscription error", err));
  unsubscribers.push(activityUnsub);
}

function initNavigation() {
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  $$("[data-nav-group-toggle]").forEach(toggle => {
    const groupId = toggle.dataset.navGroupToggle;
    const group = document.querySelector(`[data-nav-group="${groupId}"]`);
    const saved = localStorage.getItem(`the86_nav_group_${groupId}`);
    const shouldCollapse = saved === null ? toggle.getAttribute("aria-expanded") !== "true" : saved === "closed";
    setNavGroupCollapsed(group, shouldCollapse);
    toggle.addEventListener("click", () => {
      const isCollapsed = group.dataset.collapsed === "true";
      setNavGroupCollapsed(group, !isCollapsed, true);
    });
  });
}

function setNavGroupCollapsed(group, collapsed, persist = false) {
  if (!group) return;
  group.dataset.collapsed = collapsed ? "true" : "false";
  const toggle = group.querySelector("[data-nav-group-toggle]");
  const chevron = group.querySelector(".nav-chevron");
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  if (chevron) chevron.textContent = collapsed ? "▸" : "▾";
  if (persist) localStorage.setItem(`the86_nav_group_${group.dataset.navGroup}`, collapsed ? "closed" : "open");
}

function openGroupForView(view) {
  const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  const group = btn?.closest(".nav-group");
  if (group) setNavGroupCollapsed(group, false, true);
  $$(".nav-group").forEach(g => g.classList.toggle("active-group", g === group));
}

function switchView(view) {
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("active-view", v.id === view));
  $("#viewTitle").textContent = viewTitles[view] || "Workspace";
  $("#currentViewEyebrow").textContent = viewTitles[view] || view;
  localStorage.setItem("the86_view", view);
  openGroupForView(view);
}

initNavigation();


const COLLECTION_LABELS = {
  profiles: "Perfil", roles: "Rol", products: "Producto", audit: "Auditoría", competitors: "Competidor", promotion: "Campaña/canal", decisions: "Decisión",
  files: "Recurso Drive", investments: "Inversión", equityPayments: "Abono / compensación", salesEntries: "Venta / dato", adEntries: "Gasto publicitario"
};

const ROLE_OPTIONS = [
  "Pendiente",
  "Dirección de marca",
  "Dirección visual",
  "Diseño conceptual",
  "Producción gráfica / Photoshop",
  "Shopify & experiencia web",
  "Marketing orgánico",
  "Contenido & comunidad",
  "Campañas pagadas",
  "Datos & análisis",
  "Producto & colecciones",
  "Operaciones & archivos",
  "Finanzas & participación"
];

const FIELD_SCHEMAS = {
  profiles: [
    {name:"name", label:"Nombre del perfil", required:true, placeholder:"Christopher / Adrián"},
    {name:"email", label:"Correo del usuario", type:"email", placeholder:"correo@the86club.com"},
    {name:"avatarUrl", label:"Foto o avatar opcional", type:"url", placeholder:"Link de imagen en Drive o recurso público"},
    {name:"primaryRole", label:"Rol principal", type:"select", required:true, options:ROLE_OPTIONS},
    {name:"subRoles", label:"Subroles opcionales", type:"textarea", placeholder:"Escribe subroles separados por coma. Ejemplo: Dirección visual, Producto & colecciones"},
    {name:"weeklyLoadStatus", label:"Estado de carga semanal", type:"select", options:["Sin evaluar","Verde — ritmo sano","Amarillo — atención","Rojo — exceso o desequilibrio"]},
    {name:"notes", label:"Notas, límites y contexto del perfil", type:"textarea", placeholder:"Responsabilidades, límites, acuerdos o riesgos de saturación."}
  ],
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

function openInfoModal({ eyebrow = "Guía", title = "Información", html = "" }) {
  const root = ensureModalRoot();
  root.innerHTML = `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="record-modal info-modal">
        <div class="modal-header">
          <div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div>
          <button class="icon-btn" data-modal-close aria-label="Cerrar">×</button>
        </div>
        <div class="modal-form">
          ${html}
          <div class="modal-actions">
            <button type="button" class="primary-btn" data-modal-close>Entendido</button>
          </div>
        </div>
      </div>
    </div>`;
  root.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", closeModal));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) closeModal(); });
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
  const requiredMark = f.required ? `<b class="required-mark">Requerido</b>` : "";
  const labelBlock = `<div class="field-label-box"><span>${f.label}</span>${requiredMark}</div>`;
  if (f.type === "textarea") {
    return `<label class="field full">${labelBlock}<div class="field-input-box"><textarea name="${f.name}" ${placeholder} ${required}></textarea></div></label>`;
  }
  if (f.type === "select") {
    return `<label class="field">${labelBlock}<div class="field-input-box"><select name="${f.name}" ${required}>${(f.options||[]).map(o=>`<option value="${escapeAttr(o)}">${o}</option>`).join("")}</select></div></label>`;
  }
  return `<label class="field">${labelBlock}<div class="field-input-box"><input name="${f.name}" type="${f.type || "text"}" ${placeholder} ${required}/></div></label>`;
}
function escapeAttr(v) { return String(v || "").replaceAll('"', '&quot;'); }
function escapeHtml(v) { return String(v || "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch])); }
function recordActions(view, id) { return `<div class="small-actions"><button class="soft-btn" data-edit-record="${view}:${id}">Editar</button></div>`; }


function renderAll() {
  if (!currentUser) return;
  renderDashboard();
  renderStages();
  renderProfiles();
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
  const stagesHtml = cache.stages.map(s => {
    const tasks = cache.tasks.filter(t => t.stageId === s.id).sort((a,b)=>(a.order||0)-(b.order||0));
    const progress = stageProgress(s.id);
    const guide = getStageGuide(s);
    const collapsed = isStageCollapsed(s.id);
    const statusLabel = s.status === "active" ? "Activa" : s.status === "planned" ? "Planificada" : (s.status || "Etapa");
    return `
      <article class="stage-card" data-stage-card="${s.id}" data-collapsed="${collapsed ? "true" : "false"}">
        <button class="stage-head" type="button" data-stage-toggle="${s.id}" aria-expanded="${collapsed ? "false" : "true"}">
          <span class="stage-chevron">${collapsed ? "▸" : "▾"}</span>
          <span class="stage-title-block">
            <span class="eyebrow">${statusLabel} · ${guide.area}</span>
            <strong>${s.title}</strong>
            <small>${s.objective || "Etapa de trabajo del proyecto."}</small>
          </span>
          <span class="stage-progress-pill">
            <b>${progress}%</b>
            <small>avance</small>
          </span>
        </button>

        <div class="stage-details">
          <div class="stage-learning-card">
            <div>
              <span class="eyebrow">Lectura guiada</span>
              <h3>Qué estamos aprendiendo aquí</h3>
            </div>
            <p>${guide.lesson}</p>
          </div>

          <div class="stage-meta-grid">
            <div class="stage-info-box">
              <span class="eyebrow">Por qué importa</span>
              <p>${guide.why}</p>
            </div>
            <div class="stage-info-box">
              <span class="eyebrow">Resultado esperado</span>
              <p>${guide.outcome}</p>
            </div>
          </div>

          <div class="stage-progress-area">
            <div class="item-head">
              <strong>Progreso de esta etapa</strong>
              <span class="badge">${progress}%</span>
            </div>
            <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
          </div>

          <div class="stage-task-panel">
            <div class="item-head">
              <div>
                <span class="eyebrow">Tareas principales</span>
                <h3>Ruta de ejecución</h3>
              </div>
              <button class="soft-btn" data-add-task="${s.id}" type="button">Agregar tarea</button>
            </div>
            <p class="stage-note">Cada tarea ahora funciona como una acción guiada: primero entiendes por qué importa, luego completas la acción y el sistema marca el avance con evidencia.</p>
            <div class="stage-task-list">${tasks.map(taskBlock).join("") || emptyState()}</div>
          </div>
        </div>
      </article>`;
  }).join("");

  $("#stages").innerHTML = `
    <div class="stage-page-intro card">
      <span class="eyebrow">Mapa de ejecución</span>
      <h3>Etapas guiadas de The 86 Club</h3>
      <p>Esta página debe funcionar como ruta de aprendizaje y avance. Cada etapa se abre solo cuando necesitas trabajarla, muestra por qué existe y conecta tareas con crecimiento real del negocio.</p>
      <div class="toolbar"><button class="primary-btn" id="addStageBtn">Agregar etapa</button></div>
    </div>
    <div class="stage-list">${stagesHtml}</div>`;

  $("#addStageBtn")?.addEventListener("click", addStage);
  $$(`[data-stage-toggle]`).forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.stageToggle;
    const card = document.querySelector(`[data-stage-card="${id}"]`);
    const collapsed = card?.dataset.collapsed !== "true";
    setStageCollapsed(id, collapsed);
    if (card) {
      card.dataset.collapsed = collapsed ? "true" : "false";
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const chev = card.querySelector(".stage-chevron");
      if (chev) chev.textContent = collapsed ? "▸" : "▾";
    }
  }));
  $$(`[data-add-task]`).forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); addTask(b.dataset.addTask); }));
  $$(`[data-task-action]`).forEach(btn => btn.addEventListener("click", () => openGuidedTaskAction(btn.dataset.taskAction, Number(btn.dataset.subtaskIndex))));
  $$(`[data-task-importance]`).forEach(btn => btn.addEventListener("click", () => openTaskImportance(btn.dataset.taskImportance, btn.dataset.subtaskIndex !== undefined ? Number(btn.dataset.subtaskIndex) : null)));
  $$(`[data-task-reopen]`).forEach(btn => btn.addEventListener("click", () => reopenGuidedSubtask(btn.dataset.taskReopen, Number(btn.dataset.subtaskIndex))));
  $$(`[data-module]`).forEach(b => b.addEventListener("click", () => switchView(b.dataset.module)));
}

function taskBlock(t) {
  const subtasks = (t.subtasks && t.subtasks.length) ? t.subtasks : [{ title: t.title, done: t.status === "done" }];
  const doneCount = subtasks.filter(s => s.done).length;
  const statusLabel = subtasks.length && doneCount === subtasks.length ? "completada" : doneCount ? "en progreso" : "pendiente";
  return `
    <div class="guided-task-card" data-task="${t.id}">
      <div class="guided-task-head">
        <div>
          <span class="eyebrow">Tarea guiada</span>
          <strong>${t.title}</strong>
          <small>${doneCount}/${subtasks.length} acciones completadas</small>
        </div>
        <span class="badge">${statusLabel}</span>
      </div>
      <div class="guided-subtask-list">
        ${subtasks.map((subtask,i)=>guidedSubtaskHtml(t, subtask, i)).join("")}
      </div>
      <div class="small-actions task-shortcuts">
        <button class="soft-btn" data-task-importance="${t.id}" type="button">Importancia de la tarea</button>
        <button class="soft-btn" data-module="files" type="button">Archivos</button>
        <button class="soft-btn" data-module="decisions" type="button">Decisiones</button>
        <button class="soft-btn" data-module="stats" type="button">Estadísticas</button>
      </div>
    </div>`;
}

function guidedSubtaskHtml(task, subtask, index) {
  const done = Boolean(subtask.done);
  const actionText = done ? "Actualizar evidencia" : "Hacer acción";
  return `
    <div class="guided-subtask" data-done="${done ? "true" : "false"}">
      <div class="subtask-status-dot" aria-hidden="true">${done ? "✓" : ""}</div>
      <div class="subtask-main">
        <strong>${subtask.title}</strong>
        <small>${done ? "Guardado en el sistema" : "Pendiente de acción real"}</small>
        ${subtask.actionSummary ? `<p>${formatValue(subtask.actionSummary)}</p>` : ""}
      </div>
      <div class="subtask-actions">
        <button class="primary-btn" data-task-action="${task.id}" data-subtask-index="${index}" type="button">${actionText}</button>
        <button class="soft-btn" data-task-importance="${task.id}" data-subtask-index="${index}" type="button">Importancia</button>
        ${done ? `<button class="soft-btn" data-task-reopen="${task.id}" data-subtask-index="${index}" type="button">Reabrir</button>` : ""}
      </div>
    </div>`;
}

function getTaskById(taskId) {
  return cache.tasks.find(t => t.id === taskId);
}

function importanceTextFor(task, subtaskTitle) {
  const title = `${task?.title || ""} ${subtaskTitle || ""}`.toLowerCase();
  if (/perfil|usuario|correo|christopher|adrián|adrian/.test(title)) {
    return {
      focus: "Crear perfiles reales convierte el workspace en una herramienta de dirección, no en una libreta anónima.",
      why: "El negocio necesita saber quién ejecuta, quién revisa y quién está cargando demasiadas responsabilidades. Sin perfiles, las tareas quedan sueltas y después no se puede medir evolución semanal ni carga por persona.",
      avoids: "Evita confusión de responsabilidades, pérdida de seguimiento y decisiones hechas desde impulso porque nadie sabe exactamente qué le toca a quién.",
      business: "Con perfiles claros, el sistema podrá conectar roles, tareas, actividad y recomendaciones para que The 86 Club avance con orden y venda desde una operación más sana."
    };
  }
  if (/rol|responsabilidad|fortaleza|evitar/.test(title)) {
    return {
      focus: "Asignar roles evita que el equipo trabaje como incendio creativo permanente.",
      why: "En un negocio pequeño todos pueden ayudar, pero cada persona necesita un centro de responsabilidad. El rol principal define qué cuida esa persona y los subroles limitan dónde puede apoyar sin saturarse.",
      avoids: "Evita duplicar trabajo, mezclar decisiones comerciales con impulsos visuales y gastar energía en áreas que no empujan ventas.",
      business: "Cuando los roles están claros, el dashboard puede detectar exceso creativo, falta de marketing, baja operación o mala distribución de carga."
    };
  }
  if (/flujo|revisión|publicación|decisión|idea|diseño|retoque/.test(title)) {
    return {
      focus: "Definir flujo de trabajo convierte ideas en piezas publicables sin perder control.",
      why: "Una idea no debería saltar directo a publicación. Necesita pasar por concepto, producción, revisión, ajuste y registro para que el arte sirva a la marca y no solo al impulso del momento.",
      avoids: "Evita cambios infinitos, discusiones confusas, diseños sueltos y cansancio por rehacer trabajo que nunca tuvo criterio de aprobación.",
      business: "Un flujo claro permite producir menos piezas, pero mejores, más coherentes y más fáciles de convertir en campañas, productos y contenido."
    };
  }
  if (/producto|precio|margen|colecci|hero|support|conversion/.test(title)) {
    return {
      focus: "Ordenar productos permite vender con intención, no solo acumular diseños.",
      why: "Cada producto debe tener función: atraer, sostener colección o convertir. Si todo se trata igual, no sabes qué promover ni qué medir.",
      avoids: "Evita una tienda llena de piezas sin jerarquía, márgenes poco claros y campañas que empujan productos equivocados.",
      business: "Clasificar producto conecta diseño con precio, margen, promoción y análisis de ventas."
    };
  }
  if (/marketing|promoci|campaña|canal|instagram|email|etsy|contenido/.test(title)) {
    return {
      focus: "La promoción debe ser sistema, no publicación nerviosa.",
      why: "Un negocio POD necesita visibilidad constante, pero cada canal debe tener objetivo, mensaje, responsable y señal de resultado.",
      avoids: "Evita publicar mucho sin aprender nada, gastar energía en canales débiles o abandonar canales que sí podrían vender con mejor estructura.",
      business: "Esta tarea conecta contenido, campaña, producto y medición para que la promoción empuje ventas reales."
    };
  }
  if (/venta|ads|invers|capital|abono|shopify|meta|finanza|participación/.test(title)) {
    return {
      focus: "Los números protegen al negocio de avanzar a ciegas.",
      why: "Inversión, ventas, ads y participación deben verse juntos para saber si el proyecto está aprendiendo, recuperando o solo gastando.",
      avoids: "Evita discusiones por aportes, gasto publicitario sin control y decisiones basadas solo en emoción.",
      business: "Con datos financieros básicos, el workspace puede mostrar balance, participación estimada y señales de ajuste."
    };
  }
  return {
    focus: "Esta acción existe para convertir intención en avance registrado.",
    why: "Una tarea sin evidencia se olvida fácil. Guardar el resultado permite que el sistema mida progreso, actualice etapas y construya historial semanal más adelante.",
    avoids: "Evita checks decorativos, trabajo invisible y pérdida de aprendizaje.",
    business: "Cada acción completada debe acercar The 86 Club a operar mejor, comunicar mejor o vender con más claridad."
  };
}

function openTaskImportance(taskId, subtaskIndex = null) {
  const task = getTaskById(taskId);
  if (!task) return;
  const subtask = subtaskIndex !== null ? (task.subtasks || [])[subtaskIndex] : null;
  const info = importanceTextFor(task, subtask?.title);
  openInfoModal({
    eyebrow: subtask ? "Importancia de la acción" : "Importancia de la tarea",
    title: subtask ? subtask.title : task.title,
    html: `
      <div class="learning-stack">
        <div class="learning-box"><span class="eyebrow">Enfoque</span><p>${info.focus}</p></div>
        <div class="learning-box"><span class="eyebrow">Por qué importa</span><p>${info.why}</p></div>
        <div class="learning-box"><span class="eyebrow">Qué evita</span><p>${info.avoids}</p></div>
        <div class="learning-box"><span class="eyebrow">Cómo ayuda al negocio</span><p>${info.business}</p></div>
      </div>`
  });
}

async function openGuidedTaskAction(taskId, subtaskIndex) {
  const task = getTaskById(taskId);
  if (!task) return;
  const subtasks = [...(task.subtasks || [{ title: task.title, done: task.status === "done" }])];
  const subtask = subtasks[subtaskIndex];
  if (!subtask) return;
  const result = await openRecordModal({
    title: subtask.done ? `Actualizar acción: ${subtask.title}` : `Completar acción: ${subtask.title}`,
    collectionName: task.title,
    schema: [
      {name:"actionSummary", label:"Resultado de la acción", required:true, type:"textarea", placeholder:"Escribe qué quedó definido, creado, revisado o decidido."},
      {name:"evidenceUrl", label:"Evidencia o link opcional", type:"url", placeholder:"Link de Drive, Shopify, documento, captura o recurso relacionado."},
      {name:"nextStep", label:"Siguiente paso recomendado", placeholder:"Qué debería pasar después de esta acción."},
      {name:"notes", label:"Notas internas", type:"textarea", placeholder:"Contexto, dudas, riesgos o comentarios importantes."}
    ],
    initial: {
      actionSummary: subtask.actionSummary || "",
      evidenceUrl: subtask.evidenceUrl || "",
      nextStep: subtask.nextStep || "",
      notes: subtask.notes || ""
    },
    onSave: async (data) => {
      subtasks[subtaskIndex] = {
        ...subtask,
        ...data,
        done: true,
        completedAt: new Date().toISOString(),
        completedBy: currentUser?.email || "usuario"
      };
      const status = subtasks.every(s => s.done) ? "done" : "in_progress";
      await updateDoc(workspaceDoc("tasks", task.id), { subtasks, status, updatedAt: serverTimestamp() });
      await logActivity("complete_guided_task", "stages", `Completó acción: ${subtask.title} en ${task.title}`);
    }
  });
  return result;
}

async function reopenGuidedSubtask(taskId, subtaskIndex) {
  const task = getTaskById(taskId);
  if (!task) return;
  const subtasks = [...(task.subtasks || [])];
  const subtask = subtasks[subtaskIndex];
  if (!subtask) return;
  subtasks[subtaskIndex] = { ...subtask, done: false, reopenedAt: new Date().toISOString(), reopenedBy: currentUser?.email || "usuario" };
  const status = subtasks.some(s => s.done) ? "in_progress" : "pending";
  await updateDoc(workspaceDoc("tasks", task.id), { subtasks, status, updatedAt: serverTimestamp() });
  await logActivity("reopen_guided_task", "stages", `Reabrió acción: ${subtask.title} en ${task.title}`);
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


function profileStatusClass(status = "") {
  const s = String(status).toLowerCase();
  if (s.includes("rojo")) return "status-red";
  if (s.includes("amarillo")) return "status-yellow";
  if (s.includes("verde")) return "status-green";
  return "status-neutral";
}

function renderProfiles() {
  const container = $("#profiles");
  if (!container) return;
  const profiles = cache.profiles || [];
  const list = profiles.length ? profiles.map(p => {
    const availability = normalizeAvailability(p.availability);
    const avStats = availabilityStats(p.availability);
    const avatar = p.avatarUrl
      ? `<div class="profile-avatar image-avatar"><img src="${escapeAttr(p.avatarUrl)}" alt="Avatar de ${escapeAttr(p.name || "perfil")}" /></div>`
      : `<div class="profile-avatar">${String(p.name || "?").trim().slice(0,1).toUpperCase()}</div>`;
    const dayChips = WEEK_DAYS.map(d => {
      const mode = availability.days[d.key]?.mode || "external_plus_business";
      return `<span class="availability-day ${dayStateClass(mode)}"><b>${d.label.slice(0,3)}</b><small>${dayModeLabel(mode)}</small></span>`;
    }).join("");
    return `<article class="profile-card">
      <div class="profile-top">
        ${avatar}
        <div>
          <span class="eyebrow">Perfil de equipo</span>
          <h3>${p.name || "Perfil sin nombre"}</h3>
          <p>${p.email || "Correo pendiente"}</p>
        </div>
        <span class="status-pill ${avStats.className}">${avStats.status}</span>
      </div>
      <div class="profile-detail-grid">
        <div><span>Rol principal</span><strong>${p.primaryRole || "Pendiente"}</strong></div>
        <div><span>Subroles</span><strong>${p.subRoles || "Pendientes"}</strong></div>
      </div>
      <div class="availability-summary">
        <div class="availability-head">
          <div><span class="eyebrow">Disponibilidad semanal</span><strong>Cierre: ${dayLabel(avStats.closeDay)}</strong></div>
          <span class="badge">Máx. ${avStats.maxHours || 3} h/día</span>
        </div>
        <div class="availability-metrics">
          <span><b>${avStats.available}</b> días disponibles</span>
          <span><b>${avStats.light}</b> días ligeros</span>
          <span><b>${avStats.protectedDays}</b> días protegidos</span>
        </div>
        <div class="availability-days">${dayChips}</div>
      </div>
      ${renderWeeklyCalendar(p)}
      <p class="profile-notes">${p.notes || "Sin notas todavía. Este espacio debe usarse para límites, responsabilidades y contexto de trabajo."}</p>
      <div class="small-actions">
        <button class="soft-btn" data-edit-profile="${p.id}">Editar perfil</button>
        <button class="soft-btn" data-edit-availability="${p.id}">Disponibilidad semanal</button>
        <button class="soft-btn" data-profile-info="${p.id}">¿Por qué importa?</button>
      </div>
    </article>`;
  }).join("") : emptyState();

  container.innerHTML = `
    <div class="notice learning-notice"><strong>Perfiles no son contactos:</strong> son centros de responsabilidad. Aquí se define quién participa en The 86 Club, qué debe cuidar, qué disponibilidad real tiene y qué límites necesita para no desequilibrar el negocio.</div>
    <div class="availability-intro card">
      <span class="eyebrow">Nueva base de planificación</span>
      <h3>Disponibilidad semanal antes de tareas</h3>
      <p>Antes de asignar roles y tareas, el sistema necesita saber cuándo puede trabajar cada persona, qué días deben protegerse y cuántas horas diarias son sanas para avanzar sin convertir el negocio en una segunda jornada completa.</p>
    </div>
    <div class="toolbar"><button class="primary-btn" id="addProfile">Agregar perfil</button></div>
    <div class="profile-grid">${list}</div>`;

  $("#addProfile")?.addEventListener("click", addProfile);
  $$(`[data-edit-profile]`).forEach(btn => btn.addEventListener("click", () => editProfile(btn.dataset.editProfile)));
  $$(`[data-edit-availability]`).forEach(btn => btn.addEventListener("click", () => editAvailability(btn.dataset.editAvailability)));
  $$(`[data-profile-info]`).forEach(btn => btn.addEventListener("click", () => openProfileImportance(btn.dataset.profileInfo)));
  $$(`[data-calendar-help]`).forEach(btn => btn.addEventListener("click", () => openCalendarHelp(btn.dataset.calendarHelp)));
  $$(`[data-add-weekly-task]`).forEach(btn => btn.addEventListener("click", () => {
    const [profileId, dayKey] = btn.dataset.addWeeklyTask.split(":");
    addWeeklyTask(profileId, dayKey);
  }));
  $$(`[data-move-weekly-task]`).forEach(btn => btn.addEventListener("click", () => moveWeeklyTask(btn.dataset.moveWeeklyTask)));
  $$(`[data-toggle-weekly-task]`).forEach(btn => btn.addEventListener("click", () => toggleWeeklyTask(btn.dataset.toggleWeeklyTask)));
}

function dayLabel(key) {
  return WEEK_DAYS.find(d => d.key === key)?.label || "Domingo";
}


async function addProfile() {
  await openRecordModal({
    title: "Agregar perfil de equipo",
    collectionName: "Perfil",
    schema: FIELD_SCHEMAS.profiles,
    onSave: async (data) => {
      await addDoc(workspaceCol("profiles"), { ...data, createdBy: currentUser.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await logActivity("create_profile", "profiles", `Creó perfil de equipo: ${data.name}`);
    }
  });
}

async function editProfile(id) {
  const profile = (cache.profiles || []).find(x => x.id === id);
  if (!profile) return;
  await openRecordModal({
    title: `Editar perfil: ${profile.name || "equipo"}`,
    collectionName: "Perfil",
    schema: FIELD_SCHEMAS.profiles,
    initial: profile,
    onSave: async (data) => {
      await updateDoc(workspaceDoc("profiles", id), { ...data, updatedAt: serverTimestamp() });
      await logActivity("edit_profile", "profiles", `Actualizó perfil de equipo: ${data.name || profile.name}`);
    }
  });
}

async function editAvailability(id) {
  const profile = (cache.profiles || []).find(x => x.id === id);
  if (!profile) return;
  const root = ensureModalRoot();
  const availability = normalizeAvailability(profile.availability);
  root.innerHTML = `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="record-modal availability-modal">
        <div class="modal-header">
          <div><span class="eyebrow">Disponibilidad semanal</span><h2>${profile.name || "Perfil"}</h2></div>
          <button class="icon-btn" data-modal-close aria-label="Cerrar">×</button>
        </div>
        <form id="availabilityForm" class="modal-form">
          <div class="learning-box availability-why">
            <span class="eyebrow">Por qué importa esta configuración</span>
            <p>Esta base evita planificar como si The 86 Club fuera un empleo de tiempo completo. Primero se protege la vida real: trabajo externo, descanso, energía disponible y un máximo sano de horas. Después los roles podrán generar tareas sin saturar a Christopher ni a Adrián.</p>
          </div>
          <div class="form-grid">
            <label class="field">
              <div class="field-label-box"><span>Máximo recomendado diario</span><b class="required-mark">Base 3 h</b></div>
              <div class="field-input-box"><input name="maxDailyBusinessHours" type="number" min="0" step="0.5" value="${escapeAttr(availability.maxDailyBusinessHours)}" /></div>
            </label>
            <label class="field">
              <div class="field-label-box"><span>Día de cierre semanal</span><b class="required-mark">Requerido</b></div>
              <div class="field-input-box"><select name="weeklyCloseDay">${WEEK_DAYS.map(d => `<option value="${d.key}" ${availability.weeklyCloseDay === d.key ? "selected" : ""}>${d.label}</option>`).join("")}</select></div>
            </label>
          </div>
          <div class="availability-editor">
            ${WEEK_DAYS.map(d => {
              const day = availability.days[d.key] || {};
              return `<div class="availability-row">
                <div class="availability-row-title"><strong>${d.label}</strong><small>Define cómo debe tratar el sistema este día.</small></div>
                <select name="day_${d.key}_mode">${DAY_MODE_OPTIONS.map(o => `<option value="${o.value}" ${day.mode === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>
                <input name="day_${d.key}_hours" type="number" min="0" step="0.5" placeholder="Horas opcionales" value="${escapeAttr(day.customHours || "")}" />
              </div>`;
            }).join("")}
          </div>
          <label class="field full">
            <div class="field-label-box"><span>Notas de disponibilidad</span></div>
            <div class="field-input-box"><textarea name="notes" placeholder="Ejemplo: esta semana tengo turno pesado, dejar sábado como descanso real.">${availability.notes || ""}</textarea></div>
          </label>
          <div class="modal-actions">
            <button type="button" class="soft-btn" data-modal-close>Cancelar</button>
            <button type="submit" class="primary-btn">Guardar disponibilidad</button>
          </div>
        </form>
      </div>
    </div>`;
  root.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", closeModal));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) closeModal(); });
  root.querySelector("#availabilityForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const next = {
      weeklyCloseDay: form.elements.weeklyCloseDay.value,
      maxDailyBusinessHours: Number(form.elements.maxDailyBusinessHours.value || 3),
      notes: form.elements.notes.value.trim(),
      days: {}
    };
    WEEK_DAYS.forEach(d => {
      next.days[d.key] = {
        mode: form.elements[`day_${d.key}_mode`].value,
        customHours: form.elements[`day_${d.key}_hours`].value
      };
    });
    const stats = availabilityStats(next);
    await updateDoc(workspaceDoc("profiles", id), { availability: next, weeklyLoadStatus: stats.status, updatedAt: serverTimestamp() });
    await logActivity("edit_availability", "profiles", `Actualizó disponibilidad semanal de ${profile.name || "perfil"}`);
    closeModal();
  });
}


function openCalendarHelp(id) {
  const profile = (cache.profiles || []).find(x => x.id === id);
  openInfoModal({
    eyebrow: "Guía del calendario semanal",
    title: profile?.name ? `Calendario de ${profile.name}` : "Calendario semanal",
    html: `<div class="learning-stack">
      <div class="learning-box"><span class="eyebrow">Para qué existe</span><p>Este calendario convierte disponibilidad en días reales de ejecución. Todavía no asigna roles automáticamente, pero ya prepara dónde caerán las tareas del negocio.</p></div>
      <div class="learning-box"><span class="eyebrow">Cómo leer los días</span><p>Disponible recibe tareas normales. Ligero recibe revisión, notas o planificación suave. Protegido debería quedar libre, salvo decisión manual. Trabajo externo reduce la capacidad recomendada.</p></div>
      <div class="learning-box"><span class="eyebrow">Cierre semanal</span><p>El día marcado como cierre será usado más adelante para revisar avance, impacto, carga y disponibilidad de la próxima semana.</p></div>
      <div class="learning-box"><span class="eyebrow">Tareas manuales</span><p>Sirven para probar el calendario antes de conectar roles. Luego el sistema generará tareas desde roles, duración, intensidad y objetivos.</p></div>
    </div>`
  });
}

async function addWeeklyTask(profileId, dayKey) {
  const profile = (cache.profiles || []).find(x => x.id === profileId);
  if (!profile) return;
  await openRecordModal({
    title: `Agregar tarea manual — ${dayLabel(dayKey)}`,
    collectionName: "Calendario semanal",
    schema: [
      { name: "title", label: "Título de la tarea", required: true },
      { name: "description", label: "Descripción breve", type: "textarea" },
      { name: "estimatedMinutes", label: "Duración estimada en minutos", type: "number" },
      { name: "intensity", label: "Intensidad", type: "select", options: ["low", "medium", "high"] },
      { name: "notes", label: "Notas", type: "textarea" }
    ],
    onSave: async (data) => {
      const payload = {
        profileId,
        profileName: profile.name || "Perfil",
        title: data.title,
        description: data.description || "",
        assignedDay: dayKey,
        estimatedMinutes: Number(data.estimatedMinutes || 30),
        intensity: data.intensity || "medium",
        status: "pending",
        notes: data.notes || "",
        source: "manual",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser.email,
        updatedBy: currentUser.email
      };
      await addDoc(workspaceCol("profileWeeklyTasks"), payload);
      await logActivity("create_weekly_task", "profiles", `Agregó tarea manual para ${profile.name || "perfil"}: ${data.title}`);
    }
  });
}

async function moveWeeklyTask(taskId) {
  const task = (cache.profileWeeklyTasks || []).find(x => x.id === taskId);
  if (!task) return;
  const profile = (cache.profiles || []).find(x => x.id === task.profileId);
  await openRecordModal({
    title: `Mover tarea: ${task.title || "tarea"}`,
    collectionName: "Calendario semanal",
    schema: [
      { name: "assignedDay", label: "Nuevo día", type: "select", options: WEEK_DAYS.map(d => d.key) }
    ],
    initial: { id: task.id, assignedDay: task.assignedDay },
    onSave: async (data) => {
      await updateDoc(workspaceDoc("profileWeeklyTasks", taskId), { assignedDay: data.assignedDay, updatedAt: serverTimestamp(), updatedBy: currentUser.email });
      await logActivity("move_weekly_task", "profiles", `Movió tarea de ${profile?.name || "perfil"} a ${dayLabel(data.assignedDay)}: ${task.title}`);
    }
  });
}

async function toggleWeeklyTask(taskId) {
  const task = (cache.profileWeeklyTasks || []).find(x => x.id === taskId);
  if (!task) return;
  const nextStatus = task.status === "completed" ? "pending" : "completed";
  await updateDoc(workspaceDoc("profileWeeklyTasks", taskId), { status: nextStatus, updatedAt: serverTimestamp(), updatedBy: currentUser.email, completedAt: nextStatus === "completed" ? serverTimestamp() : null });
  await logActivity(nextStatus === "completed" ? "complete_weekly_task" : "reopen_weekly_task", "profiles", `${nextStatus === "completed" ? "Completó" : "Reabrió"} tarea semanal: ${task.title}`);
}

function openProfileImportance(id) {
  const profile = (cache.profiles || []).find(x => x.id === id);
  openInfoModal({
    eyebrow: "Importancia del perfil",
    title: profile?.name ? `Perfil de ${profile.name}` : "Perfil de equipo",
    html: `<div class="learning-stack">
      <div class="learning-box"><span class="eyebrow">Para qué existe</span><p>El perfil convierte a una persona en una pieza visible del sistema. No solo guarda nombre y correo: define qué responsabilidad cuida, qué rol principal sostiene y qué carga semanal debe vigilarse.</p></div>
      <div class="learning-box"><span class="eyebrow">Qué evita</span><p>Evita trabajo invisible, decisiones duplicadas, saturación creativa y confusión entre ayudar en muchas cosas y cargar con demasiadas cosas.</p></div>
      <div class="learning-box"><span class="eyebrow">Cómo ayuda a vender</span><p>Cuando el equipo sabe quién cuida marca, producto, tienda, promoción y números, el negocio deja de depender de impulsos. El sistema podrá conectar tareas, actividad y resultados con cada persona.</p></div>
      <div class="learning-box"><span class="eyebrow">Disponibilidad semanal</span><p>Antes de asignar tareas por rol, el perfil debe declarar cuándo puede trabajar, qué días protege para descansar y cuál es su máximo sano de horas. Así el sistema planifica con vida real, no con fantasía de productividad.</p></div><div class="learning-box"><span class="eyebrow">Siguiente paso</span><p>Después conectaremos estos perfiles con roles predefinidos, tareas por día, riesgo de saturación y cierre semanal.</p></div>
    </div>`
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

import { auth, db, WORKSPACE_ID } from "./firebase.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
  investments: [], equityPayments: [], salesEntries: [], adEntries: [], channelMetrics: [], profileWeeklyTasks: [], profileNextWeekPlans: []
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

const INTENSITY_WEIGHT = { low: 1, medium: 1.2, high: 1.5 };
const DAY_CAPACITY_FACTOR = {
  business_available: 1,
  external_plus_business: 0.65,
  external_only: 0.25,
  light: 0.4,
  protected: 0
};

function taskMinutes(task = {}) {
  const raw = Number(task.estimatedMinutes);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

function taskWeight(task = {}) {
  return INTENSITY_WEIGHT[task.intensity || "medium"] || INTENSITY_WEIGHT.medium;
}

function weightedTaskMinutes(task = {}) {
  return Math.round(taskMinutes(task) * taskWeight(task));
}

function dayCapacityMinutes(availability, dayKey) {
  const av = normalizeAvailability(availability);
  const day = av.days[dayKey] || {};
  const baseHours = Number(day.customHours || av.maxDailyBusinessHours || 3);
  const baseMinutes = Math.max(0, baseHours * 60);
  const factor = DAY_CAPACITY_FACTOR[day.mode || "external_plus_business"] ?? 0.65;
  return Math.round(baseMinutes * factor);
}

function workloadStatus(percent, mode, taskCount) {
  if (mode === "protected" && taskCount > 0) {
    return { key: "saturated", label: "Saturado", phrase: "Descanso invadido, conviene mover tareas." };
  }
  if (percent <= 45) return { key: "healthy", label: "Sano", phrase: "Carga sana." };
  if (percent <= 70) return { key: "moderate", label: "Moderado", phrase: "Día cargado, pero manejable." };
  if (percent <= 90) return { key: "high", label: "Alto", phrase: "Riesgo alto, revisa la distribución." };
  return { key: "saturated", label: "Saturado", phrase: "Saturado, conviene mover tareas." };
}

function dayWorkload(profile, dayKey, tasks) {
  const availability = normalizeAvailability(profile.availability);
  const mode = availability.days[dayKey]?.mode || "external_plus_business";
  const dayTasks = tasks.filter(t => t.assignedDay === dayKey);
  const plannedMinutes = dayTasks.reduce((sum, task) => sum + taskMinutes(task), 0);
  const weightedMinutes = dayTasks.reduce((sum, task) => sum + weightedTaskMinutes(task), 0);
  const capacity = dayCapacityMinutes(profile.availability, dayKey);
  let percent = capacity > 0 ? Math.round((weightedMinutes / capacity) * 100) : (weightedMinutes > 0 ? 100 : 0);
  if (mode === "protected" && dayTasks.length > 0) percent = Math.max(percent, 100);
  const status = workloadStatus(percent, mode, dayTasks.length);
  return { mode, dayTasks, plannedMinutes, weightedMinutes, capacity, percent, status };
}

function weeklyWorkloadReport(profile, tasks) {
  const days = WEEK_DAYS.map(day => ({ ...day, workload: dayWorkload(profile, day.key, tasks) }));
  const totalPlanned = days.reduce((sum, day) => sum + day.workload.plannedMinutes, 0);
  const totalWeighted = days.reduce((sum, day) => sum + day.workload.weightedMinutes, 0);
  const workableDays = days.filter(day => day.workload.capacity > 0);
  const average = workableDays.length ? Math.round(workableDays.reduce((sum, day) => sum + day.workload.percent, 0) / workableDays.length) : 0;
  const saturatedDays = days.filter(day => day.workload.status.key === "saturated").length;
  const protectedWithTasks = days.filter(day => day.workload.mode === "protected" && day.workload.dayTasks.length).length;
  const highest = days.reduce((max, day) => day.workload.percent > max.workload.percent ? day : max, days[0]);
  const recommendation = workloadRecommendation(days, average, saturatedDays, protectedWithTasks);
  const moveSuggestion = workloadMoveSuggestion(days);
  return { days, totalPlanned, totalWeighted, average, saturatedDays, protectedWithTasks, highest, recommendation, moveSuggestion };
}

function workloadRecommendation(days, average, saturatedDays, protectedWithTasks) {
  if (protectedWithTasks > 0) return "Hay tareas en días protegidos. Considera moverlas para cuidar descanso real.";
  if (saturatedDays > 0) {
    const names = days.filter(d => d.workload.status.key === "saturated").map(d => d.label).join(", ");
    return `Hay saturación en ${names}. Conviene mover o reducir tareas.`;
  }
  if (average > 70) return "La semana está cargada. Mantén foco y evita agregar tareas creativas extra.";
  if (average > 45) return "Hay carga moderada. La semana parece manejable si respetas los bloques.";
  return "La semana está equilibrada. Hay espacio para avanzar sin invadir descanso.";
}

function workloadMoveSuggestion(days) {
  const heavy = [...days]
    .filter(d => d.workload.dayTasks.length && d.workload.percent > 70)
    .sort((a, b) => b.workload.percent - a.workload.percent)[0];
  if (!heavy) return "";
  const light = [...days]
    .filter(d => d.key !== heavy.key && d.workload.mode !== "protected" && d.workload.percent < 45)
    .sort((a, b) => a.workload.percent - b.workload.percent)[0];
  if (!light) return "No hay un día liviano claro para mover tareas; considera reducir alcance.";
  return `Podrías mover una tarea de ${heavy.label} a ${light.label}, que está más liviano.`;
}

function workloadPercentLabel(percent) {
  return percent > 100 ? "100%+" : `${percent}%`;
}


function workloadClassFromPercent(percent, hasData = true) {
  if (!hasData) return "neutral";
  return percent > 90 ? "saturated" : percent > 70 ? "high" : percent > 45 ? "moderate" : "healthy";
}

function loadShortStatus(percent, hasData = true) {
  if (!hasData) return "SIN DATOS";
  if (percent > 90) return "SAT";
  if (percent > 70) return "ALT";
  if (percent > 45) return "MOD";
  return "SAN";
}

function toneFromAvailability(profile, summary = {}, stats = {}) {
  const configured = Boolean(profile?.availability?.days);
  if (!configured) return "neutral";
  if ((summary.protectedDays || 0) === 0 || Number(summary.maxHours || 3) > 4) return "high";
  if ((summary.available || 0) + (summary.light || 0) >= 6) return "moderate";
  return "healthy";
}

function toneFromWorkload(workload = {}) {
  const hasData = Boolean((workload.totalPlanned || 0) > 0 || (workload.totalWeighted || 0) > 0);
  if (!hasData) return "neutral";
  if ((workload.protectedWithTasks || 0) > 0) return "saturated";
  if ((workload.saturatedDays || 0) > 0) return "saturated";
  return workloadClassFromPercent(workload.average || 0, true);
}

function toneFromPreclose(report = {}) {
  const hasData = Boolean((report.totalTasks || 0) > 0 || (report.totalPlanned || 0) > 0);
  if (!hasData) return "neutral";
  if ((report.protectedWithTasks || 0) > 0 || (report.saturatedDays || 0) > 0) return "saturated";
  if ((report.daysToClose || 0) <= 2 && (report.pendingRatio || 0) > 50) return "high";
  if ((report.progressPercent || 0) < 31 && (report.totalTasks || 0) > 0) return "moderate";
  return workloadClassFromPercent(report.workloadAverage || 0, true);
}

function metricMiniBar(label, value, max = 100, detail = "", tone = "healthy") {
  const safeMax = Math.max(1, Number(max || 1));
  const numeric = Number(String(value).replace(/[^0-9.]/g, ""));
  const raw = Number.isFinite(numeric) ? numeric : 0;
  const width = tone === "neutral" ? 0 : Math.max(0, Math.min(100, Math.round((raw / safeMax) * 100)));
  return `<div class="mini-metric-row metric-${tone}">
    <div class="mini-metric-label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>
    <div class="mini-metric-track"><i style="width:${width}%"></i></div>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  </div>`;
}

function availabilityDistributionCard(profile, summary, avStats) {
  const tone = toneFromAvailability(profile, summary, avStats);
  const configured = tone !== "neutral";
  const totalDays = Math.max(1, summary.available + summary.light + summary.protectedDays + (avStats.external || 0));
  const segments = [
    { key: "available", label: "Disponibles", value: configured ? summary.available : 0, abbr: "DIS" },
    { key: "light", label: "Ligeros", value: configured ? summary.light : 0, abbr: "LIG" },
    { key: "protected", label: "Protegidos", value: configured ? summary.protectedDays : 0, abbr: "PRO" },
    { key: "external", label: "Trabajo externo", value: configured ? (avStats.external || 0) : 0, abbr: "EXT" }
  ];
  return `<button class="graph-card availability-graph-card graph-${tone}" data-availability-graph="${profile.id}" type="button" aria-label="Ver distribución de días de ${escapeAttr(profile.name || "perfil")}">
    <div class="graph-card-head">
      <div><span class="eyebrow">Distribución de días</span><strong>${configured ? dayLabel(summary.closeDay) : "Sin datos"}</strong><small>${configured ? `Cierre semanal · máx. ${summary.maxHours || 3} h/día` : "Configura disponibilidad para activar color"}</small></div>
      <span class="graph-open-pill">Ver detalle</span>
    </div>
    <div class="stacked-day-bar state-bar state-${tone}">
      ${segments.map(seg => `<i class="seg-${seg.key}" style="width:${configured ? Math.max(0, Math.round((seg.value / totalDays) * 100)) : 0}%" title="${escapeAttr(seg.label)}: ${seg.value}"></i>`).join("")}
    </div>
    <div class="compact-stat-grid">
      ${segments.slice(0,3).map(seg => `<span><b>${seg.abbr}</b><strong>${seg.value}</strong></span>`).join("")}
      <span><b>TAR</b><strong>${summary.taskCount || 0}</strong></span>
    </div>
  </button>`;
}

function workloadGraphCard(profile, workload) {
  const cls = toneFromWorkload(workload);
  const hasData = cls !== "neutral";
  return `<button class="graph-card workload-graph-card workload-${cls} graph-${cls}" data-workload-graph="${profile.id}" type="button" aria-label="Ver carga semanal de ${escapeAttr(profile.name || "perfil")}">
    <div class="graph-card-head">
      <div><span class="eyebrow">Carga semanal visual</span><strong>CPS ${hasData ? workloadPercentLabel(workload.average) : "S/D"}</strong><small>${loadShortStatus(workload.average, hasData)} · toca para ver estadística completa</small></div>
      <span class="graph-open-pill">Abrir gráfica</span>
    </div>
    <div class="big-load-bar state-bar state-${cls}"><i style="width:${hasData ? Math.min(workload.average, 100) : 0}%"></i></div>
    <div class="compact-stat-grid compact-stat-grid-five">
      <span><b>CPS</b><strong>${workloadPercentLabel(workload.average)}</strong></span>
      <span><b>DMC</b><strong>${workload.highest?.label?.slice(0,3) || "N/A"}</strong></span>
      <span><b>SAT</b><strong>${workload.saturatedDays}</strong></span>
      <span><b>DES</b><strong>${workload.protectedWithTasks}</strong></span>
      <span><b>TPL</b><strong>${workload.totalPlanned}m</strong></span>
    </div>
  </button>`;
}

function precloseGraphCard(profile, report) {
  const loadCls = toneFromPreclose(report);
  const hasData = loadCls !== "neutral";
  const progressWidth = hasData && report.totalTasks ? report.progressPercent : 0;
  const progressTone = !hasData ? "neutral" : (report.progressPercent >= 66 ? "healthy" : report.progressPercent >= 31 ? "moderate" : "high");
  const workloadTone = toneFromWorkload({ average: report.workloadAverage, totalPlanned: report.totalPlanned, totalWeighted: report.totalWeighted, saturatedDays: report.saturatedDays, protectedWithTasks: report.protectedWithTasks });
  return `<button class="graph-card preclose-graph-card workload-${loadCls} graph-${loadCls}" data-preclose-graph="${profile.id}" type="button" aria-label="Ver pre-cierre semanal de ${escapeAttr(profile.name || "perfil")}">
    <div class="graph-card-head">
      <div><span class="eyebrow">Avance y pre-cierre</span><strong>AVS ${hasData ? `${report.progressPercent}%` : "S/D"}</strong><small>${hasData ? `${report.completed}/${report.totalTasks} tareas · cierre ${dayLabel(report.closeDay)}` : "Agrega tareas para activar lectura"}</small></div>
      <span class="graph-open-pill">Ver pre-cierre</span>
    </div>
    <div class="dual-graph-bars">
      <div><span>AVS</span><div class="mini-metric-track state-bar state-${progressTone}"><i style="width:${Math.min(progressWidth, 100)}%"></i></div><b>${hasData ? `${progressWidth}%` : "S/D"}</b></div>
      <div><span>CPS</span><div class="mini-metric-track state-bar state-${workloadTone}"><i style="width:${hasData ? Math.min(report.workloadAverage, 100) : 0}%"></i></div><b>${hasData ? workloadPercentLabel(report.workloadAverage) : "S/D"}</b></div>
    </div>
    <div class="compact-stat-grid compact-stat-grid-six">
      <span><b>CIE</b><strong>${dayLabel(report.closeDay).slice(0,3)}</strong></span>
      <span><b>RES</b><strong>${report.daysToClose}d</strong></span>
      <span><b>PEN</b><strong>${report.pending}</strong></span>
      <span><b>SAT</b><strong>${report.saturatedDays}</strong></span>
      <span><b>DES</b><strong>${report.protectedWithTasks}</strong></span>
      <span><b>TMP</b><strong>${report.totalPlanned}m</strong></span>
    </div>
  </button>`;
}


function pickWorstTone(...tones) {
  const rank = { neutral: 0, healthy: 1, moderate: 2, high: 3, saturated: 4 };
  return tones.reduce((worst, tone) => (rank[tone] || 0) > (rank[worst] || 0) ? tone : worst, "neutral");
}

function roleTone(profile) {
  const role = String(profile?.primaryRole || "").trim().toLowerCase();
  if (!role || role === "pendiente" || role === "sin asignar") return "neutral";
  return "healthy";
}

function profileOperationsGraphCard(profile) {
  const availability = normalizeAvailability(profile.availability);
  const tasks = getProfileWeeklyTasks(profile.id);
  const avStats = availabilityStats(profile.availability);
  const summary = weeklyCalendarSummary(profile, tasks);
  const workload = weeklyWorkloadReport(profile, tasks);
  const avTone = toneFromAvailability(profile, summary, avStats);
  const workTone = toneFromWorkload(workload);
  const rTone = roleTone(profile);
  const totalTasks = tasks.length;
  const completed = tasks.filter(t => t.status === "completed").length;
  const taskTone = !totalTasks ? "neutral" : completed === totalTasks ? "healthy" : completed / totalTasks >= .5 ? "moderate" : "high";
  const cardTone = pickWorstTone(rTone, avTone, workTone, taskTone);
  const roleWidth = rTone === "neutral" ? 0 : 100;
  const availabilityWidth = avTone === "neutral" ? 0 : Math.min(100, Math.round(((summary.available + summary.light) / 7) * 100));
  const taskWidth = totalTasks ? Math.round((completed / totalTasks) * 100) : 0;
  return `<section class="profile-compact-panel graph-${cardTone}">
    <div class="profile-compact-head">
      <div>
        <span class="eyebrow">Configuración del perfil</span>
        <h4>${escapeHtml(profile.name || "Perfil")}</h4>
        <p>Rol, disponibilidad, calendario y carga semanal comprimidos. Usa configurar para cambiar rol principal, subroles o notas sin buscar botones escondidos.</p>
      </div>
      <div class="profile-quick-actions">
        <button class="primary-btn" data-edit-profile="${profile.id}">Configurar perfil</button>
        <button class="soft-btn" data-toggle-profile-ops="${profile.id}">Abrir panel</button>
      </div>
    </div>
    <div class="profile-bars-grid">
      <div class="profile-line metric-${rTone}"><span>ROL</span><div class="mini-metric-track"><i style="width:${roleWidth}%"></i></div><b>${rTone === "neutral" ? "S/D" : "OK"}</b></div>
      <div class="profile-line metric-${avTone}"><span>DIS</span><div class="mini-metric-track"><i style="width:${availabilityWidth}%"></i></div><b>${summary.available}/${7}</b></div>
      <div class="profile-line metric-${workTone}"><span>CPS</span><div class="mini-metric-track"><i style="width:${workTone === "neutral" ? 0 : Math.min(workload.average, 100)}%"></i></div><b>${workTone === "neutral" ? "S/D" : workloadPercentLabel(workload.average)}</b></div>
      <div class="profile-line metric-${taskTone}"><span>TAR</span><div class="mini-metric-track"><i style="width:${taskWidth}%"></i></div><b>${completed}/${totalTasks}</b></div>
    </div>
  </section>`;
}

function precloseCompactPanel(profile) {
  const report = weeklyPreCloseReport(profile, getProfileWeeklyTasks(profile.id));
  const tone = toneFromPreclose(report);
  return `<section class="profile-compact-panel preclose-compact-panel graph-${tone}">
    <div class="profile-compact-head">
      <div>
        <span class="eyebrow">Cierre semanal</span>
        <h4>${tone === "neutral" ? "Sin cierre activo" : `AVS ${report.progressPercent}% · CPS ${workloadPercentLabel(report.workloadAverage)}`}</h4>
        <p>${tone === "neutral" ? "Agrega tareas para activar el pre-cierre." : `${report.completed}/${report.totalTasks} tareas · cierre ${dayLabel(report.closeDay)} · ${report.daysToClose} días restantes.`}</p>
      </div>
      <button class="soft-btn" data-toggle-preclose-details="${profile.id}">Abrir cierre</button>
    </div>
    <div class="profile-bars-grid">
      <div class="profile-line metric-${tone === "neutral" ? "neutral" : (report.progressPercent >= 66 ? "healthy" : report.progressPercent >= 31 ? "moderate" : "high")}"><span>AVS</span><div class="mini-metric-track"><i style="width:${tone === "neutral" ? 0 : report.progressPercent}%"></i></div><b>${tone === "neutral" ? "S/D" : `${report.progressPercent}%`}</b></div>
      <div class="profile-line metric-${toneFromWorkload({ average: report.workloadAverage, totalPlanned: report.totalPlanned, totalWeighted: report.totalWeighted, saturatedDays: report.saturatedDays, protectedWithTasks: report.protectedWithTasks })}"><span>CPS</span><div class="mini-metric-track"><i style="width:${tone === "neutral" ? 0 : Math.min(report.workloadAverage, 100)}%"></i></div><b>${tone === "neutral" ? "S/D" : workloadPercentLabel(report.workloadAverage)}</b></div>
      <div class="profile-line metric-${report.pending ? "moderate" : tone === "neutral" ? "neutral" : "healthy"}"><span>PEN</span><div class="mini-metric-track"><i style="width:${report.totalTasks ? Math.round((report.pending / report.totalTasks) * 100) : 0}%"></i></div><b>${report.pending}</b></div>
      <div class="profile-line metric-${report.protectedWithTasks ? "saturated" : tone === "neutral" ? "neutral" : "healthy"}"><span>DES</span><div class="mini-metric-track"><i style="width:${Math.min(100, report.protectedWithTasks * 25)}%"></i></div><b>${report.protectedWithTasks}</b></div>
    </div>
  </section>`;
}

function openAvailabilityGraph(profileId) {
  const profile = (cache.profiles || []).find(p => p.id === profileId);
  if (!profile) return;
  const availability = normalizeAvailability(profile.availability);
  const tasks = getProfileWeeklyTasks(profile.id);
  const summary = weeklyCalendarSummary(profile, tasks);
  const stats = availabilityStats(profile.availability);
  const rows = WEEK_DAYS.map(d => {
    const mode = availability.days[d.key]?.mode || "external_plus_business";
    const isClose = availability.weeklyCloseDay === d.key;
    return `<div class="modal-day-row ${dayStateClass(mode)}"><strong>${d.label}</strong><span>${dayModeLabel(mode)}</span>${isClose ? `<b>Cierre semanal</b>` : `<small></small>`}</div>`;
  }).join("");
  const graph = availabilityDistributionCard(profile, summary, stats).replace(`data-availability-graph="${profile.id}"`, "data-noop='true'");
  openInfoModal({
    eyebrow: "Distribución de días",
    title: `Disponibilidad de ${profile.name || "perfil"}`,
    html: `<div class="modal-graph-detail">
      ${graph}
      <div class="modal-stat-grid">
        ${metricMiniBar("Días disponibles", summary.available, 7, "Pueden recibir trabajo normal", "healthy")}
        ${metricMiniBar("Días ligeros", summary.light, 7, "Ideal para revisión o planificación suave", "moderate")}
        ${metricMiniBar("Días protegidos", summary.protectedDays, 7, "No deberían recibir tareas automáticas", "neutral")}
        ${metricMiniBar("Tareas actuales", summary.taskCount, Math.max(1, summary.taskCount, 6), `${summary.completed} completadas`, "high")}
      </div>
      <div class="modal-day-list">${rows}</div>
    </div>`
  });
}

function openWorkloadGraph(profileId) {
  const profile = (cache.profiles || []).find(p => p.id === profileId);
  if (!profile) return;
  const workload = weeklyWorkloadReport(profile, getProfileWeeklyTasks(profile.id));
  const dayBars = workload.days.map(d => metricMiniBar(d.label, `${workloadPercentLabel(d.workload.percent)}`, 100, `${d.workload.plannedMinutes} min reales · ${d.workload.weightedMinutes} ponderados · capacidad ${d.workload.capacity} min`, d.workload.status.key)).join("");
  const graph = workloadGraphCard(profile, workload).replace(`data-workload-graph="${profile.id}"`, "data-noop='true'");
  openInfoModal({
    eyebrow: "Carga semanal",
    title: `Estadísticas de carga de ${profile.name || "perfil"}`,
    html: `<div class="modal-graph-detail">
      ${graph}
      <div class="modal-stat-grid">
        ${metricMiniBar("Carga promedio semanal", `${workloadPercentLabel(workload.average)}`, 100, workload.recommendation, workloadClassFromPercent(workload.average, workload.totalPlanned > 0))}
        ${metricMiniBar("Día más cargado", workload.highest?.label || "Sin datos", 100, workload.highest ? `${workloadPercentLabel(workload.highest.workload.percent)} de carga` : "0%", workload.highest?.workload?.status?.key || "healthy")}
        ${metricMiniBar("Días saturados", workload.saturatedDays, 7, "Conviene redistribuir", workload.saturatedDays ? "saturated" : "healthy")}
        ${metricMiniBar("Descanso invadido", workload.protectedWithTasks, 7, "Días protegidos con tareas", workload.protectedWithTasks ? "high" : "healthy")}
      </div>
      <h4 class="modal-subtitle">Carga por día</h4>
      <div class="modal-stat-grid">${dayBars}</div>
      ${workload.moveSuggestion ? `<div class="calendar-suggestion">${escapeHtml(workload.moveSuggestion)}</div>` : ""}
    </div>`
  });
}

function openPrecloseGraph(profileId) {
  const profile = (cache.profiles || []).find(p => p.id === profileId);
  if (!profile) return;
  const report = weeklyPreCloseReport(profile, getProfileWeeklyTasks(profile.id));
  const graph = precloseGraphCard(profile, report).replace(`data-preclose-graph="${profile.id}"`, "data-noop='true'");
  openInfoModal({
    eyebrow: "Pre-cierre semanal",
    title: `Lectura semanal de ${profile.name || "perfil"}`,
    html: `<div class="modal-graph-detail">
      ${graph}
      <div class="modal-stat-grid">
        ${metricMiniBar("Avance semanal", `${report.totalTasks ? report.progressPercent : 0}%`, 100, report.progress.label, report.progress.className?.includes("green") ? "healthy" : report.progress.className?.includes("yellow") ? "moderate" : "high")}
        ${metricMiniBar("Carga promedio", `${workloadPercentLabel(report.workloadAverage)}`, 100, `${report.saturatedDays} días saturados`, workloadClassFromPercent(report.workloadAverage, report.totalPlanned > 0))}
        ${metricMiniBar("Tareas completadas", `${report.completed}/${report.totalTasks}`, Math.max(1, report.totalTasks), `${report.pending} pendientes`, report.pending ? "moderate" : "healthy")}
        ${metricMiniBar("Tiempo planificado", `${report.totalPlanned} min`, Math.max(1, report.totalPlanned, 180), `${report.totalWeighted} min ponderados`, "neutral")}
        ${metricMiniBar("Descanso invadido", report.protectedWithTasks, 7, "Días protegidos con tareas", report.protectedWithTasks ? "high" : "healthy")}
      </div>
      <div class="preclose-recommendation"><span class="eyebrow">Recomendación del sistema</span><p>${escapeHtml(report.recommendation)}</p></div>
    </div>`
  });
}


function daysUntilWeeklyClose(closeDayKey) {
  const jsDayToKey = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const todayKey = jsDayToKey[new Date().getDay()];
  const todayIndex = WEEK_DAYS.findIndex(d => d.key === todayKey);
  const closeIndex = WEEK_DAYS.findIndex(d => d.key === closeDayKey);
  if (todayIndex < 0 || closeIndex < 0) return 0;
  return (closeIndex - todayIndex + 7) % 7;
}

function weeklyProgressLabel(percent, totalTasks) {
  if (!totalTasks) return { label: "Sin tareas planificadas todavía", className: "status-neutral" };
  if (percent <= 30) return { label: "Avance bajo", className: "status-red" };
  if (percent <= 65) return { label: "Avance parcial", className: "status-yellow" };
  if (percent <= 89) return { label: "Buen avance", className: "status-green" };
  return { label: "Semana casi cerrada", className: "status-green" };
}

function classifyTaskImpact(task = {}) {
  const text = `${task.title || ""} ${task.description || ""} ${task.notes || ""}`.toLowerCase();
  const checks = [
    ["estrategia", ["estrateg", "prioridad", "decision", "dirección", "direccion"]],
    ["marca", ["marca", "tono", "mensaje", "identidad", "brand"]],
    ["visual", ["visual", "arte", "diseño", "diseno", "mockup", "photoshop", "imagen"]],
    ["producto", ["producto", "colección", "coleccion", "drop", "color", "precio"]],
    ["shopify", ["shopify", "tienda", "producto", "carrito", "checkout", "tracking"]],
    ["marketing", ["marketing", "instagram", "tiktok", "publicación", "publicacion", "post", "reel"]],
    ["ventas", ["venta", "cliente", "conversión", "conversion", "pedido", "compr"]],
    ["finanzas", ["gasto", "inversión", "inversion", "ads", "presupuesto", "margen", "costo"]],
    ["datos", ["dato", "métrica", "metrica", "estadística", "estadistica", "analisis", "analytics"]],
    ["operaciones", ["drive", "archivo", "orden", "documento", "evidencia", "versión", "version"]],
    ["comunidad", ["comunidad", "comentario", "respuesta", "foro", "grupo", "chef", "cocina"]]
  ];
  for (const [area, words] of checks) {
    if (words.some(w => text.includes(w))) return area;
  }
  return task.source === "manual" ? "operativo/manual" : (task.source || "sin clasificar");
}

function impactBuckets(tasks = []) {
  const buckets = {};
  tasks.forEach(task => {
    const area = classifyTaskImpact(task);
    if (!buckets[area]) buckets[area] = { total: 0, completed: 0, minutes: 0 };
    buckets[area].total += 1;
    if (task.status === "completed") buckets[area].completed += 1;
    buckets[area].minutes += taskMinutes(task);
  });
  return Object.entries(buckets).sort((a,b) => b[1].total - a[1].total);
}

function preCloseRecommendation(report) {
  if (!report.totalTasks) return "Todavía no hay tareas planificadas. Antes del cierre, agrega tareas pequeñas y medibles para que la semana tenga dirección.";
  if (report.protectedWithTasks > 0) return "Hay tareas en días protegidos. Conviene moverlas o reducir alcance para no convertir el descanso en otra jornada.";
  if (report.daysToClose <= 2 && report.pendingRatio > 50) return "El cierre está cerca y queda más de la mitad pendiente. Mueve tareas a la próxima semana o reduce alcance para evitar presión innecesaria.";
  if (report.saturatedDays > 0 && report.progressPercent >= 70) return "El avance es bueno, pero hubo saturación. La próxima semana conviene repartir mejor, no solo trabajar más.";
  if (report.saturatedDays > 0) return "La semana tiene saturación. Antes de agregar más trabajo, revisa qué se puede mover o volver más ligero.";
  if (report.progressPercent >= 90) return "La semana está casi cerrada. Usa el cierre para extraer aprendizaje y preparar una siguiente semana realista.";
  if (report.progressPercent >= 66) return "La semana va bien. Mantén el cierre, revisa pendientes y evita meter tareas extra por impulso.";
  if (report.progressPercent >= 31) return "Hay avance parcial. Revisa si las tareas pendientes son realmente necesarias esta semana o si deben pasar a la próxima.";
  return "El avance está bajo. Revisa si hubo poca disponibilidad, tareas demasiado grandes o falta de foco antes de prometer más para la próxima semana.";
}

function currentVsNextAvailabilityWarning(currentAvailability, nextAvailability) {
  if (!nextAvailability || !nextAvailability.days) return "";
  const current = availabilityStats(currentAvailability);
  const next = availabilityStats(nextAvailability);
  const currentLoadPotential = current.available + (current.light * 0.4) + Number(current.maxHours || 3) / 3;
  const nextLoadPotential = next.available + (next.light * 0.4) + Number(next.maxHours || 3) / 3;
  if (next.protectedDays < current.protectedDays || next.maxHours > current.maxHours || nextLoadPotential > currentLoadPotential + 1) {
    return "La próxima semana parece más cargada que la actual. Revisa si esto es realista según tu trabajo externo y descanso.";
  }
  return "";
}

function getNextWeekPlan(profileId) {
  return (cache.profileNextWeekPlans || []).find(plan => plan.profileId === profileId) || null;
}

function weeklyPreCloseReport(profile, tasks) {
  const availability = normalizeAvailability(profile.availability);
  const workload = weeklyWorkloadReport(profile, tasks);
  const totalTasks = tasks.length;
  const completed = tasks.filter(t => t.status === "completed").length;
  const pending = Math.max(0, totalTasks - completed);
  const progressPercent = totalTasks ? Math.round((completed / totalTasks) * 100) : 0;
  const pendingRatio = totalTasks ? Math.round((pending / totalTasks) * 100) : 0;
  const daysToClose = daysUntilWeeklyClose(availability.weeklyCloseDay);
  const progress = weeklyProgressLabel(progressPercent, totalTasks);
  const buckets = impactBuckets(tasks);
  const report = {
    availability,
    closeDay: availability.weeklyCloseDay,
    daysToClose,
    totalTasks,
    completed,
    pending,
    progressPercent,
    pendingRatio,
    progress,
    workloadAverage: workload.average,
    highest: workload.highest,
    saturatedDays: workload.saturatedDays,
    protectedWithTasks: workload.protectedWithTasks,
    totalPlanned: workload.totalPlanned,
    totalWeighted: workload.totalWeighted,
    buckets
  };
  report.recommendation = preCloseRecommendation(report);
  return report;
}

function renderWeeklyPreClose(profile, includeGraph = true) {
  const tasks = getProfileWeeklyTasks(profile.id);
  const report = weeklyPreCloseReport(profile, tasks);
  const nextPlan = getNextWeekPlan(profile.id);
  const nextAvailability = nextPlan?.availability ? normalizeAvailability(nextPlan.availability) : null;
  const nextStats = nextAvailability ? availabilityStats(nextAvailability) : null;
  const nextWarning = currentVsNextAvailabilityWarning(profile.availability, nextAvailability);
  const closePhrase = report.daysToClose === 0 ? "Hoy es el cierre" : report.daysToClose === 1 ? "Falta 1 día" : `Faltan ${report.daysToClose} días`;
  const closePressure = report.daysToClose <= 2 && report.pendingRatio > 50
    ? `<div class="calendar-suggestion warning-suggestion">El cierre está cerca y quedan varias tareas. Puedes mover tareas a la próxima semana o reducir alcance para evitar presión innecesaria.</div>`
    : "";
  const impactHtml = report.buckets.length
    ? report.buckets.map(([area, data]) => `<span><b>${area}</b><small>${data.completed}/${data.total} · ${data.minutes} min</small></span>`).join("")
    : `<span><b>Sin impacto medido</b><small>Agrega tareas para leer la semana.</small></span>`;
  return `<section class="weekly-preclose">
    <div class="calendar-title-row">
      <div>
        <span class="eyebrow">Pre-cierre semanal</span>
        <h4>Revisión antes de cerrar la semana</h4>
      </div>
      <div class="calendar-actions">
        <button class="soft-btn" data-preclose-help="${profile.id}">Por qué revisar antes de cerrar</button>
        <button class="primary-btn" data-prepare-next-week="${profile.id}">Preparar siguiente semana</button>
      </div>
    </div>
    ${includeGraph ? precloseGraphCard(profile, report) : ""}
    ${closePressure}
    <div class="impact-panel">
      <div><span class="eyebrow">Impacto semanal básico</span><p>Lectura aproximada según tareas manuales, texto y futuras áreas de rol.</p></div>
      <div class="impact-chips">${impactHtml}</div>
    </div>
    <div class="next-week-panel">
      <div>
        <span class="eyebrow">Siguiente semana preparada</span>
        ${nextPlan ? `<p>Cierre propuesto: <strong>${dayLabel(nextAvailability.weeklyCloseDay)}</strong> · Máx. <strong>${nextAvailability.maxDailyBusinessHours || 3} h/día</strong> · ${nextStats.available} disponibles · ${nextStats.light} ligeros · ${nextStats.protectedDays} protegidos.</p>` : `<p>No has preparado la disponibilidad de la siguiente semana todavía.</p>`}
        ${nextWarning ? `<small class="next-warning">${escapeHtml(nextWarning)}</small>` : ""}
      </div>
    </div>
  </section>`;
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
  teamTasks: "Tareas a realizar",
  products: "Productos y colecciones",
  audit: "Auditoría de tienda",
  competitors: "Investigación de competidores",
  promotion: "Plan de promoción",
  newProjects: "Nuevos proyectos",
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
  const workload = weeklyWorkloadReport(profile, tasks);
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
      <div class="calendar-actions">
        <button class="soft-btn" data-workload-help="${profile.id}">Cómo se calcula la carga</button>
        <button class="soft-btn" data-calendar-help="${profile.id}">Cómo leer este calendario</button>
      </div>
    </div>
    ${availabilityDistributionCard(profile, summary, availabilityStats(profile.availability))}
    ${workloadGraphCard(profile, workload)}
    ${workload.moveSuggestion ? `<div class="calendar-suggestion">${workload.moveSuggestion}</div>` : ""}
    ${closeWarning}
    <div class="week-board">
      ${workload.days.map(d => {
        const mode = d.workload.mode;
        const dayTasks = d.workload.dayTasks;
        const isClose = availability.weeklyCloseDay === d.key;
        return `<article class="week-day-card ${dayStateClass(mode)} ${isClose ? "is-close-day" : ""} workload-${d.workload.status.key}">
          <div class="week-day-head">
            <div><strong>${d.label}</strong>${isClose ? `<small class="close-day-tag">Cierre semanal</small>` : ""}</div>
            <span>${dayModeLabel(mode)}</span>
          </div>
          <div class="day-load-box">
            <div class="day-load-top"><strong>${workloadPercentLabel(d.workload.percent)}</strong><span>${d.workload.status.label}</span></div>
            <div class="load-bar"><i style="width:${Math.min(d.workload.percent, 100)}%"></i></div>
            <small>${d.workload.plannedMinutes} min reales · ${d.workload.weightedMinutes} min ponderados · capacidad ${d.workload.capacity} min</small>
            <p>${d.workload.status.phrase}</p>
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


function todayKey() {
  const idx = new Date().getDay();
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][idx] || "monday";
}

function selectedTeamTaskProfileId() {
  const saved = localStorage.getItem("the86_team_tasks_profile");
  if (saved && (cache.profiles || []).some(p => p.id === saved)) return saved;
  return (cache.profiles || [])[0]?.id || "";
}

function profileWeekGuideCompact(profile) {
  const workload = weeklyWorkloadReport(profile, getProfileWeeklyTasks(profile.id));
  const cards = workload.days.map(d => {
    const completed = d.workload.dayTasks.filter(t => t.status === "completed").length;
    const total = d.workload.dayTasks.length;
    const donePercent = total ? Math.round((completed / total) * 100) : 0;
    const intensityValue = Math.round(Math.min(d.workload.percent, 100));
    return `<article class="day-guide-card workload-${d.workload.status.key}">
      <div class="day-guide-head"><strong>${d.label.slice(0,3)}</strong><span>${workloadPercentLabel(d.workload.percent)}</span></div>
      <div class="guide-meter-row"><small>Intensidad del día</small><div class="load-bar"><i style="width:${intensityValue}%"></i></div></div>
      <div class="guide-meter-row"><small>Completado ${completed}/${total}</small><div class="load-bar completion-bar"><i style="width:${donePercent}%"></i></div></div>
    </article>`;
  }).join("");
  return `<section class="profile-week-guide-compact">
    <div class="profile-compact-head mini-head">
      <div><span class="eyebrow">Guía semanal compacta</span><h4>Intensidad y avance por día</h4><p>El perfil solo muestra salud de trabajo. La operación diaria vive en Equipo → Tareas a realizar.</p></div>
      <button class="soft-btn" data-open-profile-week="${profile.id}">Ver distribución semanal</button>
    </div>
    <div class="day-guide-grid">${cards}</div>
  </section>`;
}

function teamTasksForDay(profileId, dayKey = todayKey()) {
  return getProfileWeeklyTasks(profileId).filter(t => (t.assignedDay || "monday") === dayKey);
}


function taskWorkTarget(task = {}, bank = null) {
  const taskType = String(task.taskType || bank?.taskType || "").toLowerCase();
  const taskId = String(task.roleTaskId || task.brandTaskId || task.strategicTaskId || bank?.id || "").toLowerCase();
  const text = `${task.title || ""} ${task.description || ""} ${taskType} ${taskId}`.toLowerCase();
  if (/product|garment|prenda|promise|diseño|design/.test(text)) return { view: "products", label: "Ir a Productos", section: "Productos y colecciones", reason: "Esta tarea necesita registrar o revisar prendas, colecciones, frases, promesa y datos de producto." };
  if (/shopify|conversion|auditor/.test(text)) return { view: "audit", label: "Ir a auditoría Shopify", section: "Shopify / auditoría", reason: "Esta tarea necesita revisar la tienda, página de producto, confianza, mobile y fricciones de compra." };
  if (/commercial|tracción|traccion|sales|venta|ventas/.test(text)) return { view: "commercial", label: "Ir a Ventas y datos", section: "Ventas y datos", reason: "Esta tarea necesita registrar o revisar ventas, tráfico, señal comercial y producto con intención." };
  if (/finance|financ|investment|inversión|inversion|ads|gasto|resultado/.test(text)) return { view: "commercial", label: "Ir a Finanzas / ventas", section: "Ventas y datos", reason: "Esta tarea necesita comparar inversión, ads, ventas y señales económicas del negocio." };
  if (/campaign|promoci|marketing|mensaje/.test(text)) return { view: "promotion", label: "Ir a Plan promoción", section: "Plan promoción", reason: "Esta tarea necesita preparar mensaje, canal, campaña o revisión de marketing." };
  if (/decision|decisión|decision/.test(text)) return { view: "decisions", label: "Ir a Decisiones", section: "Registro de decisiones", reason: "Esta tarea necesita guardar una decisión, evidencia, alternativa descartada y efecto esperado." };
  if (/operation|operativ|archivo|file|drive/.test(text)) return { view: "files", label: "Ir a Archivos Drive", section: "Archivos y recursos", reason: "Esta tarea necesita ordenar evidencia, archivos, enlaces o continuidad operativa." };
  if (/brand|marca|coherencia|tono|frases/.test(text)) return { view: "products", label: "Ir a Productos / marca", section: "Productos y colecciones", reason: "Esta tarea conecta el formulario de marca con prendas, frases, promesa y coherencia de producto." };
  return { view: "stages", label: "Ir a Etapas", section: "Etapas", reason: "Esta tarea empuja avance del proceso general y debe dejar evidencia para el cierre semanal." };
}

function navigateTaskTarget(taskId) {
  const task = (cache.profileWeeklyTasks || []).find(t => t.id === taskId);
  if (!task) return;
  const bank = getRoleBankTask(task);
  const target = taskWorkTarget(task, bank);
  localStorage.setItem("the86_last_task_route", JSON.stringify({ taskId, view: target.view, at: Date.now() }));
  switchView(target.view);
  setTimeout(() => {
    openInfoModal({
      eyebrow: "Ruta de tarea",
      title: target.section,
      html: `<div class="learning-stack"><div class="learning-box"><span class="eyebrow">Tarea activa</span><p>${escapeHtml(task.title || "Tarea")}</p></div><div class="learning-box"><span class="eyebrow">Qué hacer aquí</span><p>${escapeHtml(target.reason)}</p></div><div class="learning-box"><span class="eyebrow">Regla de sistema</span><p>Cuando guardes datos en esta sección, el cierre semanal y las etapas podrán usar esa evidencia para medir avance real. Esta versión deja la ruta conectada; los formularios específicos por tarea se irán integrando por rol.</p></div></div>`
    });
  }, 120);
}

function taskStageLinkLabel(task = {}, bank = null) {
  const target = taskWorkTarget(task, bank);
  return `Conecta con ${target.section}`;
}

function renderDailyTaskCard(task) {
  const roleData = roleTaskStatusData(task);
  const bank = getRoleBankTask(task);
  const target = taskWorkTarget(task, bank);
  return `<article class="daily-task-card ${task.status === "completed" ? "task-completed" : "task-pending"} ${roleData.className}">
    <div class="daily-task-head">
      <div><span class="role-source-badge ${roleData.className}">${escapeHtml(roleData.label)}</span><h4>${escapeHtml(task.title || "Tarea sin título")}</h4></div>
      <span class="status-pill">${taskStatusLabel(task.status)}</span>
    </div>
    ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
    <div class="daily-task-meta">
      <span>${taskMinutes(task)} min</span>
      <span>${weightedTaskMinutes(task)} ponderados</span>
      <span>${intensityLabel(task.intensity)}</span>
    </div>
    <div class="small-actions compact-actions">
      <button class="soft-btn" data-weekly-task-detail="${task.id}">Ver detalle</button>
      <button class="primary-btn task-start-btn" data-start-weekly-task="${task.id}">Iniciar tarea</button>
      <button class="soft-btn" data-task-route="${task.id}">${escapeHtml(target.label)}</button>
      <button class="soft-btn" data-move-weekly-task="${task.id}">Mover</button>
      <button class="soft-btn" data-toggle-weekly-task="${task.id}">${task.status === "completed" ? "Reabrir" : "Completar"}</button>
    </div>
  </article>`;
}

function renderTeamTasks() {
  const container = document.getElementById("teamTasks");
  if (!container) return;
  const profiles = cache.profiles || [];
  const selectedId = selectedTeamTaskProfileId();
  const profile = profiles.find(p => p.id === selectedId) || profiles[0];
  const dayKey = todayKey();
  if (!profiles.length) {
    container.innerHTML = `<div class="empty-state"><h3>Sin perfiles todavía</h3><p>Crea perfiles para poder distribuir tareas por usuario.</p></div>`;
    return;
  }
  const tasksToday = teamTasksForDay(profile.id, dayKey);
  const allTasks = getProfileWeeklyTasks(profile.id);
  const workload = weeklyWorkloadReport(profile, allTasks);
  const todayReport = workload.days.find(d => d.key === dayKey)?.workload;
  const completedToday = tasksToday.filter(t => t.status === "completed").length;
  const donePercent = tasksToday.length ? Math.round((completedToday / tasksToday.length) * 100) : 0;
  const activeRoles = profileRoleLabels(profile);
  container.innerHTML = `<div class="notice learning-notice"><strong>Centro operativo de tareas:</strong> aquí se trabaja el día actual. El perfil ya no genera tareas, solo resume responsabilidad, carga y salud de trabajo.</div>
    <section class="team-task-hub card">
      <div class="team-task-top">
        <div><span class="eyebrow">Tareas a realizar</span><h3>Seleccionar usuario</h3><p>El sistema usa los roles activos del usuario para generar y distribuir tareas en los días recomendados.</p></div>
        <div class="team-task-actions">
          <select id="teamTaskProfileSelect">${profiles.map(p => `<option value="${escapeAttr(p.id)}" ${p.id === profile.id ? "selected" : ""}>${escapeHtml(p.name || "Perfil")}</option>`).join("")}</select>
        </div>
      </div>
      <div class="task-hub-summary">
        <div><span>Usuario</span><strong>${escapeHtml(profile.name || "Perfil")}</strong></div>
        <div><span>Día actual</span><strong>${dayLabel(dayKey)}</strong></div>
        <div><span>Roles activos</span><strong>${activeRoles.length ? activeRoles.map(escapeHtml).join(" · ") : "Sin roles"}</strong></div>
        <div><span>Avance hoy</span><strong>${completedToday}/${tasksToday.length}</strong></div>
      </div>
      <div class="daily-load-card workload-${todayReport?.status?.key || "healthy"}">
        <div class="day-guide-head"><strong>Intensidad de hoy</strong><span>${todayReport ? workloadPercentLabel(todayReport.percent) : "S/D"}</span></div>
        <div class="guide-meter-row"><small>Carga diaria</small><div class="load-bar"><i style="width:${todayReport ? Math.min(todayReport.percent, 100) : 0}%"></i></div></div>
        <div class="guide-meter-row"><small>Completado ${donePercent}%</small><div class="load-bar completion-bar"><i style="width:${donePercent}%"></i></div></div>
      </div>
      <div class="daily-task-list">
        ${tasksToday.length ? tasksToday.map(renderDailyTaskCard).join("") : `<div class="empty-day big-empty">No hay tareas para hoy según los roles activos. Si el sistema acaba de generar tareas, revisa la distribución semanal o espera unos segundos a que Firestore sincronice.</div>`}
      </div>
      <div class="modal-actions left-actions"><button class="soft-btn" data-open-week-distribution="${profile.id}">Ver distribución de la semana</button></div>
    </section>`;
  document.getElementById("teamTaskProfileSelect")?.addEventListener("change", e => {
    localStorage.setItem("the86_team_tasks_profile", e.target.value);
    renderTeamTasks();
  });
  setTimeout(() => autoEnsureRoleTasksForProfile(profile.id), 0);
  $$(`[data-open-week-distribution]`).forEach(btn => btn.addEventListener("click", () => openWeekDistribution(btn.dataset.openWeekDistribution)));
  $$(`[data-weekly-task-detail]`).forEach(btn => btn.addEventListener("click", () => openWeeklyTaskDetail(btn.dataset.weeklyTaskDetail)));
  $$(`[data-start-weekly-task]`).forEach(btn => btn.addEventListener("click", () => openTaskExecution(btn.dataset.startWeeklyTask)));
  $$(`[data-task-route]`).forEach(btn => btn.addEventListener("click", () => navigateTaskTarget(btn.dataset.taskRoute)));
  $$(`[data-move-weekly-task]`).forEach(btn => btn.addEventListener("click", () => moveWeeklyTask(btn.dataset.moveWeeklyTask)));
  $$(`[data-toggle-weekly-task]`).forEach(btn => btn.addEventListener("click", () => toggleWeeklyTask(btn.dataset.toggleWeeklyTask)));
}

async function syncRoleTasksForProfile(profileId, options = {}) {
  const profile = (cache.profiles || []).find(p => p.id === profileId);
  if (!profile) return;
  await cleanupObsoleteRoleTasks(profile.id);
  const currentTasks = getProfileWeeklyTasks(profile.id).filter(t => !isObsoleteRoleTask(t));
  const planned = [];
  if (profileHasStrategicRole(profile)) {
    selectStrategicTasksForProfile(profile).forEach(task => {
      const best = findStrategicTaskDay(profile, task, currentTasks, planned);
      planned.push(buildStrategicWeeklyTask(profile, task, best.key));
    });
  }
  if (profileHasBrandRole(profile)) {
    selectBrandTasksForProfile(profile).forEach(task => {
      const best = findBrandTaskDay(profile, task, currentTasks, planned);
      planned.push(buildBrandWeeklyTask(profile, task, best.key));
    });
  }
  if (!planned.length) {
    if (!options.silent) openInfoModal({ eyebrow: "Sin tareas nuevas", title: "No hay nuevas tareas de rol", html: `<p>Este usuario ya tiene las tareas base de sus roles o todavía no hay suficiente señal para asignar más sin crear ruido.</p>` });
    return;
  }
  for (const task of planned) await addDoc(workspaceCol("profileWeeklyTasks"), { ...task, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await logActivity("sync_role_tasks", "profileWeeklyTasks", `Actualizó ${planned.length} tareas según roles para ${profile.name || "perfil"}`);
  if (!options.silent) openInfoModal({ eyebrow: "Tareas actualizadas", title: `${planned.length} tareas agregadas`, html: `<p>Las tareas se distribuyeron según roles activos, disponibilidad, días ligeros/protegidos y carga diaria.</p>` });
}

function openWeekDistribution(profileId) {
  const profile = (cache.profiles || []).find(p => p.id === profileId);
  if (!profile) return;
  const workload = weeklyWorkloadReport(profile, getProfileWeeklyTasks(profile.id));
  openInfoModal({
    eyebrow: "Distribución semanal",
    title: `Semana de ${profile.name || "perfil"}`,
    html: `<div class="week-distribution-modal">
      ${workload.days.map(d => {
        const completed = d.workload.dayTasks.filter(t => t.status === "completed").length;
        const total = d.workload.dayTasks.length;
        const donePercent = total ? Math.round((completed / total) * 100) : 0;
        return `<article class="week-distribution-day workload-${d.workload.status.key}">
          <div class="day-guide-head"><strong>${d.label}</strong><span>${workloadPercentLabel(d.workload.percent)} · ${completed}/${total}</span></div>
          <div class="guide-meter-row"><small>Intensidad</small><div class="load-bar"><i style="width:${Math.min(d.workload.percent, 100)}%"></i></div></div>
          <div class="guide-meter-row"><small>Completado</small><div class="load-bar completion-bar"><i style="width:${donePercent}%"></i></div></div>
          <div class="distribution-task-list">${d.workload.dayTasks.length ? d.workload.dayTasks.map(t => `<button type="button" data-weekly-task-detail="${t.id}"><b>${escapeHtml(t.title || "Tarea")}</b><span>${escapeHtml(roleTaskStatusData(t).label)} · ${taskStatusLabel(t.status)}</span></button>`).join("") : `<p>Sin tareas.</p>`}</div>
        </article>`;
      }).join("")}
    </div>`
  });
  $$(`[data-weekly-task-detail]`).forEach(btn => btn.addEventListener("click", () => openWeeklyTaskDetail(btn.dataset.weeklyTaskDetail)));
  $$(`[data-task-route]`).forEach(btn => btn.addEventListener("click", () => navigateTaskTarget(btn.dataset.taskRoute)));
}

const OBSOLETE_STRATEGIC_TASK_IDS = new Set([
  "reduce_low_impact_work",
  "prioritize_week_actions",
  "check_company_balance",
  "quick_direction_check",
  "record_strategic_decision"
]);
const OBSOLETE_STRATEGIC_TASK_TITLES = [
  "pausar o reducir tareas de bajo impacto",
  "priorizar acciones de la semana",
  "chequeo rápido de dirección",
  "registrar decisión estratégica importante"
];
function getCurrentStrategicTaskIds() {
  const bank = Array.isArray(STRATEGIC_ROLE_TASK_BANK) ? STRATEGIC_ROLE_TASK_BANK : [];
  return new Set(bank.map(t => t.id));
}
function getCurrentBrandTaskIds() {
  const bank = Array.isArray(BRAND_ROLE_TASK_BANK) ? BRAND_ROLE_TASK_BANK : [];
  return new Set(bank.map(t => t.id));
}
const AUTO_ROLE_TASK_SYNCING = new Set();
const OBSOLETE_ROLE_TASK_CLEANING = new Set();

function isObsoleteRoleTask(task = {}) {
  const taskId = String(task.roleTaskId || task.strategicTaskId || task.brandTaskId || task.id || "").trim();
  const title = String(task.title || "").toLowerCase().trim();
  if (task.roleId === STRATEGIC_ROLE_ID || task.roleName === STRATEGIC_ROLE_NAME) {
    if (OBSOLETE_STRATEGIC_TASK_IDS.has(taskId)) return true;
    if (taskId && !getCurrentStrategicTaskIds().has(taskId)) return true;
    if (OBSOLETE_STRATEGIC_TASK_TITLES.some(t => title.includes(t))) return true;
  }
  if (task.roleId === BRAND_ROLE_ID || task.roleName === BRAND_ROLE_NAME) {
    if (taskId && !getCurrentBrandTaskIds().has(taskId)) return true;
  }
  return false;
}

async function cleanupObsoleteRoleTasks(profileId) {
  if (OBSOLETE_ROLE_TASK_CLEANING.has(profileId)) return 0;
  const profileTasks = getProfileWeeklyTasks(profileId).filter(isObsoleteRoleTask);
  if (!profileTasks.length) return 0;
  OBSOLETE_ROLE_TASK_CLEANING.add(profileId);
  let deleted = 0;
  try {
    for (const task of profileTasks) {
      if (!task.id) continue;
      await deleteDoc(workspaceDoc("profileWeeklyTasks", task.id));
      deleted++;
    }
    await logActivity("cleanup_role_tasks", "profileWeeklyTasks", `Eliminó ${deleted} tareas estratégicas obsoletas/genéricas del perfil.`);
  } finally {
    setTimeout(() => OBSOLETE_ROLE_TASK_CLEANING.delete(profileId), 1500);
  }
  return deleted;
}

async function autoEnsureRoleTasksForProfile(profileId) {
  const profile = (cache.profiles || []).find(p => p.id === profileId);
  if (!profile || AUTO_ROLE_TASK_SYNCING.has(profileId)) return;
  if (!profileHasStrategicRole(profile) && !profileHasBrandRole(profile)) return;
  AUTO_ROLE_TASK_SYNCING.add(profileId);
  try {
    const removed = await cleanupObsoleteRoleTasks(profileId);
    const validExisting = getProfileWeeklyTasks(profile.id)
      .filter(t => (t.source === "role" || t.roleId || t.roleName) && !isObsoleteRoleTask(t));
    if (!validExisting.length || removed) await syncRoleTasksForProfile(profileId, { silent: true });
  } finally {
    setTimeout(() => AUTO_ROLE_TASK_SYNCING.delete(profileId), 1500);
  }
}

function weeklyTaskHtml(task) {
  const statusClass = task.status === "completed" ? "task-completed" : "task-pending";
  const roleData = roleTaskStatusData(task);
  const bank = getRoleBankTask(task);
  const target = taskWorkTarget(task, bank);
  const isRoleTask = task.source === "role" || task.roleId || task.roleName;
  return `<div class="weekly-task ${statusClass} ${isRoleTask ? "weekly-task-role" : ""} ${roleData.className}">
    <div class="weekly-task-head">
      <strong>${escapeHtml(task.title || "Tarea sin título")}</strong>
      <span>${taskStatusLabel(task.status)}</span>
    </div>
    <div class="weekly-task-source"><span class="role-source-badge ${roleData.className}">${escapeHtml(roleData.label)}</span>${task.businessImpact ? `<small>${escapeHtml(task.businessImpact)}</small>` : ""}</div>
    ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
    <div class="weekly-task-meta">
      <span>${taskMinutes(task)} min</span>
      <span>${weightedTaskMinutes(task)} min ponderados</span>
      <span>Intensidad ${intensityLabel(task.intensity)}</span>
      <span>${task.source || "manual"}</span>
    </div>
    <div class="small-actions compact-actions">
      ${isRoleTask ? `<button class="soft-btn" data-weekly-task-detail="${task.id}">Ver detalle</button>` : ""}
      <button class="primary-btn task-start-btn" data-start-weekly-task="${task.id}">Iniciar tarea</button>
      <button class="soft-btn" data-task-route="${task.id}">${escapeHtml(target.label)}</button>
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
  const roleRef = workspaceDoc("roles", STRATEGIC_DIRECTION_ROLE.id);
  const roleSnap = await getDoc(roleRef);
  if (!roleSnap.exists()) {
    await setDoc(roleRef, { ...STRATEGIC_DIRECTION_ROLE, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: currentUser.email });
  } else {
    await updateDoc(roleRef, { ...STRATEGIC_DIRECTION_ROLE, updatedAt: serverTimestamp() });
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
  subscribeCol("profileNextWeekPlans");
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
  if (view === "roles") {
    renderRoles();
  }
  if (view === "teamTasks") {
    renderTeamTasks();
  }
}

initNavigation();


const COLLECTION_LABELS = {
  profiles: "Perfil", roles: "Rol", products: "Producto", audit: "Auditoría", competitors: "Competidor", promotion: "Campaña/canal", decisions: "Decisión",
  files: "Recurso Drive", investments: "Inversión", equityPayments: "Abono / compensación", salesEntries: "Venta / dato", adEntries: "Gasto publicitario"
};

const ROLE_OPTIONS = [
  "Pendiente",
  "Dirección estratégica del negocio",
  "Dirección de marca"
];

function uniqueClean(values = []) {
  const seen = new Set();
  return values.map(v => String(v || "").trim()).filter(Boolean).filter(v => {
    const key = normalizeRoleText(v);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function implementedRoleOptions() {
  const values = ["Pendiente", ...ROLE_OPTIONS];
  (cache.roles || []).forEach(role => {
    const name = role.title || role.name;
    if (name && !/pendiente/i.test(name)) values.push(name);
  });
  (cache.profiles || []).forEach(profile => {
    if (profile.primaryRole && !/^(pendiente|sin asignar)$/i.test(profile.primaryRole)) values.push(profile.primaryRole);
    String(profile.subRoles || "").split(",").map(x => x.trim()).filter(Boolean).forEach(x => values.push(x));
  });
  return uniqueClean(values);
}

function splitRoleList(value = "") {
  return String(value || "").split(",").map(x => x.trim()).filter(Boolean);
}

function roleTakenByOtherProfiles(roleName = "", currentProfileId = "") {
  const key = normalizeRoleText(roleName);
  if (!key || /^(pendiente|sin asignar)$/i.test(String(roleName))) return false;
  return (cache.profiles || []).some(profile => {
    if (String(profile.id || "") === String(currentProfileId || "")) return false;
    const primaryKey = normalizeRoleText(profile.primaryRole || "");
    if (primaryKey === key) return true;
    return splitRoleList(profile.subRoles).some(role => normalizeRoleText(role) === key);
  });
}

function availablePrimaryRoleOptions(currentProfile = {}) {
  const currentPrimary = String(currentProfile.primaryRole || "").trim();
  const values = implementedRoleOptions().filter(role => {
    if (/^(pendiente|sin asignar)$/i.test(String(role))) return true;
    if (normalizeRoleText(role) === normalizeRoleText(currentPrimary)) return true;
    return !roleTakenByOtherProfiles(role, currentProfile.id);
  });
  return uniqueClean(values);
}

function availableSubRoleOptions(currentProfile = {}) {
  const currentPrimaryKey = normalizeRoleText(currentProfile.primaryRole || "");
  const currentSubs = splitRoleList(currentProfile.subRoles);
  const currentSubKeys = new Set(currentSubs.map(normalizeRoleText));
  const values = implementedRoleOptions().filter(role => {
    const roleKey = normalizeRoleText(role);
    if (!roleKey || /^(pendiente|sin asignar)$/i.test(String(role))) return false;
    if (roleKey === currentPrimaryKey) return false;
    if (currentSubKeys.has(roleKey)) return true;
    return !roleTakenByOtherProfiles(role, currentProfile.id);
  });
  return uniqueClean(values);
}

function profileFieldSchema(currentProfile = {}) {
  return [
    {name:"name", label:"Nombre del perfil", required:true, placeholder:"Christopher / Adrián"},
    {name:"email", label:"Correo del usuario", type:"email", placeholder:"correo@the86club.com"},
    {name:"avatarUrl", label:"Foto o avatar opcional", type:"url", placeholder:"Link de imagen en Drive o recurso público"},
    {name:"primaryRole", label:"Rol principal", type:"select", required:true, options:() => availablePrimaryRoleOptions(currentProfile), helper:"Solo aparecen roles libres o el rol que ya tiene este perfil. Cada rol debe quedar en una sola persona."},
    {name:"subRoles", label:"Subroles funcionales", type:"checkboxGroup", options:() => availableSubRoleOptions(currentProfile), helper:"Marca roles de apoyo libres. Si otro perfil ya tiene un rol como principal o subrol, no aparecerá aquí."},
    {name:"weeklyLoadStatus", label:"Estado de carga semanal", type:"select", options:["Sin evaluar","Verde — ritmo sano","Amarillo — atención","Rojo — exceso o desequilibrio"]},
    {name:"notes", label:"Notas, límites y contexto del perfil", type:"textarea", placeholder:"Responsabilidades, límites, acuerdos o riesgos de saturación. Este campo lo escribe el usuario; luego el sistema lo usará para interpretar carga y planificación."}
  ];
}


const STRATEGIC_DIRECTION_ROLE = {
  id: "role_strategic_direction",
  title: "Dirección estratégica del negocio",
  name: "Dirección estratégica del negocio",
  area: "Dirección general",
  status: "catalog",
  locked: true,
  maturity: "1.5.1",
  shortDescription: "Mantiene The 86 Club enfocado en acciones que construyen, venden, miden y mejoran el negocio.",
  purpose: "Mantener The 86 Club enfocado en las acciones que realmente construyen, venden, miden y mejoran el negocio, evitando dispersión, exceso creativo, cambios impulsivos y trabajo sin impacto comercial claro.",
  whyItMatters: "The 86 Club es un negocio pequeño con recursos limitados, dos personas, producción POD, Shopify, marketing, diseño, finanzas y operación. Sin dirección estratégica, el proyecto puede moverse por impulso: crear demasiado arte, tocar la tienda sin medir, gastar en publicidad sin leer datos o trabajar muchas horas sin avance real.",
  coreResponsibility: "Decidir el foco semanal del negocio y proteger que las tareas de la semana respondan a una prioridad real.",
  healthRule: "Este rol debe proteger la salud física y mental del usuario. La estrategia no debe convertirse en más carga; debe ordenar la carga. Si hay pocos días disponibles o muchos roles activos, el sistema debe priorizar lo esencial, reducir alcance y advertir sobre saturación.",
  focusRule: "Al conectar roles con calendario, el sistema debe intentar agrupar el trabajo por rol/día: primero 1 rol por día cuando sea posible. Si hay pocos días disponibles, puede combinar roles, pero priorizando el rol de mayor impacto según los datos del workspace y manteniendo la carga dentro de las horas recomendadas.",
  taskEcosystemNote: "Más adelante cada tarea de este rol tendrá su propio ecosistema: una ventana grande de trabajo guiado con pasos, contexto, evidencia, criterios de calidad, impacto esperado y cierre de tarea.",
  responsibilities: [
    "Definir prioridades semanales.",
    "Revisar si el negocio está equilibrado entre diseño, marketing, producto, Shopify, ventas, finanzas y operación.",
    "Detectar exceso creativo, exceso operativo o gasto publicitario sin lectura.",
    "Decidir qué tareas se hacen esta semana y cuáles deben esperar.",
    "Conectar tareas con ventas, tráfico, conversión, marca, finanzas y carga del equipo.",
    "Convertir datos en decisiones registradas.",
    "Proteger la carga de Christopher y Adrián para evitar semanas heroicas imposibles."
  ],
  avoid: [
    "Absorber todas las tareas del negocio.",
    "Convertir cada idea nueva en tarea inmediata.",
    "Aprobar diseños solo porque se ven bonitos sin revisar si ayudan a vender o fortalecer marca.",
    "Cambiar Shopify o campañas sin razón medible.",
    "Confundir trabajar muchas horas con avanzar bien.",
    "Invadir días protegidos de descanso salvo decisión manual consciente."
  ],
  weeklyTasks: [
    { title: "Revisión estratégica semanal", duration: 60, intensity: "media", frequency: "1 vez por semana", suggestedMoment: "Antes del cierre", priority: "alta", businessImpact: "Define qué se logró, qué se trabó y qué debe corregirse." },
    { title: "Definir foco semanal", duration: 45, intensity: "media", frequency: "1 vez por semana", suggestedMoment: "Inicio de semana", priority: "alta", businessImpact: "Evita que la semana se fragmente en tareas bonitas pero dispersas." },
    { title: "Revisar equilibrio del negocio", duration: 30, intensity: "media", frequency: "1 vez por semana", suggestedMoment: "Mitad o cierre", priority: "alta", businessImpact: "Detecta si el negocio se fue demasiado a diseño, tienda, ads o tareas sin ventas." },
    { title: "Revisar decisiones pendientes", duration: 30, intensity: "baja/media", frequency: "1 vez por semana", suggestedMoment: "Bloque estratégico", priority: "media", businessImpact: "Cierra dudas y evita repetir conversaciones." },
    { title: "Revisar métricas base del negocio", duration: 45, intensity: "media", frequency: "1 vez por semana", suggestedMoment: "Cierre o pre-cierre", priority: "alta", businessImpact: "Conecta esfuerzo con ventas, tráfico, conversión, gasto y carga." }
  ],
  lightTasks: [
    { title: "Chequeo rápido de dirección", duration: 10, intensity: "baja", frequency: "2 a 4 veces por semana, opcional", suggestedMoment: "Día ligero", priority: "media", businessImpact: "Confirma que el trabajo del día no contradice el foco semanal." },
    { title: "Registro de decisión rápida", duration: 15, intensity: "baja", frequency: "Cuando aparezca una decisión", suggestedMoment: "Cualquier día disponible", priority: "media", businessImpact: "Guarda por qué se decidió algo y evita ruido futuro." }
  ],
  metrics: [
    "Ventas totales", "Órdenes", "Ingresos netos", "Tasa de conversión", "Ticket promedio", "Gasto en ads", "Tráfico/sesiones", "Productos más vendidos o más vistos", "Tareas completadas", "Tareas pendientes", "Carga semanal por perfil", "Días saturados", "Áreas más trabajadas de la semana"
  ],
  greenSignals: [
    "La semana tiene un foco claro.",
    "Las tareas están distribuidas sin saturar.",
    "Hay equilibrio entre diseño, marketing, tienda y ventas.",
    "Las decisiones importantes quedan registradas.",
    "Se revisan datos antes de cambiar dirección.",
    "Hay avance medible aunque sea pequeño."
  ],
  yellowSignals: [
    "Hay muchas ideas nuevas y pocas cerradas.",
    "Se trabaja bastante, pero no queda claro el impacto.",
    "La semana se carga demasiado hacia diseño o retoques.",
    "Hay tareas pendientes cerca del cierre semanal.",
    "Se toman decisiones sin revisar datos.",
    "Hay varios cambios de prioridad en pocos días."
  ],
  redSignals: [
    "Se crean muchos diseños pero no se promueven.",
    "Se gasta en publicidad sin revisar ventas o conversión.",
    "La tienda se modifica constantemente sin criterio.",
    "El equipo trabaja muchas horas y el negocio no avanza.",
    "Se ignoran días protegidos de descanso.",
    "Una persona absorbe demasiados roles.",
    "No hay foco semanal ni decisiones registradas."
  ],
  recommendedLimits: [
    "2 a 4 horas semanales en etapa inicial.",
    "1 revisión estratégica grande por semana.",
    "No cambiar el foco semanal más de una vez salvo emergencia.",
    "No aprobar más tareas de las que la disponibilidad permite.",
    "No permitir semanas llenas de diseño si no hay promoción o análisis.",
    "Mantener 3 horas diarias como base recomendada, ajustable por usuario."
  ],
  suggestedWeeklyDistribution: [
    { moment: "Inicio de semana", work: "Definir foco semanal y prioridades." },
    { moment: "Mitad de semana", work: "Chequeo ligero para detectar desvíos." },
    { moment: "Antes del cierre", work: "Revisión estratégica, equilibrio, métricas y decisiones." }
  ],
  profileConnection: "Cuando un perfil tenga este rol, deberá mostrar foco estratégico semanal, tareas estratégicas generadas, decisiones pendientes, alertas de exceso y recomendación semanal.",
  calendarConnection: "Las tareas de este rol deben agruparse en bloques de dirección estratégica. El sistema intentará colocarlas en un solo día disponible o en un día cercano al cierre, respetando horas recomendadas, días ligeros y descanso protegido.",
  weeklyCloseConnection: "Este rol alimenta el cierre semanal con foco, avances, áreas descuidadas, decisiones, prioridades y lectura de carga.",
  dashboardConnection: "Este rol alimentará el futuro equilibrio de compañía: creativo, marketing, Shopify, producto, ventas, finanzas, operación, datos y equipo.",
  taskActivationLogic: [
    "Si hay ventas bajas y mucha producción creativa, priorizar revisar equilibrio y promoción.",
    "Si hay gasto en ads sin ventas, priorizar métricas y decisiones de campaña.",
    "Si hay muchos pendientes cerca del cierre, priorizar foco y reducción de alcance.",
    "Si hay días saturados, priorizar redistribución y protección de descanso.",
    "Si hay pocos datos, priorizar registro y lectura básica antes de tomar decisiones grandes."
  ]
};


const BRAND_DIRECTION_ROLE = {
  id: "role_brand_direction",
  title: "Dirección de marca",
  name: "Dirección de marca",
  area: "Marca / Identidad",
  status: "catalog",
  locked: true,
  maturity: "1.5.2",
  shortDescription: "Protege la promesa, el tono, la identidad y la coherencia de The 86 Club para que no se vuelva una tienda POD genérica.",
  purpose: "Mantener The 86 Club reconocible, coherente y creíble como marca de ropa inspirada en la cultura profesional de cocina y servicio. Este rol protege la promesa de marca, el tono, el mensaje, la identidad verbal, la percepción premium y la conexión con el público.",
  whyItMatters: "The 86 Club no vende solo camisetas. Vende pertenencia, estándar, servicio, rush, disciplina y cultura profesional de cocina. Si cada diseño, texto, email, página o campaña habla un idioma distinto, la marca se diluye y se convierte en otra tienda más de camisetas POD.",
  coreResponsibility: "Proteger la promesa central de The 86 Club y revisar si cada pieza se siente realmente como parte de la marca.",
  healthRule: "Este rol debe revisar para decidir, no revisar para atrasar. La dirección de marca puede volverse perfeccionista si no se controla, por eso debe proteger claridad sin crear semanas infinitas de revisión.",
  focusRule: "Las tareas de Dirección de marca deben agruparse en un bloque de marca cuando sea posible: mensaje, coherencia, tono y promesa se revisan juntos para evitar cambios dispersos durante toda la semana.",
  taskEcosystemNote: "Más adelante cada tarea de Dirección de marca tendrá su propio ecosistema: ventana grande con checklist de coherencia, preguntas de marca, evidencia, reglas de tono, impacto esperado y cierre guiado.",
  responsibilities: [
    "Definir y proteger la voz de marca.",
    "Revisar que productos, textos y campañas mantengan coherencia.",
    "Cuidar que la marca no se vuelva genérica ni parezca una tienda POD cualquiera.",
    "Evaluar si una idea fortalece o debilita la percepción de The 86 Club.",
    "Mantener alineados Shopify, Instagram, emails, mockups, productos y promociones.",
    "Definir qué palabras, frases, tonos y promesas pertenecen a la marca.",
    "Convertir cultura de cocina en identidad comercial clara."
  ],
  avoid: [
    "Aprobar diseños solo porque se ven bonitos.",
    "Cambiar el tono de marca cada semana.",
    "Perseguir tendencias que no encajan con cocina, servicio o estándar profesional.",
    "Prometer más de lo que el producto o la tienda pueden cumplir.",
    "Confundir branding con decoración visual.",
    "Convertir cada publicación en venta agresiva.",
    "Bloquear producción por perfeccionismo."
  ],
  weeklyTasks: [
    { title: "Revisar coherencia de marca semanal", duration: 45, intensity: "media", frequency: "1 vez por semana", suggestedMoment: "Bloque de marca", priority: "alta", businessImpact: "Detecta si productos, textos y campañas siguen sonando a The 86 Club." },
    { title: "Definir mensaje central de la semana", duration: 30, intensity: "media", frequency: "1 vez por semana", suggestedMoment: "Inicio de semana o antes de promoción", priority: "alta", businessImpact: "Evita publicar piezas sueltas sin un mensaje común." },
    { title: "Revisar tono de textos clave", duration: 40, intensity: "media", frequency: "Según necesidad", suggestedMoment: "Antes de publicar", priority: "media", businessImpact: "Alinea descripciones, emails, captions y banners con la voz de marca." },
    { title: "Validar si un diseño pertenece a la marca", duration: 30, intensity: "media", frequency: "Por diseño/candidato", suggestedMoment: "Antes de producir o publicar", priority: "alta", businessImpact: "Evita convertir ideas bonitas en productos que diluyen la identidad." },
    { title: "Revisar promesa del producto", duration: 30, intensity: "media", frequency: "Por producto/drop", suggestedMoment: "Antes de activar producto", priority: "alta", businessImpact: "Conecta el producto con valor, cultura y razón de compra." },
    { title: "Actualizar notas de voz de marca", duration: 25, intensity: "baja/media", frequency: "Cuando haya aprendizajes", suggestedMoment: "Cierre o pre-cierre", priority: "media", businessImpact: "Convierte aprendizajes en reglas reutilizables." },
    { title: "Detectar piezas que diluyen la marca", duration: 30, intensity: "media", frequency: "1 vez por semana o por revisión", suggestedMoment: "Bloque de marca", priority: "alta", businessImpact: "Señala piezas que se sienten genéricas, contradictorias o fuera de cultura." },
    { title: "Crear regla de marca nueva", duration: 20, intensity: "baja", frequency: "Cuando se tome una decisión", suggestedMoment: "Después de revisar", priority: "media", businessImpact: "Deja claro qué sí y qué no pertenece a The 86 Club." },
    { title: "Revisar confianza de página/producto", duration: 45, intensity: "media", frequency: "Cuando haya cambios en Shopify", suggestedMoment: "Antes de promoción", priority: "alta", businessImpact: "Asegura que la tienda se sienta confiable, coherente y no improvisada." },
    { title: "Preparar guía de mensaje para campaña", duration: 45, intensity: "media", frequency: "Antes de campaña", suggestedMoment: "Antes de marketing", priority: "alta", businessImpact: "Ayuda a que la campaña tenga ángulo, tono, promesa y límites de marca." }
  ],
  lightTasks: [
    { title: "Guardar frase o idea de tono", duration: 10, intensity: "baja", frequency: "Cuando aparezca una idea útil", suggestedMoment: "Día ligero", priority: "media", businessImpact: "Crea banco de lenguaje propio para captions, emails y campañas." },
    { title: "Chequeo rápido de coherencia", duration: 10, intensity: "baja", frequency: "Antes de publicar", suggestedMoment: "Día ligero o antes de publicar", priority: "media", businessImpact: "Evita publicar algo que contradice el tono o la promesa de marca." },
    { title: "Registrar ‘esto no es The 86 Club’", duration: 15, intensity: "baja", frequency: "Cuando algo se descarte", suggestedMoment: "Después de revisión", priority: "media", businessImpact: "Fortalece límites de marca y evita repetir errores." }
  ],
  metrics: [
    "Consistencia entre productos", "Consistencia entre textos", "Consistencia entre imágenes", "Productos con más interacción", "Productos más guardados o compartidos", "Comentarios sobre identidad", "Tasa de conversión de páginas de producto", "Clicks desde contenido orgánico", "Repetición de mensajes clave", "Confianza percibida de tienda", "Piezas rechazadas por no encajar", "Reglas de marca actualizadas"
  ],
  greenSignals: [
    "La marca se siente reconocible en tienda, productos y contenido.",
    "Los textos suenan a cultura de cocina y servicio.",
    "Los diseños nuevos encajan con la promesa de The 86 Club.",
    "Los productos no parecen genéricos.",
    "Hay reglas claras de tono y estilo.",
    "Las campañas se sienten conectadas al drop.",
    "La tienda transmite confianza y coherencia."
  ],
  yellowSignals: [
    "Hay diseños buenos pero no queda claro si son The 86 Club.",
    "El tono cambia mucho entre posts, productos y emails.",
    "Se usan frases genéricas de marca de ropa cualquiera.",
    "Hay piezas visuales bonitas pero sin historia de marca.",
    "La página se ve bien, pero no comunica diferencia.",
    "Se publican contenidos sin mensaje central."
  ],
  redSignals: [
    "The 86 Club parece una tienda POD genérica.",
    "Cada diseño parece de una marca diferente.",
    "Se prometen cosas que el producto o la tienda no sostienen.",
    "La marca depende solo de estética, no de identidad.",
    "Se copia demasiado el lenguaje de otras marcas.",
    "La tienda no transmite confianza.",
    "Las campañas venden producto sin cultura ni razón."
  ],
  recommendedLimits: [
    "No más de 1 revisión grande de marca por semana.",
    "No cambiar reglas de marca por cada idea nueva.",
    "No revisar cada detalle hasta bloquear producción.",
    "No convertir branding en excusa para retrasar ventas.",
    "No perseguir tendencias que contradicen la identidad.",
    "Agrupar revisión de marca en bloque para evitar retoque infinito."
  ],
  suggestedWeeklyDistribution: [
    { moment: "Inicio de semana", work: "Definir mensaje central de la semana." },
    { moment: "Mitad de semana", work: "Revisar coherencia de productos, posts o campañas." },
    { moment: "Antes de publicar", work: "Chequeo rápido de tono y promesa." },
    { moment: "Antes del cierre", work: "Registrar aprendizajes y reglas nuevas de marca." }
  ],
  profileConnection: "Cuando un perfil tenga este rol, deberá mostrar promesa central actual, mensaje de la semana, reglas de marca activas, tareas de coherencia y alertas si hay piezas fuera de marca.",
  calendarConnection: "Las tareas de este rol deben agruparse como bloque de Dirección de marca. Si hay productos nuevos, campañas o cambios en Shopify, el sistema podrá activar revisiones de promesa, tono y confianza.",
  weeklyCloseConnection: "Este rol alimenta el cierre semanal con preguntas sobre coherencia, piezas que fortalecieron la identidad, piezas genéricas, reglas nuevas y mensajes contradictorios.",
  dashboardConnection: "Este rol alimentará el futuro equilibrio de compañía en el área Identidad / Marca. Si hay producción creativa sin validación de marca, el sistema debe recomendar revisar promesa, tono y coherencia antes de crear más piezas.",
  taskActivationLogic: [
    "Si hay productos nuevos, activar revisión de promesa del producto.",
    "Si hay campaña nueva, activar guía de mensaje para campaña.",
    "Si hay muchas ideas de diseño, activar validación de pertenencia a marca.",
    "Si hay cambios en Shopify, activar revisión de confianza de página/producto.",
    "Si no hay datos suficientes, activar mensaje central y coherencia semanal."
  ]
};


var STRATEGIC_ROLE_ID = "strategic_direction";
var STRATEGIC_ROLE_NAME = "Dirección estratégica del negocio";
var STRATEGIC_ROLE_TASK_BANK = [
  {
    id: "strategic_area_balance_audit",
    title: "Auditoría semanal de balance por área",
    description: "Medir en qué áreas se invirtió tiempo esta semana y comparar ese esfuerzo contra señales comerciales, operativas y de marca.",
    objective: "Detectar si el negocio está usando energía en el área correcta o si una parte crítica quedó descuidada.",
    estimatedMinutes: 45,
    intensity: "medium",
    frequency: "weekly",
    taskType: "audit",
    businessImpact: "Mejora la asignación de esfuerzo entre diseño, Shopify, marketing, ventas, finanzas y operación.",
    activationTags: ["base", "imbalance", "workload_high", "design_excess"],
    suggestedDayMoment: "preclose",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Tabla breve con áreas revisadas, señal observada, riesgo y corrección recomendada.",
    priorityBase: 105,
    ecosystemTemplateId: "ecosystem_strategic_area_balance_audit",
    checklist: [
      { title: "Registrar áreas trabajadas", detail: "Anota qué áreas tuvieron trabajo real esta semana: diseño, Shopify, marketing, ventas, finanzas, operación, archivos, dirección, marca. No evalúes todavía; primero levanta el mapa." },
      { title: "Comparar esfuerzo contra resultado", detail: "Para cada área, escribe qué produjo: venta, publicación, mejora de tienda, producto listo, decisión tomada, dato registrado o estabilidad operativa." },
      { title: "Detectar área excedida", detail: "Marca el área que recibió demasiado tiempo en comparación con su resultado. Ejemplo técnico: muchas horas de diseño sin producto listo, o muchas pruebas Shopify sin mejora visible de conversión." },
      { title: "Detectar área descuidada", detail: "Marca el área que no recibió atención suficiente aunque afecta venta o estabilidad. Ejemplo: no revisar métricas, no preparar promoción, no registrar costos." },
      { title: "Definir corrección semanal", detail: "Escribe una corrección concreta para la próxima semana: aumentar, reducir, pausar, delegar o cerrar una línea de trabajo. Debe ser una acción, no una opinión." }
    ],
    dataFields: ["Área excedida", "Área descuidada", "Dato que lo demuestra", "Corrección recomendada"]
  },
  {
    id: "strategic_weekly_priority_definition",
    title: "Definición de prioridad estratégica semanal",
    description: "Elegir una prioridad principal de negocio usando datos disponibles, capacidad real y estado actual del proyecto.",
    objective: "Cerrar la semana con una dirección clara para la siguiente, no con una lista infinita de intenciones.",
    estimatedMinutes: 35,
    intensity: "medium",
    frequency: "weekly",
    taskType: "priority",
    businessImpact: "Reduce dispersión y convierte diagnóstico en ejecución realista.",
    activationTags: ["base", "start_week", "planning"],
    suggestedDayMoment: "preclose",
    canUseLightDay: true,
    canUseProtectedDay: false,
    evidenceRequired: "Prioridad semanal escrita con motivo, área responsable y resultado esperado.",
    priorityBase: 100,
    ecosystemTemplateId: "ecosystem_strategic_weekly_priority",
    checklist: [
      { title: "Leer estado de ventas y tráfico", detail: "Revisa si hubo ventas, sesiones, conversiones o señales de intención. Si no hay datos, marca el vacío como dato útil: falta medición o falta tráfico." },
      { title: "Leer producción y marca", detail: "Revisa si hubo diseños, productos, textos, campañas o cambios de tienda. Evalúa si eso empuja venta, confianza o coherencia." },
      { title: "Leer capacidad real", detail: "Revisa disponibilidad, días protegidos, carga de trabajo e intensidad. La prioridad no debe exigir una semana que el equipo no puede sostener." },
      { title: "Elegir una prioridad dominante", detail: "Selecciona una sola prioridad principal: vender, ordenar tienda, cerrar productos, medir, crear campaña, corregir marca, limpiar operación o registrar datos." },
      { title: "Definir resultado medible", detail: "Escribe qué debe existir al final de la próxima semana para decir que la prioridad se cumplió." }
    ],
    dataFields: ["Prioridad elegida", "Motivo", "Resultado medible", "Área responsable"]
  },
  {
    id: "strategic_commercial_signal_review",
    title: "Revisión de tracción comercial",
    description: "Revisar señales de venta, intención, visitas, productos vistos, campañas y respuesta del mercado para decidir si el negocio está generando movimiento real.",
    objective: "Separar actividad interna de tracción comercial externa.",
    estimatedMinutes: 40,
    intensity: "medium",
    frequency: "weekly",
    taskType: "commercial_review",
    businessImpact: "Ayuda a decidir si la semana necesita promoción, mejora de página, ajuste de producto o más medición.",
    activationTags: ["has_sales", "has_ads", "has_data", "has_products"],
    suggestedDayMoment: "preclose",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Resumen de señales comerciales: ventas, visitas, campañas, producto con interés y decisión derivada.",
    priorityBase: 90,
    ecosystemTemplateId: "ecosystem_strategic_commercial_signal",
    checklist: [
      { title: "Registrar ventas y pedidos", detail: "Anota ventas, órdenes y ticket promedio si existen. Si no hubo ventas, registra cero; el cero también orienta decisiones." },
      { title: "Registrar tráfico o exposición", detail: "Anota sesiones, visitas, alcance, clicks o señales disponibles. Sin tráfico, no se puede juzgar producto con justicia." },
      { title: "Relacionar producto con señal", detail: "Identifica qué producto, diseño o colección recibió más atención, aunque no vendiera. Esto ayuda a separar interés de conversión." },
      { title: "Detectar bloqueo principal", detail: "Clasifica el bloqueo: falta tráfico, falta confianza, promesa débil, producto poco claro, precio/margen, página confusa o campaña sin dirección." },
      { title: "Escribir decisión comercial", detail: "Define la próxima acción comercial: impulsar un producto, mejorar página, revisar precio, crear campaña, recolectar datos o pausar." }
    ],
    dataFields: ["Ventas", "Tráfico/señal", "Producto con interés", "Bloqueo principal", "Decisión comercial"]
  },
  {
    id: "strategic_shopify_conversion_review",
    title: "Revisión técnica de conversión Shopify",
    description: "Revisar si la tienda y las páginas de producto están listas para convertir tráfico en confianza y compra.",
    objective: "Detectar fricciones concretas en página, producto, mensaje, mockups, precio, botón y flujo móvil.",
    estimatedMinutes: 45,
    intensity: "medium",
    frequency: "weekly",
    taskType: "shopify_review",
    businessImpact: "Evita enviar tráfico a una página que todavía no explica, convence o guía la compra.",
    activationTags: ["has_products", "has_audit", "shopify_change"],
    suggestedDayMoment: "middle",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Checklist Shopify con fricción detectada y corrección priorizada.",
    priorityBase: 82,
    ecosystemTemplateId: "ecosystem_strategic_shopify_conversion",
    checklist: [
      { title: "Revisar primera impresión móvil", detail: "Abre la tienda en móvil. Verifica si en 5 segundos se entiende qué vende The 86 Club, para quién es y por qué importa." },
      { title: "Revisar página de producto", detail: "Comprueba título, mockups, descripción, precio, variantes, guía de talla y botón. Busca fricción concreta, no opiniones vagas." },
      { title: "Revisar promesa de compra", detail: "Confirma si el producto vende identidad de cocina/servicio o solo muestra una gráfica. Si la razón de compra no está clara, marca riesgo." },
      { title: "Revisar confianza", detail: "Busca señales de confianza: calidad visual, coherencia, políticas, tracking, contacto, branding y limpieza. Registra lo que falte." },
      { title: "Priorizar una corrección", detail: "No intentes arreglar toda la tienda. Elige la fricción que más puede afectar conversión esta semana." }
    ],
    dataFields: ["Página revisada", "Fricción principal", "Riesgo", "Corrección priorizada"]
  },
  {
    id: "strategic_finance_efficiency_review",
    title: "Revisión de inversión vs resultado",
    description: "Comparar inversión, gasto publicitario, costos registrados y ventas para saber si el negocio está aprendiendo o solo consumiendo recursos.",
    objective: "Mantener control financiero básico antes de aumentar producción o promoción.",
    estimatedMinutes: 35,
    intensity: "medium",
    frequency: "weekly",
    taskType: "finance_review",
    businessImpact: "Protege capital, margen y decisiones de crecimiento.",
    activationTags: ["has_investment", "has_ads", "has_sales", "has_data"],
    suggestedDayMoment: "preclose",
    canUseLightDay: true,
    canUseProtectedDay: false,
    evidenceRequired: "Resumen de inversión, ads, ventas, balance simple y recomendación financiera.",
    priorityBase: 78,
    ecosystemTemplateId: "ecosystem_strategic_finance_efficiency",
    checklist: [
      { title: "Registrar inversión de la semana", detail: "Anota costos reales: muestras, herramientas, diseños, Shopify, dominio, ads, mockups, apps, envío o cualquier gasto operativo." },
      { title: "Registrar ventas e ingresos", detail: "Anota ventas netas o brutas disponibles. Si no hay ventas, registra cero para que el sistema no infle lectura positiva." },
      { title: "Comparar ads contra señal", detail: "Si hubo gasto en anuncios, revisa clicks, visitas, costo por resultado y si produjo aprendizaje medible." },
      { title: "Detectar fuga o inversión útil", detail: "Clasifica el gasto: inversión útil, prueba necesaria, fuga por falta de datos, o gasto que debe pausarse." },
      { title: "Definir recomendación financiera", detail: "Escribe si la próxima semana conviene invertir, contener gasto, medir mejor, o mover presupuesto a otra área." }
    ],
    dataFields: ["Inversión", "Ventas", "Ads", "Lectura", "Recomendación financiera"]
  },
  {
    id: "strategic_operational_risk_review",
    title: "Revisión de riesgo operativo",
    description: "Comprobar si archivos, decisiones, responsables, datos y cierres están ordenados para que el negocio no dependa de memoria o improvisación.",
    objective: "Detectar puntos donde el sistema puede romper continuidad: archivos perdidos, decisiones no registradas, tareas sin evidencia o roles confusos.",
    estimatedMinutes: 30,
    intensity: "medium",
    frequency: "weekly",
    taskType: "operations_review",
    businessImpact: "Mejora estabilidad interna y evita repetir trabajo.",
    activationTags: ["base", "decisions_pending", "operation", "files"],
    suggestedDayMoment: "middle",
    canUseLightDay: true,
    canUseProtectedDay: false,
    evidenceRequired: "Riesgo operativo identificado, severidad y acción de control.",
    priorityBase: 72,
    ecosystemTemplateId: "ecosystem_strategic_operational_risk",
    checklist: [
      { title: "Revisar archivos críticos", detail: "Confirma que diseños, mockups, documentos, links de Drive y versiones estén registrados o ubicables." },
      { title: "Revisar decisiones abiertas", detail: "Busca decisiones sin estado claro. Una decisión abierta demasiado tiempo bloquea avance aunque no parezca urgente." },
      { title: "Revisar responsables", detail: "Comprueba si las tareas tienen usuario, rol o evidencia asignada. Si nadie responde por algo, no es tarea; es ruido." },
      { title: "Detectar riesgo principal", detail: "Elige el riesgo que más puede romper continuidad esta semana: archivo, dato, decisión, rol, página, producto o comunicación." },
      { title: "Definir control", detail: "Escribe una acción de control: registrar, mover, cerrar, asignar, archivar, documentar o limpiar." }
    ],
    dataFields: ["Riesgo", "Severidad", "Área", "Control requerido"]
  },
  {
    id: "strategic_decision_log_review",
    title: "Registro de decisión crítica del negocio",
    description: "Guardar una decisión relevante con motivo, alternativa descartada, evidencia y efecto esperado.",
    objective: "Crear memoria estratégica para que el equipo no decida dos veces lo mismo.",
    estimatedMinutes: 20,
    intensity: "low",
    frequency: "as_needed",
    taskType: "decision_log",
    businessImpact: "Aumenta continuidad y calidad de decisiones futuras.",
    activationTags: ["decision_made", "decisions_pending", "manual"],
    suggestedDayMoment: "any",
    canUseLightDay: true,
    canUseProtectedDay: false,
    evidenceRequired: "Decisión registrada con contexto, motivo y siguiente efecto esperado.",
    priorityBase: 60,
    ecosystemTemplateId: "ecosystem_strategic_decision_log",
    checklist: [
      { title: "Escribir decisión", detail: "Registra la decisión en una frase clara. Ejemplo: impulsar un producto, pausar una línea, cambiar prioridad, ajustar página o sostener presupuesto." },
      { title: "Registrar evidencia", detail: "Anota qué dato, observación o problema justifica la decisión." },
      { title: "Registrar alternativa descartada", detail: "Escribe qué opción no se hará y por qué. Esto evita volver al mismo debate la próxima semana." },
      { title: "Definir efecto esperado", detail: "Indica qué debería cambiar si la decisión fue correcta: ventas, claridad, carga, orden, velocidad o confianza." }
    ],
    dataFields: ["Decisión", "Evidencia", "Alternativa descartada", "Efecto esperado"]
  }
];



var BRAND_ROLE_ID = "brand_direction";
var BRAND_ROLE_NAME = "Dirección de marca";
var BRAND_ROLE_TASK_BANK = [
  {
    id: "weekly_brand_coherence_evaluation",
    title: "Evaluación semanal de coherencia de marca",
    description: "Revisar los diseños nuevos, frases utilizadas, páginas/productos y mensajes activos para detectar si The 86 Club mantiene identidad, promesa y tono.",
    objective: "Cerrar la semana con una lectura clara de si la marca se está fortaleciendo o diluyendo.",
    estimatedMinutes: 60,
    intensity: "medium",
    frequency: "weekly",
    taskType: "brand_coherence_audit",
    businessImpact: "Evita que los diseños nuevos y textos de venta se conviertan en piezas bonitas pero genéricas o fuera de marca.",
    activationTags: ["base", "weekly", "new_designs", "brand_audit"],
    suggestedDayMoment: "preclose",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Formulario de coherencia completado: diseños revisados, frases usadas, riesgos detectados y conclusión de marca.",
    priorityBase: 110,
    ecosystemTemplateId: "ecosystem_brand_weekly_coherence"
  },
  {
    id: "define_weekly_brand_message",
    title: "Definir mensaje central de la semana",
    description: "Elegir el mensaje o ángulo de marca que guiará productos, posts, emails o campañas de la semana.",
    objective: "Evitar piezas sueltas sin una idea común de marca.",
    estimatedMinutes: 30,
    intensity: "medium",
    frequency: "weekly",
    taskType: "brand_message",
    businessImpact: "Hace que la comunicación de la semana se sienta intencional, no improvisada.",
    activationTags: ["base", "content", "campaign"],
    suggestedDayMoment: "start",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Mensaje central escrito y ejemplos de dónde se aplicará.",
    priorityBase: 85,
    ecosystemTemplateId: "ecosystem_brand_weekly_message"
  },
  {
    id: "validate_new_garments_brand_fit",
    title: "Validar prendas nuevas contra perfil de marca",
    description: "Evaluar hasta dos prendas/diseños nuevos usando frases, intención, estilo, colección y conexión con cocina/servicio.",
    objective: "Comprobar que lo que se intentó crear coincide con lo que terminó saliendo.",
    estimatedMinutes: 50,
    intensity: "medium",
    frequency: "weekly",
    taskType: "garment_brand_fit",
    businessImpact: "Reduce el riesgo de lanzar prendas que se ven bien pero no pertenecen al universo de The 86 Club.",
    activationTags: ["new_designs", "design_excess", "product_review"],
    suggestedDayMoment: "preclose",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Diseño 1 y 2 revisados con frases usadas, estilo, promesa y riesgo de coherencia.",
    priorityBase: 95,
    ecosystemTemplateId: "ecosystem_brand_garment_fit"
  },
  {
    id: "review_product_promise",
    title: "Revisar promesa del producto",
    description: "Comprobar que el producto comunica una razón clara de compra y no solo una gráfica sobre una camiseta.",
    objective: "Conectar el producto con cultura, identidad, utilidad emocional y venta.",
    estimatedMinutes: 30,
    intensity: "medium",
    frequency: "as_needed",
    taskType: "product_promise",
    businessImpact: "Mejora descripciones, páginas y campañas porque aclara qué está comprando realmente el cliente.",
    activationTags: ["has_products", "product_review", "campaign"],
    suggestedDayMoment: "middle",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Promesa del producto y ajuste recomendado.",
    priorityBase: 75,
    ecosystemTemplateId: "ecosystem_brand_product_promise"
  },
  {
    id: "review_key_text_tone",
    title: "Revisar tono de textos clave",
    description: "Revisar descripciones, captions, banners o emails para confirmar que suenan a The 86 Club.",
    objective: "Evitar que la voz de marca cambie entre producto, tienda y contenido.",
    estimatedMinutes: 35,
    intensity: "medium",
    frequency: "as_needed",
    taskType: "tone_review",
    businessImpact: "Mejora confianza y coherencia verbal en los puntos que el cliente sí lee.",
    activationTags: ["content", "campaign", "shopify_change"],
    suggestedDayMoment: "middle",
    canUseLightDay: true,
    canUseProtectedDay: false,
    evidenceRequired: "Texto revisado, ajuste de tono y regla aprendida si aplica.",
    priorityBase: 70,
    ecosystemTemplateId: "ecosystem_brand_tone_review"
  },
  {
    id: "prepare_campaign_message_guide",
    title: "Preparar guía de mensaje para campaña",
    description: "Definir ángulo, promesa, tono, palabras permitidas y límites antes de promocionar producto o drop.",
    objective: "Evitar campañas que venden producto sin cultura ni razón de marca.",
    estimatedMinutes: 45,
    intensity: "medium",
    frequency: "as_needed",
    taskType: "campaign_message_guide",
    businessImpact: "Aumenta claridad antes de marketing orgánico o pagado y reduce desperdicio de creatividad.",
    activationTags: ["campaign", "has_ads", "promotion"],
    suggestedDayMoment: "start",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Guía breve de campaña: mensaje, tono, frase núcleo y límites.",
    priorityBase: 80,
    ecosystemTemplateId: "ecosystem_brand_campaign_guide"
  },
  {
    id: "detect_brand_dilution",
    title: "Detectar piezas que diluyen la marca",
    description: "Buscar piezas, frases, productos o campañas que se sienten genéricas, contradictorias o lejos de cocina/servicio.",
    objective: "Señalar dónde la marca pierde identidad antes de publicar o impulsar.",
    estimatedMinutes: 30,
    intensity: "medium",
    frequency: "weekly",
    taskType: "brand_dilution",
    businessImpact: "Protege que The 86 Club no parezca una tienda POD aleatoria.",
    activationTags: ["base", "new_designs", "content", "style_mix"],
    suggestedDayMoment: "preclose",
    canUseLightDay: false,
    canUseProtectedDay: false,
    evidenceRequired: "Lista de piezas en riesgo y motivo de dilución.",
    priorityBase: 78,
    ecosystemTemplateId: "ecosystem_brand_dilution"
  },
  {
    id: "create_brand_rule",
    title: "Crear regla de marca nueva",
    description: "Convertir una decisión de marca en regla reutilizable: esto sí es The 86 Club / esto no es The 86 Club.",
    objective: "Hacer que cada aprendizaje reduzca discusiones futuras.",
    estimatedMinutes: 20,
    intensity: "low",
    frequency: "as_needed",
    taskType: "brand_rule",
    businessImpact: "Fortalece el sistema de marca y acelera revisiones futuras.",
    activationTags: ["learning", "decision_made", "brand_audit"],
    suggestedDayMoment: "preclose",
    canUseLightDay: true,
    canUseProtectedDay: false,
    evidenceRequired: "Regla escrita y ejemplo de uso.",
    priorityBase: 55,
    ecosystemTemplateId: "ecosystem_brand_rule"
  },
  {
    id: "quick_brand_coherence_check",
    title: "Chequeo rápido de coherencia antes de publicar",
    description: "Hacer una revisión corta de tono, promesa y encaje antes de publicar una pieza.",
    objective: "Atrapar errores de coherencia sin abrir una revisión grande.",
    estimatedMinutes: 10,
    intensity: "low",
    frequency: "as_needed",
    taskType: "quick_check",
    businessImpact: "Evita publicar algo que contradice el universo de marca.",
    activationTags: ["content", "light_check", "campaign"],
    suggestedDayMoment: "any",
    canUseLightDay: true,
    canUseProtectedDay: false,
    evidenceRequired: "Aprobado / corregir / pausar con una nota breve.",
    priorityBase: 45,
    ecosystemTemplateId: "ecosystem_brand_quick_check"
  },
  {
    id: "register_not_the86",
    title: "Registrar ‘esto no es The 86 Club’",
    description: "Guardar una idea, frase o estilo descartado porque no encaja con la marca.",
    objective: "Construir límites claros para evitar repetir errores.",
    estimatedMinutes: 15,
    intensity: "low",
    frequency: "as_needed",
    taskType: "brand_boundary",
    businessImpact: "Hace más fácil decidir rápido en futuros diseños o campañas.",
    activationTags: ["learning", "discarded", "brand_audit"],
    suggestedDayMoment: "any",
    canUseLightDay: true,
    canUseProtectedDay: false,
    evidenceRequired: "Qué se descartó y por qué no pertenece a The 86 Club.",
    priorityBase: 35,
    ecosystemTemplateId: "ecosystem_brand_boundary"
  }
];

function normalizeRoleText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function profileHasStrategicRole(profile = {}) {
  const primary = normalizeRoleText(profile.primaryRole);
  const subs = normalizeRoleText(profile.subRoles);
  return primary === normalizeRoleText(STRATEGIC_ROLE_NAME) || subs.includes(normalizeRoleText(STRATEGIC_ROLE_NAME));
}


function profileHasBrandRole(profile = {}) {
  const primary = normalizeRoleText(profile.primaryRole);
  const subs = normalizeRoleText(profile.subRoles);
  return primary === normalizeRoleText(BRAND_ROLE_NAME) || subs.includes(normalizeRoleText(BRAND_ROLE_NAME));
}

function profileHasRoleName(profile = {}, roleName = "") {
  const primary = normalizeRoleText(profile.primaryRole);
  const subs = normalizeRoleText(profile.subRoles);
  return primary === normalizeRoleText(roleName) || subs.includes(normalizeRoleText(roleName));
}

function profileRoleLabels(profile = {}) {
  const roles = [];
  if (profile.primaryRole && !["Pendiente", "Sin asignar"].includes(profile.primaryRole)) roles.push(profile.primaryRole);
  if (profile.subRoles) String(profile.subRoles).split(",").map(x => x.trim()).filter(Boolean).forEach(x => roles.push(x));
  return roles;
}

function workspaceSignals(profileId) {
  const allTasks = cache.profileWeeklyTasks || [];
  const profileTasks = allTasks.filter(t => t.profileId === profileId);
  const decisionsPending = (cache.decisions || []).filter(d => !["closed", "completado", "done"].includes(String(d.status || "").toLowerCase())).length;
  const salesTotal = (cache.salesEntries || []).reduce((a, x) => a + num(x.netSales || x.grossSales), 0);
  const adSpend = (cache.adEntries || []).reduce((a, x) => a + num(x.amountSpent), 0);
  const investmentTotal = (cache.investments || []).reduce((a, x) => a + num(x.amount), 0);
  const designishTasks = profileTasks.filter(t => /diseñ|design|mockup|visual|arte|photoshop|producci/i.test(`${t.title || ""} ${t.description || ""} ${t.roleName || ""}`)).length;
  const marketingishTasks = profileTasks.filter(t => /marketing|promoci|ads|anuncio|instagram|tráfico|trafico|contenido|comunidad/i.test(`${t.title || ""} ${t.description || ""} ${t.roleName || ""}`)).length;
  const workload = cache.profiles?.find(p => p.id === profileId) ? weeklyWorkloadReport(cache.profiles.find(p => p.id === profileId), profileTasks) : null;
  return {
    decisionsPending,
    hasSales: salesTotal > 0,
    hasAds: adSpend > 0,
    hasInvestment: investmentTotal > 0,
    salesTotal,
    adSpend,
    investmentTotal,
    designishTasks,
    marketingishTasks,
    marketingLow: designishTasks >= 2 && marketingishTasks === 0,
    tasksPending: profileTasks.filter(t => t.status !== "completed").length,
    existingStrategic: profileTasks.filter(t => (t.roleId === STRATEGIC_ROLE_ID || t.roleName === STRATEGIC_ROLE_NAME) && !isObsoleteRoleTask(t)),
    existingBrand: profileTasks.filter(t => (t.roleId === BRAND_ROLE_ID || t.roleName === BRAND_ROLE_NAME) && !isObsoleteRoleTask(t)),
    hasProducts: (cache.products || []).length > 0,
    hasPromotion: (cache.promotion || []).length > 0,
    hasAudit: (cache.audit || []).length > 0,
    hasDesignFiles: (cache.files || []).some(f => /design|mockup|arte|final|product/i.test(`${f.name || ""} ${f.category || ""} ${f.notes || ""}`)),
    saturatedDays: workload?.saturatedDays || 0,
    protectedWithTasks: workload?.protectedWithTasks || 0
  };
}

function scoreStrategicTask(task, signals) {
  let score = task.priorityBase || 50;
  if (task.activationTags?.includes("base")) score += 25;
  if (signals.decisionsPending && task.activationTags?.includes("decisions_pending")) score += 35;
  if ((signals.hasSales || signals.hasAds || signals.hasInvestment) && task.activationTags?.includes("has_data")) score += 20;
  if (signals.hasSales && task.activationTags?.includes("has_sales")) score += 25;
  if (signals.hasAds && task.activationTags?.includes("has_ads")) score += 25;
  if (signals.hasInvestment && task.activationTags?.includes("has_investment")) score += 15;
  if (signals.marketingLow && (task.activationTags?.includes("design_excess") || task.activationTags?.includes("marketing_low"))) score += 30;
  if (signals.tasksPending >= 4 && (task.activationTags?.includes("many_tasks") || task.activationTags?.includes("too_many_tasks"))) score += 25;
  if (signals.saturatedDays || signals.protectedWithTasks) {
    if (task.activationTags?.includes("workload_high") || task.activationTags?.includes("saturation")) score += 30;
  }
  return score;
}

function selectStrategicTasksForProfile(profile) {
  const signals = workspaceSignals(profile.id);
  const existingIds = new Set(signals.existingStrategic.map(t => t.roleTaskId || t.strategicTaskId).filter(Boolean));
  const candidates = STRATEGIC_ROLE_TASK_BANK
    .filter(t => !existingIds.has(t.id))
    .map(t => ({ ...t, score: scoreStrategicTask(t, signals) }))
    .sort((a, b) => b.score - a.score);
  const main = candidates.filter(t => t.frequency !== "as_needed" && t.taskType !== "check").slice(0, 3);
  let selected = main.length ? main : candidates.slice(0, 3);
  const shouldAddLight = selected.length < 4 && !selected.some(t => t.id === "quick_direction_check");
  const light = candidates.find(t => t.id === "quick_direction_check") || candidates.find(t => t.canUseLightDay && !selected.some(s => s.id === t.id));
  if (shouldAddLight && light) selected = [...selected, light];
  return selected.slice(0, 4);
}


function scoreBrandTask(task, signals) {
  let score = task.priorityBase || 50;
  if (task.activationTags?.includes("base")) score += 25;
  if ((signals.hasProducts || signals.hasDesignFiles || signals.designishTasks > 0) && (task.activationTags?.includes("new_designs") || task.activationTags?.includes("product_review"))) score += 35;
  if ((signals.hasPromotion || signals.hasAds) && (task.activationTags?.includes("campaign") || task.activationTags?.includes("promotion") || task.activationTags?.includes("has_ads"))) score += 30;
  if (signals.hasAudit && task.activationTags?.includes("shopify_change")) score += 20;
  if (signals.marketingLow && task.activationTags?.includes("design_excess")) score += 25;
  if (signals.existingBrand?.length === 0 && task.id === "weekly_brand_coherence_evaluation") score += 45;
  if (signals.existingBrand?.length === 0 && task.id === "define_weekly_brand_message") score += 20;
  if (signals.saturatedDays || signals.protectedWithTasks) {
    if (task.intensity === "low" || task.canUseLightDay) score += 5;
    else score -= 12;
  }
  return score;
}

function selectBrandTasksForProfile(profile) {
  const signals = workspaceSignals(profile.id);
  const existingIds = new Set((signals.existingBrand || []).map(t => t.roleTaskId || t.brandTaskId).filter(Boolean));
  const candidates = BRAND_ROLE_TASK_BANK
    .filter(t => !existingIds.has(t.id))
    .map(t => ({ ...t, score: scoreBrandTask(t, signals) }))
    .sort((a, b) => b.score - a.score);
  const core = candidates.find(t => t.id === "weekly_brand_coherence_evaluation");
  let selected = core ? [core] : [];
  const main = candidates
    .filter(t => t.id !== "weekly_brand_coherence_evaluation" && t.intensity !== "low" && t.taskType !== "quick_check" && t.taskType !== "brand_boundary")
    .slice(0, 2);
  selected = [...selected, ...main].slice(0, 3);
  if (selected.length < 3 && signals.hasPromotion) {
    const light = candidates.find(t => !selected.some(s => s.id === t.id) && t.id === "quick_brand_coherence_check");
    if (light) selected.push(light);
  }
  return selected.slice(0, 4);
}

function getBrandBankTask(task = {}) {
  const taskId = task.roleTaskId || task.brandTaskId || task.id;
  return BRAND_ROLE_TASK_BANK.find(t => t.id === taskId) || null;
}

function getRoleBankTask(task = {}) {
  if (task.roleId === BRAND_ROLE_ID || task.roleName === BRAND_ROLE_NAME) return getBrandBankTask(task);
  if (task.roleId === STRATEGIC_ROLE_ID || task.roleName === STRATEGIC_ROLE_NAME) return getStrategicBankTask(task);
  return null;
}

function findBrandTaskDay(profile, task, currentTasks, alreadyPlanned = []) {
  const availability = normalizeAvailability(profile.availability);
  const preferredOrder = WEEK_DAYS.map(d => d.key);
  const closeIdx = preferredOrder.indexOf(availability.weeklyCloseDay);
  const startOrder = [...preferredOrder.slice(0, closeIdx >= 0 ? closeIdx : preferredOrder.length), ...preferredOrder.slice(closeIdx >= 0 ? closeIdx : preferredOrder.length)];
  const precloseOrder = closeIdx > 0 ? [preferredOrder[closeIdx - 1], availability.weeklyCloseDay, ...preferredOrder.filter((_, i) => i !== closeIdx - 1 && i !== closeIdx)] : [availability.weeklyCloseDay, ...preferredOrder.filter(k => k !== availability.weeklyCloseDay)];
  let order = task.suggestedDayMoment === "preclose" ? precloseOrder : task.suggestedDayMoment === "middle" ? ["wednesday", "thursday", "tuesday", "friday", "monday", "saturday", "sunday"] : startOrder;
  const scored = order.map(key => {
    const mode = availability.days[key]?.mode || "external_plus_business";
    let score = 0;
    if (mode === "business_available") score += 100;
    if (mode === "external_plus_business") score += 70;
    if (mode === "light" && task.canUseLightDay) score += 65;
    if (mode === "light" && !task.canUseLightDay) score += 15;
    if (mode === "external_only") score -= 45;
    if (mode === "protected") score -= task.canUseProtectedDay ? 20 : 125;
    if (alreadyPlanned.some(t => t.assignedDay === key && t.roleId === BRAND_ROLE_ID)) score += 45;
    const projected = dayProjectedPercent(profile, key, currentTasks, [...alreadyPlanned.filter(t => t.assignedDay === key), task]);
    if (projected <= 45) score += 30;
    else if (projected <= 70) score += 15;
    else if (projected <= 90) score -= 15;
    else score -= 60;
    return { key, score, projected, mode };
  }).sort((a,b) => b.score - a.score);
  return scored[0] || { key: "monday", projected: 0, mode: "business_available" };
}

function buildBrandWeeklyTask(profile, task, assignedDay) {
  const notes = task.id === "weekly_brand_coherence_evaluation"
    ? `Objetivo: ${task.objective}\nEvidencia requerida: ${task.evidenceRequired}\n\nGuion previsto:\n- Diseño 1: nombre, colección/drop, frases utilizadas separadas por coma, estilo visual, intención y riesgo de coherencia.\n- Diseño 2: nombre, colección/drop, frases utilizadas separadas por coma, estilo visual, intención y riesgo de coherencia.\n- Página/producto/campaña: mensaje principal, promesa, confianza visual y coherencia con cocina/servicio.\n- Resultado: coherente / riesgo medio / fuera de marca y motivo.`
    : `Objetivo: ${task.objective}\nEvidencia requerida: ${task.evidenceRequired}`;
  return {
    profileId: profile.id,
    title: task.title,
    description: task.description,
    assignedDay,
    estimatedMinutes: task.estimatedMinutes,
    intensity: task.intensity,
    status: "pending",
    notes,
    source: "role",
    roleId: BRAND_ROLE_ID,
    roleName: BRAND_ROLE_NAME,
    roleTaskId: task.id,
    brandTaskId: task.id,
    taskType: task.taskType,
    businessImpact: task.businessImpact,
    activationConditions: (task.activationTags || []).join(", "),
    evidenceRequired: task.evidenceRequired,
    checklist: task.checklist || [],
    dataFields: task.dataFields || [],
    taskEcosystemEnabled: true,
    ecosystemTemplateId: task.ecosystemTemplateId,
    createdBy: currentUser?.email || "system"
  };
}

function brandRoleSummary(profile) {
  const activeRoles = profileRoleLabels(profile);
  const roleTasks = getProfileWeeklyTasks(profile.id).filter(t => t.roleId === BRAND_ROLE_ID || t.roleName === BRAND_ROLE_NAME);
  if (!profileHasBrandRole(profile)) {
    const current = activeRoles.length ? activeRoles.map(r => `<span>${escapeHtml(r)}</span>`).join("") : `<span>Sin rol asignado</span>`;
    return `<div class="role-connection muted-box role-visual-panel">
      <div class="role-visual-head">
        <div><span class="eyebrow">Roles activos</span><h4>Dirección de marca no activa</h4><p>Asigna este rol para evaluar coherencia de marca, frases, prendas nuevas, promesa y riesgo de marca genérica.</p></div>
        <span class="role-status-chip role-neutral">Pendiente</span>
      </div>
      <div class="role-active-tags">${current}</div>
      <div class="role-mini-bars">
        <div><span>MAR</span><i style="width:0%"></i><b>0</b></div>
        <div><span>TAR</span><i style="width:0%"></i><b>0</b></div>
        <div><span>COH</span><i style="width:0%"></i><b>0</b></div>
      </div>
      <div class="small-actions role-config-actions">
        <button class="soft-btn" data-edit-profile="${profile.id}">Configurar roles</button>
      </div>
    </div>`;
  }
  const pending = roleTasks.filter(t => t.status !== "completed").length;
  const completed = roleTasks.filter(t => t.status === "completed").length;
  const dayMap = roleTasks.reduce((acc, t) => { acc[t.assignedDay] = (acc[t.assignedDay] || 0) + 1; return acc; }, {});
  const busiest = Object.entries(dayMap).sort((a,b) => b[1]-a[1])[0];
  const totalWeighted = roleTasks.reduce((sum, t) => sum + weightedTaskMinutes(t), 0);
  const totalMinutes = roleTasks.reduce((sum, t) => sum + taskMinutes(t), 0);
  const completionPercent = roleTasks.length ? Math.round((completed / roleTasks.length) * 100) : 0;
  const taskPercent = Math.min(100, roleTasks.length * 34);
  const calendarPercent = busiest ? Math.min(100, busiest[1] * 42) : 0;
  const reviewCount = roleTasks.filter(t => /coherencia|marca|prenda|tono|promesa/i.test(t.title || "")).length;
  const reviewPercent = Math.min(100, reviewCount * 35);
  const taskBarState = pending >= 4 ? "state-red" : pending >= 3 ? "state-orange" : pending >= 2 ? "state-yellow" : roleTasks.length ? "state-green" : "state-neutral";
  const calendarState = busiest && busiest[1] >= 4 ? "state-red" : busiest && busiest[1] >= 3 ? "state-orange" : busiest ? "state-green" : "state-neutral";
  return `<div class="role-connection active-role-connection role-visual-panel brand-role-panel">
    <div class="role-visual-head">
      <div><span class="eyebrow">Rol activo</span><h4>Dirección de marca</h4><p>Este panel muestra cómo el rol cuida coherencia, prendas nuevas, frases, tono y promesa de The 86 Club.</p></div>
      <span class="role-status-chip role-brand">Conectado</span>
    </div>
    <div class="role-active-tags">
      ${activeRoles.map(r => `<span>${escapeHtml(r)}</span>`).join("")}
    </div>
    <div class="role-mini-bars">
      <div class="${roleTasks.length ? "state-green" : "state-neutral"}"><span>MAR</span><i style="width:${roleTasks.length ? 100 : 0}%"></i><b>${roleTasks.length ? "Activo" : "0"}</b></div>
      <div class="${taskBarState}"><span>TAR</span><i style="width:${taskPercent}%"></i><b>${roleTasks.length}</b></div>
      <div class="${calendarState}"><span>DÍA</span><i style="width:${calendarPercent}%"></i><b>${busiest ? dayLabel(busiest[0]).slice(0,3) : "—"}</b></div>
      <div class="${reviewPercent >= 70 ? "state-green" : reviewPercent >= 35 ? "state-yellow" : roleTasks.length ? "state-orange" : "state-neutral"}"><span>COH</span><i style="width:${reviewPercent}%"></i><b>${reviewCount}</b></div>
    </div>
    <div class="role-connection-stats"><span>${roleTasks.length} tareas</span><span>${completed} hechas</span><span>${pending} pendientes</span><span>${totalMinutes} min</span><span>${totalWeighted} min pond.</span></div>
    <div class="calendar-suggestion">Las tareas de este rol se generan y se trabajan en Equipo → Tareas a realizar. Este panel solo resume estado, carga y avance.</div>
  </div>`;
}

async function generateBrandTasks(profileId) {
  const profile = (cache.profiles || []).find(p => p.id === profileId);
  if (!profile) return;
  if (!profileHasBrandRole(profile)) {
    openInfoModal({ eyebrow: "Rol no asignado", title: "Dirección de marca no está activa", html: `<p>Primero asigna este rol como rol principal o subrol en el perfil. Después el sistema podrá generar tareas de coherencia de marca para la semana.</p>` });
    return;
  }
  const currentTasks = getProfileWeeklyTasks(profile.id);
  const selected = selectBrandTasksForProfile(profile);
  if (!selected.length) {
    await logActivity("skip_role_tasks", "profileWeeklyTasks", `No generó tareas de marca para ${profile.name || "perfil"}: ya existen o no hay selección necesaria.`);
    openInfoModal({ eyebrow: "Sin nuevas tareas", title: "No hay tareas de marca nuevas", html: `<p>Este perfil ya tiene las tareas base de Dirección de marca o no hay suficiente señal para agregar más sin generar revisión innecesaria.</p>` });
    return;
  }
  const planned = [];
  selected.forEach(task => {
    const best = findBrandTaskDay(profile, task, currentTasks, planned);
    planned.push(buildBrandWeeklyTask(profile, task, best.key));
  });
  const redDays = new Set();
  planned.forEach(t => {
    const projected = dayProjectedPercent(profile, t.assignedDay, currentTasks, planned.filter(x => x.assignedDay === t.assignedDay));
    if (projected >= 91) redDays.add(t.assignedDay);
  });
  const root = ensureModalRoot();
  root.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="record-modal wide-modal">
      <div class="modal-header">
        <div><span class="eyebrow">Generar tareas del rol</span><h2>Dirección de marca para ${escapeHtml(profile.name || "perfil")}</h2></div>
        <button class="icon-btn" data-modal-close aria-label="Cerrar">×</button>
      </div>
      <div class="learning-box modal-learning"><span class="eyebrow">Regla de marca</span><p>El sistema intenta crear una evaluación semanal de coherencia y solo agregar tareas necesarias. No debe convertir branding en perfeccionismo ni frenar producción sin motivo.</p></div>
      <div class="learning-box modal-learning"><span class="eyebrow">Evaluación de prendas</span><p>La tarea central revisará hasta dos diseños nuevos: frases separadas por coma, estilo visual, intención, colección/drop, promesa y riesgo de perder coherencia de marca.</p></div>
      ${redDays.size ? `<div class="calendar-suggestion warning-suggestion">Advertencia: la asignación podría dejar en rojo ${[...redDays].map(dayLabel).join(", ")}. Puedes guardar y luego mover tareas manualmente, o cancelar y ajustar disponibilidad.</div>` : `<div class="calendar-suggestion">La asignación queda dentro de una carga aceptable según la información disponible.</div>`}
      <div class="role-task-table"><div class="role-task-row head"><span>Tarea</span><span>Día</span><span>Tiempo</span><span>Intensidad</span></div>
        ${planned.map(t => `<div class="role-task-row"><div><strong>${escapeHtml(t.title)}</strong><p>${escapeHtml(t.businessImpact || "")}</p></div><span>${dayLabel(t.assignedDay)}</span><span>${t.estimatedMinutes} min</span><span>${intensityLabel(t.intensity)}</span></div>`).join("")}
      </div>
      <div class="modal-actions"><button type="button" class="soft-btn" data-modal-close>Cancelar</button><button type="button" class="primary-btn" id="confirmBrandTasks">Guardar tareas</button></div>
    </div>
  </div>`;
  root.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", closeModal));
  root.querySelector("#confirmBrandTasks").addEventListener("click", async () => {
    for (const task of planned) {
      await addDoc(workspaceCol("profileWeeklyTasks"), { ...task, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await logActivity("generate_role_tasks", "profileWeeklyTasks", `Generó ${planned.length} tareas de Dirección de marca para ${profile.name || "perfil"}`);
    closeModal();
  });
}

function brandTaskExtraDetail(task = {}, bank = null) {
  if (!(task.roleId === BRAND_ROLE_ID || task.roleName === BRAND_ROLE_NAME)) return "";
  const isCoherence = (bank?.id || task.brandTaskId || task.roleTaskId) === "weekly_brand_coherence_evaluation" || /coherencia/i.test(task.title || "");
  return `<div class="learning-box brand-task-guide"><span class="eyebrow">Guion de marca previsto</span>
    ${isCoherence ? `<p>Esta tarea debe recopilar datos concretos para que el sistema pueda detectar si la marca se fortalece o se diluye.</p>
    <ul>
      <li><strong>Diseño 1:</strong> nombre, colección/drop, frases utilizadas separadas por coma, estilo visual, intención y riesgo.</li>
      <li><strong>Diseño 2:</strong> nombre, colección/drop, frases utilizadas separadas por coma, estilo visual, intención y riesgo.</li>
      <li><strong>Página/producto/campaña:</strong> promesa, tono, confianza visual y conexión con cocina/servicio.</li>
      <li><strong>Resultado:</strong> coherente, riesgo medio o fuera de marca, con motivo.</li>
    </ul>` : `<p>Cuando esta tarea tenga su ecosistema completo, abrirá una pantalla grande con campos de marca, evidencia, criterios de coherencia y cierre guiado.</p>`}
  </div>`;
}

function getStrategicBankTask(task = {}) {
  const taskId = task.roleTaskId || task.strategicTaskId || task.id;
  return STRATEGIC_ROLE_TASK_BANK.find(t => t.id === taskId) || null;
}

function roleTaskStatusData(task = {}) {
  const isRole = task.source === "role" || task.roleId || task.roleName;
  if (!isRole) return { label: "Manual", className: "role-neutral" };
  if (task.roleId === STRATEGIC_ROLE_ID || task.roleName === STRATEGIC_ROLE_NAME) {
    return { label: "Dirección estratégica", className: "role-strategic" };
  }
  if (task.roleId === BRAND_ROLE_ID || task.roleName === BRAND_ROLE_NAME) {
    return { label: "Dirección de marca", className: "role-brand" };
  }
  return { label: task.roleName || "Rol", className: "role-neutral" };
}

function weightedMinutesForBankTask(t) {
  const w = INTENSITY_WEIGHT[t.intensity || "medium"] || INTENSITY_WEIGHT.medium;
  return Math.round((Number(t.estimatedMinutes) || 30) * w);
}

function dayProjectedPercent(profile, dayKey, tasks, extraTasks = []) {
  const dayTasks = [...tasks.filter(t => t.assignedDay === dayKey), ...extraTasks];
  const capacity = dayCapacityMinutes(profile.availability, dayKey);
  const weighted = dayTasks.reduce((sum, task) => sum + (task.roleTaskId ? weightedMinutesForBankTask(task) : weightedTaskMinutes(task)), 0);
  if (capacity <= 0) return weighted > 0 ? 999 : 0;
  return Math.round((weighted / capacity) * 100);
}

function findStrategicTaskDay(profile, task, currentTasks, alreadyPlanned = []) {
  const availability = normalizeAvailability(profile.availability);
  const preferredOrder = WEEK_DAYS.map(d => d.key);
  const closeIdx = preferredOrder.indexOf(availability.weeklyCloseDay);
  const startOrder = [...preferredOrder.slice(0, closeIdx >= 0 ? closeIdx : preferredOrder.length), ...preferredOrder.slice(closeIdx >= 0 ? closeIdx : preferredOrder.length)];
  const precloseOrder = closeIdx > 0 ? [preferredOrder[closeIdx - 1], availability.weeklyCloseDay, ...preferredOrder.filter((_, i) => i !== closeIdx - 1 && i !== closeIdx)] : [availability.weeklyCloseDay, ...preferredOrder.filter(k => k !== availability.weeklyCloseDay)];
  let order = task.suggestedDayMoment === "preclose" ? precloseOrder : task.suggestedDayMoment === "middle" ? ["wednesday", "thursday", "tuesday", "friday", "monday", "saturday", "sunday"] : startOrder;
  const scored = order.map(key => {
    const mode = availability.days[key]?.mode || "external_plus_business";
    let score = 0;
    if (mode === "business_available") score += 100;
    if (mode === "external_plus_business") score += 70;
    if (mode === "light" && task.canUseLightDay) score += 65;
    if (mode === "light" && !task.canUseLightDay) score += 20;
    if (mode === "external_only") score -= 40;
    if (mode === "protected") score -= task.canUseProtectedDay ? 20 : 120;
    if (alreadyPlanned.some(t => t.assignedDay === key && t.roleId === STRATEGIC_ROLE_ID)) score += 35;
    const projected = dayProjectedPercent(profile, key, currentTasks, [...alreadyPlanned.filter(t => t.assignedDay === key), task]);
    if (projected <= 45) score += 30;
    else if (projected <= 70) score += 15;
    else if (projected <= 90) score -= 15;
    else score -= 55;
    return { key, score, projected, mode };
  }).sort((a,b) => b.score - a.score);
  return scored[0] || { key: "monday", projected: 0, mode: "business_available" };
}

function buildStrategicWeeklyTask(profile, task, assignedDay) {
  return {
    profileId: profile.id,
    title: task.title,
    description: task.description,
    assignedDay,
    estimatedMinutes: task.estimatedMinutes,
    intensity: task.intensity,
    status: "pending",
    notes: `Objetivo: ${task.objective}\nEvidencia requerida: ${task.evidenceRequired}`,
    source: "role",
    roleId: STRATEGIC_ROLE_ID,
    roleName: STRATEGIC_ROLE_NAME,
    roleTaskId: task.id,
    strategicTaskId: task.id,
    taskType: task.taskType,
    businessImpact: task.businessImpact,
    evidenceRequired: task.evidenceRequired,
    checklist: task.checklist || [],
    dataFields: task.dataFields || [],
    taskEcosystemEnabled: true,
    ecosystemTemplateId: task.ecosystemTemplateId,
    createdBy: currentUser?.email || "system"
  };
}

function strategicRoleSummary(profile) {
  const activeRoles = profileRoleLabels(profile);
  const roleTasks = getProfileWeeklyTasks(profile.id).filter(t => t.roleId === STRATEGIC_ROLE_ID || t.roleName === STRATEGIC_ROLE_NAME);
  if (!profileHasStrategicRole(profile)) {
    const current = activeRoles.length ? activeRoles.map(r => `<span>${escapeHtml(r)}</span>`).join("") : `<span>Sin rol asignado</span>`;
    return `<div class="role-connection muted-box role-visual-panel">
      <div class="role-visual-head">
        <div><span class="eyebrow">Roles activos</span><h4>Dirección estratégica no activa</h4><p>Este perfil puede tener otros roles, pero todavía no tiene el rol que genera tareas de dirección, prioridades y equilibrio.</p></div>
        <span class="role-status-chip role-neutral">Pendiente</span>
      </div>
      <div class="role-active-tags">${current}</div>
      <div class="role-mini-bars">
        <div><span>ROL</span><i style="width:${activeRoles.length ? 100 : 0}%"></i><b>${activeRoles.length ? activeRoles.length : 0}</b></div>
        <div><span>TAR</span><i style="width:0%"></i><b>0</b></div>
        <div><span>CAL</span><i style="width:0%"></i><b>0</b></div>
      </div>
      <div class="small-actions role-config-actions">
        <button class="soft-btn" data-edit-profile="${profile.id}">Configurar roles</button>
      </div>
    </div>`;
  }
  const pending = roleTasks.filter(t => t.status !== "completed").length;
  const completed = roleTasks.filter(t => t.status === "completed").length;
  const dayMap = roleTasks.reduce((acc, t) => { acc[t.assignedDay] = (acc[t.assignedDay] || 0) + 1; return acc; }, {});
  const busiest = Object.entries(dayMap).sort((a,b) => b[1]-a[1])[0];
  const totalWeighted = roleTasks.reduce((sum, t) => sum + weightedTaskMinutes(t), 0);
  const totalMinutes = roleTasks.reduce((sum, t) => sum + taskMinutes(t), 0);
  const completionPercent = roleTasks.length ? Math.round((completed / roleTasks.length) * 100) : 0;
  const taskPercent = Math.min(100, roleTasks.length * 25);
  const calendarPercent = busiest ? Math.min(100, busiest[1] * 35) : 0;
  const roleBarState = roleTasks.length ? "state-green" : "state-neutral";
  const taskBarState = pending >= 4 ? "state-orange" : pending >= 2 ? "state-yellow" : roleTasks.length ? "state-green" : "state-neutral";
  const calendarState = busiest && busiest[1] >= 4 ? "state-red" : busiest && busiest[1] >= 3 ? "state-orange" : busiest ? "state-green" : "state-neutral";
  return `<div class="role-connection active-role-connection role-visual-panel">
    <div class="role-visual-head">
      <div><span class="eyebrow">Rol activo</span><h4>Dirección estratégica del negocio</h4><p>Este panel muestra cómo cae el rol en este perfil: tareas generadas, día donde se concentran y carga aproximada.</p></div>
      <span class="role-status-chip role-strategic">Conectado</span>
    </div>
    <div class="role-active-tags">
      ${activeRoles.map(r => `<span>${escapeHtml(r)}</span>`).join("")}
    </div>
    <div class="role-mini-bars">
      <div class="${roleBarState}"><span>ROL</span><i style="width:${roleTasks.length ? 100 : 0}%"></i><b>${roleTasks.length ? "Activo" : "0"}</b></div>
      <div class="${taskBarState}"><span>TAR</span><i style="width:${taskPercent}%"></i><b>${roleTasks.length}</b></div>
      <div class="${calendarState}"><span>DÍA</span><i style="width:${calendarPercent}%"></i><b>${busiest ? dayLabel(busiest[0]).slice(0,3) : "—"}</b></div>
      <div class="${completionPercent >= 80 ? "state-green" : completionPercent >= 40 ? "state-yellow" : roleTasks.length ? "state-orange" : "state-neutral"}"><span>HEC</span><i style="width:${completionPercent}%"></i><b>${completionPercent}%</b></div>
    </div>
    <div class="role-connection-stats"><span>${roleTasks.length} tareas</span><span>${completed} hechas</span><span>${pending} pendientes</span><span>${totalMinutes} min</span><span>${totalWeighted} min pond.</span></div>
    <div class="calendar-suggestion">Las tareas de este rol se generan y se trabajan en Equipo → Tareas a realizar. Este panel solo resume estado, carga y avance.</div>
  </div>`;
}

async function generateStrategicTasks(profileId) {
  const profile = (cache.profiles || []).find(p => p.id === profileId);
  if (!profile) return;
  if (!profileHasStrategicRole(profile)) {
    openInfoModal({ eyebrow: "Rol no asignado", title: "Dirección estratégica no está activa", html: `<p>Primero asigna este rol como rol principal o subrol en el perfil. Después el sistema podrá generar tareas estratégicas para la semana.</p>` });
    return;
  }
  const currentTasks = getProfileWeeklyTasks(profile.id);
  const selected = selectStrategicTasksForProfile(profile);
  if (!selected.length) {
    await logActivity("skip_role_tasks", "profileWeeklyTasks", `No generó tareas estratégicas para ${profile.name || "perfil"}: ya existen o no hay selección necesaria.`);
    openInfoModal({ eyebrow: "Sin nuevas tareas", title: "No hay tareas estratégicas nuevas", html: `<p>Este perfil ya tiene las tareas estratégicas base o no hay suficiente señal para agregar más sin generar ruido.</p>` });
    return;
  }
  const planned = [];
  selected.forEach(task => {
    const best = findStrategicTaskDay(profile, task, currentTasks, planned);
    planned.push(buildStrategicWeeklyTask(profile, task, best.key));
  });
  const redDays = new Set();
  planned.forEach(t => {
    const projected = dayProjectedPercent(profile, t.assignedDay, currentTasks, planned.filter(x => x.assignedDay === t.assignedDay));
    if (projected >= 91) redDays.add(t.assignedDay);
  });
  const root = ensureModalRoot();
  root.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="record-modal wide-modal">
      <div class="modal-header">
        <div><span class="eyebrow">Generar tareas del rol</span><h2>Dirección estratégica para ${escapeHtml(profile.name || "perfil")}</h2></div>
        <button class="icon-btn" data-modal-close aria-label="Cerrar">×</button>
      </div>
      <div class="learning-box modal-learning"><span class="eyebrow">Regla de salud</span><p>El sistema intenta agrupar por rol/día, evitar días protegidos y mantener la carga fuera de rojo. Si hay pocos días disponibles, puede juntar tareas, pero prioriza lo esencial.</p></div>
      ${redDays.size ? `<div class="calendar-suggestion warning-suggestion">Advertencia: la asignación podría dejar en rojo ${[...redDays].map(dayLabel).join(", ")}. Puedes guardar y luego mover tareas manualmente, o cancelar y ajustar disponibilidad.</div>` : `<div class="calendar-suggestion">La asignación queda dentro de una carga aceptable según la información disponible.</div>`}
      <div class="role-task-table"><div class="role-task-row head"><span>Tarea</span><span>Día</span><span>Tiempo</span><span>Intensidad</span></div>
        ${planned.map(t => `<div class="role-task-row"><div><strong>${escapeHtml(t.title)}</strong><p>${escapeHtml(t.businessImpact || "")}</p></div><span>${dayLabel(t.assignedDay)}</span><span>${t.estimatedMinutes} min</span><span>${intensityLabel(t.intensity)}</span></div>`).join("")}
      </div>
      <div class="modal-actions"><button type="button" class="soft-btn" data-modal-close>Cancelar</button><button type="button" class="primary-btn" id="confirmStrategicTasks">Guardar tareas</button></div>
    </div>
  </div>`;
  root.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", closeModal));
  root.querySelector("#confirmStrategicTasks").addEventListener("click", async () => {
    for (const task of planned) {
      await addDoc(workspaceCol("profileWeeklyTasks"), { ...task, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await logActivity("generate_role_tasks", "profileWeeklyTasks", `Generó ${planned.length} tareas de Dirección estratégica para ${profile.name || "perfil"}`);
    closeModal();
  });
}

const FIELD_SCHEMAS = {
  profiles: profileFieldSchema(),
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

function syncProfileRoleModalFilters(form) {
  const primarySelect = form?.elements?.primaryRole;
  if (!primarySelect) return;
  const primaryKey = normalizeRoleText(primarySelect.value);
  form.querySelectorAll(`.checkbox-option input[name="subRoles"]`).forEach(input => {
    const option = input.closest(".checkbox-option");
    const isSameAsPrimary = normalizeRoleText(input.value) === primaryKey;
    if (option) option.hidden = isSameAsPrimary;
    if (isSameAsPrimary) input.checked = false;
  });
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
      if (f.type === "checkboxGroup") {
        const raw = initial[f.name];
        const selected = new Set(String(raw || "").split(",").map(x => normalizeRoleText(x.trim())).filter(Boolean));
        form.querySelectorAll(`[name="${f.name}"]`).forEach(input => { input.checked = selected.has(normalizeRoleText(input.value)); });
        return;
      }
      const el = form.elements[f.name];
      if (!el) return;
      let val = initial[f.name];
      if (f.name === "subtasksText" && initial.subtasks) val = (initial.subtasks || []).map(s => s.title).join("\n");
      if (val === undefined || val === null || val === "") val = defaultForField(f);
      el.value = val;
    });
    syncProfileRoleModalFilters(form);
    form.elements.primaryRole?.addEventListener("change", () => syncProfileRoleModalFilters(form));
    root.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", () => { closeModal(); resolve(null); }));
    root.querySelector(".modal-backdrop").addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) { closeModal(); resolve(null); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = {};
      schema.forEach(f => {
        if (f.type === "checkboxGroup") {
          data[f.name] = [...form.querySelectorAll(`[name="${f.name}"]:checked`)].map(input => input.value.trim()).filter(Boolean).join(", ");
          return;
        }
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
  if (f.type === "select") { const opts = typeof f.options === "function" ? f.options() : (f.options || []); return opts[0] || ""; }
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
    const opts = typeof f.options === "function" ? f.options() : (f.options || []);
    return `<label class="field">${labelBlock}<div class="field-input-box"><select name="${f.name}" ${required}>${opts.map(o=>`<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join("")}</select></div></label>`;
  }
  if (f.type === "checkboxGroup") {
    const opts = (typeof f.options === "function" ? f.options() : (f.options || [])).filter(o => !/^(Pendiente|Sin asignar)$/i.test(String(o)));
    const helper = f.helper ? `<p class="field-helper">${escapeHtml(f.helper)}</p>` : "";
    return `<div class="field full checkbox-field">${labelBlock}<div class="field-input-box"><details class="checkbox-dropdown" open><summary>Seleccionar subroles disponibles</summary><div class="checkbox-options">${opts.map(o=>`<label class="checkbox-option"><input type="checkbox" name="${f.name}" value="${escapeAttr(o)}" /><span class="checkbox-label-text">${escapeHtml(o)}</span></label>`).join("")}</div></details>${helper}</div></div>`;
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
  renderRoles();
  renderTeamTasks();
  renderGeneric("products", "Producto", ["name", "collection", "heroStatus", "status", "notes"]);
  renderGeneric("audit", "Auditoría", ["section", "score", "status", "notes"]);
  renderGeneric("competitors", "Competidor", ["brand", "url", "score", "notes"]);
  renderGeneric("promotion", "Campaña/canal", ["name", "channel", "status", "notes"]);
  renderNewProjects();
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
      ${profileOperationsGraphCard(p)}
      <div class="profile-collapsible-body" id="profile-ops-${p.id}">
        <div class="profile-detail-grid">
          <div><span>Rol principal</span><strong>${p.primaryRole || "Pendiente"}</strong></div>
          <div><span>Subroles</span><strong>${p.subRoles || "Pendientes"}</strong></div>
        </div>
        ${strategicRoleSummary(p)}
        ${brandRoleSummary(p)}
        <div class="availability-summary">
          <div class="availability-head">
            <div><span class="eyebrow">Disponibilidad semanal</span><strong>Cierre: ${dayLabel(avStats.closeDay)}</strong></div>
            <span class="badge">Máx. ${avStats.maxHours || 3} h/día</span>
          </div>
          ${availabilityDistributionCard(p, { available: avStats.available, light: avStats.light, protectedDays: avStats.protectedDays, maxHours: avStats.maxHours, closeDay: avStats.closeDay, taskCount: getProfileWeeklyTasks(p.id).length, completed: getProfileWeeklyTasks(p.id).filter(t => t.status === "completed").length }, avStats)}
        </div>
        ${profileWeekGuideCompact(p)}
        <p class="profile-notes">${p.notes || "Sin notas todavía. Este espacio debe usarse para límites, responsabilidades y contexto de trabajo."}</p>
        <div class="small-actions">
          <button class="soft-btn" data-edit-profile="${p.id}">Editar perfil</button>
          <button class="soft-btn" data-edit-availability="${p.id}">Disponibilidad semanal</button>
          <button class="soft-btn" data-profile-info="${p.id}">¿Por qué importa?</button>
        </div>
      </div>
      ${precloseCompactPanel(p)}
      <div class="profile-collapsible-body" id="profile-preclose-${p.id}">
        ${renderWeeklyPreClose(p, false)}
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
  $$(`[data-open-team-tasks]`).forEach(btn => btn.addEventListener("click", () => { localStorage.setItem("the86_team_tasks_profile", btn.dataset.openTeamTasks); switchView("teamTasks"); }));
  $$(`[data-weekly-task-detail]`).forEach(btn => btn.addEventListener("click", () => openWeeklyTaskDetail(btn.dataset.weeklyTaskDetail)));
  $$(`[data-calendar-help]`).forEach(btn => btn.addEventListener("click", () => openCalendarHelp(btn.dataset.calendarHelp)));
  $$(`[data-workload-help]`).forEach(btn => btn.addEventListener("click", () => openWorkloadHelp(btn.dataset.workloadHelp)));
  $$(`[data-availability-graph]`).forEach(btn => btn.addEventListener("click", () => openAvailabilityGraph(btn.dataset.availabilityGraph)));
  $$(`[data-workload-graph]`).forEach(btn => btn.addEventListener("click", () => openWorkloadGraph(btn.dataset.workloadGraph)));
  $$(`[data-preclose-graph]`).forEach(btn => btn.addEventListener("click", () => openPrecloseGraph(btn.dataset.precloseGraph)));
  $$(`[data-preclose-help]`).forEach(btn => btn.addEventListener("click", () => openPreCloseHelp(btn.dataset.precloseHelp)));
  $$(`[data-toggle-profile-ops]`).forEach(btn => btn.addEventListener("click", () => toggleProfilePanel(`profile-ops-${btn.dataset.toggleProfileOps}`, btn)));
  $$(`[data-toggle-preclose-details]`).forEach(btn => btn.addEventListener("click", () => toggleProfilePanel(`profile-preclose-${btn.dataset.togglePrecloseDetails}`, btn)));
  $$(`[data-prepare-next-week]`).forEach(btn => btn.addEventListener("click", () => prepareNextWeek(btn.dataset.prepareNextWeek)));
  $$(`[data-add-weekly-task]`).forEach(btn => btn.addEventListener("click", () => {
    const [profileId, dayKey] = btn.dataset.addWeeklyTask.split(":");
    addWeeklyTask(profileId, dayKey);
  }));
  $$(`[data-move-weekly-task]`).forEach(btn => btn.addEventListener("click", () => moveWeeklyTask(btn.dataset.moveWeeklyTask)));
  $$(`[data-toggle-weekly-task]`).forEach(btn => btn.addEventListener("click", () => toggleWeeklyTask(btn.dataset.toggleWeeklyTask)));
}


function toggleProfilePanel(id, btn) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const isOpen = panel.classList.toggle("is-open");
  if (btn) btn.textContent = isOpen ? "Cerrar" : (id.includes("preclose") ? "Abrir cierre" : "Abrir configuración");
}

function dayLabel(key) {
  return WEEK_DAYS.find(d => d.key === key)?.label || "Domingo";
}



function taskChecklistItems(task = {}, bank = null) {
  if (Array.isArray(task.checklist) && task.checklist.length) return task.checklist;
  if (Array.isArray(bank?.checklist) && bank.checklist.length) return bank.checklist;
  if (task.roleId === BRAND_ROLE_ID || task.roleName === BRAND_ROLE_NAME) {
    return [
      { title: "Revisar intención", detail: "Define qué debía lograr esta pieza o revisión: vender, aclarar marca, validar prenda, corregir texto o preparar campaña." },
      { title: "Registrar datos usados", detail: "Escribe frases, productos, páginas, campañas o piezas revisadas. Sin dato registrado, la tarea queda como opinión." },
      { title: "Evaluar coherencia", detail: "Compara el resultado contra cocina/servicio, tono, promesa, estilo visual y riesgo de parecer genérico." },
      { title: "Definir corrección", detail: "Anota qué se aprueba, qué se corrige y qué no debe repetirse." }
    ];
  }
  if (task.roleId === STRATEGIC_ROLE_ID || task.roleName === STRATEGIC_ROLE_NAME) {
    return [
      { title: "Abrir sección conectada", detail: "Usa el botón de ruta de trabajo de esta tarea. No busques la sección a mano: la tarea debe empujarte al lugar correcto del workspace." },
      { title: "Registrar el dato específico", detail: "Completa el formulario o registro de esa sección. La tarea solo cuenta si queda un dato real: venta, tráfico, costo, decisión, auditoría, producto o riesgo." },
      { title: "Confirmar lectura técnica", detail: "Vuelve a la tarea y revisa si el dato registrado responde al objetivo técnico de esta tarea. No cierres por opinión; cierra por dato registrado." }
    ];
  }
  return [
    { title: "Entender la tarea", detail: "Lee el objetivo y define qué resultado concreto debe existir al terminar." },
    { title: "Ejecutar acción principal", detail: "Realiza el trabajo indicado y guarda evidencia útil." },
    { title: "Cerrar con nota", detail: "Escribe resultado, obstáculo o siguiente paso." }
  ];
}

function taskDataFields(task = {}, bank = null) {
  if (Array.isArray(task.dataFields) && task.dataFields.length) return task.dataFields;
  if (Array.isArray(bank?.dataFields) && bank.dataFields.length) return bank.dataFields;
  if (task.roleId === BRAND_ROLE_ID || task.roleName === BRAND_ROLE_NAME) return ["Pieza/diseño revisado", "Frases usadas", "Riesgo de coherencia", "Corrección"];
  if (task.roleId === STRATEGIC_ROLE_ID || task.roleName === STRATEGIC_ROLE_NAME) return ["Dato revisado", "Señal encontrada", "Riesgo", "Acción correctiva"];
  return ["Resultado", "Evidencia", "Siguiente paso"];
}

function openTaskExecution(taskId) {
  const task = (cache.profileWeeklyTasks || []).find(t => t.id === taskId);
  if (!task) return;
  const bank = getRoleBankTask(task);
  const roleData = roleTaskStatusData(task);
  const target = taskWorkTarget(task, bank);
  const checklist = taskChecklistItems(task, bank);
  const fields = taskDataFields(task, bank);
  openInfoModal({
    eyebrow: `Iniciar tarea · ${roleData.label}`,
    title: task.title || "Tarea",
    html: `<div class="task-execution-shell ${roleData.className}">
      <div class="role-task-detail-hero ${roleData.className}">
        <div><span class="eyebrow">Trabajo de hoy</span><strong>${dayLabel(task.assignedDay)}</strong><p>${taskMinutes(task)} min · intensidad ${intensityLabel(task.intensity)} · ${taskStatusLabel(task.status)}</p></div>
        <div><span class="eyebrow">Criterio de cierre</span><strong>Con evidencia</strong><p>${escapeHtml(task.evidenceRequired || bank?.evidenceRequired || "Resultado verificable guardado.")}</p></div>
      </div>
      <details class="execution-block" open>
        <summary>Checklist de preparación y ejecución</summary>
        <div class="execution-steps">
          ${checklist.map((item, index) => `<details class="execution-step"><summary><span class="step-number">${index + 1}</span><strong>${escapeHtml(item.title || item)}</strong></summary><p>${escapeHtml(item.detail || "Ejecuta este paso y registra evidencia si aplica.")}</p></details>`).join("")}
        </div>
      </details>
      <details class="execution-block" open>
        <summary>Ruta de trabajo dentro del workspace</summary>
        <div class="learning-box"><span class="eyebrow">Sección conectada</span><p>${escapeHtml(target.reason)}</p></div>
        <button class="primary-btn" data-task-route="${task.id}">${escapeHtml(target.label)}</button>
      </details>
      <details class="execution-block">
        <summary>Datos que debes dejar listos</summary>
        <div class="data-field-grid">
          ${fields.map(field => `<div class="data-field-chip"><span>${escapeHtml(field)}</span></div>`).join("")}
        </div>
        <p class="muted">Por ahora estos campos son guía de ejecución. En el ecosistema futuro serán campos editables conectados al cierre semanal.</p>
      </details>
      <details class="execution-block">
        <summary>Enfoque técnico de la tarea</summary>
        <div class="learning-box"><span class="eyebrow">Objetivo</span><p>${escapeHtml(bank?.objective || task.description || "Completar la tarea con dirección y evidencia.")}</p></div>
        <div class="learning-box"><span class="eyebrow">Impacto esperado</span><p>${escapeHtml(task.businessImpact || bank?.businessImpact || "Mejorar decisión, orden o avance real del negocio.")}</p></div>
      </details>
      <div class="modal-actions left-actions">
        <button class="soft-btn" data-weekly-task-detail="${task.id}">Ver detalles completos</button>
        <button class="primary-btn" data-toggle-weekly-task="${task.id}">${task.status === "completed" ? "Reabrir tarea" : "Marcar como completada"}</button>
      </div>
    </div>`
  });
  $$(`[data-weekly-task-detail]`).forEach(btn => btn.addEventListener("click", () => openWeeklyTaskDetail(btn.dataset.weeklyTaskDetail)));
  $$(`[data-task-route]`).forEach(btn => btn.addEventListener("click", () => navigateTaskTarget(btn.dataset.taskRoute)));
  $$(`[data-toggle-weekly-task]`).forEach(btn => btn.addEventListener("click", () => toggleWeeklyTask(btn.dataset.toggleWeeklyTask)));
}

function openWeeklyTaskDetail(taskId) {
  const task = (cache.profileWeeklyTasks || []).find(t => t.id === taskId);
  if (!task) return;
  const bank = getRoleBankTask(task);
  const roleData = roleTaskStatusData(task);
  openInfoModal({
    eyebrow: roleData.label,
    title: task.title || "Tarea del rol",
    html: `
      <div class="role-task-detail-hero ${roleData.className}">
        <div><span class="eyebrow">Dónde cae</span><strong>${dayLabel(task.assignedDay)}</strong><p>${taskMinutes(task)} min reales · ${weightedTaskMinutes(task)} min ponderados · intensidad ${intensityLabel(task.intensity)}</p></div>
        <div><span class="eyebrow">Estado</span><strong>${taskStatusLabel(task.status)}</strong><p>${task.taskEcosystemEnabled ? "Preparada para ecosistema de tarea futuro." : "Tarea básica."}</p></div>
      </div>
      <div class="learning-stack">
        <div class="learning-box"><span class="eyebrow">Objetivo</span><p>${escapeHtml(bank?.objective || task.description || "Completar esta tarea con evidencia clara para que el sistema pueda medir avance.")}</p></div>
        <div class="learning-box"><span class="eyebrow">Impacto esperado</span><p>${escapeHtml(task.businessImpact || bank?.businessImpact || "Ayuda a mantener el negocio alineado y evitar trabajo sin dirección.")}</p></div>
        <div class="learning-box"><span class="eyebrow">Evidencia requerida</span><p>${escapeHtml(task.evidenceRequired || bank?.evidenceRequired || "Resultado, link, decisión o nota de cierre.")}</p></div>
        <div class="learning-box"><span class="eyebrow">Conexión interna</span><p>${escapeHtml(taskStageLinkLabel(task, bank))}. La tarea debe empujar a registrar evidencia en la sección correcta del workspace, no quedarse como palomita vacía.</p></div>
        <div class="learning-box"><span class="eyebrow">Ecosistema futuro</span><p>Usa “Iniciar tarea” para abrir el checklist de ejecución, pasos accionables, datos requeridos, ruta interna y criterio de cierre.</p></div>
        ${brandTaskExtraDetail(task, bank)}
      </div>
      ${task.notes ? `<h3>Notas guardadas</h3><pre class="task-note-preview">${escapeHtml(task.notes)}</pre>` : ""}
    `
  });
}

function normalizeSubRoleSelection(subRoles = "", primaryRole = "", currentProfileId = "") {
  const primaryKey = normalizeRoleText(primaryRole);
  return uniqueClean(splitRoleList(subRoles))
    .filter(role => normalizeRoleText(role) !== primaryKey && !/^(pendiente|sin asignar)$/i.test(role))
    .filter(role => !roleTakenByOtherProfiles(role, currentProfileId))
    .join(", ");
}

function normalizePrimaryRoleSelection(primaryRole = "", currentProfileId = "") {
  const role = String(primaryRole || "").trim();
  if (!role || /^(pendiente|sin asignar)$/i.test(role)) return "Pendiente";
  if (roleTakenByOtherProfiles(role, currentProfileId)) return "Pendiente";
  return role;
}

async function addProfile() {
  await openRecordModal({
    title: "Agregar perfil de equipo",
    collectionName: "Perfil",
    schema: profileFieldSchema({}),
    onSave: async (data) => {
      data.primaryRole = normalizePrimaryRoleSelection(data.primaryRole, "");
      data.subRoles = normalizeSubRoleSelection(data.subRoles, data.primaryRole, "");
      await addDoc(workspaceCol("profiles"), { ...data, createdBy: currentUser.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await logActivity("create_profile", "profiles", `Creó perfil de equipo: ${data.name}`);
    }
  });
}


async function quickAssignRole(payload = "") {
  const [profileId, ...roleParts] = String(payload).split(":");
  const roleName = roleParts.join(":").trim();
  const profile = (cache.profiles || []).find(x => x.id === profileId);
  if (!profile || !roleName) return;
  if (roleTakenByOtherProfiles(roleName, profileId)) {
    openInfoModal({ eyebrow: "Rol ocupado", title: `${roleName} ya está asignado`, html: `<p>Ese rol ya pertenece a otro perfil como rol principal o subrol. Para moverlo, primero libéralo en el otro perfil.</p>` });
    return;
  }
  const currentPrimary = String(profile.primaryRole || "").trim();
  const currentSubs = splitRoleList(profile.subRoles);
  const alreadyPrimary = normalizeRoleText(currentPrimary) === normalizeRoleText(roleName);
  const alreadySub = currentSubs.some(x => normalizeRoleText(x) === normalizeRoleText(roleName));
  const patch = {};
  if (!currentPrimary || ["pendiente", "sin asignar"].includes(normalizeRoleText(currentPrimary))) {
    patch.primaryRole = roleName;
  } else if (!alreadyPrimary && !alreadySub) {
    patch.subRoles = [...currentSubs, roleName].join(", ");
  }
  if (!Object.keys(patch).length) {
    openInfoModal({ eyebrow: "Rol ya activo", title: `${roleName} ya está asignado`, html: `<p>Este perfil ya tiene ese rol como rol principal o subrol.</p>` });
    return;
  }
  await updateDoc(workspaceDoc("profiles", profileId), { ...patch, updatedAt: serverTimestamp() });
  await logActivity("assign_profile_role", "profiles", `Asignó ${roleName} a ${profile.name || "perfil"}`);
  openInfoModal({ eyebrow: "Rol asignado", title: `${roleName} quedó activo`, html: `<p>Ya puedes generar tareas del rol desde el panel del perfil.</p>` });
}

async function editProfile(id) {
  const profile = (cache.profiles || []).find(x => x.id === id);
  if (!profile) return;
  await openRecordModal({
    title: `Editar perfil: ${profile.name || "equipo"}`,
    collectionName: "Perfil",
    schema: profileFieldSchema(profile),
    initial: profile,
    onSave: async (data) => {
      data.primaryRole = normalizePrimaryRoleSelection(data.primaryRole, id);
      data.subRoles = normalizeSubRoleSelection(data.subRoles, data.primaryRole, id);
      await updateDoc(workspaceDoc("profiles", id), { ...data, updatedAt: serverTimestamp() });
      await logActivity("edit_profile", "profiles", `Actualizó perfil de equipo: ${data.name || profile.name}`);
      setTimeout(() => autoEnsureRoleTasksForProfile(id), 700);
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

function openWorkloadHelp(id) {
  const profile = (cache.profiles || []).find(x => x.id === id);
  openInfoModal({
    eyebrow: "Carga diaria y saturación",
    title: profile?.name ? `Cómo se calcula la carga de ${profile.name}` : "Cómo se calcula la carga",
    html: `<div class="learning-stack">
      <div class="learning-box"><span class="eyebrow">Qué mide</span><p>El sistema estima riesgo operativo. No mide cansancio real con precisión médica: compara tiempo, intensidad, tipo de día y disponibilidad para darte una brújula de trabajo.</p></div>
      <div class="learning-box"><span class="eyebrow">Tiempo base</span><p>Usa el máximo diario recomendado del perfil. La base inicial es 3 horas porque The 86 Club aún convive con trabajo externo y descanso personal.</p></div>
      <div class="learning-box"><span class="eyebrow">Tipo de día</span><p>Un día disponible usa capacidad completa. Trabajo externo reduce capacidad. Día ligero reduce más. Día protegido no debería recibir tareas automáticas y cualquier tarea ahí aumenta la alerta.</p></div>
      <div class="learning-box"><span class="eyebrow">Intensidad</span><p>Baja pesa 1.0, media pesa 1.2 y alta pesa 1.5. Una hora intensa no cansa igual que una hora de revisión suave.</p></div>
      <div class="learning-box"><span class="eyebrow">Lectura</span><p>Verde: sano. Amarillo: moderado. Naranja: alto. Rojo: saturado. Trabajar más no siempre significa avanzar mejor si se descuida descanso, marketing, ventas o análisis.</p></div>
    </div>`
  });
}


function openPreCloseHelp(id) {
  const profile = (cache.profiles || []).find(x => x.id === id);
  openInfoModal({
    eyebrow: "Pre-cierre semanal",
    title: profile?.name ? `Por qué revisar antes de cerrar — ${profile.name}` : "Por qué revisar antes de cerrar",
    html: `<div class="learning-stack">
      <div class="learning-box"><span class="eyebrow">Para qué existe</span><p>El pre-cierre evita llegar al cierre semanal sin contexto. Te permite ver avance, pendientes, carga y descanso antes de prometer otra semana heroica.</p></div>
      <div class="learning-box"><span class="eyebrow">Qué protege</span><p>Protege constancia, foco y energía. The 86 Club debe avanzar como negocio paralelo realista, no como una segunda jornada completa disfrazada de sueño bonito.</p></div>
      <div class="learning-box"><span class="eyebrow">Qué lee</span><p>Cuenta tareas hechas, pendientes, minutos, intensidad, días saturados y tareas colocadas en días protegidos. Todavía no es cierre final, es revisión previa.</p></div>
      <div class="learning-box"><span class="eyebrow">Cómo ayuda al negocio</span><p>Sirve para detectar si la semana se fue a operación manual, diseño, marketing, Shopify o datos. Más adelante esta lectura se conectará con roles y equilibrio de compañía.</p></div>
      <div class="learning-box"><span class="eyebrow">Siguiente semana</span><p>Antes de cerrar, puedes preparar disponibilidad futura. Eso evita planear desde ilusión y ayuda a repartir tareas según trabajo externo, descanso y horas máximas recomendadas.</p></div>
    </div>`
  });
}

function cloneAvailabilityForNextWeek(profile) {
  return normalizeAvailability(profile.availability);
}

async function prepareNextWeek(id) {
  const profile = (cache.profiles || []).find(x => x.id === id);
  if (!profile) return;
  const existing = getNextWeekPlan(id);
  const availability = normalizeAvailability(existing?.availability || cloneAvailabilityForNextWeek(profile));
  const root = document.querySelector("#modalRoot");
  root.innerHTML = `<div class="modal-backdrop active">
    <div class="modal-card wide-modal">
      <button class="modal-close" data-modal-close>×</button>
      <div class="modal-title"><span class="eyebrow">Preparar siguiente semana</span><h3>${escapeHtml(profile.name || "Perfil")}</h3><p>Confirma o ajusta la disponibilidad futura sin reemplazar todavía la semana actual. Esto quedará listo para el cierre semanal avanzado.</p></div>
      <div class="learning-box modal-learning"><span class="eyebrow">Por qué importa</span><p>Prometer demasiado para la próxima semana crea presión falsa. Esta configuración obliga a mirar trabajo externo, descanso y capacidad real antes de distribuir tareas.</p></div>
      <form id="nextWeekForm" class="record-form">
        <div class="form-grid">
          <label class="field">
            <div class="field-label-box"><span>Máximo recomendado de horas diarias</span><small>Base sana sugerida: 3 horas.</small></div>
            <div class="field-input-box"><input name="maxDailyBusinessHours" type="number" min="0" step="0.5" value="${escapeAttr(availability.maxDailyBusinessHours || 3)}" /></div>
          </label>
          <label class="field">
            <div class="field-label-box"><span>Día de cierre semanal propuesto</span><small>Mejor en día ligero o disponible.</small></div>
            <div class="field-input-box"><select name="weeklyCloseDay">${WEEK_DAYS.map(d => `<option value="${d.key}" ${availability.weeklyCloseDay === d.key ? "selected" : ""}>${d.label}</option>`).join("")}</select></div>
          </label>
        </div>
        <div class="availability-editor next-week-editor">
          ${WEEK_DAYS.map(d => {
            const day = availability.days[d.key] || {};
            return `<div class="availability-row">
              <div class="availability-row-title"><strong>${d.label}</strong><small>Define cómo tratar la próxima semana este día.</small></div>
              <select name="day_${d.key}_mode">${DAY_MODE_OPTIONS.map(o => `<option value="${o.value}" ${day.mode === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>
              <input name="day_${d.key}_hours" type="number" min="0" step="0.5" placeholder="Horas opcionales" value="${escapeAttr(day.customHours || "")}" />
            </div>`;
          }).join("")}
        </div>
        <label class="field full">
          <div class="field-label-box"><span>Notas para la próxima semana</span><small>Turnos, cansancio esperado, límites o prioridades.</small></div>
          <div class="field-input-box"><textarea name="notes" placeholder="Ejemplo: semana pesada en el trabajo, dejar domingo protegido.">${escapeHtml(availability.notes || existing?.notes || "")}</textarea></div>
        </label>
        <div class="modal-actions">
          <button type="button" class="soft-btn" data-modal-close>Cancelar</button>
          <button type="submit" class="primary-btn">Guardar siguiente semana</button>
        </div>
      </form>
    </div>
  </div>`;
  root.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", closeModal));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) closeModal(); });
  root.querySelector("#nextWeekForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const nextAvailability = {
      weeklyCloseDay: form.elements.weeklyCloseDay.value,
      maxDailyBusinessHours: Number(form.elements.maxDailyBusinessHours.value || 3),
      notes: form.elements.notes.value.trim(),
      days: {}
    };
    WEEK_DAYS.forEach(d => {
      nextAvailability.days[d.key] = {
        mode: form.elements[`day_${d.key}_mode`].value,
        customHours: form.elements[`day_${d.key}_hours`].value
      };
    });
    await setDoc(workspaceDoc("profileNextWeekPlans", id), {
      profileId: id,
      profileName: profile.name || "Perfil",
      availability: nextAvailability,
      notes: nextAvailability.notes,
      plannedCloseDay: nextAvailability.weeklyCloseDay,
      maxDailyBusinessHours: nextAvailability.maxDailyBusinessHours,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email,
      createdAt: existing?.createdAt || serverTimestamp(),
      createdBy: existing?.createdBy || currentUser.email
    }, { merge: true });
    await logActivity("prepare_next_week", "profiles", `${profile.name || "Perfil"} preparó disponibilidad para la próxima semana`);
    closeModal();
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
  const bank = getRoleBankTask(task);
  const target = taskWorkTarget(task, bank);
  await updateDoc(workspaceDoc("profileWeeklyTasks", taskId), { status: nextStatus, updatedAt: serverTimestamp(), updatedBy: currentUser.email, completedAt: nextStatus === "completed" ? serverTimestamp() : null, linkedView: target.view, linkedSection: target.section });
  await logActivity(nextStatus === "completed" ? "complete_weekly_task" : "reopen_weekly_task", "profiles", `${nextStatus === "completed" ? "Completó" : "Reabrió"} tarea semanal: ${task.title} · conecta con ${target.section}`);
  if (nextStatus === "completed") localStorage.setItem("the86_weekly_execution_changed", "true");
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


function arrHtml(list, cls = "role-pill") {
  return (list || []).map(x => `<span class="${cls}">${escapeHtml(typeof x === "string" ? x : x.title || x.moment || "")}</span>`).join("");
}

function roleTaskRows(tasks = []) {
  return tasks.map(t => `
    <div class="role-task-row">
      <div><strong>${escapeHtml(t.title)}</strong><p>${escapeHtml(t.businessImpact || "")}</p></div>
      <span>${escapeHtml(t.duration || 0)} min</span>
      <span>${escapeHtml(t.intensity || "media")}</span>
      <span>${escapeHtml(t.priority || "media")}</span>
    </div>`).join("");
}

function getCatalogRoles() {
  const seedRoles = [STRATEGIC_DIRECTION_ROLE, BRAND_DIRECTION_ROLE];
  const existing = (cache.roles || []).filter(r => r.locked || r.status === "catalog" || seedRoles.some(seed => seed.id === r.id));
  return [...seedRoles, ...existing]
    .filter((role, index, arr) => arr.findIndex(r => r.id === role.id) === index);
}

function renderRoles() {
  const container = $("#roles"); if (!container) return;
  const roles = getCatalogRoles();
  const strategic = roles.find(r => r.id === STRATEGIC_DIRECTION_ROLE.id) || STRATEGIC_DIRECTION_ROLE;
  const manualCount = (cache.roles || []).filter(r => !(r.locked || r.status === "catalog" || r.id === STRATEGIC_DIRECTION_ROLE.id)).length;
  container.innerHTML = `
    <div class="role-library-hero role-library-reset">
      <span class="eyebrow">1.5 — Catálogo estratégico de roles</span>
      <h3>Biblioteca estratégica de responsabilidades</h3>
      <p>Esta página ya no sirve para crear roles sueltos. Los roles deben existir como guías de trabajo: explican qué cuida cada persona, qué tareas puede generar, qué límites protege y cómo ayuda a The 86 Club a vender sin saturar al equipo.</p>
      <div class="role-hero-rules">
        <span>Catálogo base</span><span>Sin roles improvisados</span><span>Salud primero</span><span>Tareas por rol/día</span><span>Ecosistema futuro por tarea</span>
      </div>
      ${manualCount ? `<p class="muted role-legacy-note">Hay ${manualCount} rol(es) manuales antiguos guardados en Firestore. No se muestran aquí porque pertenecen a la versión obsoleta de “Agregar rol”. El sistema nuevo usará solo roles estratégicos definidos.</p>` : ""}
    </div>

    <div class="role-library-grid">
      ${roles.map(role => renderRoleLibraryCard(role)).join("")}
    </div>
  `;
  container.querySelectorAll("[data-role-detail]").forEach(btn => {
    btn.addEventListener("click", () => {
      const role = roles.find(r => r.id === btn.dataset.roleDetail) || strategic;
      openRoleDetailModal(role);
    });
  });
  container.querySelectorAll("[data-role-tasks]").forEach(btn => {
    btn.addEventListener("click", () => {
      const role = roles.find(r => r.id === btn.dataset.roleTasks) || strategic;
      openRoleTasksModal(role);
    });
  });
  container.querySelectorAll("[data-role-system]").forEach(btn => {
    btn.addEventListener("click", () => {
      const role = roles.find(r => r.id === btn.dataset.roleSystem) || strategic;
      openRoleSystemModal(role);
    });
  });
}

function renderRoleLibraryCard(role) {
  const taskCount = (role.weeklyTasks || []).length + (role.lightTasks || []).length;
  return `
    <article class="role-card strategic-role-card role-library-card">
      <div class="role-card-head">
        <div>
          <span class="eyebrow">${escapeHtml(role.maturity || "Catálogo")}</span>
          <h3>${escapeHtml(role.title || role.name)}</h3>
          <p>${escapeHtml(role.shortDescription || role.purpose || "Rol estratégico de The 86 Club.")}</p>
        </div>
        <span class="badge">${escapeHtml(role.area || "Rol base")}</span>
      </div>
      <div class="role-metric-grid role-metric-grid-compact">
        <div><span>Responsabilidad</span><strong>${escapeHtml(role.coreResponsibility || "Pendiente de definir")}</strong></div>
        <div><span>Tareas</span><strong>${taskCount || "Banco pendiente"}</strong></div>
        <div><span>Límite</span><strong>${escapeHtml((role.recommendedLimits || ["Por definir"])[0])}</strong></div>
        <div><span>Estado</span><strong>${[STRATEGIC_DIRECTION_ROLE.id, BRAND_DIRECTION_ROLE.id].includes(role.id) ? "Conectado" : "Ficha base"}</strong></div>
      </div>
      <div class="role-focus-box">
        <div><span class="eyebrow">Propósito</span><p>${escapeHtml(role.purpose || "Pendiente de definición estratégica.")}</p></div>
        <div><span class="eyebrow">Por qué importa</span><p>${escapeHtml(role.whyItMatters || "Este rol se definirá antes de conectarlo con perfiles y tareas.")}</p></div>
      </div>
      <div class="role-actions-row">
        <button class="primary-btn" data-role-detail="${escapeAttr(role.id)}">Abrir ficha completa</button>
        <button class="soft-btn" data-role-tasks="${escapeAttr(role.id)}">Ver tareas</button>
        <button class="soft-btn" data-role-system="${escapeAttr(role.id)}">Ver lógica</button>
      </div>
    </article>`;
}

function openRoleDetailModal(role) {
  openInfoModal({
    eyebrow: role.maturity || "Rol estratégico",
    title: role.title || role.name,
    html: `
      <div class="role-modal-grid">
        <div class="learning-box"><span class="eyebrow">Propósito</span><p>${escapeHtml(role.purpose)}</p></div>
        <div class="learning-box"><span class="eyebrow">Responsabilidad central</span><p>${escapeHtml(role.coreResponsibility)}</p></div>
        <div class="learning-box"><span class="eyebrow">Salud física y mental</span><p>${escapeHtml(role.healthRule)}</p></div>
        <div class="learning-box"><span class="eyebrow">Agrupación por rol/día</span><p>${escapeHtml(role.focusRule)}</p></div>
      </div>
      <h3>Responsabilidades</h3><div class="pill-cloud">${arrHtml(role.responsibilities)}</div>
      <h3>Qué debe evitar</h3><div class="pill-cloud">${arrHtml(role.avoid, "role-pill red")}</div>
      <h3>Métricas que debe revisar</h3><div class="pill-cloud">${arrHtml(role.metrics, "role-pill")}</div>
      <h3>Límites recomendados</h3><div class="pill-cloud">${arrHtml(role.recommendedLimits, "role-pill yellow")}</div>
      <h3>Distribución semanal sugerida</h3>
      <div class="role-distribution-list">${(role.suggestedWeeklyDistribution || []).map(x => `<div><strong>${escapeHtml(x.moment)}</strong><p>${escapeHtml(x.work)}</p></div>`).join("")}</div>
    `
  });
}

function openRoleTasksModal(role) {
  openInfoModal({
    eyebrow: "Banco de tareas del rol",
    title: `Tareas posibles — ${role.title || role.name}`,
    html: `
      <div class="learning-box"><span class="eyebrow">Importante</span><p>Este banco no significa que todas las tareas se asignen el mismo día. El sistema escogerá tareas según prioridad, datos del workspace, disponibilidad, carga, roles activos y salud del usuario.</p></div>
      <h3>Tareas semanales esenciales</h3>
      <div class="role-task-table"><div class="role-task-row head"><span>Tarea</span><span>Tiempo</span><span>Intensidad</span><span>Prioridad</span></div>${roleTaskRows(role.weeklyTasks)}</div>
      <h3>Tareas ligeras</h3>
      <div class="role-task-table"><div class="role-task-row head"><span>Tarea</span><span>Tiempo</span><span>Intensidad</span><span>Prioridad</span></div>${roleTaskRows(role.lightTasks)}</div>
    `
  });
}

function openRoleSystemModal(role) {
  openInfoModal({
    eyebrow: "Conexiones futuras",
    title: `Cómo se conectará ${role.title || role.name}`,
    html: `
      <div class="role-modal-grid">
        <div class="learning-box"><span class="eyebrow">Perfil</span><p>${escapeHtml(role.profileConnection)}</p></div>
        <div class="learning-box"><span class="eyebrow">Calendario</span><p>${escapeHtml(role.calendarConnection)}</p></div>
        <div class="learning-box"><span class="eyebrow">Cierre semanal</span><p>${escapeHtml(role.weeklyCloseConnection)}</p></div>
        <div class="learning-box"><span class="eyebrow">Dashboard</span><p>${escapeHtml(role.dashboardConnection)}</p></div>
      </div>
      <h3>Activación según datos del workspace</h3>
      <div class="pill-cloud">${arrHtml(role.taskActivationLogic, "role-pill")}</div>
      <h3>Ecosistema futuro de tarea</h3>
      <div class="learning-box"><p>${escapeHtml(role.taskEcosystemNote)}</p></div>
    `
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


function renderNewProjects() {
  const container = $("#newProjects"); if (!container) return;
  container.innerHTML = `
    <div class="project-lab-hero">
      <span class="eyebrow">Futuro módulo</span>
      <h3>Nuevos proyectos</h3>
      <p>Esta sección será el filtro estratégico para cualquier proyecto nuevo que The 86 Club quiera agregar al negocio. No será un buzón de ideas sueltas: servirá para evaluar si una propuesta fortalece la marca, si tiene sentido comercial y si merece un protocolo de desarrollo.</p>
      <div class="role-hero-rules">
        <span>Propuesta</span><span>Filtro de marca</span><span>Viabilidad</span><span>Prompt para GPT</span><span>Protocolo futuro</span>
      </div>
    </div>
    <div class="project-lab-grid">
      <article class="project-lab-card">
        <span class="eyebrow">Paso futuro 1</span>
        <h4>Formulario de propuesta</h4>
        <p>El usuario describirá el proyecto, objetivo, relación con The 86 Club, audiencia, recursos necesarios, riesgos, impacto en marca y posible retorno.</p>
      </article>
      <article class="project-lab-card">
        <span class="eyebrow">Paso futuro 2</span>
        <h4>Filtro de Dirección de marca</h4>
        <p>La propuesta se evaluará principalmente contra Dirección de marca: promesa, coherencia, identidad, confianza, tono y riesgo de diluir la marca.</p>
      </article>
      <article class="project-lab-card">
        <span class="eyebrow">Paso futuro 3</span>
        <h4>Exportar propuesta</h4>
        <p>El sistema generará un TXT o JSON con la propuesta para pegarlo en ChatGPT y pedir una calificación estratégica del proyecto.</p>
      </article>
      <article class="project-lab-card">
        <span class="eyebrow">Paso futuro 4</span>
        <h4>Protocolo de desarrollo</h4>
        <p>Si el proyecto es viable, más adelante se podrá convertir en un protocolo detallado de inicio a fin, técnico, dirigido y medible.</p>
      </article>
    </div>
    <div class="learning-box">
      <span class="eyebrow">Nota de sistema</span>
      <p>Por ahora esta sección queda como estructura visual y recordatorio. La construcción real del formulario, exportador y protocolo vendrá después de consolidar los roles estratégicos.</p>
    </div>
  `;
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

// app.js
// V2 starter. Ahora funciona como prototipo local.
// Cuando tengamos Firebase config, conectaremos login, Firestore y Storage.

import { firebaseConfig, firebaseReady } from "./firebase.js";

const state = {
  view: "dashboard",
  theme: localStorage.getItem("the86_theme") || "dark",
  tasks: JSON.parse(localStorage.getItem("the86_tasks") || "{}")
};

const views = {
  dashboard: {
    title: "Dashboard",
    html: () => `
      <article class="card span-4"><h3>Progreso general</h3><div class="metric">${overallProgress()}%</div><p class="muted">Basado en tareas marcadas en esta versión local.</p></article>
      <article class="card span-4"><h3>Etapa activa</h3><p class="badge">Etapa 1 · Roles y sistema de trabajo</p><p class="muted">Primero definimos responsabilidades para evitar saturación y trabajo duplicado.</p></article>
      <article class="card span-4"><h3>Estado Firebase</h3><p class="badge">${firebaseReady ? "Conectado" : "Pendiente"}</p><p class="muted">Cuando pegues firebaseConfig, conectamos login y base de datos.</p></article>
      <article class="card span-12"><h3>Próximas acciones</h3>${taskList("dashboard_next", ["Crear proyecto Firebase", "Activar Authentication", "Activar Firestore", "Activar Storage", "Pegar firebaseConfig en firebase.js"])} </article>
    `
  },
  "stage-01": {
    title: "Etapa 1 · Roles y sistema de trabajo",
    html: () => `
      <article class="card span-8"><h3>Objetivo</h3><p>Definir quién hace qué, cómo se revisa el trabajo y qué límites protegen al equipo de la saturación.</p>${taskList("stage_01_roles", ["Crear perfil de Christopher", "Crear perfil del colega", "Asignar rol principal a cada persona", "Escribir responsabilidades", "Definir qué no debe tocarse sin aprobación", "Definir flujo idea → diseño → retoque → revisión → publicación", "Registrar primera decisión del equipo"])} </article>
      <article class="card span-4"><h3>Enlaces internos</h3><button class="ghost-button nav-jump" data-view="activity">Ir a actividad</button><br><br><button class="ghost-button nav-jump" data-view="files">Ir a archivos</button><br><br><button class="ghost-button nav-jump" data-view="decisions">Ir a decisiones</button></article>
    `
  },
  "stage-02": {
    title: "Etapa 2 · Base estratégica",
    html: () => `
      <article class="card span-12"><h3>Objetivo</h3><p>Organizar productos, palabras de marca, oferta, cliente ideal y base comercial antes de profundizar marketing.</p>${taskList("stage_02_strategy", ["Inventario general de productos", "Crear estructura para colecciones futuras", "Definir productos hero/support/conversion", "Crear palabras de marca", "Crear documento No somos", "Definir clientes ideales", "Crear oferta actual"])} </article>
    `
  },
  products: {
    title: "Productos y colecciones",
    html: () => `
      <article class="card span-12"><h3>Inventario de productos</h3><p class="muted">Aquí irá el inventario general, no solo Drop 00.</p>${simpleForm(["Nombre del producto", "Colección", "Precio", "Costo Printful", "Margen", "Estado"])} </article>
    `
  },
  audit: {
    title: "Auditoría Shopify",
    html: () => `
      <article class="card span-6"><h3>Evidencias requeridas</h3>${taskList("audit_evidence", ["Subir captura home desktop", "Subir captura home mobile", "Subir captura menú", "Subir captura colección", "Subir captura producto", "Subir captura carrito", "Subir captura popup"])} </article>
      <article class="card span-6"><h3>Puntuación</h3>${simpleForm(["Home 0-10", "Producto 0-10", "Mobile 0-10", "Confianza 0-10", "Oferta 0-10"])} </article>
      <article class="card span-12"><h3>Diagnóstico</h3><textarea placeholder="Lo que está bien, lo que está débil, prioridades de mejora..."></textarea></article>
    `
  },
  competitors: {
    title: "Competidores",
    html: () => `
      <article class="card span-12"><h3>Ficha de competidor</h3>${simpleForm(["Marca", "Website", "Precio promedio", "Estética", "Qué hacen bien", "Qué hacen mal", "Qué puede aprender The 86 Club"])} </article>
    `
  },
  promotion: {
    title: "Plan de promoción",
    html: () => `
      <article class="card span-12"><h3>Canales y campañas activas</h3><p class="muted">Aquí registraremos Instagram, email, Shopify, Etsy, foros, comunidades y cualquier canal activo.</p>${simpleForm(["Canal", "Estado", "Campaña", "Objetivo", "Responsable", "Frecuencia", "Resultados"])} </article>
    `
  },
  files: {
    title: "Archivos del proyecto",
    html: () => `
      <article class="card span-12"><h3>Biblioteca de archivos</h3><p class="muted">En V2 conectada, los archivos se subirán a Firebase Storage.</p>${simpleForm(["Nombre", "Categoría", "Relacionado con", "Subido por", "Notas"])} </article>
    `
  },
  activity: {
    title: "Actividad del equipo",
    html: () => `
      <article class="card span-12"><h3>Registro de actividad</h3><p class="muted">Cuando conectemos Firebase, cada acción guardará quién hizo qué y cuándo.</p><div class="task-row">Sistema listo para activityLog.</div></article>
    `
  },
  decisions: {
    title: "Decisiones",
    html: () => `
      <article class="card span-12"><h3>Decision Log</h3>${simpleForm(["Fecha", "Decisión", "Quién la tomó", "Por qué", "Impacto", "Revisar después"])} </article>
    `
  },
  settings: {
    title: "Configuración",
    html: () => `
      <article class="card span-12"><h3>Configuración Firebase</h3><p class="muted">Proyecto actual configurado como: <strong>${firebaseConfig.projectId}</strong></p><p class="muted">Cuando tengas el firebaseConfig real, lo pegamos en firebase.js.</p></article>
    `
  }
};

function taskList(key, items) {
  if (!state.tasks[key]) state.tasks[key] = {};
  return `<div class="task-list">${items.map((item, index) => {
    const id = `${key}_${index}`;
    const checked = state.tasks[key][id] ? "checked" : "";
    return `<label class="task-row"><input type="checkbox" data-task-key="${key}" data-task-id="${id}" ${checked}><span>${item}</span></label>`;
  }).join("")}</div>`;
}

function simpleForm(fields) {
  return `<div class="form-grid">${fields.map(field => `<label>${field}<input type="text" placeholder="Completar ${field.toLowerCase()}" /></label>`).join("")}<label>Notas<textarea placeholder="Notas..."></textarea></label></div>`;
}

function overallProgress() {
  const groups = Object.values(state.tasks);
  let total = 0;
  let done = 0;
  groups.forEach(group => {
    Object.values(group).forEach(value => {
      total += 1;
      if (value) done += 1;
    });
  });
  return total ? Math.round((done / total) * 100) : 0;
}

function saveTasks() {
  localStorage.setItem("the86_tasks", JSON.stringify(state.tasks));
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  document.getElementById("themeToggle").textContent = state.theme === "dark" ? "Modo día" : "Modo noche";
  const view = views[state.view] || views.dashboard;
  document.getElementById("pageTitle").textContent = view.title;
  document.getElementById("content").innerHTML = view.html();
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.view === state.view));
}

function setView(view) {
  state.view = view;
  render();
}

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-view]");
  if (nav) setView(nav.dataset.view);
});

document.addEventListener("change", event => {
  const checkbox = event.target.closest("input[type='checkbox'][data-task-key]");
  if (!checkbox) return;
  const { taskKey, taskId } = checkbox.dataset;
  if (!state.tasks[taskKey]) state.tasks[taskKey] = {};
  state.tasks[taskKey][taskId] = checkbox.checked;
  saveTasks();
  render();
});

document.getElementById("themeToggle").addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("the86_theme", state.theme);
  render();
});

document.getElementById("loginButton").addEventListener("click", () => {
  document.getElementById("loginPanel").classList.remove("hidden");
});

document.getElementById("submitLogin").addEventListener("click", () => {
  document.getElementById("loginMessage").textContent = "Login visual listo. Falta conectar Firebase Authentication.";
});

document.getElementById("loginPanel").addEventListener("click", event => {
  if (event.target.id === "loginPanel") document.getElementById("loginPanel").classList.add("hidden");
});

render();

// script.js – Lógica Frontend ATLAS (Login, Registro, Rutinas e Interacción de Entrenamiento)

const API_BASE = (
  window.location.protocol === "file:" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  !window.location.hostname
)
  ? "http://localhost:3000/api"
  : `${window.location.origin}/api`;

/* Escapa texto antes de insertarlo como HTML (evita inyección de código con nombres, notas, etc.) */
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Mensajes breves (toasts) que reemplazan a alert().
   tipo: "exito" | "error" | "aviso" | "info". Los errores duran más y se pueden cerrar.
   El texto se inserta con textContent (nunca como HTML). */
function showToast(mensaje, tipo) {
  const t = ["exito", "error", "aviso", "info"].includes(tipo) ? tipo : "info";
  let cont = document.getElementById("toastContainer");
  if (!cont) {
    cont = document.createElement("div");
    cont.id = "toastContainer";
    cont.className = "toast-container";
    document.body.appendChild(cont);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${t}`;
  toast.setAttribute("role", t === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", t === "error" ? "assertive" : "polite");

  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = String(mensaje == null ? "" : mensaje);

  const cerrar = document.createElement("button");
  cerrar.type = "button";
  cerrar.className = "toast-close";
  cerrar.setAttribute("aria-label", "Cerrar mensaje");
  cerrar.textContent = "×";

  toast.append(msg, cerrar);
  cont.appendChild(toast);
  // Máximo 4 mensajes a la vez
  while (cont.children.length > 4) cont.firstElementChild.remove();

  let quitado = false;
  const quitar = () => {
    if (quitado) return;
    quitado = true;
    toast.classList.add("toast-saliendo");
    setTimeout(() => toast.remove(), 200);
  };
  cerrar.addEventListener("click", quitar);
  setTimeout(quitar, t === "error" ? 6500 : 3800);
}

/* ---------- SESIÓN: token firmado por el servidor ----------
   Todas las llamadas a la API llevan el token en la cabecera Authorization.
   Si el servidor responde 401 (sesión vencida o inválida) se vuelve al login. */
(function setupAuthFetch() {
  const stored = localStorage.getItem("token");
  // Sesiones del sistema anterior (guardaban solo el número de usuario): obligar a entrar de nuevo
  if (stored && !stored.includes(".")) localStorage.clear();

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url.startsWith(API_BASE)) return originalFetch(input, init);
    const headers = new Headers(init.headers || {});
    const token = localStorage.getItem("token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return originalFetch(input, { ...init, headers }).then(res => {
      if (res.status === 401 && !url.endsWith("/login")) {
        localStorage.clear();
        if (!/index\.html$|\/$/.test(window.location.pathname)) window.location.href = "index.html";
      }
      return res;
    });
  };
})();
let currentUserData = null;
let currentActiveRoutine = null;
let completedSetsState = {}; // { "ex_0_set_0": true, ... }
let entrenoPaso = 0;          // ejercicio que se muestra en el modo entrenamiento
let clienteIniciado = false;
let rutinaElegidaId = null;   // rutina que el cliente eligió para hoy (si cambió la sugerida)
let editingRoutineId = null;

/* ---------- ESTADO DEL TEMPORIZADOR DE DESCANSO ---------- */
let restTimerDuration = 60; // 60 segundos por defecto
let restTimerEnabled = true; // Activo por defecto
let restTimerInterval = null;
let restTimeRemaining = 0;
let isTimerPaused = false;
let userAudioCtx = null;

function unlockAudioContext() {
  try {
    if (!userAudioCtx) {
      userAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (userAudioCtx && userAudioCtx.state === 'suspended') {
      userAudioCtx.resume();
    }
  } catch (e) { }
}

document.addEventListener('touchstart', unlockAudioContext, { passive: true });
document.addEventListener('click', unlockAudioContext, { passive: true });

/* Helper */
function $(sel) { return document.querySelector(sel); }

/* ---------- AUTENTICACIÓN (LOGIN SOLO CORREO / CONTRASEÑA ADMIN) ---------- */
function checkEmailForAdmin() {
  const emailInput = $("#loginEmail");
  const passGroup = $("#adminPasswordGroup");
  const passInput = $("#loginPassword");
  if (!emailInput || !passGroup) return;

  const val = emailInput.value.trim().toLowerCase();
  if (val === "atlasgymve@gmail.com") {
    passGroup.classList.remove("hidden");
    if (passInput) passInput.setAttribute("required", "required");
  } else {
    passGroup.classList.add("hidden");
    if (passInput) passInput.removeAttribute("required");
  }
}

function login(event) {
  event.preventDefault();
  const email = $("#loginEmail").value.trim();
  const passInput = $("#loginPassword");
  const password = passInput ? passInput.value.trim() : "";
  const errorMsg = $("#errorMsg");

  if (errorMsg) errorMsg.classList.add("hidden");

  fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.msg || "Error al iniciar sesión");
      return data;
    })
    .then(data => {
      localStorage.setItem("token", data.token);
      localStorage.setItem("userId", data.id_usuario);
      localStorage.setItem("nombre", data.nombre);
      localStorage.setItem("esAdmin", data.esAdmin ? "true" : "false");
      localStorage.setItem("esRecepcionista", data.esRecepcionista ? "true" : "false");

      if (data.esAdmin || data.esRecepcionista) {
        window.location.href = "admin.html";
      } else {
        window.location.href = "dashboard.html";
      }
    })
    .catch(err => {
      if (errorMsg) {
        errorMsg.textContent = err.message;
        errorMsg.classList.remove("hidden");
      } else {
        showToast(err.message, "error");
      }
    });
}

function logout() {
  localStorage.clear();
  window.location.href = "index.html";
}

/* Helper para obtener detalle de series por ejercicio */
function getSeriesDetalleArray(ej) {
  if (!ej || !ej.series_detalle_json) return null;
  try {
    if (typeof ej.series_detalle_json === "string") {
      return JSON.parse(ej.series_detalle_json);
    } else if (Array.isArray(ej.series_detalle_json)) {
      return ej.series_detalle_json;
    }
  } catch (e) {
    console.error("Error al parsear series_detalle_json:", e);
  }
  return null;
}

function formatExerciseWeights(ej) {
  const seriesDetalle = getSeriesDetalleArray(ej);
  if (seriesDetalle && Array.isArray(seriesDetalle) && seriesDetalle.length > 0) {
    const pesos = seriesDetalle.map(s => (s.peso !== undefined ? s.peso : ej.peso_kg));
    const todosIguales = pesos.every(p => p === pesos[0]);
    if (todosIguales) {
      return `${pesos[0]}kg`;
    } else {
      return `${pesos.join('/')}kg`;
    }
  }
  return `${ej.peso_kg || 0}kg`;
}

/* ---------- DASHBOARD & RUTINAS ---------- */
function loadDashboard() {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "index.html";
    return;
  }

  const adminBtn = $("#adminPanelBtn");
  if (adminBtn) adminBtn.classList.toggle("hidden", localStorage.getItem("esAdmin") !== "true");

  if (!clienteIniciado) {
    clienteIniciado = true;
    iniciarNavegacionCliente();
  }

  fetch(`${API_BASE}/usuario/${localStorage.getItem("userId")}`)
    .then(r => r.json())
    .then(data => {
      if (!data || !data.membresia) {
        showToast((data && data.msg) || "No se pudieron cargar tus datos.", "error");
        return;
      }
      currentUserData = data;
      renderCabeceraCliente(data);
      renderHoy(data);
      renderRoutinesGrid(data.rutinas || []);
      renderProgreso(data.sesiones || []);
      renderMiPlan(data);
      restoreActiveSessionIfAny();
      loadUserDashboardResources();
    })
    .catch(err => {
      console.error("Error al cargar dashboard:", err);
      showToast("No se pudieron cargar tus datos. Revisa la conexión.", "error");
    });
}

function renderRoutinesGrid(rutinas) {
  const grid = $("#routinesGrid");
  if (!grid) return;

  if (rutinas.length === 0) {
    grid.innerHTML = `
      <div class="cliente-card vacio">
        <p>Aún no tienes rutinas. Crea la primera o carga una de las rutinas sugeridas del gimnasio.</p>
        <button type="button" class="btn-primary" onclick="openNewRoutineModal()">+ Crear mi primera rutina</button>
      </div>`;
    return;
  }

  const ultimas = ultimaSesionPorRutina();
  // Textos con esc(); en los onclick solo va el id numérico
  grid.innerHTML = rutinas.map(r => {
    const id = Number(r.id_rutina);
    const ejercicios = r.ejercicios || [];
    const ultima = ultimas[id];
    return `<article class="cliente-card rutina-card">
      <div class="rutina-card-head">
        <h2 class="cliente-card-h">${esc(r.titulo)}</h2>
        <span class="card-hint">${esc(r.horario || "Horario flexible")} · ${ejercicios.length} ${ejercicios.length === 1 ? "ejercicio" : "ejercicios"}</span>
        ${ultima ? `<span class="card-hint">Última vez: ${esc(formatFechaCorta(ultima))}</span>` : ""}
      </div>
      ${r.descripcion ? `<p class="rutina-desc">${esc(r.descripcion)}</p>` : ""}
      <ul class="ejercicios-lista">
        ${ejercicios.length ? ejercicios.map(e => `<li><span>${esc(e.nombre_ejercicio)}</span><span class="ej-dosis">${esc(dosisEjercicio(e))}</span></li>`).join("")
          : `<li class="report-empty">Sin ejercicios todavía</li>`}
      </ul>
      <div class="rutina-acciones">
        <button type="button" class="btn-primary" onclick="startWorkoutSession(${id})">Empezar</button>
        <button type="button" class="btn-secondary" onclick="editRoutine(${id})" aria-label="Editar ${esc(r.titulo)}">Editar</button>
        <button type="button" class="btn-danger" onclick="deleteRoutine(${id})" aria-label="Eliminar ${esc(r.titulo)}">Eliminar</button>
      </div>
    </article>`;
  }).join("");
}

/* ---------- MODAL DE NUEVA / EDITAR RUTINA ---------- */
function openNewRoutineModal() {
  editingRoutineId = null;

  const title = $("#routineModalTitle");
  if (title) title.textContent = "Crear Nueva Rutina";

  const submitBtn = $("#routineModalSubmitBtn");
  if (submitBtn) submitBtn.textContent = "Guardar Rutina";

  const form = $("#createRoutineForm");
  if (form) form.reset();

  const container = $("#exerciseInputsContainer");
  if (container) {
    container.innerHTML = "";
    addExerciseRow();
  }

  // Cargar plantillas en el dropdown si existe
  populateRoutineTemplatesDropdown();

  const modal = $("#routineModal");
  if (modal) modal.classList.remove("hidden");
}

function closeNewRoutineModal() {
  editingRoutineId = null;
  $("#routineModal").classList.add("hidden");
}

function editRoutine(id_rutina) {
  if (!currentUserData || !currentUserData.rutinas) return;
  const routine = currentUserData.rutinas.find(r => r.id_rutina === id_rutina);
  if (!routine) return;

  editingRoutineId = id_rutina;

  const title = $("#routineModalTitle");
  if (title) title.textContent = "Editar Rutina";
  const btn = $("#routineModalSubmitBtn");
  if (btn) btn.textContent = "Guardar Cambios";

  $("#routineTitle").value = routine.titulo || "";
  $("#routineDesc").value = routine.descripcion || "";
  $("#routineHorario").value = routine.horario || "";

  const container = $("#exerciseInputsContainer");
  container.innerHTML = "";

  if (routine.ejercicios && routine.ejercicios.length > 0) {
    routine.ejercicios.forEach(ej => {
      addExerciseRow(
        ej.nombre_ejercicio || ej.titulo || "",
        ej.series || 3,
        ej.repeticiones || 10,
        ej.peso_kg || 0
      );
    });
  } else {
    addExerciseRow("", "", "", "");
  }

  $("#routineModal").classList.remove("hidden");
}

function addExerciseRow(nombre = "", series = 3, reps = 10, peso = 0) {
  const container = $("#exercisesContainer") || $("#exerciseInputsContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "exercise-row exercise-input-card";
  card.style.cssText = "background: var(--surface-2); border: 1px solid var(--border-light); border-radius: 12px; padding: 1rem; position: relative; margin-bottom: 0.8rem;";

  card.innerHTML = `
    <button type="button" onclick="this.closest('.exercise-input-card').remove()" title="Eliminar ejercicio" style="position: absolute; top: 0.8rem; right: 0.8rem; background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-border); border-radius: 8px; width: 28px; height: 28px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center;">X</button>
    
    <div style="margin-bottom: 0.8rem; padding-right: 2rem;">
      <label class="form-label" style="font-size: 0.8rem; color: var(--link); margin-bottom: 0.3rem; font-weight: 600;">Nombre del Ejercicio</label>
      <input type="text" class="form-input ex-name" placeholder="Ej: Press de Banca" value="${esc(nombre)}" required style="padding: 0.5rem 0.8rem; font-size: 0.9rem;">
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.8rem;">
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Series</label>
        <input type="number" class="form-input ex-series" placeholder="3" value="${esc(series)}" min="1" required style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Reps</label>
        <input type="number" class="form-input ex-reps" placeholder="10" value="${esc(reps)}" min="1" required style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Peso (kg)</label>
        <input type="number" step="0.5" class="form-input ex-peso" placeholder="0" value="${esc(peso)}" min="0" style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
    </div>
  `;
  container.appendChild(card);
}

function saveRoutine(event) {
  event.preventDefault();
  const token = localStorage.getItem("token");
  const titulo = $("#routineTitle").value.trim();
  const descripcion = $("#routineDesc").value.trim();
  const horario = $("#routineHorario").value.trim();

  const rows = document.querySelectorAll(".exercise-row");
  const ejercicios = [];

  rows.forEach(row => {
    const nombre_ejercicio = row.querySelector(".ex-name").value.trim();
    const series = row.querySelector(".ex-series").value;
    const repeticiones = row.querySelector(".ex-reps").value;
    const peso_kg = row.querySelector(".ex-peso").value;

    if (nombre_ejercicio) {
      ejercicios.push({ nombre_ejercicio, series, repeticiones, peso_kg });
    }
  });

  const url = editingRoutineId ? `${API_BASE}/rutinas/${editingRoutineId}` : `${API_BASE}/rutinas`;
  const method = editingRoutineId ? "PUT" : "POST";

  fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_usuario: localStorage.getItem("userId"), titulo, descripcion, horario, ejercicios })
  })
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        closeNewRoutineModal();
        loadDashboard();
      } else {
        showToast(res.msg || "Error al guardar rutina", "error");
      }
    })
    .catch(err => console.error(err));
}

function deleteRoutine(id_rutina) {
  if (!confirm("¿Estás seguro de eliminar esta rutina?")) return;

  fetch(`${API_BASE}/rutinas/${id_rutina}`, { method: "DELETE" })
    .then(r => r.json())
    .then(res => {
      if (res.ok) loadDashboard();
    })
    .catch(err => console.error(err));
}

/* ---------- INTERFAZ RUTINA DE HOY (WORKOUT TRACKER INTERACTIVO Y PERSISTENTE) ---------- */
function saveActiveSessionState() {
  if (!currentActiveRoutine) {
    localStorage.removeItem("atlas_active_workout_session");
    return;
  }

  const inputs = {};
  const weightInputs = document.querySelectorAll(".set-weight-input");
  weightInputs.forEach(input => {
    const exIdx = input.getAttribute("data-ex");
    const setIdx = input.getAttribute("data-set");
    inputs[`ex_${exIdx}_set_${setIdx}_weight`] = input.value;
  });

  const repsInputs = document.querySelectorAll(".set-reps-input");
  repsInputs.forEach(input => {
    const exIdx = input.getAttribute("data-ex");
    const setIdx = input.getAttribute("data-set");
    inputs[`ex_${exIdx}_set_${setIdx}_reps`] = input.value;
  });

  const stateToSave = {
    routineId: currentActiveRoutine.id_rutina,
    routine: currentActiveRoutine,
    completedSetsState: completedSetsState,
    inputs: inputs,
    restTimerDuration: restTimerDuration,
    restTimerEnabled: restTimerEnabled,
    paso: entrenoPaso,
    savedAt: new Date().toISOString()
  };

  localStorage.setItem("atlas_active_workout_session", JSON.stringify(stateToSave));
}

function restoreActiveSessionIfAny() {
  const savedStateRaw = localStorage.getItem("atlas_active_workout_session");
  if (!savedStateRaw) return;

  try {
    const savedState = JSON.parse(savedStateRaw);
    if (!savedState || !savedState.routineId) return;

    let routine = currentUserData && currentUserData.rutinas
      ? currentUserData.rutinas.find(r => r.id_rutina === savedState.routineId)
      : null;

    if (!routine) routine = savedState.routine;
    if (!routine) return;

    renderActiveWorkoutSession(routine, savedState);

    const badge = $("#restoredSessionBadge");
    if (badge) badge.classList.remove("hidden");
  } catch (e) {
    console.error("Error restaurando sesión activa:", e);
  }
}

function startWorkoutSession(id_rutina) {
  const token = localStorage.getItem("token");
  if (!token) return;

  fetch(`${API_BASE}/usuario/${localStorage.getItem("userId")}`)
    .then(r => r.json())
    .then(data => {
      currentUserData = data;
      renderRoutinesGrid(data.rutinas || []);

      const routine = data.rutinas.find(r => r.id_rutina === id_rutina);
      if (!routine) return;

      const badge = $("#restoredSessionBadge");
      if (badge) badge.classList.add("hidden");

      renderActiveWorkoutSession(routine, null);
    })
    .catch(err => console.error("Error iniciando rutina:", err));
}

function renderActiveWorkoutSession(routine, restoredState = null) {
  currentActiveRoutine = routine;
  completedSetsState = restoredState && restoredState.completedSetsState ? restoredState.completedSetsState : {};
  entrenoPaso = restoredState && Number.isInteger(restoredState.paso) ? restoredState.paso : 0;

  if (restoredState) {
    if (restoredState.restTimerDuration) restTimerDuration = restoredState.restTimerDuration;
    if (restoredState.restTimerEnabled !== undefined) restTimerEnabled = restoredState.restTimerEnabled;
  }

  const durationSelect = $("#restTimerSecondsSelect");
  if (durationSelect) durationSelect.value = String(restTimerDuration);
  const toggleCheckbox = $("#restTimerToggleCheckbox");
  if (toggleCheckbox) toggleCheckbox.checked = restTimerEnabled;

  $("#sessionRoutineTitle").textContent = routine.titulo;
  $("#sessionRoutineDesc").textContent = routine.descripcion || "";

  const exercisesContainer = $("#sessionExercisesList");
  const ejercicios = routine.ejercicios || [];
  let totalSetsInRoutine = 0;

  // Un bloque por ejercicio; solo se muestra el del paso actual. Los textos van con esc().
  exercisesContainer.innerHTML = ejercicios.map((ej, exIdx) => {
    const cantSeries = parseInt(ej.series) || 3;
    const seriesDetalle = getSeriesDetalleArray(ej);
    let seriesHtml = "";

    for (let s = 0; s < cantSeries; s++) {
      totalSetsInRoutine++;
      const setId = `ex_${exIdx}_set_${s}`;
      const hecho = !!completedSetsState[setId];
      let setWeight = ej.peso_kg || 0;
      let setReps = ej.repeticiones || 10;
      if (seriesDetalle && seriesDetalle[s]) {
        if (seriesDetalle[s].peso !== undefined) setWeight = seriesDetalle[s].peso;
        if (seriesDetalle[s].reps !== undefined) setReps = seriesDetalle[s].reps;
      }
      if (restoredState && restoredState.inputs) {
        if (restoredState.inputs[`${setId}_weight`] !== undefined) setWeight = restoredState.inputs[`${setId}_weight`];
        if (restoredState.inputs[`${setId}_reps`] !== undefined) setReps = restoredState.inputs[`${setId}_reps`];
      }
      // Números limpios (la base guarda "40.00"; se muestra 40)
      setWeight = parseFloat(String(setWeight).replace(",", ".")) || 0;
      setReps = parseInt(setReps, 10) || 0;
      const n = s + 1;
      seriesHtml += `
        <div class="serie${hecho ? " serie-hecha" : ""}" id="serie_${setId}">
          <div class="serie-num">Serie ${n}</div>
          <div class="stepper stepper-peso">
            <span class="stepper-label">Peso (kg)</span>
            <div class="stepper-fila">
              <button type="button" class="stepper-btn" onclick="ajustarValorSerie('peso', ${exIdx}, ${s}, -2.5)" aria-label="Restar 2,5 kg a la serie ${n}">−</button>
              <input type="number" inputmode="decimal" step="0.5" min="0" class="set-input set-weight-input" data-ex="${exIdx}" data-set="${s}"
                value="${esc(setWeight)}" aria-label="Peso de la serie ${n}, en kilos" oninput="saveActiveSessionState()">
              <button type="button" class="stepper-btn" onclick="ajustarValorSerie('peso', ${exIdx}, ${s}, 2.5)" aria-label="Sumar 2,5 kg a la serie ${n}">+</button>
            </div>
          </div>
          <div class="stepper stepper-reps">
            <span class="stepper-label">Repeticiones</span>
            <div class="stepper-fila">
              <button type="button" class="stepper-btn" onclick="ajustarValorSerie('reps', ${exIdx}, ${s}, -1)" aria-label="Restar una repetición a la serie ${n}">−</button>
              <input type="number" inputmode="numeric" step="1" min="0" class="set-input set-reps-input" data-ex="${exIdx}" data-set="${s}"
                value="${esc(setReps)}" aria-label="Repeticiones de la serie ${n}" oninput="saveActiveSessionState()">
              <button type="button" class="stepper-btn" onclick="ajustarValorSerie('reps', ${exIdx}, ${s}, 1)" aria-label="Sumar una repetición a la serie ${n}">+</button>
            </div>
          </div>
          <button type="button" class="btn-check-set btn-check-grande${hecho ? " completed" : ""}" id="btn_set_${setId}"
            onclick="toggleSetCompleted('${setId}')" aria-pressed="${hecho}" aria-label="Serie ${n} completada">
            <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>
          </button>
        </div>`;
    }

    return `<section class="entreno-ejercicio${exIdx === entrenoPaso ? "" : " hidden"}" data-idx="${exIdx}" aria-label="Ejercicio ${exIdx + 1}">
      <h3 class="ej-nombre">${esc(ej.nombre_ejercicio || ej.titulo || "Ejercicio")}</h3>
      <p class="card-hint">${esc(dosisEjercicio(ej))}</p>
      <div class="series-entreno">${seriesHtml}</div>
    </section>`;
  }).join("") || `<p class="report-empty">Esta rutina no tiene ejercicios. Edítala para agregarlos.</p>`;

  updateSessionProgressBar(totalSetsInRoutine);
  mostrarPasoEntreno();
  entrarModoEntreno();
  saveActiveSessionState();
}

// Botones − y + de peso (pasos de 2,5 kg) y repeticiones (de 1 en 1)
function ajustarValorSerie(tipo, exIdx, setIdx, delta) {
  const clase = tipo === "peso" ? "set-weight-input" : "set-reps-input";
  const input = document.querySelector(`.${clase}[data-ex="${Number(exIdx)}"][data-set="${Number(setIdx)}"]`);
  if (!input) return;
  const actual = parseFloat(String(input.value).replace(",", ".")) || 0;
  let nuevo = Math.max(0, actual + delta);
  nuevo = tipo === "peso" ? Math.round(nuevo * 2) / 2 : Math.round(nuevo);
  input.value = nuevo;
  saveActiveSessionState();
}

function mostrarPasoEntreno() {
  const bloques = document.querySelectorAll("#sessionExercisesList .entreno-ejercicio");
  const total = bloques.length;
  entrenoPaso = Math.min(Math.max(0, entrenoPaso), Math.max(0, total - 1));
  bloques.forEach((b, i) => b.classList.toggle("hidden", i !== entrenoPaso));

  const paso = $("#entrenoPaso");
  if (paso) {
    paso.innerHTML = total ? `<span>Ejercicio ${entrenoPaso + 1} de ${total}</span>
      <span class="puntos" aria-hidden="true">${[...bloques].map((b, i) => {
        const hecho = [...b.querySelectorAll(".btn-check-set")].every(x => x.classList.contains("completed"));
        return `<i class="${i === entrenoPaso ? "actual" : ""}${hecho ? " hecho" : ""}"></i>`;
      }).join("")}</span>` : "";
  }

  const ant = $("#entrenoAnterior"), sig = $("#entrenoSiguiente"), fin = $("#entrenoTerminar");
  const ultimo = total === 0 || entrenoPaso >= total - 1;
  if (ant) ant.disabled = entrenoPaso === 0;
  if (sig) sig.classList.toggle("hidden", ultimo);
  if (fin) fin.classList.toggle("hidden", !ultimo);
}

function moverEjercicio(delta) {
  entrenoPaso += delta;
  mostrarPasoEntreno();
  saveActiveSessionState();
  const cuerpo = document.querySelector(".entreno-cuerpo");
  if (cuerpo) cuerpo.scrollTop = 0;
}

function toggleSetCompleted(setId) {
  unlockAudioContext();
  const btn = document.getElementById(`btn_set_${setId}`);
  if (!btn) return;

  const marcar = !completedSetsState[setId];
  if (marcar) {
    completedSetsState[setId] = true;
    startRestTimer();
  } else {
    delete completedSetsState[setId];
    stopRestTimer();
  }
  btn.classList.toggle("completed", marcar);
  btn.setAttribute("aria-pressed", marcar ? "true" : "false");
  const fila = document.getElementById(`serie_${setId}`);
  if (fila) fila.classList.toggle("serie-hecha", marcar);
  // Vibración corta solo si el teléfono la permite y el usuario ya tocó la pantalla
  if (marcar && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(40);

  updateSessionProgressBar(document.querySelectorAll(".btn-check-set").length);
  mostrarPasoEntreno();
  saveActiveSessionState();
}

function updateSessionProgressBar(totalSets) {
  const completedCount = Object.keys(completedSetsState).length;
  const percentage = totalSets > 0 ? Math.round((completedCount / totalSets) * 100) : 0;
  const fill = $("#sessionProgressFill");
  const text = $("#sessionProgressText");
  if (fill) fill.style.width = `${percentage}%`;
  if (text) text.textContent = `${completedCount} de ${totalSets} series completadas (${percentage}%)`;
}

function cancelSession() {
  if (confirm("¿Deseas cancelar el entrenamiento de hoy? No se guardará.")) {
    stopRestTimer();
    currentActiveRoutine = null;
    completedSetsState = {};
    localStorage.removeItem("atlas_active_workout_session");
    salirModoEntreno();
    if (currentUserData) renderHoy(currentUserData);
  }
}

/* ---------- FUNCIONES DEL TEMPORIZADOR DE DESCANSO ---------- */
function setRestTimerDuration(val) {
  restTimerDuration = parseInt(val, 10) || 60;
  saveActiveSessionState();
}

function toggleRestTimerEnabled(enabled) {
  restTimerEnabled = !!enabled;
  if (!restTimerEnabled) {
    stopRestTimer();
  }
  saveActiveSessionState();
}

function startRestTimer() {
  if (!restTimerEnabled) return;

  stopRestTimer();

  restTimeRemaining = restTimerDuration;
  isTimerPaused = false;

  const timerWidget = $("#floatingRestTimer");
  if (timerWidget) timerWidget.classList.remove("hidden");

  updateRestTimerUI();

  restTimerInterval = setInterval(() => {
    if (!isTimerPaused) {
      restTimeRemaining--;
      updateRestTimerUI();

      if (restTimeRemaining <= 0) {
        finishRestTimer();
      }
    }
  }, 1000);
}

function updateRestTimerUI() {
  const timerText = $("#floatingTimerText");
  const progressFill = $("#floatingTimerProgressFill");
  const subtext = $("#floatingTimerSubtext");
  const pauseBtn = $("#togglePauseTimerBtn");

  if (timerText) {
    const mins = Math.floor(Math.max(0, restTimeRemaining) / 60);
    const secs = Math.max(0, restTimeRemaining) % 60;
    timerText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  if (progressFill) {
    const pct = restTimerDuration > 0 ? (restTimeRemaining / restTimerDuration) * 100 : 0;
    progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  if (pauseBtn) {
    pauseBtn.textContent = isTimerPaused ? '▶️' : '⏸️';
  }

  if (subtext) {
    subtext.textContent = isTimerPaused ? 'Temporizador pausado' : 'Temporizador Activo';
  }
}

function addRestTime(seconds) {
  restTimeRemaining += seconds;
  restTimerDuration += seconds;
  updateRestTimerUI();
}

function togglePauseRestTimer() {
  isTimerPaused = !isTimerPaused;
  updateRestTimerUI();
}

function stopRestTimer() {
  if (restTimerInterval) {
    clearInterval(restTimerInterval);
    restTimerInterval = null;
  }
  const timerWidget = $("#floatingRestTimer");
  if (timerWidget) {
    timerWidget.classList.add("hidden");
    timerWidget.classList.remove("timer-finished-glow");
  }
}

function finishRestTimer() {
  if (restTimerInterval) {
    clearInterval(restTimerInterval);
    restTimerInterval = null;
  }

  restTimeRemaining = 0;

  const timerText = $("#floatingTimerText");
  const progressFill = $("#floatingTimerProgressFill");
  const subtext = $("#floatingTimerSubtext");
  const timerWidget = $("#floatingRestTimer");

  if (timerText) timerText.textContent = '00:00';
  if (progressFill) progressFill.style.width = '0%';
  if (subtext) subtext.textContent = '¡Tiempo cumplido!';

  if (timerWidget) {
    timerWidget.classList.remove("hidden");
    timerWidget.classList.add("timer-finished-glow");
  }

  playTimerAlertSound();
}

function playTimerAlertSound() {
  try {
    unlockAudioContext();
    if (!userAudioCtx) return;

    const now = userAudioCtx.currentTime;

    // Tono 1 (587 Hz - D5)
    const osc1 = userAudioCtx.createOscillator();
    const gain1 = userAudioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(userAudioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    // Tono 2 (587 Hz - D5)
    const osc2 = userAudioCtx.createOscillator();
    const gain2 = userAudioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(587.33, now + 0.2);
    gain2.gain.setValueAtTime(0.3, now + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(userAudioCtx.destination);
    osc2.start(now + 0.2);
    osc2.stop(now + 0.35);

    // Tono 3 largo (880 Hz - A5)
    const osc3 = userAudioCtx.createOscillator();
    const gain3 = userAudioCtx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(880, now + 0.4);
    gain3.gain.setValueAtTime(0.4, now + 0.4);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    osc3.connect(gain3);
    gain3.connect(userAudioCtx.destination);
    osc3.start(now + 0.4);
    osc3.stop(now + 0.95);

    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }
  } catch (e) {
    console.error("Error al reproducir audio de la alarma:", e);
  }
}

function finishWorkoutSession() {
  if (!currentActiveRoutine) return;
  stopRestTimer()
  const token = localStorage.getItem("token");
  const totalSets = document.querySelectorAll(".btn-check-set").length;
  const completedCount = Object.keys(completedSetsState).length;

  const ejerciciosActualizados = [];
  currentActiveRoutine.ejercicios.forEach((ej, exIdx) => {
    const cantSeries = parseInt(ej.series) || 3;
    const seriesDetalle = [];

    for (let s = 0; s < cantSeries; s++) {
      const weightInput = document.querySelector(`.set-weight-input[data-ex="${exIdx}"][data-set="${s}"]`);
      const repsInput = document.querySelector(`.set-reps-input[data-ex="${exIdx}"][data-set="${s}"]`);

      const w = weightInput ? parseFloat(weightInput.value) || 0 : 0;
      const r = repsInput ? parseInt(repsInput.value) || 10 : 10;
      seriesDetalle.push({ peso: w, reps: r });
    }

    const finalPesoSet0 = seriesDetalle.length > 0 ? seriesDetalle[0].peso : ej.peso_kg;
    const finalRepsSet0 = seriesDetalle.length > 0 ? seriesDetalle[0].reps : ej.repeticiones;

    ejerciciosActualizados.push({
      id_ejercicio: ej.id_ejercicio,
      nombre_ejercicio: ej.nombre_ejercicio,
      peso_kg: finalPesoSet0,
      repeticiones: finalRepsSet0,
      series_detalle: seriesDetalle
    });
  });

  const sessionDetail = {
    routineTitle: currentActiveRoutine.titulo,
    completedSets: completedCount,
    totalSets: totalSets,
    timestamp: new Date().toISOString()
  };

  fetch(`${API_BASE}/sesiones`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_usuario: localStorage.getItem("userId"),
      id_rutina: currentActiveRoutine.id_rutina,
      detalle_json: sessionDetail,
      ejercicios_actualizados: ejerciciosActualizados
    })
  })
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        showToast("¡Entrenamiento guardado! Buen trabajo.", "exito");
        localStorage.removeItem("atlas_active_workout_session");
        currentActiveRoutine = null;
        completedSetsState = {};
        salirModoEntreno();
        loadDashboard();
      } else {
        showToast(res.msg || "Error al guardar sesión", "error");
      }
    })
    .catch(err => console.error(err));
}

/* ---------- PANEL DE ADMINISTRACIÓN ---------- */
let adminUsersData = [];
let editingAdminUserId = null;
let panelIniciado = false;
let vistaActual = null;

function initAdminDashboard() {
  const token = localStorage.getItem("token");
  const esAdmin = localStorage.getItem("esAdmin");
  const esRecepcionista = localStorage.getItem("esRecepcionista");

  if (!token || (esAdmin !== "true" && esRecepcionista !== "true")) {
    window.location.href = "index.html";
    return;
  }

  const esRecep = esRecepcionista === "true" && esAdmin !== "true";

  // Primera carga: datos del usuario, restricciones de recepción y navegación por vistas
  if (!panelIniciado) {
    panelIniciado = true;
    prepararUsuarioPanel(esRecep);
    if (esRecep) applyReceptionistRestrictions();
    iniciarNavegacionPanel();
  }

  fetch(`${API_BASE}/admin/usuarios`)
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        adminUsersData = res.usuarios || [];
        filterAdminUsers();
        refrescarPanelesAsistencia();
        refrescarFichaAbierta();
        if (vistaActual === "inicio") cargarInicio();
      } else {
        showToast(res.msg || "Error al cargar datos de administración", "error");
      }
    })
    .catch(err => console.error("Error al cargar panel admin:", err));
}

// Nombre, rol e inicial del usuario en el menú lateral
function prepararUsuarioPanel(esRecep) {
  const nombre = localStorage.getItem("nombre") || (esRecep ? "Recepción ATLAS" : "Administrador");
  const n = $("#adminGreeting");
  if (n) n.textContent = nombre;
  const rol = $("#sidebarRole");
  if (rol) rol.textContent = esRecep ? "Recepción" : "Administrador";
  const av = $("#sidebarAvatar");
  if (av) av.textContent = (nombre.trim().charAt(0) || "A").toUpperCase();
}

// Recepción no ve en la interfaz lo que es solo del admin (el servidor lo exige igual).
function applyReceptionistRestrictions() {
  // Menú, indicador "Cobrado hoy" y "Últimos pagos": se quitan
  document.querySelectorAll("a[data-solo-admin], .kpi[data-solo-admin], #inicioPagosCard").forEach(el => el.remove());
  const grid = document.querySelector(".kpi-grid");
  if (grid) grid.classList.add("kpi-3");
  // Las vistas solo de admin quedan ocultas y el navegador no las abre (ver mostrarVista)
}

function toggleAdminClientsSection() {
  irAVista("clientes");
}

function getClientStatusInfo(user) {
  const todayStr = getLocalTodayStr();
  const todayObj = new Date();
  const future5Obj = new Date(todayObj.getTime() + 5 * 24 * 60 * 60 * 1000);
  const yyyy = future5Obj.getFullYear();
  const mm = String(future5Obj.getMonth() + 1).padStart(2, '0');
  const dd = String(future5Obj.getDate()).padStart(2, '0');
  const future5Str = `${yyyy}-${mm}-${dd}`;

  const isActiva = user.membresia && user.membresia.estado === "activa";
  const vence = (user.membresia && user.membresia.vence) ? user.membresia.vence : "1970-01-01";

  if (!isActiva || vence < todayStr) {
    return {
      borderColor: "var(--danger)",
      badgeClass: "badge-expired",
      badgeText: vence < todayStr ? "vencida" : (user.membresia ? user.membresia.estado : "inactiva"),
      venceColor: "var(--danger)"
    };
  } else if (vence <= future5Str) {
    return {
      borderColor: "var(--warn)",
      badgeClass: "badge-warning",
      badgeText: "por vencer",
      venceColor: "var(--warn)"
    };
  } else {
    return {
      borderColor: "var(--ok)",
      badgeClass: "badge-active",
      badgeText: "activa",
      venceColor: "var(--ok)"
    };
  }
}

function toggleClientCardDetails(headerElem) {
  const card = headerElem.closest('.routine-card');
  if (!card) return;

  const details = card.querySelector('.client-card-details');
  const chevron = card.querySelector('.accordion-chevron');

  if (!details) return;

  if (details.classList.contains('hidden')) {
    details.classList.remove('hidden');
    if (chevron) {
      chevron.textContent = '▲ Ocultar';
    }
    card.style.background = 'var(--surface)';
  } else {
    details.classList.add('hidden');
    if (chevron) {
      chevron.textContent = '▼ Ver más';
    }
    card.style.background = 'var(--surface-2)';
  }
}

function renderAdminUsersGrid(users) {
  const tbody = $("#adminUsersGrid");
  if (!tbody) return;

  const conteo = $("#clientesConteo");
  if (conteo) {
    const total = adminUsersData.length;
    conteo.textContent = users.length === total
      ? `${total} ${total === 1 ? "cliente" : "clientes"}`
      : `${users.length} de ${total} clientes`;
  }

  if (users.length === 0) {
    tbody.innerHTML = adminUsersData.length === 0
      ? `<tr class="fila-vacia"><td colspan="6" class="report-empty">No hay clientes registrados aún.
          <button type="button" class="btn-secondary" onclick="openCreateUserModal()" style="width: auto; margin-left: 0.6rem;">+ Registrar cliente</button></td></tr>`
      : `<tr class="fila-vacia"><td colspan="6" class="report-empty">Ningún cliente coincide con los filtros.</td></tr>`;
    return;
  }

  // Los textos van con esc(); en los atributos solo va el id numérico
  tbody.innerHTML = users.map(u => {
    const status = getClientStatusInfo(u);
    const id = Number(u.id_usuario);
    const sub = u.cedula ? `C.I. ${u.cedula}` : (u.correo || "");
    const seleccionado = id === Number(fichaClienteId) ? " seleccionado" : "";
    return `<tr tabindex="0" data-id="${id}" class="${seleccionado}" aria-label="Abrir ficha de ${esc(u.nombre_completo)}">
      <td><span class="cliente-nombre">${esc(u.nombre_completo)}</span><span class="cliente-sub">${esc(sub)}</span></td>
      <td class="col-md muted">${esc(u.ultimo_plan || "Sin plan")}</td>
      <td class="hora">${esc(formatFechaCorta(u.membresia && u.membresia.vence))}</td>
      <td><span class="badge ${esc(status.badgeClass)}">${esc(status.badgeText)}</span></td>
      <td class="col-md">${u.tiene_deuda == 1 ? `<span class="badge badge-expired">Deuda</span>` : `<span class="muted">—</span>`}</td>
      <td class="col-md hora">${u.ultimo_pago ? esc(formatFechaCorta(u.ultimo_pago)) : `<span class="muted">Sin pagos</span>`}</td>
    </tr>`;
  }).join("");
}

function filterAdminUsers() {
  const queryInput = $("#searchUserFilter");
  const query = queryInput ? queryInput.value.toLowerCase().trim() : "";

  const statusSelect = $("#clientStatusFilterSelect");
  const statusFilter = statusSelect ? statusSelect.value : "todos";

  const planSelect = $("#clientPlanFilterSelect");
  const planFilter = planSelect ? planSelect.value : "todos";

  const todayStr = getLocalTodayStr();
  let list = [...adminUsersData];

  // 0. Filtrar por tipo de plan (Mensualidad incluye Estudiante)
  if (planFilter !== "todos") {
    list = list.filter(u => planCategoria(u.ultimo_plan) === planFilter);
  }

  // 1. Filtrar por texto si hay consulta
  if (query) {
    list = list.filter(u =>
      u.nombre_completo.toLowerCase().includes(query) ||
      u.correo.toLowerCase().includes(query) ||
      (u.cedula && u.cedula.toLowerCase().includes(query)) ||
      (u.telefono && u.telefono.toLowerCase().includes(query))
    );
  }

  // 2. Filtrar por estado y aplicar ordenamiento
  if (statusFilter === "deudores") {
    list = list.filter(u => u.tiene_deuda == 1);
  } else if (statusFilter === "proximos") {
    const todayObj = new Date();
    const future5Obj = new Date(todayObj.getTime() + 5 * 24 * 60 * 60 * 1000);
    const future5Str = formatYYYYMMDD(future5Obj);

    list = list.filter(u =>
      u.membresia &&
      u.membresia.estado === "activa" &&
      u.membresia.vence &&
      u.membresia.vence >= todayStr &&
      u.membresia.vence <= future5Str
    );

    list.sort((a, b) => {
      const dateA = a.membresia.vence || '9999-12-31';
      const dateB = b.membresia.vence || '9999-12-31';
      return dateA.localeCompare(dateB);
    });
  } else if (statusFilter === "vencidos") {
    // Filtrar clientes vencidos o sin membresía activa
    list = list.filter(u => u.membresia.estado !== "activa" || (u.membresia.vence && u.membresia.vence < todayStr));

    // Ordenar por fecha de vencimiento (del más reciente vencido hacia atrás)
    list.sort((a, b) => {
      const dateA = a.membresia.vence || '1970-01-01';
      const dateB = b.membresia.vence || '1970-01-01';
      return dateB.localeCompare(dateA);
    });
  } else if (statusFilter === "activos") {
    // Filtrar clientes activos
    list = list.filter(u => u.membresia.estado === "activa" && u.membresia.vence >= todayStr);

    // Ordenar activos por fecha de pago más reciente
    list.sort((a, b) => {
      const payA = a.ultimo_pago || '1970-01-01';
      const payB = b.ultimo_pago || '1970-01-01';
      return payB.localeCompare(payA);
    });
  } else {
    // "todos" (Listado General): Ordenar por fecha del pago más reciente
    list.sort((a, b) => {
      const payA = a.ultimo_pago || '1970-01-01';
      const payB = b.ultimo_pago || '1970-01-01';
      if (payA !== payB) {
        return payB.localeCompare(payA);
      }
      return b.id_usuario - a.id_usuario;
    });
  }

  // Si el usuario eligió una columna, ese orden manda sobre el orden del filtro
  if (clientesOrden.key) list = ordenarClientes(list);

  renderAdminUsersGrid(list);
}

function openCreateUserModal() {
  editingAdminUserId = null;
  const title = $("#createUserModalTitle");
  if (title) title.textContent = "Registrar Nuevo Cliente";
  const btn = $("#createUserModalSubmitBtn");
  if (btn) btn.textContent = "Registrar Cliente";

  const modal = $("#createUserModal");
  if (modal) modal.classList.remove("hidden");
  const form = $("#createClientForm");
  if (form) form.reset();
}

function closeCreateUserModal() {
  editingAdminUserId = null;
  const modal = $("#createUserModal");
  if (modal) modal.classList.add("hidden");
}

function editUserByAdmin(id_usuario) {
  const user = adminUsersData.find(u => u.id_usuario === id_usuario);
  if (!user) return;

  editingAdminUserId = id_usuario;

  const title = $("#createUserModalTitle");
  if (title) title.textContent = "Editar Datos del Cliente";
  const btn = $("#createUserModalSubmitBtn");
  if (btn) btn.textContent = "Guardar Cambios";

  $("#newClientNombre").value = user.nombre_completo || "";
  $("#newClientEmail").value = user.correo || "";
  const cedulaInput = $("#newClientCedula");
  if (cedulaInput) cedulaInput.value = user.cedula || "";
  $("#newClientTelefono").value = user.telefono || "";

  const modal = $("#createUserModal");
  if (modal) modal.classList.remove("hidden");
}

function saveNewUser(event) {
  event.preventDefault();
  const nombre_completo = $("#newClientNombre").value.trim();
  const correo = $("#newClientEmail").value.trim();
  const cedulaInput = $("#newClientCedula");
  const cedula = cedulaInput ? cedulaInput.value.trim() : "";
  const telefono = $("#newClientTelefono").value.trim();

  const url = editingAdminUserId ? `${API_BASE}/admin/usuarios/${editingAdminUserId}` : `${API_BASE}/admin/usuarios`;
  const method = editingAdminUserId ? "PUT" : "POST";

  fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre_completo, correo, cedula, telefono })
  })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.msg || "Error al procesar solicitud de cliente");
      return data;
    })
    .then(res => {
      const msg = editingAdminUserId ? "¡Datos del cliente actualizados exitosamente!" : "¡Cliente registrado exitosamente!";
      showToast(msg, "exito");
      closeCreateUserModal();
      initAdminDashboard();
      if (!$("#adminClientsSection").classList.contains("hidden")) {
        renderAdminUsersGrid(adminUsersData);
      }
    })
    .catch(err => showToast(err.message, "error"));
}

let pendingDeleteUserId = null;

function deleteUserByAdmin(id_usuario) {
  const user = adminUsersData.find(u => u.id_usuario === id_usuario);
  if (!user) return;

  pendingDeleteUserId = id_usuario;
  $("#deleteTargetUserName").textContent = user.nombre_completo;
  $("#deleteAdminPassword").value = "";

  const modal = $("#confirmDeleteModal");
  if (modal) modal.classList.remove("hidden");
}

function closeConfirmDeleteModal() {
  pendingDeleteUserId = null;
  const modal = $("#confirmDeleteModal");
  if (modal) modal.classList.add("hidden");
}

function executeDeleteUserByAdmin(event) {
  event.preventDefault();
  if (!pendingDeleteUserId) return;

  const admin_password = $("#deleteAdminPassword").value;

  fetch(`${API_BASE}/admin/usuarios/${pendingDeleteUserId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin_password })
  })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.msg || "Error al eliminar cliente");
      return data;
    })
    .then(res => {
      showToast("¡Cliente eliminado exitosamente!", "exito");
      closeConfirmDeleteModal();
      initAdminDashboard();
      adminUsersData = adminUsersData.filter(u => u.id_usuario !== pendingDeleteUserId);
      renderAdminUsersGrid(adminUsersData);
    })
    .catch(err => showToast(err.message, "error"));
}

function viewUserProgressModal(id_usuario) {
  const user = adminUsersData.find(u => u.id_usuario === id_usuario);
  if (!user) return;

  $("#progressModalUserName").textContent = user.nombre_completo;
  $("#progressModalUserEmail").textContent = `${user.correo} • ${user.telefono || 'Sin teléfono'}`;

  // Renderizar Rutinas
  const routinesList = $("#modalUserRoutinesList");
  routinesList.innerHTML = "";

  if (!user.rutinas || user.rutinas.length === 0) {
    routinesList.innerHTML = `<p style="font-size: 0.9rem; color: var(--text-muted);">El usuario no tiene rutinas registradas aún.</p>`;
  } else {
    user.rutinas.forEach(r => {
      const item = document.createElement("div");
      item.style.cssText = "background: var(--surface-2); padding: 1rem; border-radius: 12px; border: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;";

      const exList = r.ejercicios && r.ejercicios.length > 0
        ? r.ejercicios.map(e => `• ${esc(e.nombre_ejercicio || e.titulo)} (${esc(e.series)} series x ${esc(e.repeticiones)} reps - ${esc(formatExerciseWeights(e))})`).join("<br>")
        : "Sin ejercicios";

      item.innerHTML = `
        <div>
          <h5 style="font-size: 1.05rem; font-weight: 700;">${esc(r.titulo)}</h5>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">${esc(r.descripcion || "Sin descripción")} | Horario: ${esc(r.horario || "Flexible")}</p>
          <div style="font-size: 0.85rem; color: var(--text-main); line-height: 1.4;">${exList}</div>
        </div>
        <button type="button" class="btn-primary" onclick="inspectRoutineDetailByAdmin(${esc(id_usuario)}, ${esc(r.id_rutina)})" style="font-size: 0.85rem; padding: 0.6rem 1rem; width: auto; white-space: nowrap;">
          Ver Detalle Completo
        </button>
      `;
      routinesList.appendChild(item);
    });
  }

  $("#userProgressModal").classList.remove("hidden");
}

function closeUserProgressModal() {
  $("#userProgressModal").classList.add("hidden");
}

function inspectRoutineDetailByAdmin(id_usuario, id_rutina) {
  const user = adminUsersData.find(u => u.id_usuario === id_usuario);
  if (!user || !user.rutinas) return;

  const routine = user.rutinas.find(r => r.id_rutina === id_rutina);
  if (!routine) return;

  $("#adminRoutineTitle").textContent = `${routine.titulo} (${user.nombre_completo})`;
  $("#adminRoutineDesc").textContent = `${routine.descripcion || "Sin descripción"} | Horario: ${routine.horario || "Flexible"}`;

  const container = $("#adminRoutineExercisesContainer");
  container.innerHTML = "";

  if (!routine.ejercicios || routine.ejercicios.length === 0) {
    container.innerHTML = `<p style="font-size: 0.95rem; color: var(--text-muted); padding: 1.5rem; text-align: center;">Esta rutina no tiene ejercicios registrados.</p>`;
  } else {
    routine.ejercicios.forEach((ej, exIdx) => {
      const block = document.createElement("div");
      block.className = "exercise-block";

      let setsHtml = "";
      const cantSeries = parseInt(ej.series) || 3;
      const seriesDetalle = getSeriesDetalleArray(ej);

      for (let s = 0; s < cantSeries; s++) {
        let setWeight = ej.peso_kg || 0;
        let setReps = ej.repeticiones || 10;

        if (seriesDetalle && seriesDetalle[s]) {
          if (seriesDetalle[s].peso !== undefined) setWeight = seriesDetalle[s].peso;
          if (seriesDetalle[s].reps !== undefined) setReps = seriesDetalle[s].reps;
        }

        setsHtml += `
          <tr>
            <td style="font-weight: 600; color: var(--text-muted);">Serie ${esc(s + 1)}</td>
            <td>
              <span style="font-size: 1rem; font-weight: 700; color: var(--link);">${esc(setWeight)} kg</span>
            </td>
            <td>
              <span style="font-size: 1rem; font-weight: 700; color: var(--text-main);">${esc(setReps)} reps</span>
            </td>
          </tr>
        `;
      }

      block.innerHTML = `
        <div class="exercise-header">
          <span class="exercise-name">${esc(ej.nombre_ejercicio || ej.titulo || "Ejercicio")}</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">${esc(ej.series)} Series × ${esc(ej.repeticiones)} Reps (${esc(formatExerciseWeights(ej))})</span>
        </div>
        <table class="sets-table">
          <thead>
            <tr>
              <th>Serie</th>
              <th>Peso Usado</th>
              <th>Repeticiones</th>
            </tr>
          </thead>
          <tbody>
            ${setsHtml}
          </tbody>
        </table>
      `;
      container.appendChild(block);
    });
  }

  $("#adminRoutineDetailModal").classList.remove("hidden");
}

function closeAdminRoutineDetailModal() {
  $("#adminRoutineDetailModal").classList.add("hidden");
}

/* ---------- GESTIÓN DE PAGOS Y MEMBRESÍAS ---------- */
let selectedPaymentUserId = null;

function openRegisterPaymentModal(preselectUserId = null) {
  const modal = $("#registerPaymentModal");
  if (!modal) return;

  const form = $("#registerPaymentForm");
  if (form) form.reset();

  const abonoInput = $("#paymentEsAbono");
  if (abonoInput) abonoInput.checked = false;

  const searchInput = $("#paymentUserSearch");
  if (searchInput) searchInput.value = "";

  const resultsList = $("#paymentUserResultsList");
  if (resultsList) {
    resultsList.innerHTML = "";
    resultsList.classList.add("hidden");
  }

  // Precargar fecha actual YYYY-MM-DD en hora local
  const dateInput = $("#paymentFecha");
  if (dateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  if (preselectUserId) {
    selectClientForPayment(preselectUserId);
  } else {
    clearSelectedPaymentUser();
  }

  modal.classList.remove("hidden");
}

function closeRegisterPaymentModal() {
  const modal = $("#registerPaymentModal");
  if (modal) modal.classList.add("hidden");
  clearSelectedPaymentUser();
}

function filterPaymentUserList() {
  const searchInput = $("#paymentUserSearch");
  const resultsList = $("#paymentUserResultsList");
  if (!searchInput || !resultsList) return;

  const query = searchInput.value.toLowerCase().trim();
  if (!query) {
    resultsList.innerHTML = "";
    resultsList.classList.add("hidden");
    return;
  }

  const matches = adminUsersData.filter(u =>
    u.nombre_completo.toLowerCase().includes(query) ||
    u.correo.toLowerCase().includes(query) ||
    (u.cedula && u.cedula.toLowerCase().includes(query)) ||
    (u.telefono && u.telefono.toLowerCase().includes(query))
  );

  resultsList.innerHTML = "";
  if (matches.length === 0) {
    resultsList.innerHTML = `<div style="padding: 0.8rem; font-size: 0.85rem; color: var(--text-muted); text-align: center;">No se encontraron clientes coincidentes.</div>`;
    resultsList.classList.remove("hidden");
    return;
  }

  matches.forEach(u => {
    const item = document.createElement("div");
    item.style.cssText = "padding: 0.6rem 0.8rem; cursor: pointer; border-bottom: 1px solid var(--border-light); transition: background 0.2s ease;";
    item.onmouseover = () => item.style.background = "var(--surface-3)";
    item.onmouseout = () => item.style.background = "transparent";

    const statusInfo = getClientStatusInfo(u);
    let emoji = '🔴';
    if (statusInfo.badgeText === 'activa') emoji = '🟢';
    else if (statusInfo.badgeText === 'por vencer') emoji = '🟡';

    const badgeTxt = statusInfo.badgeText.charAt(0).toUpperCase() + statusInfo.badgeText.slice(1);
    const estadoBadge = `${esc(emoji)} ${esc(badgeTxt)}`;
    const venceStr = (u.membresia && u.membresia.vence) ? u.membresia.vence : 'Sin fecha';

    item.innerHTML = `
      <div style="font-weight: 600; color: var(--text-main); font-size: 0.9rem;">${esc(u.nombre_completo)}</div>
      <div style="font-size: 0.8rem; color: var(--link);">✉️ ${esc(u.correo)} • 🪪 ${esc(u.cedula || 'Sin CI')} • <span style="color: var(--text-muted);">📞 ${esc(u.telefono || 'Sin tel')}</span></div>
      <div style="font-size: 0.8rem; color: ${esc(statusInfo.venceColor)}; margin-top: 0.2rem;">📅 Membresía Vence: <strong>${esc(venceStr)}</strong> (${estadoBadge})</div>
    `;

    item.onclick = () => selectClientForPayment(u.id_usuario);
    resultsList.appendChild(item);
  });

  resultsList.classList.remove("hidden");
}

function selectClientForPayment(id_usuario) {
  const user = adminUsersData.find(u => u.id_usuario === id_usuario);
  if (!user) return;

  selectedPaymentUserId = id_usuario;

  const badge = $("#paymentSelectedUserBadge");
  const badgeText = $("#paymentSelectedUserText");
  const resultsList = $("#paymentUserResultsList");
  const searchInput = $("#paymentUserSearch");

  const venceStr = (user.membresia && user.membresia.vence) ? user.membresia.vence : 'Sin fecha registrada';
  const estadoStr = (user.membresia && user.membresia.estado) ? user.membresia.estado : 'Sin membresía';
  const estadoColor = estadoStr === 'activa' ? 'var(--ok)' : 'var(--danger)';

  if (badgeText) {
    badgeText.innerHTML = `
      <div style="line-height: 1.5;">
        <strong style="font-size: 1rem; color: var(--text-main);">${esc(user.nombre_completo)}</strong>
        <span style="font-size: 0.82rem; color: var(--link); display: block;">✉️ ${esc(user.correo)} • 📞 ${esc(user.telefono || 'Sin teléfono')}</span>
        <span style="font-size: 0.85rem; color: ${esc(estadoColor)}; font-weight: 600; margin-top: 0.3rem; display: inline-block;">
          📅 Membresía Vence: <strong>${esc(venceStr)}</strong> (${esc(estadoStr)})
        </span>
      </div>
    `;
  }
  if (badge) badge.classList.remove("hidden");
  if (resultsList) resultsList.classList.add("hidden");
  if (searchInput) {
    searchInput.value = user.nombre_completo;
    searchInput.removeAttribute("required");
  }
}

function clearSelectedPaymentUser() {
  selectedPaymentUserId = null;
  const badge = $("#paymentSelectedUserBadge");
  const searchInput = $("#paymentUserSearch");
  const resultsList = $("#paymentUserResultsList");

  if (badge) badge.classList.add("hidden");
  if (resultsList) resultsList.classList.add("hidden");
  if (searchInput) {
    searchInput.value = "";
    searchInput.setAttribute("required", "required");
  }
}

function savePayment(event) {
  event.preventDefault();

  if (!selectedPaymentUserId) {
    showToast("Por favor selecciona un cliente de la lista de sugerencias.", "aviso");
    return;
  }

  const moneda = $("#paymentMoneda").value;
  const monto = $("#paymentMonto").value;
  const plan = $("#paymentPlan").value;
  const fecha_pago = $("#paymentFecha").value;
  const es_abono = $("#paymentEsAbono") && $("#paymentEsAbono").checked ? 1 : 0;
  const turnoRadio = document.querySelector('input[name="paymentTurno"]:checked');
  const turno = turnoRadio ? turnoRadio.value : null;

  fetch(`${API_BASE}/admin/pagos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_usuario: selectedPaymentUserId,
      monto,
      moneda,
      plan,
      fecha_pago,
      es_abono,
      turno
    })
  })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.msg || "Error al registrar pago");
      return data;
    })
    .then(res => {
      showToast(res.msg || "¡Pago registrado exitosamente! La membresía del cliente ha sido actualizada.", "exito");
      closeRegisterPaymentModal();
      initAdminDashboard();
      if (!$("#adminClientsSection").classList.contains("hidden")) {
        renderAdminUsersGrid(adminUsersData);
      }
      if (!$("#adminPaymentsSection").classList.contains("hidden")) {
        loadAdminPaymentsHistory(fecha_pago);
      }
    })
    .catch(err => showToast(err.message, "error"));
}

let currentPaymentsData = [];

function toggleAdminPaymentsSection() {
  irAVista("pagos");
}

function changePaymentsHistoryDate() {
  const clientInput = $("#historyClientSearch");
  if (clientInput) clientInput.value = "";

  const input = $("#historyDateFilter");
  if (input && input.value) {
    loadAdminPaymentsHistory(input.value);
  }
}

function filterPaymentsHistoryByClient() {
  const clientInput = $("#historyClientSearch");
  const query = clientInput ? clientInput.value.trim() : "";

  if (query.length > 0) {
    loadAdminPaymentsHistory(null, query);
  } else {
    const dateInput = $("#historyDateFilter");
    const targetDate = (dateInput && dateInput.value) ? dateInput.value : getLocalTodayStr();
    loadAdminPaymentsHistory(targetDate);
  }
}

function clearHistoryClientSearch() {
  const clientInput = $("#historyClientSearch");
  if (clientInput) clientInput.value = "";

  const dateInput = $("#historyDateFilter");
  const targetDate = (dateInput && dateInput.value) ? dateInput.value : getLocalTodayStr();
  loadAdminPaymentsHistory(targetDate);
}

function getLocalTodayStr() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatYYYYMMDD(d) {
  if (!d) return getLocalTodayStr();
  if (typeof d === 'string') {
    const clean = d.split('T')[0].split(' ')[0];
    const parts = clean.split('-');
    if (parts.length >= 3 && parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
  }
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return getLocalTodayStr();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(d).split('T')[0].split(' ')[0];
}

function loadAdminPaymentsHistory(targetDate = null, searchQuery = null) {
  const container = $("#adminPaymentsList");
  if (!container) return;

  let url = `${API_BASE}/admin/pagos`;
  let emptyMsg = "";

  if (searchQuery && searchQuery.trim() !== "") {
    url += `?q=${encodeURIComponent(searchQuery.trim())}`;
    emptyMsg = `No se encontraron pagos registrados para el cliente "${esc(searchQuery)}".`;
  } else {
    const dateInput = $("#historyDateFilter");
    const todayStr = getLocalTodayStr();

    if (dateInput) {
      if (targetDate) {
        dateInput.value = targetDate;
      } else if (!dateInput.value) {
        dateInput.value = todayStr;
      }
    }

    const selectedDate = (dateInput && dateInput.value) ? dateInput.value : todayStr;
    url += `?fecha=${selectedDate}`;
    emptyMsg = `No se registraron pagos en la fecha seleccionada (${esc(selectedDate)}).`;
  }

  fetch(url)
    .then(r => r.json())
    .then(res => {
      if (!res.ok) {
        container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Error al obtener el historial de pagos.</p>`;
        return;
      }

      currentPaymentsData = res.pagos || [];

      // Actualizar Resumen de Totales por Moneda
      const totales = res.totales || { USD: "0.00", COP: "0.00", BS: "0.00", Bancolombia: "0.00", USDT: "0.00", CLP: "0.00" };
      updatePaymentsSummaryUI(totales);

      container.innerHTML = "";

      if (currentPaymentsData.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; background: var(--surface); border-radius: 12px; border: 1px dashed var(--border-light);">
            <p style="color: var(--text-muted); font-size: 0.95rem;">${emptyMsg}</p>
          </div>
        `;
        return;
      }

      currentPaymentsData.forEach(p => {
        const item = document.createElement("div");
        item.style.cssText = "background: var(--surface-2); padding: 0.9rem 1.2rem; border-radius: 10px; border: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.8rem; transition: transform 0.2s ease;";

        const abonoBadgeHtml = (p.es_abono == 1 || p.es_abono === true)
          ? `<span class="badge" style="background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-border); font-size: 0.78rem; font-weight: 600; margin-left: 0.3rem;">⚠️ Abono Parcial</span>`
          : "";

        const turnoColor = 'var(--text-2)';
        const turnoIcon = p.turno === 'AM' ? '☀️' : (p.turno === 'PM' ? '🌙' : '⏰');
        const turnoBadgeHtml = p.turno
          ? `<span class="badge" style="background: var(--surface-3); color: ${turnoColor}; border: 1px solid var(--border-strong); font-size: 0.78rem; font-weight: 600; margin-left: 0.3rem;">${turnoIcon} ${p.turno}</span>`
          : '';

        item.innerHTML = `
          <div>
            <strong style="color: var(--text-main); font-size: 1rem;">${esc(p.nombre_completo)}</strong> 
            <span style="font-size: 0.8rem; color: var(--link);">(✉️ ${esc(p.correo)} • 📞 ${esc(p.telefono || 'Sin tel')})</span><br>
            <span style="font-size: 0.82rem; color: var(--text-muted);">
              Plan: <strong style="color: var(--text-main);">${esc(p.plan)}</strong> ${abonoBadgeHtml} ${turnoBadgeHtml} | Fecha de Pago: <strong>${esc(p.fecha_pago)}</strong>
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <span class="badge" style="background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-border); font-size: 0.95rem; font-weight: 700; padding: 0.4rem 0.8rem;">
              +${esc(p.monto)} ${esc(p.moneda)}
            </span>
            <button type="button" class="btn-secondary" onclick="editPayment(${esc(p.id_pago)})" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">
              Editar
            </button>
            <button type="button" class="btn-secondary" onclick="inspectPaymentDetail(${esc(p.id_pago)})" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">
              Ver detalle
            </button>
          </div>
        `;
        container.appendChild(item);
      });
    })
    .catch(err => console.error("Error al obtener pagos:", err));
}

function inspectPaymentDetail(id_pago) {
  const payment = currentPaymentsData.find(p => p.id_pago === id_pago);
  if (!payment) return;

  $("#detailClientName").textContent = payment.nombre_completo;
  $("#detailClientEmailPhone").textContent = `✉️ ${payment.correo} • 📞 ${payment.telefono || 'Sin teléfono'}`;
  $("#detailPlan").textContent = payment.plan;
  $("#detailMonto").textContent = `${payment.monto} ${payment.moneda}`;

  // Fecha de Realización del Pago (Día que se registra en el sistema)
  $("#detailPaymentDate").textContent = payment.fecha_pago;

  // Fecha en que corre el plan (La seleccionada por el administrador ➔ Vencimiento)
  const inicioPlan = payment.fecha_inicio_plan || payment.fecha_pago;
  const finPlan = payment.fecha_fin_plan || "Vencimiento no registrado";

  $("#detailPlanDateRange").textContent = `${inicioPlan}  ➔  ${finPlan}`;

  $("#paymentDetailModal").classList.remove("hidden");
}

function closePaymentDetailModal() {
  $("#paymentDetailModal").classList.add("hidden");
}

function editPayment(id_pago) {
  const payment = currentPaymentsData.find(p => p.id_pago === id_pago);
  if (!payment) return;

  $("#editPaymentId").value = payment.id_pago;
  $("#editPaymentClientName").textContent = payment.nombre_completo + " (" + payment.correo + ")";
  $("#editPaymentMoneda").value = payment.moneda;
  $("#editPaymentMonto").value = payment.monto;
  $("#editPaymentPlan").value = payment.plan;
  $("#editPaymentFechaPago").value = payment.fecha_pago;

  // Set dates, fallbacks if not present
  $("#editPaymentFechaInicio").value = payment.fecha_inicio_plan || payment.fecha_pago;
  $("#editPaymentFechaFin").value = payment.fecha_fin_plan || payment.fecha_pago;

  // Turno
  if (payment.turno === 'AM' || payment.turno === 'PM') {
    document.querySelector(`input[name="editPaymentTurno"][value="${payment.turno}"]`).checked = true;
  } else {
    // Default or uncheck
    document.querySelector(`input[name="editPaymentTurno"][value="AM"]`).checked = true;
  }

  // Es Abono
  $("#editPaymentEsAbono").checked = (payment.es_abono == 1 || payment.es_abono === true);

  $("#editPaymentModal").classList.remove("hidden");
}

function closeEditPaymentModal() {
  $("#editPaymentModal").classList.add("hidden");
}

async function saveEditPayment(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = "Actualizando...";

  const id_pago = $("#editPaymentId").value;

  const payload = {
    moneda: $("#editPaymentMoneda").value,
    monto: parseFloat($("#editPaymentMonto").value) || 0,
    plan: $("#editPaymentPlan").value,
    fecha_pago: $("#editPaymentFechaPago").value,
    fecha_inicio_plan: $("#editPaymentFechaInicio").value,
    fecha_fin_plan: $("#editPaymentFechaFin").value,
    turno: document.querySelector('input[name="editPaymentTurno"]:checked')?.value || 'AM',
    es_abono: $("#editPaymentEsAbono").checked ? 1 : 0
  };

  try {
    const res = await fetch(`${API_BASE}/admin/pagos/${id_pago}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      showToast("Pago actualizado correctamente.", "exito");
      closeEditPaymentModal();
      // Recargar historial
      const dateInput = $("#historyDateFilter");
      const targetDate = (dateInput && dateInput.value) ? dateInput.value : getLocalTodayStr();
      const clientInput = $("#historyClientSearch");
      const query = clientInput ? clientInput.value.trim() : "";
      if (query.length > 0) {
        loadAdminPaymentsHistory(null, query);
      } else {
        loadAdminPaymentsHistory(targetDate);
      }
    } else {
      showToast("Error: " + data.msg, "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Ocurrió un error al actualizar el pago.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "✓ Actualizar Pago";
  }
}

/* ---------- ENVÍO DE RECORDATORIOS WHATSAPP SIN EMOJIS ---------- */
// Busca los datos del cliente por id (evita pasar nombres con comillas dentro del atributo onclick)
function sendWhatsAppReminderById(idUsuario) {
  const u = adminUsersData.find(x => String(x.id_usuario) === String(idUsuario));
  if (!u) return;
  const m = u.membresia || {};
  sendWhatsAppReminder(u.nombre_completo, u.telefono || '', m.vence, m.estado);
}

function sendWhatsAppReminder(nombreCompleto, telefono, venceDate, estado) {
  if (!telefono || telefono.trim() === "" || telefono.trim() === "Sin teléfono") {
    showToast("El cliente no tiene un número de teléfono registrado. Puedes agregar uno editando sus datos.", "aviso");
    return;
  }

  const cleanPhone = telefono.replace(/[^0-9]/g, "");
  if (!cleanPhone) {
    showToast("El número de teléfono registrado no es válido.", "aviso");
    return;
  }

  const msg = `Hola ${nombreCompleto}, te recordamos que tu membresia en ATLAS Gym vence el ${venceDate}. Te esperamos para renovar tu plan.`;
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

/* ---------- MANEJO DE RANGOS DE FECHA Y COPIADO DE RESUMEN ---------- */
function togglePaymentDateMode() {
  const mode = $("#paymentDateMode") ? $("#paymentDateMode").value : "dia";
  const singleInput = $("#historyDateFilter");
  const rangeContainer = $("#rangeDateContainer");

  if (mode === "rango") {
    if (singleInput) singleInput.classList.add("hidden");
    if (rangeContainer) {
      rangeContainer.classList.remove("hidden");
      const todayStr = getLocalTodayStr();
      if (!$("#historyDateFrom").value) $("#historyDateFrom").value = todayStr;
      if (!$("#historyDateTo").value) $("#historyDateTo").value = todayStr;
    }
  } else {
    if (rangeContainer) rangeContainer.classList.add("hidden");
    if (singleInput) singleInput.classList.remove("hidden");
    changePaymentsHistoryDate();
  }
}

function loadAdminPaymentsRangeHistory() {
  const from = $("#historyDateFrom") ? $("#historyDateFrom").value : null;
  const to = $("#historyDateTo") ? $("#historyDateTo").value : null;

  if (!from || !to) {
    showToast("Por favor selecciona ambas fechas del rango.", "aviso");
    return;
  }

  const container = $("#adminPaymentsList");
  if (!container) return;

  fetch(`${API_BASE}/admin/pagos?fecha_inicio=${from}&fecha_fin=${to}`)
    .then(r => r.json())
    .then(res => {
      if (!res.ok) {
        container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Error al obtener los pagos del rango de fechas.</p>`;
        return;
      }

      currentPaymentsData = res.pagos || [];

      const totales = res.totales || { USD: "0.00", COP: "0.00", BS: "0.00", Bancolombia: "0.00", USDT: "0.00", CLP: "0.00" };
      updatePaymentsSummaryUI(totales);

      container.innerHTML = "";

      if (currentPaymentsData.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; background: var(--surface); border-radius: 12px; border: 1px dashed var(--border-light);">
            <p style="color: var(--text-muted); font-size: 0.95rem;">No se registraron pagos en el rango seleccionado (${esc(from)} a ${esc(to)}).</p>
          </div>
        `;
        return;
      }

      currentPaymentsData.forEach(p => {
        const item = document.createElement("div");
        item.style.cssText = "background: var(--surface-2); padding: 0.9rem 1.2rem; border-radius: 10px; border: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.8rem;";

        const abonoBadgeHtml = (p.es_abono == 1 || p.es_abono === true)
          ? `<span class="badge" style="background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-border); font-size: 0.78rem; font-weight: 600; margin-left: 0.3rem;">⚠️ Abono Parcial</span>`
          : '';

        const turnoColor = 'var(--text-2)';
        const turnoIcon = p.turno === 'AM' ? '☀️' : (p.turno === 'PM' ? '🌙' : '⏰');
        const turnoBadgeHtml = p.turno
          ? `<span class="badge" style="background: var(--surface-3); color: ${turnoColor}; border: 1px solid var(--border-strong); font-size: 0.78rem; font-weight: 600; margin-left: 0.3rem;">${turnoIcon} ${p.turno}</span>`
          : '';

        item.innerHTML = `
          <div>
            <strong style="color: var(--text-main); font-size: 1rem;">${esc(p.nombre_completo)}</strong> 
            <span style="font-size: 0.8rem; color: var(--link);">(${esc(p.correo)} • Tel: ${esc(p.telefono || 'Sin tel')})</span><br>
            <span style="font-size: 0.82rem; color: var(--text-muted);">
              Plan: <strong style="color: var(--text-main);">${esc(p.plan)}</strong> ${abonoBadgeHtml} ${turnoBadgeHtml} | Fecha de Pago: <strong>${esc(p.fecha_pago)}</strong>
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <span class="badge" style="background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-border); font-size: 0.95rem; font-weight: 700; padding: 0.4rem 0.8rem;">
              +${esc(p.monto)} ${esc(p.moneda)}
            </span>
            <button type="button" class="btn-secondary" onclick="inspectPaymentDetail(${esc(p.id_pago)})" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">
              Ver detalle
            </button>
          </div>
        `;
        container.appendChild(item);
      });
    })
    .catch(err => console.error("Error al obtener pagos en rango:", err));
}

function updatePaymentsSummaryUI(totales) {
  const t = totales || { USD: "0.00", COP: "0.00", BS: "0.00", Bancolombia: "0.00", USDT: "0.00", CLP: "0.00" };
  if ($("#totalUsdSummary")) $("#totalUsdSummary").textContent = `$${t.USD || '0.00'} USD`;
  if ($("#totalCopSummary")) $("#totalCopSummary").textContent = `$${t.COP || '0.00'} COP`;
  if ($("#totalBsSummary")) $("#totalBsSummary").textContent = `$${t.BS || '0.00'} BS`;
  if ($("#totalBancolombiaSummary")) $("#totalBancolombiaSummary").textContent = `$${t.Bancolombia || '0.00'} COP`;
  if ($("#totalUsdtSummary")) $("#totalUsdtSummary").textContent = `${t.USDT || '0.00'} USDT`;
  if ($("#totalClpSummary")) $("#totalClpSummary").textContent = `$${t.CLP || '0.00'} CLP`;
}

function copyPaymentsSummaryToClipboard() {
  const mode = $("#paymentDateMode") ? $("#paymentDateMode").value : "dia";
  let periodoStr = "";

  if (mode === "rango") {
    const from = $("#historyDateFrom") ? $("#historyDateFrom").value : getLocalTodayStr();
    const to = $("#historyDateTo") ? $("#historyDateTo").value : getLocalTodayStr();
    periodoStr = `Del ${from} al ${to}`;
  } else {
    const singleDate = $("#historyDateFilter") ? $("#historyDateFilter").value : getLocalTodayStr();
    periodoStr = singleDate;
  }

  const count = currentPaymentsData ? currentPaymentsData.length : 0;

  // Sumar únicamente transacciones existentes
  const totalsMap = {};
  if (currentPaymentsData && currentPaymentsData.length > 0) {
    currentPaymentsData.forEach(p => {
      const moneda = p.moneda || 'USD';
      const monto = parseFloat(p.monto) || 0;
      totalsMap[moneda] = (totalsMap[moneda] || 0) + monto;
    });
  }

  const totalsLines = [];
  Object.keys(totalsMap).forEach(moneda => {
    const monto = totalsMap[moneda];
    if (monto > 0) {
      if (moneda === 'USDT') {
        totalsLines.push(`Total ${moneda}: ${monto.toFixed(2)} USDT`);
      } else {
        totalsLines.push(`Total ${moneda}: $${monto.toFixed(2)} ${moneda}`);
      }
    }
  });

  const totalsSection = totalsLines.length > 0
    ? totalsLines.join('\n')
    : "No hay ingresos registrados en este periodo.";

  const summaryText = `ATLAS GYM - RESUMEN CONTABLE DE CAJA\nPeriodo: ${periodoStr}\n----------------------------------------\n${totalsSection}\n----------------------------------------\nTotal Transacciones Registradas: ${count}`;

  navigator.clipboard.writeText(summaryText)
    .then(() => showToast("El resumen contable ha sido copiado al portapapeles.", "exito"))
    .catch(err => showToast("Error al copiar resumen contable: " + err, "error"));
}

function exportPaymentsToExcel() {
  if (!currentPaymentsData || currentPaymentsData.length === 0) {
    showToast("No hay registros de pagos en el historial actual para exportar.", "aviso");
    return;
  }

  // Encabezados simplificados en las 7 columnas
  const headers = [
    "Fecha",
    "Cliente",
    "Cedula",
    "Plan",
    "Monto",
    "Moneda",
    "Turno"
  ];

  const escapeCsv = (str) => {
    if (str === null || str === undefined) return '""';
    const val = String(str).replace(/"/g, '""');
    return `"${val}"`;
  };

  const rows = currentPaymentsData.map(p => [
    escapeCsv(p.fecha_pago || ''),
    escapeCsv(p.nombre_completo || 'Cliente'),
    escapeCsv(p.cedula || 'Sin cedula'),
    escapeCsv(p.plan || ''),
    escapeCsv(p.monto || '0.00'),
    escapeCsv(p.moneda || ''),
    escapeCsv(p.turno || 'N/A')
  ]);

  // Usar ';' como separador para que Microsoft Excel (en español) divida automáticamente en celdas/columnas
  let csvContent = '\uFEFF' + headers.join(';') + '\n';
  rows.forEach(rowArray => {
    csvContent += rowArray.join(';') + '\n';
  });

  const dateInput = $("#historyDateFilter");
  const dateFrom = $("#historyDateFrom");
  const dateTo = $("#historyDateTo");
  const dateMode = $("#paymentDateMode");

  let fileNameSuffix = getLocalTodayStr();
  if (dateMode && dateMode.value === 'rango' && dateFrom && dateFrom.value && dateTo && dateTo.value) {
    fileNameSuffix = `Rango_${dateFrom.value}_a_${dateTo.value}`;
  } else if (dateInput && dateInput.value) {
    fileNameSuffix = dateInput.value;
  }

  const filename = `Historial_Pagos_ATLAS_${fileNameSuffix}.csv`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  if (navigator.msSaveBlob) {
    navigator.msSaveBlob(blob, filename);
  } else {
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
}

/* ---------- GESTIÓN DE PLANTILLAS DE RUTINAS ---------- */
let adminTemplatesData = [];

function toggleAdminTemplatesSection() {
  irAVista("plantillas");
}

function loadAdminTemplates() {
  const grid = $("#adminTemplatesGrid");
  if (!grid) return;

  fetch(`${API_BASE}/plantillas`)
    .then(r => r.json())
    .then(res => {
      if (!res.ok) {
        grid.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Error al obtener plantillas de rutinas.</p>`;
        return;
      }

      adminTemplatesData = res.plantillas || [];
      grid.innerHTML = "";

      if (adminTemplatesData.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--surface); border-radius: 16px; border: 1px dashed var(--border-light);">
            <p style="font-size: 1.05rem; color: var(--text-muted); margin-bottom: 1rem;">No hay plantillas de rutinas creadas aún.</p>
            <button class="btn-primary" onclick="openCreateTemplateModal()" style="width: auto; margin: 0 auto;">
              + Crear Primera Plantilla
            </button>
          </div>
        `;
        return;
      }

      adminTemplatesData.forEach(p => {
        const card = document.createElement("div");
        card.className = "routine-card";

        const exList = p.ejercicios && p.ejercicios.length > 0
          ? p.ejercicios.map(e => `• ${esc(e.nombre_ejercicio)} (${esc(e.series)}s x ${esc(e.repeticiones)}r)`).join("<br>")
          : "Sin ejercicios";

        card.innerHTML = `
          <div>
            <span class="badge" style="background: var(--accent-bg); color: var(--accent-soft); border: 1px solid var(--border-strong); margin-bottom: 0.5rem;">Plantilla</span>
            <h3 class="routine-title">${esc(p.titulo)}</h3>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem;">${esc(p.descripcion || "Sin descripción")} | Horario: ${esc(p.horario || "Flexible")}</p>
            
            <div style="background: var(--surface-2); padding: 0.8rem; border-radius: 8px; font-size: 0.85rem; color: var(--text-main); margin-bottom: 1rem; line-height: 1.4;">
              ${exList}
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
            <button type="button" class="btn-secondary" onclick="editTemplateByAdmin(${esc(p.id_plantilla)})" style="font-size: 0.85rem; padding: 0.5rem 0.8rem; flex: 1;">
              Editar
            </button>
            <button type="button" class="btn-danger" onclick="deleteTemplateByAdmin(${esc(p.id_plantilla)})" style="font-size: 0.85rem; padding: 0.5rem 0.8rem; flex: 1;">
              Eliminar
            </button>
          </div>
        `;
        grid.appendChild(card);
      });
    })
    .catch(err => console.error("Error al obtener plantillas:", err));
}

let editingTemplateId = null;

function openCreateTemplateModal() {
  editingTemplateId = null;
  const modal = $("#createTemplateModal");
  if (modal) modal.classList.remove("hidden");

  const titleModal = $("#createTemplateModalTitle");
  if (titleModal) titleModal.textContent = "Nueva Plantilla de Rutina";

  const submitBtn = $("#createTemplateModalSubmitBtn");
  if (submitBtn) submitBtn.textContent = "Guardar Plantilla";

  const form = $("#createTemplateForm");
  if (form) form.reset();

  const container = $("#templateExercisesContainer");
  if (container) {
    container.innerHTML = "";
    addTemplateExerciseRow();
  }
}

function closeCreateTemplateModal() {
  const modal = $("#createTemplateModal");
  if (modal) modal.classList.add("hidden");
  editingTemplateId = null;
}

function addTemplateExerciseRow(nombre = "", series = 3, reps = 10, peso = 0) {
  const container = $("#templateExercisesContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "template-exercise-row template-exercise-card";
  card.style.cssText = "background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 12px; padding: 1rem; position: relative; margin-bottom: 0.8rem;";

  card.innerHTML = `
    <button type="button" onclick="this.closest('.template-exercise-card').remove()" title="Eliminar ejercicio" style="position: absolute; top: 0.8rem; right: 0.8rem; background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-border); border-radius: 8px; width: 28px; height: 28px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center;">X</button>

    <div style="margin-bottom: 0.8rem; padding-right: 2rem;">
      <label class="form-label" style="font-size: 0.8rem; color: var(--accent-soft); margin-bottom: 0.3rem; font-weight: 600;">Nombre del Ejercicio</label>
      <input type="text" class="form-input template-ex-name" placeholder="Ej: Sentadilla Libre" value="${esc(nombre)}" required style="padding: 0.5rem 0.8rem; font-size: 0.9rem;">
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.8rem;">
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Series</label>
        <input type="number" class="form-input template-ex-series" placeholder="3" value="${esc(series)}" min="1" required style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Reps</label>
        <input type="number" class="form-input template-ex-reps" placeholder="10" value="${esc(reps)}" min="1" required style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Peso Sugerido (kg)</label>
        <input type="number" step="0.5" class="form-input template-ex-peso" placeholder="0" value="${esc(peso)}" min="0" style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
    </div>
  `;
  container.appendChild(card);
}

function saveNewTemplate(event) {
  event.preventDefault();
  const titulo = $("#templateTitle").value.trim();
  const descripcion = $("#templateDesc").value.trim();
  const horario = $("#templateHorario").value.trim();

  const rows = document.querySelectorAll(".template-exercise-row");
  const ejercicios = [];

  rows.forEach(r => {
    const nombre = r.querySelector(".template-ex-name").value.trim();
    const series = parseInt(r.querySelector(".template-ex-series").value) || 3;
    const repeticiones = parseInt(r.querySelector(".template-ex-reps").value) || 10;
    const peso_kg = parseFloat(r.querySelector(".template-ex-peso").value) || 0;

    if (nombre) {
      ejercicios.push({ nombre_ejercicio: nombre, series, repeticiones, peso_kg });
    }
  });

  if (ejercicios.length === 0) {
    showToast("Debes agregar al menos un ejercicio a la plantilla.", "aviso");
    return;
  }

  const url = editingTemplateId ? `${API_BASE}/admin/plantillas/${editingTemplateId}` : `${API_BASE}/admin/plantillas`;
  const method = editingTemplateId ? "PUT" : "POST";

  fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titulo, descripcion, horario, ejercicios })
  })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.msg || "Error al procesar plantilla");
      return data;
    })
    .then(res => {
      const msg = editingTemplateId ? "¡Plantilla de rutina actualizada con éxito!" : "¡Plantilla de rutina creada con éxito!";
      showToast(msg, "exito");
      closeCreateTemplateModal();
      loadAdminTemplates();
    })
    .catch(err => showToast(err.message, "error"));
}

function editTemplateByAdmin(id_plantilla) {
  const plantilla = adminTemplatesData.find(p => p.id_plantilla === id_plantilla);
  if (!plantilla) {
    showToast("No se encontró la información de la plantilla.", "aviso");
    return;
  }

  editingTemplateId = id_plantilla;
  const modal = $("#createTemplateModal");
  if (modal) modal.classList.remove("hidden");

  const titleModal = $("#createTemplateModalTitle");
  if (titleModal) titleModal.textContent = "Editar Plantilla de Rutina";

  const submitBtn = $("#createTemplateModalSubmitBtn");
  if (submitBtn) submitBtn.textContent = "Actualizar Plantilla";

  $("#templateTitle").value = plantilla.titulo || "";
  $("#templateDesc").value = plantilla.descripcion || "";
  $("#templateHorario").value = plantilla.horario || "";

  const container = $("#templateExercisesContainer");
  if (container) {
    container.innerHTML = "";
    if (plantilla.ejercicios && plantilla.ejercicios.length > 0) {
      plantilla.ejercicios.forEach(ej => addTemplateExerciseRow(ej.nombre_ejercicio, ej.series, ej.repeticiones, ej.peso_kg));
    } else {
      addTemplateExerciseRow();
    }
  }
}

function deleteTemplateByAdmin(id_plantilla) {
  if (!confirm("¿Estás seguro de eliminar esta plantilla de rutina?")) return;

  fetch(`${API_BASE}/admin/plantillas/${id_plantilla}`, { method: "DELETE" })
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        showToast("Plantilla eliminada.", "exito");
        loadAdminTemplates();
      } else {
        showToast(res.msg || "Error al eliminar plantilla", "error");
      }
    })
    .catch(err => console.error(err));
}

// Cargar plantillas en el selector de la rutina del cliente
function populateRoutineTemplatesDropdown(selectedId = null) {
  const select = $("#routineTemplateSelect");
  if (!select) return;

  const currentVal = selectedId || select.value;

  select.innerHTML = `<option value="">-- Diseñar rutina manualmente (Sin plantilla) --</option>`;

  fetch(`${API_BASE}/plantillas`)
    .then(r => r.json())
    .then(res => {
      if (res.ok && res.plantillas && res.plantillas.length > 0) {
        res.plantillas.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id_plantilla;
          opt.textContent = `${p.titulo} (${p.horario || 'Horario flexible'})`;
          select.appendChild(opt);
        });
        if (currentVal) {
          select.value = currentVal;
        }
      }
    })
    .catch(err => console.error("Error al cargar plantillas en dropdown:", err));
}

function loadTemplateIntoRoutineForm(overrideId = null) {
  const select = $("#routineTemplateSelect");
  const plantillaId = overrideId || (select && select.value ? parseInt(select.value) : null);

  if (select && overrideId) {
    select.value = overrideId;
  }

  const container = $("#exerciseInputsContainer");

  if (!plantillaId) {
    if (container && container.children.length === 0) {
      addExerciseRow();
    }
    return;
  }

  fetch(`${API_BASE}/plantillas`)
    .then(r => r.json())
    .then(res => {
      if (!res.ok || !res.plantillas) return;
      const plantilla = res.plantillas.find(p => p.id_plantilla === parseInt(plantillaId));
      if (!plantilla) return;

      const titleInput = $("#routineTitle");
      const descInput = $("#routineDesc");
      const horarioInput = $("#routineHorario");

      if (titleInput) titleInput.value = plantilla.titulo || "";
      if (descInput) descInput.value = plantilla.descripcion || "";
      if (horarioInput) horarioInput.value = plantilla.horario || "";

      if (container) {
        container.innerHTML = "";
        if (plantilla.ejercicios && plantilla.ejercicios.length > 0) {
          plantilla.ejercicios.forEach(ej => {
            addExerciseRow(ej.nombre_ejercicio, ej.series, ej.repeticiones, ej.peso_kg);
          });
        } else {
          addExerciseRow();
        }
      }
    })
    .catch(err => console.error(err));
}

/* ---------- VENTANA VISUAL DE SELECCIÓN DE PLANTILLAS EN TARJETAS PARA ATLETAS ---------- */
function openTemplateSelectorModal() {
  const modal = $("#templateSelectorModal");
  const grid = $("#visualTemplateCardsGrid");
  if (!modal || !grid) return;

  grid.innerHTML = `<div style="color: var(--text-muted); grid-column: 1 / -1; text-align: center; padding: 2rem;">Cargando plantillas predefinidas...</div>`;
  modal.classList.remove("hidden");

  fetch(`${API_BASE}/plantillas`)
    .then(r => r.json())
    .then(res => {
      if (!res.ok || !res.plantillas || res.plantillas.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; background: var(--surface); border-radius: 12px; border: 1px dashed var(--border-light);">
            <p style="color: var(--text-muted); font-size: 0.95rem;">No hay plantillas predefinidas disponibles en este momento.</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = "";

      res.plantillas.forEach(p => {
        const card = document.createElement("div");
        card.className = "routine-card";
        card.style.cssText = "display: flex; flex-direction: column; justify-content: space-between; height: 100%; border-color: var(--border-strong);";

        const exList = p.ejercicios && p.ejercicios.length > 0
          ? p.ejercicios.map(e => `• ${esc(e.nombre_ejercicio)} (${esc(e.series)} series × ${esc(e.repeticiones)} reps)`).join("<br>")
          : "Sin ejercicios";

        card.innerHTML = `
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
              <h3 class="routine-title" style="">${esc(p.titulo)}</h3>
              <span class="badge" style="background: var(--accent-bg); color: var(--accent-soft); border: 1px solid var(--border-strong);">${esc(p.horario || "Flexible")}</span>
            </div>
            
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">${esc(p.descripcion || "Sin descripción")}</p>

            <div style="background: var(--surface-2); padding: 0.8rem; border-radius: 8px; font-size: 0.85rem; color: var(--text-main); margin-bottom: 1.2rem; line-height: 1.4;">
              ${exList}
            </div>
          </div>

          <div>
            <button type="button" class="btn-primary" onclick="selectTemplateForRoutine(${esc(p.id_plantilla)})" style="width: 100%;">
              Cargar Esta Rutina
            </button>
          </div>
        `;
        grid.appendChild(card);
      });
    })
    .catch(err => console.error("Error al cargar plantillas visuales:", err));
}

function closeTemplateSelectorModal() {
  const modal = $("#templateSelectorModal");
  if (modal) modal.classList.add("hidden");
}

function selectTemplateForRoutine(id_plantilla) {
  closeTemplateSelectorModal();

  const routineModal = $("#routineModal");
  if (!routineModal || routineModal.classList.contains("hidden")) {
    openNewRoutineModal();
  }

  const select = $("#routineTemplateSelect");
  if (select) {
    select.value = id_plantilla;
  }

  loadTemplateIntoRoutineForm(id_plantilla);
}

/* ---------- MATERIAL Y CONTENIDO ADICIONAL 📚 ---------- */

let adminResourcesData = [];
let userResourcesData = [];

function toggleAdminResourcesSection() {
  irAVista("material");
}

function getCategoryBadge(cat) {
  // Las categorías no son estados: todas con la insignia neutra
  const nombres = { 'Nutrición': 'Nutrición', 'Entrenamiento': 'Guía', 'Suplementación': 'Suplementos', 'Reglamento': 'Reglamento' };
  return `<span class="badge badge-neutral">${esc(nombres[cat] || 'Consejos')}</span>`;
}

function dataURItoBlob(dataURI) {
  try {
    const parts = dataURI.split(',');
    const byteString = atob(parts[1]);
    const mimeString = parts[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  } catch (e) {
    return null;
  }
}

function getResourceUrl(url) {
  if (!url) return '';
  const cleanUrl = String(url).trim();
  // Solo se permiten enlaces web, imágenes/PDF incrustados y rutas del propio sitio
  if (!/^(https?:|data:image\/|data:application\/pdf|blob:|\/)/i.test(cleanUrl) && /^[a-z][a-z0-9+.-]*:/i.test(cleanUrl)) return '#';
  if (cleanUrl.startsWith('data:')) {
    if (cleanUrl.startsWith('data:application/pdf')) {
      const blob = dataURItoBlob(cleanUrl);
      if (blob) {
        return URL.createObjectURL(blob);
      }
    }
    return cleanUrl;
  }
  let pathUrl = cleanUrl.replace(/\\/g, '/');
  if (pathUrl.startsWith('uploads/')) {
    pathUrl = '/' + pathUrl;
  }
  if (pathUrl.startsWith('/uploads/') || pathUrl.startsWith('/')) {
    const backendBase = API_BASE.replace(/\/api\/?$/, '');
    return `${backendBase}${pathUrl}`;
  }
  if (!pathUrl.startsWith('http://') && !pathUrl.startsWith('https://')) {
    return `https://${pathUrl}`;
  }
  return pathUrl;
}

function openResourcePreviewById(id) {
  const resource = (typeof adminResourcesData !== 'undefined' ? adminResourcesData : []).find(r => r.id_recurso == id) ||
    (typeof userResourcesData !== 'undefined' ? userResourcesData : []).find(r => r.id_recurso == id);
  if (!resource) return;
  openImagePreviewModal(resource.url_recurso, resource.titulo);
}

function openImagePreviewModal(url, title) {
  let modal = $("#previewResourceModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "previewResourceModal";
    modal.className = "modal-overlay hidden";
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 850px; text-align: center; background: var(--surface); border: 1px solid var(--border-light); border-radius: 16px; padding: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 id="previewResourceTitle" style="font-size: 1.25rem; font-weight: 700; margin: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></h3>
          <button type="button" onclick="closeImagePreviewModal()" style="background: none; border: none; color: var(--text-muted); font-size: 1.8rem; cursor: pointer; line-height: 1; padding: 0 0.4rem;">&times;</button>
        </div>
        <div style="background: var(--surface-2); border-radius: 12px; padding: 0.5rem; display: flex; justify-content: center; align-items: center; min-height: 280px; max-height: 70vh; overflow: auto; margin-bottom: 1.2rem; border: 1px solid var(--border);">
          <img id="previewResourceImg" src="" alt="Vista previa" style="max-width: 100%; max-height: 65vh; object-fit: contain; border-radius: 8px;" />
          <iframe id="previewResourceIframe" src="" style="width: 100%; height: 65vh; border: none; border-radius: 8px;" class="hidden"></iframe>
        </div>
        <div style="display: flex; gap: 0.8rem; justify-content: flex-end; flex-wrap: wrap;">
          <button type="button" id="previewResourceFullBtn" class="btn-primary" style="padding: 0.55rem 1.2rem; font-size: 0.88rem; border: none; display: inline-flex; align-items: center; gap: 0.4rem;"> Ampliar en Pestaña</button>
          <button type="button" class="btn-secondary" onclick="closeImagePreviewModal()" style="padding: 0.55rem 1.2rem; font-size: 0.88rem;">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeImagePreviewModal();
    });
  }

  const hrefUrl = getResourceUrl(url);
  const strUrl = String(url || '').toLowerCase();
  const isPdf = strUrl.includes('application/pdf') || strUrl.endsWith('.pdf');

  const img = $("#previewResourceImg");
  const iframe = $("#previewResourceIframe");

  if (isPdf && iframe) {
    if (img) img.classList.add("hidden");
    iframe.classList.remove("hidden");
    iframe.src = hrefUrl;
  } else if (img) {
    if (iframe) iframe.classList.add("hidden");
    img.classList.remove("hidden");
    img.src = hrefUrl;
  }

  const titleEl = $("#previewResourceTitle");
  if (titleEl) titleEl.textContent = title || "Vista Previa del Contenido";

  const fullBtn = $("#previewResourceFullBtn");
  if (fullBtn) {
    fullBtn.onclick = function () {
      if (hrefUrl.startsWith('data:image/')) {
        const win = window.open();
        if (win) {
          win.document.write(`<html><head><title>${esc(title || 'Vista Previa')}</title></head><body style="margin:0;background:#0A0F1C;display:flex;justify-content:center;align-items:center;min-height:100vh;"><img src="${esc(hrefUrl)}" style="max-width:100%;max-height:100vh;object-fit:contain;"/></body></html>`);
        }
      } else {
        window.open(hrefUrl, '_blank');
      }
    };
  }

  modal.classList.remove("hidden");
}

function closeImagePreviewModal() {
  const modal = $("#previewResourceModal");
  if (modal) modal.classList.add("hidden");
}

function getResourceIcon(tipo, url) {
  if (!url) return 'Recurso';
  const strUrl = String(url).toLowerCase();
  if (strUrl.startsWith('data:image/')) return 'Imagen';
  if (strUrl.startsWith('data:application/pdf')) return 'Documento PDF';
  if (tipo === 'archivo') {
    if (strUrl.endsWith('.pdf')) return 'Documento PDF';
    if (strUrl.match(/\.(png|jpg|jpeg|webp|gif|svg)$/)) return 'Imagen';
    if (strUrl.match(/\.(doc|docx)$/)) return 'Documento Word';
    return 'Archivo Adjunto';
  }
  if (strUrl.includes('youtube.com') || strUrl.includes('youtu.be')) return 'Video YouTube';
  return 'Enlace Web';
}

function loadAdminResources() {
  const grid = $("#adminResourcesGrid");
  if (!grid) return;

  fetch(`${API_BASE}/recursos`)
    .then(r => r.json())
    .then(data => {
      adminResourcesData = data.recursos || [];
      filterAdminResourcesByCategory();
    })
    .catch(err => {
      console.error("Error cargando materiales de apoyo admin:", err);
      grid.innerHTML = `<div style="grid-column: 1 / -1; color: var(--danger); text-align: center;">Error al cargar contenidos.</div>`;
    });
}

function filterAdminResourcesByCategory() {
  const grid = $("#adminResourcesGrid");
  if (!grid) return;

  const select = $("#adminResourceCategoryFilter");
  const catFilter = select ? select.value : 'todas';

  let list = [...adminResourcesData];
  if (catFilter !== 'todas') {
    list = list.filter(r => r.categoria === catFilter);
  }

  grid.innerHTML = "";
  if (list.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--surface); border-radius: 16px; border: 1px dashed var(--border-light);">
        <p style="font-size: 1.1rem; color: var(--text-muted); margin-bottom: 1rem;">No hay material registrado en esta categoría aún.</p>
        <button class="btn-primary" onclick="openCreateResourceModal()" style="width: auto; margin: 0 auto; border: none;">
          + Subir Primer Material
        </button>
      </div>
    `;
    return;
  }

  list.forEach(r => {
    const card = document.createElement("div");
    card.className = "routine-card";
    card.style.cssText = "padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between;";

    const catBadge = getCategoryBadge(r.categoria);
    const iconTag = getResourceIcon(r.tipo_recurso, r.url_recurso);
    const hrefUrl = getResourceUrl(r.url_recurso);
    const isDataImg = r.url_recurso && String(r.url_recurso).startsWith('data:image/');
    const isDataPdf = r.url_recurso && String(r.url_recurso).startsWith('data:application/pdf');
    const isImage = isDataImg || (r.url_recurso && String(r.url_recurso).match(/\.(png|jpg|jpeg|webp|gif|svg)$/i));
    const isPdf = isDataPdf || (r.url_recurso && String(r.url_recurso).toLowerCase().endsWith('.pdf'));

    const thumbnailHtml = isImage ? `
      <div style="margin-bottom: 0.8rem; border-radius: 8px; overflow: hidden; background: var(--surface-2); height: 160px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); cursor: pointer;" onclick="openResourcePreviewById(${esc(r.id_recurso)})" title="Haz clic para ampliar">
        <img src="${esc(hrefUrl)}" style="width: 100%; height: 100%; object-fit: cover;" alt="${esc(r.titulo)}">
      </div>
    ` : (isPdf ? `
      <div style="margin-bottom: 0.8rem; border-radius: 8px; overflow: hidden; background: var(--surface-2); height: 110px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--border-strong); cursor: pointer;" onclick="openResourcePreviewById(${esc(r.id_recurso)})" title="Haz clic para ver PDF">
        <span style="font-size: 2.2rem; margin-bottom: 0.2rem;">📄</span>
        <span style="font-size: 0.82rem; color: var(--link); font-weight: 600;">Documento PDF (Ver en visor)</span>
      </div>
    ` : '');

    const actionBtn = (isImage || isPdf) ? `
      <button type="button" class="btn-primary" onclick="openResourcePreviewById(${esc(r.id_recurso)})" style="flex: 1; text-align: center; font-size: 0.85rem; padding: 0.55rem 0.8rem; border: none;">
        ${esc(isImage ? 'Ver Imagen' : 'Ver PDF')}
      </button>
    ` : `
      <a href="${esc(hrefUrl)}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="flex: 1; text-align: center; text-decoration: none; font-size: 0.85rem; padding: 0.55rem 0.8rem; border: none; display: inline-flex; align-items: center; justify-content: center;">
        Abrir Enlace 🔗
      </a>
    `;

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem; gap: 0.5rem;">
          <h3 class="routine-title" style="margin: 0; font-size: 1.15rem; color: var(--text-main); font-weight: 700;">${esc(r.titulo)}</h3>
          ${catBadge}
        </div>
        
        ${thumbnailHtml}

        <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 0.8rem; line-height: 1.4;">${esc(r.descripcion || "Sin descripción adicional.")}</p>

        <div style="background: var(--surface-2); padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.82rem; color: var(--link); margin-bottom: 1rem; border: 1px solid var(--border);">
          ${iconTag}: <strong style="color: var(--text-main);">${esc(r.nombre_archivo_orig || (isDataImg ? 'Imagen Base64' : r.url_recurso))}</strong>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        ${actionBtn}
        <button class="btn-danger" onclick="deleteResourceByAdmin(${esc(r.id_recurso)})" title="Eliminar material" style="padding: 0.55rem 0.8rem; font-size: 0.85rem;">
          Eliminar
        </button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openCreateResourceModal() {
  const modal = $("#createResourceModal");
  if (modal) modal.classList.remove("hidden");
  const form = $("#createResourceForm");
  if (form) form.reset();
  toggleResourceTypeInput();
}

function closeCreateResourceModal() {
  const modal = $("#createResourceModal");
  if (modal) modal.classList.add("hidden");
}

function toggleResourceTypeInput() {
  const selectedType = document.querySelector('input[name="resourceType"]:checked');
  const typeVal = selectedType ? selectedType.value : 'archivo';

  const fileContainer = $("#resourceFileInputContainer");
  const linkContainer = $("#resourceLinkInputContainer");

  if (typeVal === 'archivo') {
    if (fileContainer) fileContainer.classList.remove("hidden");
    if (linkContainer) linkContainer.classList.add("hidden");
  } else {
    if (fileContainer) fileContainer.classList.add("hidden");
    if (linkContainer) linkContainer.classList.remove("hidden");
  }
}

function compressImageFile(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return resolve(file);
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob || blob.size >= file.size) {
            return resolve(file);
          }
          const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
            type: "image/webp",
            lastModified: Date.now()
          });
          resolve(compressedFile);
        }, 'image/webp', quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

async function saveResource(e) {
  e.preventDefault();

  const titleInput = $("#resourceTitle");
  const catInput = $("#resourceCategory");
  const descInput = $("#resourceDesc");

  const selectedType = document.querySelector('input[name="resourceType"]:checked');
  const typeVal = selectedType ? selectedType.value : 'archivo';

  const fileInput = $("#resourceFile");
  const linkInput = $("#resourceLink");

  const submitBtn = $("#createResourceModalSubmitBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Procesando...";
  }

  try {
    const formData = new FormData();
    formData.append('titulo', titleInput.value.trim());
    formData.append('categoria', catInput.value);
    formData.append('descripcion', descInput.value.trim());
    formData.append('tipo_recurso', typeVal);

    if (typeVal === 'archivo') {
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showToast("Por favor selecciona un archivo (PDF, Imagen, etc.).", "aviso");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Guardar Material"; }
        return;
      }
      const rawFile = fileInput.files[0];
      const fileToUpload = await compressImageFile(rawFile);
      formData.append('archivo', fileToUpload);
    } else {
      if (!linkInput || !linkInput.value.trim()) {
        showToast("Por favor ingresa la URL del enlace o video.", "aviso");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Guardar Material"; }
        return;
      }
      formData.append('url_enlace', linkInput.value.trim());
    }

    if (submitBtn) {
      submitBtn.textContent = "Guardando...";
    }

    const response = await fetch(`${API_BASE}/admin/recursos`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      let msg = `Error ${response.status}: ${response.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.msg) msg = errJson.msg;
      } catch (e) { }
      throw new Error(msg);
    }

    const res = await response.json();
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Guardar Material";
    }

    if (res.ok) {
      closeCreateResourceModal();
      loadAdminResources();
    } else {
      showToast(res.msg || "Error al guardar el material de apoyo.", "error");
    }
  } catch (err) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Guardar Material";
    }
    console.error("Error guardando recurso:", err);
    showToast(err.message || "Error al conectar con el servidor. Por favor reintenta.", "error");
  }
}

function deleteResourceByAdmin(id) {
  if (!confirm("¿Estás seguro de eliminar este material de apoyo?")) return;

  fetch(`${API_BASE}/admin/recursos/${id}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        loadAdminResources();
      } else {
        showToast(res.msg || "Error al eliminar el material.", "error");
      }
    })
    .catch(err => console.error("Error eliminando recurso:", err));
}

// Plegar / Desplegar sección de rutinas en Dashboard del Cliente
function toggleUserRoutinesSection() {
  const body = $("#userRoutinesBody");
  const btnText = $("#userRoutinesToggleBtnText");
  const chevron = $("#userRoutinesChevron");

  if (!body) return;

  if (body.classList.contains("hidden")) {
    body.classList.remove("hidden");
    if (btnText) btnText.textContent = "Ocultar Rutinas";
    if (chevron) chevron.textContent = "▲";
  } else {
    body.classList.add("hidden");
    if (btnText) btnText.textContent = "Ver Rutinas";
    if (chevron) chevron.textContent = "▼";
  }
}

// Plegar / Desplegar sección de recursos en Dashboard del Cliente
function toggleUserResourcesSection() {
  const body = $("#userResourcesBody");
  const btnText = $("#userResourcesToggleBtnText");
  const chevron = $("#userResourcesChevron");

  if (!body) return;

  if (body.classList.contains("hidden")) {
    body.classList.remove("hidden");
    if (btnText) btnText.textContent = "Ocultar Contenido";
    if (chevron) chevron.textContent = "▲";
    if (userResourcesData.length === 0) {
      loadUserDashboardResources();
    }
  } else {
    body.classList.add("hidden");
    if (btnText) btnText.textContent = "Ver Contenido";
    if (chevron) chevron.textContent = "▼";
  }
}

// Carga en el Dashboard del Cliente (Atleta)
function loadUserDashboardResources() {
  const grid = $("#userResourcesGrid");
  if (!grid) return;

  fetch(`${API_BASE}/recursos`)
    .then(r => r.json())
    .then(data => {
      userResourcesData = data.recursos || [];
      filterUserResourcesByCategory();
    })
    .catch(err => {
      console.error("Error cargando recursos cliente:", err);
      grid.innerHTML = `<div style="grid-column: 1 / -1; color: var(--text-muted); text-align: center; padding: 2rem;">No se pudo cargar el contenido adicional.</div>`;
    });
}

function filterUserResourcesByCategory() {
  const grid = $("#userResourcesGrid");
  if (!grid) return;

  const select = $("#userResourceCategorySelect");
  const catFilter = select ? select.value : 'todas';

  let list = [...userResourcesData];
  if (catFilter !== 'todas') {
    list = list.filter(r => r.categoria === catFilter);
  }

  grid.innerHTML = "";
  if (list.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; background: var(--surface); border-radius: 12px; border: 1px dashed var(--border-light);">
        <p style="font-size: 1rem; color: var(--text-muted); margin: 0;">No hay contenido adicional disponible en esta categoría por ahora.</p>
      </div>
    `;
    return;
  }

  list.forEach(r => {
    const card = document.createElement("div");
    card.className = "routine-card";
    card.style.cssText = "padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between;";

    const catBadge = getCategoryBadge(r.categoria);
    const iconTag = getResourceIcon(r.tipo_recurso, r.url_recurso);
    const hrefUrl = getResourceUrl(r.url_recurso);
    const isDataImg = r.url_recurso && String(r.url_recurso).startsWith('data:image/');
    const isDataPdf = r.url_recurso && String(r.url_recurso).startsWith('data:application/pdf');
    const isImage = isDataImg || (r.url_recurso && String(r.url_recurso).match(/\.(png|jpg|jpeg|webp|gif|svg)$/i));
    const isPdf = isDataPdf || (r.url_recurso && String(r.url_recurso).toLowerCase().endsWith('.pdf'));

    const thumbnailHtml = isImage ? `
      <div style="margin-bottom: 0.8rem; border-radius: 8px; overflow: hidden; background: var(--surface-2); height: 160px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); cursor: pointer;" onclick="openResourcePreviewById(${esc(r.id_recurso)})" title="Haz clic para ampliar">
        <img src="${esc(hrefUrl)}" style="width: 100%; height: 100%; object-fit: cover;" alt="${esc(r.titulo)}">
      </div>
    ` : (isPdf ? `
      <div style="margin-bottom: 0.8rem; border-radius: 8px; overflow: hidden; background: var(--surface-2); height: 110px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--border-strong); cursor: pointer;" onclick="openResourcePreviewById(${esc(r.id_recurso)})" title="Haz clic para ver PDF">
        <span style="font-size: 2.2rem; margin-bottom: 0.2rem;">📄</span>
        <span style="font-size: 0.82rem; color: var(--link); font-weight: 600;">Documento PDF (Ver en visor)</span>
      </div>
    ` : '');

    const userActionBtn = (isImage || isPdf) ? `
      <button type="button" class="btn-primary" onclick="openResourcePreviewById(${esc(r.id_recurso)})" style="display: block; width: 100%; text-align: center; font-size: 0.88rem; padding: 0.6rem 1rem; border: none;">
        ${esc(isImage ? 'Ver Imagen' : 'Ver PDF')}
      </button>
    ` : `
      <a href="${esc(hrefUrl)}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="display: block; width: 100%; text-align: center; text-decoration: none; font-size: 0.88rem; padding: 0.6rem 1rem; border: none;">
        Abrir Enlace 🔗
      </a>
    `;

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem; gap: 0.5rem;">
          <h3 class="routine-title" style="margin: 0; font-size: 1.15rem; color: var(--text-main); font-weight: 700;">${esc(r.titulo)}</h3>
          ${catBadge}
        </div>
        
        ${thumbnailHtml}

        <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 0.8rem; line-height: 1.4;">${esc(r.descripcion || "Sin descripción adicional.")}</p>

        <div style="background: var(--surface-2); padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.82rem; color: var(--link); margin-bottom: 1.2rem; border: 1px solid var(--border);">
          ${iconTag}: <strong style="color: var(--text-main);">${esc(r.nombre_archivo_orig || (isDataImg ? 'Imagen Base64' : 'Ver Recurso'))}</strong>
        </div>
      </div>

      <div>
        ${userActionBtn}
      </div>
    `;
    grid.appendChild(card);
  });
}

/* =====================================================================
   CONTROL DE ENTRADA (ASISTENCIA) Y VENCIMIENTOS
   ===================================================================== */

// Agrupa los planes: Mensualidad y Estudiante cuentan como mensuales
function planCategoria(plan) {
  if (!plan) return "sin";
  const p = String(plan).toLowerCase();
  if (p.includes("mensual") || p.includes("estudiante")) return "mensual";
  if (p.includes("semana")) return "semanal";
  if (p.includes("diario")) return "diario";
  return "otro";
}

// Días desde hoy hasta la fecha (negativo = ya pasó)
function diasHasta(fechaStr) {
  if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return null;
  const [y, m, d] = fechaStr.split("-").map(Number);
  const [ty, tm, td] = getLocalTodayStr().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

function textoDias(dias) {
  if (dias === null) return "sin fecha";
  if (dias === 0) return "vence hoy";
  if (dias === 1) return "vence mañana";
  if (dias > 1) return `faltan ${dias} días`;
  if (dias === -1) return "venció ayer";
  return `venció hace ${-dias} días`;
}

function formatFechaCorta(fechaStr) {
  if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return "-";
  const [y, m, d] = fechaStr.split("-");
  return `${d}/${m}/${y}`;
}

// Estado de membresía de un cliente para la entrada
function estadoEntrada(u) {
  const vence = u.membresia && u.membresia.vence;
  const activa = u.membresia && u.membresia.estado === "activa";
  const dias = diasHasta(vence);
  if (dias === null) {
    return { codigo: "sin", dias, color: "var(--danger)", titulo: "Sin membresía registrada" };
  }
  if (!activa || dias < 0) return { codigo: "vencida", dias, color: "var(--danger)", titulo: "Membresía vencida" };
  if (dias <= 3) return { codigo: "por_vencer", dias, color: "var(--warn)", titulo: "Membresía por vencer" };
  return { codigo: "activa", dias, color: "var(--ok)", titulo: "Membresía activa" };
}

/* ---------- Control de Entrada ---------- */
let checkinMatches = [];
let checkinSelectedId = null;

function toggleCheckinSection(forceOpen) {
  irAVista("entrada");
}

function buscarClientesEntrada(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const soloDigitos = q.replace(/\D/g, "");
  const esNumero = soloDigitos.length >= 3 && soloDigitos.length === q.replace(/[\s.\-vVeE]/g, "").length;
  return adminUsersData.filter(u => {
    if (esNumero) {
      const ced = String(u.cedula || "").replace(/\D/g, "");
      const tel = String(u.telefono || "").replace(/\D/g, "");
      return ced.startsWith(soloDigitos) || (soloDigitos.length >= 6 && tel.includes(soloDigitos));
    }
    return (u.nombre_completo || "").toLowerCase().includes(q);
  }).slice(0, 8);
}

function onCheckinInput() {
  const input = $("#checkinSearch");
  const box = $("#checkinResults");
  if (!input || !box) return;
  checkinMatches = buscarClientesEntrada(input.value);
  if (!input.value.trim()) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  if (checkinMatches.length === 0) {
    box.innerHTML = `<div class="search-empty">No se encontró ningún cliente.</div>`;
  } else {
    box.innerHTML = checkinMatches.map(u => {
      const st = estadoEntrada(u);
      return `<button type="button" class="search-item" onclick="seleccionarClienteEntrada(${Number(u.id_usuario)})">
        <span class="search-item-main"><strong>${esc(u.nombre_completo)}</strong><small>${esc(u.cedula ? "C.I. " + u.cedula : "Sin cédula")}</small></span>
        <span class="${claseEstadoEntrada(st.codigo)}">${esc(st.titulo.replace("Membresía ", ""))}</span>
      </button>`;
    }).join("");
  }
  box.classList.remove("hidden");
}

function onCheckinKeydown(event) {
  if (event.key === "Escape") { limpiarBusquedaEntrada(); return; }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const input = $("#checkinSearch");
  const q = input ? input.value.trim() : "";
  if (!q) return;
  const matches = buscarClientesEntrada(q);
  const digitos = q.replace(/\D/g, "");
  const exacto = digitos ? matches.find(u => String(u.cedula || "").replace(/\D/g, "") === digitos) : null;
  if (exacto) return seleccionarClienteEntrada(exacto.id_usuario);
  if (matches.length === 1) return seleccionarClienteEntrada(matches[0].id_usuario);
  if (matches.length === 0) {
    mostrarPanelEntrada(`<div style="padding: 1rem; border-radius: 12px; background: var(--danger-bg); border: 1px solid var(--danger-border); text-align: center;">
      <strong style="color: var(--danger);">No hay ningún cliente con “${esc(q)}”.</strong>
      <div style="margin-top: 0.6rem;"><button type="button" class="btn-secondary" onclick="openCreateUserModal()" style="font-size: 0.85rem;">+ Registrar nuevo cliente</button></div>
    </div>`);
  }
  // Varias coincidencias: la lista queda abierta para elegir
}

function limpiarBusquedaEntrada() {
  const input = $("#checkinSearch");
  const box = $("#checkinResults");
  if (input) { input.value = ""; input.focus(); }
  if (box) { box.innerHTML = ""; box.classList.add("hidden"); }
  checkinMatches = [];
}

function mostrarPanelEntrada(html) {
  const panel = $("#checkinStatus");
  if (panel) panel.innerHTML = html;
}

function seleccionarClienteEntrada(idUsuario) {
  const u = adminUsersData.find(x => String(x.id_usuario) === String(idUsuario));
  if (!u) return;
  checkinSelectedId = u.id_usuario;
  limpiarBusquedaEntrada();
  const st = estadoEntrada(u);
  const deuda = u.tiene_deuda == 1;
  // Camino rápido: al día y sin deuda -> se registra directo
  if ((st.codigo === "activa" || st.codigo === "por_vencer") && !deuda) {
    registrarEntrada(u.id_usuario, false);
    return;
  }
  mostrarPanelEntrada(panelClienteHtml(u, st, `
    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.9rem;">
      <button type="button" class="btn-primary" onclick="openRegisterPaymentModal(${esc(u.id_usuario)})" style="flex: 1 1 180px;">💳 Registrar pago</button>
      <button type="button" class="btn-secondary" onclick="registrarEntrada(${esc(u.id_usuario)}, false)" style="flex: 1 1 180px;">Dejar pasar de todas formas</button>
      <button type="button" class="btn-secondary" onclick="sendWhatsAppReminderById(${esc(u.id_usuario)})" style="flex: 1 1 120px; border-color: var(--ok-border); color: var(--ok);">WhatsApp</button>
    </div>`));
}

function panelClienteHtml(u, st, extraHtml, encabezado) {
  const deuda = u.tiene_deuda == 1;
  const vence = u.membresia && u.membresia.vence;
  const bg = st.codigo === "activa" ? "var(--ok-bg)" : st.codigo === "por_vencer" ? "var(--warn-bg)" : "var(--danger-bg)";
  return `<div style="padding: 1.1rem 1.25rem; border-radius: 14px; background: ${bg}; border: 2px solid ${st.color};">
    <div style="font-size: 0.85rem; font-weight: 700; color: ${st.color}; text-transform: uppercase; letter-spacing: 0.04em;">${esc(encabezado || st.titulo)}</div>
    <div style="font-size: 1.45rem; font-weight: 700; color: var(--text-main); margin-top: 0.2rem;">${esc(u.nombre_completo)}</div>
    <div style="color: var(--text-muted); font-size: 0.92rem; margin-top: 0.3rem;">
      ${esc(u.ultimo_plan || "Sin plan")} · Vence ${esc(formatFechaCorta(vence))} · <strong style="color: ${st.color};">${esc(textoDias(st.dias))}</strong>
    </div>
    ${deuda ? `<div style="margin-top: 0.5rem; color: var(--danger); font-weight: 700;">⚠️ Tiene un abono pendiente (deuda)</div>` : ""}
    ${extraHtml || ""}
  </div>`;
}

function horaLocalStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
}

function registrarEntrada(idUsuario, forzar) {
  const u = adminUsersData.find(x => String(x.id_usuario) === String(idUsuario));
  if (!u) return;
  fetch(`${API_BASE}/admin/asistencias`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_usuario: u.id_usuario, fecha: getLocalTodayStr(), hora: horaLocalStr(), forzar: !!forzar })
  })
    .then(r => r.json())
    .then(res => {
      const st = estadoEntrada(u);
      if (!res.ok) {
        mostrarPanelEntrada(`<div style="padding: 1rem; border-radius: 12px; background: var(--danger-bg); border: 1px solid var(--danger-border); color: var(--danger);">${esc(res.msg || "No se pudo registrar la entrada.")}</div>`);
        return;
      }
      if (res.ya_registrado) {
        mostrarPanelEntrada(panelClienteHtml(u, st, `
          <div style="margin-top: 0.7rem; color: var(--text-main);">Ya registró su entrada hoy a las <strong>${esc(res.hora_anterior)}</strong>.</div>
          <div style="display: flex; gap: 0.5rem; margin-top: 0.7rem; flex-wrap: wrap;">
            <button type="button" class="btn-secondary" onclick="registrarEntrada(${esc(u.id_usuario)}, true)">Registrar otra entrada</button>
            <button type="button" class="btn-secondary" onclick="mostrarPanelEntrada('')">Listo</button>
          </div>`, "Entrada ya registrada"));
        return;
      }
      const aviso = st.codigo === "por_vencer"
        ? `<div style="margin-top: 0.6rem; color: var(--warn); font-weight: 600;">🔔 Recuérdale que su plan ${esc(textoDias(st.dias))}.</div>`
        : (st.codigo !== "activa" ? `<div style="margin-top: 0.6rem; color: var(--danger); font-weight: 600;">Entrada registrada con la membresía no vigente.</div>` : "");
      mostrarPanelEntrada(panelClienteHtml(u, st, aviso, `✅ Entrada registrada · ${horaLocalStr()}`));
      loadCheckins();
    })
    .catch(() => mostrarPanelEntrada(`<div style="padding: 1rem; color: var(--danger);">Error de conexión. Intenta de nuevo.</div>`));
}

function loadCheckins() {
  const list = $("#checkinList");
  const dateInput = $("#checkinDateFilter");
  if (!list) return;
  const fecha = (dateInput && dateInput.value) ? dateInput.value : getLocalTodayStr();
  fetch(`${API_BASE}/admin/asistencias?fecha=${encodeURIComponent(fecha)}`)
    .then(r => r.json())
    .then(res => {
      const rows = (res.ok && res.asistencias) ? res.asistencias : [];
      const count = $("#checkinCount");
      if (count) count.textContent = `${rows.length} ${rows.length === 1 ? "entrada" : "entradas"}`;
      // Si es el día de hoy, el indicador "Entradas de hoy" se actualiza al momento
      if (fecha === getLocalTodayStr()) actualizarKpiEntradas(rows.length);
      if (!rows.length) {
        list.innerHTML = `<p class="report-empty">Aún no hay entradas registradas este día.</p>`;
        return;
      }
      const etiquetas = { activa: ["Al día", "estado-ok"], vencida: ["Vencida", "estado-danger"], sin_membresia: ["Sin membresía", "estado-danger"] };
      list.innerHTML = `<div class="checkin-row checkin-row-head" aria-hidden="true"><span>Hora</span><span>Cliente</span><span class="checkin-plan">Plan</span><span>Estado</span><span></span></div>` +
        rows.map(a => {
          const [txt, cls] = etiquetas[a.estado_membresia] || ["-", "muted"];
          return `<div class="checkin-row">
            <span class="checkin-hora">${esc(a.hora)}</span>
            <span class="checkin-nombre">${esc(a.nombre_completo)}</span>
            <span class="checkin-plan">${esc(a.plan || "Sin plan")}</span>
            <span class="${cls}">${esc(txt)}${a.tenia_deuda == 1 ? " · deuda" : ""}</span>
            <button type="button" class="btn-icon" aria-label="Anular la entrada de ${esc(a.nombre_completo)}" title="Anular esta entrada" onclick="anularEntrada(${Number(a.id_asistencia)})">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
            </button>
          </div>`;
        }).join("");
    })
    .catch(() => { list.innerHTML = `<p style="color: var(--danger);">No se pudieron cargar las entradas.</p>`; });
}

function anularEntrada(idAsistencia) {
  if (!confirm("¿Anular esta entrada? Úsalo solo si se registró por error.")) return;
  fetch(`${API_BASE}/admin/asistencias/${encodeURIComponent(idAsistencia)}`, { method: "DELETE" })
    .then(r => r.json())
    .then(() => loadCheckins());
}

/* ---------- Vencimientos ---------- */
let expiryTab = "mensual";
// Ventanas: cuántos días antes avisar y hasta cuántos días atrás mostrar vencidos
const EXPIRY_WINDOWS = { mensual: { antes: 7, despues: 30 }, semanal: { antes: 2, despues: 14 } };

function toggleExpirySection() {
  irAVista("vencimientos");
}

function setExpiryTab(tab) {
  expiryTab = tab;
  const bM = $("#expiryTabMensual"), bS = $("#expiryTabSemanal");
  if (bM) bM.className = tab === "mensual" ? "btn-primary" : "btn-secondary";
  if (bS) bS.className = tab === "semanal" ? "btn-primary" : "btn-secondary";
  renderExpiry();
}

function calcularVencimientos(categoria) {
  const w = EXPIRY_WINDOWS[categoria];
  const porVencer = [], vencidos = [];
  adminUsersData.forEach(u => {
    if (planCategoria(u.ultimo_plan) !== categoria) return;
    const vence = u.membresia && u.membresia.vence;
    const dias = diasHasta(vence);
    if (dias === null) return;
    if (dias >= 0 && dias <= w.antes) porVencer.push({ u, dias });
    else if (dias < 0 && dias >= -w.despues) vencidos.push({ u, dias });
  });
  porVencer.sort((a, b) => a.dias - b.dias);
  vencidos.sort((a, b) => b.dias - a.dias);
  return { porVencer, vencidos, w };
}

function filaVencimientoHtml({ u, dias }) {
  const col = dias < 0 ? "var(--danger)" : dias <= 2 ? "var(--warn)" : "var(--warn)";
  return `<div style="display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; padding: 0.7rem 0.9rem; background: var(--surface-2); border-radius: 10px; border-left: 3px solid ${col};">
    <div style="flex: 1 1 220px; min-width: 0;">
      <strong>${esc(u.nombre_completo)}</strong>${u.tiene_deuda == 1 ? ` <span class="badge badge-expired" style="font-size: 0.7rem;">deuda</span>` : ""}
      <div style="color: var(--text-muted); font-size: 0.82rem;">${esc(u.ultimo_plan || "")} · vence ${esc(formatFechaCorta(u.membresia.vence))} · <span style="color: ${col}; font-weight: 600;">${esc(textoDias(dias))}</span></div>
    </div>
    <div style="display: flex; gap: 0.4rem;">
      <button type="button" class="btn-secondary" onclick="sendWhatsAppReminderById(${esc(u.id_usuario)})" style="font-size: 0.8rem; padding: 0.4rem 0.7rem; border-color: var(--ok-border); color: var(--ok);">WhatsApp</button>
      <button type="button" class="btn-primary" onclick="openRegisterPaymentModal(${esc(u.id_usuario)})" style="font-size: 0.8rem; padding: 0.4rem 0.7rem;">Renovar</button>
    </div>
  </div>`;
}

function renderExpiry() {
  const box = $("#expiryContent");
  if (!box) return;
  const { porVencer, vencidos, w } = calcularVencimientos(expiryTab);
  const nombre = expiryTab === "mensual" ? "mensualidades" : "semanas";
  const vacio = (t) => `<p style="color: var(--text-muted); font-size: 0.9rem; padding: 0.5rem 0;">${t}</p>`;
  box.innerHTML = `
    <h4 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.6rem;">Por vencer en los próximos ${w.antes} días <span class="badge badge-warning">${porVencer.length}</span></h4>
    <div style="display: flex; flex-direction: column; gap: 0.45rem; margin-bottom: 1.6rem;">
      ${porVencer.length ? porVencer.map(filaVencimientoHtml).join("") : vacio(`No hay ${nombre} por vencer.`)}
    </div>
    <h4 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.6rem;">Vencidas en los últimos ${w.despues} días (sin renovar) <span class="badge badge-expired">${vencidos.length}</span></h4>
    <div style="display: flex; flex-direction: column; gap: 0.45rem;">
      ${vencidos.length ? vencidos.map(filaVencimientoHtml).join("") : vacio(`No hay ${nombre} vencidas recientemente.`)}
    </div>`;
}

// Contador del menú: mensualidades por vencer + vencidas recientes
function actualizarContadorVencimientos() {
  const el = $("#expiryCardCount");
  if (!el) return;
  const { porVencer, vencidos } = calcularVencimientos("mensual");
  const n = porVencer.length + vencidos.length;
  el.textContent = n ? String(n) : "";
  el.classList.toggle("hidden", !n);
  el.setAttribute("aria-label", `${n} mensualidades por vencer o vencidas`);
}

// Se llama cada vez que se recarga la lista de clientes
function refrescarPanelesAsistencia() {
  actualizarContadorVencimientos();
  const exp = $("#adminExpirySection");
  if (exp && !exp.classList.contains("hidden")) renderExpiry();
  if (vistaActual === "inicio") renderIndicadoresClientes();
}

/* ---------- Cierre de Caja y Reporte Mensual ---------- */
const MONEDAS_CAJA = ["USD", "COP", "BS", "Bancolombia", "USDT", "CLP"];
let cierreData = null;
let reporteVencidos = [];

function fmtMonto(valor) {
  const n = parseFloat(valor) || 0;
  return n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Monedas con monto distinto de cero (en el orden habitual)
function monedasConMonto(totales) {
  const keys = Object.keys(totales || {});
  const orden = MONEDAS_CAJA.concat(keys.filter(k => !MONEDAS_CAJA.includes(k)));
  return orden.filter(m => parseFloat(totales[m]) > 0);
}

function textoTotales(totales, sep) {
  const ms = monedasConMonto(totales);
  return ms.length ? ms.map(m => `${m} ${fmtMonto(totales[m])}`).join(sep || " · ") : "—";
}

function nombreTurno(t) {
  return t === "AM" ? "Turno AM" : t === "PM" ? "Turno PM" : t === "todos" ? "Todo el día" : "Sin turno";
}

/* ----- Cierre de Caja ----- */
function toggleCierreSection() {
  irAVista("cierre");
}

function loadCierreCaja() {
  const box = $("#cierreContent");
  if (!box) return;
  const fecha = ($("#cierreFecha") && $("#cierreFecha").value) || getLocalTodayStr();
  const turno = ($("#cierreTurno") && $("#cierreTurno").value) || "todos";
  box.innerHTML = `<p class="report-empty">Cargando cierre...</p>`;
  cierreData = null;
  fetch(`${API_BASE}/admin/cierre-caja?fecha=${encodeURIComponent(fecha)}&turno=${encodeURIComponent(turno)}`)
    .then(r => r.json())
    .then(data => {
      if (!data.ok) { box.innerHTML = `<p class="report-error">${esc(data.msg || "No se pudo cargar el cierre.")}</p>`; return; }
      cierreData = data;
      renderCierreCaja();
    })
    .catch(err => {
      console.error("Error cargando cierre de caja:", err);
      box.innerHTML = `<p class="report-error">No se pudo cargar el cierre. Revisa la conexión.</p>`;
    });
}

function tilesMonedasHtml(totales) {
  return `<div class="stat-grid">${MONEDAS_CAJA.map(m => {
    const v = parseFloat(totales[m]) || 0;
    return `<div class="stat-tile${v > 0 ? "" : " stat-tile-empty"}">
      <span class="stat-label">${esc(m)}</span>
      <span class="stat-value">${esc(fmtMonto(v))}</span>
    </div>`;
  }).join("")}</div>`;
}

function tablaPlanesHtml(porPlan) {
  if (!porPlan || !porPlan.length) return `<p class="report-empty">Sin pagos.</p>`;
  return `<div class="report-table-wrap"><table class="report-table">
    <thead><tr><th>Plan</th><th>Pagos</th><th>Total</th></tr></thead>
    <tbody>${porPlan.map(p => `<tr>
      <td>${esc(p.plan)}</td><td>${esc(p.cantidad)}</td><td>${esc(textoTotales(p.totales))}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function filaPagoCierreHtml(p) {
  const mismaFecha = p.fecha_registro === p.fecha_pago;
  const cuando = p.hora_registro
    ? (mismaFecha ? p.hora_registro : `${formatFechaCorta(p.fecha_registro)} ${p.hora_registro}`)
    : "—";
  return `<div class="cierre-pago">
    <span class="cierre-pago-hora">${esc(cuando)}</span>
    <span class="cierre-pago-cliente"><strong>${esc(p.nombre_cliente)}</strong>
      <small>${esc(p.plan)}${Number(p.es_abono) === 1 ? ` <span class="badge badge-warning" style="font-size: 0.7rem;">abono</span>` : ""}</small></span>
    <span class="cierre-pago-monto">${esc(fmtMonto(p.monto))} ${esc(p.moneda)}</span>
  </div>`;
}

function renderCierreCaja() {
  const box = $("#cierreContent");
  const d = cierreData;
  if (!box || !d) return;
  const r = d.resumen;
  const sub = $("#cierreSubtitulo");
  if (sub) sub.textContent = `${formatFechaCorta(d.fecha)} · ${nombreTurno(d.turno)} · los montos de cada moneda se suman por separado.`;

  let html = `
    <h4 class="report-h4">Total cobrado <span class="badge badge-neutral">${esc(r.cantidad)} ${r.cantidad === 1 ? "pago" : "pagos"}</span></h4>
    ${tilesMonedasHtml(r.totales)}
    <div class="report-two-col">
      <div class="report-box">
        <h5>Pagos completos <span class="badge badge-neutral">${esc(r.completos.cantidad)}</span></h5>
        <p>${esc(textoTotales(r.completos.totales))}</p>
      </div>
      <div class="report-box">
        <h5>Abonos <span class="badge badge-warning">${esc(r.abonos.cantidad)}</span></h5>
        <p>${esc(textoTotales(r.abonos.totales))}</p>
      </div>
    </div>
    <h4 class="report-h4">Por plan</h4>
    ${tablaPlanesHtml(r.por_plan)}`;

  if (d.turno === "todos") {
    html += `<h4 class="report-h4">Por turno</h4><div class="report-two-col">${d.grupos.map(g => `
      <div class="report-box">
        <h5>${esc(nombreTurno(g.turno))} <span class="badge badge-neutral">${esc(g.cantidad)}</span></h5>
        <p>${esc(textoTotales(g.totales))}</p>
        ${g.abonos.cantidad ? `<p class="report-muted">Abonos: ${esc(textoTotales(g.abonos.totales))}</p>` : ""}
      </div>`).join("")}</div>`;
  }

  html += `<h4 class="report-h4">Pagos del ${d.turno === "todos" ? "día" : "turno"}</h4>`;
  const conPagos = d.grupos.filter(g => g.pagos && g.pagos.length);
  if (!conPagos.length) {
    html += `<p class="report-empty">No hay pagos registrados.</p>`;
  } else {
    html += conPagos.map(g => `
      ${d.turno === "todos" ? `<h5 class="report-h5">${esc(nombreTurno(g.turno))}</h5>` : ""}
      <div class="cierre-lista">${g.pagos.map(filaPagoCierreHtml).join("")}</div>`).join("");
  }
  box.innerHTML = html;
}

function copiarResumenCierre() {
  const d = cierreData;
  if (!d) { showToast("Primero carga el cierre de caja.", "aviso"); return; }
  const r = d.resumen;
  const lineasMonedas = (tot) => {
    const ms = monedasConMonto(tot);
    return ms.length ? ms.map(m => `• ${m}: ${fmtMonto(tot[m])}`).join("\n") : "• Sin ingresos";
  };
  let t = `*ATLAS GYM – CIERRE DE CAJA*\n`;
  t += `Fecha: ${formatFechaCorta(d.fecha)} · ${nombreTurno(d.turno)}\n`;
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  t += `Pagos: ${r.cantidad} (${plural(r.completos.cantidad, "completo", "completos")}, ${plural(r.abonos.cantidad, "abono", "abonos")})\n\n`;
  t += `*Total cobrado*\n${lineasMonedas(r.totales)}\n`;
  if (r.abonos.cantidad) t += `\n*De eso, abonos*\n${lineasMonedas(r.abonos.totales)}\n`;
  if (r.por_plan.length) {
    t += `\n*Por plan*\n` + r.por_plan.map(p => `• ${p.plan}: ${p.cantidad} — ${textoTotales(p.totales, ", ")}`).join("\n") + "\n";
  }
  if (d.turno === "todos") {
    t += `\n*Por turno*\n` + d.grupos.map(g => `• ${nombreTurno(g.turno)}: ${g.cantidad} — ${textoTotales(g.totales, ", ")}`).join("\n") + "\n";
  }
  t += `\n_Los montos de cada moneda se suman por separado._`;

  const ok = () => showToast("Resumen copiado. Ya puedes pegarlo en WhatsApp.", "exito");
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(t).then(ok).catch(() => copiarTextoFallback(t, ok));
  } else {
    copiarTextoFallback(t, ok);
  }
}

// Copiado alternativo para navegadores sin acceso al portapapeles moderno
function copiarTextoFallback(texto, ok) {
  const ta = document.createElement("textarea");
  ta.value = texto;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let copiado = false;
  try { copiado = document.execCommand("copy"); } catch (e) { copiado = false; }
  document.body.removeChild(ta);
  if (copiado) ok();
  else window.prompt("Copia el resumen manualmente:", texto);
}

/* ----- Reporte Mensual (solo admin) ----- */
const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function nombreMes(mesStr) {
  const [y, m] = String(mesStr || "").split("-").map(Number);
  if (!y || !m) return "";
  return `${NOMBRES_MES[m - 1]} ${y}`;
}

function llenarSelectorMeses() {
  const sel = $("#reporteMes");
  if (!sel || sel.options.length) return;
  const [y, m] = getLocalTodayStr().split("-").map(Number);
  for (let i = 0; i < 24; i++) {
    const d = new Date(y, m - 1 - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const opt = document.createElement("option");
    opt.value = val;
    const txt = nombreMes(val);
    opt.textContent = (i === 0 ? `${txt} (en curso)` : txt).replace(/^./, c => c.toUpperCase());
    sel.appendChild(opt);
  }
}

function toggleReporteSection() {
  irAVista("reportes");
}

function loadReporteMensual() {
  const box = $("#reporteContent");
  const sel = $("#reporteMes");
  if (!box || !sel) return;
  const mes = sel.value;
  box.innerHTML = `<p class="report-empty">Cargando reporte...</p>`;
  const q = `?mes=${encodeURIComponent(mes)}`;
  const get = (ruta) => fetch(`${API_BASE}/admin/reportes/${ruta}${q}`).then(r => r.json());
  Promise.all([get("ingresos"), get("clientes"), get("asistencia")])
    .then(([ing, cli, asi]) => {
      if (sel.value !== mes) return; // el usuario cambió de mes mientras cargaba
      const fallo = [ing, cli, asi].find(x => !x.ok);
      if (fallo) { box.innerHTML = `<p class="report-error">${esc(fallo.msg || "No se pudo cargar el reporte.")}</p>`; return; }
      reporteVencidos = cli.vencidos_sin_renovar || [];
      box.innerHTML = reporteIngresosHtml(ing) + reporteClientesHtml(cli) + reporteAsistenciaHtml(asi);
    })
    .catch(err => {
      console.error("Error cargando reporte mensual:", err);
      box.innerHTML = `<p class="report-error">No se pudo cargar el reporte. Revisa la conexión.</p>`;
    });
}

function variacionHtml(actual, anterior) {
  const a = parseFloat(actual) || 0, b = parseFloat(anterior) || 0;
  if (!b) return a ? `<span class="var-up">nuevo</span>` : `<span class="report-muted">—</span>`;
  const pct = Math.round(((a - b) / b) * 100);
  const cls = pct > 0 ? "var-up" : pct < 0 ? "var-down" : "report-muted";
  return `<span class="${cls}">${pct > 0 ? "+" : ""}${esc(pct)}%</span>`;
}

function reporteIngresosHtml(d) {
  const act = d.actual, ant = d.anterior;
  const monedas = MONEDAS_CAJA.filter(m => parseFloat(act.totales[m]) > 0 || parseFloat(ant.totales[m]) > 0);
  const filas = monedas.length
    ? monedas.map(m => `<tr><td>${esc(m)}</td><td>${esc(fmtMonto(act.totales[m]))}</td><td>${esc(fmtMonto(ant.totales[m]))}</td><td>${variacionHtml(act.totales[m], ant.totales[m])}</td></tr>`).join("")
    : `<tr><td colspan="4" class="report-muted">Sin ingresos en ninguno de los dos meses.</td></tr>`;
  return `
    <h4 class="report-h4 report-section-title">Ingresos</h4>
    <div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Moneda</th><th>${esc(nombreMes(d.mes))}</th><th>${esc(nombreMes(d.mes_anterior))}</th><th>Var.</th></tr></thead>
      <tbody>${filas}
        <tr class="report-row-total"><td>Pagos</td><td>${esc(act.cantidad)}</td><td>${esc(ant.cantidad)}</td><td>${variacionHtml(act.cantidad, ant.cantidad)}</td></tr>
      </tbody></table></div>
    <p class="report-muted" style="margin-top: 0.4rem;">Abonos del mes: ${esc(act.abonos.cantidad)} (${esc(textoTotales(act.abonos.totales))})</p>
    <h5 class="report-h5">Por plan</h5>
    ${tablaPlanesHtml(act.por_plan)}`;
}

function statTile(label, valor, extraClass) {
  return `<div class="stat-tile ${extraClass || ""}"><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(valor)}</span></div>`;
}

function reporteClientesHtml(d) {
  const venc = d.vencidos_sin_renovar || [];
  const nuevos = d.nuevos || [];
  return `
    <h4 class="report-h4 report-section-title">Clientes</h4>
    <div class="stat-grid">
      ${statTile(`Activos al ${formatFechaCorta(d.corte)}`, d.activos)}
      ${statTile("Nuevos", nuevos.length)}
      ${statTile("Renovaciones", d.renovaciones)}
      ${statTile("Vencidos sin renovar", venc.length, venc.length ? "stat-tile-alert" : "")}
    </div>
    ${nuevos.length ? `<p class="report-muted" style="margin-top: 0.6rem;"><strong>Nuevos:</strong> ${nuevos.map(n => esc(n.nombre_completo)).join(", ")}</p>` : ""}
    <h5 class="report-h5">Vencieron en el mes y no han renovado</h5>
    ${venc.length ? `<div class="cierre-lista">${venc.map(v => `
      <div class="cierre-pago">
        <span class="cierre-pago-cliente"><strong>${esc(v.nombre_completo)}</strong>
          <small>${esc(v.plan || "Sin plan")} · venció ${esc(formatFechaCorta(v.vence))}${v.telefono ? "" : " · sin teléfono"}</small></span>
        <button type="button" class="btn-secondary" onclick="whatsappVencidoReporte(${esc(Number(v.id_usuario))})"
          style="font-size: 0.8rem; padding: 0.4rem 0.7rem; border-color: var(--ok-border); color: var(--ok);">WhatsApp</button>
      </div>`).join("")}</div>` : `<p class="report-empty">Nadie quedó vencido sin renovar este mes.</p>`}`;
}

function whatsappVencidoReporte(idUsuario) {
  const v = reporteVencidos.find(x => String(x.id_usuario) === String(idUsuario));
  if (!v) return;
  sendWhatsAppReminder(v.nombre_completo, v.telefono || "", formatFechaCorta(v.vence), "vencida");
}

function reporteAsistenciaHtml(d) {
  let grafico = `<p class="report-empty">No hay entradas registradas en este mes.</p>`;
  if (d.por_hora && d.por_hora.length) {
    const mapa = {};
    d.por_hora.forEach(h => { mapa[h.hora] = h.n; });
    const horas = d.por_hora.map(h => h.hora);
    const desde = Math.min(...horas), hasta = Math.max(...horas);
    const max = Math.max(...d.por_hora.map(h => h.n));
    const barras = [];
    for (let h = desde; h <= hasta; h++) {
      const n = mapa[h] || 0;
      const alto = max ? Math.max(n ? 4 : 0, Math.round((n / max) * 100)) : 0;
      barras.push(`<div class="bar-col" title="${esc(`${h}:00 – ${n} entradas`)}">
        <span class="bar-num">${n ? esc(n) : ""}</span>
        <div class="bar-track"><div class="bar${n === max ? " bar-peak" : ""}" style="height: ${alto}%;"></div></div>
        <span class="bar-label">${esc(h)}</span>
      </div>`);
    }
    grafico = `<div class="bar-chart">${barras.join("")}</div>
      <p class="report-muted" style="text-align: center; margin-top: 0.3rem;">Hora del día (entradas por hora)</p>`;
  }
  const top = d.top_clientes || [];
  return `
    <h4 class="report-h4 report-section-title">Asistencia</h4>
    <div class="stat-grid">
      ${statTile("Entradas", d.total)}
      ${statTile("Promedio diario", d.promedio_diario)}
      ${statTile("Días con entradas", d.dias_con_entradas)}
    </div>
    <h5 class="report-h5">Horas pico</h5>
    ${grafico}
    <h5 class="report-h5">Clientes que más vinieron</h5>
    ${top.length ? `<ol class="report-top">${top.map(t => `<li><span>${esc(t.nombre_completo)}</span><strong>${esc(t.visitas)}</strong></li>`).join("")}</ol>`
      : `<p class="report-empty">Sin datos.</p>`}`;
}

/* =========================================================
   PANEL ADMINISTRATIVO: VISTAS, RESUMEN DE HOY, BUSCADOR Y FICHA
   ========================================================= */

function esRecepcionSola() {
  return localStorage.getItem("esRecepcionista") === "true" && localStorage.getItem("esAdmin") !== "true";
}

// Cada vista: el elemento que se muestra, si es solo del admin y qué se carga al abrirla
const VISTAS_PANEL = {
  inicio: { el: "#viewInicio", titulo: "Inicio", cargar: () => cargarInicio() },
  entrada: { el: "#viewEntrada", titulo: "Control de entrada", cargar: () => prepararCheckin("#viewEntrada", true) },
  clientes: { el: "#adminClientsSection", titulo: "Clientes", cargar: () => filterAdminUsers() },
  pagos: { el: "#adminPaymentsSection", titulo: "Pagos", soloAdmin: true, cargar: () => loadAdminPaymentsHistory(getLocalTodayStr()) },
  vencimientos: { el: "#adminExpirySection", titulo: "Vencimientos", cargar: () => renderExpiry() },
  cierre: {
    el: "#adminCierreSection", titulo: "Cierre de caja", soloAdmin: true,
    cargar: () => { const f = $("#cierreFecha"); if (f && !f.value) f.value = getLocalTodayStr(); loadCierreCaja(); }
  },
  reportes: { el: "#adminReporteSection", titulo: "Reportes", soloAdmin: true, cargar: () => { llenarSelectorMeses(); loadReporteMensual(); } },
  plantillas: { el: "#adminTemplatesSection", titulo: "Plantillas de rutinas", cargar: () => loadAdminTemplates() },
  material: { el: "#adminResourcesSection", titulo: "Material", soloAdmin: true, cargar: () => loadAdminResources() }
};

function vistaPermitida(nombre) {
  const v = VISTAS_PANEL[nombre];
  return !!v && !(v.soloAdmin && esRecepcionSola()) && !!$(v.el);
}

function irAVista(nombre) {
  if (location.hash === `#${nombre}`) mostrarVista(nombre);
  else location.hash = nombre;
}

function mostrarVista(nombre) {
  if (!vistaPermitida(nombre)) {
    nombre = "inicio";
    if (location.hash && location.hash !== "#inicio") history.replaceState(null, "", "#inicio");
  }
  const v = VISTAS_PANEL[nombre];
  document.querySelectorAll("#panelContent > .view").forEach(sec => sec.classList.add("hidden"));
  const sec = $(v.el);
  if (sec) sec.classList.remove("hidden");

  document.querySelectorAll("#sideNav .nav-link").forEach(a => {
    const activo = a.dataset.view === nombre;
    a.classList.toggle("active", activo);
    if (activo) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  vistaActual = nombre;
  document.title = `ATLAS · ${v.titulo}`;
  cerrarMenuMovil();
  window.scrollTo(0, 0);
  v.cargar();
}

function iniciarNavegacionPanel() {
  window.addEventListener("hashchange", () => mostrarVista(location.hash.slice(1) || "inicio"));
  mostrarVista(location.hash.slice(1) || "inicio");

  // Ctrl+K (o Cmd+K) enfoca el buscador; Escape cierra la ficha o el menú
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const g = $("#globalSearch");
      if (g) { g.focus(); g.select(); }
      return;
    }
    if (e.key === "Escape") {
      const modalAbierto = [...document.querySelectorAll(".modal-overlay")].some(m => !m.classList.contains("hidden"));
      if (modalAbierto) return;
      if (fichaClienteId !== null) { closeClientDrawer(); return; }
      cerrarMenuMovil();
    }
  });

  // Clic fuera del buscador: se cierran los resultados
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".global-search")) cerrarResultadosGlobal();
  });

  // Tabla de clientes: ordenar por columna y abrir la ficha
  const tabla = $("#clientesTabla");
  if (tabla) {
    tabla.querySelector("thead").addEventListener("click", (e) => {
      const b = e.target.closest(".th-sort");
      if (b) cambiarOrdenClientes(b.dataset.sort);
    });
    const tbody = tabla.querySelector("tbody");
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) abrirFichaCliente(Number(tr.dataset.id));
    });
    tbody.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      e.preventDefault();
      abrirFichaCliente(Number(tr.dataset.id));
    });
  }
}

/* ----- Menú en pantallas angostas ----- */
function toggleMobileMenu() {
  const sb = $("#sidebar"), btn = $("#menuToggle");
  if (!sb || !btn) return;
  const abrir = !sb.classList.contains("abierto");
  sb.classList.toggle("abierto", abrir);
  btn.setAttribute("aria-expanded", abrir ? "true" : "false");
}

function cerrarMenuMovil() {
  const sb = $("#sidebar"), btn = $("#menuToggle");
  if (sb) sb.classList.remove("abierto");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

/* ----- Control de entrada: el mismo bloque se muestra en Inicio o en su propia vista ----- */
function prepararCheckin(destino, enfocar) {
  const card = $("#adminCheckinSection"), cont = $(destino);
  if (card && cont && card.parentElement !== cont) cont.appendChild(card);
  const dateInput = $("#checkinDateFilter");
  if (dateInput && !dateInput.value) dateInput.value = getLocalTodayStr();
  loadCheckins();
  const input = $("#checkinSearch");
  if (enfocar && input) setTimeout(() => input.focus(), 50);
}

function claseEstadoEntrada(codigo) {
  return codigo === "activa" ? "estado-ok" : codigo === "por_vencer" ? "estado-warn" : "estado-danger";
}

/* ----- Inicio: Resumen de hoy ----- */
let inicioVencerTab = "mensual";
let entradasAyer = null;

function fechaLargaHoy() {
  const [y, m, d] = getLocalTodayStr().split("-").map(Number);
  const txt = new Date(y, m - 1, d).toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function sumarDias(fechaStr, n) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function cargarInicio() {
  const f = $("#inicioFecha");
  if (f) f.textContent = fechaLargaHoy();
  // En Inicio, el control de entrada va dentro del resumen; recepción lo tiene listo para escribir
  prepararCheckin("#inicioCheckinSlot", esRecepcionSola());
  renderIndicadoresClientes();
  cargarEntradasAyer();
  if (!esRecepcionSola()) cargarCobradoHoy();
}

// Por vencer y deuda salen de la lista de clientes que ya está cargada
function renderIndicadoresClientes() {
  const fijar = (sel, n) => {
    const el = $(sel);
    if (!el) return;
    el.textContent = n;
    const kpi = el.closest(".kpi");
    if (kpi) kpi.classList.toggle("con-valor", n > 0);
  };
  fijar("#kpiPorVencer", calcularVencimientos("mensual").porVencer.length);
  fijar("#kpiDeuda", adminUsersData.filter(u => u.tiene_deuda == 1).length);
  renderInicioPorVencer();
}

function cargarEntradasAyer() {
  const ayer = sumarDias(getLocalTodayStr(), -1);
  fetch(`${API_BASE}/admin/asistencias?fecha=${encodeURIComponent(ayer)}`)
    .then(r => r.json())
    .then(res => {
      entradasAyer = (res.ok && res.asistencias) ? res.asistencias.length : null;
      const actual = $("#kpiEntradas");
      if (actual && actual.dataset.valor !== undefined) actualizarKpiEntradas(Number(actual.dataset.valor));
    })
    .catch(err => console.error("Error cargando entradas de ayer:", err));
}

function actualizarKpiEntradas(n) {
  const el = $("#kpiEntradas"), comp = $("#kpiEntradasComp");
  if (!el) return;
  el.textContent = n;
  el.dataset.valor = n;
  if (!comp || entradasAyer === null) return;
  const dif = n - entradasAyer;
  comp.className = "kpi-note" + (dif > 0 ? " estado-ok" : "");
  comp.textContent = dif === 0 ? "Igual que ayer" : `${Math.abs(dif)} ${dif > 0 ? "más" : "menos"} que ayer`;
}

// Cobrado hoy y últimos pagos (solo admin): usa la ruta del cierre de caja
function cargarCobradoHoy() {
  const box = $("#kpiCobrado");
  if (!box) return;
  fetch(`${API_BASE}/admin/cierre-caja?fecha=${encodeURIComponent(getLocalTodayStr())}&turno=todos`)
    .then(r => r.json())
    .then(data => {
      if (!data.ok) { box.innerHTML = `<span class="kpi-note">${esc(data.msg || "No disponible")}</span>`; return; }
      // Cada moneda con movimiento en su propia línea, todas iguales; las que están en cero no se muestran
      const monedas = monedasConMonto(data.resumen.totales);
      box.innerHTML = monedas.length
        ? monedas.map(m => `<span>${esc(m)} ${esc(fmtMonto(data.resumen.totales[m]))}</span>`).join("")
        : `<span class="kpi-note">Sin cobros todavía</span>`;
      const pagos = (data.grupos || []).flatMap(g => g.pagos || []);
      renderUltimosPagos(pagos);
    })
    .catch(err => {
      console.error("Error cargando cobrado hoy:", err);
      box.innerHTML = `<span class="kpi-note">No disponible</span>`;
    });
}

function renderUltimosPagos(pagos) {
  const box = $("#inicioUltimosPagos");
  if (!box) return;
  if (!pagos.length) { box.innerHTML = `<p class="report-empty">Aún no hay pagos registrados hoy.</p>`; return; }
  const orden = [...pagos].sort((a, b) =>
    String(b.hora_registro || "").localeCompare(String(a.hora_registro || "")) || Number(b.id_pago) - Number(a.id_pago)
  ).slice(0, 8);
  box.innerHTML = `<div class="tabla-wrap"><table class="data-table">
    <thead><tr><th scope="col">Hora</th><th scope="col">Cliente</th><th scope="col" class="col-md">Plan</th><th scope="col" style="text-align: right;">Monto</th><th scope="col" class="col-md">Turno</th></tr></thead>
    <tbody>${orden.map(p => `<tr>
      <td class="hora">${esc(p.hora_registro || "—")}</td>
      <td><span class="cliente-nombre">${esc(p.nombre_cliente)}</span>${Number(p.es_abono) === 1 ? `<span class="tag-abono">ABONO</span>` : ""}</td>
      <td class="col-md muted">${esc(p.plan)}</td>
      <td class="num">${esc(p.moneda)} ${esc(fmtMonto(p.monto))}</td>
      <td class="col-md muted">${esc(p.turno || "Sin turno")}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function setInicioVencerTab(tab) {
  inicioVencerTab = tab;
  const m = $("#inicioTabMensual"), s = $("#inicioTabSemanal");
  if (m) m.setAttribute("aria-selected", tab === "mensual" ? "true" : "false");
  if (s) s.setAttribute("aria-selected", tab === "semanal" ? "true" : "false");
  renderInicioPorVencer();
}

function renderInicioPorVencer() {
  const box = $("#inicioPorVencer");
  if (!box) return;
  const { porVencer, w } = calcularVencimientos(inicioVencerTab);
  if (!porVencer.length) {
    const nombre = inicioVencerTab === "mensual" ? "mensualidades" : "semanas";
    box.innerHTML = `<p class="report-empty">No hay ${nombre} por vencer en los próximos ${w.antes} días.</p>`;
    return;
  }
  box.innerHTML = porVencer.slice(0, 6).map(({ u, dias }) => {
    const txt = dias === 0 ? "vence hoy" : dias === 1 ? "vence mañana" : `faltan ${dias} días`;
    return `<div class="lista-item">
      <div class="lista-item-main"><strong>${esc(u.nombre_completo)}</strong><span class="${dias <= 2 ? "estado-warn" : "muted"}">${esc(txt)}</span></div>
      <button type="button" class="btn-wa" aria-label="Enviar recordatorio por WhatsApp a ${esc(u.nombre_completo)}" onclick="sendWhatsAppReminderById(${Number(u.id_usuario)})">${ICONO_WA}</button>
    </div>`;
  }).join("") + (porVencer.length > 6 ? `<a href="#vencimientos" class="card-link" style="padding-top: 8px;">Ver los ${porVencer.length}</a>` : "");
}

const ICONO_WA = `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-13.4 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12z"></path></svg>`;

/* ----- Buscador de clientes de la barra superior ----- */
let globalMatches = [];
let globalIndice = -1;

function onGlobalSearchInput() {
  const input = $("#globalSearch"), box = $("#globalSearchResults");
  if (!input || !box) return;
  const q = input.value.trim();
  if (!q) { cerrarResultadosGlobal(); return; }
  globalMatches = buscarClientesEntrada(q);
  globalIndice = globalMatches.length ? 0 : -1;
  if (!globalMatches.length) {
    box.innerHTML = `<div class="search-empty">Ningún cliente coincide con “${esc(q)}”.</div>`;
  } else {
    box.innerHTML = globalMatches.map((u, i) => {
      const st = getClientStatusInfo(u);
      const sub = [u.cedula ? `C.I. ${u.cedula}` : "", u.ultimo_plan || ""].filter(Boolean).join(" · ");
      return `<button type="button" class="search-item${i === globalIndice ? " activo" : ""}" id="gs-opt-${i}" role="option"
          aria-selected="${i === globalIndice}" onclick="abrirFichaDesdeBusqueda(${Number(u.id_usuario)})">
        <span class="search-item-main"><strong>${esc(u.nombre_completo)}</strong><small>${esc(sub || "Sin datos")}</small></span>
        <span class="badge ${esc(st.badgeClass)}">${esc(st.badgeText)}</span>
      </button>`;
    }).join("");
  }
  box.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
  actualizarOpcionActiva();
}

function onGlobalSearchKeydown(e) {
  if (e.key === "Escape") { cerrarResultadosGlobal(); e.target.blur(); return; }
  if (!globalMatches.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = globalMatches.length;
    globalIndice = (globalIndice + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    actualizarOpcionActiva();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const u = globalMatches[Math.max(0, globalIndice)];
    if (u) abrirFichaDesdeBusqueda(u.id_usuario);
  }
}

function actualizarOpcionActiva() {
  const input = $("#globalSearch");
  document.querySelectorAll("#globalSearchResults .search-item").forEach((el, i) => {
    el.classList.toggle("activo", i === globalIndice);
    el.setAttribute("aria-selected", i === globalIndice ? "true" : "false");
    if (i === globalIndice) el.scrollIntoView({ block: "nearest" });
  });
  if (input) {
    if (globalIndice >= 0) input.setAttribute("aria-activedescendant", `gs-opt-${globalIndice}`);
    else input.removeAttribute("aria-activedescendant");
  }
}

function cerrarResultadosGlobal() {
  const box = $("#globalSearchResults"), input = $("#globalSearch");
  if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
  if (input) { input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
  globalMatches = [];
  globalIndice = -1;
}

function abrirFichaDesdeBusqueda(id) {
  const input = $("#globalSearch");
  if (input) input.value = "";
  cerrarResultadosGlobal();
  abrirFichaCliente(id);
}

/* ----- Tabla de clientes: orden por columna ----- */
const clientesOrden = { key: null, dir: 1 };

function cambiarOrdenClientes(key) {
  if (clientesOrden.key === key) clientesOrden.dir *= -1;
  else { clientesOrden.key = key; clientesOrden.dir = 1; }
  document.querySelectorAll("#clientesTabla thead th").forEach(th => {
    const b = th.querySelector(".th-sort");
    const activo = b && b.dataset.sort === clientesOrden.key;
    th.setAttribute("aria-sort", activo ? (clientesOrden.dir === 1 ? "ascending" : "descending") : "none");
  });
  filterAdminUsers();
}

function ordenarClientes(list) {
  const rangoEstado = { "badge-expired": 0, "badge-warning": 1, "badge-active": 2 };
  const valor = (u) => {
    switch (clientesOrden.key) {
      case "nombre": return (u.nombre_completo || "").toLowerCase();
      case "plan": return (u.ultimo_plan || "~").toLowerCase();
      case "vence": return /^\d{4}-\d{2}-\d{2}$/.test(u.membresia && u.membresia.vence) ? u.membresia.vence : "9999-99-99";
      case "estado": return rangoEstado[getClientStatusInfo(u).badgeClass] ?? 9;
      case "deuda": return u.tiene_deuda == 1 ? 0 : 1;
      case "pago": return u.ultimo_pago || "0000-00-00";
      default: return 0;
    }
  };
  return [...list].sort((a, b) => {
    const va = valor(a), vb = valor(b);
    const r = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "es");
    return r * clientesOrden.dir || (a.nombre_completo || "").localeCompare(b.nombre_completo || "", "es");
  });
}

/* ----- Ficha del cliente (panel lateral) ----- */
let fichaClienteId = null;
let fichaFocoPrevio = null;

function abrirFichaCliente(id) {
  const u = adminUsersData.find(x => Number(x.id_usuario) === Number(id));
  if (!u) { showToast("No se encontró el cliente.", "aviso"); return; }
  if (fichaClienteId === null) fichaFocoPrevio = document.activeElement;
  fichaClienteId = Number(u.id_usuario);
  renderFichaCliente(u);
  $("#clientDrawer").classList.remove("hidden");
  $("#clientDrawerBackdrop").classList.remove("hidden");
  $("#clientDrawer").focus();
  marcarFilaSeleccionada();
}

function closeClientDrawer() {
  const d = $("#clientDrawer"), b = $("#clientDrawerBackdrop");
  if (d) d.classList.add("hidden");
  if (b) b.classList.add("hidden");
  fichaClienteId = null;
  marcarFilaSeleccionada();
  if (fichaFocoPrevio && document.contains(fichaFocoPrevio)) fichaFocoPrevio.focus();
  fichaFocoPrevio = null;
}

function marcarFilaSeleccionada() {
  document.querySelectorAll("#adminUsersGrid tr[data-id]").forEach(tr => {
    tr.classList.toggle("seleccionado", Number(tr.dataset.id) === fichaClienteId);
  });
}

// Tras recargar los clientes (pago, edición, borrado), la ficha abierta se actualiza o se cierra
function refrescarFichaAbierta() {
  if (fichaClienteId === null) return;
  const u = adminUsersData.find(x => Number(x.id_usuario) === fichaClienteId);
  if (u) renderFichaCliente(u);
  else closeClientDrawer();
}

function renderFichaCliente(u) {
  const id = Number(u.id_usuario);
  const st = getClientStatusInfo(u);
  const vence = u.membresia && u.membresia.vence;
  const dias = diasHasta(vence);
  const rutinas = u.rutinas || [];
  const nombreEl = $("#drawerNombre");
  if (nombreEl) nombreEl.textContent = u.nombre_completo;

  $("#drawerBody").innerHTML = `
    <div class="drawer-badges">
      <span class="badge ${esc(st.badgeClass)}">${esc(st.badgeText)}</span>
      ${u.tiene_deuda == 1 ? `<span class="badge badge-expired">Deuda pendiente</span>` : ""}
    </div>

    <section class="drawer-section" aria-label="Membresía">
      <h3>Membresía</h3>
      <dl class="dato-lista">
        <dt>Plan</dt><dd>${esc(u.ultimo_plan || "Sin plan")}</dd>
        <dt>Vence</dt><dd>${esc(formatFechaCorta(vence))}${dias !== null ? ` <span class="${esc(claseDias(dias))}">· ${esc(textoDias(dias))}</span>` : ""}</dd>
        <dt>Último pago</dt><dd>${u.ultimo_pago ? esc(formatFechaCorta(u.ultimo_pago)) : "Sin pagos"}</dd>
      </dl>
    </section>

    <section class="drawer-section" aria-label="Acciones">
      <h3>Acciones</h3>
      <div class="drawer-acciones">
        <button type="button" class="btn-primary full" onclick="openRegisterPaymentModal(${id})">Registrar pago</button>
        <button type="button" class="btn-secondary btn-wa-texto" onclick="sendWhatsAppReminderById(${id})">WhatsApp</button>
        <button type="button" class="btn-secondary" onclick="editUserByAdmin(${id})">Editar datos</button>
        <button type="button" class="btn-secondary full" onclick="viewUserProgressModal(${id})">Ver rutinas y progreso</button>
        ${esRecepcionSola() ? "" : `<button type="button" class="btn-danger full" onclick="deleteUserByAdmin(${id})">Eliminar cliente</button>`}
      </div>
    </section>

    <section class="drawer-section" aria-label="Datos de contacto">
      <h3>Datos</h3>
      <dl class="dato-lista">
        <dt>Cédula</dt><dd>${esc(u.cedula || "Sin cédula")}</dd>
        <dt>Correo</dt><dd>${esc(u.correo || "Sin correo")}</dd>
        <dt>Teléfono</dt><dd>${esc(u.telefono || "Sin teléfono")}</dd>
      </dl>
    </section>

    <section class="drawer-section" aria-label="Rutinas">
      <h3>Rutinas (${rutinas.length})</h3>
      ${rutinas.length ? rutinas.map(r => `
        <div class="rutina-item">
          <div class="rutina-item-main">
            <strong>${esc(r.titulo)}</strong>
            <small>${esc(r.horario || "Horario flexible")} · ${esc((r.ejercicios || []).length)} ejercicios</small>
          </div>
          <button type="button" class="btn-secondary" style="width: auto;" onclick="inspectRoutineDetailByAdmin(${id}, ${Number(r.id_rutina)})"
            aria-label="Ver la rutina ${esc(r.titulo)}">Ver</button>
        </div>`).join("") : `<p class="report-empty">Este cliente aún no tiene rutinas.</p>`}
    </section>`;
}

function claseDias(dias) {
  return dias < 0 ? "estado-danger" : dias <= 5 ? "estado-warn" : "estado-ok";
}

/* =========================================================
   VISTA DEL CLIENTE (dashboard.html): Hoy, Rutinas, Progreso, Mi plan
   ========================================================= */

const VISTAS_CLIENTE = {
  hoy: { el: "#vistaHoy", titulo: "Hoy" },
  rutinas: { el: "#vistaRutinas", titulo: "Mis rutinas" },
  progreso: { el: "#vistaProgreso", titulo: "Progreso" },
  plan: { el: "#vistaPlan", titulo: "Mi plan" }
};

function iniciarNavegacionCliente() {
  window.addEventListener("hashchange", () => mostrarVistaCliente(location.hash.slice(1)));
  mostrarVistaCliente(location.hash.slice(1));
  // Al volver a la app, se pide de nuevo mantener la pantalla encendida si está entrenando
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentActiveRoutine && !wakeLockActivo) pedirWakeLock(false);
  });
}

function mostrarVistaCliente(nombre) {
  if (!VISTAS_CLIENTE[nombre]) nombre = "hoy";
  Object.entries(VISTAS_CLIENTE).forEach(([k, v]) => {
    const el = $(v.el);
    if (el) el.classList.toggle("hidden", k !== nombre);
  });
  document.querySelectorAll("#clienteNav a").forEach(a => {
    const activo = a.dataset.vista === nombre;
    a.classList.toggle("activo", activo);
    if (activo) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.title = `ATLAS · ${VISTAS_CLIENTE[nombre].titulo}`;
  window.scrollTo(0, 0);
}

function renderCabeceraCliente(data) {
  const partes = String(data.nombre || "").trim().split(/\s+/).filter(Boolean);
  const iniciales = ((partes[0] || "")[0] || "") + ((partes[1] || "")[0] || "");
  const av = $("#avatarIniciales");
  if (av) av.textContent = (iniciales || "·").toUpperCase();
}

/* ----- Ayudas ----- */
// "3 × 10 · 17,5 kg" o, si cambia por serie, "3 × 10 · 40/60/60 kg"
function dosisEjercicio(e) {
  const num = (p) => (parseFloat(p) || 0).toLocaleString("es-VE", { maximumFractionDigits: 2 });
  const detalle = getSeriesDetalleArray(e);
  const pesos = detalle && detalle.length ? detalle.map(s => (s.peso !== undefined ? s.peso : e.peso_kg)) : [e.peso_kg];
  const iguales = pesos.every(p => Number(p) === Number(pesos[0]));
  const peso = iguales ? num(pesos[0]) : pesos.map(num).join("/");
  return `${e.series || 0} × ${e.repeticiones || 0} · ${peso} kg`;
}

// Fecha (YYYY-MM-DD) de la última sesión de cada rutina
function ultimaSesionPorRutina() {
  const mapa = {};
  ((currentUserData && currentUserData.sesiones) || []).forEach(s => {
    const id = Number(s.id_rutina);
    if (!mapa[id] || s.fecha > mapa[id]) mapa[id] = s.fecha;
  });
  return mapa;
}

function normalizarTexto(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIAS_ABREV = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

function diaSemanaHoy() {
  const [y, m, d] = getLocalTodayStr().split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

// ¿El horario de la rutina menciona el día de hoy? ("Martes y Jueves", "lun/mié/vie"...)
function rutinaTocaHoy(r, dia) {
  const h = normalizarTexto(r.horario);
  if (!h) return false;
  return new RegExp(`(^|[^a-z])(${DIAS_SEMANA[dia]}|${DIAS_ABREV[dia]})([^a-z]|$)`).test(h);
}

// Sugerencia: la que toca hoy según el horario; si no, la que hace más tiempo que no hace
function sugerirRutina(rutinas) {
  if (!rutinas.length) return null;
  const ultimas = ultimaSesionPorRutina();
  const masAntigua = (lista) => [...lista].sort((a, b) =>
    String(ultimas[Number(a.id_rutina)] || "").localeCompare(String(ultimas[Number(b.id_rutina)] || "")))[0];

  const hoy = rutinas.filter(r => rutinaTocaHoy(r, diaSemanaHoy()));
  if (hoy.length) return { rutina: masAntigua(hoy), motivo: "Te toca hoy según tu horario" };
  if (rutinas.length === 1) return { rutina: rutinas[0], motivo: "" };
  const r = masAntigua(rutinas);
  return { rutina: r, motivo: ultimas[Number(r.id_rutina)] ? "Es la que hace más tiempo que no haces" : "Aún no la has hecho" };
}

/* ----- Hoy ----- */
function renderHoy(data) {
  const f = $("#hoyFecha");
  if (f) f.textContent = fechaLargaHoy();
  const saludo = $("#userGreeting");
  if (saludo) saludo.textContent = `Hola, ${String(data.nombre || "").trim().split(/\s+/)[0] || ""}`;
  renderTarjetaMembresia(data);
  renderRutinaHoy(data);
  renderSemana(data.sesiones || []);
}

function renderTarjetaMembresia(data) {
  const st = estadoEntrada(data);
  const vence = data.membresia && data.membresia.vence;
  const inicio = data.membresia && data.membresia.inicio;

  const plan = $("#memPlan");
  if (plan) plan.textContent = data.ultimo_plan || "Membresía";

  const textosBadge = { activa: "Activa", por_vencer: "Por vencer", vencida: "Vencida", sin: "Sin membresía" };
  const clases = { activa: "badge-active", por_vencer: "badge-warning", vencida: "badge-expired", sin: "badge-expired" };
  const badge = $("#membershipStatus");
  if (badge) { badge.className = `badge ${clases[st.codigo]}`; badge.textContent = textosBadge[st.codigo]; }

  const num = $("#memDias"), txt = $("#memDiasTexto");
  const fecha = formatFechaCorta(vence);
  if (st.codigo === "sin") {
    num.textContent = "–";
    txt.textContent = "Acércate a recepción para activar tu plan";
  } else if (st.dias < 0) {
    num.textContent = "0";
    txt.textContent = `días restantes · venció el ${fecha}`;
  } else {
    num.textContent = st.dias;
    txt.textContent = st.dias === 0 ? `vence hoy (${fecha})` : `${st.dias === 1 ? "día restante" : "días restantes"} · vence ${fecha}`;
  }

  // Barra: días usados del plan actual (de la fecha de inicio a la de vencimiento)
  const barra = $("#memBarra"), fill = $("#memBarraFill");
  const total = (inicio && diasHasta(vence) !== null && diasHasta(inicio) !== null) ? diasHasta(vence) - diasHasta(inicio) : 0;
  if (!barra || total <= 0) { if (barra) barra.classList.add("hidden"); return; }
  const usados = Math.min(total, Math.max(0, -diasHasta(inicio)));
  barra.classList.remove("hidden");
  barra.setAttribute("aria-valuemax", total);
  barra.setAttribute("aria-valuenow", usados);
  fill.style.width = `${Math.round((usados / total) * 100)}%`;
  fill.className = "mem-barra-fill" + (st.codigo === "por_vencer" ? " warn" : st.codigo === "vencida" ? " danger" : "");
}

function renderRutinaHoy(data) {
  const box = $("#hoyRutina");
  if (!box) return;
  const rutinas = data.rutinas || [];

  // Entrenamiento a medias: se ofrece continuar
  let guardada = null;
  try { guardada = JSON.parse(localStorage.getItem("atlas_active_workout_session") || "null"); } catch (e) { guardada = null; }
  if (guardada && guardada.routine) {
    box.innerHTML = `
      <div class="kpi-label">Tienes un entrenamiento a medias</div>
      <h2 id="hoyRutinaTitulo" class="cliente-card-h">${esc(guardada.routine.titulo)}</h2>
      <button type="button" class="btn-primary btn-empezar" onclick="restoreActiveSessionIfAny()">${ICONO_PLAY}Continuar entrenamiento</button>`;
    return;
  }

  if (!rutinas.length) {
    box.innerHTML = `
      <div class="kpi-label">Tu rutina de hoy</div>
      <h2 id="hoyRutinaTitulo" class="cliente-card-h">Aún no tienes rutinas</h2>
      <p class="card-hint">Crea una o usa una de las rutinas sugeridas del gimnasio.</p>
      <button type="button" class="btn-primary btn-empezar" onclick="openNewRoutineModal()">+ Crear mi primera rutina</button>`;
    return;
  }

  const sugerida = sugerirRutina(rutinas);
  const elegida = rutinas.find(r => Number(r.id_rutina) === Number(rutinaElegidaId)) || sugerida.rutina;
  const motivo = elegida === sugerida.rutina ? sugerida.motivo : "Elegida por ti";
  const ejercicios = elegida.ejercicios || [];
  const minutos = Math.max(10, Math.round(ejercicios.reduce((t, e) => t + (parseInt(e.series) || 3), 0) * 2.5));
  const id = Number(elegida.id_rutina);

  box.innerHTML = `
    <div class="kpi-label">Tu rutina de hoy</div>
    <h2 id="hoyRutinaTitulo" class="cliente-card-h">${esc(elegida.titulo)}</h2>
    <div class="card-hint">${ejercicios.length} ${ejercicios.length === 1 ? "ejercicio" : "ejercicios"} · unos ${minutos} min${motivo ? ` · ${esc(motivo)}` : ""}</div>
    <ul class="ejercicios-lista" id="hoyEjercicios">
      ${ejercicios.map((e, i) => `<li class="${i >= 3 ? "extra hidden" : ""}"><span>${esc(e.nombre_ejercicio)}</span><span class="ej-dosis">${esc(dosisEjercicio(e))}</span></li>`).join("")}
    </ul>
    ${ejercicios.length > 3 ? `<button type="button" class="link-btn" id="hoyVerTodos" aria-expanded="false" onclick="toggleEjerciciosHoy()">Ver los ${ejercicios.length} ejercicios</button>` : ""}
    ${rutinas.length > 1 ? `
      <label for="hoyCambiarRutina" class="form-label" style="margin-top: 12px;">Cambiar rutina</label>
      <select id="hoyCambiarRutina" class="form-input" onchange="elegirRutinaHoy(this.value)">
        ${rutinas.map(r => `<option value="${Number(r.id_rutina)}"${Number(r.id_rutina) === id ? " selected" : ""}>${esc(r.titulo)}${r === sugerida.rutina ? " (sugerida)" : ""}</option>`).join("")}
      </select>` : ""}
    <button type="button" class="btn-primary btn-empezar" onclick="startWorkoutSession(${id})">${ICONO_PLAY}Empezar entrenamiento</button>`;
}

const ICONO_PLAY = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>`;

function toggleEjerciciosHoy() {
  const btn = $("#hoyVerTodos");
  const abrir = btn && btn.getAttribute("aria-expanded") !== "true";
  document.querySelectorAll("#hoyEjercicios .extra").forEach(li => li.classList.toggle("hidden", !abrir));
  if (btn) {
    btn.setAttribute("aria-expanded", abrir ? "true" : "false");
    btn.textContent = abrir ? "Ver menos" : `Ver los ${document.querySelectorAll("#hoyEjercicios li").length} ejercicios`;
  }
}

function elegirRutinaHoy(id) {
  rutinaElegidaId = Number(id);
  if (currentUserData) renderRutinaHoy(currentUserData);
  const sel = $("#hoyCambiarRutina");
  if (sel) sel.focus();
}

// Semana de lunes a domingo, marcando los días con al menos una sesión
function renderSemana(sesiones) {
  const box = $("#semanaDias"), total = $("#semanaTotal");
  if (!box) return;
  const hoy = getLocalTodayStr();
  const dia = diaSemanaHoy();
  const lunes = sumarDias(hoy, -((dia + 6) % 7));
  const nombres = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const fechas = nombres.map((_, i) => sumarDias(lunes, i));
  const conSesion = new Set(sesiones.map(s => s.fecha));
  const cantidad = sesiones.filter(s => s.fecha >= fechas[0] && s.fecha <= fechas[6]).length;
  if (total) total.textContent = `${cantidad} ${cantidad === 1 ? "entrenamiento" : "entrenamientos"}`;

  box.innerHTML = fechas.map((f, i) => {
    const entreno = conSesion.has(f);
    const esHoy = f === hoy;
    const estado = entreno ? "entrenaste" : (f > hoy ? "pendiente" : "sin entrenar");
    return `<div class="semana-dia${esHoy ? " hoy" : ""}" aria-label="${nombres[i]} ${Number(f.slice(8))}: ${estado}${esHoy ? " (hoy)" : ""}" role="img">
      <span aria-hidden="true">${nombres[i][0]}</span>
      <span class="semana-punto${entreno ? " lleno" : ""}" aria-hidden="true"></span>
    </div>`;
  }).join("");
}

/* ----- Progreso ----- */
function renderProgreso(sesiones) {
  const resumen = $("#progresoResumen"), lista = $("#progresoLista");
  if (!resumen || !lista) return;
  const hoy = getLocalTodayStr();
  const mes = hoy.slice(0, 7);
  const delMes = sesiones.filter(s => String(s.fecha).startsWith(mes)).length;
  const hace30 = sumarDias(hoy, -29);
  const ult30 = sesiones.filter(s => s.fecha >= hace30).length;
  const ultima = sesiones[0];

  resumen.innerHTML = `
    <div class="kpi"><div class="kpi-label">Este mes</div><div class="kpi-value">${delMes}</div><div class="kpi-note">entrenamientos</div></div>
    <div class="kpi"><div class="kpi-label">Últimos 30 días</div><div class="kpi-value">${ult30}</div><div class="kpi-note">entrenamientos</div></div>
    <div class="kpi kpi-ancho"><div class="kpi-label">Último entrenamiento</div>
      <div class="kpi-note">${ultima ? `${esc(fechaCortaConDia(ultima.fecha))} · ${esc(ultima.rutina || "Rutina")}` : "Todavía no has registrado ninguno"}</div></div>`;

  if (!sesiones.length) {
    lista.innerHTML = `<div class="cliente-card vacio"><p>Cuando termines un entrenamiento, aparecerá aquí.</p>
      <a href="#hoy" class="btn-primary">Ir a mi rutina de hoy</a></div>`;
    return;
  }

  // Agrupar por mes
  const grupos = {};
  sesiones.forEach(s => { (grupos[String(s.fecha).slice(0, 7)] = grupos[String(s.fecha).slice(0, 7)] || []).push(s); });
  lista.innerHTML = Object.keys(grupos).sort().reverse().map(m => {
    const titulo = nombreMes(m);
    return `<section class="progreso-mes" aria-label="${esc(titulo)}">
      <h2 class="progreso-mes-titulo">${esc(titulo.charAt(0).toUpperCase() + titulo.slice(1))} <span class="card-hint">· ${grupos[m].length}</span></h2>
      <div class="cliente-card lista-sesiones">
        ${grupos[m].map(s => {
          const pct = s.series_totales ? Math.round((s.series_completadas / s.series_totales) * 100) : 0;
          return `<div class="sesion-item">
            <div class="sesion-fecha"><strong>${esc(fechaCortaConDia(s.fecha))}</strong><span class="card-hint">${esc(s.hora || "")}</span></div>
            <div class="sesion-main">
              <strong>${esc(s.rutina || "Rutina")}</strong>
              <span class="card-hint">${s.series_completadas} de ${s.series_totales} series</span>
              <div class="mini-barra" aria-hidden="true"><div style="width: ${pct}%"></div></div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </section>`;
  }).join("");
}

function fechaCortaConDia(fechaStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr || "")) return "-";
  const [y, m, d] = fechaStr.split("-").map(Number);
  const dia = new Date(y, m - 1, d).toLocaleDateString("es-VE", { weekday: "short" }).replace(".", "");
  return `${dia.charAt(0).toUpperCase() + dia.slice(1)} ${d}/${m}`;
}

/* ----- Mi plan ----- */
function renderMiPlan(data) {
  const st = estadoEntrada(data);
  const mem = $("#planMembresia"), datos = $("#planDatos");
  const estados = { activa: ["Activa", "estado-ok"], por_vencer: ["Por vencer", "estado-warn"], vencida: ["Vencida", "estado-danger"], sin: ["Sin membresía", "estado-danger"] };
  const [txt, cls] = estados[st.codigo];
  if (mem) {
    mem.innerHTML = `
      <dt>Plan</dt><dd>${esc(data.ultimo_plan || "Sin plan registrado")}</dd>
      <dt>Estado</dt><dd class="${cls}">${esc(txt)}</dd>
      <dt>Desde</dt><dd>${esc(formatFechaCorta(data.membresia.inicio))}</dd>
      <dt>Vence</dt><dd>${esc(formatFechaCorta(data.membresia.vence))}${st.dias !== null ? ` · ${esc(textoDias(st.dias))}` : ""}</dd>`;
  }
  if (datos) {
    datos.innerHTML = `
      <dt>Nombre</dt><dd>${esc(data.nombre)}</dd>
      <dt>Correo</dt><dd>${esc(data.correo || "Sin correo")}</dd>
      <dt>Teléfono</dt><dd>${esc(data.telefono || "Sin teléfono")}</dd>`;
  }
}

/* ----- Modo entrenamiento: pantalla completa y pantalla encendida ----- */
let wakeLockActivo = null;
let avisoWakeLockMostrado = false;

function entrarModoEntreno() {
  const sec = $("#activeSessionSection");
  if (!sec) return;
  sec.classList.remove("hidden");
  document.body.classList.add("entrenando");
  pedirWakeLock(true);
  const titulo = $("#sessionRoutineTitle");
  if (titulo) { titulo.setAttribute("tabindex", "-1"); titulo.focus({ preventScroll: true }); }
}

function salirModoEntreno() {
  const sec = $("#activeSessionSection");
  if (sec) sec.classList.add("hidden");
  document.body.classList.remove("entrenando");
  const badge = $("#restoredSessionBadge");
  if (badge) badge.classList.add("hidden");
  soltarWakeLock();
}

async function pedirWakeLock(avisar) {
  const estado = $("#wakeLockEstado");
  if (!("wakeLock" in navigator)) {
    if (estado) estado.textContent = "Tu teléfono no permite mantener la pantalla encendida desde la web.";
    if (avisar && !avisoWakeLockMostrado) {
      avisoWakeLockMostrado = true;
      showToast("Tu teléfono no permite mantener la pantalla encendida; puede que se apague entre series.", "aviso");
    }
    return;
  }
  try {
    wakeLockActivo = await navigator.wakeLock.request("screen");
    if (estado) estado.textContent = "La pantalla se mantendrá encendida mientras entrenas.";
    wakeLockActivo.addEventListener("release", () => { wakeLockActivo = null; });
  } catch (e) {
    wakeLockActivo = null;
    if (estado) estado.textContent = "No se pudo mantener la pantalla encendida (por ejemplo, con el ahorro de batería activo).";
  }
}

function soltarWakeLock() {
  if (wakeLockActivo) {
    wakeLockActivo.release().catch(() => {});
    wakeLockActivo = null;
  }
}

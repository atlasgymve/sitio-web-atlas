// script.js – Lógica Frontend ATLAS (Login, Registro, Rutinas e Interacción de Entrenamiento)

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ? "http://localhost:3000/api"
  : `${window.location.origin}/api`;
let currentUserData = null;
let currentActiveRoutine = null;
let completedSetsState = {}; // { "ex_0_set_0": true, ... }
let editingRoutineId = null;

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
      localStorage.setItem("token", data.id_usuario);
      localStorage.setItem("nombre", data.nombre);
      localStorage.setItem("esAdmin", data.esAdmin ? "true" : "false");

      if (data.esAdmin) {
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
        alert(err.message);
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

  const esAdmin = localStorage.getItem("esAdmin");
  const adminBtn = $("#adminPanelBtn");
  if (adminBtn) {
    if (esAdmin === "true") {
      adminBtn.classList.remove("hidden");
    } else {
      adminBtn.classList.add("hidden");
    }
  }

  fetch(`${API_BASE}/usuario/${token}`)
    .then(r => r.json())
    .then(data => {
      currentUserData = data;
      $("#userGreeting").textContent = `¡Hola, ${data.nombre}!`;

      const memBadge = $("#membershipStatus");
      memBadge.textContent = `Membresía ${data.membresia.estado} (Vence: ${data.membresia.vence})`;

      renderRoutinesGrid(data.rutinas || []);
      restoreActiveSessionIfAny();
    })
    .catch(err => {
      console.error("Error al cargar dashboard:", err);
    });
}

function renderRoutinesGrid(rutinas) {
  const grid = $("#routinesGrid");
  grid.innerHTML = "";

  if (rutinas.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: rgba(30,41,59,0.4); border-radius: 16px; border: 1px dashed var(--border-light);">
        <p style="font-size: 1.1rem; color: var(--text-muted); margin-bottom: 1rem;">Aún no tienes rutinas registradas.</p>
        <button class="btn-primary" onclick="openNewRoutineModal()" style="width: auto; margin: 0 auto;">
          + Crear Tu Primera Rutina
        </button>
      </div>
    `;
    return;
  }

  rutinas.forEach(r => {
    const card = document.createElement("div");
    card.className = "routine-card";

    const cantEjercicios = r.ejercicios ? r.ejercicios.length : 0;
    const listaEjerciciosNombres = r.ejercicios && r.ejercicios.length > 0
      ? r.ejercicios.map(e => `• ${e.nombre_ejercicio} (${e.series}x${e.repeticiones} - ${formatExerciseWeights(e)})`).join("<br>")
      : "Sin ejercicios aún";

    card.innerHTML = `
      <div>
        <h3 class="routine-title">${r.titulo}</h3>
        <p class="routine-desc">${r.descripcion || "Sin descripción"}</p>
        
        <div style="background: rgba(15,23,42,0.5); padding: 0.8rem; border-radius: 8px; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
          <strong style="color: #60A5FA;">Ejercicios incluidos (${cantEjercicios}):</strong><br>
          <div style="margin-top: 0.4rem; line-height: 1.4;">${listaEjerciciosNombres}</div>
        </div>
      </div>

      <div>
        <div class="routine-meta">
          <span>Horario: ${r.horario || "Flexible"}</span>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn-primary" onclick="startWorkoutSession(${r.id_rutina})" style="font-size: 0.85rem; padding: 0.6rem 1rem;">
            Iniciar Rutina
          </button>
          <button class="btn-secondary" onclick="editRoutine(${r.id_rutina})" title="Editar rutina" style="padding: 0.6rem 1rem; font-size: 0.85rem;">
            Editar
          </button>
          <button class="btn-danger" onclick="deleteRoutine(${r.id_rutina})" title="Eliminar rutina" style="padding: 0.6rem 1rem; font-size: 0.85rem;">
            Eliminar
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
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
  card.style.cssText = "background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-light); border-radius: 12px; padding: 1rem; position: relative; margin-bottom: 0.8rem;";

  card.innerHTML = `
    <button type="button" onclick="this.closest('.exercise-input-card').remove()" title="Eliminar ejercicio" style="position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(239, 68, 68, 0.2); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; width: 28px; height: 28px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center;">X</button>
    
    <div style="margin-bottom: 0.8rem; padding-right: 2rem;">
      <label class="form-label" style="font-size: 0.8rem; color: #60A5FA; margin-bottom: 0.3rem; font-weight: 600;">Nombre del Ejercicio</label>
      <input type="text" class="form-input ex-name" placeholder="Ej: Press de Banca" value="${nombre}" required style="padding: 0.5rem 0.8rem; font-size: 0.9rem;">
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.8rem;">
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Series</label>
        <input type="number" class="form-input ex-series" placeholder="3" value="${series}" min="1" required style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Reps</label>
        <input type="number" class="form-input ex-reps" placeholder="10" value="${reps}" min="1" required style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Peso (kg)</label>
        <input type="number" step="0.5" class="form-input ex-peso" placeholder="0" value="${peso}" min="0" style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
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
    body: JSON.stringify({ id_usuario: token, titulo, descripcion, horario, ejercicios })
  })
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        closeNewRoutineModal();
        loadDashboard();
      } else {
        alert(res.msg || "Error al guardar rutina");
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

  fetch(`${API_BASE}/usuario/${token}`)
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

  $("#sessionRoutineTitle").textContent = routine.titulo;
  $("#sessionRoutineDesc").textContent = routine.descripcion || "Ejecución de rutina serie a serie";

  const exercisesContainer = $("#sessionExercisesList");
  exercisesContainer.innerHTML = "";

  let totalSetsInRoutine = 0;

  routine.ejercicios.forEach((ej, exIdx) => {
    const block = document.createElement("div");
    block.className = "exercise-block";

    let setsHtml = "";
    const cantSeries = parseInt(ej.series) || 3;
    const seriesDetalle = getSeriesDetalleArray(ej);

    for (let s = 0; s < cantSeries; s++) {
      totalSetsInRoutine++;
      const setId = `ex_${exIdx}_set_${s}`;
      const isCompleted = !!completedSetsState[setId];

      let setWeight = ej.peso_kg || 0;
      let setReps = ej.repeticiones || 10;

      if (seriesDetalle && seriesDetalle[s]) {
        if (seriesDetalle[s].peso !== undefined) setWeight = seriesDetalle[s].peso;
        if (seriesDetalle[s].reps !== undefined) setReps = seriesDetalle[s].reps;
      }

      if (restoredState && restoredState.inputs) {
        if (restoredState.inputs[`ex_${exIdx}_set_${s}_weight`] !== undefined) {
          setWeight = restoredState.inputs[`ex_${exIdx}_set_${s}_weight`];
        }
        if (restoredState.inputs[`ex_${exIdx}_set_${s}_reps`] !== undefined) {
          setReps = restoredState.inputs[`ex_${exIdx}_set_${s}_reps`];
        }
      }

      setsHtml += `
        <tr>
          <td style="font-weight: 600; color: var(--text-muted);">Serie ${s + 1}</td>
          <td>
            <input type="number" step="0.5" class="set-input set-weight-input" data-ex="${exIdx}" data-set="${s}" value="${setWeight}" oninput="saveActiveSessionState()"> kg
          </td>
          <td>
            <input type="number" class="set-input set-reps-input" data-ex="${exIdx}" data-set="${s}" value="${setReps}" oninput="saveActiveSessionState()"> reps
          </td>
          <td>
            <button type="button" class="btn-check-set ${isCompleted ? 'completed' : ''}" id="btn_set_${setId}" onclick="toggleSetCompleted('${setId}')">
              ✓
            </button>
          </td>
        </tr>
      `;
    }

    block.innerHTML = `
      <div class="exercise-header">
        <span class="exercise-name">${ej.nombre_ejercicio || ej.titulo || "Ejercicio"}</span>
        <span style="font-size: 0.85rem; color: var(--text-muted);">${ej.series} Series × ${ej.repeticiones} Reps (${formatExerciseWeights(ej)})</span>
      </div>
      <table class="sets-table">
        <thead>
          <tr>
            <th>Serie</th>
            <th>Peso Usado</th>
            <th>Repeticiones</th>
            <th>Culminada</th>
          </tr>
        </thead>
        <tbody>
          ${setsHtml}
        </tbody>
      </table>
    `;
    exercisesContainer.appendChild(block);
  });

  updateSessionProgressBar(totalSetsInRoutine);
  $("#activeSessionSection").classList.remove("hidden");
  saveActiveSessionState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleSetCompleted(setId) {
  const btn = $(`#btn_set_${setId}`);
  if (!btn) return;

  if (completedSetsState[setId]) {
    delete completedSetsState[setId];
    btn.classList.remove("completed");
  } else {
    completedSetsState[setId] = true;
    btn.classList.add("completed");
  }

  // Recalcular progreso
  const totalSets = document.querySelectorAll(".btn-check-set").length;
  updateSessionProgressBar(totalSets);

  // Guardar estado en localStorage
  saveActiveSessionState();
}

function updateSessionProgressBar(totalSets) {
  const completedCount = Object.keys(completedSetsState).length;
  const percentage = totalSets > 0 ? Math.round((completedCount / totalSets) * 100) : 0;

  const fill = $("#sessionProgressFill");
  const text = $("#sessionProgressText");

  fill.style.width = `${percentage}%`;
  text.textContent = `${completedCount} de ${totalSets} series completadas (${percentage}%)`;
}

function cancelSession() {
  if (confirm("¿Deseas cancelar la sesión activa de hoy?")) {
    $("#activeSessionSection").classList.add("hidden");
    currentActiveRoutine = null;
    completedSetsState = {};
    localStorage.removeItem("atlas_active_workout_session");
  }
}

function finishWorkoutSession() {
  if (!currentActiveRoutine) return;

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
      id_usuario: token,
      id_rutina: currentActiveRoutine.id_rutina,
      detalle_json: sessionDetail,
      ejercicios_actualizados: ejerciciosActualizados
    })
  })
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        alert("Tu entrenamiento ha sido guardado y registrado exitosamente.");
        localStorage.removeItem("atlas_active_workout_session");
        $("#activeSessionSection").classList.add("hidden");
        currentActiveRoutine = null;
        completedSetsState = {};
        loadDashboard();
      } else {
        alert(res.msg || "Error al guardar sesión");
      }
    })
    .catch(err => console.error(err));
}

/* ---------- PANEL DE ADMINISTRACIÓN ---------- */
let adminUsersData = [];
let editingAdminUserId = null;

function initAdminDashboard() {
  const token = localStorage.getItem("token");
  const esAdmin = localStorage.getItem("esAdmin");

  if (!token || esAdmin !== "true") {
    window.location.href = "index.html";
    return;
  }

  fetch(`${API_BASE}/admin/usuarios`)
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        adminUsersData = res.usuarios || [];
        filterAdminUsers();
      } else {
        alert(res.msg || "Error al cargar datos de administración");
      }
    })
    .catch(err => console.error("Error al cargar panel admin:", err));
}

function toggleAdminClientsSection() {
  const clientsSection = $("#adminClientsSection");
  const paymentsSection = $("#adminPaymentsSection");
  if (!clientsSection) return;

  if (clientsSection.classList.contains("hidden")) {
    if (paymentsSection) paymentsSection.classList.add("hidden");
    clientsSection.classList.remove("hidden");
    filterAdminUsers();
    clientsSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    clientsSection.classList.add("hidden");
  }
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
      borderColor: "#EF4444",
      badgeClass: "badge-expired",
      badgeText: vence < todayStr ? "vencida" : (user.membresia ? user.membresia.estado : "inactiva"),
      venceColor: "#FCA5A5"
    };
  } else if (vence <= future5Str) {
    return {
      borderColor: "#F59E0B",
      badgeClass: "badge-warning",
      badgeText: "por vencer",
      venceColor: "#FCD34D"
    };
  } else {
    return {
      borderColor: "#10B981",
      badgeClass: "badge-active",
      badgeText: "activa",
      venceColor: "#34D399"
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
    card.style.background = 'rgba(30, 41, 59, 0.85)';
  } else {
    details.classList.add('hidden');
    if (chevron) {
      chevron.textContent = '▼ Ver más';
    }
    card.style.background = 'rgba(15, 23, 42, 0.6)';
  }
}

function renderAdminUsersGrid(users) {
  const grid = $("#adminUsersGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (users.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: rgba(30,41,59,0.4); border-radius: 16px; border: 1px dashed var(--border-light);">
        <p style="font-size: 1.1rem; color: var(--text-muted); margin-bottom: 1rem;">No hay clientes registrados aún.</p>
        <button class="btn-primary" onclick="openCreateUserModal()" style="width: auto; margin: 0 auto;">
          + Registrar Primer Cliente
        </button>
      </div>
    `;
    return;
  }

  users.forEach(u => {
    const status = getClientStatusInfo(u);
    const card = document.createElement("div");
    card.className = "routine-card";
    card.style.cssText = `padding: 1.25rem; transition: all 0.2s ease; background: rgba(15, 23, 42, 0.6); border-left: 4px solid ${status.borderColor};`;

    const cantRutinas = u.rutinas ? u.rutinas.length : 0;

    card.innerHTML = `
      <!-- Encabezado de la Tarjeta (Resumen siempre visible, click para expandir) -->
      <div class="client-card-header" onclick="toggleClientCardDetails(this)" style="cursor: pointer; user-select: none;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.6rem;">
          <h3 class="routine-title" style="margin: 0; font-size: 1.15rem; color: var(--text-main); font-weight: 700;">${u.nombre_completo}</h3>
          <span class="badge ${status.badgeClass}">${status.badgeText}</span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.83rem; color: var(--text-muted);">
          <span>⏳ Vence: <strong style="color: ${status.venceColor};">${u.membresia.vence}</strong></span>
          <span class="accordion-chevron" style="color: #60A5FA; font-weight: 600; font-size: 0.78rem; background: rgba(59,130,246,0.15); padding: 0.2rem 0.55rem; border-radius: 6px; transition: all 0.2s ease;">▼ Ver más</span>
        </div>
      </div>

      <!-- Detalle desplegable (Oculto por defecto) -->
      <div class="client-card-details hidden" style="margin-top: 0.9rem; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 0.9rem;">
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.3rem;">✉️ <strong style="color: var(--text-main);">Correo:</strong> ${u.correo}</p>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">📞 <strong style="color: var(--text-main);">Teléfono:</strong> ${u.telefono || "Sin teléfono"}</p>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem; background: rgba(15,23,42,0.5); padding: 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.04);">
          <div>
            <span style="display: block; font-size: 0.75rem; color: var(--text-muted);"> Vencimiento:</span>
            <strong style="font-size: 0.85rem; color: ${status.venceColor};">${u.membresia.vence}</strong>
          </div>
          <div>
            <span style="display: block; font-size: 0.75rem; color: var(--text-muted);"> Último Pago:</span>
            <strong style="font-size: 0.85rem; color: #34D399;">${u.ultimo_pago || 'Sin pagos'}</strong>
          </div>
        </div>

        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">🏋️ <strong style="color: #60A5FA;">Rutinas Asignadas:</strong> ${cantRutinas}</p>

        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button class="btn-primary" onclick="event.stopPropagation(); openRegisterPaymentModal(${u.id_usuario})" style="font-size: 0.82rem; padding: 0.5rem 0.75rem; background: linear-gradient(135deg, #10B981 0%, #059669 100%);">
            Registrar Pago
          </button>
          <button class="btn-primary" onclick="event.stopPropagation(); sendWhatsAppReminder('${u.nombre_completo}', '${u.telefono || ''}', '${u.membresia.vence}', '${u.membresia.estado}')" style="font-size: 0.82rem; padding: 0.5rem 0.75rem; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); border: none;">
            Recordar WhatsApp
          </button>
          <button class="btn-primary" onclick="event.stopPropagation(); viewUserProgressModal(${u.id_usuario})" style="font-size: 0.82rem; padding: 0.5rem 0.75rem;">
            Ver Rutinas
          </button>
          <button class="btn-secondary" onclick="event.stopPropagation(); editUserByAdmin(${u.id_usuario})" title="Editar datos del cliente" style="font-size: 0.82rem; padding: 0.5rem 0.75rem;">
            Editar
          </button>
          <button class="btn-danger" onclick="event.stopPropagation(); deleteUserByAdmin(${u.id_usuario})" title="Eliminar cliente" style="padding: 0.5rem 0.75rem; font-size: 0.82rem;">
            Eliminar
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function filterAdminUsers() {
  const queryInput = $("#searchUserFilter");
  const query = queryInput ? queryInput.value.toLowerCase().trim() : "";

  const statusSelect = $("#clientStatusFilterSelect");
  const statusFilter = statusSelect ? statusSelect.value : "todos";

  const todayStr = getLocalTodayStr();
  let list = [...adminUsersData];

  // 1. Filtrar por texto si hay consulta
  if (query) {
    list = list.filter(u =>
      u.nombre_completo.toLowerCase().includes(query) ||
      u.correo.toLowerCase().includes(query) ||
      (u.telefono && u.telefono.toLowerCase().includes(query))
    );
  }

  // 2. Filtrar por estado y aplicar ordenamiento
  if (statusFilter === "proximos") {
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
  $("#newClientTelefono").value = user.telefono || "";

  const modal = $("#createUserModal");
  if (modal) modal.classList.remove("hidden");
}

function saveNewUser(event) {
  event.preventDefault();
  const nombre_completo = $("#newClientNombre").value.trim();
  const correo = $("#newClientEmail").value.trim();
  const telefono = $("#newClientTelefono").value.trim();

  const url = editingAdminUserId ? `${API_BASE}/admin/usuarios/${editingAdminUserId}` : `${API_BASE}/admin/usuarios`;
  const method = editingAdminUserId ? "PUT" : "POST";

  fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre_completo, correo, telefono })
  })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.msg || "Error al procesar solicitud de cliente");
      return data;
    })
    .then(res => {
      const msg = editingAdminUserId ? "¡Datos del cliente actualizados exitosamente!" : "¡Cliente registrado exitosamente!";
      alert(msg);
      closeCreateUserModal();
      initAdminDashboard();
      if (!$("#adminClientsSection").classList.contains("hidden")) {
        renderAdminUsersGrid(adminUsersData);
      }
    })
    .catch(err => alert(err.message));
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
      alert("¡Cliente eliminado exitosamente!");
      closeConfirmDeleteModal();
      initAdminDashboard();
      adminUsersData = adminUsersData.filter(u => u.id_usuario !== pendingDeleteUserId);
      renderAdminUsersGrid(adminUsersData);
    })
    .catch(err => alert(err.message));
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
      item.style.cssText = "background: rgba(15,23,42,0.6); padding: 1rem; border-radius: 12px; border: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;";

      const exList = r.ejercicios && r.ejercicios.length > 0
        ? r.ejercicios.map(e => `• ${e.nombre_ejercicio || e.titulo} (${e.series} series x ${e.repeticiones} reps - ${formatExerciseWeights(e)})`).join("<br>")
        : "Sin ejercicios";

      item.innerHTML = `
        <div>
          <h5 style="font-size: 1.05rem; font-weight: 700; color: #60A5FA;">${r.titulo}</h5>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">${r.descripcion || "Sin descripción"} | Horario: ${r.horario || "Flexible"}</p>
          <div style="font-size: 0.85rem; color: var(--text-main); line-height: 1.4;">${exList}</div>
        </div>
        <button type="button" class="btn-primary" onclick="inspectRoutineDetailByAdmin(${id_usuario}, ${r.id_rutina})" style="font-size: 0.85rem; padding: 0.6rem 1rem; width: auto; white-space: nowrap;">
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
            <td style="font-weight: 600; color: var(--text-muted);">Serie ${s + 1}</td>
            <td>
              <span style="font-size: 1rem; font-weight: 700; color: #60A5FA;">${setWeight} kg</span>
            </td>
            <td>
              <span style="font-size: 1rem; font-weight: 700; color: var(--text-main);">${setReps} reps</span>
            </td>
          </tr>
        `;
      }

      block.innerHTML = `
        <div class="exercise-header">
          <span class="exercise-name">${ej.nombre_ejercicio || ej.titulo || "Ejercicio"}</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">${ej.series} Series × ${ej.repeticiones} Reps (${formatExerciseWeights(ej)})</span>
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
    item.onmouseover = () => item.style.background = "rgba(30, 41, 59, 0.8)";
    item.onmouseout = () => item.style.background = "transparent";

    const venceStr = (u.membresia && u.membresia.vence) ? u.membresia.vence : 'Sin fecha';
    const estadoBadge = (u.membresia && u.membresia.estado === 'activa') ? '🟢 Activa' : '🔴 Vencida';

    item.innerHTML = `
      <div style="font-weight: 600; color: var(--text-main); font-size: 0.9rem;">${u.nombre_completo}</div>
      <div style="font-size: 0.8rem; color: #60A5FA;">✉️ ${u.correo} • <span style="color: var(--text-muted);">📞 ${u.telefono || 'Sin tel'}</span></div>
      <div style="font-size: 0.8rem; color: #34D399; margin-top: 0.2rem;">📅 Membresía Vence: <strong>${venceStr}</strong> (${estadoBadge})</div>
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
  const estadoColor = estadoStr === 'activa' ? '#34D399' : '#F87171';

  if (badgeText) {
    badgeText.innerHTML = `
      <div style="line-height: 1.5;">
        <strong style="font-size: 1rem; color: var(--text-main);">${user.nombre_completo}</strong>
        <span style="font-size: 0.82rem; color: #60A5FA; display: block;">✉️ ${user.correo} • 📞 ${user.telefono || 'Sin teléfono'}</span>
        <span style="font-size: 0.85rem; color: ${estadoColor}; font-weight: 600; margin-top: 0.3rem; display: inline-block;">
          📅 Membresía Vence: <strong>${venceStr}</strong> (${estadoStr})
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
    alert("Por favor selecciona un cliente de la lista de sugerencias.");
    return;
  }

  const moneda = $("#paymentMoneda").value;
  const monto = $("#paymentMonto").value;
  const plan = $("#paymentPlan").value;
  const fecha_pago = $("#paymentFecha").value;

  fetch(`${API_BASE}/admin/pagos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_usuario: selectedPaymentUserId,
      monto,
      moneda,
      plan,
      fecha_pago
    })
  })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.msg || "Error al registrar pago");
      return data;
    })
    .then(res => {
      alert("¡Pago registrado exitosamente! La membresía del cliente ha sido actualizada.");
      closeRegisterPaymentModal();
      initAdminDashboard();
      if (!$("#adminClientsSection").classList.contains("hidden")) {
        renderAdminUsersGrid(adminUsersData);
      }
      if (!$("#adminPaymentsSection").classList.contains("hidden")) {
        loadAdminPaymentsHistory();
      }
    })
    .catch(err => alert(err.message));
}

let currentPaymentsData = [];

function toggleAdminPaymentsSection() {
  const clientsSection = $("#adminClientsSection");
  const paymentsSection = $("#adminPaymentsSection");
  if (!paymentsSection) return;

  if (paymentsSection.classList.contains("hidden")) {
    if (clientsSection) clientsSection.classList.add("hidden");
    paymentsSection.classList.remove("hidden");
    const today = getLocalTodayStr();
    loadAdminPaymentsHistory(today);
    paymentsSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    paymentsSection.classList.add("hidden");
  }
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
  const dateObj = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return getLocalTodayStr();
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function loadAdminPaymentsHistory(targetDate = null, searchQuery = null) {
  const container = $("#adminPaymentsList");
  if (!container) return;

  let url = `${API_BASE}/admin/pagos`;
  let emptyMsg = "";

  if (searchQuery && searchQuery.trim() !== "") {
    url += `?q=${encodeURIComponent(searchQuery.trim())}`;
    emptyMsg = `No se encontraron pagos registrados para el cliente "${searchQuery}".`;
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
    emptyMsg = `No se registraron pagos en la fecha seleccionada (${selectedDate}).`;
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
      const totales = res.totales || { USD: "0.00", COP: "0.00", BS: "0.00" };
      if ($("#totalUsdSummary")) $("#totalUsdSummary").textContent = `$${totales.USD} USD`;
      if ($("#totalCopSummary")) $("#totalCopSummary").textContent = `$${totales.COP} COP`;
      if ($("#totalBsSummary")) $("#totalBsSummary").textContent = `$${totales.BS} BS`;

      container.innerHTML = "";

      if (currentPaymentsData.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; background: rgba(30,41,59,0.3); border-radius: 12px; border: 1px dashed var(--border-light);">
            <p style="color: var(--text-muted); font-size: 0.95rem;">${emptyMsg}</p>
          </div>
        `;
        return;
      }

      currentPaymentsData.forEach(p => {
        const item = document.createElement("div");
        item.style.cssText = "background: rgba(15,23,42,0.6); padding: 0.9rem 1.2rem; border-radius: 10px; border: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.8rem; transition: transform 0.2s ease;";

        item.innerHTML = `
          <div>
            <strong style="color: var(--text-main); font-size: 1rem;">${p.nombre_completo}</strong> 
            <span style="font-size: 0.8rem; color: #60A5FA;">(✉️ ${p.correo} • 📞 ${p.telefono || 'Sin tel'})</span><br>
            <span style="font-size: 0.82rem; color: var(--text-muted);">
              Plan: <strong style="color: var(--text-main);">${p.plan}</strong> | Fecha de Pago: <strong>${p.fecha_pago}</strong>
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.95rem; font-weight: 700; padding: 0.4rem 0.8rem;">
              +${p.monto} ${p.moneda}
            </span>
            <button type="button" class="btn-secondary" onclick="inspectPaymentDetail(${p.id_pago})" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">
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

/* ---------- ENVÍO DE RECORDATORIOS WHATSAPP SIN EMOJIS ---------- */
function sendWhatsAppReminder(nombreCompleto, telefono, venceDate, estado) {
  if (!telefono || telefono.trim() === "" || telefono.trim() === "Sin teléfono") {
    alert("El cliente no tiene un número de teléfono registrado. Puedes agregar uno editando sus datos.");
    return;
  }

  const cleanPhone = telefono.replace(/[^0-9]/g, "");
  if (!cleanPhone) {
    alert("El número de teléfono registrado no es válido.");
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
    alert("Por favor selecciona ambas fechas del rango.");
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

      const totales = res.totales || { USD: "0.00", COP: "0.00", BS: "0.00" };
      if ($("#totalUsdSummary")) $("#totalUsdSummary").textContent = `$${totales.USD} USD`;
      if ($("#totalCopSummary")) $("#totalCopSummary").textContent = `$${totales.COP} COP`;
      if ($("#totalBsSummary")) $("#totalBsSummary").textContent = `$${totales.BS} BS`;

      container.innerHTML = "";

      if (currentPaymentsData.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; background: rgba(30,41,59,0.3); border-radius: 12px; border: 1px dashed var(--border-light);">
            <p style="color: var(--text-muted); font-size: 0.95rem;">No se registraron pagos en el rango seleccionado (${from} a ${to}).</p>
          </div>
        `;
        return;
      }

      currentPaymentsData.forEach(p => {
        const item = document.createElement("div");
        item.style.cssText = "background: rgba(15,23,42,0.6); padding: 0.9rem 1.2rem; border-radius: 10px; border: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.8rem;";

        item.innerHTML = `
          <div>
            <strong style="color: var(--text-main); font-size: 1rem;">${p.nombre_completo}</strong> 
            <span style="font-size: 0.8rem; color: #60A5FA;">(${p.correo} • Tel: ${p.telefono || 'Sin tel'})</span><br>
            <span style="font-size: 0.82rem; color: var(--text-muted);">
              Plan: <strong style="color: var(--text-main);">${p.plan}</strong> | Fecha de Pago: <strong>${p.fecha_pago}</strong>
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.95rem; font-weight: 700; padding: 0.4rem 0.8rem;">
              +${p.monto} ${p.moneda}
            </span>
            <button type="button" class="btn-secondary" onclick="inspectPaymentDetail(${p.id_pago})" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">
              Ver detalle
            </button>
          </div>
        `;
        container.appendChild(item);
      });
    })
    .catch(err => console.error("Error al obtener pagos en rango:", err));
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

  const usdText = $("#totalUsdSummary") ? $("#totalUsdSummary").textContent : "$0.00 USD";
  const copText = $("#totalCopSummary") ? $("#totalCopSummary").textContent : "$0.00 COP";
  const bsText = $("#totalBsSummary") ? $("#totalBsSummary").textContent : "$0.00 BS";
  const count = currentPaymentsData ? currentPaymentsData.length : 0;

  const summaryText = `ATLAS GYM - RESUMEN CONTABLE DE CAJA\nPeriodo: ${periodoStr}\n----------------------------------------\nTotal USD: ${usdText}\nTotal COP: ${copText}\nTotal BS: ${bsText}\n----------------------------------------\nTotal Transacciones Registradas: ${count}`;

  navigator.clipboard.writeText(summaryText)
    .then(() => alert("El resumen contable ha sido copiado al portapapeles."))
    .catch(err => alert("Error al copiar resumen contable: " + err));
}

/* ---------- GESTIÓN DE PLANTILLAS DE RUTINAS ---------- */
let adminTemplatesData = [];

function toggleAdminTemplatesSection() {
  const clientsSection = $("#adminClientsSection");
  const paymentsSection = $("#adminPaymentsSection");
  const templatesSection = $("#adminTemplatesSection");

  if (!templatesSection) return;

  if (templatesSection.classList.contains("hidden")) {
    if (clientsSection) clientsSection.classList.add("hidden");
    if (paymentsSection) paymentsSection.classList.add("hidden");
    templatesSection.classList.remove("hidden");
    loadAdminTemplates();
    templatesSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    templatesSection.classList.add("hidden");
  }
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
          <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: rgba(30,41,59,0.4); border-radius: 16px; border: 1px dashed var(--border-light);">
            <p style="font-size: 1.05rem; color: var(--text-muted); margin-bottom: 1rem;">No hay plantillas de rutinas creadas aún.</p>
            <button class="btn-primary" onclick="openCreateTemplateModal()" style="width: auto; margin: 0 auto; background: linear-gradient(135deg, #A855F7 0%, #7E22CE 100%);">
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
          ? p.ejercicios.map(e => `• ${e.nombre_ejercicio} (${e.series}s x ${e.repeticiones}r)`).join("<br>")
          : "Sin ejercicios";

        card.innerHTML = `
          <div>
            <span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #C084FC; border: 1px solid rgba(168, 85, 247, 0.4); margin-bottom: 0.5rem;">Plantilla</span>
            <h3 class="routine-title">${p.titulo}</h3>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem;">${p.descripcion || "Sin descripción"} | Horario: ${p.horario || "Flexible"}</p>
            
            <div style="background: rgba(15,23,42,0.5); padding: 0.8rem; border-radius: 8px; font-size: 0.85rem; color: var(--text-main); margin-bottom: 1rem; line-height: 1.4;">
              ${exList}
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
            <button type="button" class="btn-secondary" onclick="editTemplateByAdmin(${p.id_plantilla})" style="font-size: 0.85rem; padding: 0.5rem 0.8rem; flex: 1;">
              Editar
            </button>
            <button type="button" class="btn-danger" onclick="deleteTemplateByAdmin(${p.id_plantilla})" style="font-size: 0.85rem; padding: 0.5rem 0.8rem; flex: 1;">
              Eliminar
            </button>
          </div>
        `;
        grid.appendChild(card);
      });
    })
    .catch(err => console.error("Error al obtener plantillas:", err));
}

function openCreateTemplateModal() {
  const modal = $("#createTemplateModal");
  if (modal) modal.classList.remove("hidden");
  const form = $("#createTemplateForm");
  if (form) form.reset();

  const container = $("#templateExercisesContainer");
  if (container) {
    container.innerHTML = "";
    addTemplateExerciseRow();
    addTemplateExerciseRow();
  }
}

function closeCreateTemplateModal() {
  const modal = $("#createTemplateModal");
  if (modal) modal.classList.add("hidden");
}

function addTemplateExerciseRow(nombre = "", series = 3, reps = 10, peso = 0) {
  const container = $("#templateExercisesContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "template-exercise-row template-exercise-card";
  card.style.cssText = "background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 12px; padding: 1rem; position: relative; margin-bottom: 0.8rem;";

  card.innerHTML = `
    <button type="button" onclick="this.closest('.template-exercise-card').remove()" title="Eliminar ejercicio" style="position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(239, 68, 68, 0.2); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; width: 28px; height: 28px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center;">X</button>

    <div style="margin-bottom: 0.8rem; padding-right: 2rem;">
      <label class="form-label" style="font-size: 0.8rem; color: #C084FC; margin-bottom: 0.3rem; font-weight: 600;">Nombre del Ejercicio</label>
      <input type="text" class="form-input template-ex-name" placeholder="Ej: Sentadilla Libre" value="${nombre}" required style="padding: 0.5rem 0.8rem; font-size: 0.9rem;">
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.8rem;">
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Series</label>
        <input type="number" class="form-input template-ex-series" placeholder="3" value="${series}" min="1" required style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Reps</label>
        <input type="number" class="form-input template-ex-reps" placeholder="10" value="${reps}" min="1" required style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
      </div>
      <div>
        <label class="form-label" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem; display: block; text-align: center;">Peso Sugerido (kg)</label>
        <input type="number" step="0.5" class="form-input template-ex-peso" placeholder="0" value="${peso}" min="0" style="padding: 0.4rem 0.6rem; text-align: center; font-size: 0.9rem;">
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
    alert("Debes agregar al menos un ejercicio a la plantilla.");
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
      alert(msg);
      closeCreateTemplateModal();
      loadAdminTemplates();
    })
    .catch(err => alert(err.message));
}

function deleteTemplateByAdmin(id_plantilla) {
  if (!confirm("¿Estás seguro de eliminar esta plantilla de rutina?")) return;

  fetch(`${API_BASE}/admin/plantillas/${id_plantilla}`, { method: "DELETE" })
    .then(r => r.json())
    .then(res => {
      if (res.ok) {
        alert("Plantilla eliminada.");
        loadAdminTemplates();
      } else {
        alert(res.msg || "Error al eliminar plantilla");
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
          <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; background: rgba(30,41,59,0.3); border-radius: 12px; border: 1px dashed var(--border-light);">
            <p style="color: var(--text-muted); font-size: 0.95rem;">No hay plantillas predefinidas disponibles en este momento.</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = "";

      res.plantillas.forEach(p => {
        const card = document.createElement("div");
        card.className = "routine-card";
        card.style.cssText = "display: flex; flex-direction: column; justify-content: space-between; height: 100%; border-color: rgba(168, 85, 247, 0.3);";

        const exList = p.ejercicios && p.ejercicios.length > 0
          ? p.ejercicios.map(e => `• ${e.nombre_ejercicio} (${e.series} series × ${e.repeticiones} reps)`).join("<br>")
          : "Sin ejercicios";

        card.innerHTML = `
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
              <h3 class="routine-title" style="color: #C084FC;">${p.titulo}</h3>
              <span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #C084FC; border: 1px solid rgba(168, 85, 247, 0.4);">${p.horario || "Flexible"}</span>
            </div>
            
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">${p.descripcion || "Sin descripción"}</p>

            <div style="background: rgba(15,23,42,0.6); padding: 0.8rem; border-radius: 8px; font-size: 0.85rem; color: var(--text-main); margin-bottom: 1.2rem; line-height: 1.4;">
              ${exList}
            </div>
          </div>

          <div>
            <button type="button" class="btn-primary" onclick="selectTemplateForRoutine(${p.id_plantilla})" style="width: 100%; background: linear-gradient(135deg, #A855F7 0%, #7E22CE 100%);">
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

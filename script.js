// script.js – Lógica Frontend ATLAS (Login, Registro, Rutinas e Interacción de Entrenamiento)

const API_BASE = (
  window.location.protocol === "file:" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  !window.location.hostname
)
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
      loadUserDashboardResources();
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
        <div class="series-row-card">
          <div class="series-badge">S${s + 1}</div>
          <div class="series-inputs-group">
            <div class="series-input-box">
              <span class="series-box-label">Peso</span>
              <div class="series-field-inner">
                <input type="number" step="0.5" class="set-input set-weight-input" data-ex="${exIdx}" data-set="${s}" value="${setWeight}" oninput="saveActiveSessionState()">
                <span class="unit-tag">kg</span>
              </div>
            </div>
            <div class="series-input-box">
              <span class="series-box-label">Reps</span>
              <div class="series-field-inner">
                <input type="number" class="set-input set-reps-input" data-ex="${exIdx}" data-set="${s}" value="${setReps}" oninput="saveActiveSessionState()">
              </div>
            </div>
          </div>
          <button type="button" class="btn-check-set ${isCompleted ? 'completed' : ''}" id="btn_set_${setId}" onclick="toggleSetCompleted('${setId}')" title="Marcar serie completada">
            ✓
          </button>
        </div>
      `;
    }

    block.innerHTML = `
      <div class="exercise-header">
        <span class="exercise-name">${ej.nombre_ejercicio || ej.titulo || "Ejercicio"}</span>
        <span class="exercise-subinfo">${ej.series} Series × ${ej.repeticiones} Reps (${formatExerciseWeights(ej)})</span>
      </div>
      <div class="series-list-container">
        ${setsHtml}
      </div>
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
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.3rem; word-break: break-all; overflow-wrap: anywhere;">✉️ <strong style="color: var(--text-main);">Correo:</strong> ${u.correo}</p>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem; word-break: break-all; overflow-wrap: anywhere;">📞 <strong style="color: var(--text-main);">Teléfono:</strong> ${u.telefono || "Sin teléfono"}</p>

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
          <button class="btn-primary" onclick="event.stopPropagation(); openRegisterPaymentModal(${u.id_usuario})" style="font-size: 0.82rem; padding: 0.5rem 0.75rem; background: linear-gradient(135deg, #10B981 0%, #059669 100%); flex: 1 1 calc(50% - 0.5rem); min-width: 120px; text-align: center; justify-content: center;">
            Registrar Pago
          </button>
          <button class="btn-primary" onclick="event.stopPropagation(); sendWhatsAppReminder('${u.nombre_completo}', '${u.telefono || ''}', '${u.membresia.vence}', '${u.membresia.estado}')" style="font-size: 0.82rem; padding: 0.5rem 0.75rem; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); border: none; flex: 1 1 calc(50% - 0.5rem); min-width: 120px; text-align: center; justify-content: center;">
            WhatsApp
          </button>
          <button class="btn-primary" onclick="event.stopPropagation(); viewUserProgressModal(${u.id_usuario})" style="font-size: 0.82rem; padding: 0.5rem 0.75rem; flex: 1 1 calc(50% - 0.5rem); min-width: 100px; text-align: center; justify-content: center;">
            Ver Rutinas
          </button>
          <button class="btn-secondary" onclick="event.stopPropagation(); editUserByAdmin(${u.id_usuario})" title="Editar datos del cliente" style="font-size: 0.82rem; padding: 0.5rem 0.75rem; flex: 1 1 calc(50% - 0.5rem); min-width: 80px; text-align: center; justify-content: center;">
            Editar
          </button>
          <button class="btn-danger" onclick="event.stopPropagation(); deleteUserByAdmin(${u.id_usuario})" title="Eliminar cliente" style="padding: 0.5rem 0.75rem; font-size: 0.82rem; flex: 1 1 100%; text-align: center; justify-content: center;">
            Eliminar Cliente
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
        loadAdminPaymentsHistory(fecha_pago);
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

function editTemplateByAdmin(id_plantilla) {
  const plantilla = adminTemplatesData.find(p => p.id_plantilla === id_plantilla);
  if (!plantilla) {
    alert("No se encontró la información de la plantilla.");
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

/* ---------- MATERIAL Y CONTENIDO ADICIONAL 📚 ---------- */

let adminResourcesData = [];
let userResourcesData = [];

function toggleAdminResourcesSection() {
  const sec = $("#adminResourcesSection");
  if (!sec) return;

  if (sec.classList.contains("hidden")) {
    const clientsSection = $("#adminClientsSection");
    const paymentsSection = $("#adminPaymentsSection");
    const templatesSection = $("#adminTemplatesSection");

    if (clientsSection) clientsSection.classList.add("hidden");
    if (paymentsSection) paymentsSection.classList.add("hidden");
    if (templatesSection) templatesSection.classList.add("hidden");

    sec.classList.remove("hidden");
    loadAdminResources();
    sec.scrollIntoView({ behavior: 'smooth' });
  } else {
    sec.classList.add("hidden");
  }
}

function getCategoryBadge(cat) {
  switch (cat) {
    case 'Nutrición':
      return `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3);">Nutrición</span>`;
    case 'Entrenamiento':
      return `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.3);">Guía</span>`;
    case 'Suplementación':
      return `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #C084FC; border: 1px solid rgba(168, 85, 247, 0.3);">Suplementos</span>`;
    case 'Reglamento':
      return `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #FCA5A5; border: 1px solid rgba(239, 68, 68, 0.3);">Reglamento</span>`;
    default:
      return `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3);">Consejos</span>`;
  }
}

function getResourceUrl(url) {
  if (!url) return '#';
  const strUrl = String(url).trim();
  if (strUrl.startsWith('data:')) {
    return strUrl;
  }
  let cleanUrl = strUrl.replace(/\\/g, '/');
  if (cleanUrl.startsWith('uploads/')) {
    cleanUrl = '/' + cleanUrl;
  }
  if (cleanUrl.startsWith('/uploads/') || cleanUrl.startsWith('/')) {
    const backendBase = API_BASE.replace(/\/api\/?$/, '');
    return `${backendBase}${cleanUrl}`;
  }
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return `https://${cleanUrl}`;
  }
  return cleanUrl;
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
      <div class="modal-content" style="max-width: 850px; text-align: center; background: #1e293b; border: 1px solid var(--border-light); border-radius: 16px; padding: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 id="previewResourceTitle" style="font-size: 1.25rem; font-weight: 700; color: #FBBF24; margin: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></h3>
          <button type="button" onclick="closeImagePreviewModal()" style="background: none; border: none; color: var(--text-muted); font-size: 1.8rem; cursor: pointer; line-height: 1; padding: 0 0.4rem;">&times;</button>
        </div>
        <div style="background: #0f172a; border-radius: 12px; padding: 0.5rem; display: flex; justify-content: center; align-items: center; min-height: 280px; max-height: 70vh; overflow: auto; margin-bottom: 1.2rem; border: 1px solid rgba(255,255,255,0.05);">
          <img id="previewResourceImg" src="" alt="Vista previa" style="max-width: 100%; max-height: 65vh; object-fit: contain; border-radius: 8px;" />
          <iframe id="previewResourceIframe" src="" style="width: 100%; height: 65vh; border: none; border-radius: 8px;" class="hidden"></iframe>
        </div>
        <div style="display: flex; gap: 0.8rem; justify-content: flex-end; flex-wrap: wrap;">
          <button type="button" id="previewResourceFullBtn" class="btn-primary" style="padding: 0.55rem 1.2rem; font-size: 0.88rem; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); border: none; display: inline-flex; align-items: center; gap: 0.4rem;">🔍 Ampliar en Pestaña</button>
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
      const win = window.open();
      if (win) {
        if (hrefUrl.startsWith('data:image/')) {
          win.document.write(`<html><head><title>${title || 'Vista Previa'}</title></head><body style="margin:0;background:#0f172a;display:flex;justify-content:center;align-items:center;min-height:100vh;"><img src="${hrefUrl}" style="max-width:100%;max-height:100vh;object-fit:contain;"/></body></html>`);
        } else {
          win.location.href = hrefUrl;
        }
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
      grid.innerHTML = `<div style="grid-column: 1 / -1; color: #EF4444; text-align: center;">Error al cargar contenidos.</div>`;
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
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: rgba(30,41,59,0.4); border-radius: 16px; border: 1px dashed var(--border-light);">
        <p style="font-size: 1.1rem; color: var(--text-muted); margin-bottom: 1rem;">No hay material registrado en esta categoría aún.</p>
        <button class="btn-primary" onclick="openCreateResourceModal()" style="width: auto; margin: 0 auto; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); border: none;">
          + Subir Primer Material
        </button>
      </div>
    `;
    return;
  }

  list.forEach(r => {
    const card = document.createElement("div");
    card.className = "routine-card";
    card.style.cssText = "padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between; border-left: 4px solid #F59E0B;";

    const catBadge = getCategoryBadge(r.categoria);
    const iconTag = getResourceIcon(r.tipo_recurso, r.url_recurso);
    const hrefUrl = getResourceUrl(r.url_recurso);
    const isDataImg = r.url_recurso && String(r.url_recurso).startsWith('data:image/');
    const isImage = isDataImg || (r.url_recurso && String(r.url_recurso).match(/\.(png|jpg|jpeg|webp|gif|svg)$/i));

    const thumbnailHtml = isImage ? `
      <div style="margin-bottom: 0.8rem; border-radius: 8px; overflow: hidden; background: #0f172a; height: 160px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.08); cursor: pointer;" onclick="openResourcePreviewById(${r.id_recurso})" title="Haz clic para ampliar">
        <img src="${hrefUrl}" style="width: 100%; height: 100%; object-fit: cover;" alt="${r.titulo}">
      </div>
    ` : '';

    const actionBtn = `
      <button type="button" class="btn-primary" onclick="openResourcePreviewById(${r.id_recurso})" style="flex: 1; text-align: center; font-size: 0.85rem; padding: 0.55rem 0.8rem; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); border: none;">
        Ver Material
      </button>
    `;

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem; gap: 0.5rem;">
          <h3 class="routine-title" style="margin: 0; font-size: 1.15rem; color: var(--text-main); font-weight: 700;">${r.titulo}</h3>
          ${catBadge}
        </div>
        
        ${thumbnailHtml}

        <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 0.8rem; line-height: 1.4;">${r.descripcion || "Sin descripción adicional."}</p>

        <div style="background: rgba(15,23,42,0.5); padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.82rem; color: #60A5FA; margin-bottom: 1rem; border: 1px solid rgba(255,255,255,0.04);">
          ${iconTag}: <strong style="color: var(--text-main);">${r.nombre_archivo_orig || (isDataImg ? 'Imagen Base64' : r.url_recurso)}</strong>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        ${actionBtn}
        <button class="btn-danger" onclick="deleteResourceByAdmin(${r.id_recurso})" title="Eliminar material" style="padding: 0.55rem 0.8rem; font-size: 0.85rem;">
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
        alert("Por favor selecciona un archivo (PDF, Imagen, etc.).");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Guardar Material"; }
        return;
      }
      const rawFile = fileInput.files[0];
      const fileToUpload = await compressImageFile(rawFile);
      formData.append('archivo', fileToUpload);
    } else {
      if (!linkInput || !linkInput.value.trim()) {
        alert("Por favor ingresa la URL del enlace o video.");
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
      alert(res.msg || "Error al guardar el material de apoyo.");
    }
  } catch (err) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Guardar Material";
    }
    console.error("Error guardando recurso:", err);
    alert(err.message || "Error al conectar con el servidor. Por favor reintenta.");
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
        alert(res.msg || "Error al eliminar el material.");
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
      <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; background: rgba(30,41,59,0.3); border-radius: 12px; border: 1px dashed var(--border-light);">
        <p style="font-size: 1rem; color: var(--text-muted); margin: 0;">No hay contenido adicional disponible en esta categoría por ahora.</p>
      </div>
    `;
    return;
  }

  list.forEach(r => {
    const card = document.createElement("div");
    card.className = "routine-card";
    card.style.cssText = "padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between; border-left: 4px solid #F59E0B;";

    const catBadge = getCategoryBadge(r.categoria);
    const iconTag = getResourceIcon(r.tipo_recurso, r.url_recurso);
    const hrefUrl = getResourceUrl(r.url_recurso);
    const isDataImg = r.url_recurso && String(r.url_recurso).startsWith('data:image/');
    const isImage = isDataImg || (r.url_recurso && String(r.url_recurso).match(/\.(png|jpg|jpeg|webp|gif|svg)$/i));

    const thumbnailHtml = isImage ? `
      <div style="margin-bottom: 0.8rem; border-radius: 8px; overflow: hidden; background: #0f172a; height: 160px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.08); cursor: pointer;" onclick="openResourcePreviewById(${r.id_recurso})" title="Haz clic para ampliar">
        <img src="${hrefUrl}" style="width: 100%; height: 100%; object-fit: cover;" alt="${r.titulo}">
      </div>
    ` : '';

    const userActionBtn = isImage ? `
      <button type="button" class="btn-primary" onclick="openResourcePreviewById(${r.id_recurso})" style="display: block; width: 100%; text-align: center; font-size: 0.88rem; padding: 0.6rem 1rem; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); border: none;">
        🖼️ Ver Imagen
      </button>
    ` : `
      <a href="${hrefUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="display: block; width: 100%; text-align: center; text-decoration: none; font-size: 0.88rem; padding: 0.6rem 1rem; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); border: none;">
        Ver Contenido
      </a>
    `;

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem; gap: 0.5rem;">
          <h3 class="routine-title" style="margin: 0; font-size: 1.15rem; color: var(--text-main); font-weight: 700;">${r.titulo}</h3>
          ${catBadge}
        </div>
        
        ${thumbnailHtml}

        <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 0.8rem; line-height: 1.4;">${r.descripcion || "Sin descripción adicional."}</p>

        <div style="background: rgba(15,23,42,0.5); padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.82rem; color: #60A5FA; margin-bottom: 1.2rem; border: 1px solid rgba(255,255,255,0.04);">
          ${iconTag}: <strong style="color: var(--text-main);">${r.nombre_archivo_orig || (isDataImg ? 'Imagen Base64' : 'Ver Recurso')}</strong>
        </div>
      </div>

      <div>
        ${userActionBtn}
      </div>
    `;
    grid.appendChild(card);
  });
}



# ATLAS — Sistema del gimnasio ATLAS Gym

Sistema web para un gimnasio en Venezuela: clientes, membresías, pagos en varias monedas, rutinas de entrenamiento, control de entrada (asistencia) y vencimientos. Todo el texto visible para el usuario está en **español**.

## Arquitectura
- **Backend:** `backend/server.js` (Node + Express + mysql2, un solo archivo). Base de datos MySQL en Aiven.
- **Frontend:** HTML + JavaScript sin framework.
  - `index.html`: login.
  - `dashboard.html`: vista del cliente (rutinas y entrenamiento).
  - `admin.html`: panel de administración y de recepción.
  - `script.js`: toda la lógica del frontend, compartida por las tres páginas.
  - `style.css`: estilos.
- **Despliegue:** Render, desde la rama `main` del repo `atlasgymve/sitio-web-atlas`. Cada push a `main` se publica automáticamente en https://atlasgym.onrender.com
- **Configuración:** variables de entorno en Render. En local, un archivo `.env` (ver `.env.example`). Nunca escribir contraseñas en el código ni subir `.env`.
- El esquema de la base se crea y actualiza solo al arrancar, en `initDatabaseSchema()`, con `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE` dentro de try/catch. Las tablas nuevas siguen ese mismo patrón.

## Roles y seguridad (no romper)
- El login devuelve un **token firmado** (HMAC). El frontend lo envía automáticamente en `Authorization: Bearer` (en `script.js` se reemplaza `window.fetch` para las URLs de `API_BASE`).
- Roles:
  - `admin`: acceso total.
  - `recepcion`: clientes (ver, crear, editar), registrar pagos, plantillas, asistencias. **No** ve el historial de pagos, no edita pagos, no borra clientes y no gestiona material.
  - `cliente`: solo sus propios datos. Entra sin contraseña, con correo o cédula.
- Toda ruta nueva de `/api/admin/...` lleva `requireRole('admin')` o `requireRole('admin', 'recepcion')`. Las rutas de cliente usan `requireAuth` y verifican que el recurso le pertenezca.
- Las restricciones visuales de recepción se aplican en `applyReceptionistRestrictions()` en `script.js`. Ocultar en la interfaz **no** reemplaza el control en el servidor.
- **Todo dato que venga de la base y se inserte con `innerHTML` va dentro de `esc(...)`.** No pasar textos de usuarios dentro de atributos `onclick="fn('...')"`: pasar el id y buscar el dato en `adminUsersData`.
- Las respuestas de error al usuario no incluyen `err.message`: mensaje genérico en la respuesta, el detalle con `console.error`.
- Validar fechas con `isValidDateStr()` (YYYY-MM-DD) y usar siempre consultas con parámetros `?`.

## Datos clave
- `usuarios`: clientes y personal. `id_rol` 1 = admin, 3 = recepción; el resto son clientes. Tiene `tiene_deuda`.
- `membresias`: `fecha_inicio`, `fecha_fin` y `estado`. La vigente es la de `fecha_fin` más reciente.
- `pagos`: `monto`, `moneda` (USD, COP, BS, Bancolombia, USDT, CLP), `plan` (Mensualidad, Estudiante, Semana, Diario, Pago Deuda), `fecha_pago`, `fecha_inicio_plan`, `fecha_fin_plan`, `es_abono`, `turno` (AM/PM, puede ser NULL en pagos viejos) y `nombre_cliente` (se conserva aunque se borre el cliente).
- `asistencias`: `id_usuario`, `fecha`, `hora` (hora local del gimnasio enviada por el navegador), `estado_membresia`, `plan` y `tenia_deuda`.
- `historial_sesiones`: `id_usuario`, `id_rutina`, `fecha` (DATETIME de la base; se convierte a hora de Venezuela al leerla) y `detalle_json` (`routineTitle`, `completedSets`, `totalSets`, `timestamp`). Se borra en cascada si se elimina la rutina. El cliente la recibe en `GET /api/usuario/:id` (`sesiones`).
- **Mensualidad y Estudiante cuentan como plan mensual** (`planCategoria()` en `script.js`).
- Las fechas se manejan como texto `YYYY-MM-DD` en hora local de Venezuela (`getLocalTodayStr()`, `formatYYYYMMDD()`). No usar UTC para decidir "hoy".
- Los montos en distintas monedas **no se suman entre sí** sin una tasa de cambio explícita.

## Convenciones de interfaz
Las maquetas de referencia están en `docs/rediseno/` (`panel-inicio-pc.html` y `cliente-hoy-telefono.html`).

### Colores (variables en `:root` de `style.css`; nunca escribir colores sueltos en el HTML)
- Fondo `--bg` #0A0F1C; superficies `--surface` #111A2E y `--surface-2` #0D1424; bordes `--border` #1C2740 (`--border-strong`, `--border-input`, separador de filas `--divider`).
- Texto `--text` #F3F6FB; secundario `--text-2` #C3CCDD y `--text-3` #9AA6BC; enlaces `--link`.
- Color principal: azul rey `--primary` #2F5BD3 (botón principal, ítem activo del menú, barras de progreso).
- **Verde, ámbar y rojo solo para estados** (al día / por vencer / vencido o deuda): `--ok`, `--warn`, `--danger`, con sus `-bg` y `-border`. Nunca para decorar secciones, categorías, montos o turnos. Excepción aceptada: los botones de eliminar (`btn-danger`) van en rojo.
- Sin efectos de vidrio, brillos ni degradados. `.glass-card` es una superficie plana (el nombre se conserva por compatibilidad).

### Tipografía (Google Fonts, cargadas con `<link>` en cada página)
- Títulos y números grandes: **Barlow Condensed** itálica 700/800, en mayúsculas (`h1`, `h2`, `h3`, `.kpi-value`, `.stat-value`, `.display-number`).
- Textos: **Inter**. `h4`/`h5` van en Inter.
- En el teléfono, todo campo con letra de al menos **16 px** (si no, el iPhone hace zoom).

### Componentes
- Botones `btn-primary`, `btn-secondary` y `btn-danger`; todo lo que se toca mide al menos **44 px** (`--tap`).
- Insignias: `badge-active`, `badge-warning`, `badge-expired` (estados) y `badge-neutral` (contadores, etiquetas y categorías).
- Texto de estado: `estado-ok`, `estado-warn`, `estado-danger`.
- Mensajes: `showToast(mensaje, "exito" | "error" | "aviso" | "info")` en lugar de `alert()`. `confirm()` solo para acciones destructivas.
- Tablas: `data-table` dentro de `tabla-wrap`; columnas que se ocultan en el teléfono con `col-md`.
- Selector: `$("#id")`.

### Panel (`admin.html`): una vista a la vez
- Menú lateral (`#sideNav`) con: Inicio, Control de entrada, Clientes, Pagos, Vencimientos, Cierre de caja, Reportes, Plantillas de rutinas y Material. En pantallas de menos de 1024 px pasa a un menú desplegable arriba (botón "Menú").
- Cada vista es una `<section class="view" data-view="...">` registrada en `VISTAS_PANEL` (`script.js`) con su función de carga y, si corresponde, `soloAdmin: true`. Se navega con la dirección (`#inicio`, `#clientes`...) usando `irAVista()`; las funciones viejas `toggle...Section()` ahora solo llaman a `irAVista()`.
- Barra superior: buscador de clientes (Ctrl+K) que abre la ficha del cliente en un panel lateral (`abrirFichaCliente(id)`), "+ Nuevo cliente" y "Registrar pago".
- Inicio = "Resumen de hoy" (indicadores, control de entrada, por vencer y últimos pagos). "Cobrado hoy" y "Últimos pagos" son solo del admin.
- Recepción: los elementos con `data-solo-admin` se quitan del menú e Inicio, y `mostrarVista()` no abre vistas `soloAdmin`. Ve Clientes, pero sin el botón Eliminar.

### Cliente (`dashboard.html`): pensado para el teléfono
- Menú inferior fijo: Hoy · Rutinas · Progreso · Mi plan (`#hoy`, `#rutinas`, `#progreso`, `#plan`; `VISTAS_CLIENTE` en `script.js`).
- Hoy: tarjeta de membresía, rutina sugerida (la que toca según su horario o la que hace más tiempo que no hace; se puede cambiar) y la semana según `historial_sesiones`.
- Modo entrenamiento a pantalla completa (`#activeSessionSection`): un ejercicio por pantalla, botones − y + (2,5 kg / 1 repetición), marca de 64 px, temporizador visible y Screen Wake Lock cuando el teléfono lo permite. La sesión a medias se guarda en `localStorage` (`atlas_active_workout_session`).

- La interfaz debe funcionar bien en el celular: la recepción a veces trabaja desde el teléfono.

## Cómo trabajar
- Antes de escribir código, mostrar un plan breve y esperar aprobación cuando el cambio toque la base de datos o los permisos.
- Verificar la sintaxis con `node --check backend/server.js` y `node --check script.js`.
- Probar en local con `npm start` (requiere `.env`) y revisar la consola del navegador.
- Probar con los tres roles: admin, recepción y cliente.
- Commits en español, descriptivos. Hacer push a `main` solo después de probar, porque publica directo en producción. Para cambios grandes, usar una rama y pedir revisión.

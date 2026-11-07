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
- **Mensualidad y Estudiante cuentan como plan mensual** (`planCategoria()` en `script.js`).
- Las fechas se manejan como texto `YYYY-MM-DD` en hora local de Venezuela (`getLocalTodayStr()`, `formatYYYYMMDD()`). No usar UTC para decidir "hoy".
- Los montos en distintas monedas **no se suman entre sí** sin una tasa de cambio explícita.

## Convenciones de interfaz
- Secciones del panel: una tarjeta en la grilla de "acciones rápidas" de `admin.html` abre una `<section class="glass-card hidden">`. Ver como ejemplo `toggleExpirySection()` y `toggleCheckinSection()`.
- Botones `btn-primary` y `btn-secondary`; insignias `badge badge-active`, `badge-warning` y `badge-expired`. Selector: `$("#id")`.
- La interfaz debe funcionar bien en el celular: la recepción a veces trabaja desde el teléfono.

## Cómo trabajar
- Antes de escribir código, mostrar un plan breve y esperar aprobación cuando el cambio toque la base de datos o los permisos.
- Verificar la sintaxis con `node --check backend/server.js` y `node --check script.js`.
- Probar en local con `npm start` (requiere `.env`) y revisar la consola del navegador.
- Probar con los tres roles: admin, recepción y cliente.
- Commits en español, descriptivos. Hacer push a `main` solo después de probar, porque publica directo en producción. Para cambios grandes, usar una rama y pedir revisión.

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/* Carga opcional de variables desde un archivo .env local (sin dependencias).
   En Render las variables se configuran en el panel "Environment". */
(function loadDotEnv() {
  for (const file of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
})();

/* ---------- SESIONES FIRMADAS (token HMAC, sin dependencias externas) ---------- */
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  console.warn('⚠️ SESSION_SECRET no está configurado: se usará uno temporal y las sesiones se cerrarán en cada reinicio.');
  return crypto.randomBytes(32).toString('hex');
})();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'atlasgymve@gmail.com').toLowerCase();
const RECEPCION_EMAIL = 'recepcion@atlasgym.local';
const SESSION_HOURS = { admin: 12, recepcion: 14, cliente: 24 * 30 };

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function signToken(uid, rol) {
  const payload = b64url(JSON.stringify({ uid: Number(uid), rol, exp: Date.now() + SESSION_HOURS[rol] * 3600 * 1000 }));
  const sig = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest());
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!data.uid || !data.rol || !data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (e) { return null; }
}
function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  req.user = h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  next();
}
// Exige sesión válida; si se pasan roles, exige uno de ellos
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, msg: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
    if (roles.length && !roles.includes(req.user.rol)) return res.status(403).json({ ok: false, msg: 'No tienes permiso para esta acción.' });
    next();
  };
}
const requireAuth = requireRole();
const isStaff = (u) => u && (u.rol === 'admin' || u.rol === 'recepcion');

/* Helper de Fechas en Zona Horaria Local (America/Caracas - UTC-4) */
function getTodayYMD() {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' });
    return formatter.format(now);
  } catch (e) {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

function formatYYYYMMDD(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    const clean = d.split('T')[0].split(' ')[0];
    const parts = clean.split('-');
    if (parts.length >= 3 && parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
  }
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(d).split('T')[0].split(' ')[0];
}

function parseLocalYYYYMMDD(str) {
  if (!str) return new Date();
  if (str instanceof Date) {
    return new Date(str.getFullYear(), str.getMonth(), str.getDate());
  }
  const strVal = String(str).split('T')[0].split(' ')[0];
  const parts = strVal.split('-');
  if (parts.length >= 3) {
    const yyyy = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10) - 1;
    const dd = parseInt(parts[2], 10);
    if (!isNaN(yyyy) && !isNaN(mm) && !isNaN(dd)) {
      return new Date(yyyy, mm, dd);
    }
  }
  return new Date();
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/api', authenticate);

// Servir SOLO los archivos públicos del frontend.
// (Antes se publicaba toda la carpeta del proyecto, incluido backend/server.js con sus credenciales.)
const publicPath = path.join(__dirname, '..');
const PUBLIC_FILES = new Set(['index.html', 'admin.html', 'dashboard.html', 'script.js', 'style.css']);
app.get('/:file', (req, res, next) => {
  if (PUBLIC_FILES.has(req.params.file)) return res.sendFile(path.join(publicPath, req.params.file));
  next();
});
app.use('/assets', express.static(path.join(publicPath, 'assets')));

// Carpeta de archivos subidos
const uploadsDir = path.join(publicPath, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Configuración de Multer para carga de archivos en memoria (almacenamiento permanente Base64)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Pool de conexión MySQL (Soporta Variables de Entorno para Render / Cloud DB)
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'atlas',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  ssl: (process.env.DB_SSL === 'true' || (process.env.DB_HOST && process.env.DB_HOST.includes('aivencloud.com')))
    ? { rejectUnauthorized: false }
    : false
});

// Inicialización segura de esquemas y tablas sin detener la app ante fallos de inicio
async function initDatabaseSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recursos_apoyo (
        id_recurso INT AUTO_INCREMENT PRIMARY KEY,
        titulo VARCHAR(150) NOT NULL,
        descripcion TEXT NULL,
        categoria VARCHAR(50) NOT NULL DEFAULT 'General',
        tipo_recurso ENUM('archivo', 'enlace') NOT NULL DEFAULT 'enlace',
        url_recurso LONGTEXT NOT NULL,
        nombre_archivo_orig VARCHAR(255) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    try {
      await pool.query('ALTER TABLE recursos_apoyo MODIFY COLUMN url_recurso LONGTEXT NOT NULL');
    } catch (e) { }
    console.log('✅ Tabla "recursos_apoyo" verificada');
  } catch (err) {
    console.error('⚠️ Error verificando recursos_apoyo:', err.message);
  }

  try {
    await pool.query('ALTER TABLE ejercicios_rutina ADD COLUMN series_detalle_json TEXT NULL AFTER peso_kg');
    console.log('✅ Columna "series_detalle_json" verificada/agregada en ejercicios_rutina');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('⚠️ Error al verificar columna series_detalle_json:', err.message);
    }
  }

  try {
    await pool.query('ALTER TABLE usuarios ADD COLUMN cedula VARCHAR(30) NULL AFTER correo');
    console.log('✅ Columna "cedula" verificada/agregada en usuarios');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('⚠️ Error al verificar columna cedula:', err.message);
    }
  }

  try {
    await pool.query('ALTER TABLE usuarios ADD COLUMN membresia_estado VARCHAR(20) DEFAULT "activa"');
    console.log('✅ Columna "membresia_estado" verificada/agregada en usuarios');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('⚠️ Error al verificar columna membresia_estado:', err.message);
    }
  }

  try {
    await pool.query('ALTER TABLE usuarios ADD COLUMN membresia_vence DATE NULL');
    console.log('✅ Columna "membresia_vence" verificada/agregada en usuarios');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('⚠️ Error al verificar columna membresia_vence:', err.message);
    }
  }

  try {
    await pool.query('ALTER TABLE usuarios ADD COLUMN rol VARCHAR(30) NULL');
    console.log('✅ Columna "rol" verificada/agregada en usuarios');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('⚠️ Error al verificar columna rol:', err.message);
    }
  }

  try {
    await pool.query('ALTER TABLE usuarios ADD COLUMN password_hash VARCHAR(255) NULL');
    console.log('✅ Columna "password_hash" verificada/agregada en usuarios');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('⚠️ Error al verificar columna password_hash:', err.message);
    }
  }

  try {
    await pool.query('ALTER TABLE usuarios ADD COLUMN tiene_deuda TINYINT(1) DEFAULT 0');
    console.log('✅ Columna "tiene_deuda" verificada/agregada en usuarios');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('⚠️ Error al verificar columna tiene_deuda:', err.message);
    }
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pagos (
        id_pago INT AUTO_INCREMENT PRIMARY KEY,
        id_usuario BIGINT UNSIGNED NULL,
        nombre_cliente VARCHAR(150) NULL,
        monto DECIMAL(10,2) NOT NULL,
        moneda VARCHAR(10) NOT NULL,
        plan VARCHAR(50) NOT NULL,
        fecha_pago DATE NOT NULL,
        fecha_inicio_plan DATE NULL,
        fecha_fin_plan DATE NULL,
        es_abono TINYINT(1) DEFAULT 0,
        turno ENUM('AM','PM') DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_pago_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    try { await pool.query('ALTER TABLE pagos MODIFY COLUMN id_usuario BIGINT UNSIGNED NULL'); } catch (e) { }
    try { await pool.query('ALTER TABLE pagos DROP FOREIGN KEY fk_pago_usuario'); } catch (e) { }
    try { await pool.query('ALTER TABLE pagos ADD CONSTRAINT fk_pago_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL'); } catch (e) { }
    try { await pool.query('ALTER TABLE pagos ADD COLUMN nombre_cliente VARCHAR(150) NULL AFTER id_usuario'); } catch (e) { }
    try { await pool.query('ALTER TABLE pagos ADD COLUMN fecha_inicio_plan DATE NULL AFTER fecha_pago'); } catch (e) { }
    try { await pool.query('ALTER TABLE pagos ADD COLUMN fecha_fin_plan DATE NULL AFTER fecha_inicio_plan'); } catch (e) { }
    try { await pool.query('ALTER TABLE pagos ADD COLUMN es_abono TINYINT(1) DEFAULT 0'); } catch (e) { }
    try { await pool.query("ALTER TABLE pagos ADD COLUMN turno ENUM('AM','PM') DEFAULT NULL AFTER es_abono"); } catch (e) { }
    try { await pool.query('ALTER TABLE pagos MODIFY COLUMN moneda VARCHAR(20) NOT NULL'); } catch (e) { }
    console.log('✅ Tabla "pagos" verificada en MySQL (columnas es_abono, turno y moneda VARCHAR(20) aseguradas)');
  } catch (err) {
    console.error('⚠️ Error al verificar tabla pagos:', err.message);
  }

  // Tabla de asistencias (control de entrada en recepción)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS asistencias (
        id_asistencia BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        id_usuario BIGINT UNSIGNED NULL,
        nombre_cliente VARCHAR(150) NULL,
        fecha DATE NOT NULL,
        hora TIME NOT NULL,
        estado_membresia VARCHAR(20) NULL,
        plan VARCHAR(50) NULL,
        tenia_deuda TINYINT(1) DEFAULT 0,
        registrado_por BIGINT UNSIGNED NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_asistencia_fecha (fecha),
        INDEX idx_asistencia_usuario (id_usuario, fecha)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabla "asistencias" verificada');
  } catch (err) {
    console.error('⚠️ Error verificando asistencias:', err.message);
  }

  // Cuentas de Administrador y Recepción.
  // Las contraseñas YA NO están en el código: se toman de las variables de entorno
  // ADMIN_PASSWORD y RECEPCION_PASSWORD. Si una variable no está definida, la cuenta existente no se modifica.
  await seedStaffAccount({
    email: ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, idRol: 1,
    nombreUsuario: 'admin_atlas', nombre: 'Administrador ATLAS', rolTexto: 'administrador'
  });
  try { await pool.query('INSERT IGNORE INTO roles (id_rol, nombre_rol) VALUES (3, "recepcionista")'); } catch (e) { }
  await seedStaffAccount({
    email: RECEPCION_EMAIL, password: process.env.RECEPCION_PASSWORD, idRol: 3,
    nombreUsuario: 'recepcion_atlas', nombre: 'Recepción ATLAS', rolTexto: null
  });
}

async function seedStaffAccount({ email, password, idRol, nombreUsuario, nombre, rolTexto }) {
  try {
    const [rows] = await pool.query('SELECT id_usuario FROM usuarios WHERE correo = ?', [email]);
    if (!password) {
      if (rows.length === 0) console.warn(`⚠️ No existe la cuenta ${email} y no hay contraseña configurada en el entorno para crearla.`);
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    if (rows.length === 0) {
      if (rolTexto) {
        await pool.query(
          'INSERT INTO usuarios (nombre_usuario, correo, hash_contrasena, password_hash, nombre_completo, id_rol, rol) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [nombreUsuario, email, hash, hash, nombre, idRol, rolTexto]
        );
      } else {
        await pool.query(
          'INSERT INTO usuarios (nombre_usuario, correo, hash_contrasena, nombre_completo, id_rol) VALUES (?, ?, ?, ?, ?)',
          [nombreUsuario, email, hash, nombre, idRol]
        );
      }
      console.log(`✅ Cuenta ${email} creada.`);
    } else {
      await pool.query('UPDATE usuarios SET hash_contrasena = ?, id_rol = ? WHERE correo = ?', [hash, idRol, email]);
      console.log(`✅ Contraseña de ${email} sincronizada desde el entorno.`);
    }
  } catch (err) {
    console.error(`⚠️ Error al preparar la cuenta ${email}:`, err.message);
  }
}

initDatabaseSchema();

// ---------- REGISTRO DE USUARIO ----------
app.post('/api/registro', requireRole('admin', 'recepcion'), async (req, res) => {
  const { nombre_completo, correo, cedula, telefono, password } = req.body;

  if (!nombre_completo || !correo || !password) {
    return res.status(400).json({ msg: 'Nombre, correo y contraseña son obligatorios.' });
  }

  const cleanEmail = correo.trim().toLowerCase();
  const cleanCedula = cedula ? String(cedula).trim() : null;

  try {
    // Comprobar si ya existe el correo
    const [existing] = await pool.execute('SELECT id_usuario FROM usuarios WHERE correo = ?', [cleanEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ msg: 'El correo electrónico ya está registrado.' });
    }

    // Comprobar si ya existe la cédula
    if (cleanCedula) {
      const [existingCedula] = await pool.execute('SELECT id_usuario FROM usuarios WHERE cedula = ?', [cleanCedula]);
      if (existingCedula.length > 0) {
        return res.status(400).json({ msg: 'La cédula de identidad ya está registrada en el sistema.' });
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const nombre_usuario = cleanEmail.split('@')[0] + Math.floor(Math.random() * 1000);

    const [result] = await pool.execute(
      'INSERT INTO usuarios (nombre_usuario, correo, cedula, telefono, hash_contrasena, password_hash, nombre_completo, id_rol, rol) VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?)',
      [nombre_usuario, cleanEmail, cleanCedula, telefono ? telefono.trim() : null, hash, hash, nombre_completo.trim(), 'cliente']
    );

    const newUserId = result.insertId;

    // Crear membresía por defecto de 30 días
    const fechaInicio = new Date();
    const fechaFin = new Date();
    fechaFin.setDate(fechaFin.getDate() + 30);

    await pool.execute(
      'INSERT INTO membresias (id_usuario, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?)',
      [newUserId, fechaInicio, fechaFin, 'activa']
    );

    res.status(201).json({
      ok: true,
      msg: 'Usuario registrado exitosamente.',
      id_usuario: newUserId,
      nombre: nombre_completo
    });
  } catch (err) {
    console.error('Error en /api/registro:', err);
    res.status(500).json({ msg: 'Error en el servidor. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- LOGIN (CORREO O CÉDULA) ----------
app.post('/api/login', async (req, res) => {
  const { email, password, loginInput } = req.body;
  const inputVal = String(loginInput || email || '').trim();

  if (!inputVal) {
    return res.status(400).json({ msg: 'Por favor ingresa tu correo electrónico o cédula.' });
  }

  const cleanInput = inputVal.toLowerCase();

  try {
    // Si es el correo del gimnasio, verificar tanto admin como recepcionista
    if (cleanInput === ADMIN_EMAIL) {
      if (!password) {
        return res.status(400).json({ msg: 'Por favor ingresa la contraseña de acceso.' });
      }

      // Buscar cuenta de administrador
      const [adminRows] = await pool.execute(
        'SELECT id_usuario, nombre_completo, hash_contrasena, id_rol FROM usuarios WHERE correo = ? AND id_rol = 1',
        [cleanInput]
      );

      // Buscar cuenta de recepcionista
      const [recepRows] = await pool.execute(
        'SELECT id_usuario, nombre_completo, hash_contrasena, id_rol FROM usuarios WHERE correo = ? AND id_rol = 3',
        [RECEPCION_EMAIL]
      );

      // Intentar contraseña de admin
      if (adminRows.length > 0) {
        const adminMatch = await bcrypt.compare(password, adminRows[0].hash_contrasena);
        if (adminMatch) {
          return res.json({
            ok: true,
            token: signToken(adminRows[0].id_usuario, 'admin'),
            id_usuario: adminRows[0].id_usuario,
            nombre: adminRows[0].nombre_completo || 'Administrador',
            esAdmin: true,
            esRecepcionista: false
          });
        }
      }

      // Intentar contraseña de recepcionista
      if (recepRows.length > 0) {
        const recepMatch = await bcrypt.compare(password, recepRows[0].hash_contrasena);
        if (recepMatch) {
          return res.json({
            ok: true,
            token: signToken(recepRows[0].id_usuario, 'recepcion'),
            id_usuario: recepRows[0].id_usuario,
            nombre: recepRows[0].nombre_completo || 'Recepción',
            esAdmin: false,
            esRecepcionista: true
          });
        }
      }

      return res.status(401).json({ msg: 'Contraseña incorrecta. Verifica e intenta de nuevo.' });
    }

    const [rows] = await pool.execute(
      'SELECT id_usuario, nombre_completo, hash_contrasena, id_rol FROM usuarios WHERE correo = ? OR cedula = ? OR nombre_usuario = ?',
      [cleanInput, inputVal, cleanInput]
    );

    if (rows.length === 0) {
      return res.status(404).json({ msg: 'Usuario no registrado. Por favor verifica tu correo o cédula.' });
    }

    const user = rows[0];

    // Si es administrador o recepcionista por otro medio, exigir contraseña
    if (user.id_rol === 1 || user.id_rol === 3) {
      if (!password) {
        return res.status(400).json({ msg: 'Por favor ingresa la contraseña de acceso.' });
      }
      const match = await bcrypt.compare(password, user.hash_contrasena);
      if (!match) {
        return res.status(401).json({ msg: 'Contraseña incorrecta.' });
      }
      return res.json({
        ok: true,
        token: signToken(user.id_usuario, user.id_rol === 1 ? 'admin' : 'recepcion'),
        id_usuario: user.id_usuario,
        nombre: user.nombre_completo || (user.id_rol === 1 ? 'Administrador' : 'Recepción'),
        esAdmin: user.id_rol === 1,
        esRecepcionista: user.id_rol === 3
      });
    }

    // Para clientes regulares: Inicio de sesión directo con correo o cédula
    res.json({
      ok: true,
      token: signToken(user.id_usuario, 'cliente'),
      id_usuario: user.id_usuario,
      nombre: user.nombre_completo || 'Cliente',
      esAdmin: false,
      esRecepcionista: false
    });
  } catch (err) {
    console.error('Error en /api/login:', err);
    res.status(500).json({ msg: 'Error de base de datos. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- DATOS DEL USUARIO Y SUS RUTINAS ----------
app.get('/api/usuario/:id', requireAuth, async (req, res) => {
  const userId = req.params.id;
  if (!isStaff(req.user) && String(req.user.uid) !== String(userId)) {
    return res.status(403).json({ msg: 'No tienes permiso para ver este usuario.' });
  }
  try {
    const [userRows] = await pool.execute(
      'SELECT nombre_completo, correo, telefono, membresia_estado, membresia_vence FROM usuarios WHERE id_usuario = ?',
      [userId]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ msg: 'Usuario no encontrado' });
    }
    const user = userRows[0];

    // Membresía con fallback seguro
    let membresia = { estado: user.membresia_estado || 'activa', vence: user.membresia_vence ? formatYYYYMMDD(new Date(user.membresia_vence)) : 'Activa' };
    try {
      const [memRows] = await pool.execute(
        "SELECT estado, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS vence FROM membresias WHERE id_usuario = ? ORDER BY fecha_fin DESC LIMIT 1",
        [userId]
      );
      if (memRows.length > 0 && memRows[0].vence) {
        membresia = memRows[0];
      }
    } catch (e) {
      // Usar fallback de campos de usuario en caso de excepción
    }

    // Rutinas
    let rutRows = [];
    try {
      const [rRows] = await pool.execute(
        'SELECT id_rutina, titulo, descripcion, horario FROM rutinas WHERE id_usuario = ? ORDER BY id_rutina DESC',
        [userId]
      );
      rutRows = rRows;
    } catch (rErr) {
      console.error('Error al obtener rutinas:', rErr.message);
    }

    // Cargar ejercicios para cada rutina
    const rutinasConEjercicios = await Promise.all(
      rutRows.map(async (r) => {
        try {
          const [ejercicios] = await pool.execute(
            'SELECT id_ejercicio, nombre_ejercicio, series, repeticiones, peso_kg, series_detalle_json, orden FROM ejercicios_rutina WHERE id_rutina = ? ORDER BY orden ASC, id_ejercicio ASC',
            [r.id_rutina]
          );
          return {
            ...r,
            ejercicios: ejercicios || []
          };
        } catch (ejErr) {
          console.error(`Error cargando ejercicios para rutina ${r.id_rutina}:`, ejErr.message);
          return { ...r, ejercicios: [] };
        }
      })
    );

    res.json({
      nombre: user.nombre_completo || 'Usuario',
      correo: user.correo,
      telefono: user.telefono || '',
      membresia,
      rutinas: rutinasConEjercicios
    });
  } catch (err) {
    console.error('Error en /api/usuario:', err);
    res.status(500).json({ msg: 'Error al obtener usuario. Intenta de nuevo o contacta al administrador.' });
  }
});

// Un cliente solo puede tocar sus propias rutinas; admin y recepción pueden tocar cualquiera
async function canTouchRoutine(user, routineId) {
  if (isStaff(user)) return true;
  const [rows] = await pool.execute('SELECT id_usuario FROM rutinas WHERE id_rutina = ?', [routineId]);
  return rows.length > 0 && String(rows[0].id_usuario) === String(user.uid);
}

// ---------- CREAR RUTINA CON EJERCICIOS ----------
app.post('/api/rutinas', requireAuth, async (req, res) => {
  const { titulo, descripcion, horario, ejercicios } = req.body;
  // Un cliente solo puede crear rutinas para sí mismo
  const id_usuario = isStaff(req.user) ? (req.body.id_usuario || req.user.uid) : req.user.uid;

  if (!id_usuario || !titulo) {
    return res.status(400).json({ msg: 'Título de rutina es obligatorio.' });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO rutinas (id_usuario, titulo, descripcion, horario) VALUES (?, ?, ?, ?)',
      [id_usuario, titulo, descripcion || '', horario || '']
    );
    const newRoutineId = result.insertId;

    if (Array.isArray(ejercicios) && ejercicios.length > 0) {
      for (let i = 0; i < ejercicios.length; i++) {
        const ej = ejercicios[i];
        await pool.execute(
          'INSERT INTO ejercicios_rutina (id_rutina, nombre_ejercicio, series, repeticiones, peso_kg, orden) VALUES (?, ?, ?, ?, ?, ?)',
          [
            newRoutineId,
            ej.nombre_ejercicio || `Ejercicio ${i + 1}`,
            parseInt(ej.series) || 3,
            parseInt(ej.repeticiones) || 10,
            parseFloat(ej.peso_kg) || 0,
            i + 1
          ]
        );
      }
    }

    res.status(201).json({ ok: true, msg: 'Rutina creada con éxito', id_rutina: newRoutineId });
  } catch (err) {
    console.error('Error en POST /api/rutinas:', err);
    res.status(500).json({ msg: 'Error al crear rutina. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- ACTUALIZAR / EDITAR RUTINA ----------
app.put('/api/rutinas/:id', requireAuth, async (req, res) => {
  const routineId = req.params.id;
  if (!(await canTouchRoutine(req.user, routineId))) return res.status(403).json({ msg: 'No tienes permiso para modificar esta rutina.' });
  const { titulo, descripcion, horario, ejercicios } = req.body;

  if (!titulo) {
    return res.status(400).json({ msg: 'Título de rutina es obligatorio.' });
  }

  try {
    await pool.execute(
      'UPDATE rutinas SET titulo = ?, descripcion = ?, horario = ? WHERE id_rutina = ?',
      [titulo, descripcion || '', horario || '', routineId]
    );

    // Eliminar ejercicios previos e insertar la lista actualizada
    await pool.execute('DELETE FROM ejercicios_rutina WHERE id_rutina = ?', [routineId]);

    if (Array.isArray(ejercicios) && ejercicios.length > 0) {
      for (let i = 0; i < ejercicios.length; i++) {
        const ej = ejercicios[i];
        const seriesDetalleJson = ej.series_detalle ? JSON.stringify(ej.series_detalle) : (ej.series_detalle_json ? (typeof ej.series_detalle_json === 'string' ? ej.series_detalle_json : JSON.stringify(ej.series_detalle_json)) : null);

        await pool.execute(
          'INSERT INTO ejercicios_rutina (id_rutina, nombre_ejercicio, series, repeticiones, peso_kg, series_detalle_json, orden) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            routineId,
            ej.nombre_ejercicio || `Ejercicio ${i + 1}`,
            parseInt(ej.series) || 3,
            parseInt(ej.repeticiones) || 10,
            parseFloat(ej.peso_kg) || 0,
            seriesDetalleJson,
            i + 1
          ]
        );
      }
    }

    res.json({ ok: true, msg: 'Rutina actualizada con éxito' });
  } catch (err) {
    console.error('Error en PUT /api/rutinas:', err);
    res.status(500).json({ msg: 'Error al actualizar rutina. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- ELIMINAR RUTINA ----------
app.delete('/api/rutinas/:id', requireAuth, async (req, res) => {
  const routineId = req.params.id;
  if (!(await canTouchRoutine(req.user, routineId))) return res.status(403).json({ msg: 'No tienes permiso para eliminar esta rutina.' });
  try {
    await pool.execute('DELETE FROM rutinas WHERE id_rutina = ?', [routineId]);
    res.json({ ok: true, msg: 'Rutina eliminada.' });
  } catch (err) {
    console.error('Error en DELETE /api/rutinas:', err);
    res.status(500).json({ msg: 'Error al eliminar rutina. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- REGISTRAR SESIÓN DE ENTRENAMIENTO (RUTINA DE HOY) ----------
app.post('/api/sesiones', requireAuth, async (req, res) => {
  const { id_rutina, detalle_json, ejercicios_actualizados } = req.body;
  const id_usuario = isStaff(req.user) ? (req.body.id_usuario || req.user.uid) : req.user.uid;
  if (id_rutina && !(await canTouchRoutine(req.user, id_rutina))) return res.status(403).json({ msg: 'No tienes permiso sobre esta rutina.' });

  if (!id_usuario || !id_rutina) {
    return res.status(400).json({ msg: 'Faltan datos de sesión' });
  }

  try {
    await pool.execute(
      'INSERT INTO historial_sesiones (id_usuario, id_rutina, detalle_json) VALUES (?, ?, ?)',
      [id_usuario, id_rutina, JSON.stringify(detalle_json)]
    );

    // Actualizar también los pesos / repeticiones por defecto en los ejercicios si el usuario los modificó
    if (Array.isArray(ejercicios_actualizados)) {
      for (const ej of ejercicios_actualizados) {
        if (ej.id_ejercicio) {
          const seriesDetalleJson = ej.series_detalle ? JSON.stringify(ej.series_detalle) : null;
          await pool.execute(
            'UPDATE ejercicios_rutina SET repeticiones = ?, peso_kg = ?, series_detalle_json = ? WHERE id_ejercicio = ? AND id_rutina = ?',
            [
              parseInt(ej.repeticiones) || 10,
              parseFloat(ej.peso_kg) || 0,
              seriesDetalleJson,
              ej.id_ejercicio,
              id_rutina
            ]
          );
        }
      }
    }

    res.json({ ok: true, msg: '¡Sesión de entrenamiento guardada correctamente!' });
  } catch (err) {
    console.error('Error en POST /api/sesiones:', err);
    res.status(500).json({ msg: 'Error al guardar sesión. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- RUTAS DE ADMINISTRACIÓN ----------

// Obtener todos los usuarios clientes con sus membresías, rutinas e historial de entrenamiento
app.get('/api/admin/usuarios', requireRole('admin', 'recepcion'), async (req, res) => {
  try {
    try { await pool.query('ALTER TABLE usuarios ADD COLUMN tiene_deuda TINYINT(1) DEFAULT 0'); } catch (e) { }
    try { await pool.query('ALTER TABLE usuarios ADD COLUMN membresia_estado VARCHAR(20) DEFAULT "activa"'); } catch (e) { }
    try { await pool.query('ALTER TABLE usuarios ADD COLUMN membresia_vence DATE NULL'); } catch (e) { }
    try { await pool.query('ALTER TABLE usuarios ADD COLUMN rol VARCHAR(30) NULL'); } catch (e) { }
    const [users] = await pool.query(
      "SELECT id_usuario, nombre_completo, correo, cedula, telefono, membresia_estado, membresia_vence, tiene_deuda, id_rol FROM usuarios WHERE (id_rol != 1 OR id_rol IS NULL) AND (rol != 'administrador' OR rol IS NULL) ORDER BY id_usuario DESC"
    );

    const usuariosCompletos = await Promise.all(
      users.map(async (u) => {
        // Membresía con fallback seguro
        let venceDefault = '-';
        if (u.membresia_vence) {
          venceDefault = formatYYYYMMDD(u.membresia_vence);
        }

        let membresia = {
          estado: u.membresia_estado || 'activa',
          vence: venceDefault
        };

        try {
          const [memRows] = await pool.query(
            "SELECT estado, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS vence FROM membresias WHERE id_usuario = ? ORDER BY fecha_fin DESC LIMIT 1",
            [u.id_usuario]
          );
          if (memRows.length > 0 && memRows[0].vence) {
            membresia = {
              estado: memRows[0].estado || 'activa',
              vence: formatYYYYMMDD(memRows[0].vence)
            };
          }
        } catch (e) { }

        // Plan del último pago que dio días de membresía (Mensualidad, Estudiante, Semana, Diario)
        let ultimo_plan = null;
        try {
          const [planRows] = await pool.execute(
            "SELECT plan FROM pagos WHERE id_usuario = ? AND plan <> 'Pago Deuda' ORDER BY fecha_fin_plan DESC, id_pago DESC LIMIT 1",
            [u.id_usuario]
          );
          if (planRows.length) ultimo_plan = planRows[0].plan;
        } catch (plErr) { }

        // Último Pago registrado para ordenar por fecha de pago
        let ultimo_pago = null;
        try {
          const [payRows] = await pool.execute(
            "SELECT DATE_FORMAT(MAX(fecha_pago), '%Y-%m-%d') as ultimo_pago FROM pagos WHERE id_usuario = ?",
            [u.id_usuario]
          );
          if (payRows.length && payRows[0].ultimo_pago) {
            ultimo_pago = payRows[0].ultimo_pago;
          }
        } catch (pErr) { }

        // Rutinas del usuario
        let rutinasConEjercicios = [];
        try {
          const [rutRows] = await pool.execute(
            'SELECT id_rutina, titulo, descripcion, horario FROM rutinas WHERE id_usuario = ? ORDER BY id_rutina DESC',
            [u.id_usuario]
          );

          rutinasConEjercicios = await Promise.all(
            rutRows.map(async (r) => {
              try {
                const [ejercicios] = await pool.execute(
                  'SELECT id_ejercicio, nombre_ejercicio, series, repeticiones, peso_kg, series_detalle_json FROM ejercicios_rutina WHERE id_rutina = ? ORDER BY orden ASC, id_ejercicio ASC',
                  [r.id_rutina]
                );
                return { ...r, ejercicios: ejercicios || [] };
              } catch (ejE) {
                return { ...r, ejercicios: [] };
              }
            })
          );
        } catch (rErr) { }

        // Historial de sesiones
        let sesiones = [];
        try {
          const [sesRows] = await pool.execute(
            'SELECT id_sesion, fecha, detalle_json FROM historial_sesiones WHERE id_usuario = ? ORDER BY fecha DESC LIMIT 10',
            [u.id_usuario]
          );
          sesiones = sesRows.map(s => ({
            ...s,
            detalle: typeof s.detalle_json === 'string' ? JSON.parse(s.detalle_json) : s.detalle_json
          }));
        } catch (sErr) { }

        return {
          ...u,
          ultimo_plan,
          tiene_deuda: u.tiene_deuda ? 1 : 0,
          membresia,
          ultimo_pago,
          rutinas: rutinasConEjercicios,
          sesiones
        };
      })
    );

    res.json({ ok: true, usuarios: usuariosCompletos });
  } catch (err) {
    console.error('Error en GET /api/admin/usuarios:', err);
    res.status(500).json({ msg: 'Error al obtener usuarios. Intenta de nuevo o contacta al administrador.' });
  }
});

// Crear un nuevo usuario cliente desde el panel de administración
app.post('/api/admin/usuarios', requireRole('admin', 'recepcion'), async (req, res) => {
  const { nombre_completo, correo, cedula, telefono } = req.body;

  if (!nombre_completo || !correo) {
    return res.status(400).json({ msg: 'El nombre completo y correo electrónico son obligatorios.' });
  }

  const cleanEmail = correo.trim().toLowerCase();
  const cleanCedula = cedula ? String(cedula).trim() : null;

  try {
    const [existing] = await pool.execute('SELECT id_usuario FROM usuarios WHERE correo = ?', [cleanEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ msg: 'El correo electrónico ya está registrado.' });
    }

    if (cleanCedula) {
      const [existingCed] = await pool.execute('SELECT id_usuario FROM usuarios WHERE cedula = ?', [cleanCedula]);
      if (existingCed.length > 0) {
        return res.status(400).json({ msg: 'La cédula de identidad ya está registrada por otro usuario.' });
      }
    }

    const dummyHash = await bcrypt.hash('cliente123', 10);
    const nombre_usuario = cleanEmail.split('@')[0] + Math.floor(Math.random() * 1000);

    const [result] = await pool.execute(
      'INSERT INTO usuarios (nombre_usuario, correo, cedula, telefono, hash_contrasena, password_hash, nombre_completo, id_rol, rol, tiene_deuda) VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?, 0)',
      [nombre_usuario, cleanEmail, cleanCedula, telefono || null, dummyHash, dummyHash, nombre_completo, 'cliente']
    );

    const newUserId = result.insertId;
    const fechaInicio = new Date();
    const fechaFin = new Date();

    await pool.execute(
      'INSERT INTO membresias (id_usuario, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?)',
      [newUserId, fechaInicio, fechaFin, 'sin membresia']
    );

    res.status(201).json({
      ok: true,
      msg: 'Usuario cliente creado exitosamente.',
      id_usuario: newUserId
    });
  } catch (err) {
    console.error('Error en POST /api/admin/usuarios:', err);
    res.status(500).json({ msg: 'Error al crear usuario. Intenta de nuevo o contacta al administrador.' });
  }
});

// Actualizar datos de un usuario cliente desde administración
app.put('/api/admin/usuarios/:id', requireRole('admin', 'recepcion'), async (req, res) => {
  const userId = req.params.id;
  const { nombre_completo, correo, cedula, telefono } = req.body;

  if (!nombre_completo || !correo) {
    return res.status(400).json({ msg: 'El nombre completo y correo electrónico son obligatorios.' });
  }

  const cleanEmail = correo.trim().toLowerCase();
  const cleanCedula = cedula ? String(cedula).trim() : null;

  try {
    const [existing] = await pool.execute(
      'SELECT id_usuario FROM usuarios WHERE correo = ? AND id_usuario != ?',
      [cleanEmail, userId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ msg: 'El correo electrónico ya está registrado por otro usuario.' });
    }

    if (cleanCedula) {
      const [existingCed] = await pool.execute(
        'SELECT id_usuario FROM usuarios WHERE cedula = ? AND id_usuario != ?',
        [cleanCedula, userId]
      );
      if (existingCed.length > 0) {
        return res.status(400).json({ msg: 'La cédula ya está registrada por otro usuario.' });
      }
    }

    await pool.execute(
      'UPDATE usuarios SET nombre_completo = ?, correo = ?, cedula = ?, telefono = ? WHERE id_usuario = ?',
      [nombre_completo.trim(), cleanEmail, cleanCedula, telefono ? telefono.trim() : null, userId]
    );

    res.json({ ok: true, msg: 'Datos del cliente actualizados exitosamente.' });
  } catch (err) {
    console.error('Error en PUT /api/admin/usuarios:', err);
    res.status(500).json({ msg: 'Error al actualizar cliente. Intenta de nuevo o contacta al administrador.' });
  }
});

// Registrar pago y actualizar membresía según plan contratado
app.post('/api/admin/pagos', requireRole('admin', 'recepcion'), async (req, res) => {
  const { id_usuario, monto, moneda, plan, fecha_pago, es_abono, turno } = req.body;

  if (!id_usuario || !monto || !moneda || !plan || !fecha_pago) {
    return res.status(400).json({ msg: 'Todos los campos del pago son obligatorios.' });
  }

  const esAbonoVal = (es_abono === true || es_abono === 1 || es_abono === '1' || es_abono === 'true') ? 1 : 0;

  try {
    // Asegurar que las columnas existan defensivamente en la base de datos de Aiven
    try { await pool.query('ALTER TABLE pagos ADD COLUMN es_abono TINYINT(1) DEFAULT 0'); } catch (e) { }
    try { await pool.query("ALTER TABLE pagos ADD COLUMN turno ENUM('AM','PM') DEFAULT NULL AFTER es_abono"); } catch (e) { }
    try { await pool.query('ALTER TABLE pagos MODIFY COLUMN moneda VARCHAR(20) NOT NULL'); } catch (e) { }
    try { await pool.query('ALTER TABLE usuarios ADD COLUMN tiene_deuda TINYINT(1) DEFAULT 0'); } catch (e) { }

    const turnoVal = (turno === 'AM' || turno === 'PM') ? turno : null;

    let diasPlan = 0;
    if (plan === 'Mensualidad' || plan === 'Estudiante') diasPlan = 30;
    else if (plan === 'Semana') diasPlan = 7;
    else if (plan === 'Diario') diasPlan = 1;
    else if (plan === 'Pago Deuda') diasPlan = 0;

    const [memRows] = await pool.execute(
      'SELECT id_membresia, fecha_fin, estado FROM membresias WHERE id_usuario = ? ORDER BY fecha_fin DESC LIMIT 1',
      [id_usuario]
    );

    // Fecha en que corre el plan (La seleccionada por el administrador)
    const planStartObj = parseLocalYYYYMMDD(fecha_pago);
    let baseDate = new Date(planStartObj);

    if (memRows.length > 0) {
      const currentFin = parseLocalYYYYMMDD(memRows[0].fecha_fin);
      if (memRows[0].estado === 'activa' && currentFin >= planStartObj) {
        baseDate = currentFin;
      }
    }

    const newFinDate = new Date(baseDate);
    newFinDate.setDate(newFinDate.getDate() + diasPlan);

    const planStartStr = formatYYYYMMDD(planStartObj);
    const newFinStr = formatYYYYMMDD(newFinDate);

    // Fecha de realización del pago en la vida real (Hoy en la zona horaria local America/Caracas)
    const fechaRealizacionStr = getTodayYMD();

    // Obtener nombre del cliente para respaldar el historial en caso de eliminación futura
    const [uRows] = await pool.execute('SELECT nombre_completo FROM usuarios WHERE id_usuario = ?', [id_usuario]);
    const nombreClienteStr = uRows.length > 0 ? uRows[0].nombre_completo : null;

    // Guardar el pago:
    await pool.execute(
      'INSERT INTO pagos (id_usuario, nombre_cliente, monto, moneda, plan, fecha_pago, fecha_inicio_plan, fecha_fin_plan, es_abono, turno) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id_usuario, nombreClienteStr, parseFloat(monto) || 0, moneda, plan, fechaRealizacionStr, planStartStr, newFinStr, esAbonoVal, turnoVal]
    );

    // Actualizar estado de deuda del usuario (1 si es abono parcial, 0 si se saldó o pagó completo)
    await pool.execute(
      'UPDATE usuarios SET tiene_deuda = ? WHERE id_usuario = ?',
      [esAbonoVal, id_usuario]
    );

    if (memRows.length > 0) {
      await pool.execute(
        'UPDATE membresias SET fecha_inicio = ?, fecha_fin = ?, estado = ? WHERE id_membresia = ?',
        [planStartStr, newFinStr, 'activa', memRows[0].id_membresia]
      );
    } else {
      await pool.execute(
        'INSERT INTO membresias (id_usuario, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?)',
        [id_usuario, planStartStr, newFinStr, 'activa']
      );
    }

    res.status(201).json({
      ok: true,
      msg: esAbonoVal ? '¡Abono registrado! El cliente ha quedado marcado con deuda pendiente.' : '¡Pago registrado correctamente y membresía actualizada!',
      vence: newFinStr,
      tiene_deuda: esAbonoVal
    });
  } catch (err) {
    console.error('Error en POST /api/admin/pagos:', err);
    res.status(500).json({ msg: 'Error al registrar pago. Intenta de nuevo o contacta al administrador.' });
  }
});

// Obtener historial de pagos filtrado por fecha o por búsqueda de cliente (Preserva historial aun si se elimina el cliente)
app.get('/api/admin/pagos', requireRole('admin'), async (req, res) => {
  try {
    try { await pool.query('ALTER TABLE pagos ADD COLUMN es_abono TINYINT(1) DEFAULT 0'); } catch (e) { }
    try { await pool.query("ALTER TABLE pagos ADD COLUMN turno ENUM('AM','PM') DEFAULT NULL AFTER es_abono"); } catch (e) { }
    const { fecha, q, usuario_id } = req.query;
    let querySql = `
      SELECT p.id_pago, p.monto, p.moneda, p.plan, p.es_abono, p.turno,
             DATE_FORMAT(p.fecha_pago, '%Y-%m-%d') as fecha_pago,
             DATE_FORMAT(p.fecha_inicio_plan, '%Y-%m-%d') as fecha_inicio_plan,
             DATE_FORMAT(p.fecha_fin_plan, '%Y-%m-%d') as fecha_fin_plan,
             COALESCE(u.nombre_completo, p.nombre_cliente, 'Cliente Eliminado') as nombre_completo,
             COALESCE(u.correo, 'Cliente Eliminado') as correo,
             COALESCE(u.cedula, 'Sin cédula') as cedula,
             COALESCE(u.telefono, 'Sin teléfono') as telefono
      FROM pagos p
      LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
    `;
    let queryParams = [];

    if (usuario_id) {
      querySql += ` WHERE p.id_usuario = ? ORDER BY p.id_pago DESC`;
      queryParams.push(usuario_id);
    } else if (q && q.trim() !== '') {
      const searchTerm = `%${q.trim()}%`;
      querySql += ` WHERE (u.nombre_completo LIKE ? OR p.nombre_cliente LIKE ? OR u.correo LIKE ? OR u.cedula LIKE ? OR u.telefono LIKE ?) ORDER BY p.id_pago DESC LIMIT 100`;
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    } else if (req.query.fecha_inicio && req.query.fecha_fin) {
      querySql += ` WHERE DATE(p.fecha_pago) BETWEEN ? AND ? ORDER BY p.id_pago DESC`;
      queryParams.push(req.query.fecha_inicio, req.query.fecha_fin);
    } else {
      const targetDate = fecha || getTodayYMD();
      querySql += ` WHERE DATE(p.fecha_pago) = ? ORDER BY p.id_pago DESC`;
      queryParams.push(targetDate);
    }

    const [rows] = await pool.execute(querySql, queryParams);

    let totalUSD = 0;
    let totalCOP = 0;
    let totalBS = 0;
    let totalBancolombia = 0;
    let totalUSDT = 0;
    let totalCLP = 0;

    rows.forEach(p => {
      const val = parseFloat(p.monto) || 0;
      if (p.moneda === 'USD') totalUSD += val;
      else if (p.moneda === 'COP') totalCOP += val;
      else if (p.moneda === 'BS') totalBS += val;
      else if (p.moneda === 'Bancolombia') totalBancolombia += val;
      else if (p.moneda === 'USDT') totalUSDT += val;
      else if (p.moneda === 'CLP') totalCLP += val;
    });

    res.json({
      ok: true,
      pagos: rows,
      totales: {
        USD: totalUSD.toFixed(2),
        COP: totalCOP.toFixed(2),
        BS: totalBS.toFixed(2),
        Bancolombia: totalBancolombia.toFixed(2),
        USDT: totalUSDT.toFixed(2),
        CLP: totalCLP.toFixed(2)
      }
    });
  } catch (err) {
    console.error('Error en GET /api/admin/pagos:', err);
    res.status(500).json({ msg: 'Error al obtener pagos. Intenta de nuevo o contacta al administrador.' });
  }
});

// Editar un pago existente en el historial
app.put('/api/admin/pagos/:id', requireRole('admin'), async (req, res) => {
  const pagoId = req.params.id;
  const { monto, moneda, plan, fecha_pago, fecha_inicio_plan, fecha_fin_plan, es_abono, turno } = req.body;

  try {
    const esAbonoVal = (es_abono === true || es_abono === 1 || es_abono === '1' || es_abono === 'true') ? 1 : 0;
    const turnoVal = (turno === 'AM' || turno === 'PM') ? turno : null;

    await pool.execute(
      `UPDATE pagos 
       SET monto = ?, moneda = ?, plan = ?, fecha_pago = ?, fecha_inicio_plan = ?, fecha_fin_plan = ?, es_abono = ?, turno = ?
       WHERE id_pago = ?`,
      [parseFloat(monto) || 0, moneda, plan, fecha_pago, fecha_inicio_plan, fecha_fin_plan, esAbonoVal, turnoVal, pagoId]
    );

    res.json({ ok: true, msg: 'Pago actualizado exitosamente.' });
  } catch (err) {
    console.error('Error en PUT /api/admin/pagos:', err);
    res.status(500).json({ msg: 'Error al actualizar pago. Intenta de nuevo o contacta al administrador.' });
  }
});

// Eliminar un usuario cliente con validación de contraseña de administrador
app.delete('/api/admin/usuarios/:id', requireRole('admin'), async (req, res) => {
  const userId = req.params.id;
  const { admin_password } = req.body;

  if (!admin_password) {
    return res.status(400).json({ msg: 'Se requiere la contraseña de Administrador para eliminar un cliente.' });
  }

  try {
    const [adminRows] = await pool.execute('SELECT hash_contrasena FROM usuarios WHERE correo = ?', [ADMIN_EMAIL]);

    if (adminRows.length === 0) {
      return res.status(400).json({ msg: 'No se encontró la cuenta de Administrador.' });
    }

    const isMatch = await bcrypt.compare(admin_password, adminRows[0].hash_contrasena);
    if (!isMatch) {
      return res.status(401).json({ msg: 'Contraseña de Administrador incorrecta. No se pudo eliminar el cliente.' });
    }

    await pool.execute('DELETE FROM usuarios WHERE id_usuario = ? AND id_rol != 1', [userId]);
    res.json({ ok: true, msg: 'Usuario cliente eliminado con éxito.' });
  } catch (err) {
    console.error('Error en DELETE /api/admin/usuarios:', err);
    res.status(500).json({ msg: 'Error al eliminar usuario. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- ASISTENCIAS (CONTROL DE ENTRADA) ----------
function isValidDateStr(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d); }
function isValidTimeStr(t) { return typeof t === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(t); }

// Registrar la entrada de un cliente. Fecha y hora llegan del equipo de recepción (hora local del gimnasio).
app.post('/api/admin/asistencias', requireRole('admin', 'recepcion'), async (req, res) => {
  const { id_usuario, fecha, hora, forzar } = req.body;
  if (!id_usuario || !isValidDateStr(fecha) || !isValidTimeStr(hora)) {
    return res.status(400).json({ ok: false, msg: 'Faltan datos para registrar la entrada.' });
  }
  try {
    const [users] = await pool.execute(
      'SELECT id_usuario, nombre_completo, tiene_deuda FROM usuarios WHERE id_usuario = ?', [id_usuario]
    );
    if (!users.length) return res.status(404).json({ ok: false, msg: 'Cliente no encontrado.' });
    const u = users[0];

    // ¿Ya entró hoy? Se avisa, salvo que recepción confirme registrarlo otra vez
    const [prev] = await pool.execute(
      "SELECT id_asistencia, TIME_FORMAT(hora, '%H:%i') AS hora FROM asistencias WHERE id_usuario = ? AND fecha = ? ORDER BY hora DESC LIMIT 1",
      [id_usuario, fecha]
    );
    if (prev.length && !forzar) {
      return res.json({ ok: true, ya_registrado: true, hora_anterior: prev[0].hora });
    }

    // Estado de la membresía al momento de entrar (queda guardado aunque luego cambie)
    const [mem] = await pool.execute(
      "SELECT estado, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS vence FROM membresias WHERE id_usuario = ? ORDER BY fecha_fin DESC LIMIT 1",
      [id_usuario]
    );
    let estado = 'sin_membresia';
    if (mem.length) {
      estado = (mem[0].estado === 'activa' && mem[0].vence >= fecha) ? 'activa' : 'vencida';
    }
    const [planRows] = await pool.execute(
      "SELECT plan FROM pagos WHERE id_usuario = ? AND plan <> 'Pago Deuda' ORDER BY fecha_fin_plan DESC, id_pago DESC LIMIT 1",
      [id_usuario]
    );
    const plan = planRows.length ? planRows[0].plan : null;

    const [result] = await pool.execute(
      'INSERT INTO asistencias (id_usuario, nombre_cliente, fecha, hora, estado_membresia, plan, tenia_deuda, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id_usuario, u.nombre_completo, fecha, hora, estado, plan, u.tiene_deuda ? 1 : 0, req.user.uid]
    );
    res.json({ ok: true, id_asistencia: result.insertId, estado_membresia: estado });
  } catch (err) {
    console.error('Error registrando asistencia:', err);
    res.status(500).json({ ok: false, msg: 'Error al registrar la entrada. Intenta de nuevo.' });
  }
});

// Entradas de un día
app.get('/api/admin/asistencias', requireRole('admin', 'recepcion'), async (req, res) => {
  const fecha = req.query.fecha;
  if (!isValidDateStr(fecha)) return res.status(400).json({ ok: false, msg: 'Fecha inválida.' });
  try {
    const [rows] = await pool.execute(
      `SELECT a.id_asistencia, a.id_usuario, COALESCE(u.nombre_completo, a.nombre_cliente) AS nombre_completo,
              u.cedula, TIME_FORMAT(a.hora, '%H:%i') AS hora, a.estado_membresia, a.plan, a.tenia_deuda
         FROM asistencias a LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario
        WHERE a.fecha = ? ORDER BY a.hora DESC, a.id_asistencia DESC`,
      [fecha]
    );
    res.json({ ok: true, asistencias: rows });
  } catch (err) {
    console.error('Error obteniendo asistencias:', err);
    res.status(500).json({ ok: false, msg: 'Error al obtener las entradas del día.' });
  }
});

// Anular una entrada registrada por error
app.delete('/api/admin/asistencias/:id', requireRole('admin', 'recepcion'), async (req, res) => {
  try {
    await pool.execute('DELETE FROM asistencias WHERE id_asistencia = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando asistencia:', err);
    res.status(500).json({ ok: false, msg: 'Error al anular la entrada.' });
  }
});

// ---------- RUTAS DE PLANTILLAS DE RUTINAS ----------

// Obtener todas las plantillas de rutinas
app.get('/api/plantillas', requireAuth, async (req, res) => {
  try {
    const [plantillas] = await pool.execute('SELECT id_plantilla, titulo, descripcion, horario FROM plantillas_rutinas ORDER BY id_plantilla DESC');

    const result = await Promise.all(
      plantillas.map(async (p) => {
        const [ejercicios] = await pool.execute(
          'SELECT id_ejercicio_plantilla, nombre_ejercicio, series, repeticiones, peso_kg, series_detalle_json FROM ejercicios_plantilla WHERE id_plantilla = ? ORDER BY orden ASC, id_ejercicio_plantilla ASC',
          [p.id_plantilla]
        );
        return { ...p, ejercicios };
      })
    );

    res.json({ ok: true, plantillas: result });
  } catch (err) {
    console.error('Error en GET /api/plantillas:', err);
    res.status(500).json({ msg: 'Error al obtener plantillas. Intenta de nuevo o contacta al administrador.' });
  }
});

// Crear una plantilla de rutina por el administrador
app.post('/api/admin/plantillas', requireRole('admin', 'recepcion'), async (req, res) => {
  const { titulo, descripcion, horario, ejercicios } = req.body;

  if (!titulo || !Array.isArray(ejercicios) || ejercicios.length === 0) {
    return res.status(400).json({ msg: 'El título y al menos un ejercicio son obligatorios.' });
  }

  try {
    const [resP] = await pool.execute(
      'INSERT INTO plantillas_rutinas (titulo, descripcion, horario) VALUES (?, ?, ?)',
      [titulo.trim(), descripcion || null, horario || null]
    );

    const plantillaId = resP.insertId;

    for (let i = 0; i < ejercicios.length; i++) {
      const ej = ejercicios[i];
      const seriesDetalleJson = ej.series_detalle ? JSON.stringify(ej.series_detalle) : null;
      await pool.execute(
        'INSERT INTO ejercicios_plantilla (id_plantilla, nombre_ejercicio, series, repeticiones, peso_kg, series_detalle_json, orden) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [plantillaId, ej.nombre_ejercicio, parseInt(ej.series) || 3, parseInt(ej.repeticiones) || 10, parseFloat(ej.peso_kg) || 0, seriesDetalleJson, i + 1]
      );
    }

    res.status(201).json({ ok: true, msg: 'Plantilla de rutina creada con éxito.', id_plantilla: plantillaId });
  } catch (err) {
    console.error('Error en POST /api/admin/plantillas:', err);
    res.status(500).json({ msg: 'Error al crear plantilla. Intenta de nuevo o contacta al administrador.' });
  }
});

// Actualizar una plantilla de rutina por el administrador
app.put('/api/admin/plantillas/:id', requireRole('admin', 'recepcion'), async (req, res) => {
  const plantillaId = req.params.id;
  const { titulo, descripcion, horario, ejercicios } = req.body;

  if (!titulo || !Array.isArray(ejercicios) || ejercicios.length === 0) {
    return res.status(400).json({ msg: 'El título y al menos un ejercicio son obligatorios.' });
  }

  try {
    await pool.execute(
      'UPDATE plantillas_rutinas SET titulo = ?, descripcion = ?, horario = ? WHERE id_plantilla = ?',
      [titulo.trim(), descripcion || null, horario || null, plantillaId]
    );

    await pool.execute('DELETE FROM ejercicios_plantilla WHERE id_plantilla = ?', [plantillaId]);

    for (let i = 0; i < ejercicios.length; i++) {
      const ej = ejercicios[i];
      const seriesDetalleJson = ej.series_detalle ? JSON.stringify(ej.series_detalle) : null;
      await pool.execute(
        'INSERT INTO ejercicios_plantilla (id_plantilla, nombre_ejercicio, series, repeticiones, peso_kg, series_detalle_json, orden) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [plantillaId, ej.nombre_ejercicio, parseInt(ej.series) || 3, parseInt(ej.repeticiones) || 10, parseFloat(ej.peso_kg) || 0, seriesDetalleJson, i + 1]
      );
    }

    res.json({ ok: true, msg: 'Plantilla de rutina actualizada con éxito.' });
  } catch (err) {
    console.error('Error en PUT /api/admin/plantillas:', err);
    res.status(500).json({ msg: 'Error al actualizar plantilla. Intenta de nuevo o contacta al administrador.' });
  }
});

// Eliminar plantilla de rutina por el administrador
app.delete('/api/admin/plantillas/:id', requireRole('admin', 'recepcion'), async (req, res) => {
  const plantillaId = req.params.id;
  try {
    await pool.execute('DELETE FROM plantillas_rutinas WHERE id_plantilla = ?', [plantillaId]);
    res.json({ ok: true, msg: 'Plantilla eliminada con éxito.' });
  } catch (err) {
    console.error('Error en DELETE /api/admin/plantillas:', err);
    res.status(500).json({ msg: 'Error al eliminar plantilla. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- RUTAS: MATERIAL Y CONTENIDO ADICIONAL ----------

// Listar recursos de apoyo
app.get('/api/recursos', requireAuth, async (req, res) => {
  const { categoria } = req.query;
  try {
    let query = 'SELECT * FROM recursos_apoyo';
    let params = [];
    if (categoria && categoria !== 'todas') {
      query += ' WHERE categoria = ?';
      params.push(categoria);
    }
    query += ' ORDER BY id_recurso DESC';
    const [rows] = await pool.execute(query, params);
    res.json({ ok: true, recursos: rows });
  } catch (err) {
    console.error('Error en GET /api/recursos:', err);
    res.status(500).json({ msg: 'Error al obtener contenido adicional.' });
  }
});

// Crear recurso de apoyo (Archivo o Enlace)
app.post('/api/admin/recursos', requireRole('admin'), (req, res, next) => {
  upload.single('archivo')(req, res, (err) => {
    if (err) {
      console.error('Error en Multer upload:', err);
      return res.status(400).json({ ok: false, msg: 'Error en la carga del archivo. Intenta de nuevo o contacta al administrador.' });
    }
    next();
  });
}, async (req, res) => {
  const { titulo, descripcion, categoria, tipo_recurso, url_enlace } = req.body || {};

  if (!titulo || !titulo.trim()) {
    return res.status(400).json({ ok: false, msg: 'El título del material es obligatorio.' });
  }

  let finalTipo = tipo_recurso || 'enlace';
  let finalUrl = '';
  let nombreOrig = null;

  if (req.file) {
    finalTipo = 'archivo';
    const mimeType = req.file.mimetype || 'image/png';
    const base64Str = req.file.buffer.toString('base64');
    finalUrl = `data:${mimeType};base64,${base64Str}`;
    nombreOrig = req.file.originalname;
  } else if (url_enlace && url_enlace.trim()) {
    finalTipo = 'enlace';
    finalUrl = url_enlace.trim();
  } else {
    return res.status(400).json({ ok: false, msg: 'Debes adjuntar un archivo o ingresar una URL de enlace.' });
  }

  try {
    // Asegurar que la columna url_recurso sea LONGTEXT en Aiven MySQL
    try {
      await pool.query('ALTER TABLE recursos_apoyo MODIFY COLUMN url_recurso LONGTEXT NOT NULL');
    } catch (e) { }

    const [result] = await pool.query(
      'INSERT INTO recursos_apoyo (titulo, descripcion, categoria, tipo_recurso, url_recurso, nombre_archivo_orig) VALUES (?, ?, ?, ?, ?, ?)',
      [titulo.trim(), descripcion || null, categoria || 'General', finalTipo, finalUrl, nombreOrig]
    );

    res.json({ ok: true, id_recurso: result.insertId, msg: 'Material y Contenido Adicional agregado con éxito.' });
  } catch (err) {
    console.error('Error en POST /api/admin/recursos:', err);
    res.status(500).json({ ok: false, msg: 'Error al guardar material. Intenta de nuevo o contacta al administrador.' });
  }
});

// Eliminar recurso de apoyo
app.delete('/api/admin/recursos/:id', requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  try {
    const [rows] = await pool.query('SELECT * FROM recursos_apoyo WHERE id_recurso = ?', [id]);
    if (rows.length > 0) {
      const recurso = rows[0];
      if (recurso.tipo_recurso === 'archivo' && recurso.url_recurso.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', recurso.url_recurso);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) { console.error('Error eliminando archivo físico:', e); }
        }
      }
      await pool.query('DELETE FROM recursos_apoyo WHERE id_recurso = ?', [id]);
    }
    res.json({ ok: true, msg: 'Material eliminado con éxito.' });
  } catch (err) {
    console.error('Error en DELETE /api/admin/recursos:', err);
    res.status(500).json({ ok: false, msg: 'Error al eliminar material. Intenta de nuevo o contacta al administrador.' });
  }
});

// ---------- TEST PING ----------
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, message: 'Backend ATLAS activo con MySQL' });
});

// ---------- RUTAS DE PÁGINAS Y FALLBACK ----------
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
app.get('/index', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));

app.get('/dashboard', (req, res) => res.sendFile(path.join(publicPath, 'dashboard.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(publicPath, 'dashboard.html')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, msg: 'Ruta API no encontrada' });
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Manejador global de errores Express para evitar cierres 502
app.use((err, req, res, next) => {
  console.error('❌ Error no controlado en Express:', err);
  res.status(500).json({ ok: false, msg: 'Error interno del servidor.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ATLAS Backend activo en el puerto ${PORT}`);
});

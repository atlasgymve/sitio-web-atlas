const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

/* Helper de Fechas sin desfase de Zona Horaria */
function formatYYYYMMDD(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalYYYYMMDD(str) {
  if (!str) return new Date();
  const parts = String(str).split('T')[0].split('-');
  if (parts.length < 3) return new Date();
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Servir archivos estáticos del frontend (HTML, CSS, JS, imágenes)
const publicPath = path.join(__dirname, '..');
app.use(express.static(publicPath));
app.use('/assets', express.static(path.join(publicPath, 'assets')));

// Carpeta de archivos subidos
const uploadsDir = path.join(publicPath, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Configuración de Multer para carga de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'recurso-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage: storage });

// Pool de conexión MySQL (Soporta Variables de Entorno para Render / Cloud DB)
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'loreto2005',
  database: process.env.DB_NAME || 'atlas',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Asegurar que la tabla recursos_apoyo exista
pool.execute(`
  CREATE TABLE IF NOT EXISTS recursos_apoyo (
    id_recurso INT AUTO_INCREMENT PRIMARY KEY,
    titulo VARCHAR(150) NOT NULL,
    descripcion TEXT NULL,
    categoria VARCHAR(50) NOT NULL DEFAULT 'General',
    tipo_recurso ENUM('archivo', 'enlace') NOT NULL DEFAULT 'enlace',
    url_recurso TEXT NOT NULL,
    nombre_archivo_orig VARCHAR(255) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`).then(() => console.log('✅ Tabla "recursos_apoyo" verificada'))
  .catch(err => console.error('Error verificando recursos_apoyo:', err.message));

// Asegurar que la columna series_detalle_json exista
pool.execute('ALTER TABLE ejercicios_rutina ADD COLUMN series_detalle_json TEXT NULL AFTER peso_kg')
  .then(() => console.log('✅ Columna "series_detalle_json" verificada/agregada en ejercicios_rutina'))
  .catch(err => {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('Error al verificar columna series_detalle_json:', err.message);
    }
  });

// Asegurar que la tabla pagos exista con las columnas de plan
pool.execute(`
  CREATE TABLE IF NOT EXISTS pagos (
    id_pago INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario BIGINT UNSIGNED NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    moneda VARCHAR(10) NOT NULL,
    plan VARCHAR(50) NOT NULL,
    fecha_pago DATE NOT NULL,
    fecha_inicio_plan DATE NULL,
    fecha_fin_plan DATE NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pago_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`).then(async () => {
  try {
    await pool.execute('ALTER TABLE pagos ADD COLUMN fecha_inicio_plan DATE NULL AFTER fecha_pago');
    await pool.execute('ALTER TABLE pagos ADD COLUMN fecha_fin_plan DATE NULL AFTER fecha_inicio_plan');
  } catch (e) { }
  console.log('✅ Tabla "pagos" verificada en MySQL');
}).catch(err => console.error('Error al verificar tabla pagos:', err.message));

// Asegurar cuenta de Administrador por defecto (atlasgymve@gmail.com / atlas1297)
(async function seedAdminUser() {
  try {
    const adminEmail = 'atlasgymve@gmail.com';
    const adminPass = 'atlas1297';
    const hash = await bcrypt.hash(adminPass, 10);

    const [rows] = await pool.execute('SELECT id_usuario FROM usuarios WHERE correo = ?', [adminEmail]);
    if (rows.length === 0) {
      await pool.execute(
        'INSERT INTO usuarios (nombre_usuario, correo, hash_contrasena, nombre_completo, id_rol) VALUES (?, ?, ?, ?, 1)',
        ['admin_atlas', adminEmail, hash, 'Administrador ATLAS']
      );
      console.log('✅ Cuenta de Administrador creada (atlasgymve@gmail.com).');
    } else {
      await pool.execute(
        'UPDATE usuarios SET hash_contrasena = ?, id_rol = 1 WHERE correo = ?',
        [hash, adminEmail]
      );
      console.log('✅ Cuenta de Administrador verificada/actualizada.');
    }
  } catch (err) {
    console.error('Error al sembrar usuario administrador:', err.message);
  }
})();

// ---------- REGISTRO DE USUARIO ----------
app.post('/api/registro', async (req, res) => {
  const { nombre_completo, correo, telefono, password } = req.body;

  if (!nombre_completo || !correo || !password) {
    return res.status(400).json({ msg: 'Nombre, correo y contraseña son obligatorios.' });
  }

  try {
    // Comprobar si ya existe el correo
    const [existing] = await pool.execute('SELECT id_usuario FROM usuarios WHERE correo = ?', [correo]);
    if (existing.length > 0) {
      return res.status(400).json({ msg: 'El correo electrónico ya está registrado.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const nombre_usuario = correo.split('@')[0] + Math.floor(Math.random() * 1000);

    const [result] = await pool.execute(
      'INSERT INTO usuarios (nombre_usuario, correo, telefono, hash_contrasena, nombre_completo, id_rol) VALUES (?, ?, ?, ?, ?, 2)',
      [nombre_usuario, correo, telefono || null, hash, nombre_completo]
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
    res.status(500).json({ msg: `Error en el servidor: ${err.message}` });
  }
});

// ---------- LOGIN ----------
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ msg: 'Por favor ingresa tu correo electrónico.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const [rows] = await pool.execute(
      'SELECT id_usuario, nombre_completo, hash_contrasena, id_rol FROM usuarios WHERE correo = ?',
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(404).json({ msg: 'Usuario no registrado. Por favor solicita tu acceso al Administrador.' });
    }

    const user = rows[0];

    // Si es el Administrador o id_rol === 1, se exige contraseña
    if (cleanEmail === 'atlasgymve@gmail.com' || user.id_rol === 1) {
      if (!password) {
        return res.status(400).json({ msg: 'Por favor ingresa la contraseña de administrador.' });
      }
      const match = await bcrypt.compare(password, user.hash_contrasena);
      if (!match) {
        return res.status(401).json({ msg: 'Contraseña de administrador incorrecta.' });
      }
      return res.json({
        ok: true,
        id_usuario: user.id_usuario,
        nombre: user.nombre_completo || 'Administrador',
        esAdmin: true
      });
    }

    // Para clientes regulares: Inicio de sesión directo solo con correo
    res.json({
      ok: true,
      id_usuario: user.id_usuario,
      nombre: user.nombre_completo || 'Cliente',
      esAdmin: false
    });
  } catch (err) {
    console.error('Error en /api/login:', err);
    res.status(500).json({ msg: `Error de base de datos: ${err.message}` });
  }
});

// ---------- DATOS DEL USUARIO Y SUS RUTINAS ----------
app.get('/api/usuario/:id', async (req, res) => {
  const userId = req.params.id;
  try {
    const [userRows] = await pool.execute(
      'SELECT nombre_completo, correo, telefono FROM usuarios WHERE id_usuario = ?',
      [userId]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ msg: 'Usuario no encontrado' });
    }
    const user = userRows[0];

    // Membresía
    const [memRows] = await pool.execute(
      "SELECT estado, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS vence FROM membresias WHERE id_usuario = ? ORDER BY fecha_fin DESC LIMIT 1",
      [userId]
    );
    const membresia = memRows.length ? memRows[0] : { estado: 'sin membresía', vence: '-' };

    // Rutinas
    const [rutRows] = await pool.execute(
      'SELECT id_rutina, titulo, descripcion, horario FROM rutinas WHERE id_usuario = ? ORDER BY id_rutina DESC',
      [userId]
    );

    // Cargar ejercicios para cada rutina
    const rutinasConEjercicios = await Promise.all(
      rutRows.map(async (r) => {
        const [ejercicios] = await pool.execute(
          'SELECT id_ejercicio, nombre_ejercicio, series, repeticiones, peso_kg, series_detalle_json, orden FROM ejercicios_rutina WHERE id_rutina = ? ORDER BY orden ASC, id_ejercicio ASC',
          [r.id_rutina]
        );
        return {
          ...r,
          ejercicios
        };
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
    res.status(500).json({ msg: `Error al obtener usuario: ${err.message}` });
  }
});

// ---------- CREAR RUTINA CON EJERCICIOS ----------
app.post('/api/rutinas', async (req, res) => {
  const { id_usuario, titulo, descripcion, horario, ejercicios } = req.body;

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
    res.status(500).json({ msg: `Error al crear rutina: ${err.message}` });
  }
});

// ---------- ACTUALIZAR / EDITAR RUTINA ----------
app.put('/api/rutinas/:id', async (req, res) => {
  const routineId = req.params.id;
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
    res.status(500).json({ msg: `Error al actualizar rutina: ${err.message}` });
  }
});

// ---------- ELIMINAR RUTINA ----------
app.delete('/api/rutinas/:id', async (req, res) => {
  const routineId = req.params.id;
  try {
    await pool.execute('DELETE FROM rutinas WHERE id_rutina = ?', [routineId]);
    res.json({ ok: true, msg: 'Rutina eliminada.' });
  } catch (err) {
    console.error('Error en DELETE /api/rutinas:', err);
    res.status(500).json({ msg: `Error al eliminar rutina: ${err.message}` });
  }
});

// ---------- REGISTRAR SESIÓN DE ENTRENAMIENTO (RUTINA DE HOY) ----------
app.post('/api/sesiones', async (req, res) => {
  const { id_usuario, id_rutina, detalle_json, ejercicios_actualizados } = req.body;

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
            'UPDATE ejercicios_rutina SET repeticiones = ?, peso_kg = ?, series_detalle_json = ? WHERE id_ejercicio = ?',
            [
              parseInt(ej.repeticiones) || 10,
              parseFloat(ej.peso_kg) || 0,
              seriesDetalleJson,
              ej.id_ejercicio
            ]
          );
        }
      }
    }

    res.json({ ok: true, msg: '¡Sesión de entrenamiento guardada correctamente!' });
  } catch (err) {
    console.error('Error en POST /api/sesiones:', err);
    res.status(500).json({ msg: `Error al guardar sesión: ${err.message}` });
  }
});

// ---------- RUTAS DE ADMINISTRACIÓN ----------

// Obtener todos los usuarios clientes con sus membresías, rutinas e historial de entrenamiento
app.get('/api/admin/usuarios', async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id_usuario, nombre_completo, correo, telefono FROM usuarios WHERE id_rol != 1 ORDER BY id_usuario DESC'
    );

    const usuariosCompletos = await Promise.all(
      users.map(async (u) => {
        // Membresía
        const [memRows] = await pool.execute(
          "SELECT estado, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS vence FROM membresias WHERE id_usuario = ? ORDER BY fecha_fin DESC LIMIT 1",
          [u.id_usuario]
        );
        const membresia = memRows.length ? memRows[0] : { estado: 'sin membresía', vence: '-' };

        // Último Pago registrado para ordenar por fecha de pago
        const [payRows] = await pool.execute(
          "SELECT DATE_FORMAT(MAX(fecha_pago), '%Y-%m-%d') as ultimo_pago FROM pagos WHERE id_usuario = ?",
          [u.id_usuario]
        );
        const ultimo_pago = (payRows.length && payRows[0].ultimo_pago) ? payRows[0].ultimo_pago : null;

        // Rutinas del usuario
        const [rutRows] = await pool.execute(
          'SELECT id_rutina, titulo, descripcion, horario FROM rutinas WHERE id_usuario = ? ORDER BY id_rutina DESC',
          [u.id_usuario]
        );

        const rutinasConEjercicios = await Promise.all(
          rutRows.map(async (r) => {
            const [ejercicios] = await pool.execute(
              'SELECT id_ejercicio, nombre_ejercicio, series, repeticiones, peso_kg, series_detalle_json FROM ejercicios_rutina WHERE id_rutina = ? ORDER BY orden ASC, id_ejercicio ASC',
              [r.id_rutina]
            );
            return { ...r, ejercicios };
          })
        );

        // Historial de sesiones
        const [sesiones] = await pool.execute(
          'SELECT id_sesion, fecha, detalle_json FROM historial_sesiones WHERE id_usuario = ? ORDER BY fecha DESC LIMIT 10',
          [u.id_usuario]
        );

        return {
          ...u,
          membresia,
          ultimo_pago,
          rutinas: rutinasConEjercicios,
          sesiones: sesiones.map(s => ({
            ...s,
            detalle: typeof s.detalle_json === 'string' ? JSON.parse(s.detalle_json) : s.detalle_json
          }))
        };
      })
    );

    res.json({ ok: true, usuarios: usuariosCompletos });
  } catch (err) {
    console.error('Error en GET /api/admin/usuarios:', err);
    res.status(500).json({ msg: `Error al obtener usuarios: ${err.message}` });
  }
});

// Crear un nuevo usuario cliente desde el panel de administración
app.post('/api/admin/usuarios', async (req, res) => {
  const { nombre_completo, correo, telefono } = req.body;

  if (!nombre_completo || !correo) {
    return res.status(400).json({ msg: 'El nombre completo y correo electrónico son obligatorios.' });
  }

  const cleanEmail = correo.trim().toLowerCase();

  try {
    const [existing] = await pool.execute('SELECT id_usuario FROM usuarios WHERE correo = ?', [cleanEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ msg: 'El correo electrónico ya está registrado.' });
    }

    const dummyHash = await bcrypt.hash('cliente123', 10);
    const nombre_usuario = cleanEmail.split('@')[0] + Math.floor(Math.random() * 1000);

    const [result] = await pool.execute(
      'INSERT INTO usuarios (nombre_usuario, correo, telefono, hash_contrasena, nombre_completo, id_rol) VALUES (?, ?, ?, ?, ?, 2)',
      [nombre_usuario, cleanEmail, telefono || null, dummyHash, nombre_completo]
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
    res.status(500).json({ msg: `Error al crear usuario: ${err.message}` });
  }
});

// Actualizar datos de un usuario cliente desde administración
app.put('/api/admin/usuarios/:id', async (req, res) => {
  const userId = req.params.id;
  const { nombre_completo, correo, telefono } = req.body;

  if (!nombre_completo || !correo) {
    return res.status(400).json({ msg: 'El nombre completo y correo electrónico son obligatorios.' });
  }

  const cleanEmail = correo.trim().toLowerCase();

  try {
    const [existing] = await pool.execute(
      'SELECT id_usuario FROM usuarios WHERE correo = ? AND id_usuario != ?',
      [cleanEmail, userId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ msg: 'El correo electrónico ya está registrado por otro usuario.' });
    }

    await pool.execute(
      'UPDATE usuarios SET nombre_completo = ?, correo = ?, telefono = ? WHERE id_usuario = ?',
      [nombre_completo.trim(), cleanEmail, telefono ? telefono.trim() : null, userId]
    );

    res.json({ ok: true, msg: 'Datos del cliente actualizados exitosamente.' });
  } catch (err) {
    console.error('Error en PUT /api/admin/usuarios:', err);
    res.status(500).json({ msg: `Error al actualizar cliente: ${err.message}` });
  }
});

// Registrar pago y actualizar membresía según plan contratado
app.post('/api/admin/pagos', async (req, res) => {
  const { id_usuario, monto, moneda, plan, fecha_pago } = req.body;

  if (!id_usuario || !monto || !moneda || !plan || !fecha_pago) {
    return res.status(400).json({ msg: 'Todos los campos del pago son obligatorios.' });
  }

  try {
    let diasPlan = 0;
    if (plan === 'Mensualidad' || plan === 'Estudiante') diasPlan = 30;
    else if (plan === 'Semana') diasPlan = 7;
    else if (plan === 'Diario') diasPlan = 1;
    else if (plan === 'Pago Deuda') diasPlan = 0;

    const [memRows] = await pool.execute(
      'SELECT id_membresia, fecha_fin, estado FROM membresias WHERE id_usuario = ? ORDER BY fecha_fin DESC LIMIT 1',
      [id_usuario]
    );

    // Fecha de realización del pago (Hoy al registrar)
    const fechaRealizacionStr = formatYYYYMMDD(new Date());

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

    // Obtener nombre del cliente para respaldar el historial en caso de eliminación futura
    const [uRows] = await pool.execute('SELECT nombre_completo FROM usuarios WHERE id_usuario = ?', [id_usuario]);
    const nombreClienteStr = uRows.length > 0 ? uRows[0].nombre_completo : null;

    // Guardar el pago: fecha_pago es la fecha del registro y fecha_inicio_plan es la fecha que corre el plan
    await pool.execute(
      'INSERT INTO pagos (id_usuario, nombre_cliente, monto, moneda, plan, fecha_pago, fecha_inicio_plan, fecha_fin_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id_usuario, nombreClienteStr, parseFloat(monto) || 0, moneda, plan, fechaRealizacionStr, planStartStr, newFinStr]
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
      msg: '¡Pago registrado correctamente y membresía actualizada!',
      vence: newFinStr
    });
  } catch (err) {
    console.error('Error en POST /api/admin/pagos:', err);
    res.status(500).json({ msg: `Error al registrar pago: ${err.message}` });
  }
});

// Obtener historial de pagos filtrado por fecha o por búsqueda de cliente (Preserva historial aun si se elimina el cliente)
app.get('/api/admin/pagos', async (req, res) => {
  try {
    const { fecha, q, usuario_id } = req.query;
    let querySql = `
      SELECT p.id_pago, p.monto, p.moneda, p.plan, 
             DATE_FORMAT(p.fecha_pago, '%Y-%m-%d') as fecha_pago,
             DATE_FORMAT(p.fecha_inicio_plan, '%Y-%m-%d') as fecha_inicio_plan,
             DATE_FORMAT(p.fecha_fin_plan, '%Y-%m-%d') as fecha_fin_plan,
             COALESCE(u.nombre_completo, p.nombre_cliente, 'Cliente Eliminado') as nombre_completo,
             COALESCE(u.correo, 'Cliente Eliminado') as correo,
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
      querySql += ` WHERE (u.nombre_completo LIKE ? OR p.nombre_cliente LIKE ? OR u.correo LIKE ? OR u.telefono LIKE ?) ORDER BY p.id_pago DESC LIMIT 100`;
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    } else if (req.query.fecha_inicio && req.query.fecha_fin) {
      querySql += ` WHERE DATE(p.fecha_pago) BETWEEN ? AND ? ORDER BY p.id_pago DESC`;
      queryParams.push(req.query.fecha_inicio, req.query.fecha_fin);
    } else {
      const targetDate = fecha || formatYYYYMMDD(new Date());
      querySql += ` WHERE DATE(p.fecha_pago) = ? ORDER BY p.id_pago DESC`;
      queryParams.push(targetDate);
    }

    const [rows] = await pool.execute(querySql, queryParams);

    let totalUSD = 0;
    let totalCOP = 0;
    let totalBS = 0;

    rows.forEach(p => {
      const val = parseFloat(p.monto) || 0;
      if (p.moneda === 'USD') totalUSD += val;
      else if (p.moneda === 'COP') totalCOP += val;
      else if (p.moneda === 'BS') totalBS += val;
    });

    res.json({
      ok: true,
      pagos: rows,
      totales: {
        USD: totalUSD.toFixed(2),
        COP: totalCOP.toFixed(2),
        BS: totalBS.toFixed(2)
      }
    });
  } catch (err) {
    console.error('Error en GET /api/admin/pagos:', err);
    res.status(500).json({ msg: `Error al obtener pagos: ${err.message}` });
  }
});

// Eliminar un usuario cliente con validación de contraseña de administrador
app.delete('/api/admin/usuarios/:id', async (req, res) => {
  const userId = req.params.id;
  const { admin_password } = req.body;

  if (!admin_password) {
    return res.status(400).json({ msg: 'Se requiere la contraseña de Administrador para eliminar un cliente.' });
  }

  try {
    const adminEmail = 'atlasgymve@gmail.com';
    const [adminRows] = await pool.execute('SELECT hash_contrasena FROM usuarios WHERE correo = ?', [adminEmail]);

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
    res.status(500).json({ msg: `Error al eliminar usuario: ${err.message}` });
  }
});

// ---------- RUTAS DE PLANTILLAS DE RUTINAS ----------

// Obtener todas las plantillas de rutinas
app.get('/api/plantillas', async (req, res) => {
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
    res.status(500).json({ msg: `Error al obtener plantillas: ${err.message}` });
  }
});

// Crear una plantilla de rutina por el administrador
app.post('/api/admin/plantillas', async (req, res) => {
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
    res.status(500).json({ msg: `Error al crear plantilla: ${err.message}` });
  }
});

// Actualizar una plantilla de rutina por el administrador
app.put('/api/admin/plantillas/:id', async (req, res) => {
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
    res.status(500).json({ msg: `Error al actualizar plantilla: ${err.message}` });
  }
});

// Eliminar plantilla de rutina por el administrador
app.delete('/api/admin/plantillas/:id', async (req, res) => {
  const plantillaId = req.params.id;
  try {
    await pool.execute('DELETE FROM plantillas_rutinas WHERE id_plantilla = ?', [plantillaId]);
    res.json({ ok: true, msg: 'Plantilla eliminada con éxito.' });
  } catch (err) {
    console.error('Error en DELETE /api/admin/plantillas:', err);
    res.status(500).json({ msg: `Error al eliminar plantilla: ${err.message}` });
  }
});

// ---------- RUTAS: MATERIAL Y CONTENIDO ADICIONAL ----------

// Listar recursos de apoyo
app.get('/api/recursos', async (req, res) => {
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
app.post('/api/admin/recursos', upload.single('archivo'), async (req, res) => {
  const { titulo, descripcion, categoria, tipo_recurso, url_enlace } = req.body;

  if (!titulo || !titulo.trim()) {
    return res.status(400).json({ msg: 'El título del material es obligatorio.' });
  }

  let finalTipo = tipo_recurso || 'enlace';
  let finalUrl = '';
  let nombreOrig = null;

  if (req.file) {
    finalTipo = 'archivo';
    finalUrl = `/uploads/${req.file.filename}`;
    nombreOrig = req.file.originalname;
  } else if (url_enlace && url_enlace.trim()) {
    finalTipo = 'enlace';
    finalUrl = url_enlace.trim();
  } else {
    return res.status(400).json({ msg: 'Debes adjuntar un archivo o ingresar una URL de enlace.' });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO recursos_apoyo (titulo, descripcion, categoria, tipo_recurso, url_recurso, nombre_archivo_orig) VALUES (?, ?, ?, ?, ?, ?)',
      [titulo.trim(), descripcion || null, categoria || 'General', finalTipo, finalUrl, nombreOrig]
    );

    res.json({ ok: true, id_recurso: result.insertId, msg: 'Material y Contenido Adicional agregado con éxito.' });
  } catch (err) {
    console.error('Error en POST /api/admin/recursos:', err);
    res.status(500).json({ msg: `Error al guardar material: ${err.message}` });
  }
});

// Eliminar recurso de apoyo
app.delete('/api/admin/recursos/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const [rows] = await pool.execute('SELECT * FROM recursos_apoyo WHERE id_recurso = ?', [id]);
    if (rows.length > 0) {
      const recurso = rows[0];
      if (recurso.tipo_recurso === 'archivo' && recurso.url_recurso.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', recurso.url_recurso);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) { console.error('Error eliminando archivo físico:', e); }
        }
      }
      await pool.execute('DELETE FROM recursos_apoyo WHERE id_recurso = ?', [id]);
    }
    res.json({ ok: true, msg: 'Material eliminado con éxito.' });
  } catch (err) {
    console.error('Error en DELETE /api/admin/recursos:', err);
    res.status(500).json({ msg: `Error al eliminar material: ${err.message}` });
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

app.listen(PORT, () => {
  console.log(`🚀 ATLAS Backend activo en el puerto ${PORT}`);
});

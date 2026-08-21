const mysql = require('mysql2/promise');

async function migrate() {
  console.log('--- Migrando Base de Datos atlas ---');
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: 'loreto2005',
    database: 'atlas'
  });

  // 1. Columna telefono en usuarios
  try {
    await conn.query('ALTER TABLE usuarios ADD COLUMN telefono VARCHAR(20) NULL AFTER correo');
    console.log('✅ Columna "telefono" agregada a la tabla usuarios.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️ Columna "telefono" ya existía en usuarios.');
    } else {
      console.error('Error agregando telefono:', err.message);
    }
  }

  // 2. Tabla ejercicios_rutina
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ejercicios_rutina (
      id_ejercicio INT AUTO_INCREMENT PRIMARY KEY,
      id_rutina BIGINT UNSIGNED NOT NULL,
      nombre_ejercicio VARCHAR(150) NOT NULL,
      series INT NOT NULL DEFAULT 3,
      repeticiones INT NOT NULL DEFAULT 10,
      peso_kg DECIMAL(6,2) DEFAULT 0.00,
      series_detalle_json TEXT NULL,
      orden INT DEFAULT 1,
      CONSTRAINT fk_ejercicio_rutina FOREIGN KEY (id_rutina) REFERENCES rutinas(id_rutina) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('✅ Tabla "ejercicios_rutina" lista.');

  try {
    await conn.query('ALTER TABLE ejercicios_rutina ADD COLUMN series_detalle_json TEXT NULL AFTER peso_kg');
    console.log('✅ Columna "series_detalle_json" agregada a la tabla ejercicios_rutina.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️ Columna "series_detalle_json" ya existía en ejercicios_rutina.');
    } else {
      console.error('Error agregando series_detalle_json:', err.message);
    }
  }

  // 3. Tabla historial_sesiones
  await conn.query(`
    CREATE TABLE IF NOT EXISTS historial_sesiones (
      id_sesion INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario BIGINT UNSIGNED NOT NULL,
      id_rutina BIGINT UNSIGNED NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      detalle_json TEXT,
      CONSTRAINT fk_sesion_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
      CONSTRAINT fk_sesion_rutina FOREIGN KEY (id_rutina) REFERENCES rutinas(id_rutina) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('✅ Tabla "historial_sesiones" lista.');

  // 4. Tabla pagos
  await conn.query(`
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
  `);
  console.log('✅ Tabla "pagos" lista.');

  try {
    await conn.query('ALTER TABLE pagos ADD COLUMN fecha_inicio_plan DATE NULL AFTER fecha_pago');
    await conn.query('ALTER TABLE pagos ADD COLUMN fecha_fin_plan DATE NULL AFTER fecha_inicio_plan');
    console.log('✅ Columnas de fechas de plan agregadas a la tabla pagos.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️ Columnas de fechas de plan ya existían en la tabla pagos.');
    }
  }

  try {
    await conn.query('ALTER TABLE pagos ADD COLUMN nombre_cliente VARCHAR(255) NULL AFTER id_usuario');
    console.log('✅ Columna "nombre_cliente" agregada a la tabla pagos.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️ Columna "nombre_cliente" ya existía en pagos.');
    }
  }

  // Rellenar datos retroactivos de nombre y fechas en pagos antiguos
  await conn.query('UPDATE pagos SET fecha_inicio_plan = fecha_pago WHERE fecha_inicio_plan IS NULL');
  await conn.query('UPDATE pagos p JOIN usuarios u ON p.id_usuario = u.id_usuario SET p.nombre_cliente = u.nombre_completo WHERE p.nombre_cliente IS NULL');

  // 5. Tabla plantillas_rutinas
  await conn.query(`
    CREATE TABLE IF NOT EXISTS plantillas_rutinas (
      id_plantilla INT AUTO_INCREMENT PRIMARY KEY,
      titulo VARCHAR(100) NOT NULL,
      descripcion TEXT NULL,
      horario VARCHAR(100) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 6. Tabla ejercicios_plantilla
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ejercicios_plantilla (
      id_ejercicio_plantilla INT AUTO_INCREMENT PRIMARY KEY,
      id_plantilla INT NOT NULL,
      nombre_ejercicio VARCHAR(100) NOT NULL,
      series INT NOT NULL DEFAULT 3,
      repeticiones INT NOT NULL DEFAULT 10,
      peso_kg DECIMAL(5,2) DEFAULT 0,
      series_detalle_json LONGTEXT NULL,
      orden INT DEFAULT 1,
      CONSTRAINT fk_ejercicio_plantilla FOREIGN KEY (id_plantilla) REFERENCES plantillas_rutinas(id_plantilla) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('✅ Tablas de plantillas de rutinas listas.');

  // Insertar datos de prueba para ejercicios de rutinas existentes
  const [rutinas] = await conn.query('SELECT id_rutina FROM rutinas');
  for (const r of rutinas) {
    const [existingEx] = await conn.query('SELECT COUNT(*) as count FROM ejercicios_rutina WHERE id_rutina = ?', [r.id_rutina]);
    if (existingEx[0].count === 0) {
      await conn.query(`
        INSERT INTO ejercicios_rutina (id_rutina, nombre_ejercicio, series, repeticiones, peso_kg, orden) VALUES
        (?, 'Press de Banca con Barra', 4, 10, 60.00, 1),
        (?, 'Aperturas con Mancuernas', 3, 12, 16.00, 2),
        (?, 'Remo con Barra', 4, 10, 50.00, 3)
      `, [r.id_rutina, r.id_rutina, r.id_rutina]);
      console.log(`✅ Ejercicios de prueba agregados a rutina ID ${r.id_rutina}.`);
    }
  }

  await conn.end();
  console.log('--- Migración finalizada con ÉXITO ---');
}

migrate().catch(console.error);

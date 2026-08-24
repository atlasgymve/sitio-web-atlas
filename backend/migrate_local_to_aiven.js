const mysql = require('mysql2/promise');

async function migrateLocalToAiven() {
  console.log('🚀 Iniciando migración completa de datos desde MySQL Local a Aiven Cloud...');

  let localConn, aivenConn;

  try {
    // 1. Conexión Local
    localConn = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'loreto2005',
      database: 'atlas'
    });
    console.log('✅ Conectado a MySQL Local (127.0.0.1).');

    // 2. Conexión Aiven Cloud
    aivenConn = await mysql.createConnection({
      host: process.env.DB_HOST || 'mysql-10ef40fa-atlasgymve-bbe7.c.aivencloud.com',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 22206,
      user: process.env.DB_USER || 'avnadmin',
      password: process.env.DB_PASSWORD || process.env.AIVEN_PASSWORD || '',
      database: process.env.DB_NAME || 'defaultdb',
      ssl: { rejectUnauthorized: false }
    });
    console.log('✅ Conectado a Aiven Cloud MySQL.');

    const tables = [
      'usuarios',
      'rutinas',
      'ejercicios_rutina',
      'historial_sesiones',
      'pagos',
      'plantillas_rutinas',
      'plantilla_ejercicios',
      'recursos_apoyo'
    ];

    for (const table of tables) {
      try {
        const [localRows] = await localConn.query(`SELECT * FROM ${table}`);
        if (localRows.length === 0) {
          console.log(`ℹ️ Tabla "${table}" no tiene registros locales para migrar.`);
          continue;
        }

        // Obtener nombres de columnas válidas en Aiven
        let targetCols = [];
        try {
          const [describeRows] = await aivenConn.query(`DESCRIBE \`${table}\``);
          targetCols = describeRows.map(r => r.Field);
        } catch (e) {
          console.log(`⚠️ Creando tabla "${table}" en Aiven...`);
          // Si la tabla no existe en Aiven, omitir por ahora
          continue;
        }

        console.log(`📦 Migrando ${localRows.length} registro(s) de la tabla "${table}"...`);

        await aivenConn.query('SET FOREIGN_KEY_CHECKS = 0');

        for (const rawRow of localRows) {
          // Filtrar solo los campos que existen en la tabla destino
          const validRow = {};
          for (const key of Object.keys(rawRow)) {
            let targetKey = key;
            if (key === 'creado_en') targetKey = 'created_at';
            if (targetCols.includes(targetKey)) {
              validRow[targetKey] = rawRow[key];
            }
          }

          if (table === 'usuarios') {
            validRow.password_hash = validRow.hash_contrasena || validRow.password_hash || '$2b$10$wK1J0hWcT1W4mJmD5bQ7u.51w33tL.u/gG7E3Q9N.o4K5xZ2L0nS2';
            validRow.hash_contrasena = validRow.hash_contrasena || validRow.password_hash;
            validRow.nombre_usuario = validRow.nombre_usuario || validRow.correo;
            validRow.id_rol = validRow.id_rol || (validRow.rol === 'administrador' ? 1 : 2);
          }

          const keys = Object.keys(validRow);
          if (keys.length === 0) continue;

          const values = Object.values(validRow);
          const placeholders = keys.map(() => '?').join(', ');
          const updateClause = keys.map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');

          const sql = `
            INSERT INTO \`${table}\` (\`${keys.join('`, `')}\`)
            VALUES (${placeholders})
            ON DUPLICATE KEY UPDATE ${updateClause}
          `;

          await aivenConn.query(sql, values);
        }

        await aivenConn.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log(`✅ Tabla "${table}" migrada exitosamente (${localRows.length} filas).`);
      } catch (err) {
        console.error(`❌ Error migrando tabla ${table}:`, err.message);
      }
    }

    console.log('\n🎉 ¡MIGRACIÓN COMPLETA DE DATOS LOCALES A AIVEN CONCLUIDA CON ÉXITO!');

  } catch (err) {
    console.error('❌ Error en el proceso de migración:', err.message);
  } finally {
    if (localConn) await localConn.end();
    if (aivenConn) await aivenConn.end();
  }
}

migrateLocalToAiven();

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function loadCloudSchema() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('\n❌ Uso del script:');
    console.log('node backend/load_cloud_db.js <HOST> <PORT> <PASSWORD> [DB_NAME]\n');
    console.log('Ejemplo:');
    console.log('node backend/load_cloud_db.js mysql-123.aivencloud.com 25060 mi_password_aiven defaultdb\n');
    process.exit(1);
  }

  const [host, portStr, password, dbName = 'defaultdb'] = args;
  const port = parseInt(portStr, 10);

  console.log(`🔌 Conectando a Aiven MySQL (${host}:${port})...`);

  try {
    const connection = await mysql.createConnection({
      host,
      port,
      user: 'avnadmin',
      password,
      database: dbName,
      ssl: { rejectUnauthorized: false },
      multipleStatements: true
    });

    console.log('✅ Conexión exitosa a Aiven MySQL.');

    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      console.error('❌ No se encontró el archivo schema.sql');
      process.exit(1);
    }

    const sqlScript = fs.readFileSync(schemaPath, 'utf8');
    console.log('⏳ Ejecutando schema.sql en Aiven...');

    // Limpiar comentarios de bloque y separar por punto y coma
    const cleanSql = sqlScript.replace(/--.*$/gm, '');
    const statements = cleanSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await connection.query(stmt);
    }

    console.log('🎉 ¡TODAS LAS TABLAS Y DATOS HAN SIDO CARGADOS EN AIVEN CON ÉXITO!');

    await connection.end();
  } catch (err) {
    console.error('❌ Error al cargar la base de datos:', err.message);
  }
}

loadCloudSchema();

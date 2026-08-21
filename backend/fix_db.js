const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function setupDB() {
  console.log('Connecting to MySQL with password="loreto2005"...');
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: 'loreto2005',
    database: 'atlas'
  });

  const plainPassword = '1234';
  const newHash = await bcrypt.hash(plainPassword, 10);

  const [users] = await conn.query('SELECT * FROM usuarios');
  console.log('Usuarios en atlas:', users);

  if (users.length === 0) {
    console.log('Insertando usuario juan@example.com con contraseña "1234"...');
    await conn.query(
      `INSERT INTO usuarios (nombre_usuario, correo, hash_contrasena, nombre_completo, id_rol) 
       VALUES ('juanp', 'juan@example.com', ?, 'Juan Pérez', 2)`,
      [newHash]
    );
  } else {
    console.log('Actualizando la contraseña a "1234" para todos los usuarios...');
    await conn.query('UPDATE usuarios SET hash_contrasena = ?', [newHash]);
  }

  const [updatedUsers] = await conn.query('SELECT id_usuario, nombre_usuario, correo, hash_contrasena FROM usuarios');
  console.log('Usuarios actualizados en la base de datos:', updatedUsers);

  for (const u of updatedUsers) {
    const match = await bcrypt.compare('1234', u.hash_contrasena);
    console.log(`Verificación login (correo: "${u.correo}", pass: "1234"): ${match ? 'ÉXITO ✅' : 'FALLO ❌'}`);
  }

  await conn.end();
}

setupDB().catch(err => {
  console.error('Error:', err);
});

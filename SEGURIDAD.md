# Cambios de seguridad — ATLAS

## Qué cambió

1. **El servidor ya no publica la carpeta completa del proyecto.** Solo publica `index.html`, `admin.html`, `dashboard.html`, `script.js`, `style.css` y la carpeta `assets/`. Antes cualquiera podía descargar `backend/server.js`, y con él las contraseñas.
2. **Sesiones con token firmado.** Al iniciar sesión, el servidor entrega un token que solo él puede generar. Cada petición a la API lo envía, y el servidor verifica quién es y qué rol tiene:
   - **Cliente:** solo ve y modifica su propia cuenta, sus rutinas y sus sesiones. Sigue entrando solo con correo o cédula, sin contraseña.
   - **Recepción:** puede ver clientes, crear y editar clientes, registrar pagos y gestionar plantillas. No ve el historial de pagos, no edita pagos, no borra clientes y no gestiona material.
   - **Administrador:** tiene acceso a todo.
   - Duración de la sesión: 12 h para el admin, 14 h para recepción y 30 días para los clientes.
3. **Contraseñas fuera del código.** Las contraseñas del admin, de recepción y de la base de datos se leen de variables de entorno.
4. **Se cerró `/api/registro`.** Ninguna pantalla lo usaba, pero permitía que cualquiera se registrara con 30 días de membresía gratis. Ahora solo lo puede usar el personal.
5. **Los errores ya no muestran detalles internos de la base de datos** al usuario. Esos detalles siguen apareciendo en los logs de Render.

Después de publicar estos cambios, **todos tendrán que iniciar sesión otra vez**, una sola vez.

## Pasos en Render (antes de publicar)

En tu servicio de Render, ve a **Environment** y agrega o revisa estas variables:

| Variable | Valor |
|---|---|
| `SESSION_SECRET` | Usa el botón **Generate** de Render, o pega un texto largo y aleatorio |
| `ADMIN_PASSWORD` | La **nueva** contraseña del administrador |
| `RECEPCION_PASSWORD` | La **nueva** contraseña de recepción |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` | Ya deberían estar configuradas (Aiven). Verifica que existan, porque el código ya no trae una contraseña por defecto |

Después de guardar las variables, haz commit y push de los cambios. Render vuelve a desplegar el servicio y, al arrancar, aplica las nuevas contraseñas.

## Importante: cambiar las contraseñas viejas

Las contraseñas anteriores del admin y de recepción estuvieron escritas en el código. Siguen visibles en el **historial de git** y, si el repositorio de GitHub es público, cualquiera puede verlas. Cambiarlas con `ADMIN_PASSWORD` y `RECEPCION_PASSWORD` las invalida.

Si usaste la contraseña de tu MySQL local en algún otro lugar, cámbiala también.

## Trabajo en tu computadora

El archivo `.env` (que no se sube a GitHub) contiene la configuración local. Si necesitas recrearlo, copia `.env.example` como `.env` y complétalo. Luego arranca el servidor como siempre, con `npm start`.

-- Base de Datos ATLAS GYM - Schema SQL Completo
CREATE DATABASE IF NOT EXISTS atlas DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE atlas;

-- 1. Tabla: usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre_usuario VARCHAR(100) NULL,
  nombre_completo VARCHAR(150) NOT NULL,
  correo VARCHAR(150) NOT NULL UNIQUE,
  telefono VARCHAR(20) NULL,
  hash_contrasena VARCHAR(255) NULL,
  password_hash VARCHAR(255) NULL,
  id_rol INT NOT NULL DEFAULT 2,
  rol ENUM('cliente', 'administrador') DEFAULT 'cliente',
  membresia_vence DATE NULL,
  membresia_estado ENUM('activa', 'inactiva', 'vencida') DEFAULT 'inactiva',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Tabla: rutinas
CREATE TABLE IF NOT EXISTS rutinas (
  id_rutina BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_usuario BIGINT UNSIGNED NOT NULL,
  titulo VARCHAR(150) NOT NULL,
  descripcion TEXT NULL,
  horario VARCHAR(100) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rutina_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Tabla: ejercicios_rutina
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

-- 4. Tabla: historial_sesiones
CREATE TABLE IF NOT EXISTS historial_sesiones (
  id_sesion INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario BIGINT UNSIGNED NOT NULL,
  id_rutina BIGINT UNSIGNED NOT NULL,
  fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
  detalle_json TEXT,
  CONSTRAINT fk_sesion_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  CONSTRAINT fk_sesion_rutina FOREIGN KEY (id_rutina) REFERENCES rutinas(id_rutina) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Tabla: pagos
CREATE TABLE IF NOT EXISTS pagos (
  id_pago INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario BIGINT UNSIGNED NOT NULL,
  nombre_cliente VARCHAR(255) NULL,
  monto DECIMAL(10,2) NOT NULL,
  moneda VARCHAR(10) NOT NULL,
  plan VARCHAR(50) NOT NULL,
  fecha_pago DATE NOT NULL,
  fecha_inicio_plan DATE NULL,
  fecha_fin_plan DATE NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pago_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Tabla: plantillas_rutinas
CREATE TABLE IF NOT EXISTS plantillas_rutinas (
  id_plantilla INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(100) NOT NULL,
  descripcion TEXT NULL,
  horario VARCHAR(100) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Tabla: ejercicios_plantilla
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

-- 8. Tabla: recursos_apoyo (Material y Contenido Adicional)
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

-- Usuario Administrador por Defecto (Password Hash para pass123 / admin)
INSERT INTO usuarios (nombre_completo, correo, telefono, password_hash, rol, membresia_estado)
VALUES ('Administrador ATLAS', 'admin@atlas.com', '+584140000000', '$2b$10$wK1J0hWcT1W4mJmD5bQ7u.51w33tL.u/gG7E3Q9N.o4K5xZ2L0nS2', 'administrador', 'activa')
ON DUPLICATE KEY UPDATE id_usuario=id_usuario;

-- Recursos de prueba de Material y Contenido Adicional
INSERT INTO recursos_apoyo (titulo, descripcion, categoria, tipo_recurso, url_recurso, nombre_archivo_orig)
VALUES 
('Guía de Nutrición e Hidratación Deportivo', 'Recomendaciones nutricionales básicas para optimizar el rendimiento y la recuperación muscular.', 'Nutrición', 'enlace', 'https://www.google.com', NULL),
('Reglamento y Normas del Gimnasio ATLAS', 'Normativa interna de uso de equipos, horarios y buena convivencia en las instalaciones.', 'Reglamento', 'enlace', 'https://www.google.com', NULL)
ON DUPLICATE KEY UPDATE id_recurso=id_recurso;

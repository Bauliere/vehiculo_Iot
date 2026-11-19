-- Aplicar después de 001. No reasigna vehículos ni altera su historial.
ALTER TABLE modelos_vehiculo ADD COLUMN foto_url VARCHAR(512) NULL;

CREATE TABLE clientes_iot (
    id_cliente INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    correo VARCHAR(254) NOT NULL UNIQUE,
    clave_hash VARCHAR(160) NOT NULL,
    rol ENUM('administrador', 'usuario') NOT NULL DEFAULT 'usuario',
    activo TINYINT(1) NOT NULL DEFAULT 1,
    CHECK (activo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sesiones_cuenta_iot (
    huella BINARY(32) NOT NULL PRIMARY KEY,
    id_cliente INT NOT NULL,
    vence DATETIME(6) NOT NULL,
    INDEX ix_sesion_cuenta (id_cliente),
    INDEX ix_sesion_vence (vence),
    FOREIGN KEY (id_cliente) REFERENCES clientes_iot(id_cliente)
) ENGINE=InnoDB;

CREATE TABLE capacidades_modelo_iot (
    id_modelo INT NOT NULL,
    codigo INT NOT NULL,
    nombre VARCHAR(60) NOT NULL,
    exhibicion TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id_modelo, codigo),
    UNIQUE KEY uq_capacidad_nombre (id_modelo, nombre),
    FOREIGN KEY (id_modelo) REFERENCES modelos_vehiculo(id_modelo),
    CHECK (exhibicion IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE asignaciones_iot (
    id_asignacion BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id_vehiculo INT NOT NULL,
    id_cliente INT NOT NULL,
    desde DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    hasta DATETIME(6) DEFAULT NULL,
    unidad_vigente INT GENERATED ALWAYS AS (IF(hasta IS NULL, id_vehiculo, NULL)) STORED,
    UNIQUE KEY uq_asignacion_vigente (unidad_vigente),
    INDEX ix_propietario (id_cliente, hasta),
    INDEX ix_asignacion_historial (id_vehiculo, desde),
    FOREIGN KEY (id_vehiculo) REFERENCES vehiculos(id_vehiculo),
    FOREIGN KEY (id_cliente) REFERENCES clientes_iot(id_cliente)
) ENGINE=InnoDB;

CREATE TABLE soporte_iot (
    id_vehiculo INT NOT NULL PRIMARY KEY,
    id_cliente INT NOT NULL,
    vence DATETIME(6) NOT NULL,
    FOREIGN KEY (id_vehiculo) REFERENCES vehiculos(id_vehiculo),
    FOREIGN KEY (id_cliente) REFERENCES clientes_iot(id_cliente)
) ENGINE=InnoDB;

CREATE TABLE dispositivos_iot (
    id_vehiculo INT NOT NULL PRIMARY KEY,
    huella BINARY(32) NOT NULL UNIQUE,
    FOREIGN KEY (id_vehiculo) REFERENCES vehiculos(id_vehiculo)
) ENGINE=InnoDB;

CREATE TABLE reservas_iot (
    id_reserva BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    huella BINARY(32) NOT NULL UNIQUE,
    id_vehiculo INT NOT NULL,
    vence DATETIME(6) NOT NULL,
    finalizada DATETIME(6) DEFAULT NULL,
    unidad_reservada INT GENERATED ALWAYS AS (IF(finalizada IS NULL, id_vehiculo, NULL)) STORED,
    UNIQUE KEY uq_reserva_abierta (unidad_reservada),
    INDEX ix_reserva_vence (finalizada, vence),
    FOREIGN KEY (id_vehiculo) REFERENCES vehiculos(id_vehiculo)
) ENGINE=InnoDB;

CREATE TABLE auditoria_iot (
    id_evento BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    fecha DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    id_actor INT DEFAULT NULL,
    rol ENUM('administrador', 'usuario', 'invitado', 'sistema') NOT NULL,
    accion VARCHAR(48) NOT NULL,
    recurso VARCHAR(32) NOT NULL,
    id_recurso BIGINT DEFAULT NULL,
    resultado ENUM('correcto', 'rechazado', 'pendiente') NOT NULL,
    FOREIGN KEY (id_actor) REFERENCES clientes_iot(id_cliente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE demos
    ADD COLUMN id_cliente_demo INT NULL,
    ADD KEY ix_demo_propietario (id_cliente_demo, id_vehiculo),
    ADD CONSTRAINT fk_demo_propietario FOREIGN KEY (id_cliente_demo) REFERENCES clientes_iot(id_cliente);

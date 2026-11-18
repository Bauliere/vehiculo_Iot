-- Primera migración 4.3. Aplicar en la copia de prueba con el esquema seleccionado.
-- El modelo textual y los IDs existentes conservan su contrato.
-- Las columnas nuevas quedan NULL hasta verificar el inventario físico.

CREATE TABLE modelos_vehiculo (
    id_modelo INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(120) NOT NULL,
    descripcion VARCHAR(500) NULL,
    activo TINYINT NOT NULL DEFAULT 1,
    PRIMARY KEY (id_modelo),
    UNIQUE KEY uq_modelo_nombre (nombre),
    CONSTRAINT chk_modelo_activo CHECK (activo IN (0, 1))
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

ALTER TABLE vehiculos
    ADD COLUMN id_modelo INT NULL,
    ADD COLUMN identificador_fisico VARCHAR(80) COLLATE utf8mb4_0900_as_cs NULL,
    ADD COLUMN estado_comercial ENUM('disponible', 'vendida', 'exhibicion', 'inactiva') NULL,
    ADD UNIQUE KEY uq_vehiculo_identificador_fisico (identificador_fisico),
    ADD KEY ix_vehiculo_modelo_estado (id_modelo, estado_comercial),
    ADD CONSTRAINT chk_vehiculo_identificador_fisico CHECK (
        identificador_fisico IS NULL OR CHAR_LENGTH(TRIM(identificador_fisico)) > 0
    ),
    ADD CONSTRAINT fk_vehiculo_modelo FOREIGN KEY (id_modelo)
        REFERENCES modelos_vehiculo (id_modelo) ON DELETE RESTRICT ON UPDATE RESTRICT;

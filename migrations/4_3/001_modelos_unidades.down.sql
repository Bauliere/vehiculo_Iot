-- Reversión estructural sobre iot43_stage, después de 002.down.
ALTER TABLE iot43_stage.vehiculos
    DROP FOREIGN KEY fk_vehiculo_modelo,
    DROP CHECK chk_vehiculo_identificador_fisico,
    DROP INDEX uq_vehiculo_identificador_fisico,
    DROP INDEX ix_vehiculo_modelo_estado,
    DROP COLUMN estado_comercial,
    DROP COLUMN identificador_fisico,
    DROP COLUMN id_modelo;

DROP TABLE iot43_stage.modelos_vehiculo;

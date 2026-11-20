-- Reversión estructural de una copia desechable. El esquema de ensayo está fijado.
-- Ejecutar sólo tras verificar 002, antes de crear cuentas o demos privadas.
ALTER TABLE iot43_stage.demos
    DROP FOREIGN KEY fk_demo_propietario,
    DROP INDEX ix_demo_propietario,
    DROP COLUMN id_cliente_demo;

DROP TABLE iot43_stage.auditoria_iot;
DROP TABLE iot43_stage.reservas_iot;
DROP TABLE iot43_stage.dispositivos_iot;
DROP TABLE iot43_stage.soporte_iot;
DROP TABLE iot43_stage.asignaciones_iot;
DROP TABLE iot43_stage.capacidades_modelo_iot;
DROP TABLE iot43_stage.sesiones_cuenta_iot;
DROP TABLE iot43_stage.clientes_iot;

ALTER TABLE iot43_stage.modelos_vehiculo DROP COLUMN foto_url;

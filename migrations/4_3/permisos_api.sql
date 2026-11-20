-- Ejecutar con la cuenta de mantenimiento en el esquema de la aplicación.
-- Los procedimientos originales operan con SQL SECURITY DEFINER.
CREATE ROLE IF NOT EXISTS 'vehiculo_iot_api'@'%';
GRANT EXECUTE ON `vehiculo_iot`.* TO 'vehiculo_iot_api'@'%';

GRANT SELECT, UPDATE (modelo, id_modelo, identificador_fisico, estado_comercial, activo)
    ON `vehiculo_iot`.`vehiculos` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, UPDATE (activo) ON `vehiculo_iot`.`comandos` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, INSERT, UPDATE (nombre, descripcion, activo)
    ON `vehiculo_iot`.`demos` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, DELETE ON `vehiculo_iot`.`demo_movimientos` TO 'vehiculo_iot_api'@'%';

GRANT SELECT, INSERT, UPDATE ON `vehiculo_iot`.`modelos_vehiculo` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, INSERT, DELETE ON `vehiculo_iot`.`capacidades_modelo_iot` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, INSERT, UPDATE (nombre, correo, activo, clave_hash)
    ON `vehiculo_iot`.`clientes_iot` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, INSERT, DELETE ON `vehiculo_iot`.`sesiones_cuenta_iot` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, INSERT, UPDATE (hasta) ON `vehiculo_iot`.`asignaciones_iot` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, INSERT, DELETE ON `vehiculo_iot`.`soporte_iot` TO 'vehiculo_iot_api'@'%';
GRANT SELECT ON `vehiculo_iot`.`dispositivos_iot` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, INSERT, UPDATE (finalizada) ON `vehiculo_iot`.`reservas_iot` TO 'vehiculo_iot_api'@'%';
GRANT SELECT, INSERT ON `vehiculo_iot`.`auditoria_iot` TO 'vehiculo_iot_api'@'%';

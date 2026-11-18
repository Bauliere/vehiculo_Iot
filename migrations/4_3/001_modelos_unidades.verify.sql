-- Ejecutar antes y después en la copia de prueba. Comparar conteos y referencias.
SELECT COUNT(*) AS vehiculos FROM vehiculos;
SELECT COUNT(*) AS comandos FROM comandos;
SELECT COUNT(*) AS demos FROM demos;
SELECT COUNT(*) AS pasos FROM demo_movimientos;
SELECT COUNT(*) AS estados FROM estado_vehiculo;
SELECT COUNT(*) AS historial FROM historial_comandos;

SELECT ROUTINE_NAME
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'
ORDER BY ROUTINE_NAME;

SELECT id_vehiculo, modelo, activo FROM vehiculos ORDER BY id_vehiculo;

-- Consultas para después de 001.
-- SELECT COUNT(*) AS modelos FROM modelos_vehiculo;
-- SELECT id_vehiculo, id_modelo, identificador_fisico, estado_comercial
-- FROM vehiculos ORDER BY id_vehiculo;

-- Ejecutar antes y después. Comparar conteos, IDs y la firma del historial.
SELECT DATABASE() AS esquema, VERSION() AS version_motor;
SELECT table_name, engine FROM information_schema.tables
WHERE table_schema = DATABASE() ORDER BY table_name;
SELECT 'vehiculos' AS recurso, COUNT(*) AS filas, MIN(id_vehiculo) AS primer_id, MAX(id_vehiculo) AS ultimo_id FROM vehiculos
UNION ALL SELECT 'comandos', COUNT(*), MIN(id_comando), MAX(id_comando) FROM comandos
UNION ALL SELECT 'estado_vehiculo', COUNT(*), MIN(id_estado), MAX(id_estado) FROM estado_vehiculo
UNION ALL SELECT 'historial_comandos', COUNT(*), MIN(id_historial), MAX(id_historial) FROM historial_comandos
UNION ALL SELECT 'demos', COUNT(*), MIN(id_demo), MAX(id_demo) FROM demos
UNION ALL SELECT 'demo_movimientos', COUNT(*), MIN(id_demo_movimiento), MAX(id_demo_movimiento) FROM demo_movimientos;
SELECT id_vehiculo, COUNT(*) AS movimientos, BIT_XOR(CRC32(CONCAT_WS('|', id_historial,
    COALESCE(id_comando, 0), COALESCE(fecha_hora, ''), origen))) AS firma
FROM historial_comandos GROUP BY id_vehiculo ORDER BY id_vehiculo;
SELECT routine_name, routine_type FROM information_schema.routines
WHERE routine_schema = DATABASE() ORDER BY routine_name;
SELECT table_name, constraint_name, constraint_type, enforced
FROM information_schema.table_constraints WHERE constraint_schema = DATABASE()
ORDER BY table_name, constraint_type, constraint_name;

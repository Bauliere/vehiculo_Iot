"""Comprueba o aplica las dos migraciones 4.3 con el Python de la API."""

import argparse
import json
import sys
from contextlib import closing
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path

import pymysql
from pydantic import SecretStr, ValidationError

from app.config import PROJECT_ROOT, Settings
from app.database import PROCEDURES, Database
from app.errors import ApiError


SQL = PROJECT_ROOT / "migrations" / "4_3"
VERIFY = SQL / "002_plataforma_comercial.verify.sql"
UP = (SQL / "001_modelos_unidades.up.sql", SQL / "002_plataforma_comercial.up.sql")
BASE_TABLES = {"vehiculos", "comandos", "estado_vehiculo", "historial_comandos", "demos", "demo_movimientos"}
COMMERCIAL_TABLES = {
    "clientes_iot", "sesiones_cuenta_iot", "capacidades_modelo_iot", "asignaciones_iot",
    "soporte_iot", "dispositivos_iot", "reservas_iot", "auditoria_iot",
}
MODEL_COLUMNS = {("vehiculos", name) for name in ("id_modelo", "identificador_fisico", "estado_comercial")}
COMMERCIAL_COLUMNS = {("modelos_vehiculo", "foto_url"), ("demos", "id_cliente_demo")}


def statements(path, allowed):
    # Los tres archivos versionados contienen sentencias simples, sin DELIMITER ni rutinas.
    source = "\n".join(line for line in path.read_text(encoding="utf-8-sig").splitlines()
                       if not line.lstrip().startswith("--"))
    parts = [part.strip() for part in source.split(";") if part.strip()]
    if not parts or any(not part.upper().startswith(allowed) for part in parts):
        raise ValueError(f"El archivo {path.name} contiene una sentencia fuera del formato previsto.")
    return parts


def examine(cursor, verification, expected_db):
    results = []
    for statement in verification:
        cursor.execute(statement)
        results.append([{key.lower(): value for key, value in row.items()} for row in cursor.fetchall()])
    target, table_list, counts, history, routines, constraints = results
    if target[0]["esquema"] != expected_db:
        raise ValueError("El esquema de la conexión no coincide con el solicitado.")
    tables = {row["table_name"] for row in table_list}
    if (not BASE_TABLES <= tables
            or not PROCEDURES.keys() <= {row["routine_name"] for row in routines if row["routine_type"] == "PROCEDURE"}):
        raise ValueError("No se encontraron las seis tablas y los 21 procedimientos originales.")
    cursor.execute("""SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna FROM information_schema.COLUMNS
                       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('vehiculos','modelos_vehiculo','demos')""")
    columns = {(row["tabla"], row["columna"]) for row in cursor.fetchall()}
    names = {(row["table_name"], row["constraint_name"]) for row in constraints}
    model = ["modelos_vehiculo" in tables, *(column in columns for column in MODEL_COLUMNS),
             ("vehiculos", "fk_vehiculo_modelo") in names]
    commercial = [*(table in tables for table in COMMERCIAL_TABLES),
                  *(column in columns for column in COMMERCIAL_COLUMNS), ("demos", "fk_demo_propietario") in names,
                  ("asignaciones_iot", "uq_asignacion_vigente") in names, ("reservas_iot", "uq_reserva_abierta") in names]
    if (any(model) and not all(model)) or (any(commercial) and not (all(commercial) and all(model))):
        raise ValueError("Hay una migración parcial. Revisa el esquema y recupera desde la copia aprobada.")
    return {
        "motor": target[0], "version_migracion": int(all(model)) + int(all(commercial)),
        "tablas": table_list, "filas": sorted(counts, key=lambda row: row["recurso"]),
        "historial": history, "procedimientos": routines, "restricciones": constraints,
    }


def migrate(args):
    settings = Settings(_env_file=args.env)
    if (settings.db_host.casefold(), settings.db_port, settings.db_name) != (args.host.casefold(), args.puerto, args.base):
        raise ValueError("El endpoint, puerto o esquema efectivo del .env difiere del objetivo indicado.")
    ca = Path(settings.db_ssl_ca)
    if settings.db_ssl_ca and not ca.is_absolute():
        settings = settings.model_copy(update={"db_ssl_ca": str((args.env.resolve().parent / ca).resolve())})
    if args.usuario:
        settings = settings.model_copy(update={"db_user": args.usuario, "db_password": SecretStr(getpass("Clave SQL: "))})

    verification = statements(VERIFY, ("SELECT ",))
    changes = [statements(file, ("CREATE TABLE ", "ALTER TABLE ")) for file in UP]
    args.evidencia.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")

    def save(label, result):
        path = args.evidencia / f"{stamp}-{label}.json"
        proof = {"endpoint": args.host, "puerto": args.puerto, "snapshot": args.snapshot, **result}
        path.write_text(json.dumps(proof, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
        print(f"{path} | migración {result['version_migracion']:03d} | {len(result['tablas'])} tablas")

    database = Database(settings.model_copy(update={"db_timeout_seconds": 120}))
    with closing(database._connect()) as connection, connection.cursor() as cursor:
        connection.autocommit(True)
        # MySQL libera este bloqueo de esquema al cerrar la conexión.
        cursor.execute("SELECT GET_LOCK(CONCAT('vehiculo_iot_4_3:', MD5(DATABASE())), 0) AS adquirido")
        if cursor.fetchone()["adquirido"] != 1:
            raise ValueError("Ya hay otra verificación o migración de 4.3 en esta base.")
        before = examine(cursor, verification, args.base)
        save("antes" if args.accion == "aplicar" else "verificacion", before)
        if args.accion == "verificar":
            return
        cursor.execute("""SELECT COUNT(*) AS cantidad FROM information_schema.COLLATIONS
                           WHERE COLLATION_NAME IN ('utf8mb4_0900_ai_ci','utf8mb4_0900_as_cs')""")
        if cursor.fetchone()["cantidad"] != 2:
            raise ValueError("El motor no ofrece ambas colaciones de la migración.")
        cursor.execute("SET SESSION lock_wait_timeout=30")
        after = before
        for step in range(before["version_migracion"], len(changes)):
            print(f"Aplicando {UP[step].name}", flush=True)
            for statement in changes[step]:
                cursor.execute(statement)
            after = examine(cursor, verification, args.base)
            save(f"despues-{step + 1:03d}", after)
            if after["version_migracion"] != step + 1 or any(after[key] != before[key] for key in ("filas", "historial", "procedimientos")):
                raise ValueError("Falló la comparación de migración, filas, historial o procedimientos.")
        print("Verificación correcta de filas, IDs, firmas del historial y procedimientos.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("accion", choices=("verificar", "aplicar"))
    parser.add_argument("--env", type=Path, required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--puerto", type=int, required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--evidencia", type=Path, required=True)
    parser.add_argument("--snapshot", help="Identificador del snapshot comprobado en AWS")
    parser.add_argument("--usuario", help="Usuario SQL alternativo. La clave se pide en la consola.")
    args = parser.parse_args()
    if not args.env.is_file():
        parser.error("El archivo --env no existe.")
    if args.accion == "aplicar" and not (args.snapshot and args.snapshot.strip()):
        parser.error("Aplicar requiere el identificador del snapshot comprobado.")
    try:
        migrate(args)
    except ValidationError:
        sys.exit("Configuración de base inválida. Revisa los campos del .env en la instancia.")
    except ApiError as error:
        sys.exit(error.detail)
    except (OSError, ValueError, pymysql.MySQLError) as error:
        sys.exit(f"{error}. Si se inició DDL, conserva la evidencia y revisa el esquema antes de reintentar.")


if __name__ == "__main__":
    main()

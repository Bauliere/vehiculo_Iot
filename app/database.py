import logging
import ssl
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor

from app.errors import ApiError

logger = logging.getLogger(__name__)
# Los únicos nombres interpolados provienen de este catálogo interno.
PROCEDURES = {
    "sp_crear_vehiculo": 4, "sp_obtener_vehiculos": 0,
    "sp_obtener_vehiculo": 1, "sp_actualizar_vehiculo": 6,
    "sp_eliminar_vehiculo": 1, "sp_crear_comando": 4,
    "sp_obtener_comandos_vehiculo": 1, "sp_actualizar_comando": 5,
    "sp_eliminar_comando": 1, "sp_actualizar_estado": 3,
    "sp_obtener_estado": 1, "sp_registrar_historial": 3,
    "sp_obtener_historial": 1, "sp_crear_demo": 3,
    "sp_obtener_demos": 1, "sp_actualizar_demo": 4,
    "sp_eliminar_demo": 1, "sp_agregar_movimiento_demo": 5,
    "sp_obtener_movimientos_demo": 1, "sp_actualizar_movimiento_demo": 5,
    "sp_eliminar_movimiento_demo": 1,
}


class ProcedureSession:
    def __init__(self, connection, write: bool):
        self.connection = connection
        self.write = write

    def call(self, name: str, args: tuple = ()) -> list[dict]:
        if name not in PROCEDURES or len(args) != PROCEDURES[name]:
            raise ValueError("Procedimiento o número de parámetros no permitido.")
        if not self.write and not name.startswith("sp_obtener_"):
            raise ValueError("La sesión de consulta no permite escrituras.")
        placeholders = ",".join(["%s"] * len(args))
        with self.connection.cursor() as cursor:
            cursor.execute(f"CALL `{name}`({placeholders})", args)
            rows = list(cursor.fetchall()) if cursor.description else []
            while cursor.nextset():
                if cursor.description:
                    cursor.fetchall()
            return rows

    def last_insert_id(self) -> int:
        with self.connection.cursor() as cursor:
            cursor.execute("SELECT LAST_INSERT_ID() AS id")
            return int(cursor.fetchone()["id"])


class Database:
    def __init__(self, settings):
        self.settings = settings

    def _connect(self):
        self.settings.validate_database()
        tls = ssl.create_default_context(cafile=self.settings.db_ssl_ca)
        return pymysql.connect(
            host=self.settings.db_host, port=self.settings.db_port,
            user=self.settings.db_user,
            password=self.settings.db_password.get_secret_value(),
            database=self.settings.db_name, charset="utf8mb4", cursorclass=DictCursor,
            autocommit=False, ssl=tls,
            connect_timeout=self.settings.db_timeout_seconds,
            read_timeout=self.settings.db_timeout_seconds,
            write_timeout=self.settings.db_timeout_seconds,
            init_command="SET time_zone = '+00:00'",
        )

    @contextmanager
    def session(self, write: bool = False):
        connection = None
        try:
            connection = self._connect()
            connection.begin()
            yield ProcedureSession(connection, write)
            if write:
                connection.commit()
            else:
                connection.rollback()
        except pymysql.MySQLError as error:
            if connection:
                try:
                    connection.rollback()
                except pymysql.MySQLError:
                    pass
            code = error.args[0] if error.args else None
            logger.warning("MySQL rechazó la operación (código %s).", code)
            if code in (1062, 1451, 1452):
                raise ApiError(409, "Conflicto de datos: valor duplicado o recurso relacionado.") from None
            if code in (1205, 1213):
                raise ApiError(409, "Conflicto de concurrencia; vuelve a intentar.") from None
            raise ApiError(503, "No se pudo completar la operación con RDS.") from None
        except (OSError, ssl.SSLError):
            if connection:
                try:
                    connection.rollback()
                except pymysql.MySQLError:
                    pass
            raise ApiError(503, "No se pudo establecer la conexión segura con RDS.") from None
        except Exception:
            if connection:
                try:
                    connection.rollback()
                except pymysql.MySQLError:
                    pass
            raise
        finally:
            if connection:
                connection.close()

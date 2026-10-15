"""Servicios síncronos de catálogo, sin SQL directo ni cambios al esquema."""

from typing import Any

from app.database import Database
from app.errors import ApiError


class CatalogService:
    """Ejecuta todos los accesos de catálogo a través de Stored Procedures.

    ``modify(operation, vid=None, resource_id=None, payload=None)`` es la entrada
    de escritura. Las rutas la ejecutan bajo el bloqueo de ControlService.
    En movimientos de DEMO, ``payload['id_demo']`` proviene del identificador de
    la ruta, nunca de un campo libre enviado por el cliente.
    """

    def __init__(self, database: Database):
        self.database = database

    @staticmethod
    def _vehicle(session, vid: int) -> dict:
        rows = session.call("sp_obtener_vehiculo", (vid,))
        if not rows:
            raise ApiError(404, "El vehículo no existe.")
        return rows[0]

    @staticmethod
    def _command(session, vid: int, command_id: int, active: bool = False) -> dict:
        commands = session.call("sp_obtener_comandos_vehiculo", (vid,))
        for command in commands:
            if command["id_comando"] == command_id:
                if active and not command["activo"]:
                    raise ApiError(409, "El comando está inactivo.")
                return command
        raise ApiError(404, "El comando no existe o no pertenece al vehículo.")

    @staticmethod
    def _demo(session, vid: int, demo_id: int) -> dict:
        rows = session.call("sp_obtener_demos", (vid,))
        for demo in rows:
            if demo["id_demo"] == demo_id:
                return demo
        raise ApiError(404, "La DEMO no existe o no pertenece al vehículo.")

    @staticmethod
    def _demo_movement(session, demo_id: int, movement_id: int) -> dict:
        for movement in session.call("sp_obtener_movimientos_demo", (demo_id,)):
            if movement["id_demo_movimiento"] == movement_id:
                return movement
        raise ApiError(404, "El movimiento no existe o no pertenece a la DEMO.")

    def vehicles(self) -> list[dict]:
        with self.database.session() as session:
            return session.call("sp_obtener_vehiculos")

    def vehicle(self, vid: int) -> dict:
        with self.database.session() as session:
            return self._vehicle(session, vid)

    def detail(self, vid: int) -> dict:
        with self.database.session() as session:
            vehicle = self._vehicle(session, vid)
            state = session.call("sp_obtener_estado", (vid,))
            return {
                "vehiculo": vehicle,
                "comandos": session.call("sp_obtener_comandos_vehiculo", (vid,)),
                "estado": state[0] if state else None,
                "demos": session.call("sp_obtener_demos", (vid,)),
            }

    def commands(self, vid: int) -> list[dict]:
        with self.database.session() as session:
            self._vehicle(session, vid)
            return session.call("sp_obtener_comandos_vehiculo", (vid,))

    def state(self, vid: int) -> dict | None:
        with self.database.session() as session:
            self._vehicle(session, vid)
            rows = session.call("sp_obtener_estado", (vid,))
            return rows[0] if rows else None

    def history(self, vid: int) -> list[dict]:
        with self.database.session() as session:
            self._vehicle(session, vid)
            rows = session.call("sp_obtener_historial", (vid,))
            # El SP conserva el historial completo y ya ordena fecha/ID DESC.
            return [row for row in rows if str(row["origen"]).strip().upper() != "DEMO"][:10]

    def demos(self, vid: int) -> list[dict]:
        with self.database.session() as session:
            self._vehicle(session, vid)
            return session.call("sp_obtener_demos", (vid,))

    def demo(self, vid: int, demo_id: int) -> dict:
        with self.database.session() as session:
            self._vehicle(session, vid)
            return self._demo(session, vid, demo_id)

    def demo_movements(self, vid: int, demo_id: int) -> list[dict]:
        with self.database.session() as session:
            self._vehicle(session, vid)
            self._demo(session, vid, demo_id)
            return session.call("sp_obtener_movimientos_demo", (demo_id,))

    def modify(
        self, operation: str, vid: int | None = None,
        resource_id: int | None = None, payload: Any = None,
    ) -> dict:
        """Valida relaciones y modifica en una única sesión/transacción.

        Operaciones: create/update/delete_vehicle, create/update/delete_command,
        create/update/delete_demo y create/update/delete_demo_movement.
        ``payload`` acepta un modelo Pydantic validado o un diccionario interno.
        """
        data = payload.model_dump() if hasattr(payload, "model_dump") else (payload or {})
        allowed = {
            "create_vehicle", "update_vehicle", "delete_vehicle",
            "create_command", "update_command", "delete_command",
            "create_demo", "update_demo", "delete_demo",
            "create_demo_movement", "update_demo_movement", "delete_demo_movement",
        }
        if operation not in allowed:
            raise ValueError("Operación de catálogo no reconocida.")
        with self.database.session(write=True) as session:
            if operation == "create_vehicle":
                row = session.call("sp_crear_vehiculo", (
                    data["nombre"], data.get("modelo"), data.get("descripcion"),
                    data.get("microcontrolador"),
                ))[0]
                return self._vehicle(session, row["id_vehiculo"])

            self._vehicle(session, vid)
            if operation == "update_vehicle":
                session.call("sp_actualizar_vehiculo", (
                    vid, data["nombre"], data.get("modelo"), data.get("descripcion"),
                    data.get("microcontrolador"), data["activo"],
                ))
                return self._vehicle(session, vid)
            if operation == "delete_vehicle":
                session.call("sp_eliminar_vehiculo", (vid,))
                return {"mensaje": "Vehículo eliminado.", "recurso": "vehiculo", "id": vid}

            if operation == "create_command":
                row = session.call("sp_crear_comando", (
                    vid, data["nombre"], data["codigo"], data.get("descripcion"),
                ))[0]
                return self._command(session, vid, row["id_comando"])
            if operation in {"update_command", "delete_command"}:
                self._command(session, vid, resource_id)
                if operation == "update_command":
                    session.call("sp_actualizar_comando", (
                        resource_id, data["nombre"], data["codigo"],
                        data.get("descripcion"), data["activo"],
                    ))
                    return self._command(session, vid, resource_id)
                session.call("sp_eliminar_comando", (resource_id,))
                return {"mensaje": "Comando eliminado.", "recurso": "comando", "id": resource_id}

            if operation == "create_demo":
                row = session.call("sp_crear_demo", (vid, data["nombre"], data.get("descripcion")))[0]
                return self._demo(session, vid, row["id_demo"])
            if operation in {"update_demo", "delete_demo"}:
                self._demo(session, vid, resource_id)
                if operation == "update_demo":
                    session.call("sp_actualizar_demo", (
                        resource_id, data["nombre"], data.get("descripcion"), data["activo"],
                    ))
                    return self._demo(session, vid, resource_id)
                session.call("sp_eliminar_demo", (resource_id,))
                return {"mensaje": "DEMO eliminada.", "recurso": "demo", "id": resource_id}

            demo_id = data["id_demo"]
            self._demo(session, vid, demo_id)
            if operation in {"update_demo_movement", "delete_demo_movement"}:
                self._demo_movement(session, demo_id, resource_id)
            if operation == "delete_demo_movement":
                session.call("sp_eliminar_movimiento_demo", (resource_id,))
                return {"mensaje": "Movimiento DEMO eliminado.", "recurso": "demo_movimiento", "id": resource_id}

            self._command(session, vid, data["id_comando"], active=True)
            parameters = (data["id_comando"], data["orden"], data["duracion_ms"], data["pausa_ms"])
            if operation == "create_demo_movement":
                session.call("sp_agregar_movimiento_demo", (demo_id, *parameters))
                resource_id = session.last_insert_id()
            else:
                session.call("sp_actualizar_movimiento_demo", (resource_id, *parameters))
            return self._demo_movement(session, demo_id, resource_id)

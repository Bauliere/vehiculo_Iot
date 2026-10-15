import asyncio
from collections import defaultdict

from app.async_db import run_db
from app.errors import ApiError
from app.websocket.websocket_manager import event


class ControlService:
    def __init__(self, database, catalog, websocket_manager):
        self.database = database
        self.catalog = catalog
        self.websocket_manager = websocket_manager
        self.locks = defaultdict(asyncio.Lock)
        self.demos = None

    def lock_for(self, id_vehiculo):
        return self.locks[id_vehiculo]

    def ensure_idle(self, id_vehiculo):
        if self.demos and id_vehiculo in self.demos.runs:
            raise ApiError(409, "Hay una DEMO en ejecución. Cancélala antes de modificar o mover el vehículo.")

    async def catalog_write(self, id_vehiculo, function, *args):
        async with self.lock_for(id_vehiculo):
            self.ensure_idle(id_vehiculo)
            return await run_db(function, *args)

    @staticmethod
    def require_vehicle(session, id_vehiculo, active=True):
        rows = session.call("sp_obtener_vehiculo", (id_vehiculo,))
        if not rows:
            raise ApiError(404, "Vehículo inexistente.")
        vehicle = rows[0]
        if active and not vehicle["activo"]:
            raise ApiError(409, "El vehículo está inactivo.")
        return vehicle

    @staticmethod
    def require_command(session, id_vehiculo, id_comando):
        commands = session.call("sp_obtener_comandos_vehiculo", (id_vehiculo,))
        command = next((c for c in commands if c["id_comando"] == id_comando), None)
        if command is None:
            raise ApiError(404, "Comando inexistente o perteneciente a otro vehículo.")
        if not command["activo"]:
            raise ApiError(409, "El comando está inactivo.")
        return command

    @staticmethod
    def require_stop(session, id_vehiculo):
        commands = session.call("sp_obtener_comandos_vehiculo", (id_vehiculo,))
        command = next((c for c in commands if str(c["nombre"]).strip().upper() == "DETENER" and c["activo"]), None)
        if command is None:
            raise ApiError(409, "Configura un comando activo llamado DETENER para finalizar o cancelar la DEMO.")
        return command

    @staticmethod
    def update_state(session, id_vehiculo, id_comando):
        previous = session.call("sp_obtener_estado", (id_vehiculo,))
        connected = bool(previous[0]["conectado"]) if previous else False
        # HTTP y clientes de monitoreo no acreditan conexión del microcontrolador.
        session.call("sp_actualizar_estado", (id_vehiculo, id_comando, connected))
        return session.call("sp_obtener_estado", (id_vehiculo,))[0]

    def individual(self, id_vehiculo, id_comando, origen):
        if origen not in ("MANUAL", "POSTMAN", "API"):
            raise ApiError(400, "Origen de movimiento individual inválido.")
        with self.database.session(write=True) as session:
            self.require_vehicle(session, id_vehiculo)
            command = self.require_command(session, id_vehiculo, id_comando)
            state = self.update_state(session, id_vehiculo, id_comando)
            session.call("sp_registrar_historial", (id_vehiculo, id_comando, origen))
        return command, state

    async def move(self, id_vehiculo, id_comando, origen):
        async with self.lock_for(id_vehiculo):
            self.ensure_idle(id_vehiculo)
            command, state = await run_db(self.individual, id_vehiculo, id_comando, origen)
            await self.websocket_manager.publicar(id_vehiculo, event(
                "movimiento_individual", id_vehiculo, command["nombre"], command["codigo"],
                id_comando=id_comando, origen=origen, estado=state,
            ))
        return {"mensaje": "Movimiento individual registrado.", "id_vehiculo": id_vehiculo,
                "id_comando": id_comando, "origen": origen, "estado": state}

    def prepare_demo(self, id_vehiculo, id_demo):
        with self.database.session() as session:
            self.require_vehicle(session, id_vehiculo)
            demos = session.call("sp_obtener_demos", (id_vehiculo,))
            demo = next((d for d in demos if d["id_demo"] == id_demo), None)
            if demo is None:
                raise ApiError(404, "DEMO inexistente o perteneciente a otro vehículo.")
            if not demo["activo"]:
                raise ApiError(409, "La DEMO está inactiva.")
            self.require_stop(session, id_vehiculo)
            movements = session.call("sp_obtener_movimientos_demo", (id_demo,))
            if not movements:
                raise ApiError(409, "La DEMO no contiene movimientos.")
            orders = set()
            for movement in movements:
                self.require_command(session, id_vehiculo, movement["id_comando"])
                if (movement["orden"] <= 0 or movement["orden"] in orders
                        or not 1 <= movement["duracion_ms"] <= 60000
                        or not 0 <= movement["pausa_ms"] <= 60000):
                    raise ApiError(409, "La DEMO contiene órdenes o tiempos inválidos (máximo 60000 ms por intervalo).")
                orders.add(movement["orden"])
            return sorted(movements, key=lambda item: item["orden"])

    def demo_step(self, id_vehiculo, id_comando):
        with self.database.session(write=True) as session:
            self.require_vehicle(session, id_vehiculo)
            self.require_command(session, id_vehiculo, id_comando)
            return self.update_state(session, id_vehiculo, id_comando)

    def finalize_demo(self, id_vehiculo):
        with self.database.session(write=True) as session:
            self.require_vehicle(session, id_vehiculo, active=False)
            stop = self.require_stop(session, id_vehiculo)
            state = self.update_state(session, id_vehiculo, stop["id_comando"])
        return state

import asyncio
import logging
import secrets
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime

from fastapi import WebSocketDisconnect

from app.async_db import run_db
from app.errors import ApiError
from app.services.commercial_store import Actor, FleetStore, IdentityStore, utcnow
from app.services.exhibition_store import ExhibitionStore
from app.websocket.websocket_manager import event

logger = logging.getLogger(__name__)


@dataclass
class Channel:
    actor: Actor
    vehicle_id: int
    socket: object
    expires: datetime
    last_command: float = float("-inf")


class CommercialService:
    def __init__(self, runtime):
        self.runtime = runtime
        self.fleet = FleetStore(runtime.database)
        self.identity = IdentityStore(runtime.database)
        self.exhibition = ExhibitionStore(runtime.database)
        # El mismo worker serializa permisos, entregas, reservas y publicación de órdenes.
        self.gate = asyncio.Lock()
        self.channels = {}
        self.devices = {}
        self.operators = {}
        self.reservations = {}
        self.pending_stops = set()
        self.limits = {}
        self.task = None
        self.cleanups = set()

    @property
    def active(self):
        return self.runtime.settings.commercial_enabled

    @property
    def display_enabled(self):
        return self.active and self.runtime.settings.exhibition_enabled

    def limit(self, action, key, maximum):
        now = time.monotonic()
        history = self.limits.setdefault(action, deque())
        while history and now - history[0][0] >= 60:
            history.popleft()
        if len(history) >= 160 or sum(value == key for _, value in history) >= maximum:
            raise ApiError(429, "Demasiadas solicitudes. Espera un minuto para intentar de nuevo.")
        history.append((now, key))

    @staticmethod
    def enforce_role(actor, *allowed):
        if actor.role not in allowed:
            raise ApiError(403, "La cuenta no tiene permiso para esta operación.")
        return actor

    async def access_unit(self, actor, vehicle_id):
        unit = await run_db(self.fleet.unit, vehicle_id)
        if (unit["activo"] and unit["estado_comercial"] == "vendida" and (
            (actor.role == "usuario" and unit["id_cliente"] == actor.account_id) or
            (actor.role == "administrador" and unit["soporte_hasta"] is not None)
        )):
            return unit
        raise ApiError(403, "Esta unidad requiere asignación o autorización de soporte vigente.")

    def require_connected(self, vehicle_id):
        if vehicle_id in self.pending_stops:
            raise ApiError(409, "Hay una detención pendiente. Espera la recuperación del vehículo.")
        if vehicle_id not in self.devices:
            raise ApiError(409, "El dispositivo de esta unidad está desconectado.")

    def claim(self, actor, vehicle_id, channel_id):
        self.require_connected(vehicle_id)
        channel = self.channels.get(channel_id)
        if not channel or channel.actor.digest != actor.digest or channel.vehicle_id != vehicle_id or channel.expires <= utcnow():
            raise ApiError(409, "Conecta el canal WSS de esta pestaña antes de enviar órdenes.")
        if self.operators.get(vehicle_id, channel_id) != channel_id:
            raise ApiError(409, "Otra pestaña tiene el mando de esta unidad.")
        self.operators[vehicle_id] = channel_id
        return channel

    async def stop(self, vehicle_id):
        control = self.runtime.control
        running = self.runtime.demos.runs.get(vehicle_id)
        if running:
            running.cancel_event.set()
            await asyncio.shield(running.done.wait())
        async with control.lock_for(vehicle_id):
            state = await run_db(control.finalize_demo, vehicle_id)
            await self.runtime.websocket_manager.publicar(vehicle_id, event(
                "movimiento_individual", vehicle_id, state.get("comando"), state.get("codigo"),
                origen="SEGURIDAD", id_comando=state.get("id_comando"), estado=state,
            ))
        self.pending_stops.discard(vehicle_id)
        return state

    async def quiesce(self, vehicle_id):
        self.operators.pop(vehicle_id, None)
        try:
            await self.stop(vehicle_id)
            return True
        except ApiError:
            self.pending_stops.add(vehicle_id)
            logger.warning("Detención pendiente para la unidad %s.", vehicle_id)
            return False

    async def move(self, actor, vehicle_id, channel_id, command_id, origin):
        commands = await run_db(self.runtime.catalog.commands, vehicle_id)
        command = next((row for row in commands if row["id_comando"] == command_id and row["activo"]), None)
        if not command:
            raise ApiError(404, "El comando activo no pertenece a esta unidad.")
        if command["nombre"].strip().upper() == "DETENER":
            if vehicle_id in self.runtime.demos.runs:
                await self.stop(vehicle_id)
            result = await self.runtime.control.move(vehicle_id, command_id, origin)
            self.pending_stops.discard(vehicle_id)
            return result
        channel = self.claim(actor, vehicle_id, channel_id)
        if time.monotonic() - channel.last_command < (1.25 if actor.role == "invitado" else 0.05):
            raise ApiError(429, "Espera antes de enviar otra orden.")
        channel.last_command = time.monotonic()
        return await self.runtime.control.move(vehicle_id, command_id, origin)

    def start_demo(self, actor, vehicle_id, channel_id, demo_id):
        self.claim(actor, vehicle_id, channel_id)
        def prepare(vid, did):
            return self.fleet.safe_steps(self.runtime.control.prepare_demo(vid, did))
        return self.runtime.demos.start(vehicle_id, demo_id, prepare=prepare)

    async def finish_reservation(self, vehicle_id, reason):
        self.retire(lambda channel: channel.vehicle_id == vehicle_id and channel.actor.role == "invitado")
        stopped = await self.quiesce(vehicle_id)
        if stopped:
            await run_db(self.exhibition.end, vehicle_id, reason, True)
            self.reservations.pop(vehicle_id, None)
        elif vehicle_id in self.reservations:
            # Invalida la ventana de operación mientras se reintenta la detención.
            self.reservations[vehicle_id] = min(self.reservations[vehicle_id], utcnow())
        return stopped

    async def reserve(self, vehicle_id):
        if not self.display_enabled:
            raise ApiError(403, "Las pruebas de exhibición están pausadas por la empresa.")
        unit = await run_db(self.fleet.unit, vehicle_id)
        if unit["estado_comercial"] != "exhibicion":
            raise ApiError(404, "La unidad de exhibición no existe.")
        self.require_connected(vehicle_id)
        data = await run_db(self.exhibition.reserve, vehicle_id)
        self.reservations[vehicle_id] = data["vence"].replace(tzinfo=None)
        return data

    def filter_availability(self, models):
        for model in models:
            for unit in model["unidades"]:
                vehicle_id = unit["id_vehiculo"]
                unit["disponible"] = (self.display_enabled and not unit["ocupada"] and vehicle_id in self.devices
                                       and vehicle_id not in self.pending_stops)
        return models

    @property
    def manager(self):
        return self.runtime.websocket_manager

    def retire(self, predicate):
        for key, channel in tuple(self.channels.items()):
            if predicate(channel):
                self.channels.pop(key)
                self.manager.cerrar(channel.vehicle_id, channel.socket, 1008)

    async def revoke(self, predicate):
        affected = {channel.vehicle_id for key, channel in self.channels.items()
                    if predicate(channel) and self.operators.get(channel.vehicle_id) == key}
        self.retire(predicate)
        for vehicle_id in affected:
            await self.quiesce(vehicle_id)

    async def prepare_unit_change(self, vehicle_id):
        if vehicle_id in self.reservations:
            if not await self.finish_reservation(vehicle_id, "cambio_inventario"):
                raise ApiError(409, "Espera a que se confirme la detención antes de editar la unidad.")
        if vehicle_id in self.operators or vehicle_id in self.runtime.demos.runs or vehicle_id in self.pending_stops:
            if not await self.quiesce(vehicle_id):
                raise ApiError(409, "No se confirmó la detención previa al cambio de inventario.")
        self.retire(lambda channel: channel.vehicle_id == vehicle_id)

    async def browser_socket(self, websocket, vehicle_id):
        protocols = websocket.scope.get("subprotocols", [])
        token = next((protocol[5:] for protocol in protocols if protocol.startswith("auth.")), "")
        from app.security import TRUSTED_ORIGINS
        origin = websocket.headers.get("origin")
        host = websocket.url.netloc
        own_origin = f"https://{host}"
        if websocket.url.hostname in {"127.0.0.1", "localhost"}:
            own_origin = f"http://{host}"
        if "iot.v1" not in protocols or origin not in (*TRUSTED_ORIGINS, own_origin):
            raise ApiError(403, "El canal del navegador requiere un origen autorizado.")
        async with self.gate:
            is_guest = token.startswith("g_")
            if is_guest:
                if not self.display_enabled:
                    raise ApiError(403, "La exhibición está pausada.")
                actor = await run_db(self.exhibition.guest, token)
                if actor.vehicle_id != vehicle_id or self.reservations.get(vehicle_id, actor.expires) <= utcnow():
                    raise ApiError(403, "La reserva no corresponde a esta unidad.")
                if any(channel.actor.digest == actor.digest for channel in self.channels.values()):
                    raise ApiError(409, "La prueba ya tiene una pestaña conectada.")
                state = None
                expires = actor.expires
            else:
                actor = await run_db(self.identity.account, token)
                unit = await self.access_unit(actor, vehicle_id)
                expires = (min(actor.expires, unit["soporte_hasta"].replace(tzinfo=None))
                           if actor.role == "administrador" else actor.expires)
                state = await run_db(self.runtime.catalog.state, vehicle_id)
            channel_id = secrets.token_urlsafe(18)
            await self.manager.conectar(vehicle_id, websocket, subprotocol="iot.v1", receive_events=not is_guest)
            self.channels[channel_id] = Channel(actor, vehicle_id, websocket, expires)
            if not is_guest:
                await self.manager.enviar(vehicle_id, websocket, self.initial_event(vehicle_id, state))
            await self.manager.enviar(vehicle_id, websocket, event(
                "canal_control", vehicle_id, canal=channel_id, dispositivo=vehicle_id in self.devices))
        try:
            while True:
                await websocket.receive_text()
        finally:
            await self.keep_cleanup(self.browser_disconnected(channel_id, vehicle_id, websocket, is_guest))

    async def browser_disconnected(self, channel_id, vehicle_id, websocket, is_guest):
        async with self.gate:
            if self.channels.pop(channel_id, None):
                self.manager.desconectar(vehicle_id, websocket)
                if is_guest:
                    await self.finish_reservation(vehicle_id, "desconexion_exhibicion")
                elif self.operators.get(vehicle_id) == channel_id:
                    await self.quiesce(vehicle_id)

    @staticmethod
    def initial_event(vehicle_id, state):
        return event("estado_inicial", vehicle_id,
                     state.get("comando") if state else None, state.get("codigo") if state else None, estado=state)

    async def device_socket(self, websocket, vehicle_id, credential):
        async with self.gate:
            if not await run_db(self.identity.device, vehicle_id, credential):
                raise ApiError(401, "Credencial de dispositivo inválida.")
            if vehicle_id in self.devices:
                raise ApiError(409, "La unidad ya tiene un dispositivo conectado.")
            state = await run_db(self.runtime.catalog.state, vehicle_id)
            await self.manager.conectar(vehicle_id, websocket)
            self.devices[vehicle_id] = websocket
            await self.manager.enviar(vehicle_id, websocket, self.initial_event(vehicle_id, state))
            await self.notify_device(vehicle_id, True)
        try:
            while True:
                await websocket.receive_text()
        finally:
            await self.keep_cleanup(self.device_disconnected(vehicle_id, websocket))

    async def device_disconnected(self, vehicle_id, websocket):
        async with self.gate:
            self.manager.desconectar(vehicle_id, websocket)
            self.devices.pop(vehicle_id, None)
            await self.notify_device(vehicle_id, False)
            if vehicle_id in self.reservations:
                await self.finish_reservation(vehicle_id, "dispositivo_desconectado")
            elif vehicle_id in self.operators or vehicle_id in self.runtime.demos.runs:
                await self.quiesce(vehicle_id)

    async def keep_cleanup(self, coroutine):
        # El cierre del transporte puede cancelar la tarea ASGI. La parada debe continuar.
        task = asyncio.create_task(coroutine)
        self.cleanups.add(task)
        task.add_done_callback(self.cleanup_done)
        await asyncio.shield(task)

    def cleanup_done(self, task):
        self.cleanups.discard(task)
        if not task.cancelled() and task.exception():
            logger.warning("Cierre de canal pendiente (%s).", type(task.exception()).__name__)

    async def notify_device(self, vehicle_id, connected):
        message = event("dispositivo", vehicle_id, conectado=connected)
        for channel in tuple(self.channels.values()):
            if channel.vehicle_id == vehicle_id:
                await self.manager.enviar(vehicle_id, channel.socket, message)

    async def socket(self, websocket, vehicle_id):
        try:
            credential = websocket.headers.get("x-device-key")
            if credential:
                await self.device_socket(websocket, vehicle_id, credential)
            else:
                await self.browser_socket(websocket, vehicle_id)
        except WebSocketDisconnect:
            pass
        except ApiError as error:
            logger.debug("Canal WSS de la unidad %s rechazado (HTTP %s). %s", vehicle_id, error.status_code, error.detail)
            await self.manager.close_socket(websocket, 1008 if error.status_code < 500 else 1011)

    async def supervise(self):
        recovered = False
        while True:
            try:
                async with self.gate:
                    if not recovered:
                        for row in await run_db(self.exhibition.open_reservations):
                            self.reservations.setdefault(row["id_vehiculo"], utcnow())
                        recovered = True
                    now = utcnow()
                    await self.revoke(lambda channel: channel.actor.role != "invitado" and channel.expires <= now)
                    for vehicle_id, expires in tuple(self.reservations.items()):
                        if expires <= now:
                            await self.finish_reservation(vehicle_id, "fin_exhibicion")
                    for vehicle_id in self.pending_stops.difference(self.reservations):
                        await self.quiesce(vehicle_id)
            except ApiError as error:
                logger.warning("Supervisión comercial aplazada (HTTP %s).", error.status_code)
            await asyncio.sleep(1)

    def start(self):
        if self.active:
            self.task = asyncio.create_task(self.supervise())

    async def shutdown(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            await asyncio.gather(*tuple(self.cleanups), return_exceptions=True)
            for vehicle_id in tuple(self.reservations):
                try:
                    await self.finish_reservation(vehicle_id, "reinicio_servidor")
                except ApiError:
                    logger.warning("Reserva pendiente al cerrar el servidor para la unidad %s.", vehicle_id)

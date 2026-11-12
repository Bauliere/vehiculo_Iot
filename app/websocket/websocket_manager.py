import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi.encoders import jsonable_encoder


def event(tipo: str, id_vehiculo: int, comando=None, codigo=None, **data):
    return jsonable_encoder({
        "tipo": tipo, "id_vehiculo": id_vehiculo,
        "comando": comando, "codigo": codigo,
        "timestamp": datetime.now(timezone.utc).isoformat(), **data,
    })


@dataclass
class _Connection:
    queue: asyncio.Queue
    task: asyncio.Task | None = None


class WebSocketManager:
    """Una cola acotada y un emisor por cliente, sin frenar el control."""

    def __init__(self, max_pending=64):
        self.clientes = defaultdict(set)
        self._connections = {}
        self._tasks = set()
        self._max_pending = max_pending

    def _track(self, coroutine):
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def conectar(self, id_vehiculo, websocket):
        await websocket.accept()
        self.clientes[id_vehiculo].add(websocket)
        connection = _Connection(asyncio.Queue(maxsize=self._max_pending))
        self._connections[websocket] = connection
        connection.task = self._track(self._send_loop(id_vehiculo, websocket, connection))

    def desconectar(self, id_vehiculo, websocket):
        clients = self.clientes.get(id_vehiculo)
        if clients is not None:
            clients.discard(websocket)
            if not clients:
                self.clientes.pop(id_vehiculo, None)
        connection = self._connections.pop(websocket, None)
        if connection and connection.task is not asyncio.current_task():
            connection.task.cancel()

    @staticmethod
    async def _close(websocket, code):
        try:
            await asyncio.wait_for(websocket.close(code=code), timeout=1)
        except Exception:
            pass

    async def _send_loop(self, id_vehiculo, websocket, connection):
        try:
            while True:
                message = await connection.queue.get()
                try:
                    await asyncio.wait_for(websocket.send_json(message), timeout=2)
                finally:
                    connection.queue.task_done()
        except asyncio.CancelledError:
            raise
        except Exception:
            self.desconectar(id_vehiculo, websocket)
            await self._close(websocket, 1011)
        finally:
            while not connection.queue.empty():
                connection.queue.get_nowait()
                connection.queue.task_done()

    def _enqueue(self, id_vehiculo, websocket, mensaje):
        connection = self._connections.get(websocket)
        if connection is None:
            return
        try:
            connection.queue.put_nowait(mensaje)
        except asyncio.QueueFull:
            # Se desconecta el receptor atrasado; no se omiten eventos a escondidas.
            self.desconectar(id_vehiculo, websocket)
            self._track(self._close(websocket, 1013))

    async def enviar(self, id_vehiculo, websocket, mensaje):
        self._enqueue(id_vehiculo, websocket, jsonable_encoder(mensaje))

    async def publicar(self, id_vehiculo, mensaje):
        message = jsonable_encoder(mensaje)
        for client in tuple(self.clientes.get(id_vehiculo, ())):
            self._enqueue(id_vehiculo, client, message)

    async def shutdown(self):
        for vehicle, clients in tuple(self.clientes.items()):
            for client in tuple(clients):
                self.desconectar(vehicle, client)
                self._track(self._close(client, 1001))
        await asyncio.gather(*tuple(self._tasks), return_exceptions=True)

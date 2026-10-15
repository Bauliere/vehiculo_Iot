import asyncio
from collections import defaultdict
from datetime import datetime, timezone

from fastapi.encoders import jsonable_encoder


def event(tipo: str, id_vehiculo: int, comando=None, codigo=None, **data):
    return jsonable_encoder({
        "tipo": tipo, "id_vehiculo": id_vehiculo,
        "comando": comando, "codigo": codigo,
        "timestamp": datetime.now(timezone.utc).isoformat(), **data,
    })


class WebSocketManager:
    """Clientes aislados por vehículo y envíos serializados por conexión."""

    def __init__(self):
        self.clientes = defaultdict(set)
        self.send_locks = {}

    async def conectar(self, id_vehiculo, websocket):
        await websocket.accept()
        self.clientes[id_vehiculo].add(websocket)
        self.send_locks[websocket] = asyncio.Lock()

    def desconectar(self, id_vehiculo, websocket):
        clients = self.clientes.get(id_vehiculo)
        if clients is not None:
            clients.discard(websocket)
            if not clients:
                self.clientes.pop(id_vehiculo, None)
        self.send_locks.pop(websocket, None)

    async def enviar(self, id_vehiculo, websocket, mensaje):
        lock = self.send_locks.get(websocket)
        if lock is None:
            return
        try:
            async with lock:
                await asyncio.wait_for(websocket.send_json(jsonable_encoder(mensaje)), timeout=2)
        except Exception:
            self.desconectar(id_vehiculo, websocket)
            try:
                await asyncio.wait_for(websocket.close(code=1011), timeout=1)
            except Exception:
                pass

    async def publicar(self, id_vehiculo, mensaje):
        await asyncio.gather(*(
            self.enviar(id_vehiculo, client, mensaje)
            for client in tuple(self.clientes.get(id_vehiculo, ()))
        ))

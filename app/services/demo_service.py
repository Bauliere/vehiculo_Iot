import asyncio
import logging
from dataclasses import dataclass, field

from app.async_db import run_db
from app.errors import ApiError
from app.websocket.websocket_manager import event

logger = logging.getLogger(__name__)


@dataclass
class DemoRun:
    id_demo: int
    movements: list
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    done: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    error: str | None = None
    terminal_event: str | None = None


class DemoService:
    """Una secuencia por vehículo, con esperas interrumpibles y final DETENER."""

    def __init__(self, control):
        self.control = control
        self.runs = {}
        self.closing = False

    async def start(self, id_vehiculo, id_demo):
        async with self.control.lock_for(id_vehiculo):
            if self.closing:
                raise ApiError(503, "El servidor está cerrando.")
            self.control.ensure_idle(id_vehiculo)
            movements = await run_db(self.control.prepare_demo, id_vehiculo, id_demo)
            run = DemoRun(id_demo, movements)
            self.runs[id_vehiculo] = run
            run.task = asyncio.create_task(self._execute(id_vehiculo, run))
        return {"mensaje": "DEMO iniciada.", "id_vehiculo": id_vehiculo,
                "id_demo": id_demo, "estado": "en_ejecucion"}

    async def cancel(self, id_vehiculo, id_demo):
        run = self.runs.get(id_vehiculo)
        if run is None:
            raise ApiError(404, "No hay una DEMO en ejecución para este vehículo.")
        if run.id_demo != id_demo:
            raise ApiError(409, "La DEMO en ejecución tiene otro identificador.")
        if run.terminal_event == "demo_fin":
            raise ApiError(409, "La DEMO ya está finalizando; el estado DETENER fue persistido.")
        # Se marca antes de esperar el lock o una consulta en curso.
        run.cancel_event.set()
        await asyncio.shield(run.done.wait())
        if run.error:
            raise ApiError(503, run.error)
        return {"mensaje": "DEMO cancelada y estado actualizado a DETENER.",
                "id_vehiculo": id_vehiculo, "id_demo": id_demo, "estado": "cancelada"}

    async def _execute(self, id_vehiculo, run):
        manager = self.control.websocket_manager
        try:
            await manager.publicar(id_vehiculo, event(
                "demo_inicio", id_vehiculo, id_demo=run.id_demo,
                total_movimientos=len(run.movements),
            ))
            for movement in run.movements:
                async with self.control.lock_for(id_vehiculo):
                    if run.cancel_event.is_set():
                        break
                    state = await run_db(self.control.demo_step, id_vehiculo, movement["id_comando"])
                    if run.cancel_event.is_set():
                        break
                    await manager.publicar(id_vehiculo, event(
                        "demo_movimiento", id_vehiculo, movement["comando"], movement["codigo"],
                        id_demo=run.id_demo, id_demo_movimiento=movement["id_demo_movimiento"],
                        id_comando=movement["id_comando"], orden=movement["orden"],
                        duracion_ms=movement["duracion_ms"], pausa_ms=movement["pausa_ms"], estado=state,
                    ))
                try:
                    await asyncio.wait_for(run.cancel_event.wait(),
                        timeout=(movement["duracion_ms"] + movement["pausa_ms"]) / 1000)
                    break
                except TimeoutError:
                    pass
            async with self.control.lock_for(id_vehiculo):
                state = await run_db(self.control.finalize_demo, id_vehiculo)
                tipo = "demo_cancelada" if run.cancel_event.is_set() else "demo_fin"
                run.terminal_event = tipo
                await manager.publicar(id_vehiculo, event(
                    tipo, id_vehiculo, state.get("comando"), state.get("codigo"),
                    id_demo=run.id_demo, estado=state,
                ))
        except Exception as error:
            logger.warning("DEMO finalizada por error (%s).", type(error).__name__)
            detail = error.detail if isinstance(error, ApiError) else "Error interno durante la DEMO."
            try:
                async with self.control.lock_for(id_vehiculo):
                    await run_db(self.control.finalize_demo, id_vehiculo)
            except Exception:
                detail += " No fue posible persistir DETENER en RDS."
            run.error = detail
            await manager.publicar(id_vehiculo, event(
                "demo_error", id_vehiculo, id_demo=run.id_demo, detail=detail,
            ))
        finally:
            self.runs.pop(id_vehiculo, None)
            run.done.set()

    async def shutdown(self):
        self.closing = True
        runs = tuple(self.runs.values())
        for run in runs:
            run.cancel_event.set()
        await asyncio.gather(*(run.task for run in runs if run.task), return_exceptions=True)

"""Rutas GET/POST; reglas de negocio y persistencia viven en los servicios."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request

from app.async_db import run_db
from app.models.api import (
    Command, CommandCreate, CommandUpdate, Demo, DemoCreate, DemoUpdate,
    DemoExecutionResult, DemoMovement, DemoMovementInput, DeleteResult,
    ErrorResponse, HistoryItem, MovementInput, MovementResult,
    Vehicle, VehicleCreate, VehicleDetail, VehicleState, VehicleUpdate,
)
from app.security import require_admin, require_control


router = APIRouter()
IdPath = Annotated[int, Path(gt=0, le=2_147_483_647, description="Identificador positivo del recurso.")]
READ_ERRORS = {
    404: {"model": ErrorResponse, "description": "Recurso inexistente o ajeno al vehículo indicado."},
    503: {"model": ErrorResponse, "description": "RDS no está disponible o la conexión no está configurada."},
    500: {"model": ErrorResponse, "description": "Error interno controlado."},
}
WRITE_ERRORS = {
    **READ_ERRORS,
    400: {"model": ErrorResponse, "description": "Datos incompatibles con la operación."},
    401: {"model": ErrorResponse, "description": "Falta una credencial válida."},
    403: {"model": ErrorResponse, "description": "El token no tiene autorización para esta operación."},
    409: {"model": ErrorResponse, "description": "DEMO en ejecución, recurso inactivo, duplicado o referencia que impide eliminar."},
}


def _runtime(request: Request):
    return request.app.state.runtime


async def _write(request: Request, operation: str, vid=None, resource_id=None, payload=None):
    runtime = _runtime(request)
    return await runtime.control.catalog_write(vid or 0, runtime.catalog.modify, operation, vid, resource_id, payload)


@router.get("/vehiculos", response_model=list[Vehicle], tags=["Vehículos"], summary="Consultar todos los vehículos", description="Ejecuta sp_obtener_vehiculos. Una lista vacía es una consulta válida.", responses=READ_ERRORS)
async def vehicles(request: Request):
    return await run_db(_runtime(request).catalog.vehicles)


@router.get("/vehiculos/{id_vehiculo}", response_model=VehicleDetail, tags=["Vehículos"], summary="Consultar vehículo, comandos, estado y DEMO", description="Ejecuta sp_obtener_vehiculo, sp_obtener_comandos_vehiculo, sp_obtener_estado y sp_obtener_demos. estado=null significa que todavía no existe un estado; un vehículo inexistente devuelve 404.", responses=READ_ERRORS)
async def vehicle(request: Request, id_vehiculo: IdPath):
    return await run_db(_runtime(request).catalog.detail, id_vehiculo)


@router.post("/vehiculos", response_model=Vehicle, status_code=201, tags=["Vehículos"], summary="Crear un vehículo", description="Administrador. Ejecuta sp_crear_vehiculo y consulta el recurso creado. El SP establece activo=true.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def create_vehicle(request: Request, body: VehicleCreate):
    return await _write(request, "create_vehicle", payload=body)


@router.post("/vehiculos/{id_vehiculo}/actualizar", response_model=Vehicle, tags=["Vehículos"], summary="Actualizar un vehículo", description="Administrador. Ejecuta sp_actualizar_vehiculo. Envía todos los campos editables; los opcionales omitidos quedan en null.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def update_vehicle(request: Request, id_vehiculo: IdPath, body: VehicleUpdate):
    return await _write(request, "update_vehicle", id_vehiculo, payload=body)


@router.post("/vehiculos/{id_vehiculo}/eliminar", response_model=DeleteResult, tags=["Vehículos"], summary="Eliminar un vehículo", description="Administrador. Ejecuta sp_eliminar_vehiculo; es una eliminación física y sus relaciones aplican las reglas de FK existentes. Puede devolver 409 por referencias que impiden borrar.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def delete_vehicle(request: Request, id_vehiculo: IdPath):
    return await _write(request, "delete_vehicle", id_vehiculo)


@router.get("/vehiculos/{id_vehiculo}/comandos", response_model=list[Command], tags=["Comandos"], summary="Consultar el catálogo del vehículo", description="Ejecuta sp_obtener_comandos_vehiculo. Incluye comandos activos e inactivos; un vehículo existente sin comandos devuelve [].", responses=READ_ERRORS)
async def commands(request: Request, id_vehiculo: IdPath):
    return await run_db(_runtime(request).catalog.commands, id_vehiculo)


@router.post("/vehiculos/{id_vehiculo}/comandos", response_model=Command, status_code=201, tags=["Comandos"], summary="Crear un comando en el catálogo", description="Administrador. Ejecuta sp_crear_comando. Crear un comando no ejecuta un movimiento. El código admite el rango INT de MySQL.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def create_command(request: Request, id_vehiculo: IdPath, body: CommandCreate):
    return await _write(request, "create_command", id_vehiculo, payload=body)


@router.post("/vehiculos/{id_vehiculo}/comandos/{id_comando}/actualizar", response_model=Command, tags=["Comandos"], summary="Actualizar un comando", description="Administrador. Valida que el comando pertenezca al vehículo y ejecuta sp_actualizar_comando.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def update_command(request: Request, id_vehiculo: IdPath, id_comando: IdPath, body: CommandUpdate):
    return await _write(request, "update_command", id_vehiculo, id_comando, body)


@router.post("/vehiculos/{id_vehiculo}/comandos/{id_comando}/eliminar", response_model=DeleteResult, tags=["Comandos"], summary="Eliminar un comando", description="Administrador. Ejecuta sp_eliminar_comando. Un comando utilizado por movimientos DEMO produce 409; historial y estado conservan las reglas SET NULL del esquema.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def delete_command(request: Request, id_vehiculo: IdPath, id_comando: IdPath):
    return await _write(request, "delete_command", id_vehiculo, id_comando)


@router.get("/vehiculos/{id_vehiculo}/estado", response_model=VehicleState | None, tags=["Estado"], summary="Consultar el último estado", description="Ejecuta sp_obtener_estado. Devuelve null si el vehículo existe pero aún no tiene estado. conectado refleja el valor persistido; HTTP no confirma conexión física.", responses=READ_ERRORS)
async def state(request: Request, id_vehiculo: IdPath):
    return await run_db(_runtime(request).catalog.state, id_vehiculo)


@router.post("/vehiculos/{id_vehiculo}/movimientos", response_model=MovementResult, tags=["Estado"], summary="Ejecutar un movimiento individual", description="Requiere token de control o administrador. Valida vehículo/comando activos y pertenencia. Ejecuta sp_actualizar_estado + sp_registrar_historial en una transacción; después del commit publica WebSocket. Conserva conectado y no permite origen DEMO.", dependencies=[Depends(require_control)], responses=WRITE_ERRORS)
async def move(request: Request, id_vehiculo: IdPath, body: MovementInput):
    return await _runtime(request).control.move(id_vehiculo, body.id_comando, body.origen)


@router.get("/vehiculos/{id_vehiculo}/historial", response_model=list[HistoryItem], tags=["Historial"], summary="Consultar los últimos diez movimientos individuales", description="Ejecuta sp_obtener_historial. Filtra cualquier registro antiguo con origen DEMO y limita la respuesta a diez filas en orden fecha_hora e id_historial descendente; no elimina registros en RDS.", responses=READ_ERRORS)
async def history(request: Request, id_vehiculo: IdPath):
    return await run_db(_runtime(request).catalog.history, id_vehiculo)


@router.get("/vehiculos/{id_vehiculo}/demos", response_model=list[Demo], tags=["DEMO"], summary="Consultar las DEMO del vehículo", description="Ejecuta sp_obtener_demos. Incluye activas e inactivas; [] es válido si el vehículo no tiene DEMO.", responses=READ_ERRORS)
async def demos(request: Request, id_vehiculo: IdPath):
    return await run_db(_runtime(request).catalog.demos, id_vehiculo)


@router.get("/vehiculos/{id_vehiculo}/demos/{id_demo}", response_model=Demo, tags=["DEMO"], summary="Consultar una DEMO", description="Ejecuta sp_obtener_demos y valida existencia y pertenencia al vehículo.", responses=READ_ERRORS)
async def demo(request: Request, id_vehiculo: IdPath, id_demo: IdPath):
    return await run_db(_runtime(request).catalog.demo, id_vehiculo, id_demo)


@router.post("/vehiculos/{id_vehiculo}/demos", response_model=Demo, status_code=201, tags=["DEMO"], summary="Crear una DEMO", description="Administrador. Ejecuta sp_crear_demo. La secuencia se configura con los endpoints de movimientos; no es una secuencia fija.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def create_demo(request: Request, id_vehiculo: IdPath, body: DemoCreate):
    return await _write(request, "create_demo", id_vehiculo, payload=body)


@router.post("/vehiculos/{id_vehiculo}/demos/{id_demo}/actualizar", response_model=Demo, tags=["DEMO"], summary="Actualizar una DEMO", description="Administrador. Valida pertenencia y ejecuta sp_actualizar_demo.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def update_demo(request: Request, id_vehiculo: IdPath, id_demo: IdPath, body: DemoUpdate):
    return await _write(request, "update_demo", id_vehiculo, id_demo, body)


@router.post("/vehiculos/{id_vehiculo}/demos/{id_demo}/eliminar", response_model=DeleteResult, tags=["DEMO"], summary="Eliminar una DEMO y su secuencia", description="Administrador. Ejecuta sp_eliminar_demo; sus movimientos se eliminan mediante la relación CASCADE existente.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def delete_demo(request: Request, id_vehiculo: IdPath, id_demo: IdPath):
    return await _write(request, "delete_demo", id_vehiculo, id_demo)


@router.get("/vehiculos/{id_vehiculo}/demos/{id_demo}/movimientos", response_model=list[DemoMovement], tags=["Movimientos DEMO"], summary="Consultar la secuencia ordenada", description="Valida vehículo/DEMO y ejecuta sp_obtener_movimientos_demo. Devuelve los N movimientos por orden; una DEMO existente sin secuencia devuelve [].", responses=READ_ERRORS)
async def demo_movements(request: Request, id_vehiculo: IdPath, id_demo: IdPath):
    return await run_db(_runtime(request).catalog.demo_movements, id_vehiculo, id_demo)


@router.post("/vehiculos/{id_vehiculo}/demos/{id_demo}/movimientos", response_model=DemoMovement, status_code=201, tags=["Movimientos DEMO"], summary="Agregar un movimiento a la DEMO", description="Administrador. Valida DEMO y comando activo del mismo vehículo. Ejecuta sp_agregar_movimiento_demo. Duración 1…60000 ms; pausa 0…60000 ms.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def create_demo_movement(request: Request, id_vehiculo: IdPath, id_demo: IdPath, body: DemoMovementInput):
    return await _write(request, "create_demo_movement", id_vehiculo, payload={**body.model_dump(), "id_demo": id_demo})


@router.post("/vehiculos/{id_vehiculo}/demos/{id_demo}/movimientos/{id_demo_movimiento}/actualizar", response_model=DemoMovement, tags=["Movimientos DEMO"], summary="Actualizar un movimiento de la DEMO", description="Administrador. Valida la pertenencia del movimiento a la DEMO y del comando activo al vehículo. Ejecuta sp_actualizar_movimiento_demo.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def update_demo_movement(request: Request, id_vehiculo: IdPath, id_demo: IdPath, id_demo_movimiento: IdPath, body: DemoMovementInput):
    return await _write(request, "update_demo_movement", id_vehiculo, id_demo_movimiento, {**body.model_dump(), "id_demo": id_demo})


@router.post("/vehiculos/{id_vehiculo}/demos/{id_demo}/movimientos/{id_demo_movimiento}/eliminar", response_model=DeleteResult, tags=["Movimientos DEMO"], summary="Eliminar un movimiento de la DEMO", description="Administrador. Valida todas las relaciones y ejecuta sp_eliminar_movimiento_demo.", dependencies=[Depends(require_admin)], responses=WRITE_ERRORS)
async def delete_demo_movement(request: Request, id_vehiculo: IdPath, id_demo: IdPath, id_demo_movimiento: IdPath):
    return await _write(request, "delete_demo_movement", id_vehiculo, id_demo_movimiento, {"id_demo": id_demo})


@router.post("/vehiculos/{id_vehiculo}/demos/{id_demo}/iniciar", response_model=DemoExecutionResult, status_code=202, tags=["DEMO"], summary="Iniciar una DEMO por WebSocket", description="Requiere control y un comando activo llamado DETENER para finalizar o cancelar. Consulta sp_obtener_movimientos_demo y ejecuta los N movimientos sin bloquear solicitudes, con sp_actualizar_estado y sin sp_registrar_historial. Publica inicio, movimientos y finalización. 202 indica aceptación; los eventos WebSocket comunican el resultado. Rechaza dos DEMO simultáneas del mismo vehículo.", dependencies=[Depends(require_control)], responses=WRITE_ERRORS)
async def start_demo(request: Request, id_vehiculo: IdPath, id_demo: IdPath):
    return await _runtime(request).demos.start(id_vehiculo, id_demo)


@router.post("/vehiculos/{id_vehiculo}/demos/{id_demo}/cancelar", response_model=DemoExecutionResult, tags=["DEMO"], summary="Cancelar una DEMO", description="Requiere control. Suspende movimientos posteriores y emite cancelación por WebSocket. La finalización actualiza el estado con el comando DETENER activo del catálogo; no registra historial DEMO. La respuesta 200 confirma la cancelación y el estado persistido, sin afirmar ejecución física.", dependencies=[Depends(require_control)], responses=WRITE_ERRORS)
async def cancel_demo(request: Request, id_vehiculo: IdPath, id_demo: IdPath):
    return await _runtime(request).demos.cancel(id_vehiculo, id_demo)

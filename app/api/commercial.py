from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.async_db import run_db
from app.errors import ApiError
from app.models.commercial import (AccountSession, AssignmentInput, AuditEntry, CatalogModel, CommercialDemo, Credentials,
                                   Customer, CustomerInput, DemoInput, EditableDemo, Editor, GuestCommand, GuestSession,
                                   Metrics, ModelInput, ModelRead, ModelSummary, OwnUnit, PlatformConfig, SupportInput,
                                   UnitInput, UnitRead, UnitStatus)
from app.services.commercial_store import as_utc
from app.services.exhibition_store import SESSION_SECONDS

router = APIRouter(prefix="/plataforma", tags=["Plataforma 4.3"], responses={
    401: {"description": "Falta una sesión vigente"}, 403: {"description": "Permiso insuficiente"},
    404: {"description": "Recurso no disponible"}, 409: {"description": "Conflicto de recurso o de operación"},
    429: {"description": "Límite de solicitudes"}, 503: {"description": "Servicio no disponible"},
})
Id = Annotated[int, Path(gt=0, le=2_147_483_647)]
Search = Annotated[str, Query(max_length=254)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=1_000_000)]
bearer = HTTPBearer(auto_error=False, description="Token de /plataforma/sesion o de una reserva de exhibición.")
Credential = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
ControlChannel = Annotated[str | None, Header(alias="X-IoT-Channel", max_length=24,
    description="Canal emitido al conectarse por WSS en 4.3. Necesario para iniciar una orden de movimiento.")]


def service(request):
    return request.app.state.runtime.commercial


def active(request: Request):
    ops = service(request)
    if not ops.active:
        raise ApiError(404, "La Administración 4.3 todavía no está habilitada en esta instancia.")
    return ops


def token(credential):
    return credential.credentials if credential else ""


def address(request):
    return request.client.host if request.client else ""


async def account_access(request: Request, credential: Credential, ops=Depends(active)):
    async with ops.gate:
        actor = await run_db(ops.identity.account, token(credential))
        request.state.commercial_actor = actor
        yield actor


Account = Annotated[object, Depends(account_access, scope="function")]


def admin_access(request: Request, actor: Account):
    return service(request).enforce_role(actor, "administrador")


Admin = Annotated[object, Depends(admin_access)]


async def guest_access(request: Request, credential: Credential, ops=Depends(active)):
    async with ops.gate:
        if not ops.display_enabled:
            raise ApiError(403, "La exhibición está pausada.")
        actor = await run_db(ops.exhibition.guest, token(credential))
        deadline = ops.reservations.get(actor.vehicle_id)
        if deadline is None or deadline != actor.expires:
            raise ApiError(401, "La prueba está finalizando.")
        request.state.commercial_actor = actor
        yield actor


Guest = Annotated[object, Depends(guest_access, scope="function")]


async def legacy_access(request: Request, credential: Credential):
    """Conserva métodos y cuerpos 4.1/4.2 y aplica permisos al activar 4.3."""
    ops = service(request)
    if not ops.active:
        yield
        return
    path = request.scope["route"].path
    params = request.path_params
    vehicle = params.get("id_vehiculo")
    if vehicle is not None and (not vehicle.isascii() or not vehicle.isdecimal() or len(vehicle) > 10
                                or not 1 <= int(vehicle) <= 2_147_483_647):
        raise ApiError(422, "El identificador de unidad no es válido.")

    async def authorize():
        actor = await run_db(ops.identity.account, token(credential))
        request.state.commercial_actor = actor
        if request.method == "POST" and path not in CONTROL_WRITES:
            raise ApiError(403, "La gestión comercial usa los endpoints de /plataforma.")
        if vehicle is not None:
            await ops.access_unit(actor, int(vehicle))
        if params.get("id_demo") is not None:
            rows = ops.fleet.visible_demos(await run_db(ops.fleet.demos, int(vehicle)), actor)
            if not any(str(row["id_demo"]) == params["id_demo"] for row in rows):
                raise ApiError(404, "La demostración no está disponible para esta cuenta.")

    if path.endswith("/fausto/interpretar"):
        # El proveedor de voz puede tardar. DETENER sigue disponible durante la consulta.
        async with ops.gate:
            await authorize()
        yield
        return
    async with ops.gate:
        await authorize()
        yield


CONTROL_WRITES = frozenset({
    "/vehiculos/{id_vehiculo}/movimientos",
    "/vehiculos/{id_vehiculo}/demos/{id_demo}/iniciar",
    "/vehiculos/{id_vehiculo}/demos/{id_demo}/cancelar",
    "/vehiculos/{id_vehiculo}/fausto/interpretar",
    "/vehiculos/{id_vehiculo}/fausto/{plan_id}/ejecutar",
    "/vehiculos/{id_vehiculo}/fausto/{plan_id}/cancelar",
})


@router.get("/config", response_model=PlatformConfig, summary="Identificar la modalidad de la plataforma")
def config(request: Request):
    return {"activa": service(request).active}


@router.post("/sesion", response_model=AccountSession, status_code=201, summary="Iniciar una sesión de cuenta")
async def login(request: Request, body: Credentials, ops=Depends(active)):
    ops.limit("login", address(request), 8)
    return await run_db(ops.identity.login, body.correo, body.clave.get_secret_value())


@router.delete("/sesion", status_code=204, summary="Cerrar sesión y revocar su canal de control")
async def logout(request: Request, actor: Account):
    ops = service(request)
    await run_db(ops.identity.logout, actor)
    await ops.revoke(lambda channel: channel.actor.digest == actor.digest)


@router.get("/dashboard", response_model=Metrics, summary="Consultar los totales comerciales y dispositivos conectados")
async def dashboard(request: Request, actor: Admin):
    ops = service(request)
    metrics = await run_db(ops.fleet.dashboard)
    devices = set(ops.devices)
    metrics.update(conectadas=len(devices), exhibicion_disponible=0)
    if ops.display_enabled and ops.reservations_loaded:
        metrics["exhibicion_disponible"] = await run_db(ops.exhibition.available, devices - ops.pending_stops - ops.occupied_units())
    return metrics


@router.get("/modelos", response_model=list[ModelSummary], summary="Buscar modelos comerciales")
async def models(request: Request, actor: Admin, q: Search = "", limit: Limit = 25, offset: Offset = 0):
    return await run_db(service(request).fleet.models, q, limit, offset)


@router.get("/modelos/{model_id}", response_model=ModelRead, summary="Consultar un modelo y sus capacidades")
async def model(request: Request, actor: Admin, model_id: Id):
    return await run_db(service(request).fleet.model, model_id)


@router.post("/modelos", response_model=ModelRead, status_code=201, summary="Crear un modelo y su catálogo de comandos")
async def create_model(request: Request, actor: Admin, body: ModelInput):
    return await run_db(service(request).fleet.save_model, actor, body, None)


@router.put("/modelos/{model_id}", response_model=ModelRead, summary="Editar o dar de baja un modelo")
async def update_model(request: Request, actor: Admin, model_id: Id, body: ModelInput):
    ops = service(request)
    current = await run_db(ops.fleet.model, model_id)
    capabilities = sorted((c.model_dump() for c in body.capacidades), key=lambda c: c["codigo"])
    if current["capacidades"] != capabilities or (current["activo"] and not body.activo):
        affected = set(ops.reservations) | set(ops.devices) | ops.pending_stops | {c.vehicle_id for c in ops.channels.values()}
        for vehicle_id in affected:
            unit = await run_db(ops.fleet.unit, vehicle_id)
            if unit["id_modelo"] == model_id:
                await ops.prepare_unit_change(vehicle_id)
    return await run_db(ops.fleet.save_model, actor, body, model_id)


@router.get("/unidades", response_model=list[UnitRead], summary="Buscar el inventario comercial")
async def units(request: Request, actor: Admin, q: Search = "", estado: UnitStatus | None = None,
                limit: Limit = 25, offset: Offset = 0):
    ops = service(request)
    rows = await run_db(ops.fleet.units, q, limit, offset, status=estado)
    return [{**row, "dispositivo": row["id_vehiculo"] in ops.devices} for row in rows]


@router.post("/unidades", response_model=UnitRead, status_code=201, summary="Registrar una unidad física")
async def create_unit(request: Request, actor: Admin, body: UnitInput):
    return await run_db(service(request).fleet.save_unit, actor, body, None)


@router.put("/unidades/{vehicle_id}", response_model=UnitRead, summary="Editar o dar de baja una unidad")
async def update_unit(request: Request, actor: Admin, vehicle_id: Id, body: UnitInput):
    ops = service(request)
    unit = await run_db(ops.fleet.unit, vehicle_id)
    if unit["id_modelo"] != body.id_modelo or unit["estado_comercial"] != body.estado_comercial:
        await ops.prepare_unit_change(vehicle_id)
    return await run_db(ops.fleet.save_unit, actor, body, vehicle_id)


@router.put("/unidades/{vehicle_id}/asignacion", response_model=UnitRead, summary="Asignar, reasignar o liberar una unidad")
async def assignment(request: Request, actor: Admin, vehicle_id: Id, body: AssignmentInput):
    ops = service(request)
    current = await run_db(ops.fleet.unit, vehicle_id)
    if current["id_cliente"] != body.id_cliente and current["estado_comercial"] in {"disponible", "vendida"}:
        await ops.prepare_unit_change(vehicle_id)
    return await run_db(ops.fleet.assign, actor, vehicle_id, body.id_cliente)


@router.put("/unidades/{vehicle_id}/soporte", summary="Autorizar o revocar quince minutos de soporte por el comprador")
async def support(request: Request, actor: Account, vehicle_id: Id, body: SupportInput):
    ops = service(request)
    unit = await run_db(ops.fleet.support, actor, vehicle_id, body.autorizado)
    await ops.revoke(lambda channel: channel.vehicle_id == vehicle_id and channel.actor.role == "administrador")
    return {"soporte_hasta": unit["soporte_hasta"]}


@router.get("/mis-unidades", response_model=list[OwnUnit], summary="Listar unidades asignadas o autorizadas para soporte")
async def own_units(request: Request, actor: Account, limit: Limit = 25, offset: Offset = 0):
    rows = await run_db(service(request).fleet.units, limit=limit, offset=offset, actor=actor)
    return [{"id_vehiculo": row["id_vehiculo"], "nombre": row["nombre"], "nombre_modelo": row["nombre_modelo"],
             "soporte_hasta": as_utc(row["soporte_hasta"]) if row["soporte_hasta"] else None} for row in rows]


@router.get("/clientes", response_model=list[Customer], summary="Buscar cuentas de compradores")
async def customers(request: Request, actor: Admin, q: Search = "", limit: Limit = 25, offset: Offset = 0):
    return await run_db(service(request).identity.customers, q, limit, offset)


@router.post("/clientes", response_model=Customer, status_code=201, summary="Dar de alta un comprador")
async def create_customer(request: Request, actor: Admin, body: CustomerInput):
    return await run_db(service(request).identity.save_customer, body, actor=actor)


@router.put("/clientes/{customer_id}", response_model=Customer, summary="Editar, desactivar o restablecer la contraseña de un comprador")
async def update_customer(request: Request, actor: Admin, customer_id: Id, body: CustomerInput):
    ops = service(request)
    units = {channel.vehicle_id for channel in ops.channels.values() if channel.actor.role == "administrador"}
    support_units = set()
    if not body.activo or body.clave:
        for vehicle_id in units:
            unit = await run_db(ops.fleet.unit, vehicle_id)
            if unit["id_cliente"] == customer_id:
                support_units.add(vehicle_id)
    row = await run_db(ops.identity.save_customer, body, customer_id, actor)
    if not body.activo or body.clave:
        await ops.revoke(lambda channel: channel.actor.account_id == customer_id or (
            channel.actor.role == "administrador" and channel.vehicle_id in support_units))
    return row


async def editor_access(request: Request, actor, vehicle_id):
    ops = service(request)
    if actor.role == "usuario":
        await ops.access_unit(actor, vehicle_id)
    else:
        await run_db(ops.fleet.unit, vehicle_id)
    return ops


@router.get("/unidades/{vehicle_id}/editor", response_model=Editor, summary="Consultar comandos y demos de la unidad para edición")
async def demos(request: Request, actor: Account, vehicle_id: Id):
    ops = await editor_access(request, actor, vehicle_id)
    steps = await run_db(ops.runtime.catalog.commands, vehicle_id)
    return {"comandos": [row for row in steps if row["activo"]],
            "demos": ops.fleet.visible_demos(await run_db(ops.fleet.demos, vehicle_id), actor)}


@router.get("/unidades/{vehicle_id}/editor/{demo_id}", response_model=EditableDemo, summary="Consultar los pasos ordenados de una demo visible")
async def read_demo(request: Request, actor: Account, vehicle_id: Id, demo_id: Id):
    ops = await editor_access(request, actor, vehicle_id)
    rows = ops.fleet.visible_demos(await run_db(ops.fleet.demos, vehicle_id), actor)
    demo = next((row for row in rows if row["id_demo"] == demo_id), None)
    if not demo:
        raise ApiError(404, "La demostración no está disponible para esta cuenta.")
    return {**demo, "pasos": await run_db(ops.runtime.catalog.demo_movements, vehicle_id, demo_id)}


@router.post("/unidades/{vehicle_id}/editor", response_model=CommercialDemo, status_code=201, summary="Guardar una demostración y todos sus pasos")
async def create_demo(request: Request, actor: Account, vehicle_id: Id, body: DemoInput):
    ops = await editor_access(request, actor, vehicle_id)
    return await ops.runtime.control.catalog_write(vehicle_id, ops.fleet.save_demo, actor, vehicle_id, None, body)


@router.put("/unidades/{vehicle_id}/editor/{demo_id}", response_model=CommercialDemo, summary="Actualizar o dar de baja una demo de la cuenta")
async def save_demo(request: Request, actor: Account, vehicle_id: Id, demo_id: Id, body: DemoInput):
    ops = await editor_access(request, actor, vehicle_id)
    return await ops.runtime.control.catalog_write(vehicle_id, ops.fleet.save_demo, actor, vehicle_id, demo_id, body)


@router.get("/auditoria", response_model=list[AuditEntry], summary="Consultar la bitácora comercial")
async def audit_log(request: Request, actor: Admin, limit: Limit = 25, offset: Offset = 0):
    return await run_db(service(request).fleet.audit_log, limit, offset)


@router.get("/catalogo", response_model=list[CatalogModel], summary="Consultar el catálogo de modelos y la disponibilidad pública")
async def catalog(limit: Limit = 12, offset: Offset = 0, ops=Depends(active)):
    return ops.filter_availability(await run_db(ops.exhibition.catalog, limit, offset))


@router.post("/exhibicion/{vehicle_id}/sesiones", response_model=GuestSession, status_code=201,
             summary=f"Reservar una unidad de exhibición durante {SESSION_SECONDS} segundos")
async def reserve(request: Request, vehicle_id: Id, ops=Depends(active)):
    ops.limit("reserve", address(request), 12)
    async with ops.gate:
        return await ops.reserve(vehicle_id)


@router.post("/exhibicion/ordenes", summary="Enviar un pulso autorizado durante la reserva de invitado")
async def guest_move(request: Request, body: GuestCommand, actor: Guest, channel: ControlChannel = None):
    ops = service(request)
    commands = await run_db(ops.exhibition.commands, actor.vehicle_id)
    command = next((row for row in commands if row["id_comando"] == body.id_comando), None)
    if not command:
        raise ApiError(403, "Ese comando no está permitido durante la exhibición.")
    await ops.move(actor, actor.vehicle_id, channel, body.id_comando, "API")
    return {"mensaje": "Orden registrada"}


@router.delete("/exhibicion/sesion", status_code=204, summary="Detener y liberar la unidad de exhibición")
async def end_exhibition(request: Request, actor: Guest):
    if not await service(request).finish_reservation(actor.vehicle_id, "cierre_exhibicion"):
        raise ApiError(503, "La detención está pendiente. Se conserva el bloqueo mientras se confirma.")

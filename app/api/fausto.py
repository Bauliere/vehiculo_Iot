from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from pydantic import ValidationError

from app.errors import ApiError
from app.security import require_control
from app.services.fausto_service import FaustoInput, MAX_BODY_BYTES

VehicleId = Annotated[int, Path(ge=1, le=2_147_483_647)]
PlanId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{22}$")]
router = APIRouter(prefix="/vehiculos/{id_vehiculo}/fausto", tags=["Fausto.IA"],
                   dependencies=[Depends(require_control)])


@router.post(
    "/interpretar",
    summary="Interpretar una instrucción de texto o voz",
    openapi_extra={"requestBody": {"required": True, "content": {"application/json": {
        "schema": {"type": "object", "properties": {
            "texto": {"type": "string"},
            "audio": {"type": "string", "description": "Grabación en Base64."},
            "mime": {"type": "string"},
        }},
        "example": {"texto": "Avanza 10 segundos y luego gira a la derecha"},
    }}}},
)
async def interpret(request: Request, id_vehiculo: VehicleId):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BODY_BYTES:
            raise ApiError(413, "La grabación excede el tamaño permitido.")
        data.extend(chunk)
    try:
        source = FaustoInput.model_validate_json(data)
    except ValidationError:
        raise ApiError(422, "Envía una instrucción de hasta 500 caracteres o una grabación válida.") from None
    client = request.client.host if request.client else ""
    return await request.app.state.runtime.fausto.interpret(id_vehiculo, source, client)


@router.post("/{plan_id}/ejecutar", status_code=202, summary="Ejecutar un plan confirmado")
async def execute(request: Request, id_vehiculo: VehicleId, plan_id: PlanId):
    return await request.app.state.runtime.fausto.execute(id_vehiculo, plan_id)


@router.post("/{plan_id}/cancelar", summary="Cancelar el plan y detener el recorrido")
async def cancel(request: Request, id_vehiculo: VehicleId, plan_id: PlanId):
    return await request.app.state.runtime.fausto.cancel(id_vehiculo, plan_id)

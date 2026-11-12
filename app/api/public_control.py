"""Sesiones breves para un control público habilitado explícitamente en AWS.

No es un inicio de sesión: cualquier visitante puede obtener permiso de conducir
el vehículo configurado. Las operaciones administrativas conservan su clave.
"""

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.security import issue_public_control_token

router = APIRouter()


class PublicControlSession(BaseModel):
    token: str
    expires_in: int
    id_vehiculo: int


@router.get(
    "/control/sesion", response_model=PublicControlSession, tags=["Control público"],
    summary="Obtener una sesión breve de control público",
    description=(
        "Requiere PUBLIC_CONTROL_ENABLED en el servidor. Cualquier visitante obtiene "
        "una sesión de 15 minutos para movimientos y DEMO del vehículo configurado. "
        "No concede administración ni revela las claves maestras. CORS no autentica al visitante."
    ),
    responses={403: {"description": "Control público deshabilitado"},
               503: {"description": "Configuración de claves incompleta"}},
)
def public_control_session(request: Request, response: Response):
    session = issue_public_control_token(request.app.state.runtime.settings)
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    return session

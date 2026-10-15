import secrets

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader

key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def same_key(first: str, second: str):
    return secrets.compare_digest(first.encode("utf-8"), second.encode("utf-8"))


def authorize(request: Request, supplied: str | None, admin_only: bool):
    settings = request.app.state.runtime.settings
    admin = settings.api_admin_key.get_secret_value()
    control = settings.api_control_key.get_secret_value()
    if len(admin) < 32 or len(control) < 32 or same_key(admin, control):
        raise HTTPException(503, "Configura dos claves API diferentes de al menos 32 caracteres.")
    if not supplied:
        raise HTTPException(401, "Se requiere X-API-Key.")
    is_admin = same_key(supplied, admin)
    is_control = same_key(supplied, control)
    if not is_admin and not is_control:
        raise HTTPException(401, "Clave API inválida.")
    if admin_only and not is_admin:
        raise HTTPException(403, "Esta operación requiere la clave de administrador.")


def require_admin(request: Request, key: str | None = Depends(key_header)):
    authorize(request, key, True)


def require_control(request: Request, key: str | None = Depends(key_header)):
    authorize(request, key, False)

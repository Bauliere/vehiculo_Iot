import base64
import hashlib
import hmac
import json
import re
import secrets
import time

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader

key_header = APIKeyHeader(
    name="X-API-Key", auto_error=False,
    description="Pega solo el valor de API_ADMIN_KEY del .env de AWS para todas las escrituras. API_CONTROL_KEY permite movimientos y DEMO. No incluyas el nombre, el signo igual ni comillas. La autorización de Postman se configura por separado.",
)

PUBLIC_CONTROL_TTL = 15 * 60
_TOKEN_PREFIX = "v1"
_CONTROL_PATH = re.compile(
    r"^/vehiculos/([1-9][0-9]*)/(?:movimientos|demos/[1-9][0-9]*/(?:iniciar|cancelar)"
    r"|fausto/(?:interpretar|[A-Za-z0-9_-]{22}/(?:ejecutar|cancelar)))$"
)


def same_key(first: str, second: str):
    return secrets.compare_digest(first.encode("utf-8"), second.encode("utf-8"))


def _configured_keys(settings):
    admin = settings.api_admin_key.get_secret_value()
    control = settings.api_control_key.get_secret_value()
    if len(admin) < 32 or len(control) < 32 or same_key(admin, control):
        raise HTTPException(503, "Configura dos claves API diferentes de al menos 32 caracteres.")
    return admin, control


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _signature(message: str, control_key: str) -> str:
    # Separación de propósito: esta firma solo se usa para sesiones de control público.
    material = ("vehiculo-iot:public-control:" + message).encode("ascii")
    return _base64url(hmac.new(control_key.encode("utf-8"), material, hashlib.sha256).digest())


def issue_public_control_token(settings):
    """Acceso público opt-in. No autentica una identidad ni permite administración."""
    if not settings.public_control_enabled:
        raise HTTPException(403, "El control público no está habilitado en este servidor.")
    _, control_key = _configured_keys(settings)
    now = int(time.time())
    claims = {
        "aud": "public-control", "vid": settings.public_control_vehicle_id,
        "iat": now, "exp": now + PUBLIC_CONTROL_TTL,
        "nonce": secrets.token_urlsafe(12),
    }
    payload = _base64url(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    message = _TOKEN_PREFIX + "." + payload
    return {
        "token": message + "." + _signature(message, control_key),
        "expires_in": PUBLIC_CONTROL_TTL,
        "id_vehiculo": settings.public_control_vehicle_id,
    }


def _public_claims(supplied: str, settings, control_key: str):
    if not settings.public_control_enabled or len(supplied) > 1024:
        return None
    parts = supplied.split(".")
    if len(parts) != 3 or parts[0] != _TOKEN_PREFIX:
        return None
    version, payload, signature = parts
    if not re.fullmatch(r"[A-Za-z0-9_-]+", payload) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", signature):
        return None
    expected = _signature(version + "." + payload, control_key)
    if not same_key(signature, expected):
        return None
    try:
        raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        claims = json.loads(raw)
    except (ValueError, UnicodeError):
        return None
    if not isinstance(claims, dict) or claims.get("aud") != "public-control":
        return None
    if any(type(claims.get(name)) is not int for name in ("vid", "iat", "exp")):
        return None
    now = int(time.time())
    if (claims["vid"] != settings.public_control_vehicle_id or claims["exp"] <= now
            or claims["iat"] > now + 15 or claims["exp"] - claims["iat"] != PUBLIC_CONTROL_TTL):
        return None
    if not isinstance(claims.get("nonce"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{16}", claims["nonce"]):
        return None
    return claims


def authorize(request: Request, supplied: str | None, admin_only: bool):
    settings = request.app.state.runtime.settings
    admin, control = _configured_keys(settings)
    if not supplied:
        raise HTTPException(401, "Se requiere X-API-Key.")
    is_admin = same_key(supplied, admin)
    is_control = same_key(supplied, control)
    if is_admin:
        return
    if is_control:
        if admin_only:
            raise HTTPException(403, "Esta operación requiere la clave de administrador.")
        return
    claims = _public_claims(supplied, settings, control)
    if claims is None:
        raise HTTPException(401, "Clave API inválida o sesión de control caducada.")
    if admin_only:
        raise HTTPException(403, "Esta operación requiere la clave de administrador.")
    path = _CONTROL_PATH.fullmatch(request.url.path)
    if request.method != "POST" or path is None or path.group(1) != str(claims["vid"]):
        raise HTTPException(403, "La sesión solo permite movimientos y DEMO del vehículo autorizado.")


def require_admin(request: Request, key: str | None = Depends(key_header)):
    authorize(request, key, True)


def require_control(request: Request, key: str | None = Depends(key_header)):
    authorize(request, key, False)

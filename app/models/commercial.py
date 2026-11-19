from datetime import datetime
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, Field, SecretStr, StringConstraints, field_validator, model_validator

from app.models.api import Command, Demo, DemoMovement, InputModel, Name80, PositiveId, Text50, Text255

Role = Literal["administrador", "usuario", "invitado"]
UnitStatus = Literal["disponible", "vendida", "exhibicion", "inactiva"]
Name120 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254,
                                         pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
GUEST_COMMANDS = frozenset({"AVANZAR", "RETROCEDER", "GIRAR_IZQUIERDA", "GIRAR_DERECHA"})
MAX_DEMO_MS = 60_000
MAX_STEP_MS = 10_000
MAX_STEPS = 24


class Credentials(InputModel):
    correo: Email
    clave: SecretStr = Field(min_length=1, max_length=128)


class CustomerInput(InputModel):
    nombre: Name120
    correo: Email
    activo: bool = True
    clave: SecretStr | None = Field(default=None, min_length=12, max_length=128)


class Customer(BaseModel):
    id_cliente: int
    nombre: str
    correo: str
    activo: bool
    rol: Role


class Capability(InputModel):
    codigo: Annotated[int, Field(strict=True, ge=-2_147_483_648, le=2_147_483_647)]
    nombre: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=60,
                                             pattern=r"^[A-Za-z][A-Za-z0-9_]*$")]
    exhibicion: bool = False

    @model_validator(mode="after")
    def guest_capability(self):
        if self.exhibicion and self.nombre not in GUEST_COMMANDS | {"DETENER"}:
            raise ValueError("Exhibición sólo admite dirección y DETENER.")
        return self


class ModelInput(InputModel):
    nombre: Name120
    descripcion: Description | None = None
    activo: bool = True
    foto_url: AnyHttpUrl | None = None
    capacidades: list[Capability] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def unique_capabilities(self):
        codes = {item.codigo for item in self.capacidades}
        names = {item.nombre for item in self.capacidades}
        if len(codes) != len(self.capacidades) or len(names) != len(self.capacidades):
            raise ValueError("Los nombres y códigos de las capacidades deben ser únicos.")
        if self.capacidades and "DETENER" not in names:
            raise ValueError("Configura DETENER para habilitar movimientos.")
        if self.foto_url and (self.foto_url.scheme != "https" or self.foto_url.username is not None
                              or self.foto_url.password is not None or len(str(self.foto_url)) > 512):
            raise ValueError("Usa una URL pública HTTPS de hasta 512 caracteres para la foto.")
        return self


class UnitInput(InputModel):
    nombre: Name80
    identificador_fisico: Name80
    id_modelo: PositiveId
    estado_comercial: UnitStatus
    descripcion: Text255 | None = None
    microcontrolador: Text50 | None = None


class AssignmentInput(InputModel):
    id_cliente: PositiveId | None


class SupportInput(InputModel):
    autorizado: bool


class DemoStep(InputModel):
    id_comando: PositiveId
    duracion_ms: Annotated[int, Field(strict=True, ge=1, le=MAX_STEP_MS)]
    pausa_ms: Annotated[int, Field(strict=True, ge=0, le=MAX_STEP_MS)] = 0


class DemoInput(InputModel):
    nombre: Name80
    descripcion: Text255 | None = None
    activo: bool = True
    pasos: list[DemoStep] = Field(min_length=1, max_length=MAX_STEPS)

    @field_validator("pasos")
    @classmethod
    def total_duration(cls, value):
        if sum(step.duracion_ms + step.pausa_ms for step in value) > MAX_DEMO_MS:
            raise ValueError("El recorrido completo admite hasta 60 segundos.")
        return value


class GuestCommand(InputModel):
    id_comando: PositiveId


class PlatformConfig(BaseModel):
    activa: bool


class AccountSession(BaseModel):
    token: str
    vence: datetime
    cuenta: Customer


class GuestSession(BaseModel):
    token: str
    id_vehiculo: int
    vence: datetime
    comandos: list["GuestCapability"]


class GuestCapability(BaseModel):
    id_comando: int
    nombre: str
    codigo: int


class DisplayUnit(BaseModel):
    id_vehiculo: int
    nombre: str
    ocupada: bool
    disponible: bool


class CapabilityName(BaseModel):
    nombre: str


class CatalogModel(BaseModel):
    id_modelo: int
    nombre: str
    descripcion: str | None
    foto_url: str | None
    unidades: list[DisplayUnit]
    capacidades: list[CapabilityName]


class ModelSummary(BaseModel):
    id_modelo: int
    nombre: str
    descripcion: str | None
    activo: bool


class ModelRead(ModelSummary):
    foto_url: str | None
    capacidades: list[Capability]


class OwnUnit(BaseModel):
    id_vehiculo: int
    nombre: str
    nombre_modelo: str | None
    soporte_hasta: datetime | None


class UnitRead(OwnUnit):
    id_modelo: int | None
    identificador_fisico: str | None
    estado_comercial: UnitStatus | None
    id_cliente: int | None
    propietario: str | None
    microcontrolador: str | None
    descripcion: str | None
    activo: bool
    dispositivo: bool | None = None


class CommercialDemo(Demo):
    id_cliente_demo: int | None


class EditableDemo(CommercialDemo):
    pasos: list[DemoMovement]


class Editor(BaseModel):
    comandos: list[Command]
    demos: list[CommercialDemo]


class Metrics(BaseModel):
    modelos: int
    unidades: int
    asignadas: int
    clientes: int
    demos: int
    reservas: int
    conectadas: int
    exhibicion_disponible: int


class AuditEntry(BaseModel):
    id_evento: int
    fecha: datetime
    id_actor: int | None
    actor: str | None
    rol: Literal["administrador", "usuario", "invitado", "sistema"]
    accion: str
    recurso: str
    id_recurso: int | None
    resultado: Literal["correcto", "rechazado", "pendiente"]

"""Contratos HTTP: entradas estrictas y respuestas fieles a los SP existentes."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


PositiveId = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
Name80 = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)]
Name60 = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=60)]
Text80 = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, max_length=80)]
Text255 = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, max_length=255)]
Text50 = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, max_length=50)]
StrictFlag = Annotated[bool, Field(strict=True)]
CommandCode = Annotated[int, Field(strict=True, ge=-2_147_483_648, le=2_147_483_647)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VehicleCreate(InputModel):
    nombre: Name80
    modelo: Text80 | None = None
    descripcion: Text255 | None = None
    microcontrolador: Text50 | None = None


class VehicleUpdate(VehicleCreate):
    activo: StrictFlag


class CommandCreate(InputModel):
    nombre: Name60
    codigo: CommandCode = Field(description="Código INT de MySQL; no se limita al catálogo de ejemplo 1…9.")
    descripcion: Text255 | None = None


class CommandUpdate(CommandCreate):
    activo: StrictFlag


class DemoCreate(InputModel):
    nombre: Name80
    descripcion: Text255 | None = None


class DemoUpdate(DemoCreate):
    activo: StrictFlag


class DemoMovementInput(InputModel):
    id_comando: PositiveId
    orden: PositiveId
    duracion_ms: Annotated[int, Field(strict=True, ge=1, le=60_000)]
    pausa_ms: Annotated[int, Field(strict=True, ge=0, le=60_000)] = 0


class MovementInput(InputModel):
    id_comando: PositiveId
    origen: Literal["MANUAL", "POSTMAN", "API"] = "POSTMAN"


class Vehicle(BaseModel):
    id_vehiculo: int
    nombre: str
    modelo: str | None = None
    descripcion: str | None = None
    microcontrolador: str | None = None
    fecha_registro: datetime | None = None
    activo: bool


class Command(BaseModel):
    id_comando: int
    id_vehiculo: int
    nombre: str
    codigo: int
    descripcion: str | None = None
    activo: bool


class VehicleState(BaseModel):
    id_vehiculo: int
    vehiculo: str
    id_comando: int | None = None
    comando: str | None = None
    codigo: int | None = None
    conectado: bool
    fecha_actualizacion: datetime | None = None


class HistoryItem(BaseModel):
    id_historial: int
    id_vehiculo: int
    comando: str | None = None
    codigo: int | None = None
    fecha_hora: datetime | None = None
    origen: str


class Demo(BaseModel):
    id_demo: int
    id_vehiculo: int
    nombre: str
    descripcion: str | None = None
    activo: bool


class DemoMovement(BaseModel):
    id_demo_movimiento: int
    orden: int
    id_comando: int
    comando: str
    codigo: int
    duracion_ms: int
    pausa_ms: int


class VehicleDetail(BaseModel):
    vehiculo: Vehicle
    comandos: list[Command]
    estado: VehicleState | None
    demos: list[Demo]


class DeleteResult(BaseModel):
    mensaje: str
    recurso: Literal["vehiculo", "comando", "demo", "demo_movimiento"]
    id: int


class MovementResult(BaseModel):
    mensaje: str
    id_vehiculo: int
    id_comando: int
    origen: Literal["MANUAL", "POSTMAN", "API"]
    estado: VehicleState


class DemoExecutionResult(BaseModel):
    mensaje: str
    id_vehiculo: int
    id_demo: int
    estado: str


class ErrorResponse(BaseModel):
    detail: str

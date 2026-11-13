import logging
from contextlib import asynccontextmanager

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.routes import router
from app.api.fausto import router as fausto_router
from app.api.public_control import router as public_control_router
from app.async_db import run_db
from app.config import Settings
from app.database import Database
from app.documentation import DESCRIPTION, TAGS, swagger_documentation
from app.errors import ApiError
from app.services.catalog_service import CatalogService
from app.services.control_service import ControlService
from app.services.demo_service import DemoService
from app.services.fausto_service import FaustoService
from app.websocket.websocket_manager import WebSocketManager, event

logger = logging.getLogger(__name__)


class HealthResponse(BaseModel):
    status: str
    database: str
    docs: str | None = None


class Runtime:
    def __init__(self, settings=None, database=None):
        self.settings = settings if settings is not None else Settings()
        self.database = database if database is not None else Database(self.settings)
        self.catalog = CatalogService(self.database)
        self.websocket_manager = WebSocketManager()
        self.control = ControlService(self.database, self.catalog, self.websocket_manager)
        self.demos = DemoService(self.control)
        self.control.demos = self.demos
        self.fausto = FaustoService(self.settings, self.demos)


def create_app(settings=None, database=None):
    runtime = Runtime(settings, database)

    @asynccontextmanager
    async def lifespan(application):
        yield
        try:
            await runtime.demos.shutdown()
        finally:
            await runtime.websocket_manager.shutdown()

    application = FastAPI(
        title="API Vehículo IoT · RDS", version="2.2.0", lifespan=lifespan,
        description=DESCRIPTION, openapi_tags=TAGS, docs_url=None,
    )
    application.state.runtime = runtime
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "https://bauliere.github.io",
            "http://127.0.0.1:5500",
            "http://localhost:5500",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key"],
    )
    application.include_router(router)
    application.include_router(public_control_router)
    application.include_router(fausto_router)

    @application.get("/docs", include_in_schema=False, response_class=HTMLResponse)
    def documentation(request: Request):
        root_path = request.scope.get("root_path", "").rstrip("/")
        return swagger_documentation(application.openapi(), root_path + application.openapi_url, root_path)

    @application.exception_handler(ApiError)
    async def api_error_handler(request, error):
        return JSONResponse(status_code=error.status_code, content={"detail": error.detail})

    @application.exception_handler(Exception)
    async def unexpected_error_handler(request, error):
        logger.error("Solicitud fallida (%s).", type(error).__name__)
        return JSONResponse(status_code=500, content={"detail": "Error interno del servidor."})

    @application.get("/health", tags=["Diagnóstico"], summary="Comprobar servidor",
                     response_model=HealthResponse)
    def health():
        return {"status": "ok", "database": "no comprobada", "docs": "/docs"}

    @application.get("/health/rds", tags=["Diagnóstico"], summary="Comprobar lectura de RDS",
                     response_model=HealthResponse,
                     description="Consulta sp_obtener_vehiculos sin modificar datos.",
                     responses={503: {"description": "Configuración o RDS no disponibles"}})
    async def rds_health():
        await run_db(runtime.catalog.vehicles)
        return {"status": "ok", "database": "RDS"}

    @application.websocket("/ws/vehiculos/{id_vehiculo}")
    async def websocket_endpoint(websocket: WebSocket, id_vehiculo: int):
        connected = False
        try:
            if id_vehiculo <= 0:
                await websocket.close(code=1008)
                return
            async with runtime.control.lock_for(id_vehiculo):
                state = await run_db(runtime.catalog.state, id_vehiculo)
                await runtime.websocket_manager.conectar(id_vehiculo, websocket)
                connected = True
                await runtime.websocket_manager.enviar(id_vehiculo, websocket, event(
                    "estado_inicial", id_vehiculo,
                    state.get("comando") if state else None,
                    state.get("codigo") if state else None, estado=state,
                ))
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        except ApiError as error:
            await websocket.close(code=1008 if error.status_code == 404 else 1011)
        except Exception:
            try:
                await websocket.close(code=1011)
            except Exception:
                pass
        finally:
            if connected:
                runtime.websocket_manager.desconectar(id_vehiculo, websocket)

    return application


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, workers=1)


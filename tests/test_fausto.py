import asyncio
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app
from app.services.demo_service import DemoService
from app.services.fausto_service import FaustoInput, FaustoStep, FaustoService, Interpretation


class FaustoContractTests(TestCase):
    def test_rejects_wrong_types_and_nonfinal_stop(self):
        with self.assertRaises(ValidationError):
            FaustoStep(comando="AVANZAR", duracion_ms=True)
        with self.assertRaises(ValidationError):
            FaustoStep(comando="AVANZAR", duracion_ms=10001)
        with self.assertRaises(ValidationError):
            Interpretation(respuesta="Plan", transcripcion="", pasos=[
                {"comando": "DETENER", "duracion_ms": 0}, {"comando": "AVANZAR", "duracion_ms": 500},
            ])
        with self.assertRaises(ValidationError):
            FaustoInput(audio="!!!", mime="audio/webm")

    def test_interpretation_requires_session_and_does_not_execute(self):
        settings = Settings(_env_file=None, public_control_enabled=True,
                            api_admin_key="a" * 40, api_control_key="c" * 40, gemini_api_key="mock")
        app = create_app(settings)
        service = app.state.runtime.fausto
        service.gemini.interpret = lambda source: Interpretation(
            respuesta="Avanzar y girar.", transcripcion="", pasos=[
                {"comando": "AVANZAR", "duracion_ms": 10000},
                {"comando": "GIRAR_DERECHA", "duracion_ms": 500},
            ],
        )
        with TestClient(app) as client:
            body = {"texto": "Avanza 10 segundos y luego gira a la derecha"}
            path = "/vehiculos/1/fausto/interpretar"
            self.assertEqual(client.post(path, json=body).status_code, 401)
            token = client.get("/control/sesion").json()["token"]
            headers = {"X-API-Key": token}
            self.assertEqual(client.post(path.replace("/1/", "/2/"), headers=headers, json=body).status_code, 403)
            result = client.post(path, headers=headers, json=body)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["pasos"][0]["duracion_ms"], 10000)
            self.assertEqual(len(result.json()["plan_id"]), 22)
            self.assertEqual(service.demos.runs, {})
            for _ in range(4):
                self.assertEqual(client.post(path, headers=headers, json=body).status_code, 200)
            self.assertEqual(client.post(path, headers=headers, json=body).status_code, 429)


class FaustoRunTests(IsolatedAsyncioTestCase):
    async def test_timed_steps_use_existing_protocol_and_can_be_cancelled(self):
        lock = asyncio.Lock()
        manager = SimpleNamespace(publicar=AsyncMock())
        control = SimpleNamespace(
            lock_for=lambda vehicle_id: lock, ensure_idle=lambda vehicle_id: None,
            websocket_manager=manager,
            demo_step=lambda vehicle_id, command_id: {"codigo": command_id},
            finalize_demo=lambda vehicle_id: {"comando": "DETENER", "codigo": 9},
        )
        service = FaustoService(Settings(_env_file=None, gemini_api_key="mock"), DemoService(control))
        steps = [FaustoStep(comando="AVANZAR", duracion_ms=10000), FaustoStep(comando="GIRAR_DERECHA", duracion_ms=500)]
        service.gemini.interpret = lambda source: Interpretation(respuesta="Plan", transcripcion="", pasos=steps)
        service.prepare = lambda steps, vehicle_id, demo_id: [
            {"id_demo_movimiento": index, "id_comando": index, "orden": index,
             "comando": step.comando, "codigo": index, "duracion_ms": step.duracion_ms, "pausa_ms": 0}
            for index, step in enumerate(steps, 1)
        ]
        plan = await service.interpret(1, FaustoInput(texto="Avanza diez segundos"), "local")
        await service.execute(1, plan["plan_id"])
        async def wait_for_step():
            while len(manager.publicar.await_args_list) < 2:
                await asyncio.sleep(.01)
        await asyncio.wait_for(wait_for_step(), 2)
        await service.cancel(1, plan["plan_id"])
        events = [call.args[1] for call in manager.publicar.await_args_list]
        self.assertEqual([e["tipo"] for e in events], ["demo_inicio", "demo_movimiento", "demo_cancelada"])
        self.assertEqual(events[1]["duracion_ms"], 10000)
        self.assertEqual(events[1]["fausto_id"], plan["plan_id"])
        self.assertEqual(events[2]["codigo"], 9)

import asyncio
from contextlib import nullcontext
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, Mock, call

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.errors import ApiError
from app.main import create_app
from app.services.catalog_service import CatalogService
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

    def test_catalog_plan_requires_admin_confirmation_and_is_applied_once(self):
        admin_key, control_key = "a" * 40, "c" * 40
        app = create_app(Settings(_env_file=None, public_control_enabled=True,
                                  api_admin_key=admin_key, api_control_key=control_key, gemini_api_key="mock"))
        runtime = app.state.runtime
        command = {"id_comando": 47, "nombre": "REVISIÓN", "codigo": 21, "activo": 1}
        runtime.catalog.commands = Mock(return_value=[command])
        runtime.catalog.modify = Mock(return_value={"id": 47, "recurso": "comando"})
        runtime.fausto.gemini.interpret = lambda source: Interpretation(
            respuesta="Eliminar el comando revisión.", transcripcion="", pasos=[],
            cambio_catalogo={"accion": "eliminar_comando", "nombre": "revision"},
        )
        with TestClient(app) as client:
            headers = {"X-API-Key": client.get("/control/sesion").json()["token"]}
            path = "/vehiculos/1/fausto"
            result = client.post(f"{path}/interpretar", headers=headers, json={"texto": "Elimina revisión"})
            self.assertEqual(result.status_code, 200)
            proposed = result.json()
            change = proposed["cambio_catalogo"]
            self.assertEqual(change["id"], 47)
            self.assertEqual(change["nombre"], "REVISIÓN")
            plan_path = f"{path}/{proposed['plan_id']}"
            self.assertEqual(client.post(f"{plan_path}/ejecutar", headers=headers).status_code, 409)
            self.assertEqual(client.post(f"{plan_path}/confirmar", headers=headers).status_code, 403)
            self.assertEqual(client.post(f"{plan_path}/confirmar", headers={"X-API-Key": control_key}).status_code, 403)
            runtime.catalog.modify.assert_not_called()
            admin = {"X-API-Key": admin_key}
            self.assertEqual(client.post(f"{plan_path.replace('/1/', '/2/')}/confirmar", headers=admin).status_code, 404)
            result = client.post(f"{plan_path}/confirmar", headers=admin)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["estado"], "confirmado")
            self.assertEqual(client.post(f"{plan_path}/confirmar", headers=admin).json(), result.json())
            runtime.catalog.modify.assert_called_once_with("delete_command", 1, 47, change)

    def test_demo_steps_share_the_transaction_and_revalidate_command_codes(self):
        saved = {"id_demo": 25, "nombre": "Recorrido corto", "activo": 1}
        commands = [
            {"id_comando": 32, "nombre": "AVANZAR", "codigo": 1, "activo": 1},
            {"id_comando": 33, "nombre": "DETENER", "codigo": 9, "activo": 1},
        ]
        rows = {
            "sp_obtener_vehiculo": [{"id_vehiculo": 1}],
            "sp_obtener_comandos_vehiculo": commands,
            "sp_crear_demo": [{"id_demo": 25}],
            "sp_agregar_movimiento_demo": [],
            "sp_obtener_demos": [saved],
        }
        procedures = Mock()
        procedures.call.side_effect = lambda name, args: rows[name]
        database = Mock()
        database.session.return_value = nullcontext(procedures)
        catalog = CatalogService(database)
        payload = {"nombre": "Recorrido corto", "pasos": [
            {"id_comando": 32, "comando": "AVANZAR", "codigo": 1,
             "orden": 1, "duracion_ms": 500, "pausa_ms": 120},
        ]}
        self.assertEqual(catalog.modify("create_demo", 1, payload=payload), saved)
        database.session.assert_called_once_with(write=True)
        procedures.call.assert_has_calls([
            call("sp_crear_demo", (1, "Recorrido corto", None)),
            call("sp_agregar_movimiento_demo", (25, 32, 1, 500, 120)),
        ])
        procedures.call.reset_mock()
        commands[0]["codigo"] = 4
        with self.assertRaises(ApiError):
            catalog.modify("create_demo", 1, payload=payload)
        self.assertEqual(procedures.call.call_args_list, [
            call("sp_obtener_vehiculo", (1,)), call("sp_obtener_comandos_vehiculo", (1,)),
        ])


class FaustoRunTests(IsolatedAsyncioTestCase):
    async def test_enabling_and_disabling_prepare_absolute_orders_without_a_state_read(self):
        service = FaustoService(Settings(_env_file=None, gemini_api_key="mock"), Mock())
        service.gemini.interpret = Mock()
        for text, command, auxiliary in (
            ("Enciende las luces", "ALTERNAR_LUCES", "encender"),
            ("¡Oye, Fausto, apágalas!", "ALTERNAR_LUCES", "apagar"),
            ("Prende el sonido", "ALTERNAR_SONIDO", "encender"),
            ("Apaga el sonido, por favor.", "ALTERNAR_SONIDO", "apagar"),
        ):
            with self.subTest(text=text):
                result = await service.interpret(1, FaustoInput(texto=text), "local")
                self.assertEqual(result["pasos"], [{"comando": command, "duracion_ms": 0, "auxiliar": auxiliary}])
                self.assertIn(result["plan_id"], service.plans)
                self.assertIn(auxiliary, result["respuesta"])
        service.gemini.interpret.assert_not_called()
        self.assertEqual(service.demos.mock_calls, [])

    async def test_audio_auxiliary_order_is_recovered_from_the_transcription(self):
        service = FaustoService(Settings(_env_file=None, gemini_api_key="mock"), Mock())
        service.gemini.interpret = Mock(return_value=Interpretation(
            respuesta="No sé el estado.", transcripcion="Apaga el sonido.", pasos=[],
        ))
        result = await service.interpret(1, FaustoInput(audio="YQ==", mime="audio/wav"), "local")
        self.assertEqual(result["transcripcion"], "Apaga el sonido.")
        self.assertEqual(result["pasos"], [{"comando": "ALTERNAR_SONIDO", "duracion_ms": 0, "auxiliar": "apagar"}])
        self.assertIn(result["plan_id"], service.plans)

    async def test_pancho_joke_never_prepares_a_plan(self):
        service = FaustoService(Settings(_env_file=None, gemini_api_key="mock"), Mock())
        service.gemini.interpret = Mock(return_value=Interpretation(
            respuesta="Mueve.", transcripcion="Derrota al jefe final Pancho.",
            pasos=[FaustoStep(comando="AVANZAR", duracion_ms=500)],
        ))
        for source in (FaustoInput(texto="¡Mata al Pancho!"), FaustoInput(audio="YQ==", mime="audio/wav")):
            result = await service.interpret(1, source, "local")
            self.assertEqual(result["respuesta"], "al toque mi rey")
            self.assertEqual(result["pasos"], [])
            self.assertIsNone(result["plan_id"])
        self.assertEqual(service.plans, {})
        self.assertEqual(service.demos.mock_calls, [])

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

from contextlib import nullcontext
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, Mock

import asyncio
from pydantic import ValidationError

from app.config import Settings
from app.services.demo_service import DemoService
from app.services.fausto_service import FaustoInput, FaustoService, FaustoStep, fixed_interpretation


class AuxiliaryInterpretationTests(TestCase):
    def test_direct_timed_orders_keep_a_separate_auxiliary_duration(self):
        for text, duration in (("Enciende las luces por 2,5 segundos", 2500),
                               ("Oye, Fausto, préndelas durante medio segundo por favor", 500),
                               ("Activa las luces por 250 milisegundos", 250)):
            with self.subTest(text=text):
                result = fixed_interpretation(text)
                self.assertEqual(result.pasos, [FaustoStep(comando="ALTERNAR_LUCES", auxiliar="encender",
                                                           duracion_ms=duration)])

    def test_rejects_invalid_modes_and_times(self):
        result = fixed_interpretation("Enciende el sonido por 11 segundos")
        self.assertEqual(result.pasos, [])
        for command, mode, duration in (("AVANZAR", "encender", 0), ("ALTERNAR_LUCES", "apagar", 50),
                                        ("ALTERNAR_SONIDO", "encender", True)):
            with self.subTest(mode=mode, duration=duration), self.assertRaises(ValidationError):
                FaustoStep(comando=command, auxiliar=mode, duracion_ms=duration)


class AuxiliaryWssTests(IsolatedAsyncioTestCase):
    async def test_persistent_order_uses_legacy_duration_and_auxiliary_mode_in_wss(self):
        lock = asyncio.Lock()
        manager = SimpleNamespace(publicar=AsyncMock())
        session = Mock()
        session.call.return_value = [{"id_comando": 7, "nombre": "ALTERNAR_LUCES", "codigo": 7, "activo": 1}]
        control = SimpleNamespace(
            lock_for=lambda vehicle_id: lock, ensure_idle=lambda vehicle_id: None,
            websocket_manager=manager, database=SimpleNamespace(session=lambda: nullcontext(session)),
            require_vehicle=Mock(), require_stop=Mock(return_value={"codigo": 9}),
            demo_step=lambda vehicle_id, command_id: {"codigo": command_id},
            finalize_demo=lambda vehicle_id: {"comando": "DETENER", "codigo": 9},
        )
        demos = DemoService(control)
        service = FaustoService(Settings(_env_file=None, gemini_api_key="mock"), demos)
        plan = await service.interpret(1, FaustoInput(texto="Enciende las luces"), "local")
        await service.execute(1, plan["plan_id"])
        await asyncio.wait_for(demos.runs[1].done.wait(), 2)
        events = [call.args[1] for call in manager.publicar.await_args_list]
        self.assertEqual([event["tipo"] for event in events], ["demo_inicio", "demo_movimiento", "demo_fin"])
        self.assertEqual(events[1]["codigo"], 7)
        self.assertEqual(events[1]["auxiliar"], "encender")
        self.assertEqual(events[1]["duracion_auxiliar_ms"], 0)
        self.assertEqual(events[1]["duracion_ms"], 500)

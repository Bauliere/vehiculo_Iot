import base64
import io
import json
import unittest
import wave
from unittest.mock import patch
from urllib.error import HTTPError

from app.config import Settings
from app.errors import ApiError
from app.services.fausto_service import FaustoInput, GeminiInterpreter


def audio_source():
    recording = io.BytesIO()
    with wave.open(recording, "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(b"\xf4\x01\x0c\xfe" * 2000)
    return FaustoInput(audio=base64.b64encode(recording.getvalue()).decode(), mime="audio/wav")


def provider_answer(*, transcript):
    plan = {"respuesta": "Voy a avanzar.", "transcripcion": transcript,
            "pasos": [{"comando": "AVANZAR", "duracion_ms": 500}], "cambio_catalogo": None}
    return io.StringIO(json.dumps({"candidates": [{"finishReason": "STOP",
                                                  "content": {"parts": [{"text": json.dumps(plan)}]}}]}))


class FaustoVoiceTests(unittest.TestCase):
    def setUp(self):
        self.interpreter = GeminiInterpreter(Settings(_env_file=None, gemini_api_key="solo-pruebas"))

    def test_wav_is_sent_inline_with_voice_timeout_and_transcript(self):
        source = audio_source()
        with patch("app.services.fausto_service.urlopen", return_value=provider_answer(transcript="Avanza")) as mock:
            result = self.interpreter.interpret(source)
        args, kwargs = mock.call_args
        body = json.loads(args[0].data)
        self.assertEqual(body["contents"][0]["parts"][1]["inlineData"], {
            "mimeType": "audio/wav", "data": source.audio,
        })
        self.assertEqual(kwargs["timeout"], 24)
        self.assertEqual(result.transcripcion, "Avanza")
        self.assertEqual(result.pasos[0].comando, "AVANZAR")

    def test_audio_without_transcription_cannot_generate_a_plan(self):
        with patch("app.services.fausto_service.urlopen", return_value=provider_answer(transcript="")):
            result = self.interpreter.interpret(audio_source())
        self.assertEqual(result.pasos, [])
        self.assertIsNone(result.cambio_catalogo)

    def test_audio_rejection_and_timeout_are_distinct(self):
        failure = HTTPError("https://example.test", 415, "unsupported", {}, None)
        with patch("app.services.fausto_service.urlopen", side_effect=failure):
            with self.assertRaisesRegex(ApiError, "rechazó la grabación") as rejected:
                self.interpreter.interpret(audio_source())
        self.assertEqual(rejected.exception.status_code, 502)
        with patch("app.services.fausto_service.urlopen", side_effect=TimeoutError):
            with self.assertRaisesRegex(ApiError, "tardó demasiado") as timeout:
                self.interpreter.interpret(audio_source())
        self.assertEqual(timeout.exception.status_code, 504)

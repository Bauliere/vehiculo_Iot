"""Autorización de sesiones públicas sin MySQL, red externa ni hardware."""

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.public_control import router
from app.config import Settings
from app.security import PUBLIC_CONTROL_TTL, require_admin, require_control

CONTROL_KEY = "public-test-control-" + "c" * 40
ADMIN_KEY = "public-test-admin-" + "a" * 40


def settings(**overrides):
    values = dict(api_control_key=CONTROL_KEY, api_admin_key=ADMIN_KEY,
                  public_control_enabled=True, public_control_vehicle_id=1)
    values.update(overrides)
    return Settings(_env_file=None, **values)


def client(configuration):
    app = FastAPI()
    app.state.runtime = SimpleNamespace(settings=configuration)
    app.include_router(router)

    @app.post("/vehiculos/{vid}/movimientos", dependencies=[Depends(require_control)])
    @app.post("/vehiculos/{vid}/demos/{did}/iniciar", dependencies=[Depends(require_control)])
    @app.post("/vehiculos/{vid}/demos/{did}/cancelar", dependencies=[Depends(require_control)])
    def control():
        return {"accepted": True}

    @app.post("/vehiculos/{vid}/comandos", dependencies=[Depends(require_admin)])
    def admin():
        return {"accepted": True}

    @app.get("/vehiculos/{vid}/movimientos", dependencies=[Depends(require_control)])
    @app.post("/otro-control", dependencies=[Depends(require_control)])
    def unrelated():
        return {"accepted": True}

    return TestClient(app)


class PublicControlTests(TestCase):
    def issue(self, session):
        response = session.get("/control/sesion")
        self.assertEqual(response.status_code, 200)
        return response.json()["token"]

    def test_public_control_is_disabled_by_default(self):
        configuration = Settings(_env_file=None, api_control_key=CONTROL_KEY,
                                 api_admin_key=ADMIN_KEY)
        self.assertFalse(configuration.public_control_enabled)
        with client(configuration) as session:
            self.assertEqual(session.get("/control/sesion").status_code, 403)

    def test_issue_returns_no_master_key_and_must_not_be_cached(self):
        with client(settings()) as session:
            response = session.get("/control/sesion")
            payload = response.json()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(payload["expires_in"], 900)
            self.assertEqual(payload["id_vehiculo"], 1)
            self.assertNotIn(CONTROL_KEY, response.text)
            self.assertNotIn(ADMIN_KEY, response.text)
            self.assertIn("no-store", response.headers["cache-control"])
            self.assertEqual(response.headers["pragma"], "no-cache")
            self.assertNotEqual(payload["token"], self.issue(session))

    def test_session_allows_only_its_vehicle_control_operations(self):
        with client(settings()) as session:
            headers = {"X-API-Key": self.issue(session)}
            for path in ("/vehiculos/1/movimientos", "/vehiculos/1/demos/4/iniciar",
                         "/vehiculos/1/demos/4/cancelar"):
                self.assertEqual(session.post(path, headers=headers).status_code, 200)
            self.assertEqual(session.post("/vehiculos/2/movimientos", headers=headers).status_code, 403)
            self.assertEqual(session.post("/otro-control", headers=headers).status_code, 403)
            self.assertEqual(session.get("/vehiculos/1/movimientos", headers=headers).status_code, 403)

    def test_session_cannot_administrate_but_admin_key_still_can(self):
        with client(settings()) as session:
            headers = {"X-API-Key": self.issue(session)}
            self.assertEqual(session.post("/vehiculos/1/comandos", headers=headers).status_code, 403)
            self.assertEqual(session.post("/vehiculos/1/comandos", headers={"X-API-Key": ADMIN_KEY}).status_code, 200)
            self.assertEqual(session.post("/vehiculos/1/comandos", headers={"X-API-Key": CONTROL_KEY}).status_code, 403)

    def test_expired_session_is_rejected_and_new_session_works(self):
        with client(settings()) as session:
            with patch("app.security.time.time", return_value=1000):
                token = self.issue(session)
            with patch("app.security.time.time", return_value=1000 + PUBLIC_CONTROL_TTL - 1):
                self.assertEqual(session.post("/vehiculos/1/movimientos", headers={"X-API-Key": token}).status_code, 200)
            with patch("app.security.time.time", return_value=1000 + PUBLIC_CONTROL_TTL):
                self.assertEqual(session.post("/vehiculos/1/movimientos", headers={"X-API-Key": token}).status_code, 401)
                renewed = self.issue(session)
                self.assertEqual(session.post("/vehiculos/1/movimientos", headers={"X-API-Key": renewed}).status_code, 200)

    def test_tampered_and_malformed_tokens_are_rejected(self):
        with client(settings()) as session:
            token = self.issue(session)
            parts = token.split(".")
            modified = parts.copy()
            modified[1] = ("A" if parts[1][0] != "A" else "B") + parts[1][1:]
            bad = [".".join(modified), token + "a", "v1.###.bad", "v2." + token[3:],
                   "v1." + "A" * 1200 + "." + "a" * 43]
            for supplied in bad:
                self.assertEqual(session.post("/vehiculos/1/movimientos", headers={"X-API-Key": supplied}).status_code, 401)

    def test_disabling_public_access_invalidates_already_issued_sessions(self):
        configuration = settings()
        with client(configuration) as session:
            token = self.issue(session)
            configuration.public_control_enabled = False
            self.assertEqual(session.get("/control/sesion").status_code, 403)
            self.assertEqual(session.post("/vehiculos/1/movimientos", headers={"X-API-Key": token}).status_code, 401)
            self.assertEqual(session.post("/vehiculos/1/movimientos", headers={"X-API-Key": CONTROL_KEY}).status_code, 200)

    def test_signing_key_rotation_invalidates_sessions(self):
        with client(settings()) as original:
            token = self.issue(original)
        with client(settings(api_control_key="replacement-control-" + "z" * 40)) as replacement:
            self.assertEqual(replacement.post("/vehiculos/1/movimientos", headers={"X-API-Key": token}).status_code, 401)

    def test_vehicle_configuration_is_bound_to_issued_sessions(self):
        with client(settings(public_control_vehicle_id=3)) as session:
            token = self.issue(session)
            self.assertEqual(session.post("/vehiculos/3/movimientos", headers={"X-API-Key": token}).status_code, 200)
            self.assertEqual(session.post("/vehiculos/1/movimientos", headers={"X-API-Key": token}).status_code, 403)

    def test_invalid_master_key_configuration_fails_closed(self):
        for configuration in (settings(api_control_key="short"), settings(api_control_key=ADMIN_KEY)):
            with client(configuration) as session:
                self.assertEqual(session.get("/control/sesion").status_code, 503)

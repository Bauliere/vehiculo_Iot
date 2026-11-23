"""Pruebas sobre una copia MySQL local con el DDL real y migraciones 001/002."""

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from secrets import token_hex

import pymysql
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.database import Database, DictCursor
from app.main import create_app
from app.models.commercial import CustomerInput
from app.services.commercial_store import first, query, token_bytes, utcnow

MYSQL_PORT = os.getenv("IOT43_TEST_MYSQL_PORT")
PASSWORD = "prueba-local-unica-4.3"
ORIGIN = {"Origin": "http://127.0.0.1:5500"}


class LocalDatabase(Database):
    def _connect(self):
        return pymysql.connect(host="127.0.0.1", port=int(MYSQL_PORT), user="root", database="iot43_stage",
                               charset="utf8mb4", autocommit=False, cursorclass=DictCursor, binary_prefix=True,
                               connect_timeout=3, read_timeout=4, write_timeout=4,
                               init_command="SET time_zone = '+00:00'")


@unittest.skipUnless(MYSQL_PORT, "requiere copia MySQL de pruebas con 001 y 002 aplicadas")
class CommercialIntegration(unittest.TestCase):
    def setUp(self):
        self.suffix = token_hex(5)
        settings = Settings(_env_file=None, commercial_enabled=True, exhibition_enabled=True, public_control_enabled=True)
        self.database = LocalDatabase(settings)
        self.app = create_app(settings, self.database)
        self.ops = self.app.state.runtime.commercial
        self.email = f"admin-{self.suffix}@ejemplo.test"
        self.ops.identity.save_customer(CustomerInput(nombre="Administración", correo=self.email, clave=PASSWORD), role="administrador")
        self.client = self.enterContext(TestClient(self.app))

    def request(self, method, path, status, *, headers=None, body=None):
        response = self.client.request(method, path, headers=headers, **({"json": body} if body is not None else {}))
        self.assertEqual(response.status_code, status, f"{method} {path} {response.text[:400]}")
        return response.json() if response.content else None

    def login(self, email):
        session = self.request("POST", "/plataforma/sesion", 201, body={"correo": email, "clave": PASSWORD})
        return {"Authorization": "Bearer " + session["token"]}

    def ws(self, vid, headers):
        return self.client.websocket_connect(f"/ws/vehiculos/{vid}", headers=ORIGIN.copy(),
                                             subprotocols=["iot.v1", "auth." + headers["Authorization"][7:]])

    def model(self, admin):
        return self.request("POST", "/plataforma/modelos", 201, headers=admin, body={
            "nombre": f"Máquina de carga {self.suffix}", "capacidades": [
                {"nombre": "AVANZAR", "codigo": 1, "exhibicion": True},
                {"nombre": "ALTERNAR_LUCES", "codigo": 7}, {"nombre": "DETENER", "codigo": 9},
            ],
        })["id_modelo"]

    def unit(self, admin, model, name, status):
        sample = {"nombre": name, "identificador_fisico": f"{name}-{self.suffix}", "id_modelo": model,
                  "estado_comercial": status}
        unit = self.request("POST", "/plataforma/unidades", 201, headers=admin, body=sample)
        self.request("POST", "/plataforma/unidades", 409, headers=admin, body=sample)
        return unit["id_vehiculo"]

    def buyer(self, admin, initial):
        mail = f"{initial.split()[0].lower()}-{self.suffix}@ejemplo.test"
        buyer = self.request("POST", "/plataforma/clientes", 201, headers=admin,
                             body={"nombre": initial, "correo": mail, "clave": PASSWORD})
        self.assertNotIn("clave", buyer)
        return buyer["id_cliente"], self.login(mail)

    def test_roles_assignment_private_demos_and_existing_monitor_contract(self):
        self.request("GET", "/plataforma/dashboard", 401)
        self.request("GET", "/control/sesion", 403)
        admin = self.login(self.email)
        model = self.model(admin)
        vid = self.unit(admin, model, "Unidad de venta", "disponible")
        path = f"/vehiculos/{vid}"
        commercial = f"/plataforma/unidades/{vid}"
        first_id, buyer = self.buyer(admin, "Alejandra García de la Vega")
        second_id, other = self.buyer(admin, "Jo")
        self.request("PUT", commercial + "/asignacion", 200, headers=admin, body={"id_cliente": first_id})
        self.request("POST", path + "/eliminar", 403, headers=admin)
        self.request("GET", path, 401)
        self.request("GET", path, 403, headers=admin)
        self.request("GET", path, 403, headers=other)
        self.request("GET", "/plataforma/dashboard", 403, headers=buyer)
        self.assertEqual([row["id_vehiculo"] for row in self.request("GET", "/plataforma/mis-unidades", 200, headers=buyer)], [vid])
        for denied, origin in [(other, ORIGIN), (admin, ORIGIN), (buyer, {"Origin": "https://otro.example"})]:
            with self.assertRaises(WebSocketDisconnect):
                with self.client.websocket_connect(f"/ws/vehiculos/{vid}", headers=origin.copy(),
                                                   subprotocols=["iot.v1", "auth." + denied["Authorization"][7:]]):
                    self.fail("Canal de unidad ajena o con origen inválido")

        self.request("PUT", commercial + "/soporte", 200, headers=buyer, body={"autorizado": True})
        with self.ws(vid, admin) as support:
            self.assertEqual(support.receive_json()["tipo"], "estado_inicial")
            support.receive_json()
            self.request("PUT", commercial + "/soporte", 200, headers=buyer, body={"autorizado": False})
            self.assertEqual(support.receive()["code"], 1008)
        self.request("GET", path + "/estado", 403, headers=admin)

        commands = self.request("GET", path + "/comandos", 200, headers=buyer)
        advance = next(row["id_comando"] for row in commands if row["nombre"] == "AVANZAR")
        stop = next(row["id_comando"] for row in commands if row["nombre"] == "DETENER")
        demo_body = {"nombre": "Recorrido privado", "pasos": [
            {"id_comando": advance, "duracion_ms": 5000}, {"id_comando": stop, "duracion_ms": 100},
        ]}
        demo = self.request("POST", commercial + "/editor", 201, headers=buyer, body=demo_body)["id_demo"]
        factory = self.request("POST", commercial + "/editor", 201, headers=admin, body={**demo_body, "nombre": "De fábrica"})["id_demo"]
        self.request("PUT", f"{commercial}/editor/{demo}", 404, headers=admin, body=demo_body)
        updated = {**demo_body, "pasos": list(reversed(demo_body["pasos"]))}
        self.request("PUT", f"{commercial}/editor/{demo}", 200, headers=buyer, body=updated)
        steps = self.request("GET", f"{path}/demos/{demo}/movimientos", 200, headers=buyer)
        self.assertEqual([step["id_comando"] for step in steps], [stop, advance])
        self.request("POST", commercial + "/editor", 422, headers=buyer,
                     body={**demo_body, "pasos": [{"id_comando": 2147483647, "duracion_ms": 50}]})

        device = {"X-Device-Key": self.ops.identity.set_device(vid)}
        movement = {"id_comando": advance, "origen": "API"}
        with self.client.websocket_connect(f"/ws/vehiculos/{vid}", headers=device) as device_ws:
            self.assertEqual(device_ws.receive_json()["tipo"], "estado_inicial")
            with self.ws(vid, buyer) as pilot, self.ws(vid, buyer) as observer:
                pilot.receive_json()
                initial = pilot.receive_json()
                self.assertTrue(initial["dispositivo"])
                controller = {**buyer, "X-IoT-Channel": initial["canal"]}
                observer.receive_json()
                observer_headers = {**buyer, "X-IoT-Channel": observer.receive_json()["canal"]}
                self.request("POST", path + "/movimientos", 409, headers=buyer, body=movement)
                self.request("POST", path + "/movimientos", 200, headers=controller, body=movement)
                self.assertEqual(device_ws.receive_json()["tipo"], "movimiento_individual")
                self.assertEqual(pilot.receive_json()["id_comando"], advance)
                self.request("POST", path + "/movimientos", 409, headers=observer_headers, body=movement)
                for _ in range(11):
                    self.request("POST", path + "/movimientos", 200, headers=controller, body={**movement, "id_comando": stop})
                history = self.request("GET", path + "/historial", 200, headers=buyer)
                self.assertEqual(len(history), 10)
                self.request("POST", f"{path}/demos/{demo}/iniciar", 202, headers=controller)
                self.request("POST", f"{path}/demos/{demo}/cancelar", 200, headers=controller)
                self.assertEqual(self.request("GET", path + "/historial", 200, headers=buyer), history)
                self.assertEqual(self.request("GET", path + "/estado", 200, headers=buyer)["comando"], "DETENER")
                self.request("PUT", commercial + "/asignacion", 200, headers=admin, body={"id_cliente": second_id})
                while (message := pilot.receive())["type"] == "websocket.send":
                    pass
                self.assertEqual(message["code"], 1008)
            with self.ws(vid, other) as replacement:
                self.assertEqual(replacement.receive_json()["tipo"], "estado_inicial")
        self.request("GET", path + "/historial", 403, headers=buyer)
        self.request("GET", f"{path}/demos/{demo}", 404, headers=other)
        self.request("GET", f"{path}/demos/{factory}", 200, headers=other)
        self.request("DELETE", "/plataforma/sesion", 204, headers=other)
        self.request("GET", path, 401, headers=other)
        log = self.request("GET", "/plataforma/auditoria?limit=100", 200, headers=admin)
        self.assertEqual(sum(row["accion"] == "asignar" and row["id_recurso"] == vid for row in log), 2)
        with self.database.session(write=True) as db:
            query(db, "UPDATE sesiones_cuenta_iot SET vence=UTC_TIMESTAMP(6) WHERE huella=%s",
                  (token_bytes(admin["Authorization"][7:], "c_"),))
        self.request("GET", "/plataforma/dashboard", 401, headers=admin)

    def test_guest_exclusivity_restrictions_expiration_and_safe_disconnect(self):
        admin = self.login(self.email)
        model = self.model(admin)
        unit = self.unit(admin, model, "Exhibición", "exhibicion")
        device = self.ops.identity.set_device(unit)
        reserve_path = f"/plataforma/exhibicion/{unit}/sesiones"
        self.request("POST", reserve_path, 409)
        with self.client.websocket_connect(f"/ws/vehiculos/{unit}", headers={"X-Device-Key": device}) as hardware:
            hardware.receive_json()
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(lambda _: self.client.post(reserve_path), range(2)))
            self.assertEqual(sorted(r.status_code for r in responses), [201, 409])
            session = next(r.json() for r in responses if r.status_code == 201)
            headers = {"Authorization": "Bearer " + session["token"]}
            self.request("GET", "/plataforma/dashboard", 401, headers=headers)
            self.request("GET", f"/vehiculos/{unit}/historial", 401, headers=headers)
            self.assertEqual({row["nombre"] for row in session["comandos"]}, {"AVANZAR", "DETENER"})
            advance = next(row["id_comando"] for row in session["comandos"] if row["nombre"] == "AVANZAR")
            with self.ws(unit, headers) as visitor:
                channel = visitor.receive_json()
                self.assertEqual(channel["tipo"], "canal_control")
                credentials = {**headers, "X-IoT-Channel": channel["canal"]}
                self.request("POST", "/plataforma/exhibicion/ordenes", 403, headers=credentials, body={"id_comando": 2147483647})
                self.request("POST", "/plataforma/exhibicion/ordenes", 200, headers=credentials, body={"id_comando": advance})
                self.assertEqual(hardware.receive_json()["comando"], "AVANZAR")
                self.request("POST", "/plataforma/exhibicion/ordenes", 429, headers=credentials, body={"id_comando": advance})
            self.assertEqual(hardware.receive_json()["comando"], "DETENER")
            self.request("POST", "/plataforma/exhibicion/ordenes", 401, headers=headers, body={"id_comando": advance})
            again = self.request("POST", reserve_path, 201)
            new_headers = {"Authorization": "Bearer " + again["token"]}
            with self.ws(unit, new_headers) as visitor:
                visitor.receive_json()
                async def expire():
                    self.ops.reservations[unit] = utcnow()
                self.client.portal.call(expire)
                self.assertEqual(visitor.receive()["code"], 1008)
            self.assertEqual(hardware.receive_json()["comando"], "DETENER")
            self.request("GET", "/plataforma/dashboard", 200, headers=admin)
        with self.database.session() as db:
            self.assertIsNone(first(db, "SELECT id_reserva FROM reservas_iot WHERE unidad_reservada=%s", (unit,)))

    def test_assigned_unit_can_be_shared_without_removing_its_buyer(self):
        admin = self.login(self.email)
        model = self.model(admin)
        unit = self.unit(admin, model, "Unidad compartida", "disponible")
        buyer_id, buyer = self.buyer(admin, "Comprador")
        self.request("PUT", f"/plataforma/unidades/{unit}/asignacion", 200, headers=admin,
                     body={"id_cliente": buyer_id})
        device = self.ops.identity.set_device(unit)
        reserve_path = f"/plataforma/exhibicion/{unit}/sesiones"
        movement_path = f"/vehiculos/{unit}/movimientos"
        self.request("POST", reserve_path, 404)
        self.ops.exhibition.assigned_unit_ids = str(unit)

        def catalog_unit():
            models = self.request("GET", "/plataforma/catalogo?limit=100", 200)
            return next(row for item in models if item["id_modelo"] == model for row in item["unidades"] if row["id_vehiculo"] == unit)

        with self.client.websocket_connect(f"/ws/vehiculos/{unit}", headers={"X-Device-Key": device}) as hardware:
            hardware.receive_json()
            self.assertTrue(catalog_unit()["disponible"])
            with self.ws(unit, buyer) as owner:
                owner.receive_json()
                buyer_channel = {**buyer, "X-IoT-Channel": owner.receive_json()["canal"]}
                reservation = self.request("POST", reserve_path, 201)
                expires = datetime.fromisoformat(reservation["vence"])
                self.assertGreater(expires - datetime.now(timezone.utc), timedelta(minutes=14, seconds=55))
                self.assertLessEqual(expires - datetime.now(timezone.utc), timedelta(minutes=15))
                self.assertEqual([row["id_vehiculo"] for row in self.request(
                    "GET", "/plataforma/mis-unidades", 200, headers=buyer)], [unit])
                self.request("POST", reserve_path, 409)
                self.assertTrue(catalog_unit()["ocupada"])
                advance = next(row["id_comando"] for row in reservation["comandos"] if row["nombre"] == "AVANZAR")
                movement = {"id_comando": advance, "origen": "API"}
                self.request("POST", movement_path, 409, headers=buyer_channel, body=movement)
                guest = {"Authorization": "Bearer " + reservation["token"]}
                with self.ws(unit, guest) as visitor:
                    guest_channel = {**guest, "X-IoT-Channel": visitor.receive_json()["canal"]}
                    self.request("POST", "/plataforma/exhibicion/ordenes", 200, headers=guest_channel,
                                 body={"id_comando": advance})
                    self.assertEqual(hardware.receive_json()["comando"], "AVANZAR")
                    self.request("DELETE", "/plataforma/exhibicion/sesion", 204, headers=guest)
                    self.assertEqual(visitor.receive()["code"], 1008)
                self.assertEqual(hardware.receive_json()["comando"], "DETENER")
                self.assertTrue(catalog_unit()["disponible"])
                self.request("POST", movement_path, 200, headers=buyer_channel, body=movement)
                self.assertEqual(hardware.receive_json()["comando"], "AVANZAR")
                self.request("POST", reserve_path, 409)
            self.assertEqual(hardware.receive_json()["comando"], "DETENER")

        self.assertEqual(self.ops.fleet.unit(unit)["id_cliente"], buyer_id)

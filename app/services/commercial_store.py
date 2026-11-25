"""Consultas parametrizadas de 4.3 sobre la misma base que los SP de Control."""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.errors import ApiError
from app.models.commercial import MAX_DEMO_MS, MAX_STEP_MS, MAX_STEPS


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def as_utc(value):
    return value.replace(tzinfo=timezone.utc)


def query(session, sql, args=()):
    with session.connection.cursor() as cursor:
        cursor.execute(sql, args)
        return list(cursor.fetchall()) if cursor.description else []


def first(session, sql, args=()):
    return next(iter(query(session, sql, args)), None)


def audit(session, actor, action, resource, resource_id, result="correcto", *, role="sistema"):
    query(session, """INSERT INTO auditoria_iot (id_actor, rol, accion, recurso, id_recurso, resultado)
                      VALUES (%s,%s,%s,%s,%s,%s)""",
          (actor.account_id if actor else None, actor.role if actor else role, action, resource, resource_id, result))


def password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    raw = hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1, dklen=32, maxmem=64 * 1024**2)
    return f"{salt.hex()}:{raw.hex()}"


def token_bytes(token, prefix):
    if not token or len(token) != 45 or not token.startswith(prefix):
        return None
    return hashlib.sha256(token.encode()).digest()


@dataclass(frozen=True)
class Actor:
    role: str
    digest: bytes
    expires: datetime
    account_id: int | None = None
    vehicle_id: int | None = None
    reservation_id: int | None = None


CUSTOMER_FIELDS = "id_cliente, nombre, correo, rol, activo"


class IdentityStore:
    def __init__(self, database):
        self.database = database

    def login(self, email, password):
        with self.database.session() as session:
            row = first(session, f"SELECT {CUSTOMER_FIELDS}, clave_hash FROM clientes_iot WHERE correo=%s", (email,))
        expected = row.pop("clave_hash") if row else None
        salt = bytes.fromhex(expected.split(":")[0]) if expected else bytes(16)
        candidate = password_hash(password, salt)
        if not expected or not hmac.compare_digest(candidate, expected) or not row["activo"]:
            raise ApiError(401, "Revisa el correo y la contraseña.")
        token = "c_" + secrets.token_urlsafe(32)
        expires = utcnow() + timedelta(hours=8)
        with self.database.session(write=True) as session:
            current = first(session, "SELECT activo, clave_hash FROM clientes_iot WHERE id_cliente=%s FOR UPDATE",
                            (row["id_cliente"],))
            if not current["activo"] or current["clave_hash"] != expected:
                raise ApiError(401, "La cuenta cambió. Vuelve a iniciar sesión.")
            query(session, "DELETE FROM sesiones_cuenta_iot WHERE vence <= UTC_TIMESTAMP(6)")
            query(session, "INSERT INTO sesiones_cuenta_iot (huella,id_cliente,vence) VALUES (%s,%s,%s)",
                  (token_bytes(token, "c_"), row["id_cliente"], expires))
        return {"token": token, "vence": as_utc(expires), "cuenta": row}

    def account(self, token):
        digest = token_bytes(token, "c_")
        if digest:
            with self.database.session() as session:
                row = first(session, """SELECT c.id_cliente, c.rol, s.vence FROM sesiones_cuenta_iot s
                    JOIN clientes_iot c USING (id_cliente)
                    WHERE s.huella=%s AND c.activo=1 AND s.vence>UTC_TIMESTAMP(6)""", (digest,))
            if row:
                return Actor(row["rol"], digest, row["vence"], account_id=row["id_cliente"])
        raise ApiError(401, "Inicia sesión para continuar.")

    def logout(self, actor):
        with self.database.session(write=True) as session:
            query(session, "DELETE FROM sesiones_cuenta_iot WHERE huella=%s", (actor.digest,))

    def save_customer(self, body, customer_id=None, actor=None, *, role="usuario"):
        encoded = password_hash(body.clave.get_secret_value()) if body.clave else None
        with self.database.session(write=True) as session:
            if customer_id is None:
                if encoded is None:
                    raise ApiError(422, "El alta requiere una contraseña de al menos 12 caracteres.")
                query(session, "INSERT INTO clientes_iot (nombre,correo,clave_hash,rol,activo) VALUES (%s,%s,%s,%s,%s)",
                      (body.nombre, body.correo, encoded, role, body.activo))
                customer_id = session.last_insert_id()
                action = "crear_cuenta"
            else:
                row = first(session, "SELECT id_cliente FROM clientes_iot WHERE id_cliente=%s AND rol='usuario' FOR UPDATE",
                            (customer_id,))
                if not row:
                    raise ApiError(404, "El cliente no existe.")
                query(session, """UPDATE clientes_iot SET nombre=%s,correo=%s,activo=%s,
                    clave_hash=COALESCE(%s,clave_hash) WHERE id_cliente=%s""",
                      (body.nombre, body.correo, body.activo, encoded, customer_id))
                if not body.activo or encoded:
                    query(session, "DELETE FROM sesiones_cuenta_iot WHERE id_cliente=%s", (customer_id,))
                    query(session, "DELETE FROM soporte_iot WHERE id_cliente=%s", (customer_id,))
                action = "editar_cuenta" if body.activo else "desactivar_cuenta"
            audit(session, actor, action, "cuenta", customer_id)
            return first(session, f"SELECT {CUSTOMER_FIELDS} FROM clientes_iot WHERE id_cliente=%s", (customer_id,))

    def customers(self, search, limit, offset):
        with self.database.session() as session:
            return query(session, f"""SELECT {CUSTOMER_FIELDS} FROM clientes_iot
                WHERE rol='usuario' AND (INSTR(nombre,%s)>0 OR INSTR(correo,%s)>0 OR %s='')
                ORDER BY nombre,id_cliente LIMIT %s OFFSET %s""", (search, search, search, limit, offset))

    def set_device(self, vehicle_id):
        token = "d_" + secrets.token_urlsafe(32)
        with self.database.session(write=True) as session:
            query(session, "DELETE FROM dispositivos_iot WHERE id_vehiculo=%s", (vehicle_id,))
            query(session, "INSERT INTO dispositivos_iot (id_vehiculo,huella) VALUES (%s,%s)",
                  (vehicle_id, token_bytes(token, "d_")))
            audit(session, None, "credencial_dispositivo", "unidad", vehicle_id)
        return token

    def device(self, vehicle_id, token):
        digest = token_bytes(token, "d_")
        if not digest:
            return False
        with self.database.session() as session:
            return bool(first(session, "SELECT 1 FROM dispositivos_iot WHERE id_vehiculo=%s AND huella=%s",
                              (vehicle_id, digest)))


UNIT_SELECT = """SELECT v.*, m.nombre AS nombre_modelo, a.id_cliente, c.nombre AS propietario,
                   s.vence AS soporte_hasta, r.id_reserva
                 FROM vehiculos v LEFT JOIN modelos_vehiculo m ON m.id_modelo=v.id_modelo
                 LEFT JOIN asignaciones_iot a ON a.unidad_vigente=v.id_vehiculo
                 LEFT JOIN clientes_iot c ON c.id_cliente=a.id_cliente
                 LEFT JOIN soporte_iot s ON s.id_vehiculo=v.id_vehiculo AND s.id_cliente=a.id_cliente
                     AND s.vence>UTC_TIMESTAMP(6)
                 LEFT JOIN reservas_iot r ON r.unidad_reservada=v.id_vehiculo"""


class FleetStore:
    def __init__(self, database):
        self.database = database

    @staticmethod
    def _unit(session, vehicle_id):
        row = first(session, UNIT_SELECT + " WHERE v.id_vehiculo=%s", (vehicle_id,))
        if not row:
            raise ApiError(404, "La unidad no existe.")
        if row["soporte_hasta"]:
            row["soporte_hasta"] = as_utc(row["soporte_hasta"])
        return row

    def unit(self, vehicle_id):
        with self.database.session() as session:
            return self._unit(session, vehicle_id)

    def units(self, search="", limit=25, offset=0, *, actor=None, status=None):
        account_id = actor.account_id if actor else None
        role = actor.role if actor else None
        with self.database.session() as session:
            return query(session, UNIT_SELECT + """
                WHERE (%s IS NULL OR v.estado_comercial=%s)
                  AND (%s IS NULL OR (v.activo=1 AND v.estado_comercial='vendida' AND
                       ((%s='usuario' AND a.id_cliente=%s) OR (%s='administrador' AND s.vence IS NOT NULL))))
                  AND (%s='' OR INSTR(v.nombre,%s)>0 OR INSTR(v.identificador_fisico,%s)>0
                       OR INSTR(m.nombre,%s)>0 OR CAST(v.id_vehiculo AS CHAR)=%s)
                ORDER BY v.nombre,v.id_vehiculo LIMIT %s OFFSET %s""",
                (status, status, role, role, account_id, role,
                 search, search, search, search, search, limit, offset))

    @staticmethod
    def _capabilities(session, model_id):
        return query(session, "SELECT codigo,nombre,exhibicion FROM capacidades_modelo_iot WHERE id_modelo=%s ORDER BY codigo",
                     (model_id,))

    def models(self, search, limit, offset):
        with self.database.session() as session:
            return query(session, """SELECT id_modelo,nombre,descripcion,activo FROM modelos_vehiculo
                   WHERE %s='' OR INSTR(nombre,%s)>0 ORDER BY nombre,id_modelo LIMIT %s OFFSET %s""",
                         (search, search, limit, offset))

    def model(self, model_id):
        with self.database.session() as session:
            row = first(session, "SELECT * FROM modelos_vehiculo WHERE id_modelo=%s", (model_id,))
            if not row:
                raise ApiError(404, "El modelo no existe.")
            return {**row, "capacidades": self._capabilities(session, model_id)}

    @staticmethod
    def _sync_commands(session, vehicle_id, capabilities):
        commands = session.call("sp_obtener_comandos_vehiculo", (vehicle_id,))
        enabled = {entry["codigo"]: entry["nombre"] for entry in capabilities}
        existing = {entry["codigo"]: entry for entry in commands}
        existing_names = {entry["nombre"].strip().upper(): entry["codigo"] for entry in commands}
        for code, name in enabled.items():
            if ((code in existing and existing[code]["nombre"].strip().upper() != name) or
                    (name in existing_names and existing_names[name] != code)):
                raise ApiError(409, "La capacidad contradice un código histórico de la unidad.")
            if code not in existing:
                session.call("sp_crear_comando", (vehicle_id, name, code, None))
        for code, command in existing.items():
            active = int(code in enabled)
            if active != command["activo"]:
                query(session, "UPDATE comandos SET activo=%s WHERE id_comando=%s", (active, command["id_comando"]))

    def save_model(self, actor, body, model_id):
        capabilities = [entry.model_dump() for entry in sorted(body.capacidades, key=lambda item: item.codigo)]
        fields = (body.nombre, body.descripcion, body.activo, str(body.foto_url) if body.foto_url else None)
        with self.database.session(write=True) as session:
            if model_id is None:
                query(session, "INSERT INTO modelos_vehiculo (nombre,descripcion,activo,foto_url) VALUES (%s,%s,%s,%s)", fields)
                model_id = session.last_insert_id()
                action = "crear_modelo"
            else:
                if not first(session, "SELECT id_modelo FROM modelos_vehiculo WHERE id_modelo=%s FOR UPDATE", (model_id,)):
                    raise ApiError(404, "El modelo no existe.")
                query(session, "UPDATE modelos_vehiculo SET nombre=%s,descripcion=%s,activo=%s,foto_url=%s WHERE id_modelo=%s",
                      (*fields, model_id))
                query(session, "UPDATE vehiculos SET modelo=LEFT(%s,80) WHERE id_modelo=%s", (body.nombre, model_id))
                action = "editar_modelo" if body.activo else "desactivar_modelo"
            if self._capabilities(session, model_id) != capabilities:
                query(session, "DELETE FROM capacidades_modelo_iot WHERE id_modelo=%s", (model_id,))
                for item in capabilities:
                    query(session, "INSERT INTO capacidades_modelo_iot (id_modelo,codigo,nombre,exhibicion) VALUES (%s,%s,%s,%s)",
                          (model_id, item["codigo"], item["nombre"], item["exhibicion"]))
                for row in query(session, "SELECT id_vehiculo FROM vehiculos WHERE id_modelo=%s", (model_id,)):
                    self._sync_commands(session, row["id_vehiculo"], capabilities)
            audit(session, actor, action, "modelo", model_id)
            return {"id_modelo": model_id, "nombre": body.nombre, "descripcion": body.descripcion,
                    "activo": body.activo, "foto_url": fields[-1], "capacidades": capabilities}

    def save_unit(self, actor, body, vehicle_id):
        with self.database.session(write=True) as session:
            model = first(session, "SELECT nombre,activo FROM modelos_vehiculo WHERE id_modelo=%s", (body.id_modelo,))
            if not model:
                raise ApiError(404, "El modelo no existe.")
            unit = self._unit(session, vehicle_id) if vehicle_id else None
            if not model["activo"] and (not unit or body.id_modelo != unit["id_modelo"]):
                raise ApiError(409, "Elige un modelo activo para vincular la unidad.")
            if bool(unit and unit["id_cliente"]) != (body.estado_comercial == "vendida"):
                raise ApiError(409, "El estado asignado se cambia desde la operación de asignación.")
            if body.estado_comercial == "exhibicion" and not model["activo"]:
                raise ApiError(409, "La exhibición requiere un modelo activo.")
            fields = (body.nombre, model["nombre"][:80], body.descripcion, body.microcontrolador)
            if not unit:
                session.call("sp_crear_vehiculo", fields)
                vehicle_id = session.last_insert_id()
            else:
                session.call("sp_actualizar_vehiculo", (vehicle_id, *fields, int(body.estado_comercial != "inactiva")))
            query(session, """UPDATE vehiculos SET id_modelo=%s,identificador_fisico=%s,estado_comercial=%s,activo=%s
                              WHERE id_vehiculo=%s""", (body.id_modelo, body.identificador_fisico,
                    body.estado_comercial, int(body.estado_comercial != "inactiva"), vehicle_id))
            self._sync_commands(session, vehicle_id, self._capabilities(session, body.id_modelo))
            audit(session, actor, "crear_unidad" if not unit else "editar_unidad", "unidad", vehicle_id)
            return self._unit(session, vehicle_id)

    def assign(self, actor, vehicle_id, customer_id):
        with self.database.session(write=True) as session:
            query(session, "SELECT id_vehiculo FROM vehiculos WHERE id_vehiculo=%s FOR UPDATE", (vehicle_id,))
            unit = self._unit(session, vehicle_id)
            if unit["id_cliente"] == customer_id:
                return unit
            if customer_id is not None:
                customer = first(session, "SELECT activo,rol FROM clientes_iot WHERE id_cliente=%s FOR UPDATE", (customer_id,))
                if not customer or not customer["activo"] or customer["rol"] != "usuario":
                    raise ApiError(409, "Selecciona una cuenta de comprador activa.")
                if unit["estado_comercial"] not in ("disponible", "vendida") or not unit["activo"]:
                    raise ApiError(409, "La unidad debe estar disponible o asignada para cambiar de propietario.")
            query(session, "UPDATE asignaciones_iot SET hasta=UTC_TIMESTAMP(6) WHERE unidad_vigente=%s", (vehicle_id,))
            query(session, "DELETE FROM soporte_iot WHERE id_vehiculo=%s", (vehicle_id,))
            if customer_id is not None:
                query(session, "INSERT INTO asignaciones_iot (id_vehiculo,id_cliente) VALUES (%s,%s)", (vehicle_id, customer_id))
            query(session, "UPDATE vehiculos SET estado_comercial=%s WHERE id_vehiculo=%s",
                  ("vendida" if customer_id else "disponible", vehicle_id))
            audit(session, actor, "asignar" if customer_id else "desasignar", "unidad", vehicle_id)
            return self._unit(session, vehicle_id)

    def support(self, actor, vehicle_id, allowed):
        with self.database.session(write=True) as session:
            unit = self._unit(session, vehicle_id)
            if actor.role != "usuario" or unit["id_cliente"] != actor.account_id or unit["estado_comercial"] != "vendida":
                raise ApiError(403, "Sólo el comprador de esta unidad puede autorizar soporte.")
            query(session, "DELETE FROM soporte_iot WHERE id_vehiculo=%s", (vehicle_id,))
            if allowed:
                query(session, "INSERT INTO soporte_iot (id_vehiculo,id_cliente,vence) VALUES (%s,%s,%s)",
                      (vehicle_id, actor.account_id, utcnow() + timedelta(minutes=15)))
            audit(session, actor, "aprobar_soporte" if allowed else "revocar_soporte", "unidad", vehicle_id)
            return self._unit(session, vehicle_id)

    def dashboard(self):
        with self.database.session() as session:
            return first(session, """SELECT
                (SELECT COUNT(*) FROM modelos_vehiculo WHERE activo=1) AS modelos,
                (SELECT COUNT(*) FROM vehiculos) AS unidades,
                (SELECT COUNT(*) FROM asignaciones_iot WHERE hasta IS NULL) AS asignadas,
                (SELECT COUNT(*) FROM clientes_iot WHERE rol='usuario' AND activo=1) AS clientes,
                (SELECT COUNT(*) FROM demos WHERE activo=1) AS demos,
                (SELECT COUNT(*) FROM reservas_iot WHERE finalizada IS NULL) AS reservas""")

    def audit_log(self, limit, offset):
        with self.database.session() as session:
            rows = query(session, """SELECT e.*, c.nombre AS actor FROM auditoria_iot e
                   LEFT JOIN clientes_iot c ON c.id_cliente=e.id_actor ORDER BY id_evento DESC LIMIT %s OFFSET %s""",
                         (limit, offset))
            return [{**row, "fecha": as_utc(row["fecha"])} for row in rows]

    @staticmethod
    def visible_demos(rows, actor):
        if actor.role == "invitado":
            return [row for row in rows if row.get("id_cliente_demo") is None and row["activo"]]
        return [row for row in rows if row.get("id_cliente_demo") is None or (
            actor.role == "usuario" and row["id_cliente_demo"] == actor.account_id)]

    def demos(self, vehicle_id):
        with self.database.session() as session:
            return query(session, "SELECT * FROM demos WHERE id_vehiculo=%s ORDER BY nombre,id_demo", (vehicle_id,))

    def save_demo(self, actor, vehicle_id, demo_id, body):
        owner_id = actor.account_id if actor.role == "usuario" else None
        with self.database.session(write=True) as session:
            active_commands = {c["id_comando"] for c in session.call("sp_obtener_comandos_vehiculo", (vehicle_id,)) if c["activo"]}
            if any(step.id_comando not in active_commands for step in body.pasos):
                raise ApiError(422, "Algún paso usa un comando desactivado o de otra unidad.")
            if demo_id is None:
                query(session, "INSERT INTO demos (id_vehiculo,nombre,descripcion,activo,id_cliente_demo) VALUES (%s,%s,%s,%s,%s)",
                      (vehicle_id, body.nombre, body.descripcion, body.activo, owner_id))
                demo_id = session.last_insert_id()
                action = "crear_demo"
            else:
                row = first(session, "SELECT id_demo FROM demos WHERE id_demo=%s AND id_vehiculo=%s AND id_cliente_demo <=> %s FOR UPDATE",
                            (demo_id, vehicle_id, owner_id))
                if not row:
                    raise ApiError(404, "La demostración no existe o pertenece a otra cuenta.")
                query(session, "UPDATE demos SET nombre=%s,descripcion=%s,activo=%s WHERE id_demo=%s",
                      (body.nombre, body.descripcion, body.activo, demo_id))
                query(session, "DELETE FROM demo_movimientos WHERE id_demo=%s", (demo_id,))
                action = "editar_demo" if body.activo else "desactivar_demo"
            for order, step in enumerate(body.pasos, 1):
                session.call("sp_agregar_movimiento_demo", (demo_id, step.id_comando, order, step.duracion_ms, step.pausa_ms))
            audit(session, actor, action, "demo", demo_id)
            return first(session, "SELECT * FROM demos WHERE id_demo=%s", (demo_id,))

    @staticmethod
    def safe_steps(steps):
        if (len(steps) > MAX_STEPS or any(max(step["duracion_ms"], step["pausa_ms"],
                                            step.get("duracion_auxiliar_ms", 0)) > MAX_STEP_MS for step in steps)
                or sum(step["duracion_ms"] + step["pausa_ms"] for step in steps) > MAX_DEMO_MS):
            raise ApiError(409, "El recorrido excede los tiempos permitidos en 4.3. Revisa su secuencia.")
        return steps

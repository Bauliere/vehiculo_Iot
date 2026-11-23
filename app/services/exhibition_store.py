import secrets
from datetime import timedelta

from app.errors import ApiError
from app.models.commercial import GUEST_COMMANDS
from app.services.commercial_store import Actor, as_utc, audit, first, query, token_bytes, utcnow

SESSION_SECONDS = 15 * 60
ELIGIBLE_UNIT = """v.activo=1 AND m.activo=1 AND (
    v.estado_comercial='exhibicion' OR (v.estado_comercial='vendida' AND FIND_IN_SET(v.id_vehiculo,%s)>0))"""


class ExhibitionStore:
    def __init__(self, database, assigned_unit_ids=""):
        self.database = database
        self.assigned_unit_ids = assigned_unit_ids

    @staticmethod
    def _commands(session, vehicle_id):
        rows = query(session, """SELECT c.id_comando,c.nombre,c.codigo FROM comandos c
            JOIN vehiculos v USING (id_vehiculo) JOIN capacidades_modelo_iot m
                ON m.id_modelo=v.id_modelo AND m.codigo=c.codigo AND m.nombre=c.nombre
            WHERE c.id_vehiculo=%s AND c.activo=1 AND (m.exhibicion=1 OR c.nombre='DETENER')
            ORDER BY c.codigo""", (vehicle_id,))
        return [row for row in rows if row["nombre"] in GUEST_COMMANDS | {"DETENER"}]

    def commands(self, vehicle_id):
        with self.database.session() as session:
            return self._commands(session, vehicle_id)

    def _display_units(self, session, limit, offset, model_id):
        return query(session, f"""SELECT v.id_vehiculo,v.nombre,v.id_modelo,r.id_reserva IS NOT NULL AS ocupada
            FROM vehiculos v JOIN modelos_vehiculo m USING (id_modelo)
            LEFT JOIN reservas_iot r ON r.unidad_reservada=v.id_vehiculo
            WHERE {ELIGIBLE_UNIT} AND m.id_modelo=%s
              AND EXISTS (SELECT 1 FROM comandos c JOIN capacidades_modelo_iot k
                ON k.id_modelo=v.id_modelo AND k.codigo=c.codigo AND k.nombre=c.nombre
                WHERE c.id_vehiculo=v.id_vehiculo AND c.activo=1 AND c.nombre='DETENER')
              AND EXISTS (SELECT 1 FROM comandos c JOIN capacidades_modelo_iot k
                ON k.id_modelo=v.id_modelo AND k.codigo=c.codigo AND k.nombre=c.nombre
                WHERE c.id_vehiculo=v.id_vehiculo AND c.activo=1 AND k.exhibicion=1 AND c.nombre<>'DETENER')
            ORDER BY v.nombre,v.id_vehiculo LIMIT %s OFFSET %s""", (self.assigned_unit_ids, model_id, limit, offset))

    def catalog(self, limit, offset):
        with self.database.session() as session:
            models = query(session, """SELECT id_modelo,nombre,descripcion,foto_url FROM modelos_vehiculo
                    WHERE activo=1 ORDER BY nombre,id_modelo LIMIT %s OFFSET %s""", (limit, offset))
            for model in models:
                model_id = model["id_modelo"]
                model["capacidades"] = query(session, "SELECT nombre FROM capacidades_modelo_iot WHERE id_modelo=%s ORDER BY codigo", (model_id,))
                model["unidades"] = self._display_units(session, 12, 0, model_id)
        return models

    def available(self, vehicle_ids):
        with self.database.session() as session:
            count = 0
            for vehicle_id in vehicle_ids:
                row = first(session, f"""SELECT v.id_vehiculo FROM vehiculos v JOIN modelos_vehiculo m USING (id_modelo)
                    LEFT JOIN reservas_iot r ON r.unidad_reservada=v.id_vehiculo WHERE v.id_vehiculo=%s
                    AND r.id_reserva IS NULL AND {ELIGIBLE_UNIT}""", (vehicle_id, self.assigned_unit_ids))
                if row and self._ready(self._commands(session, vehicle_id)):
                    count += 1
            return count

    @staticmethod
    def _ready(commands):
        names = {row["nombre"] for row in commands}
        return "DETENER" in names and bool(names & GUEST_COMMANDS)

    def reserve(self, vehicle_id):
        token = "g_" + secrets.token_urlsafe(32)
        expires = utcnow() + timedelta(seconds=SESSION_SECONDS)
        with self.database.session(write=True) as session:
            unit = first(session, f"""SELECT v.id_vehiculo FROM vehiculos v JOIN modelos_vehiculo m USING (id_modelo)
                WHERE v.id_vehiculo=%s AND {ELIGIBLE_UNIT} FOR UPDATE""", (vehicle_id, self.assigned_unit_ids))
            if not unit:
                raise ApiError(404, "No hay una unidad de exhibición disponible con ese identificador.")
            if first(session, "SELECT id_reserva FROM reservas_iot WHERE unidad_reservada=%s", (vehicle_id,)):
                raise ApiError(409, "La unidad está en uso. Intenta de nuevo cuando termine la prueba.")
            commands = self._commands(session, vehicle_id)
            if not self._ready(commands):
                raise ApiError(409, "La unidad de exhibición todavía no está configurada.")
            query(session, "INSERT INTO reservas_iot (huella,id_vehiculo,vence) VALUES (%s,%s,%s)",
                  (token_bytes(token, "g_"), vehicle_id, expires))
            audit(session, None, "reservar_exhibicion", "reserva", session.last_insert_id(), role="invitado")
        return {"token": token, "id_vehiculo": vehicle_id, "vence": as_utc(expires), "comandos": commands}

    def guest(self, token):
        digest = token_bytes(token, "g_")
        if digest:
            with self.database.session() as session:
                row = first(session, f"""SELECT r.id_reserva,r.id_vehiculo,r.vence FROM reservas_iot r
                    JOIN vehiculos v ON v.id_vehiculo=r.id_vehiculo JOIN modelos_vehiculo m USING (id_modelo)
                    WHERE r.huella=%s AND r.finalizada IS NULL AND r.vence>UTC_TIMESTAMP(6)
                    AND {ELIGIBLE_UNIT}""", (digest, self.assigned_unit_ids))
            if row:
                return Actor("invitado", digest, row["vence"], vehicle_id=row["id_vehiculo"], reservation_id=row["id_reserva"])
        raise ApiError(401, "La prueba ha terminado o la sesión no es válida.")

    def open_reservations(self):
        with self.database.session() as session:
            return query(session, "SELECT id_reserva,id_vehiculo,vence FROM reservas_iot WHERE finalizada IS NULL")

    def end(self, vehicle_id, reason, stopped):
        with self.database.session(write=True) as session:
            row = first(session, "SELECT id_reserva FROM reservas_iot WHERE unidad_reservada=%s FOR UPDATE", (vehicle_id,))
            if row:
                if stopped:
                    query(session, "UPDATE reservas_iot SET finalizada=UTC_TIMESTAMP(6) WHERE id_reserva=%s", (row["id_reserva"],))
                audit(session, None, reason, "reserva", row["id_reserva"], "correcto" if stopped else "pendiente")

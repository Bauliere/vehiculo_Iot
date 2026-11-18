"""Genera un inventario de estructura por TLS usando la configuración de la API."""

import json
import sys

from app.config import Settings
from app.database import Database, PROCEDURES
from app.errors import ApiError


QUERIES = {
    "tablas": """
        SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
    """,
    "columnas": """
        SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    """,
    "indices": """
        SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    """,
    "llaves_foraneas": """
        SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
               k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
               r.UPDATE_RULE, r.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r
          ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
         AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
        WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION
    """,
    "procedimientos": """
        SELECT ROUTINE_NAME, SECURITY_TYPE, ROUTINE_DEFINITION IS NOT NULL AS definicion_visible
        FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'
        ORDER BY ROUTINE_NAME
    """,
    "parametros": """
        SELECT SPECIFIC_NAME, ORDINAL_POSITION, PARAMETER_MODE, PARAMETER_NAME, DTD_IDENTIFIER
        FROM information_schema.PARAMETERS
        WHERE SPECIFIC_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'
        ORDER BY SPECIFIC_NAME, ORDINAL_POSITION
    """,
    "disparadores": """
        SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING
        FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
        ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME
    """,
}


def inventory(database):
    with database.session() as session, session.connection.cursor() as cursor:
        cursor.execute("SELECT VERSION() AS version, @@version_comment AS motor, DATABASE() AS esquema")
        report = {"servidor": cursor.fetchone()}
        for label, query in QUERIES.items():
            cursor.execute(query)
            report[label] = list(cursor.fetchall())

    names = {row["ROUTINE_NAME"] for row in report["procedimientos"]}
    counts = dict.fromkeys(names, 0)
    for row in report["parametros"]:
        counts[row["SPECIFIC_NAME"]] += 1
    report["contrato_api"] = {
        "faltantes": sorted(PROCEDURES.keys() - names),
        "numero_parametros_distinto": [
            name for name in sorted(PROCEDURES.keys() & names) if counts[name] != PROCEDURES[name]
        ],
    }
    return report


def main():
    try:
        report = inventory(Database(Settings()))
    except ApiError as error:
        print(f"Inventario no disponible. {error.detail}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

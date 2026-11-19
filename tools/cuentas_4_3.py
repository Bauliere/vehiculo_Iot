"""Provisión interactiva en la instancia que aloja FastAPI."""

import argparse
from getpass import getpass

from pydantic import ValidationError

from app.config import Settings
from app.database import Database
from app.errors import ApiError
from app.models.commercial import CustomerInput
from app.services.commercial_store import IdentityStore


def main():
    parser = argparse.ArgumentParser(description="Provisión de cuentas de empresa y dispositivos 4.3")
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("crear-admin")
    admin.add_argument("--nombre", required=True)
    admin.add_argument("--correo", required=True)
    device = commands.add_parser("credencial-dispositivo", help="Genera o sustituye la credencial de una unidad")
    device.add_argument("id_vehiculo", type=int)
    args = parser.parse_args()
    identity = IdentityStore(Database(Settings()))
    try:
        if args.command == "crear-admin":
            password = getpass("Contraseña (mínimo 12 caracteres): ")
            if password != getpass("Repite la contraseña: "):
                parser.error("Las contraseñas no coinciden.")
            body = CustomerInput(nombre=args.nombre, correo=args.correo, clave=password)
            account = identity.save_customer(body, role="administrador")
            print(f"Cuenta de administración creada (ID {account['id_cliente']}).")
        else:
            token = identity.set_device(args.id_vehiculo)
            print("Copia la credencial al archivo privado del firmware. El servidor guarda su huella.")
            print(token)
    except ValidationError:
        parser.error("Revisa el correo, el nombre y la longitud de la contraseña.")
    except ApiError as error:
        parser.exit(1, error.detail + "\n")


if __name__ == "__main__":
    main()

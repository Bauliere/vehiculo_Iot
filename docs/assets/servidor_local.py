"""Sirve el control local con tipos MIME explícitos, también en Windows."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class ServidorControl(SimpleHTTPRequestHandler):
    # Windows puede registrar .js como text/plain. Los módulos del navegador
    # necesitan un tipo JavaScript válido para poder ejecutarse.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".ico": "image/x-icon",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parent.parent), **kwargs)

    def end_headers(self):
        # Al trabajar localmente, una recarga debe traer el código actualizado.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5500)
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), ServidorControl)
    except OSError as error:
        parser.exit(1, f"No se pudo abrir el puerto {args.port}. Cierra el servidor anterior con Ctrl+C.\n{error}\n")
    print(f"Control IoT: http://127.0.0.1:{args.port}/", flush=True)
    print("Deja esta terminal abierta. Ctrl+C para detener.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor local detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()


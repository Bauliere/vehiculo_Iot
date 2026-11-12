"""Swagger guiado: instrucciones, ejemplos y un observador WebSocket."""

from html import escape
from urllib.parse import quote

from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse


TAGS = [
    {"name": "Diagnóstico", "description": "Empieza aquí: comprueba el servidor y después la conexión con RDS. Estas consultas no modifican datos."},
    {"name": "Estado", "description": "Envía un movimiento individual con POST y consulta el último estado con GET. Conecta el monitor antes para ver el aviso en vivo."},
    {"name": "Historial", "description": "Consulta hasta diez movimientos individuales recientes. Las DEMO actualizan el estado sin agregar historial."},
    {"name": "DEMO", "description": "Crea primero el nombre y la descripción del recorrido. Después agrega sus pasos en Movimientos DEMO. /iniciar ejecuta la secuencia por WebSocket; /cancelar la detiene mientras sigue activa."},
    {"name": "Movimientos DEMO", "description": "Aquí agregas los pasos de una DEMO ya creada: comando, orden, duración y pausa. Un mismo comando puede aparecer en varios pasos. Actualizar o eliminar un paso cambia esa secuencia."},
    {"name": "Vehículos", "description": "Consulta los vehículos o administra sus datos. Los POST requieren la clave de administrador y guardan cambios en RDS."},
    {"name": "Comandos", "description": "Catálogo de acciones disponibles, como AVANZAR o DETENER. Crea un comando solo si falta esa acción. Los pasos DEMO reutilizan su id_comando; crear la acción no mueve el vehículo."},
]

DESCRIPTION = """25 operaciones HTTP que integran los 21 procedimientos existentes de **vehiculo_iot**.

**GET consulta · POST ejecuta o modifica · WebSocket comunica cambios en vivo.**

En la demostración actual se usa vehículo **1**, comando **1 AVANZAR**, comando **9 DETENER** y DEMO **1**.
Confirma los IDs con GET antes de usar otros registros. Los campos numéricos requieren enteros;
`activo` y `conectado` usan **0 o 1**. Los nombres y descripciones son texto.

Las respuestas confirman el estado guardado y los eventos enviados. La conexión física con el carrito es una etapa posterior.
"""

PARAMETERS = {
    "docExpansion": "none",
    "defaultModelsExpandDepth": -1,
    "filter": True,
    "tryItOutEnabled": True,
    "displayRequestDuration": True,
    "deepLinking": True,
    "persistAuthorization": False,
    "validatorUrl": None,
    "syntaxHighlight": {"theme": "obsidian"},
}

STYLE = """
<style>
:root {
  color-scheme: light;
  --forest: #234f3b;
  --forest-deep: #132c22;
  --ink: #243c30;
  --muted: #546858;
  --glass: rgba(250, 251, 245, .90);
  --glass-border: rgba(255, 255, 246, .46);
}
html { min-height: 100%; background: #152c21; }
body {
  margin: 0; min-height: 100vh;
  background:
    radial-gradient(ellipse at 8% 5%, rgba(135, 150, 95, .44), transparent 46%),
    radial-gradient(ellipse at 96% 30%, rgba(79, 115, 77, .56), transparent 42%),
    linear-gradient(145deg, #263e2c, #142e23 58%, #294735);
  background-attachment: fixed;
}
.iot-guide, .swagger-ui .wrapper { max-width: 1200px; margin: auto; }
.iot-guide { padding: 36px 20px 12px; color: var(--ink); font: 15px/1.65 'Segoe UI', system-ui, sans-serif; }
.iot-hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; color: #f6f7ed; margin-bottom: 25px; }
.iot-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .18em; color: #d1d6bd; text-transform: uppercase; }
.iot-guide h1 { font-size: clamp(27px, 4vw, 40px); font-weight: 650; letter-spacing: -.035em; margin: 6px 0 9px; line-height: 1.15; }
.iot-hero p:last-child { color: #e1e6d4; max-width: 740px; }
.iot-badge { flex-shrink: 0; border: 1px solid rgba(235, 242, 218, .32); border-radius: 50px; padding: 9px 15px; font-size: 12px; color: #f4f4e9; background: rgba(246, 251, 226, .09); backdrop-filter: blur(16px); }
.iot-guide h2 { margin: 0 0 8px; font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.iot-guide p { margin: 6px 0; }
.iot-guide a { color: #24583d; text-underline-offset: 3px; }
.iot-guide code { background: rgba(34, 79, 48, .08); border-radius: 5px; padding: 2px 5px; overflow-wrap: anywhere; }
.iot-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 20px 0 16px; }
.iot-card, .iot-monitor, .iot-demo-guide, .iot-help {
  padding: 20px; border: 1px solid var(--glass-border); border-radius: 20px;
  background: var(--glass); box-shadow: 0 12px 34px rgba(5, 24, 13, .14), inset 0 1px 0 rgba(255, 255, 255, .65);
  -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px);
}
.iot-quick { display: flex; gap: 9px; flex-wrap: wrap; margin: 16px 0; }
.iot-quick a { text-decoration: none; border: 1px solid rgba(238, 245, 219, .38); border-radius: 10px; padding: 8px 13px; color: #f6f7eb; background: rgba(246, 251, 233, .11); font-size: 13px; font-weight: 600; backdrop-filter: blur(12px); transition: background .15s; }
.iot-quick a:hover { background: rgba(246, 251, 233, .23); }
.iot-monitor, .iot-demo-guide { margin-bottom: 14px; }
.iot-monitor summary, .iot-demo-guide summary { cursor: pointer; font-size: 17px; font-weight: 650; }
.iot-demo-guide[open] summary, .iot-monitor[open] summary { margin-bottom: 14px; }
.iot-concepts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
.iot-concepts > div { border: 1px solid rgba(35, 79, 59, .15); border-radius: 12px; padding: 13px; background: rgba(255, 255, 255, .40); }
.iot-concepts strong { display: block; color: #204b32; }
.iot-demo-guide ol { padding-left: 23px; }
.iot-demo-guide li { padding-left: 4px; margin: 15px 0; }
.iot-guide pre { overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 12px; background: #192e23; color: #edf1df; padding: 15px; font: 13px/1.65 Consolas, monospace; }
.iot-guide pre code { background: transparent; padding: 0; }
.iot-note { font-size: 13px; color: var(--muted); }
.iot-help { font-size: 13px; margin-top: 14px; }
.iot-controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
.iot-guide input, .iot-guide button { font: inherit; border-radius: 9px; padding: 8px 12px; border: 1px solid #879a7f; }
.iot-guide input[type=number] { width: 90px; }
.iot-guide input[readonly] { width: 100%; box-sizing: border-box; background: rgba(255, 255, 255, .65); color: #325e3f; }
.iot-guide button { background: var(--forest); color: #fff; cursor: pointer; }
.iot-guide button:hover:not(:disabled) { background: #173d2b; }
.iot-guide button:disabled { opacity: .55; cursor: default; }
.iot-guide :focus-visible, .swagger-ui :focus-visible { outline: 3px solid #7a7345; outline-offset: 3px; }
#iot-events { max-height: 320px; overflow: auto; }
#iot-status { font-weight: 650; }
#swagger-ui { padding: 0 20px 36px; }
#swagger-ui > .swagger-ui { max-width: 1200px; box-sizing: border-box; margin: 5px auto 0; padding: 8px 16px 18px; border: 1px solid var(--glass-border); border-radius: 24px; background: rgba(249, 250, 244, .94); box-shadow: 0 20px 65px rgba(4, 20, 11, .23); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); }
.swagger-ui .wrapper { box-sizing: border-box; padding: 0 12px; }
.swagger-ui .info { margin-top: 24px; margin-bottom: 22px; }
.swagger-ui .info .title { color: #203f2b; font-size: 28px; font-weight: 650; letter-spacing: -.03em; }
.swagger-ui .info .title small, .swagger-ui .info .title small pre { background: #526c46; color: #fff; }
.swagger-ui .info code { color: #2c5736; background: rgba(44, 87, 54, .08); }
.swagger-ui .info p, .swagger-ui .info li, .swagger-ui .opblock-description-wrapper p, .swagger-ui .opblock-tag small { color: #3e5544; line-height: 1.65; }
.swagger-ui a, .swagger-ui .info a { color: #315c3a; }
.swagger-ui .scheme-container { background: rgba(255, 255, 255, .40); border-top: 1px solid #d7dfce; border-bottom: 1px solid #d7dfce; box-shadow: none; padding: 16px 0; }
.swagger-ui .btn { border-radius: 8px; box-shadow: none; }
.swagger-ui .btn.authorize { color: #28533b; border-color: #4e7358; background: rgba(255, 255, 255, .6); }
.swagger-ui .btn.authorize svg, .swagger-ui .btn.authorize svg use, .swagger-ui .btn.authorize svg path { fill: #28533b !important; }
.swagger-ui .authorization__btn svg { fill: #44684a; }
.swagger-ui .btn.execute { background: #28563c; border-color: #28563c; color: white; }
.swagger-ui .btn.execute:hover { background: #183d29; }
.swagger-ui input[type=text], .swagger-ui input[type=password], .swagger-ui input[type=number], .swagger-ui textarea, .swagger-ui select { border: 1px solid #96aa8e; border-radius: 8px; background: rgba(255, 255, 252, .94); color: #1d3927; }
.swagger-ui .filter .operation-filter-input { padding: 13px; border-color: #9cae94; }
.swagger-ui .opblock-tag { border-bottom-color: #cbd6c2; color: #26422d; border-radius: 10px; }
.swagger-ui .opblock-tag:hover { background: rgba(48, 86, 51, .06); }
.swagger-ui .opblock { border-radius: 12px; box-shadow: none; overflow: hidden; margin-bottom: 12px; }
.swagger-ui .opblock.opblock-get { border-color: #839575; background: rgba(117, 140, 91, .07); }
.swagger-ui .opblock.opblock-get .opblock-summary { border-color: #839575; }
.swagger-ui .opblock.opblock-get .opblock-summary-method { background: #60764f; }
.swagger-ui .opblock.opblock-post { border-color: #527d5c; background: rgba(47, 100, 64, .07); }
.swagger-ui .opblock.opblock-post .opblock-summary { border-color: #527d5c; }
.swagger-ui .opblock.opblock-post .opblock-summary-method { background: #28563c; }
.swagger-ui .opblock .opblock-summary-method { border-radius: 7px; text-shadow: none; min-width: 68px; }
.swagger-ui .opblock .opblock-section-header { background: rgba(255, 255, 250, .55); box-shadow: none; }
.swagger-ui .opblock pre.microlight { background: #192e23 !important; border-radius: 10px; }
.swagger-ui .dialog-ux .modal-ux { border: 1px solid #b6c6ab; border-radius: 18px; background: #f5f7ed; box-shadow: 0 30px 80px rgba(0, 15, 6, .35); }
.swagger-ui .dialog-ux .backdrop-ux { background: rgba(12, 32, 20, .65); -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px); }
@supports not (backdrop-filter: blur(1px)) { .iot-card, .iot-monitor, .iot-demo-guide, .iot-help { background: #f4f6eb; } }
@media (max-width: 700px) {
  .iot-steps, .iot-concepts { grid-template-columns: 1fr; }
  .iot-guide { padding: 26px 14px 8px; }
  .iot-hero { display: block; }
  .iot-badge { display: inline-block; margin-top: 10px; }
  #swagger-ui { padding: 0 12px 24px; }
  #swagger-ui > .swagger-ui { padding: 5px 5px 12px; border-radius: 19px; }
  .swagger-ui .wrapper { padding: 0 7px; }
  .swagger-ui h3.opblock-tag { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .swagger-ui h3.opblock-tag > a { grid-column: 1; grid-row: 1; }
  .swagger-ui h3.opblock-tag > button { grid-column: 2; grid-row: 1; }
  .swagger-ui h3.opblock-tag > small { grid-column: 1 / -1; grid-row: 2; }
}
@media (prefers-reduced-motion: reduce) { .iot-quick a { transition: none; } }
</style>
"""

GUIDE = """
<section class="iot-guide" aria-label="Guía para probar la API">
  <header class="iot-hero">
    <div><p class="iot-eyebrow">Vehículo IoT · documentación interactiva</p>
      <h1>Del comando al movimiento.</h1>
      <p>Consulta el vehículo, prepara una secuencia y observa sus cambios en vivo. Todo desde el mismo lugar.</p>
    </div>
    <span class="iot-badge">21 procedimientos · 25 operaciones</span>
  </header>
  <div class="iot-steps">
    <section class="iot-card"><h2>1. Comprueba la conexión</h2>
      <p>Abre <a href="__ROOT__/health/rds" target="_blank" rel="noopener">el diagnóstico de RDS</a>. Debe mostrar <code>status: ok</code> y <code>database: RDS</code>.</p>
      <p>Para la demostración puedes usar vehículo <strong>1</strong> y DEMO <strong>1</strong>.</p>
    </section>
    <section class="iot-card"><h2>2. Autoriza las escrituras</h2>
      <p>Pulsa <strong>Authorize</strong>, debajo de esta guía. Pega solo el valor de <code>API_ADMIN_KEY</code> del <code>.env</code> de AWS.</p>
      <p>Sin el nombre ni el signo igual. Los GET son públicos. Postman tiene su propia configuración de clave.</p>
    </section>
    <section class="iot-card"><h2>3. Abre y envía la operación</h2>
      <p>Los campos ya están habilitados. Ajusta los IDs o el JSON y pulsa <strong>Execute</strong>. Mira el código y el cuerpo en <strong>Server response</strong>.</p>
      <p><code>id_vehiculo</code> selecciona el registro: no cambia su identificador en la base.</p>
    </section>
  </div>
  <nav class="iot-quick" aria-label="Operaciones frecuentes">__LINKS__</nav>
  <details class="iot-demo-guide">
    <summary>Comando, DEMO y paso: cómo crear tu recorrido</summary>
    <div class="iot-concepts">
      <div><strong>Comando = acción disponible</strong><p>Por ejemplo, AVANZAR. Tiene nombre y código. Se crea una vez en el catálogo del vehículo y puede reutilizarse.</p></div>
      <div><strong>DEMO = recorrido con nombre</strong><p>Por ejemplo, Mi recorrido. Al crearla guardas nombre y descripción. Sus movimientos se agregan después.</p></div>
      <div><strong>Paso = acción dentro del recorrido</strong><p>Elige un comando y añade su orden, duración y pausa. Puedes repetir el mismo comando en varios pasos.</p></div>
    </div>
    <p><strong>Ejemplo con el vehículo 1:</strong> AVANZAR durante un segundo, esperar 200 ms y GIRAR_IZQUIERDA durante medio segundo.</p>
    <ol>
      <li>__CATALOG_LINK__. El vehículo 1 ya tiene AVANZAR con ID 1, GIRAR_IZQUIERDA con ID 3 y DETENER con ID 9. Si necesitas una acción que falta, usa __COMMAND_LINK__.</li>
      <li>__DEMO_LINK__ con nombre y descripción. Copia el <code>id_demo</code> que devuelve el servidor. Ese es el ID de tu nueva secuencia.</li>
      <li>__STEP_LINK__. Escribe <code>id_vehiculo = 1</code> y el nuevo <code>id_demo</code>. Envía este primer cuerpo:
        <pre><code>{"id_comando": 1, "orden": 1, "duracion_ms": 1000, "pausa_ms": 200}</code></pre>
        Vuelve a enviar la misma operación con el segundo paso:
        <pre><code>{"id_comando": 3, "orden": 2, "duracion_ms": 500, "pausa_ms": 0}</code></pre>
        Son dos envíos separados. Cada uno agrega un paso; no crea otro comando.
      </li>
      <li>__STEPS_LINK__ para comprobar los dos pasos. Conecta el monitor y usa __START_LINK__ con el mismo ID nuevo, sin cuerpo. La DEMO finalizará en DETENER.</li>
    </ol>
    <p class="iot-note">Editar un comando cambia la acción del catálogo. Editar un paso cambia su comando, posición o tiempos dentro de esa DEMO. Eliminar un paso lo quita del recorrido; no borra el comando. Si un comando está usado por una DEMO, su eliminación puede responder 409. Para ejecutar una DEMO, su vehículo necesita un comando activo llamado DETENER.</p>
  </details>
  <details class="iot-monitor">
    <summary>Ver cambios en vivo con WebSocket</summary>
    <p>Conecta este monitor antes de enviar un POST. Al conectarte verás <code>estado_inicial</code>; después llegarán los movimientos y los pasos de la DEMO. Puedes abrir otra pestaña para observar dos clientes.</p>
    <div class="iot-controls">
      <label for="iot-vehicle">ID del vehículo</label>
      <input id="iot-vehicle" type="number" min="1" max="2147483647" step="1" value="1">
      <button id="iot-connect" type="button">Conectar</button>
      <button id="iot-disconnect" type="button" disabled>Desconectar</button>
      <span id="iot-status" role="status" aria-live="polite">Desconectado</span>
    </div>
    <label for="iot-ws-url">Dirección WebSocket para este servidor</label>
    <input id="iot-ws-url" readonly>
    <pre id="iot-events" aria-label="Eventos recibidos">Aquí aparecerán los eventos. Este monitor observa; envía las órdenes desde las operaciones POST.</pre>
  </details>
  <div class="iot-help"><p><strong>Respuestas:</strong> 200 consulta o acción completada · 201 registro creado · 202 DEMO aceptada · 401 revisa la clave · 404 revisa los IDs · 409 conflicto, como una DEMO activa · 422 revisa los campos señalados.</p>
    <p>Para crear, editar o eliminar usa los IDs devueltos al crear tus registros. Esas operaciones sí guardan cambios en RDS.</p></div>
</section>
"""

MONITOR_SCRIPT = r"""
<script>
(() => {
  document.querySelectorAll('a[data-operation]').forEach(link => {
    link.addEventListener('click', () => {
      if (typeof ui === 'undefined' || !ui.layoutActions) return;
      ui.layoutActions.show(['operations-tag', link.dataset.tag], true);
      ui.layoutActions.show(['operations', link.dataset.tag, link.dataset.operation], true);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const target = Array.from(document.querySelectorAll('.opblock[id]'))
          .find(element => element.id.endsWith('-' + link.dataset.operation));
        if (target) target.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
      }));
    });
  });
  const vehicle = document.getElementById('iot-vehicle');
  const connect = document.getElementById('iot-connect');
  const disconnect = document.getElementById('iot-disconnect');
  const address = document.getElementById('iot-ws-url');
  const status = document.getElementById('iot-status');
  const events = document.getElementById('iot-events');
  const prefix = location.pathname.replace(/\/docs\/?$/, '');
  let socket = null;
  let lines = [];
  function url() {
    const id = Number(vehicle.value);
    if (!vehicle.value.trim() || !Number.isInteger(id) || id < 1 || id > 2147483647) return '';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + prefix + '/ws/vehiculos/' + id;
  }
  function log(text) {
    lines.push(text);
    lines = lines.slice(-30);
    events.textContent = lines.join('\n\n');
    events.scrollTop = events.scrollHeight;
  }
  function ready() {
    socket = null;
    vehicle.disabled = false;
    connect.disabled = false;
    disconnect.disabled = true;
  }
  vehicle.addEventListener('input', () => { address.value = url(); });
  address.value = url();
  connect.addEventListener('click', () => {
    const target = url();
    if (!target) { status.textContent = 'Escribe un ID entero mayor que cero.'; return; }
    if (socket) return;
    vehicle.disabled = true;
    connect.disabled = true;
    disconnect.disabled = false;
    status.textContent = 'Conectando…';
    lines = [];
    events.textContent = 'Esperando el estado inicial…';
    try { socket = new WebSocket(target); }
    catch (_) { ready(); status.textContent = 'No se pudo abrir la conexión.'; return; }
    socket.addEventListener('open', () => { status.textContent = 'Conectado · observando'; });
    socket.addEventListener('message', message => {
      try { log(JSON.stringify(JSON.parse(message.data), null, 2)); }
      catch (_) { log(String(message.data)); }
    });
    socket.addEventListener('error', () => {
      status.textContent = 'Error de conexión';
      log('No se pudo mantener el WebSocket. Comprueba el ID, /health/rds y la disponibilidad de la API.');
    });
    socket.addEventListener('close', message => {
      status.textContent = 'Desconectado · código ' + message.code;
      if (message.code !== 1000 && message.code !== 1001) log('Conexión cerrada. Comprueba que el vehículo exista y vuelve a conectar.');
      ready();
    });
  });
  disconnect.addEventListener('click', () => {
    if (socket) { status.textContent = 'Desconectando…'; socket.close(1000, 'Monitor cerrado'); }
  });
  window.addEventListener('pagehide', () => { if (socket) socket.close(1000, 'Página cerrada'); });
})();
</script>
"""


def swagger_documentation(schema: dict, openapi_url: str, root_path: str = "") -> HTMLResponse:
    page = get_swagger_ui_html(
        openapi_url=openapi_url,
        title="Vehículo IoT · Guía y pruebas",
        swagger_ui_parameters=PARAMETERS,
    )
    shortcuts = [
        ("GET · Comandos", "/vehiculos/{id_vehiculo}/comandos", "get"),
        ("POST · Movimiento", "/vehiculos/{id_vehiculo}/movimientos", "post"),
        ("GET · Estado", "/vehiculos/{id_vehiculo}/estado", "get"),
        ("GET · Historial", "/vehiculos/{id_vehiculo}/historial", "get"),
        ("POST · Iniciar DEMO", "/vehiculos/{id_vehiculo}/demos/{id_demo}/iniciar", "post"),
    ]
    def operation_link(title, path, method):
        operation = schema["paths"][path][method]
        tag = quote(operation["tags"][0], safe="")
        operation_id = quote(operation["operationId"], safe="")
        return f'<a href="#/{tag}/{operation_id}" data-tag="{escape(operation["tags"][0], quote=True)}" data-operation="{escape(operation["operationId"], quote=True)}">{escape(title)}</a>'

    guide = GUIDE.replace("__ROOT__", escape(root_path, quote=True))
    guide = guide.replace("__LINKS__", "".join(operation_link(*shortcut) for shortcut in shortcuts))
    tutorial_links = {
        "__CATALOG_LINK__": ("Consulta los comandos", "/vehiculos/{id_vehiculo}/comandos", "get"),
        "__COMMAND_LINK__": ("Crear un comando", "/vehiculos/{id_vehiculo}/comandos", "post"),
        "__DEMO_LINK__": ("Crea una DEMO", "/vehiculos/{id_vehiculo}/demos", "post"),
        "__STEP_LINK__": ("Agrega un paso a la DEMO", "/vehiculos/{id_vehiculo}/demos/{id_demo}/movimientos", "post"),
        "__STEPS_LINK__": ("Consulta los pasos", "/vehiculos/{id_vehiculo}/demos/{id_demo}/movimientos", "get"),
        "__START_LINK__": ("Iniciar DEMO", "/vehiculos/{id_vehiculo}/demos/{id_demo}/iniciar", "post"),
    }
    for placeholder, shortcut in tutorial_links.items():
        guide = guide.replace(placeholder, operation_link(*shortcut))
    content = page.body.decode("utf-8")
    content = content.replace("<html>", '<html lang="es">')
    content = content.replace("</head>", STYLE + "</head>")
    content = content.replace("<body>", "<body>" + guide)
    content = content.replace("</body>", MONITOR_SCRIPT + "</body>")
    return HTMLResponse(content, headers={"Cache-Control": "no-store"})

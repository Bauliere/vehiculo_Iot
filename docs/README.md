# Control IoT · Máquina de carga

Aplicación web para controlar el vehículo y consultar su actividad. CONTROL reúne joystick, palanca de caja, luces, sonido y DEMO. MONITOREO muestra el último estado reportado y los diez movimientos individuales más recientes guardados en RDS.

HTML, CSS, Bootstrap 5 y JavaScript modular con clases. Una conexión WSS compartida recibe eventos; Fetch consulta la API de FastAPI en AWS. El navegador nunca se conecta directamente a MySQL.

[Aplicación](https://bauliere.github.io/vehiculo_Iot/) · [Swagger UI](https://vehiculo-iot.34-225-114-88.sslip.io/docs) · [Guía paso a paso 4.2](guia/MONITOREO_4_2.md)

## Ejecutar en local

Requiere Python 3 y la API de AWS disponible. Desde la raíz del repositorio:

```powershell
cd docs
py assets/servidor_local.py
```

Abre [http://127.0.0.1:5500/](http://127.0.0.1:5500/) y mantén la terminal abierta. Para detener el servidor, pulsa Ctrl+C. En GitHub Pages no necesitas ejecutar Python en tu laptop.

## Configuración y uso

La dirección de la API y el vehículo se configuran en `assets/js/config.js`. El backend debe permitir el origen de la página mediante CORS.

1. Espera a que los indicadores de API, RDS y WSS estén disponibles.
2. La página obtiene automáticamente una sesión temporal de control. No hay un campo de clave. Confirma **DETENER** antes de manejar.
3. Usa el joystick o las flechas del teclado. Al soltar se envía **DETENER**. La palanca sube y baja la caja; la barra inferior contiene luces y sonido.
4. Abre **DEMO** para consultar el recorrido. Mantén pulsado **Iniciar DEMO** hasta que se llene el botón. La DEMO 1 se selecciona al cargar cuando está disponible. **Cancelar** y **DETENER** siguen disponibles durante el recorrido.

Pulsa el icono junto a **CONTROL / IoT** para cambiar entre Bosque, Gris violeta, EVA-01, Rosa claro, Rojo grafito y Plata sobre negro. La paleta se recuerda en el navegador. **Ajustes → Reconectar** recupera el acceso si falló la conexión inicial.

Los títulos, Fausto, el fondo y los paneles usan React Bits. El cursor animado aparece con ratón. El navegador muestra la versión estática si no puede ejecutar los efectos WebGL o si está activada la reducción de movimiento. Para editar y recompilar los componentes, consulta el [README del repositorio](../README.md#efectos-visuales).

Las dos vistas caben en la pantalla. En teléfono horizontal, DETENER y las funciones adicionales están al costado. MONITOREO pagina el historial según el espacio disponible. El botón con la onda abre las confirmaciones de la última acción.

MONITOREO carga estado e historial por REST. Los eventos individuales WSS disparan una consulta del historial confirmado; al reconectar se recuperan ambos datos. Los pasos de DEMO cambian el último estado, pero no se añaden al historial individual.

Si una parada no se confirma, los movimientos quedan bloqueados hasta que se pueda confirmar DETENER. Los eventos WSS confirman la orden del servidor, no el movimiento físico del vehículo.

Los indicadores de luces y sonido representan la alternancia solicitada y observada por WSS durante la sesión; no son sensores físicos. Al entrar se desconoce el estado anterior. DETENER no altera esos indicadores. La animación de DEMO sigue los eventos recibidos y no genera movimientos adicionales.

## Fausto.IA y pantalla completa

El icono de pantalla completa abre CONTROL y oculta la navegación. Pulsa el mismo botón o Esc para volver. Cuando el navegador permite pantalla completa, también oculta su propia barra.

**Fausto.IA** está en la barra de funciones. Escribe una orden o pulsa el micrófono, habla y pulsa de nuevo para enviar. La grabación se corta a los 15 segundos. Revisa la secuencia antes de tocar **Ejecutar**. **Detener** cancela el recorrido en curso.

Prueba con «Avanza 10 segundos y luego gira a la derecha». El servidor interpreta el texto o audio con Gemini Flash-Lite y la ESP recibe los pasos temporizados por el WSS existente. El recorrido cambia el estado reportado y no crea una DEMO guardada. La confirmación corresponde al servidor. Comprueba la actuación del vehículo en el Monitor Serie y físicamente.

Para habilitarlo, actualiza FastAPI en EC2 y configura `GEMINI_API_KEY` en su `.env` privado. `GEMINI_MODEL` permite cambiar el modelo y `FAUSTO_DAILY_LIMIT` fija el máximo de consultas por día UTC mientras corre el proceso. Si reinicias FastAPI, el contador vuelve a empezar. El audio y el texto se envían a Google para su interpretación. [Configurar Gemini](https://aistudio.google.com/apikey) · [Precios y cuota gratuita](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite)

### Actualizar la instancia

1. Copia `Fausto-IA-EC2.zip` a `C:\Users\Administrator\Desktop\websocket_iot` en el escritorio remoto.
2. En PowerShell de la instancia, guarda una copia del código actual, extrae la actualización y comprueba que FastAPI la reconoce.

   ```powershell
   Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
   $respaldoFausto = "respaldo_fausto_$(Get-Date -Format yyyyMMdd_HHmmss)"
   Copy-Item -LiteralPath '.\app' -Destination $respaldoFausto -Recurse -ErrorAction Stop
   Expand-Archive -LiteralPath '.\Fausto-IA-EC2.zip' -DestinationPath '.' -Force -ErrorAction Stop
   .\.venv\Scripts\python.exe -m pip install --no-index '.\certifi-2026.10.23-py3-none-any.whl'
   .\.venv\Scripts\python.exe -c "from app.main import app; print(any('/fausto/interpretar' in r for r in app.openapi()['paths']))"
   ```

3. Si aparece `True`, ejecuta `notepad .env`. Añade `GEMINI_API_KEY=` seguido de la nueva clave de Google AI Studio. Guarda y cierra el editor. Usa una clave de un proyecto que tenga acceso al modelo.
4. Reinicia la tarea de la API y abre Swagger para comprobar que aparece el grupo **Fausto.IA**.

   ```powershell
   Stop-ScheduledTask -TaskName 'VehiculoIoT-API'
   Start-Sleep -Seconds 3
   Start-ScheduledTask -TaskName 'VehiculoIoT-API'
   Start-Sleep -Seconds 3
   Invoke-RestMethod 'http://127.0.0.1:8000/health/rds' -TimeoutSec 15
   ```

5. En CONTROL, envía primero una orden y comprueba los tiempos del plan. Pulsa **Ejecutar** cuando tengas el carrito a la vista. Para una prueba corta, usa «Muévete tantito hacia delante».

## Acceso automático y AWS

La API incorpora `GET /control/sesion`. Cuando el servidor habilita el modo público, emite una sesión de quince minutos limitada a movimientos y DEMO de un vehículo. La página renueva esa sesión cuando corresponde y la mantiene en memoria. Las claves maestras de control y administración permanecen en AWS.

Este modo está desactivado por defecto. Para activarlo en la instancia, instala el paquete de actualización descrito en la guía y añade estas variables a su `.env`:

```dotenv
PUBLIC_CONTROL_ENABLED=true
PUBLIC_CONTROL_VEHICLE_ID=1
```

**Con el modo público activo, cualquier visitante puede controlar el vehículo 1.** No es un inicio de sesión ni una protección de identidad. La administración sigue requiriendo su clave. Para cerrar el acceso público, cambia la primera variable a `false` y reinicia la API; las sesiones emitidas dejan de servir.

Los pasos de copia, reinicio y comprobación están en la [guía 4.2](guia/MONITOREO_4_2.md). No se modifican tablas, procedimientos ni la configuración de Caddy.

## Contratos y código

| Servicio | Ruta | Uso |
|---|---|---|
| Sesión pública | `GET /control/sesion` | Obtener acceso temporal si AWS lo habilita. |
| Último estado | `GET /vehiculos/1/estado` | Carga inicial y recuperación tras reconexión. |
| Historial | `GET /vehiculos/1/historial` | Diez registros individuales persistidos. |
| Eventos | `wss://vehiculo-iot.34-225-114-88.sslip.io/ws/vehiculos/1` | Actualizaciones en vivo. |
| Salud API | `GET /health` | Disponibilidad del servidor. |
| Salud RDS | `GET /health/rds` | Diagnóstico independiente de la base de datos. |

Los GET de consulta no necesitan clave según el contrato actual. El cliente envía la sesión temporal en `X-API-Key` para las órdenes POST; nunca incluye la clave maestra en los archivos públicos.

El backend fija sus sesiones MySQL en UTC. Las fechas de RDS sin sufijo se interpretan como UTC y se muestran en `America/Mexico_City`, indicada en la vista. Los eventos WSS llevan su zona explícita. No se sustituye una fecha ausente por la hora del navegador.

```text
docs/
  index.html
  assets/
    css/          Estilos y paletas
    images/       Icono, favicon y recursos gráficos
    js/
      app.js      Composición de las clases
      config.js   Servidor y vehículo
      components/ Vistas, navegación, joystick y palanca
      controllers/ Control y sincronización de monitoreo
      domain/     Catálogo y validación de datos
      services/   REST, sesión automática, WSS y salud
      state/      Estado de control
      utils/      Errores y validaciones comunes
    vendor/       Bootstrap
    react-bits/   Componentes de efectos y compilación
    servidor_local.py
  tests/          Pruebas automatizadas
  guia/           Instrucciones y comprobaciones
```

Flujo: navegador → HTTPS → API → RDS. En paralelo, una sesión WSS compartida alimenta CONTROL y MONITOREO. El historial siempre se confirma mediante REST; no se construyen registros persistidos a partir de una animación.

## Pruebas

Con Node.js, desde `docs/`:

```powershell
node --test tests/*.test.js
```

Las pruebas automatizadas usan servicios simulados. La [guía 4.2](guia/MONITOREO_4_2.md) incluye las comprobaciones actuales con Postman, la instancia y el teléfono. El recorrido real se valida con los servicios de AWS disponibles.

## Publicación

GitHub Pages publica la carpeta `/docs` de la rama `main`, en el repositorio existente. La [guía 4.2](guia/MONITOREO_4_2.md) incluye los comandos Git y la comprobación del despliegue. El origen público autorizado por CORS es `https://bauliere.github.io`; los locales son `http://127.0.0.1:5500` y `http://localhost:5500`.

## Créditos

**Autor:** Amador Ramírez Jesús Gabriel · 2026

**Profesor:** Víctor Manuel Pinedo Fernández

**Materia:** Soluciones IoT

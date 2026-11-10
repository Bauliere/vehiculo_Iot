# Preparar AWS para la aplicación de control

Esta guía prepara el backend que ya existe. No crea otra base de datos, no cambia los procedimientos ni instala el frontend en EC2.

**Situación al revisar el proyecto, 6 de noviembre de 2026:** el código local de FastAPI no incluía CORS. Las consultas públicas a `/health` y `/health/rds` agotaron el tiempo de espera. Los siguientes pasos deben ejecutarse y comprobarse en tu instancia; no se han aplicado desde esta guía.

## 1. Confirmar los servicios existentes

Enciende el laboratorio, EC2 y RDS. Comprueba que la IP pública de EC2 siga siendo `34.225.114.88`. Si cambió, el dominio que contiene esa IP ya no apunta a la instancia actual; primero actualiza la configuración HTTPS existente y luego `js/config.js` del frontend.

Dentro del escritorio remoto abre PowerShell y consulta:

```powershell
Get-ScheduledTask -TaskName 'VehiculoIoT-API','VehiculoIoT-HTTPS' | Select-Object TaskName,State
```

Si una tarea está detenida, inicia únicamente esa tarea:

```powershell
Start-ScheduledTask -TaskName 'VehiculoIoT-API'
```

```powershell
Start-ScheduledTask -TaskName 'VehiculoIoT-HTTPS'
```

Si ya estaban en ejecución, no necesitas arrancar otra copia de Python. Comprueba:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 10
```

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/rds' -TimeoutSec 10
```

La primera debe indicar `status: ok`. La segunda debe indicar `status: ok` y `database: RDS`. Después abre en el navegador de tu laptop:

- [Salud de la API](https://vehiculo-iot.34-225-114-88.sslip.io/health).
- [Diagnóstico de RDS](https://vehiculo-iot.34-225-114-88.sslip.io/health/rds).
- [Swagger](https://vehiculo-iot.34-225-114-88.sslip.io/docs).

Si localhost funciona pero la URL pública no, revisa la tarea HTTPS, la IP, el certificado y el acceso al puerto 443 de la configuración existente antes de seguir con el frontend.

## 2. Habilitar CORS una sola vez

**Esta configuración sirve para todos los dispositivos y navegadores modernos que abran la página publicada.** CORS autoriza el origen de la página, no una computadora específica. Un teléfono con Safari y una laptop con Chrome enviarán el mismo origen `https://bauliere.github.io` al abrir tu aplicación.

No hace falta permitir `*` para lograrlo. Eso permitiría solicitudes desde páginas de cualquier dominio. Conservamos el dominio de GitHub Pages y las dos direcciones de desarrollo local.

Si pruebas desde el teléfono abriendo una dirección LAN como `http://192.168.1.20:5500`, esa dirección es otro origen y necesitará añadirse explícitamente. Para usar cualquier dispositivo sin este paso, abre la URL pública de GitHub Pages. La API, Internet y la autorización siguen siendo necesarios.

La página se ejecuta en GitHub Pages y consulta otro dominio. El navegador necesita que la API autorice ese origen. CORS no reemplaza la clave de control. [Referencia oficial de FastAPI](https://fastapi.tiangolo.com/tutorial/cors/).

En PowerShell **de la instancia**, crea primero un respaldo del archivo:

```powershell
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
```

```powershell
New-Item -ItemType Directory -Path '.\apoyo\respaldos_cors' -Force
```

```powershell
$fechaCopia = Get-Date -Format 'yyyyMMdd_HHmmss'
```

```powershell
Copy-Item -LiteralPath '.\app\main.py' -Destination ".\apoyo\respaldos_cors\main_$fechaCopia.py"
```

Abre el archivo de la API:

```powershell
notepad .\app\main.py
```

### Cambio A: importar el middleware

Junto a los demás `from fastapi...`, agrega esta línea una sola vez:

```python
from fastapi.middleware.cors import CORSMiddleware
```

### Cambio B: autorizar los orígenes

Busca estas dos líneas dentro de `create_app`:

```python
    application.state.runtime = runtime
    application.include_router(router)
```

Déjalas así, añadiendo el bloque intermedio. Conserva los cuatro espacios al inicio:

```python
    application.state.runtime = runtime
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "https://bauliere.github.io",
            "http://127.0.0.1:5500",
            "http://localhost:5500",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key"],
    )
    application.include_router(router)
```

Guarda el archivo. No pegues ese bloque al final del archivo ni dentro de una ruta. Si ya existe un bloque CORS, ajusta su lista en lugar de agregar un segundo middleware. Los encabezados estándar de aceptación son permitidos por el middleware; las escrituras usan JSON y `X-API-Key`. El preflight OPTIONS lo atiende el propio middleware.

Comprueba la sintaxis antes de reiniciar:

```powershell
.\.venv\Scripts\python.exe -m py_compile .\app\main.py
```

Si no imprime errores, continúa. Si indica un error, corrige la indentación y vuelve a comprobar; todavía no detengas la API.

## 3. Reiniciar solamente la API

Hazlo sin una DEMO en ejecución. En PowerShell como administrador dentro de la instancia:

```powershell
Stop-ScheduledTask -TaskName 'VehiculoIoT-API'
```

Espera unos segundos y consulta:

```powershell
Get-ScheduledTask -TaskName 'VehiculoIoT-API' | Select-Object TaskName,State
```

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
```

Cuando la tarea ya no esté `Running` y no aparezca una escucha en 8000, arráncala:

```powershell
Start-ScheduledTask -TaskName 'VehiculoIoT-API'
```

Si 8000 sigue ocupado, no lances otro Python. Puede quedar una ejecución manual abierta: detén esa terminal con Ctrl+C o identifica el proceso antes de continuar. No cierres procesos de Python a ciegas.

Espera unos segundos y repite las dos consultas de salud del paso 1. Si falla el arranque, consulta:

```powershell
Get-Content -LiteralPath '.\logs\api.log' -Tail 30
```

Caddy sigue usando el mismo dominio y puerto; no necesita cambios por agregar CORS.

## 4. Comprobar CORS sin ejecutar movimientos

Desde PowerShell de tu laptop o de la instancia, usa este preflight. No lleva clave ni envía una orden:

```powershell
$cabecerasCors = @{
    Origin = 'https://bauliere.github.io'
    'Access-Control-Request-Method' = 'POST'
    'Access-Control-Request-Headers' = 'content-type,x-api-key'
}
```

```powershell
$respuestaCors = Invoke-WebRequest -UseBasicParsing -Method Options -Uri 'https://vehiculo-iot.34-225-114-88.sslip.io/vehiculos/1/movimientos' -Headers $cabecerasCors -TimeoutSec 10
```

```powershell
$respuestaCors.StatusCode
```

```powershell
$respuestaCors.Headers['Access-Control-Allow-Origin']
```

Esperado: `200` y `https://bauliere.github.io`. Si responde 405, es probable que la instancia todavía ejecute el código anterior sin CORS. Si devuelve 400, revisa que origen, método y encabezados coincidan. No uses `*` para evitar revisar la lista.

Para la prueba local, repite cambiando solamente `Origin` a `http://127.0.0.1:5500` y usa esa misma dirección al abrir la página.

## 5. Conseguir la clave correcta para la interfaz

En el escritorio remoto abre el archivo privado existente:

```powershell
notepad 'C:\Users\Administrator\Desktop\websocket_iot\.env'
```

Localiza `API_CONTROL_KEY`. Copia solamente su valor en **Acceso de control → Activar control** del frontend. No copies la línea completa, no lo pongas en Git y no lo incluyas en las capturas. La clave de administrador permite operaciones más amplias y no es necesaria aquí.

El backend existente exige dos claves distintas de al menos 32 caracteres, `API_CONTROL_KEY` y `API_ADMIN_KEY`. Si no están bien configuradas responde 503. La página no crea credenciales ni usuarios: reutiliza esta autorización existente.

La clave se envía en `X-API-Key` solo para POST. No se guarda en `localStorage`, `sessionStorage`, archivos ni URL. Recargar la página exige introducirla otra vez. Esto es una sesión local del frontend, no un sistema nuevo de inicio de sesión.

## 6. Mantener ambas copias coherentes

Si aplicas el ajuste manual en AWS, conserva el mismo cambio en `C:\Users\yolop\Desktop\APInedo\websocket_iot\app\main.py` de tu laptop antes de volver a desplegar la API en otra ocasión. No reemplaces el archivo entero con una versión antigua: agrega únicamente el import y el bloque CORS.

Esta modificación pertenece al proyecto de la API. No subas su `.env`, certificados o respaldos al carpeta pública `docs`.



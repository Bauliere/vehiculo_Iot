# Despliegue de la actividad 4.3

## Usar la instalación actual

La API 4.3 ya está desplegada en EC2 y las migraciones 001 y 002 están aplicadas en RDS. Para un cambio de HTML o CSS, publica `docs/` en `main`. La autenticación de la ESP se actualiza desde la laptop en Arduino IDE.

1. En la consola de AWS, comprueba que EC2 esté **En ejecución** y RDS **Disponible**. Abre el [diagnóstico de RDS](https://vehiculo-iot.34-225-114-88.sslip.io/health/rds) y la [configuración de la plataforma](https://vehiculo-iot.34-225-114-88.sslip.io/plataforma/config). Deben responder `status: ok`, `database: RDS` y `activa: true`, respectivamente.
2. Conecta la ESP por USB y abre `C:\Users\yolop\Desktop\MAQUINA_CARGA_WSS_4_3\MAQUINA_CARGA_WSS_4_3.ino` en Arduino IDE. Selecciona **NodeMCU 1.0 (ESP-12E Module)**, **160 MHz** y el COM de la placa. Pulsa **Subir**. En el Monitor Serie a **115200**, confirma `Firmware 4.3.0`, `WIFI=OK`, `WSS=OK` y `VEHICULO=1`.
3. En [CONTROL IoT](https://bauliere.github.io/vehiculo_Iot/), inicia sesión con el comprador asignado a **MC-001**. La cuenta de prueba está en `%LOCALAPPDATA%\VehiculoIoT\4.3\cuenta-comprador.txt` en la laptop. El panel debe abrir el canal WSS de la unidad 1. Para controlarla con la cuenta de Administración, el comprador puede autorizar soporte temporal desde **Mis vehículos**.

**WSS · Sin unidad** indica que todavía falta iniciar sesión, seleccionar una unidad autorizada o recibir una asignación. **Sin verificar** indica que la web aún no pudo comprobar el acceso con la API. **WSS · En línea** confirma el canal del navegador. Para mover el carrito, espera a que Control indique que el dispositivo está conectado y prueba primero con las ruedas elevadas, en una zona despejada.

Si EC2 está en ejecución y la URL pública falla, ejecuta en el escritorio remoto:

```powershell
Get-ScheduledTask -TaskName 'VehiculoIoT-API','VehiculoIoT-HTTPS' | Select-Object TaskName,State
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/rds' -TimeoutSec 15
```

Si la consulta local funciona, comprueba la IP pública de la instancia y la tarea de Caddy. Si la API local falla, revisa `Get-ScheduledTaskInfo -TaskName 'VehiculoIoT-API'` y `Get-Content -LiteralPath 'C:\Users\Administrator\Desktop\websocket_iot\logs\api.log' -Tail 30`.

## Actualizar EC2 para exhibir MC-001 con comprador asignado

Copia `Actualizacion-Control-Invitados-EC2.zip` al Escritorio remoto, dentro de `C:\Users\Administrator\Desktop\websocket_iot`. El paquete incluye las reservas de 15 minutos y la recuperación del mando. En PowerShell del escritorio remoto:

```powershell
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
$ErrorActionPreference = 'Stop'
$paqueteInvitados = Get-Item -LiteralPath '.\Actualizacion-Control-Invitados-EC2.zip'
$marcaInvitados = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$respaldoInvitados = New-Item -ItemType Directory -Path ".\respaldo-invitados-$marcaInvitados"
$temporalInvitados = Join-Path $env:TEMP "vehiculo-invitados-$marcaInvitados"
Expand-Archive -LiteralPath $paqueteInvitados.FullName -DestinationPath $temporalInvitados
$archivosInvitados = 'app\config.py','app\api\commercial.py','app\services\commercial_service.py','app\services\exhibition_store.py'
foreach ($rutaInvitados in $archivosInvitados) {
    $origenInvitados = Join-Path $temporalInvitados $rutaInvitados
    Get-Item -LiteralPath $origenInvitados | Out-Null
    $copiaInvitados = Join-Path $respaldoInvitados.FullName $rutaInvitados
    New-Item -ItemType Directory -Path (Split-Path -Parent $copiaInvitados) -Force | Out-Null
    Copy-Item -LiteralPath $rutaInvitados -Destination $copiaInvitados
}
Copy-Item -LiteralPath '.env' -Destination (Join-Path $respaldoInvitados.FullName '.env')
foreach ($rutaInvitados in $archivosInvitados) {
    Copy-Item -LiteralPath (Join-Path $temporalInvitados $rutaInvitados) -Destination $rutaInvitados -Force
}
notepad .env
```

En `.env` busca cada variable y ajusta su valor. Si `EXHIBITION_ASSIGNED_UNIT_IDS` no existe, agrégala. Guarda y cierra el Bloc de notas.

```dotenv
EXHIBITION_ENABLED=true
EXHIBITION_ASSIGNED_UNIT_IDS=1
PUBLIC_CONTROL_ENABLED=false
```

Confirma que Python cargue la configuración y reinicia la API en la misma terminal.

```powershell
$configInvitados = & .\.venv\Scripts\python.exe -c 'from app.main import app; from app.services.exhibition_store import SESSION_SECONDS; s=app.state.runtime.settings; print(s.exhibition_enabled, s.exhibition_assigned_unit_ids, SESSION_SECONDS, s.public_control_enabled, ''/plataforma/unidades/{vehicle_id}/recuperar-control'' in app.openapi()[''paths''])'
if ($LASTEXITCODE -ne 0 -or $configInvitados -ne 'True 1 900 False True') { throw 'Revisa .env y la ruta de recuperación antes de reiniciar la API.' }
$configInvitados
Stop-ScheduledTask -TaskName 'VehiculoIoT-API'
for ($intentoInvitados = 0; $intentoInvitados -lt 10; $intentoInvitados++) {
    if ((Get-ScheduledTask -TaskName 'VehiculoIoT-API').State -ne 'Running') { break }
    Start-Sleep -Seconds 1
}
if ((Get-ScheduledTask -TaskName 'VehiculoIoT-API').State -eq 'Running') { throw 'La tarea todavía se está deteniendo.' }
Start-ScheduledTask -TaskName 'VehiculoIoT-API'
$saludInvitados = $null
for ($intentoInvitados = 0; $intentoInvitados -lt 15; $intentoInvitados++) {
    try {
        $saludInvitados = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/rds' -TimeoutSec 3
        if ($saludInvitados.status -eq 'ok' -and $saludInvitados.database -eq 'RDS') { break }
    } catch { Start-Sleep -Seconds 2 }
}
if ($saludInvitados.status -ne 'ok' -or $saludInvitados.database -ne 'RDS') { throw 'Revisa los últimos mensajes de logs\api.log.' }
$saludInvitados
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/plataforma/catalogo' -TimeoutSec 10 | ConvertTo-Json -Depth 5
```

La comprobación de Python debe mostrar `True 1 900 False True`. Si necesitas permitir otras unidades asignadas, separa sus IDs con comas y reinicia la tarea.

## Probar como invitado

1. En **Administración → Unidades**, verifica que MC-001 tenga asignado el comprador. Si quedó en **Exhibición** de una prueba anterior, pásala a **Disponible** y vuelve a asignarla. Asegúrate de que el modelo tiene capacidades de dirección habilitadas para exhibición.
2. Con la ESP conectada y el carrito supervisado, abre **Catálogo → Reservar prueba** en una ventana privada. El turno dura hasta 15 minutos. Si el comprador tiene el mando, libera el control cerrando esa pestaña o sesión antes de iniciar la reserva.
3. Como invitado, mantén presionado **Terminar sesión ahora** hasta que se complete la barra. Como comprador, abre **Mis vehículos → Controlar** y mantén presionado **Recuperar mando**. Esta segunda opción cierra la sesión del invitado y entrega el mando a esa pestaña del comprador.

## Reinstalación o cambio de base

Usa las fases siguientes al desplegar la 4.3 en una instalación que todavía use el esquema anterior.

## Para quien continúe este proyecto

Lee esta sección antes de dar comandos. La confusión anterior vino de mezclar tres despliegues distintos:

- **Fausto** fue una actualización pequeña: dos archivos Python se copiaban sobre la instalación existente.
- **La actividad 4.3** agrega código de backend, dos migraciones SQL y una interfaz de Administración. Requiere actualizar EC2, cambiar el esquema de RDS/Aurora y después publicar la web.
- **GitHub y EC2 tienen funciones distintas**: los cambios se suben a GitHub desde la laptop. EC2 no tiene Git y no debe recibir instrucciones de `git clone` o `git push`.

En el despliegue se usan dos elementos distintos.

1. El **ZIP del repositorio** lleva el código fuente de una versión de GitHub a EC2. No incluye los datos de RDS.
2. El **snapshot de RDS/Aurora** es una copia de la base de datos. No contiene el código de la aplicación.

**Primero ensaya 001 y 002 en una copia de prueba. Antes de modificar la base activa, confirma su respaldo.** Los puntos 2.1, 2.4, 3.4 y 3.5 de la actividad admiten un ambiente de prueba aislado. Se puede usar MySQL local con una copia representativa o restaurar un snapshot en AWS. El actualizador de EC2 usa el `.env` de la API activa y pide el identificador de su snapshot.

No instales Git en EC2 para esta tarea. Descarga el ZIP del commit aprobado, extráelo en una carpeta temporal y ejecuta desde allí el script. No ejecutes el actualizador de producción hasta completar la prueba aislada y revisar el snapshot correcto.

## Estado confirmado

Última revisión: **19 de noviembre de 2026**.

| Elemento | Estado |
| --- | --- |
| Rama de trabajo | `codex/actividad-4-3` |
| Commit publicado en esa rama | `0c4071139bf9a03f8750862375d3ded301c1ffea` |
| Rama `main` | Contiene la 4.3 y abre en Control |
| ZIP del código | Se puede descargar desde el enlace de commit indicado abajo |
| Git en EC2 | No instalado; el despliegue debe funcionar sin Git |
| Ensayo local MySQL | Migraciones y reversión comprobadas sobre un esquema desechable |
| Base productiva | Migraciones 001 y 002 aplicadas. Unidad 1 asignada al comprador de prueba |
| Publicación de la interfaz 4.3 en Pages | Activa. Los cambios posteriores se publican al actualizar `main` |
| Prueba física con la ESP actualizada | Pendiente |

La API está instalada en `C:\Users\Administrator\Desktop\websocket_iot`. Su tarea es `VehiculoIoT-API`; los logs están en `C:\Users\Administrator\Desktop\websocket_iot\logs\api.log`. La tarea `VehiculoIoT-HTTPS`/Caddy proporciona HTTPS y WSS. No reemplaces `.env`, certificados, entorno virtual ni configuración de Caddy por archivos del ZIP.

## Fase 1 · Publicar el código de la rama

Hazlo en PowerShell **de la laptop**, desde la copia del repositorio que vas a usar:

```powershell
Set-Location 'C:\Users\yolop\Documents\ChatGPT\Carrito IOT\vehiculo_iot'
git status --short --branch
git push origin codex/actividad-4-3
```

El push es necesario solo si hiciste cambios nuevos. La rama ya estaba publicada en el commit indicado arriba al revisar esta guía. No subas secretos ni `.env`.

## Fase 2 · Ensayar las migraciones en una copia

Consulta la evidencia del ensayo local en [Actividad 4.3](ACTIVIDAD_4_3.md#respaldo-entorno-de-prueba-y-transición). Allí se documentaron las dos migraciones con una copia del esquema y datos de prueba. Para el punto 3.4, comprueba que la evidencia cubra filas e IDs anteriores, relaciones, secuencias de DEMO y lectura del historial por la API. Completa las comprobaciones que falten en un entorno aislado.

Si quieres repetir el ensayo con los datos reales y el motor del laboratorio, abre **Aurora and RDS → Databases**, identifica el recurso por el endpoint de EC2 y busca una copia disponible. Si ya existe una copia apropiada, reutilízala. Para crearla, toma un snapshot del origen y, cuando esté `Available`, usa **Snapshots → Actions → Restore snapshot**. Identifica el nuevo recurso como `iot43-ensayo`, en la VPC de EC2, con acceso privado y el grupo de seguridad que permite MySQL desde EC2. Esta opción usa recursos del laboratorio. Anota el endpoint de escritura y el puerto de la copia, además del identificador del snapshot usado.

`tools/migrar_4_3.py` admite un `.env` y un destino explícitos, pero `tools/actualizar_ec2_4_3.ps1` no: este último lee el `.env` productivo. Para la prueba se necesita preparar un `.env` separado que apunte únicamente a la copia y ejecutar primero la acción `verificar`, luego aplicar allí las migraciones y volver a verificar. No copies el `.env` de prueba sobre el productivo. Si no están claros el endpoint y los permisos del usuario SQL de prueba, detente antes de ejecutar DDL.

Compara los conteos e IDs antes y después y confirma que los 21 procedimientos sigan presentes. Para ensayar la reversión estructural, usa el esquema desechable `iot43_stage` con las migraciones aplicadas y antes de crear datos comerciales. Ejecuta primero `002_plataforma_comercial.down.sql` y después `001_modelos_unidades.down.sql`. Para recuperar producción, utiliza un snapshot verificado.

## Fase 3 · Preparar el ZIP de código en EC2

Solo descarga el paquete cuando se vaya a hacer el ensayo o, después de aprobarlo, el despliegue. Esta descarga **no instala nada ni cambia la API o la base**. En PowerShell elevado dentro de Escritorio remoto:

```powershell
$commit43 = '0c4071139bf9a03f8750862375d3ded301c1ffea'
$carpeta43 = Join-Path $env:TEMP "vehiculo-iot-4-3-$commit43"
$zip43 = "$carpeta43.zip"
New-Item -ItemType Directory -Path $carpeta43 -Force | Out-Null
Invoke-WebRequest -Uri "https://github.com/Bauliere/vehiculo_Iot/archive/$commit43.zip" -OutFile $zip43
Expand-Archive -LiteralPath $zip43 -DestinationPath $carpeta43 -Force
$script43 = Get-ChildItem -LiteralPath $carpeta43 -Filter 'actualizar_ec2_4_3.ps1' -File -Recurse | Select-Object -First 1
if (-not $script43) { throw 'El ZIP no contiene el actualizador esperado.' }
$raiz43 = Split-Path -Parent (Split-Path -Parent $script43.FullName)
Write-Host "Código extraído en: $raiz43"
```

Este es el ZIP del **código**, fijado a un commit; no es el snapshot de la base. El ZIP del código puede extraerse antes, pero no ejecutes `$script43.FullName` hasta terminar el ensayo: ese script pausa la API y aplica migraciones a la base productiva configurada en EC2.

## Fase 4 · Desplegar el backend y migrar producción

Ejecuta esta fase cuando estén documentados los resultados del ensayo. El paquete de backend del commit `0c40711` también está preparado en la laptop, en `C:\Users\yolop\Desktop\Actividad-4.3-EC2-0c40711.zip`. Si usas ese ZIP, extráelo en una carpeta temporal aparte y localiza `tools\actualizar_ec2_4_3.ps1` dentro de ella. El actualizador pausa la API y te pide un snapshot. En ese momento toma o identifica el respaldo del recurso activo, comprueba en AWS que corresponda a esa base y región y espera a que esté `Available` antes de introducir su nombre. Usa snapshot de clúster para Aurora o de instancia para RDS MySQL de instancia.

El actualizador existente hace respaldo de archivos, pausa `VehiculoIoT-API`, ejecuta ambas migraciones en la base productiva, copia el backend y reanuda la tarea. **El parámetro de snapshot se guarda como evidencia, pero el script no consulta AWS para comprobar que el snapshot exista, esté `Available` o pertenezca al endpoint correcto**. La persona que lo ejecuta debe comprobarlo en la consola antes de continuar.

Solo después de esas comprobaciones, en la misma sesión elevada de EC2, el comando para iniciar el script es:

```powershell
& $script43.FullName
```

Cuando termine, se espera que la API local informe `status=ok`, `database=RDS` y que `/plataforma/config` indique `activa=true`. Si cualquiera falla, no publiques Pages ni pruebes el carrito; guarda la ruta del respaldo que mostró el script y el log de `logs\api.log`.

## Fase 5 · Crear la cuenta y publicar Pages

Una vez que el backend desplegado haya pasado su diagnóstico, en EC2 crea la cuenta administradora una sola vez. La contraseña se solicita de forma interactiva; no la pongas en el comando ni la guardes en Git.

```powershell
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
.\.venv\Scripts\python.exe -m tools.cuentas_4_3 crear-admin --nombre 'Administración IoT' --correo (Read-Host 'Correo de administración')
```

Desde la laptop, abre el PR de la rama hacia `main`, revisa los archivos y la comprobación automática de Pages, e intégralo:

[Abrir PR de `codex/actividad-4-3` hacia `main`](https://github.com/Bauliere/vehiculo_Iot/compare/main...codex/actividad-4-3?expand=1)

La web se publica desde `main` en `docs/`. Tras la integración espera el despliegue de GitHub Pages, abre [CONTROL IoT](https://bauliere.github.io/vehiculo_Iot/) y recarga con `Ctrl+F5`. Subir la rama no publica Pages por sí solo.

## Fase 6 · ESP y control físico

La ESP se autentica por WSS con `X-Device-Key`. El [firmware](../../firmware/MAQUINA_CARGA_WSS/) está preparado para cargar la credencial y la clave del portal desde `iot43_secrets.h`. En una instalación nueva, genera la credencial del ID físico correcto con `tools.cuentas_4_3 credencial-dispositivo` y crea ese archivo desde `iot43_secrets.example.h`. Para MC-001 usa el sketch privado de la laptop, que ya tiene una credencial registrada.

## Privilegios de MySQL

Aplica las migraciones y emite credenciales de dispositivo con una cuenta de mantenimiento. Para FastAPI, [`permisos_api.sql`](../../migrations/4_3/permisos_api.sql) define un rol con ejecución de los procedimientos y acceso a las tablas que usa la plataforma. Asigna ese rol como predeterminado a un usuario dedicado con `REQUIRE SSL`, restringido a EC2, y guarda ese usuario en `DB_USER` y `DB_PASSWORD` del `.env` de EC2. Al cambiar la cuenta, reinicia `VehiculoIoT-API` y comprueba `/health/rds`, el inicio de sesión y la lectura del historial antes de operar.

## Qué no hacer

- No uses `git clone` ni `git push` en EC2; Git no está instalado allí.
- No confundas el ZIP de GitHub con el snapshot de RDS/Aurora.
- Confirma el respaldo y los resultados del ensayo aislado antes de aplicar 001/002 en producción.
- No ejecutes `tools/actualizar_ec2_4_3.ps1` durante el ensayo: usa el `.env` productivo de EC2.
- No integres el PR de Pages antes de que el backend y la base hayan sido comprobados como compatibles.
- No sustituyas `.env`, certificados, credenciales o archivos de datos con contenido descargado del repositorio.

## Referencias

- ZIP de código del commit aprobado: [0c4071139bf9a03f8750862375d3ded301c1ffea](https://github.com/Bauliere/vehiculo_Iot/archive/0c4071139bf9a03f8750862375d3ded301c1ffea.zip)
- Guía de la actividad y estado de pruebas: [ACTIVIDAD_4_3.md](ACTIVIDAD_4_3.md)
- Script de despliegue productivo: `tools/actualizar_ec2_4_3.ps1`
- Herramienta de migración: `tools/migrar_4_3.py`
- Migraciones: `migrations/4_3/001_modelos_unidades.*.sql` y `002_plataforma_comercial.*.sql`
- Consola RDS: [AWS RDS](https://console.aws.amazon.com/rds/)

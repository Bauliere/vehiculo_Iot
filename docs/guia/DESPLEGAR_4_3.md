# Actualizar a la actividad 4.3

La actualización de Fausto sustituía dos archivos Python. La 4.3 también aplica las migraciones 001 y 002 en RDS. Por eso conserva dos respaldos antes del cambio, los archivos de EC2 y el snapshot de la base. El resto del despliegue reutiliza el Python, la tarea programada y Caddy que ya están instalados.

## 1. Laptop · Subir la rama a GitHub

En PowerShell de tu laptop, con el laboratorio y RDS activos:

```powershell
Set-Location 'C:\Users\yolop\Documents\ChatGPT\Carrito IOT\vehiculo_iot'
git push origin codex/actividad-4-3
```

## 2. EC2 · Actualizar el backend

Deja el vehículo detenido. En **PowerShell como administrador dentro de Escritorio remoto**, pega este bloque. Usa Git para traer los archivos a la carpeta temporal de EC2.

```powershell
$descarga43 = Join-Path $env:TEMP ('vehiculo-iot-4-3-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
git clone --depth 1 --branch codex/actividad-4-3 https://github.com/Bauliere/vehiculo_Iot.git $descarga43
if ($LASTEXITCODE -ne 0) { throw 'Comprueba el push de la laptop y el acceso de EC2 a GitHub.' }

powershell.exe -NoProfile -File (Join-Path $descarga43 'tools\actualizar_ec2_4_3.ps1')
```

Si falta Git en la instancia, instala [Git for Windows](https://gitforwindows.org/) y vuelve a abrir PowerShell.

### Respaldo y verificación SQL

El bloque imprime la carpeta privada de respaldo en `C:\ProgramData\VehiculoIoT\4.3` y pausa la tarea `VehiculoIoT-API`. **Cuando te pida el snapshot**, abre [RDS](https://console.aws.amazon.com/rds/) en el navegador de tu laptop. En **Snapshots → Take snapshot** elige el recurso que corresponde al endpoint que imprimió el bloque y dale un nombre, por ejemplo `vehiculo-iot-antes-43`. Si RDS agrupa la base en un clúster, elige el tipo **DB cluster**. Cuando el snapshot muestre **Available**, pega su ID en la consola de EC2. [Snapshot de instancia RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateSnapshot.html) · [Snapshot de clúster](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_CreateSnapshotCluster.html).

Al continuar, el bloque aplica las migraciones pendientes, comprueba las filas históricas y reinicia la API con la plataforma comercial activa y la exhibición pausada. Conserva `snapshot-rds.txt` y los JSON de `sql` dentro del respaldo. La salida final debe mostrar `status=ok`, `database=RDS` y `activa=true`. Si cancelas con Enter en el aviso del snapshot, se reanuda la API anterior.

En la misma **EC2**, crea tu cuenta de Administración una sola vez. La herramienta pide la contraseña de forma interactiva.

```powershell
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
.\.venv\Scripts\python.exe -m tools.cuentas_4_3 crear-admin --nombre 'Administración IoT' --correo (Read-Host 'Tu correo de administrador')
```

## 3. Laptop · Publicar la web

Cuando la API esté activa y tengas tu cuenta, abre el PR en tu laptop. Revisa el cambio e intégralo en `main`. Cuando termine GitHub Pages, recarga la página con **Ctrl+F5** y entra en **Administración**.

```powershell
Start-Process 'https://github.com/Bauliere/vehiculo_Iot/compare/main...codex/actividad-4-3?expand=1'
```

[Abrir Vehículo IoT en GitHub Pages](https://bauliere.github.io/vehiculo_Iot/).

## Cuando vayas a usar el carrito

En **Administración → Unidades**, clasifica la unidad existente con el modelo y el número de serie reales para conservar su ID e historial. Después, desde **EC2**, genera la credencial del mismo ID.

```powershell
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
$idUnidad43 = Read-Host 'ID de la unidad física'
.\.venv\Scripts\python.exe -m tools.cuentas_4_3 credencial-dispositivo $idUnidad43
```

En Arduino IDE, en tu **laptop**, guarda la credencial de forma privada y ajusta `RUTA_WSS` al ID. Llama a `setExtraHeaders` después de `beginSslWithCA` en el sketch, conservando la configuración TLS que ya usa. Carga el sketch y verifica `WSS=OK` y el estado inicial antes de probar movimiento.

```cpp
// En la configuración privada.
constexpr char CABECERA_DISPOSITIVO[] = "X-Device-Key: COPIAR_CREDENCIAL_PRIVADA";

// Inmediatamente después de beginSslWithCA().
clienteWss.setExtraHeaders(CABECERA_DISPOSITIVO);
```

## Si necesitas revisar o recuperar

Diagnóstico desde **EC2**.

```powershell
Get-ScheduledTaskInfo -TaskName 'VehiculoIoT-API'
Get-Content -LiteralPath 'C:\Users\Administrator\Desktop\websocket_iot\logs\api.log' -Tail 30
```

Si el fallo ocurrió con la API pausada después de iniciar la migración, conserva el respaldo y el RDS que recibió los cambios. Para volver al backend anterior, en la **laptop** restaura el snapshot en un RDS nuevo desde **Snapshots → Actions → Restore snapshot**, con conectividad privada desde EC2. Espera **Available** y copia el endpoint del recurso restaurado. [Restaurar instancia RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_RestoreFromSnapshot.html) · [Restaurar Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-restore-snapshot.html).

<details>
<summary>Comandos de recuperación en EC2, después de restaurar RDS</summary>

Pega el bloque en **EC2 como administrador**. En el editor, cambia `DB_HOST` al endpoint restaurado y `DB_PORT` si cambió. Conserva el esquema y el certificado. Los directorios `app.pre43-...` y `4_3.pre43-...` que dejó la actualización conservan los archivos anteriores.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
$pythonVuelta43 = (Resolve-Path -LiteralPath '.\.venv\Scripts\python.exe').Path
$respaldo43 = (Resolve-Path -LiteralPath (Read-Host 'Ruta de respaldo que imprimió la actualización')).Path
if (-not (Test-Path -LiteralPath (Join-Path $respaldo43 'app\main.py'))) { throw 'Falta el respaldo de app.' }
$envVuelta43 = Join-Path $respaldo43 '.env.recuperacion'
Copy-Item -LiteralPath (Join-Path $respaldo43 '.env') -Destination $envVuelta43 -Force
Start-Process notepad.exe -ArgumentList ('"{0}"' -f $envVuelta43) -Wait

$hostVuelta43 = (Read-Host 'Endpoint exacto del RDS restaurado').Trim()
Push-Location -LiteralPath $respaldo43
try {
    $hostGuardado43 = & $pythonVuelta43 -B -c 'import sys; from app.config import Settings; print(Settings(_env_file=sys.argv[1]).db_host)' $envVuelta43
    if ($LASTEXITCODE -ne 0) { throw 'Comprueba el .env de recuperación.' }
} finally {
    Pop-Location
}
if (-not $hostVuelta43 -or $hostGuardado43 -ne $hostVuelta43) {
    throw 'Guarda el endpoint restaurado en DB_HOST antes de recuperar.'
}

$tarea43 = 'VehiculoIoT-API'
$configTarea43 = Get-ScheduledTask -TaskName $tarea43
$sid43 = $configTarea43.Principal.UserId
if ($sid43 -notmatch '^S-\d-') {
    $sid43 = [System.Security.Principal.NTAccount]::new($sid43).Translate([System.Security.Principal.SecurityIdentifier]).Value
}
Disable-ScheduledTask -TaskName $tarea43 | Out-Null
if ($configTarea43.State -eq 'Running') { Stop-ScheduledTask -TaskName $tarea43 }
Start-Sleep -Seconds 3
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { throw 'El puerto 8000 sigue en uso.' }

$fecha43 = Get-Date -Format 'yyyyMMdd-HHmmss'
if (Test-Path -LiteralPath '.\app') { Rename-Item -LiteralPath '.\app' -NewName "app.fallo43-$fecha43" }
Copy-Item -LiteralPath (Join-Path $respaldo43 'app') -Destination '.\app' -Recurse
Copy-Item -LiteralPath $envVuelta43 -Destination '.\.env' -Force
icacls.exe '.\app' /grant "*$($sid43):(OI)(CI)(RX)" /T /Q
if ($LASTEXITCODE -ne 0) { throw 'Comprueba los permisos de app.' }
icacls.exe '.\.env' /grant "*$($sid43):(R)" /Q
if ($LASTEXITCODE -ne 0) { throw 'Comprueba los permisos del .env.' }
Enable-ScheduledTask -TaskName $tarea43 | Out-Null
Start-ScheduledTask -TaskName $tarea43
Start-Sleep -Seconds 5
Invoke-RestMethod 'http://127.0.0.1:8000/health/rds' -TimeoutSec 15
```

Si ya publicaste Pages con 4.3, revierte su PR en GitHub para volver a publicar la web anterior.

</details>

El ensayo en una copia de RDS, la AMI de EC2 y la configuración de un dominio nuevo se consultan cuando corresponda. [Guía detallada de 4.3](https://github.com/Bauliere/vehiculo_Iot/blob/c446b60c4bd6a68fe98e300458decf3cb64e7105/docs/guia/DESPLEGAR_4_3.md).

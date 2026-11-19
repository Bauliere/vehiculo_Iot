#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$UsuarioMigracion)

$ErrorActionPreference = 'Stop'
$instalacion = (Resolve-Path -LiteralPath 'C:\Users\Administrator\Desktop\websocket_iot').Path
$checkout = Split-Path -Parent $PSScriptRoot
$python = Join-Path $instalacion '.venv\Scripts\python.exe'
$envActual = Join-Path $instalacion '.env'
$nombreTarea = 'VehiculoIoT-API'
$urlLocal = 'http://127.0.0.1:8000'
$archivos = @('app', 'migrations\4_3', 'tools\migrar_4_3.py', 'tools\cuentas_4_3.py')

function Invoke-IotPython {
    & $python -B @args
    if ($LASTEXITCODE -ne 0) { throw "El comando de Python fallo ($LASTEXITCODE)." }
}

$tarea = Get-ScheduledTask -TaskName $nombreTarea
if ($tarea.State -ne 'Running' -or -not ($tarea.Actions | Where-Object {
    $_.WorkingDirectory -eq $instalacion -or $_.Arguments -like "*$instalacion\despliegue\iniciar_api.cmd*"
})) {
    throw "Verifica que $nombreTarea este activa y ejecute $instalacion."
}
if ((Invoke-RestMethod "$urlLocal/health/rds" -TimeoutSec 15).status -ne 'ok') {
    throw 'Comprueba primero la conexion RDS de la API actual.'
}
foreach ($ruta in @($python, $envActual) + ($archivos | ForEach-Object { Join-Path $checkout $_ })) {
    if (-not (Test-Path -LiteralPath $ruta)) { throw "Falta $ruta." }
}

$marca = Get-Date -Format 'yyyyMMdd-HHmmss'
$respaldo = Join-Path 'C:\ProgramData\VehiculoIoT\4.3' "respaldo-$marca"
New-Item -ItemType Directory -Path $respaldo | Out-Null
icacls.exe $respaldo /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron proteger los respaldos.' }
foreach ($ruta in $archivos + @('.env')) {
    $original = Join-Path $instalacion $ruta
    if (Test-Path -LiteralPath $original) {
        $destino = Split-Path -Parent (Join-Path $respaldo $ruta)
        New-Item -ItemType Directory -Path $destino -Force | Out-Null
        Copy-Item -LiteralPath $original -Destination $destino -Recurse -Force
    }
}
Write-Host "Respaldo EC2: $respaldo"

$usuarioTarea = $tarea.Principal.UserId
$sid = $usuarioTarea
if ($usuarioTarea -notmatch '^S-\d-') {
    $sid = [System.Security.Principal.NTAccount]::new($usuarioTarea).Translate([System.Security.Principal.SecurityIdentifier]).Value
}
$envNuevo = Join-Path $respaldo '.env.preparado'
Copy-Item -LiteralPath $envActual -Destination $envNuevo
$pausada = $false
$inicioMigracion = $false
Push-Location -LiteralPath $checkout
try {
    Invoke-IotPython -c 'import app.main'
    $db = Invoke-IotPython -c 'import json,sys; from app.config import Settings; s=Settings(_env_file=sys.argv[1]); print(json.dumps(dict(host=s.db_host, puerto=s.db_port, base=s.db_name)))' $envActual | ConvertFrom-Json
    $argumentos = @('--env', $envActual, '--host', $db.host, '--puerto', "$($db.puerto)", '--base', $db.base,
        '--evidencia', (Join-Path $respaldo 'sql'))
    if ($UsuarioMigracion) { $argumentos += @('--usuario', $UsuarioMigracion) }
    Invoke-IotPython -m tools.migrar_4_3 verificar @argumentos

    foreach ($variable in @('COMMERCIAL_ENABLED=true', 'EXHIBITION_ENABLED=false', 'PUBLIC_CONTROL_ENABLED=false')) {
        $clave, $valor = $variable.Split('=', 2)
        Invoke-IotPython -c 'import sys; from dotenv import set_key; set_key(*sys.argv[1:])' $envNuevo $clave $valor
    }
    Invoke-IotPython -c 'import sys; from app.config import Settings; s=Settings(_env_file=sys.argv[1]); assert s.commercial_enabled and not s.exhibition_enabled and not s.public_control_enabled' $envNuevo

    Disable-ScheduledTask -TaskName $nombreTarea | Out-Null
    $pausada = $true
    Stop-ScheduledTask -TaskName $nombreTarea
    $limite = (Get-Date).AddSeconds(20)
    while (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
        if ((Get-Date) -ge $limite) { throw 'El puerto 8000 sigue en uso.' }
        Start-Sleep -Seconds 1
    }

    Write-Host "API pausada. En AWS RDS toma un snapshot del recurso que corresponde a $($db.host)."
    $snapshot = (Read-Host 'Pega el ID del snapshot cuando este Available, o pulsa Enter para cancelar').Trim()
    if (-not $snapshot) { throw 'Corte cancelado. Se reanudara la API anterior.' }
    if ($snapshot -notmatch '^[A-Za-z][A-Za-z0-9-]{0,254}$') { throw 'Escribe el nombre del snapshot de RDS.' }
    Set-Content -LiteralPath (Join-Path $respaldo 'snapshot-rds.txt') -Value $snapshot -Encoding ASCII
    $inicioMigracion = $true
    Invoke-IotPython -m tools.migrar_4_3 aplicar @argumentos --snapshot $snapshot

    foreach ($ruta in $archivos) {
        $destino = Join-Path $instalacion $ruta
        if (Test-Path -LiteralPath $destino -PathType Container) {
            $nombre = Split-Path -Leaf $destino
            Rename-Item -LiteralPath $destino -NewName "$nombre.pre43-$marca"
        }
        $carpeta = Split-Path -Parent $destino
        New-Item -ItemType Directory -Path $carpeta -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $checkout $ruta) -Destination $carpeta -Recurse -Force
    }
    Copy-Item -LiteralPath $envNuevo -Destination $envActual -Force
    icacls.exe (Join-Path $instalacion 'app') /grant "*$($sid):(OI)(CI)(RX)" /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo dar lectura de app a la tarea.' }
    icacls.exe $envActual /grant "*$($sid):(R)" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo dar lectura del .env a la tarea.' }

    Enable-ScheduledTask -TaskName $nombreTarea | Out-Null
    Start-ScheduledTask -TaskName $nombreTarea
    for ($intento = 0; $intento -lt 8; $intento++) {
        Start-Sleep -Seconds 2
        try {
            $salud = Invoke-RestMethod "$urlLocal/health/rds" -TimeoutSec 5
            $modo = Invoke-RestMethod "$urlLocal/plataforma/config" -TimeoutSec 5
        } catch {
            continue
        }
        if ($salud.status -eq 'ok' -and $salud.database -eq 'RDS' -and $modo.activa -eq $true) {
            $salud
            $modo
            return
        }
    }
    throw "Revisa $instalacion\logs\api.log."
} catch {
    if ($inicioMigracion) { Write-Host "Usa $respaldo y el snapshot $snapshot para revisar la recuperacion." }
    throw
} finally {
    Pop-Location
    if ($pausada -and -not $inicioMigracion) {
        Enable-ScheduledTask -TaskName $nombreTarea | Out-Null
        if ((Get-ScheduledTask -TaskName $nombreTarea).State -ne 'Running') { Start-ScheduledTask -TaskName $nombreTarea }
    }
}

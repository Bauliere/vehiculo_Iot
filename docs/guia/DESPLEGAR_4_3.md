# Publicar la actividad 4.3

Prueba primero en un RDS restaurado y una instancia de ensayo. La publicación de Pages sigue saliendo de `main` y `/docs`. El backend usa la tarea existente `VehiculoIoT-API` con un solo worker. Caddy mantiene HTTPS/WSS en la tarea `VehiculoIoT-HTTPS`.

## GitHub y paquete para EC2

Desde PowerShell en la copia de trabajo de la actividad:

```powershell
git status --short --branch
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
git push -u origin codex/actividad-4-3
gh pr create --base main --head codex/actividad-4-3 --fill
git archive --format=zip --output="$env:TEMP/vehiculo-iot-4-3-ec2.zip" HEAD app requirements.txt migrations tools .env.example
```

Si no usas `gh`, abre el comparador de ramas de GitHub. Integra la rama en `main` cuando el entorno de ensayo pase la matriz. Comprueba después el despliegue de Pages. El sitio reconoce la API anterior durante la transición por la respuesta 404 de `/plataforma/config`. [Abrir comparación](https://github.com/Bauliere/vehiculo_Iot/compare/main...codex/actividad-4-3?expand=1) · [GitHub Pages](https://bauliere.github.io/vehiculo_Iot/).

## Respaldo y verificación SQL

Identifica en AWS el recurso de origen y conserva un snapshot con estado `available`. Restaura el snapshot en un destino separado con acceso de mínimo privilegio. Verifica el nombre de la base y el endpoint de **ensayo** antes de cada comando de escritura. Para la evidencia conserva el identificador y la hora del snapshot, el resultado de restauración y las salidas SQL. Las salidas deben quedar fuera del repositorio si incluyen datos privados.

Desde la raíz del repositorio, con el cliente MySQL y el CA que usa RDS:

```powershell
$clienteSql = (Get-Command mysql.exe).Source
$endpointPrueba = Read-Host 'Endpoint restaurado de ensayo'
$usuarioPrueba = Read-Host 'Usuario SQL de migración para ensayo'
$basePrueba = Read-Host 'Base del entorno de ensayo'
$caPrueba = Read-Host 'Ruta absoluta al CA de Amazon RDS'
$mysql43 = @('--protocol=TCP', '--ssl-mode=VERIFY_IDENTITY', "--ssl-ca=$caPrueba",
             "--host=$endpointPrueba", "--user=$usuarioPrueba", '--password', "--database=$basePrueba", '--batch')

& $clienteSql @mysql43 '--execute=source migrations/4_3/002_plataforma_comercial.verify.sql' |
  Tee-Object -FilePath "$env:TEMP/iot43-antes.tsv"
if ($LASTEXITCODE -ne 0) { throw 'Falló la inspección inicial de MySQL' }
# Ejecuta 001 sólo si la copia todavía tiene el esquema original de seis tablas.
& $clienteSql @mysql43 '--execute=source migrations/4_3/001_modelos_unidades.up.sql'
if ($LASTEXITCODE -ne 0) { throw 'Detenerse y revisar el esquema tras 001' }
& $clienteSql @mysql43 '--execute=source migrations/4_3/002_plataforma_comercial.up.sql'
if ($LASTEXITCODE -ne 0) { throw 'Detenerse y revisar el esquema tras 002' }
& $clienteSql @mysql43 '--execute=source migrations/4_3/002_plataforma_comercial.verify.sql' |
  Tee-Object -FilePath "$env:TEMP/iot43-despues.tsv"
if ($LASTEXITCODE -ne 0) { throw 'Falló la verificación de MySQL' }
Compare-Object (Get-Content "$env:TEMP/iot43-antes.tsv") (Get-Content "$env:TEMP/iot43-despues.tsv")
```

Comprueba que coincidan las filas, los extremos de IDs, las firmas del historial y los 21 procedimientos. Las columnas, claves y tablas agregadas explican las diferencias de estructura. MySQL puede realizar commit implícito en DDL. Ante un error parcial, registra la última sentencia aplicada y ensaya la recuperación sobre otra restauración. Para producción repite el procedimiento con su propio respaldo, revisión e interrupción programada. Una vez que existan datos comerciales privados, conserva el modo comercial al recuperar servicio con esa base.

## Instancia Windows de ensayo

Copia el ZIP a una ruta privada de la instancia. En el `.env` privado de esa instalación apunta `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` y `DB_SSL_CA` al RDS restaurado. Conserva los ajustes vigentes de Gemini y del proxy. Asegúrate de que el servicio pueda leer y escribir en las tablas nuevas y ejecutar los SP existentes.

```powershell
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
$paquete43 = Join-Path $env:TEMP 'vehiculo-iot-4-3-ec2.zip'
$preparacion43 = Join-Path $env:TEMP ('iot43-paquete-' + (Get-Date -Format yyyyMMdd-HHmmss))
$respaldo43 = Join-Path (Get-Location) ('respaldo-iot43-' + (Get-Date -Format yyyyMMdd-HHmmss))
Expand-Archive -LiteralPath $paquete43 -DestinationPath $preparacion43 -ErrorAction Stop
New-Item -Path $respaldo43 -ItemType Directory -ErrorAction Stop | Out-Null
Copy-Item -Path '.\app','.\requirements.txt' -Destination $respaldo43 -Recurse -ErrorAction Stop
Copy-Item -Path "$preparacion43\app","$preparacion43\requirements.txt","$preparacion43\migrations","$preparacion43\tools" -Destination '.' -Recurse -Force -ErrorAction Stop
& .\.venv\Scripts\python.exe -m compileall -q app tools
if ($LASTEXITCODE -ne 0) { throw 'Falló la comprobación de Python' }
& .\.venv\Scripts\python.exe -m tools.cuentas_4_3 crear-admin --nombre 'Equipo IoT' --correo 'admin@example.test'
```

Escribe la contraseña durante la provisión. El correo del ejemplo se sustituye por la cuenta de ensayo que usarás. Configura en `.env` con un editor:

```dotenv
COMMERCIAL_ENABLED=true
EXHIBITION_ENABLED=false
PUBLIC_CONTROL_ENABLED=false
```

Reinicia sólo la API en la ventana acordada y verifica el estado antes de abrir la web:

```powershell
Get-ScheduledTask -TaskName 'VehiculoIoT-API','VehiculoIoT-HTTPS' | Select-Object TaskName,State
Stop-ScheduledTask -TaskName 'VehiculoIoT-API'
Start-Sleep -Seconds 3
if (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue) { throw 'El puerto 8000 sigue ocupado' }
Start-ScheduledTask -TaskName 'VehiculoIoT-API'
Start-Sleep -Seconds 5
Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 10
Invoke-RestMethod 'http://127.0.0.1:8000/health/rds' -TimeoutSec 15
Invoke-RestMethod 'http://127.0.0.1:8000/plataforma/config' -TimeoutSec 10
```

En la web, registra el modelo y los códigos reales confirmados del firmware. En **Unidades**, edita la fila histórica para agregar su modelo, número de serie y estado comercial. Conserva su ID. Crea los compradores de ensayo y asigna las unidades. La habilitación de una unidad para exhibición y la revisión física de los límites se acuerdan con su responsable.

### Provisión WSS del dispositivo

Desde la instancia, usa el **ID físico registrado** para generar la credencial. Ese comando también sirve para rotarla. Para rotar una unidad en uso, detén y reinicia la API en la ventana de mantenimiento para cerrar el canal anterior.

```powershell
$unidad43 = Read-Host 'ID de la unidad física de prueba'
& .\.venv\Scripts\python.exe -m tools.cuentas_4_3 credencial-dispositivo $unidad43
```

La consola muestra la credencial una vez. En una copia del sketch, declara en la configuración privada una cadena estática con el encabezado `X-Device-Key`. Cambia `RUTA_WSS` al ID provisionado. En `MAQUINA_CARGA_WSS.ino`, coloca `setExtraHeaders` inmediatamente después de `beginSslWithCA`:

```cpp
// En la configuración privada del sketch
constexpr char CABECERA_DISPOSITIVO[] = "X-Device-Key: COPIAR_CREDENCIAL_PRIVADA";

// En la inicialización WSS, conserva la validación TLS existente.
clienteWss.beginSslWithCA(SERVIDOR_WSS, PUERTO_WSS, RUTA_WSS, &autoridades, "");
clienteWss.setExtraHeaders(CABECERA_DISPOSITIVO);
```

Comprueba primero `estado_inicial` con el dispositivo aislado y después el corte de movimiento ante caída de Wi‑Fi/WSS, expiración, cierre de pestaña y DETENER. Activa `EXHIBITION_ENABLED=true` y reinicia la API tras confirmar la prueba física y una unidad específica en estado **Exhibición**. Una sesión dura 60 s. El servidor permite pulsos espaciados de las direcciones marcadas en el modelo y siempre admite DETENER. La duración de actuación del pulso corresponde al firmware, hasta 500 ms en el controlador de la máquina de carga. La conexión autenticada de un dispositivo acredita su canal. La observación física confirma la actuación.

## Comprobaciones en el sitio publicado

Abre Swagger y Pages, inicia sesión con cada rol en perfiles separados y completa la matriz de la actividad. Confirma vigencia del dominio y los orígenes de CORS si cambió la IP de EC2. [Swagger actual](https://vehiculo-iot.34-225-114-88.sslip.io/docs) · [Sitio publicado](https://bauliere.github.io/vehiculo_Iot/).

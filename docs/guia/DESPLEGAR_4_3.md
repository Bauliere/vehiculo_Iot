# Actividad 4.3 · Despliegue desde Laptop y EC2

**Orden** · **L0 → L1 → E1 → L2 → E2 → E3 → L3 → E4 → E5 → L4**. L significa **Laptop**. E significa **EC2**, en PowerShell como administrador por Escritorio remoto. Conserva abiertas ambas consolas para reutilizar sus variables.

La instancia trae el código con Git a `C:\ProgramData\VehiculoIoT\4.3\...`. La tarea `VehiculoIoT-API` sigue ejecutando la instalación en `C:\Users\Administrator\Desktop\websocket_iot`.

Si la ESP aún usa el sketch anterior, programa el corte hasta terminar [E6](#e6--provisionar-la-esp-si-corresponde) y la carga del firmware actualizado.

## Laptop

### L0 · Abrir el laboratorio y conectar a EC2

Inicia la sesión del laboratorio en **AWS Academy → Start Lab**. Si falta AWS CLI en la laptop, instala el MSI y vuelve a abrir PowerShell. [Instalación oficial de AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).

```powershell
# Solo si falta AWS CLI.
msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi
```

Usa un perfil autorizado de AWS. Si tu laboratorio te entrega credenciales temporales en **AWS Details**, puedes introducirlas sólo para la sesión actual.

```powershell
$env:AWS_ACCESS_KEY_ID = Read-Host 'AWS_ACCESS_KEY_ID temporal'
$env:AWS_SECRET_ACCESS_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'AWS_SECRET_ACCESS_KEY temporal' -AsSecureString)).Password
$env:AWS_SESSION_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'AWS_SESSION_TOKEN temporal' -AsSecureString)).Password
```

```powershell
$ErrorActionPreference = 'Stop'
$awsCli43 = (Get-Command aws.exe).Source
$region43 = (Read-Host 'Región AWS de la EC2 y RDS').Trim()
if (-not $region43) { throw 'Indica la región de tu laboratorio.' }

function AWS43 {
    & $awsCli43 --no-cli-pager --region $region43 @args
    if ($LASTEXITCODE -ne 0) { throw "AWS CLI falló ($LASTEXITCODE). Comprueba el estado del recurso antes de repetir." }
}

AWS43 sts get-caller-identity --output table
AWS43 ec2 describe-instances --query 'Reservations[].Instances[].{Id:InstanceId,Estado:State.Name,IP:PublicIpAddress,VPC:VpcId}' --output table
$ec2Id43 = (Read-Host 'ID de la EC2 que hospeda la API, i-...').Trim()
$estadoEc243 = AWS43 ec2 describe-instances --instance-ids $ec2Id43 --query 'Reservations[0].Instances[0].State.Name' --output text
if ($estadoEc243 -eq 'stopped') {
    AWS43 ec2 start-instances --instance-ids $ec2Id43 | Out-Null
}
AWS43 ec2 wait instance-running --instance-ids $ec2Id43
AWS43 ec2 wait instance-status-ok --instance-ids $ec2Id43
$ipEc243 = AWS43 ec2 describe-instances --instance-ids $ec2Id43 --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
"IP pública de EC2: $ipEc243"

AWS43 rds describe-db-instances --query 'DBInstances[].{Id:DBInstanceIdentifier,Estado:DBInstanceStatus,Host:Endpoint.Address,Cluster:DBClusterIdentifier}' --output table
AWS43 rds describe-db-clusters --query 'DBClusters[].{Id:DBClusterIdentifier,Estado:Status,Host:Endpoint,Motor:Engine}' --output table
```

Si el RDS de la API está en `stopped`, usa sólo el bloque que corresponda al recurso. Espera `available` antes de pasar a E1. [Arrancar RDS](https://docs.aws.amazon.com/cli/latest/reference/rds/start-db-instance.html) · [Arrancar Aurora](https://docs.aws.amazon.com/cli/latest/reference/rds/start-db-cluster.html).

```powershell
# RDS MySQL como instancia independiente, si está detenida.
$idDbArranque43 = (Read-Host 'ID de la instancia RDS detenida').Trim()
AWS43 rds start-db-instance --db-instance-identifier $idDbArranque43 | Out-Null
AWS43 rds wait db-instance-available --db-instance-identifier $idDbArranque43
```

```powershell
# Clúster Aurora, si está detenido.
$idAuroraArranque43 = (Read-Host 'ID del clúster Aurora detenido').Trim()
AWS43 rds start-db-cluster --db-cluster-identifier $idAuroraArranque43 | Out-Null
AWS43 rds wait db-cluster-available --db-cluster-identifier $idAuroraArranque43
```

Para abrir Escritorio remoto desde la laptop, usa la IP pública que mostró EC2 y tu acceso de Windows habitual.

```powershell
if ($ipEc243 -and $ipEc243 -ne 'None') { mstsc.exe "/v:$ipEc243" }
```

### L1 · Subir la rama y guardar el commit

```powershell
Set-Location 'C:\Users\yolop\Documents\ChatGPT\Carrito IOT\vehiculo_iot'
git switch codex/actividad-4-3
if ($LASTEXITCODE -ne 0) { throw 'Abre la rama de la actividad.' }
$cambios43 = git status --porcelain
if ($LASTEXITCODE -ne 0 -or $cambios43) { throw 'Revisa los cambios locales antes del push.' }
git diff --check origin/main...HEAD
if ($LASTEXITCODE -ne 0) { throw 'Revisa el diff antes de publicar.' }
git push -u origin codex/actividad-4-3
if ($LASTEXITCODE -ne 0) { throw 'La rama todavía debe publicarse.' }
git rev-parse HEAD
git ls-remote --exit-code origin 'refs/heads/codex/actividad-4-3'
```

Copia el SHA completo de 40 caracteres y comprueba que el remoto muestra el mismo. Te lo pedirá **E1**. Integra la rama en `main` en **L4**.

### L2 · Identificar RDS y restaurar una copia privada

Usa el `DB_HOST` que muestra **E1**. Si es un alias o un proxy, identifica en la consola AWS el endpoint escritor de RDS asociado.

```powershell
$ec2Info43 = AWS43 ec2 describe-instances --instance-ids $ec2Id43 --query 'Reservations[0].Instances[0]' --output json | ConvertFrom-Json
$hostOrigen43 = (Read-Host 'Endpoint RDS escritor comprobado con E1').Trim()
$instancias43 = (AWS43 rds describe-db-instances --output json | ConvertFrom-Json).DBInstances
$origen43 = $instancias43 | Where-Object { $_.Endpoint.Address -eq $hostOrigen43 } | Select-Object -First 1
$tipo43 = 'instancia'
if (-not $origen43 -or $origen43.DBClusterIdentifier) {
    $miembro43 = $origen43
    $clusteres43 = (AWS43 rds describe-db-clusters --output json | ConvertFrom-Json).DBClusters
    $origen43 = $clusteres43 | Where-Object {
        $_.Endpoint -eq $hostOrigen43 -or ($miembro43 -and $_.DBClusterIdentifier -eq $miembro43.DBClusterIdentifier)
    } | Select-Object -First 1
    $tipo43 = 'cluster'
    if ($miembro43 -and -not ($origen43.DBClusterMembers | Where-Object { $_.IsClusterWriter -and $_.DBInstanceIdentifier -eq $miembro43.DBInstanceIdentifier })) {
        throw 'El endpoint indicado no pertenece al escritor del clúster.'
    }
}
if (-not $origen43 -or $origen43.Engine -notin @('mysql','aurora-mysql')) {
    throw 'Identifica en AWS el recurso MySQL asociado a la API.'
}
if ($tipo43 -eq 'instancia') {
    $subred43 = $origen43.DBSubnetGroup.DBSubnetGroupName
    $puertoRds43 = $origen43.Endpoint.Port
    $idOrigen43 = $origen43.DBInstanceIdentifier
} else {
    $subred43 = $origen43.DBSubnetGroup
    $puertoRds43 = $origen43.Port
    $idOrigen43 = $origen43.DBClusterIdentifier
}
$vpcRds43 = AWS43 rds describe-db-subnet-groups --db-subnet-group-name $subred43 --query 'DBSubnetGroups[0].VpcId' --output text
if ($ec2Info43.VpcId -ne $vpcRds43) { throw 'Comprueba las subredes y la conectividad privada entre EC2 y RDS.' }
[pscustomobject]@{ Recurso=$idOrigen43; Tipo=$tipo43; Motor=$origen43.Engine; Version=$origen43.EngineVersion; VPC=$vpcRds43; IP=$ec2Info43.PublicIpAddress }
$ec2Info43.SecurityGroups | Format-Table GroupId,GroupName
```

Introduce el ID de un grupo privado de ensayo que ya permita MySQL desde la EC2 elegida, o pulsa Enter para crearlo. La regla nueva usa el grupo de esa EC2 como origen. [Reglas de grupos de seguridad](https://docs.aws.amazon.com/cli/latest/reference/ec2/authorize-security-group-ingress.html).

```powershell
$sgEnsayo43 = (Read-Host 'ID de grupo privado de ensayo, o Enter para crearlo').Trim()
if (-not $sgEnsayo43) {
    $sgEc243 = (Read-Host 'GroupId de la EC2 mostrado arriba, sg-...').Trim()
    if ($ec2Info43.SecurityGroups.GroupId -notcontains $sgEc243) { throw 'El grupo debe pertenecer a la EC2 elegida.' }
    $nombreSg43 = 'iot43-ensayo-' + (Get-Date -Format 'yyyyMMddHHmmss')
    $sgEnsayo43 = AWS43 ec2 create-security-group --group-name $nombreSg43 --description 'MySQL IoT 4.3 ensayo desde EC2' --vpc-id $vpcRds43 --query GroupId --output text
    $regla43 = "IpProtocol=tcp,FromPort=$puertoRds43,ToPort=$puertoRds43,UserIdGroupPairs=[{GroupId=$sgEc243}]"
    AWS43 ec2 authorize-security-group-ingress --group-id $sgEnsayo43 --ip-permissions $regla43 | Out-Null
}
$sgInfo43 = AWS43 ec2 describe-security-groups --group-ids $sgEnsayo43 --query 'SecurityGroups[0]' --output json | ConvertFrom-Json
if ($sgInfo43.VpcId -ne $vpcRds43) { throw 'El grupo de ensayo pertenece a otra VPC.' }
$sgInfo43.IpPermissions | ConvertTo-Json -Depth 8
```

Define estas funciones en la misma consola. Aurora requiere además crear la instancia escritora. Si AWS CLI devuelve un error de permisos, usa la consola AWS con tu perfil autorizado. Si una espera vence, consulta el mismo identificador con `describe` antes de volver a esperar. [Restaurar instancia RDS](https://docs.aws.amazon.com/cli/latest/reference/rds/restore-db-instance-from-db-snapshot.html) · [Restaurar clúster](https://docs.aws.amazon.com/cli/latest/reference/rds/restore-db-cluster-from-snapshot.html) · [Crear escritor de Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/tut-restore-cluster.CLI.html).

```powershell
function New-Snapshot43([string]$idSnapshot) {
    if ($tipo43 -eq 'instancia') {
        AWS43 rds create-db-snapshot --db-instance-identifier $idOrigen43 --db-snapshot-identifier $idSnapshot | Out-Null
        AWS43 rds wait db-snapshot-completed --db-snapshot-identifier $idSnapshot
        $snap = AWS43 rds describe-db-snapshots --db-snapshot-identifier $idSnapshot --query 'DBSnapshots[0]' --output json | ConvertFrom-Json
    } else {
        AWS43 rds create-db-cluster-snapshot --db-cluster-identifier $idOrigen43 --db-cluster-snapshot-identifier $idSnapshot | Out-Null
        AWS43 rds wait db-cluster-snapshot-available --db-cluster-snapshot-identifier $idSnapshot
        $snap = AWS43 rds describe-db-cluster-snapshots --db-cluster-snapshot-identifier $idSnapshot --query 'DBClusterSnapshots[0]' --output json | ConvertFrom-Json
    }
    if ($snap.Status -ne 'available') { throw "El snapshot $idSnapshot debe quedar available." }
    [pscustomobject]@{ Snapshot=$idSnapshot; Estado=$snap.Status; Origen=$idOrigen43; Creado=$snap.SnapshotCreateTime }
}

function Restore-Copia43([string]$idSnapshot, [string]$destino) {
    if (-not $idSnapshot -or -not $destino -or $destino -eq $idOrigen43) { throw 'Indica un snapshot y un identificador nuevo.' }
    $red = @('--db-subnet-group-name',$subred43,'--vpc-security-group-ids',$sgEnsayo43,'--port',"$puertoRds43")
    if ($tipo43 -eq 'instancia') {
        $opciones = @('--db-instance-class',$origen43.DBInstanceClass,'--no-publicly-accessible')
        $parametros = @($origen43.DBParameterGroups)[0].DBParameterGroupName
        if ($parametros) { $opciones += @('--db-parameter-group-name',$parametros) }
        $grupoOpciones = @($origen43.OptionGroupMemberships)[0].OptionGroupName
        if ($grupoOpciones) { $opciones += @('--option-group-name',$grupoOpciones) }
        AWS43 rds restore-db-instance-from-db-snapshot --db-instance-identifier $destino --db-snapshot-identifier $idSnapshot @red @opciones | Out-Null
        AWS43 rds wait db-instance-available --db-instance-identifier $destino
        $copia = AWS43 rds describe-db-instances --db-instance-identifier $destino --query 'DBInstances[0]' --output json | ConvertFrom-Json
        [pscustomobject]@{ Id=$destino; Endpoint=$copia.Endpoint.Address; Puerto=$copia.Endpoint.Port; Publico=$copia.PubliclyAccessible; Estado=$copia.DBInstanceStatus }
        return
    }

    $opciones = @()
    if ($origen43.DBClusterParameterGroup) { $opciones += @('--db-cluster-parameter-group-name',$origen43.DBClusterParameterGroup) }
    if ($origen43.Engine -eq 'mysql') {
        $opciones += @('--db-cluster-instance-class',$origen43.DBClusterInstanceClass,'--no-publicly-accessible')
    } elseif ($origen43.ServerlessV2ScalingConfiguration) {
        $escala = $origen43.ServerlessV2ScalingConfiguration
        $cultura = [System.Globalization.CultureInfo]::InvariantCulture
        $minimo = ([double]$escala.MinCapacity).ToString($cultura)
        $maximo = ([double]$escala.MaxCapacity).ToString($cultura)
        $opciones += @('--serverless-v2-scaling-configuration',"MinCapacity=$minimo,MaxCapacity=$maximo")
    }
    AWS43 rds restore-db-cluster-from-snapshot --db-cluster-identifier $destino --snapshot-identifier $idSnapshot --engine $origen43.Engine @red @opciones | Out-Null
    AWS43 rds wait db-cluster-available --db-cluster-identifier $destino
    if ($origen43.Engine -eq 'aurora-mysql') {
        $primario = ($origen43.DBClusterMembers | Where-Object IsClusterWriter).DBInstanceIdentifier
        $clase = AWS43 rds describe-db-instances --db-instance-identifier $primario --query 'DBInstances[0].DBInstanceClass' --output text
        $idEscritor = "$destino-writer"
        AWS43 rds create-db-instance --db-instance-identifier $idEscritor --db-cluster-identifier $destino --engine aurora-mysql --db-instance-class $clase --no-publicly-accessible | Out-Null
        AWS43 rds wait db-instance-available --db-instance-identifier $idEscritor
        $escritor = AWS43 rds describe-db-instances --db-instance-identifier $idEscritor --query 'DBInstances[0]' --output json | ConvertFrom-Json
        if ($escritor.PubliclyAccessible -ne $false) { throw 'Comprueba el acceso privado del escritor restaurado.' }
    }
    $copia = AWS43 rds describe-db-clusters --db-cluster-identifier $destino --query 'DBClusters[0]' --output json | ConvertFrom-Json
    [pscustomobject]@{ Id=$destino; Endpoint=$copia.Endpoint; Puerto=$copia.Port; Publico=$copia.PubliclyAccessible; Estado=$copia.Status }
}

$fechaAws43 = Get-Date -Format 'yyyyMMddHHmmss'
$snapshotEnsayo43 = 'iot43-origen-ensayo-' + $fechaAws43
$recursoEnsayo43 = 'iot43-ensayo-' + $fechaAws43
New-Snapshot43 $snapshotEnsayo43 | Format-List
$ensayo43 = Restore-Copia43 $snapshotEnsayo43 $recursoEnsayo43
$ensayo43 | Format-List
if ($ensayo43.Estado -ne 'available' -or -not $ensayo43.Endpoint -or $ensayo43.Publico -eq $true) {
    throw 'Comprueba disponibilidad, endpoint y acceso privado de la copia antes de E2.'
}
```

Lleva a **E2** el ID del snapshot y el endpoint y puerto de la copia restaurada. En la consola verifica el grupo de ensayo y el acceso privado de su escritor.

### L3 · Snapshot final de producción

Ejecuta después de **E3**, con la API de producción detenida y las demás escrituras pausadas. Usa la consola de L2. Si la cerraste, vuelve a definir `AWS43` y `New-Snapshot43` e identifica el mismo origen. Ejecuta solamente el nuevo snapshot.

```powershell
$snapshotProd43 = 'iot43-antes-prod-' + (Get-Date -Format 'yyyyMMddHHmmss')
New-Snapshot43 $snapshotProd43 | Format-List
```

Lleva a **E4** el ID con estado `available`. Es el punto de recuperación del corte.

#### Imagen de EC2 opcional

Si necesitas recuperar también los volúmenes de la máquina, crea una AMI antes de E4. Esta variante conserva la sesión RDP. Con `--no-reboot` la imagen incluye los datos que ya se escribieron a disco y puede requerir recuperación del sistema de archivos. Para una imagen con reinicio, usa `--reboot` en una ventana aparte. [Crear una AMI de EC2](https://docs.aws.amazon.com/cli/latest/reference/ec2/create-image.html).

```powershell
$nombreAmi43 = 'vehiculo-iot-ec2-antes-43-' + (Get-Date -Format 'yyyyMMddHHmmss')
$ami43 = AWS43 ec2 create-image --instance-id $ec2Id43 --name $nombreAmi43 --no-reboot --query ImageId --output text
$ami43
AWS43 ec2 wait image-available --image-ids $ami43
AWS43 ec2 describe-images --image-ids $ami43 --query 'Images[0].{Id:ImageId,Estado:State,Raiz:RootDeviceName}' --output table
```

### L4 · Publicar Pages y probar desde la laptop

Tras verificar los puertos en **E5**, comprueba desde la laptop las rutas públicas. Con la plataforma activa, `/vehiculos` debe requerir sesión y `/control/sesion` antiguo debe responder `403`.

```powershell
$url43 = (Read-Host 'URL base HTTPS que sirve Caddy, sin /docs').Trim().TrimEnd('/')
if ($url43 -notmatch '^https://[^/\s]+$') { throw 'Usa la URL HTTPS base con el dominio vigente.' }
Invoke-RestMethod "$url43/health" -TimeoutSec 10
Invoke-RestMethod "$url43/health/rds" -TimeoutSec 15
if ((Invoke-RestMethod "$url43/plataforma/config" -TimeoutSec 10).activa -ne $true) {
    throw 'El HTTPS público todavía no muestra la plataforma 4.3 activa.'
}
function Codigo-Http43([string]$url) {
    try { (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15).StatusCode }
    catch {
        if (-not $_.Exception.Response) { throw }
        [int]$_.Exception.Response.StatusCode
    }
}
if ((Codigo-Http43 "$url43/vehiculos") -ne 401 -or
    (Codigo-Http43 "$url43/control/sesion") -ne 403) {
    throw 'Comprueba los permisos de las rutas anteriores antes de publicar.'
}
Start-Process "$url43/docs"
```

Prueba el administrador de producción en Swagger con `POST /plataforma/sesion`, **Authorize** y `GET /plataforma/dashboard`. Si el dominio público cambió, actualiza la URL HTTPS pública de `docs/assets/js/config.js` en Laptop y sube ese cambio a la rama.

```powershell
# Sólo si cambió el dominio de Caddy. Desde la carpeta de L1.
Start-Process notepad.exe -ArgumentList 'docs\assets\js\config.js' -Wait
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Revisa el cambio de URL.' }
git diff -- docs/assets/js/config.js
git add -- docs/assets/js/config.js
git commit -m 'Actualiza el dominio público de la API'
if ($LASTEXITCODE -ne 0) { throw 'No se guardó el cambio de URL.' }
git push
if ($LASTEXITCODE -ne 0) { throw 'No se publicó el cambio de URL.' }
```

Abre el comparador o crea el PR con GitHub CLI, si la usas. Para conservar una reversión por PR, integra con **Create a merge commit**. Después comprueba el despliegue de Pages desde `main` y `/docs`.

```powershell
Start-Process 'https://github.com/Bauliere/vehiculo_Iot/compare/main...codex/actividad-4-3?expand=1'
```

Alternativa si está instalada y autenticada GitHub CLI. Revisa el PR antes de hacer el merge. [Crear PR](https://cli.github.com/manual/gh_pr_create) · [Integrar PR](https://cli.github.com/manual/gh_pr_merge).

```powershell
gh pr create --base main --head codex/actividad-4-3 --fill
gh pr view codex/actividad-4-3 --web
gh pr merge codex/actividad-4-3 --merge
```

Abre Pages cuando termine la publicación en GitHub.

```powershell
Start-Process 'https://bauliere.github.io/vehiculo_Iot/'
```

En Administración registra el modelo y clasifica la fila histórica con su serie y su ID existente. Puedes provisionar la ESP en **E6** cuando tengas el ID confirmado. En producción, prueba cada rol en perfiles de navegador separados.

#### Laptop · Configuración del firmware después de E6

Guarda la credencial generada en la configuración privada de la ESP. Ajusta `RUTA_WSS` al ID provisionado y `SERVIDOR_WSS` al dominio HTTPS vigente. En `MAQUINA_CARGA_WSS.ino`, llama a `setExtraHeaders` después de inicializar WSS. Conserva la validación TLS del sketch.

```cpp
constexpr char CABECERA_DISPOSITIVO[] = "X-Device-Key: COPIAR_CREDENCIAL_PRIVADA";

clienteWss.beginSslWithCA(SERVIDOR_WSS, PUERTO_WSS, RUTA_WSS, &autoridades, "");
clienteWss.setExtraHeaders(CABECERA_DISPOSITIVO);
```

Verifica `estado_inicial`, DETENER y el corte por caída de WSS en la prueba física supervisada antes de habilitar exhibición.

### Laptop · Recuperar RDS

Si hubo DDL en producción y necesitas el esquema anterior, conserva el RDS migrado y sus registros. Restaura el snapshot final de L3 a un destino separado y lleva a **Recuperación de EC2** su endpoint y puerto.

```powershell
$idRecuperado43 = 'iot43-recuperacion-' + (Get-Date -Format 'yyyyMMddHHmmss')
$recuperado43 = Restore-Copia43 $snapshotProd43 $idRecuperado43
$recuperado43 | Format-List
if ($recuperado43.Estado -ne 'available' -or -not $recuperado43.Endpoint -or $recuperado43.Publico -eq $true) {
    throw 'Comprueba disponibilidad, endpoint y acceso privado antes de volver a arrancar la API.'
}
```

Si se cerró PowerShell, vuelve a identificar el mismo origen y usa el grupo privado de L2. El ID del corte está en `snapshot-rds.txt` dentro del respaldo de E3.

### Laptop · Recuperar Pages

Después de recuperar la API anterior, si ya publicaste 4.3, abre el PR original en GitHub y usa **Revert** para abrir el PR de recuperación. También puedes prepararlo con Git desde la carpeta de L1. Elige el SHA del merge que integró 4.3 y confirma que es el único que quieres revertir.

```powershell
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'No se pudo actualizar main.' }
git log --first-parent -12 --oneline origin/main
$merge43 = (Read-Host 'SHA del merge de 4.3 verificado en main').Trim()
git switch -c codex/revertir-actividad-4-3 origin/main
if ($LASTEXITCODE -ne 0) { throw 'No se creó la rama de recuperación.' }
git revert -m 1 --no-edit $merge43
if ($LASTEXITCODE -ne 0) { throw 'Revisa el conflicto de reversión antes de subir la rama.' }
git push -u origin codex/revertir-actividad-4-3
if ($LASTEXITCODE -ne 0) { throw 'No se publicó la rama de recuperación.' }
Start-Process 'https://github.com/Bauliere/vehiculo_Iot/compare/main...codex/revertir-actividad-4-3?expand=1'
```

Integra sólo el PR de recuperación. Comprueba Pages y la URL que sirve la API. Si en el mismo PR de 4.3 actualizaste un dominio que sigue en uso, conserva ese dominio en el commit de recuperación.

## EC2 Windows

Ejecuta estos bloques en **PowerShell como administrador dentro de Escritorio remoto**. Usa la misma consola para E1–E6, salvo donde se indica abrir otra.

### E1 · Confirmar la instalación y descargar el commit

```powershell
$ErrorActionPreference = 'Stop'
$inst43 = (Resolve-Path -LiteralPath 'C:\Users\Administrator\Desktop\websocket_iot').Path
$pyInst43 = Join-Path $inst43 '.venv\Scripts\python.exe'
$envInst43 = Join-Path $inst43 '.env'
$caddy43 = 'C:\ProgramData\VehiculoIoT\caddy'
$api43 = 'VehiculoIoT-API'
$https43 = 'VehiculoIoT-HTTPS'
$local43 = 'http://127.0.0.1:8000'

function Python43([string]$ejecutable) {
    & $ejecutable @args
    if ($LASTEXITCODE -ne 0) { throw "Python falló ($LASTEXITCODE). Revisa la salida antes de continuar." }
}

$tareas43 = Get-ScheduledTask -TaskName $api43,$https43
$tareas43 | Select-Object TaskName,State,TaskPath
$tareas43.Actions | Format-List Execute,Arguments,WorkingDirectory
$tareaApi43 = $tareas43 | Where-Object TaskName -eq $api43
if (-not ($tareaApi43.Actions | Where-Object {
    $_.WorkingDirectory -eq $inst43 -or $_.Arguments -like "*$inst43\despliegue\iniciar_api.cmd*"
})) { throw "Confirma la ruta de la tarea API antes de copiar archivos a $inst43." }
Get-NetTCPConnection -LocalPort 443,8000 -State Listen -ErrorAction SilentlyContinue

if ($tareaApi43.State -ne 'Running') {
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Hay otro proceso escuchando en 8000. Identifícalo antes de continuar.'
    }
    Start-ScheduledTask -TaskName $api43
    Start-Sleep -Seconds 5
}
if (($tareas43 | Where-Object TaskName -eq $https43).State -ne 'Running') {
    Start-ScheduledTask -TaskName $https43
}
Invoke-RestMethod "$local43/health" -TimeoutSec 10
Invoke-RestMethod "$local43/health/rds" -TimeoutSec 15

Push-Location -LiteralPath $inst43
try {
    $dbActual43 = Python43 $pyInst43 -c 'import json; from pathlib import Path; from app.config import Settings; s=Settings(); print(json.dumps(dict(Host=s.db_host, Puerto=s.db_port, Base=s.db_name, CA=str(Path(s.db_ssl_ca).resolve()))))' | ConvertFrom-Json
} finally {
    Pop-Location
}
$dbActual43 | Format-List
```

Usa el valor de «Host» en L2 para identificar RDS. Git se necesita en la EC2. Si falta y tienes Winget, ejecuta `winget install --exact --id Git.Git` y reabre PowerShell. Con la sesión reabierta, repite el primer bloque de E1. [Git for Windows](https://gitforwindows.org/).

```powershell
$git43 = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if (-not $git43) { $git43 = 'C:\Program Files\Git\cmd\git.exe' }
if (-not (Test-Path -LiteralPath $git43 -PathType Leaf)) { throw 'Instala Git antes de continuar.' }
$sha43 = (Read-Host 'SHA completo de L1').Trim()
if ($sha43 -notmatch '^[a-fA-F0-9]{40}$') { throw 'Copia el SHA completo de L1.' }

$marca43 = Get-Date -Format 'yyyyMMdd-HHmmss'
$sesionInst43 = Join-Path 'C:\ProgramData\VehiculoIoT\4.3' $marca43
$fuente43 = Join-Path $sesionInst43 'checkout'
$respaldo43 = Join-Path $sesionInst43 'respaldo-ec2'
New-Item -ItemType Directory -Path $sesionInst43 | Out-Null
icacls.exe $sesionInst43 /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falló la creación de la carpeta privada.' }

& $git43 clone --single-branch --branch codex/actividad-4-3 https://github.com/Bauliere/vehiculo_Iot.git $fuente43
if ($LASTEXITCODE -ne 0) { throw 'Confirma que L1 publicó la rama y la EC2 puede llegar a GitHub.' }
$commitEc243 = & $git43 -C $fuente43 rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $commitEc243 -ne $sha43) { throw 'El commit descargado difiere del SHA de L1.' }
$sesionInst43
```

Anota la ruta impresa. El checkout ya queda listo para E2 en cuanto L2 entregue el endpoint privado.

### E2 · Ensayar en la copia restaurada

Recibe de L2 el endpoint privado, el puerto y el ID del snapshot de ensayo. Edita el `.env` del **checkout**, que abrirá el bloc de notas. Cambia `DB_HOST` y `DB_PORT` a los valores de ensayo, conserva `DB_NAME`, ajusta `DB_USER` y `DB_PASSWORD` si la restauración usa otras credenciales y pon en `DB_SSL_CA` la ruta absoluta mostrada en E1. Guarda las tres banderas de abajo.

```dotenv
COMMERCIAL_ENABLED=true
EXHIBITION_ENABLED=false
PUBLIC_CONTROL_ENABLED=false
```

```powershell
$hostEnsayo43 = (Read-Host 'Endpoint privado restaurado de L2').Trim()
$puertoEnsayo43 = [int](Read-Host 'Puerto de la copia restaurada')
$snapPrueba43 = (Read-Host 'ID del snapshot de ensayo de L2').Trim()
if (-not $hostEnsayo43 -or $hostEnsayo43 -eq $dbActual43.Host -or -not $snapPrueba43) {
    throw 'Comprueba el endpoint distinto de producción y el snapshot de ensayo.'
}
if (-not (Test-NetConnection $hostEnsayo43 -Port $puertoEnsayo43 -InformationLevel Quiet)) {
    throw 'Comprueba el grupo de seguridad y el estado del RDS restaurado.'
}
$envPrueba43 = Join-Path $fuente43 '.env'
if (-not (Test-Path -LiteralPath $envPrueba43)) { Copy-Item -LiteralPath $envInst43 -Destination $envPrueba43 }
Start-Process notepad.exe -ArgumentList ('"{0}"' -f $envPrueba43) -Wait

Set-Location -LiteralPath $fuente43
Python43 $pyInst43 -m venv .venv
$pyEnsayo43 = Join-Path $fuente43 '.venv\Scripts\python.exe'
Python43 $pyEnsayo43 -m pip install -r requirements.txt
$destinoEnsayo43 = @('--env',$envPrueba43,'--host',$hostEnsayo43,'--puerto',"$puertoEnsayo43",
    '--base',$dbActual43.Base,'--evidencia',(Join-Path $sesionInst43 'sql-ensayo'),'--snapshot',$snapPrueba43)
$usuarioDdl43 = (Read-Host 'Usuario SQL de migración para ensayo, o Enter para usar el del .env').Trim()
if ($usuarioDdl43) { $destinoEnsayo43 += @('--usuario',$usuarioDdl43) }
Python43 $pyEnsayo43 -m tools.migrar_4_3 verificar @destinoEnsayo43
Python43 $pyEnsayo43 -m tools.migrar_4_3 aplicar @destinoEnsayo43
Python43 $pyEnsayo43 -m tools.cuentas_4_3 crear-admin --nombre 'Ensayo IoT' --correo (Read-Host 'Correo del administrador de ensayo')

if (Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue) {
    throw 'El puerto de ensayo 8001 está ocupado.'
}
& $pyEnsayo43 -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 1
```

Abre **otra ventana PowerShell de EC2** mientras el ensayo escucha en `8001`.

```powershell
Invoke-RestMethod 'http://127.0.0.1:8001/health' -TimeoutSec 10
Invoke-RestMethod 'http://127.0.0.1:8001/health/rds' -TimeoutSec 15
Invoke-RestMethod 'http://127.0.0.1:8001/plataforma/config' -TimeoutSec 10
Start-Process 'http://127.0.0.1:8001/docs'
```

En Swagger inicia sesión con `POST /plataforma/sesion` y usa su token en **Authorize**. Comprueba `GET /plataforma/dashboard` y `GET /plataforma/unidades`. Debes obtener `status=ok` en RDS, `activa=true` en la configuración y acceso de administrador al inventario. Para repetir E2 con la cuenta ya creada, omite `crear-admin`. Vuelve a la primera consola y detén sólo el servidor de ensayo con **Ctrl+C**.

### E3 · Respaldar EC2 y pausar la API

Concluye E2 y acuerda la ventana de corte. Pide que terminen las órdenes en curso y deja el vehículo detenido. Pausa también cualquier otro cliente que escriba directamente a RDS.

```powershell
New-Item -ItemType Directory -Path $respaldo43 | Out-Null
$deploy43 = @('app','tools','migrations','requirements.txt')
$archivos43 = $deploy43 + @('.env','.venv','certs','despliegue')
foreach ($nombre in $archivos43) {
    $ruta = Join-Path $inst43 $nombre
    if (Test-Path -LiteralPath $ruta) {
        Copy-Item -LiteralPath $ruta -Destination $respaldo43 -Recurse -Force
    }
}
foreach ($nombre in $api43,$https43) {
    Export-ScheduledTask -TaskName $nombre |
        Set-Content -LiteralPath (Join-Path $respaldo43 "$nombre.xml") -Encoding Unicode
}
Copy-Item -LiteralPath (Join-Path $caddy43 'Caddyfile') -Destination $respaldo43
if ((Get-FileHash -LiteralPath $envInst43).Hash -ne (Get-FileHash -LiteralPath (Join-Path $respaldo43 '.env')).Hash) {
    throw 'La copia del .env difiere de la instalación.'
}
foreach ($nombre in @('app\main.py','.venv\Scripts\python.exe','requirements.txt','Caddyfile')) {
    if (-not (Test-Path -LiteralPath (Join-Path $respaldo43 $nombre) -PathType Leaf)) { throw "Falta $nombre en el respaldo." }
}
Get-ChildItem -LiteralPath $respaldo43 -Force | Select-Object Name,Length

function Stop-Api43 {
    $estado = (Get-ScheduledTask -TaskName $api43).State
    if ($estado -ne 'Disabled') {
        Disable-ScheduledTask -TaskName $api43 | Out-Null
    }
    if ($estado -eq 'Running' -or (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) {
        Stop-ScheduledTask -TaskName $api43
    }
    for ($intento = 0; $intento -lt 30; $intento++) {
        if ((Get-ScheduledTask -TaskName $api43).State -eq 'Disabled' -and
            -not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Seconds 1
    }
    throw 'La tarea o el puerto 8000 siguen activos. Identifica su proceso antes del corte.'
}

Stop-Api43
$respaldo43
```

Pasa a **L3** para tomar el snapshot de producción. Lleva a E4 el ID que quede en `available`. Si cancelas el corte antes de E4, reactiva la API anterior.

```powershell
Enable-ScheduledTask -TaskName $api43 | Out-Null
Start-ScheduledTask -TaskName $api43
```

#### Respaldo y verificación SQL

El snapshot de L3 es el respaldo de RDS para el corte. Si ya tienes el cliente oficial `mysqldump.exe` en la EC2 y necesitas también una copia lógica, ejecuta este bloque mientras la API siga detenida, antes de E4. El usuario SQL necesita lectura, permisos para exportar las rutinas y acceso con TLS. [Opciones de mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html).

```powershell
$dumpExe43 = (Get-Command mysqldump.exe).Source
$dump43 = Join-Path $respaldo43 'vehiculo-iot-antes-4-3.sql'
$usuarioDump43 = (Read-Host 'Usuario SQL para el respaldo lógico').Trim()
& $dumpExe43 --protocol=TCP --ssl-mode=VERIFY_IDENTITY "--ssl-ca=$($dbActual43.CA)" "--host=$($dbActual43.Host)" "--port=$($dbActual43.Puerto)" "--user=$usuarioDump43" --password --single-transaction --no-tablespaces --routines --triggers --events --set-gtid-purged=OFF "--result-file=$dump43" --databases $dbActual43.Base
if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $dump43).Length -eq 0) { throw 'El respaldo lógico no quedó completo.' }
Get-FileHash -LiteralPath $dump43
```

### E4 · Migrar producción e instalar el código

Confirma el snapshot de L3 y la ruta privada del respaldo antes de pegar este bloque. El verificador usa el CA de la API, conserva evidencia de conteos, extremos de IDs, historial y procedimientos. Una interrupción durante DDL puede dejar cambios aplicados. Si falla después de comenzar la migración, conserva los JSON y sigue **Recuperación de EC2**.

```powershell
Stop-Api43
$snapCorte43 = (Read-Host 'ID del snapshot de producción L3 con estado available').Trim()
if (-not $snapCorte43 -or $snapCorte43 -eq $snapPrueba43) { throw 'Indica el snapshot final de producción.' }
$snapCorte43 | Set-Content -LiteralPath (Join-Path $respaldo43 'snapshot-rds.txt') -Encoding ASCII

Set-Location -LiteralPath $fuente43
$evidProd43 = Join-Path $respaldo43 'sql-produccion'
$destinoProd43 = @('--env',$envInst43,'--host',$dbActual43.Host,'--puerto',"$($dbActual43.Puerto)",
    '--base',$dbActual43.Base,'--evidencia',$evidProd43,'--snapshot',$snapCorte43)
$usuarioDdl43 = (Read-Host 'Usuario SQL de migración para producción, o Enter para usar el del .env').Trim()
if ($usuarioDdl43) { $destinoProd43 += @('--usuario',$usuarioDdl43) }
Python43 $pyEnsayo43 -m tools.migrar_4_3 verificar @destinoProd43
Python43 $pyEnsayo43 -m tools.migrar_4_3 aplicar @destinoProd43

foreach ($nombre in $deploy43) {
    $destino = Join-Path $inst43 $nombre
    if (Test-Path -LiteralPath $destino) {
        Rename-Item -LiteralPath $destino -NewName "$nombre.pre43-$marca43"
    }
    Copy-Item -LiteralPath (Join-Path $fuente43 $nombre) -Destination $destino -Recurse
}

Set-Location -LiteralPath $inst43
Python43 $pyInst43 -m pip install -r requirements.txt
Python43 $pyInst43 -m compileall -q app tools
Start-Process notepad.exe -ArgumentList ('"{0}"' -f $envInst43) -Wait
```

En el bloc de notas usa el `.env` **de producción** y guarda estas banderas. Conserva las variables de RDS, las claves que ya usa la API y el CA. El usuario de la API debe tener acceso de lectura y escritura en las tablas comerciales, además de poder ejecutar los procedimientos existentes.

```dotenv
COMMERCIAL_ENABLED=true
EXHIBITION_ENABLED=false
PUBLIC_CONTROL_ENABLED=false
```

```powershell
function Grant-Api43 {
    $usuario = (Get-ScheduledTask -TaskName $api43).Principal.UserId
    $sid = $usuario
    if ($usuario -notmatch '^S-\d-') {
        $sid = [System.Security.Principal.NTAccount]::new($usuario).Translate([System.Security.Principal.SecurityIdentifier]).Value
    }
    foreach ($nombre in @('app','.venv')) {
        icacls.exe (Join-Path $inst43 $nombre) /grant "*$($sid):(OI)(CI)(RX)" /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "No se pudieron otorgar permisos de lectura a $nombre." }
    }
    icacls.exe $envInst43 /grant "*$($sid):(R)" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'La tarea no pudo recibir acceso al .env.' }
}

Grant-Api43
Python43 $pyInst43 -c 'import sys; from app.config import Settings; s=Settings(); assert (s.db_host, s.db_port, s.db_name)==(sys.argv[1], int(sys.argv[2]), sys.argv[3]), "Comprueba el RDS de produccion"; assert s.commercial_enabled and not s.exhibition_enabled and not s.public_control_enabled, "Comprueba los tres modos"' $dbActual43.Host "$($dbActual43.Puerto)" $dbActual43.Base
Python43 $pyInst43 -m tools.cuentas_4_3 crear-admin --nombre 'Administración IoT' --correo (Read-Host 'Correo del administrador de producción')
```

El comando pide la contraseña dos veces. Si esa cuenta administrativa ya quedó creada en un intento anterior, verifica su acceso en E5 antes de publicar.

### E5 · Arrancar la API y comprobar Caddy

```powershell
function Start-Api43 {
    if ((Get-ScheduledTask -TaskName $api43).State -eq 'Disabled') {
        Enable-ScheduledTask -TaskName $api43 | Out-Null
    }
    if ((Get-ScheduledTask -TaskName $api43).State -ne 'Running') {
        Start-ScheduledTask -TaskName $api43
    }
    for ($intento = 0; $intento -lt 10; $intento++) {
        try {
            $salud = Invoke-RestMethod "$local43/health/rds" -TimeoutSec 5
            if ($salud.status -eq 'ok' -and $salud.database -eq 'RDS') { return $salud }
        } catch { Write-Verbose $_.Exception.Message }
        Start-Sleep -Seconds 2
    }
    Get-Content -LiteralPath (Join-Path $inst43 'logs\api.log') -Tail 40
    throw 'No se confirmó la lectura local de RDS.'
}

Start-Api43
Invoke-RestMethod "$local43/health" -TimeoutSec 10
$modo43 = Invoke-RestMethod "$local43/plataforma/config" -TimeoutSec 10
if ($modo43.activa -ne $true) { throw 'La actividad 4.3 no aparece activa en la API.' }
Get-ScheduledTask -TaskName $api43,$https43 | Select-Object TaskName,State
Get-NetTCPConnection -LocalPort 8000 -State Listen
Get-NetTCPConnection -LocalPort 443 -State Listen
Get-Content -LiteralPath (Join-Path $caddy43 'Caddyfile')
```

Si la IP y el dominio siguen vigentes, pasa a **L4** para comprobar HTTPS y el administrador de producción. Si responde `8000` y falla HTTPS, consulta el proxy.

```powershell
Get-ScheduledTaskInfo -TaskName $https43
Get-Content -LiteralPath (Join-Path $caddy43 'Caddyfile')
Get-Content -LiteralPath (Join-Path $caddy43 'logs\inicio.log') -Tail 40
Get-Content -LiteralPath (Join-Path $caddy43 'logs\caddy.json') -Tail 40
```

Si la IP pública cambió y usas `sslip.io`, en el bloc de notas cambia el nombre del sitio de Caddy al nuevo `vehiculo-iot.<IP-PÚBLICA>.sslip.io`. Verifica la IP en L0. Guarda, valida y recarga el proxy existente.

```powershell
$caddyFile43 = Join-Path $caddy43 'Caddyfile'
$caddyExe43 = Join-Path $caddy43 'caddy.exe'
Start-Process notepad.exe -ArgumentList ('"{0}"' -f $caddyFile43) -Wait
& $caddyExe43 validate --config $caddyFile43 --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Corrige el Caddyfile antes de recargar.' }
if ((Get-ScheduledTask -TaskName $https43).State -eq 'Running') {
    & $caddyExe43 reload --config $caddyFile43 --adapter caddyfile --address 127.0.0.1:2019
    if ($LASTEXITCODE -ne 0) { throw 'Caddy rechazó el cambio. Revisa los registros.' }
} else {
    Start-ScheduledTask -TaskName $https43
}
```

En L4 comprueba HTTPS con el dominio nuevo. Usa el mismo host en el frontend y en el sketch.

### E6 · Provisionar la ESP si corresponde

Tras clasificar la unidad histórica desde L4, confirma su ID físico. Este comando genera la credencial WSS que llevarás a la sección **Laptop · Configuración del firmware**. Si se trata de una rotación de una unidad en uso, pausa su operación y reinicia la API con `Stop-Api43` y `Start-Api43` para cerrar el canal anterior.

```powershell
Set-Location -LiteralPath $inst43
$unidad43 = [int](Read-Host 'ID de la unidad física confirmada')
if ($unidad43 -lt 1) { throw 'Confirma el ID de la unidad.' }
Python43 $pyInst43 -m tools.cuentas_4_3 credencial-dispositivo $unidad43
```

Tras comprobar la ESP en la laptop, si vas a ofrecer exhibición, verifica que la unidad esté en estado **Exhibición**. Abre el `.env`, cambia `EXHIBITION_ENABLED=true` y reinicia en una ventana sin operaciones activas.

```powershell
Start-Process notepad.exe -ArgumentList ('"{0}"' -f $envInst43) -Wait
Grant-Api43
Stop-Api43
Start-Api43
```

### Recuperación de EC2

Si el corte llegó al DDL, recupera primero el snapshot de L3 con **Laptop · Recuperar RDS**. El endpoint de recuperación es el de ese recurso nuevo. Conserva el RDS que recibió los cambios y cualquier escritura posterior. Si cancelaste antes de ejecutar DDL, puedes usar la base original después de comprobar su versión.

En la consola de EC2 del corte, reutiliza `Python43`, `Stop-Api43`, `Grant-Api43` y `Start-Api43`. Si la cerraste, vuelve a cargar sólo las definiciones de esas cuatro funciones y usa este bloque para recuperar las rutas. Si la tienes abierta, puedes pasar al bloque siguiente.

```powershell
$ErrorActionPreference = 'Stop'
$inst43 = (Resolve-Path -LiteralPath 'C:\Users\Administrator\Desktop\websocket_iot').Path
$pyInst43 = Join-Path $inst43 '.venv\Scripts\python.exe'
$envInst43 = Join-Path $inst43 '.env'
$api43 = 'VehiculoIoT-API'
$https43 = 'VehiculoIoT-HTTPS'
$local43 = 'http://127.0.0.1:8000'
$caddy43 = 'C:\ProgramData\VehiculoIoT\caddy'
$sesionInst43 = (Resolve-Path -LiteralPath (Read-Host 'Carpeta privada impresa en E1')).Path
$fuente43 = Join-Path $sesionInst43 'checkout'
$pyEnsayo43 = Join-Path $fuente43 '.venv\Scripts\python.exe'
$respaldo43 = Join-Path $sesionInst43 'respaldo-ec2'
$deploy43 = @('app','tools','migrations','requirements.txt')
```

Usa los XML exportados sólo si alguna tarea falta. El proxy puede seguir atendiendo HTTPS durante la recuperación.

```powershell
foreach ($nombre in $api43,$https43) {
    if (-not (Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue)) {
        $xml43 = Get-Content -LiteralPath (Join-Path $respaldo43 "$nombre.xml") -Encoding Unicode -Raw
        Register-ScheduledTask -TaskName $nombre -Xml $xml43 | Out-Null
    }
}
```

Edita una copia del `.env` respaldado. Si restauraste RDS, pon su endpoint y puerto en `DB_HOST` y `DB_PORT`. Conserva el esquema y el CA. Si `DB_SSL_CA` era relativa, pon la ruta absoluta al certificado de la instalación para poder comprobar el `.env` desde el respaldo. En la primera actualización de 4.3, la API anterior debe apuntar a la versión 000 o 001. Si necesitas mantener datos creados en 4.3, recupera con un backend compatible con 002 y con la plataforma comercial activa.

```powershell
Stop-Api43
$vuelta43 = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($nombre in @('app\main.py','.env','.venv\Scripts\python.exe','requirements.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $respaldo43 $nombre) -PathType Leaf)) {
        throw "Falta $nombre en el respaldo de E3."
    }
}
$envVuelta43 = Join-Path $respaldo43 ".env.recuperacion-$vuelta43"
Copy-Item -LiteralPath (Join-Path $respaldo43 '.env') -Destination $envVuelta43
Start-Process notepad.exe -ArgumentList ('"{0}"' -f $envVuelta43) -Wait
$hostVuelta43 = (Read-Host 'Endpoint RDS elegido para recuperación').Trim()
$puertoVuelta43 = [int](Read-Host 'Puerto de ese RDS')
$baseVuelta43 = (Read-Host 'Nombre del esquema de la instalación original, normalmente vehiculo_iot').Trim()
$evidVuelta43 = Join-Path $respaldo43 "sql-recuperacion-$vuelta43"

Set-Location -LiteralPath $fuente43
Python43 $pyEnsayo43 -m tools.migrar_4_3 verificar --env $envVuelta43 --host $hostVuelta43 --puerto $puertoVuelta43 --base $baseVuelta43 --evidencia $evidVuelta43
$pruebaVuelta43 = Get-ChildItem -LiteralPath $evidVuelta43 -Filter '*-verificacion.json' | Select-Object -First 1
$versionVuelta43 = (Get-Content -LiteralPath $pruebaVuelta43.FullName -Raw -Encoding UTF8 | ConvertFrom-Json).version_migracion
if ($null -eq $versionVuelta43 -or $versionVuelta43 -notin @(0,1)) {
    throw 'El RDS debe tener el esquema previo para arrancar el backend anterior.'
}

foreach ($nombre in ($deploy43 + @('.env','.venv'))) {
    $destino = Join-Path $inst43 $nombre
    if (Test-Path -LiteralPath $destino) {
        Rename-Item -LiteralPath $destino -NewName "$nombre.fallo43-$vuelta43"
    }
    $origen = Join-Path $respaldo43 $nombre
    if ($nombre -eq '.env') { $origen = $envVuelta43 }
    if (Test-Path -LiteralPath $origen) {
        Copy-Item -LiteralPath $origen -Destination $destino -Recurse
    }
}
Grant-Api43
Start-Api43
if ((Get-ScheduledTask -TaskName $https43).State -ne 'Running') { Start-ScheduledTask -TaskName $https43 }
Invoke-RestMethod "$local43/health" -TimeoutSec 10
```

Si necesitas recuperar el proxy y el dominio guardado en E3 sigue vigente, valida el archivo respaldado y ponlo en servicio.

```powershell
$caddyGuardado43 = Join-Path $respaldo43 'Caddyfile'
$caddyFile43 = Join-Path $caddy43 'Caddyfile'
$caddyExe43 = Join-Path $caddy43 'caddy.exe'
& $caddyExe43 validate --config $caddyGuardado43 --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Revisa el Caddyfile respaldado.' }
Copy-Item -LiteralPath $caddyGuardado43 -Destination $caddyFile43 -Force
if ((Get-ScheduledTask -TaskName $https43).State -eq 'Running') {
    & $caddyExe43 reload --config $caddyFile43 --adapter caddyfile --address 127.0.0.1:2019
    if ($LASTEXITCODE -ne 0) { throw 'Revisa los registros del proxy.' }
} else {
    Start-ScheduledTask -TaskName $https43
}
```

En la laptop repite `/health` y `/health/rds` por HTTPS. Si se había publicado el frontend 4.3 y necesitas restaurar también la interfaz anterior, continúa en **Laptop · Recuperar Pages**.

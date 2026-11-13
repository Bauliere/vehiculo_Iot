# CONTROL + MONITOREO · Guía para ponerlo a funcionar

El proyecto sigue en `C:\Users\yolop\Desktop\APInedo\websocket_iot`. La página está en `docs`, la API en `app` y la base de datos continúa en AWS. Se añade monitoreo y una sesión automática a la API existente. No se cambian tablas ni procedimientos.

Los archivos de la interfaz están organizados en `docs/assets/js`, `docs/assets/css` y `docs/assets/images`. `docs/index.html` sigue siendo la entrada de GitHub Pages.

## 1. Qué debes encender

| Elemento | Cuándo se necesita |
|---|---|
| Laboratorio AWS, instancia EC2 y base de datos | Para controlar y consultar datos reales. |
| API de Python y Caddy en la instancia | Para HTTPS y WSS. Normalmente los inician las tareas programadas. |
| Laptop con navegador o teléfono con internet | Para abrir GitHub Pages. No necesitas VS Code, Python local ni mantener el escritorio remoto abierto. |
| ESP y carrito | Solo para comprobar el movimiento físico con la integración que ya tienes. MONITOREO puede comprobar eventos e historial sin encender el carrito. |
| Postman | Para comprobar WSS e historial por separado; no es necesario para usar la página. |

Cerrar la ventana de escritorio remoto no apaga EC2. El cierre automático de tu laboratorio sí puede detener los servicios.

## 2. Comprobar AWS antes de abrir el control

1. Enciende el laboratorio, la base de datos y la instancia. Espera a que estén disponibles.
2. Comprueba que la IP pública de EC2 siga siendo **34.225.114.88**. El dominio actual incluye esa IP. Si cambió, hay que actualizar el despliegue y `docs/assets/js/config.js` antes de continuar.
3. Abre estas direcciones en el navegador de tu laptop:

| Comprobación | Dirección | Resultado esperado |
|---|---|---|
| API | [Salud de la API](https://vehiculo-iot.34-225-114-88.sslip.io/health) | `status: "ok"`. |
| Base de datos | [Diagnóstico RDS](https://vehiculo-iot.34-225-114-88.sslip.io/health/rds) | `status: "ok"` y `database: "RDS"`. |
| Documentación | [Swagger UI](https://vehiculo-iot.34-225-114-88.sslip.io/docs) | Se muestran las operaciones de la API. |

Si no abren, entra al escritorio remoto y ejecuta en PowerShell:

```powershell
Get-ScheduledTask -TaskName 'VehiculoIoT-API','VehiculoIoT-HTTPS' | Select-Object TaskName,State
```

**Running** significa que la tarea está ejecutándose. **Ready** significa que está preparada pero no ejecutándose. Inicia solo la que esté en Ready:

```powershell
Start-ScheduledTask -TaskName 'VehiculoIoT-API'
```

```powershell
Start-ScheduledTask -TaskName 'VehiculoIoT-HTTPS'
```

Espera unos segundos y comprueba la API desde la propia instancia:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/rds' -TimeoutSec 15
```

Si sigue fallando:

```powershell
Get-Content -LiteralPath 'C:\Users\Administrator\Desktop\websocket_iot\logs\api.log' -Tail 30
```

No ejecutes otra copia de `app.main` si la tarea ya está usando el puerto 8000. Si la dirección local responde pero la pública no, revisa Caddy y la IP pública.

### Activar el acceso automático una sola vez

El acceso automático requiere instalar el ZIP de actualización en la instancia y habilitar el modo público. Los cambios de interfaz se publican en GitHub Pages.

**Este modo permite que cualquier visitante controle el vehículo 1.** La sesión dura quince minutos y no concede administración; las claves maestras permanecen en AWS. CORS no convierte este acceso público en privado.

En PowerShell de la instancia, detén solamente la tarea de la API:

```powershell
Stop-ScheduledTask -TaskName 'VehiculoIoT-API'
Start-Sleep -Seconds 2
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
```

El último comando no debe mostrar ninguna escucha. Si muestra un proceso, no arranques otra copia: comprueba si dejaste la API abierta manualmente en otra terminal y ciérrala con Ctrl+C. Caddy puede seguir ejecutándose.
  
Copia `actualizacion_instancia_4_2.zip` desde `C:\Users\yolop\Desktop\APInedo\websocket_iot\apoyo\entrega_4_2` a `C:\Users\Administrator\Desktop\websocket_iot` en el escritorio remoto. Colócalo junto a la carpeta `app`. El ZIP contiene `app/config.py`, `app/security.py`, `app/main.py`, `app/api/public_control.py`, `app/documentation.py` y `app/websocket/websocket_manager.py`.

En PowerShell de la instancia, respalda `app` y extrae el ZIP sobre la raíz del proyecto:

```powershell
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
$copiaApi = Join-Path (Get-Location).Path ('respaldo_app_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
Copy-Item -LiteralPath .\app -Destination $copiaApi -Recurse
Expand-Archive -LiteralPath .\actualizacion_instancia_4_2.zip -DestinationPath . -Force
```

Abre el `.env` de la instancia:

```powershell
notepad 'C:\Users\Administrator\Desktop\websocket_iot\.env'
```

Añade estas líneas, o actualízalas si ya existen. Conserva las claves y datos de conexión actuales:

```dotenv
PUBLIC_CONTROL_ENABLED=true
PUBLIC_CONTROL_VEHICLE_ID=1
```

Guarda y cierra el Bloc de notas. Comprueba la sintaxis y vuelve a iniciar la tarea:

```powershell
Set-Location 'C:\Users\Administrator\Desktop\websocket_iot'
.\.venv\Scripts\python.exe -m py_compile .\app\config.py .\app\security.py .\app\api\public_control.py .\app\main.py
```

Si el comando anterior termina sin error:

```powershell
Start-ScheduledTask -TaskName 'VehiculoIoT-API'
Start-Sleep -Seconds 3
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/rds' -TimeoutSec 15
```

Comprueba la ruta nueva sin imprimir su token:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/control/sesion' -TimeoutSec 15 | Select-Object id_vehiculo,expires_in
```

Debe mostrar **id_vehiculo: 1** y **expires_in: 900**. Repite la comprobación pública desde PowerShell de tu laptop:

```powershell
Invoke-RestMethod -Uri 'https://vehiculo-iot.34-225-114-88.sslip.io/control/sesion' -TimeoutSec 15 | Select-Object id_vehiculo,expires_in
```

- **404:** falta copiar o registrar la ruta nueva, o sigue corriendo la versión anterior.
- **403:** `PUBLIC_CONTROL_ENABLED` no está activado en el proceso que ejecuta la API.
- **503:** revisa la configuración existente de las dos claves del servidor; deben ser diferentes y tener al menos 32 caracteres.
- **No conecta:** revisa las tareas y `logs\api.log` como se indica arriba.

No necesitas cambiar Caddy, instalar paquetes adicionales ni modificar RDS. Para desactivar el acceso público, cambia `PUBLIC_CONTROL_ENABLED=false` y reinicia la API siguiendo el mismo procedimiento. Eso invalida las sesiones temporales anteriores; Swagger y Postman pueden seguir usando las claves de servidor que ya tenías.

## 3. Abrir la versión nueva en tu laptop

Usa una terminal nueva de PowerShell. Copia solo los comandos, sin `PS ...>` ni las líneas que marcan el bloque de código.

```powershell
Set-Location 'C:\Users\yolop\Desktop\APInedo\websocket_iot\docs'
py assets/servidor_local.py
```

Abre [http://127.0.0.1:5500/](http://127.0.0.1:5500/) y pulsa **Ctrl+F5** si ves la interfaz anterior. La terminal queda ocupada mientras sirve la página; es normal. Abre otra terminal para Git o pulsa Ctrl+C cuando quieras detenerla.

Utiliza `assets/servidor_local.py`: entrega correctamente los módulos JavaScript en Windows y sirve la raíz `docs`. No abras `index.html` con doble clic.

## 4. Usar CONTROL

1. Espera **WSS: En línea**, **API: Disponible** y **RDS: Disponible**. Son tres comprobaciones distintas.
2. La página prepara la sesión de control automáticamente. No hay un campo para introducir claves. Si falla, abre **Ajustes → Reconectar** después de completar la actualización de AWS.
3. Pulsa **DETENER** antes de manejar. En MONITOREO puedes revisar la respuesta HTTP de esa acción.
4. Usa el joystick para avanzar, retroceder o girar. Al soltarlo se envía DETENER.
5. Lleva la palanca hacia **Subir** o **Bajar** para accionar la caja. Suéltala para volver al centro y detener.
6. Usa **Luces** y **Sonido** en la barra inferior. Sus indicadores reflejan la alternancia solicitada y observada mediante WSS durante esta sesión. Al abrir la página se desconoce cómo estaban físicamente. DETENER no cambia estos indicadores.
7. Abre **DEMO**. La DEMO 1 se selecciona automáticamente cuando existe y tiene pasos. Elige el recorrido y mantén pulsado **Iniciar DEMO** durante unos 0.9 segundos. **Cancelar** o **DETENER** detienen la secuencia. La animación sigue los pasos recibidos por WSS.

En el teléfono, CONTROL cabe en la pantalla sin desplazar la página. Ajustes y DEMO se abren desde sus botones. En PC se conservan los paneles completos. Las confirmaciones de solicitudes y eventos están en MONITOREO. Pulsa el icono junto a CONTROL para cambiar la paleta.

La sesión temporal se conserva solo en memoria y se renueva automáticamente cuando corresponde. Si falla el acceso, comprueba AWS, usa **Ajustes → Reconectar** y vuelve a confirmar DETENER. Si una parada no se confirma, los movimientos permanecen bloqueados hasta que se confirme.

## 5. Abrir MONITOREO y consultar el historial

1. Pulsa **MONITOREO** en la navegación.
2. Espera la carga del último estado y del historial.
3. Revisa **Movimiento, Fecha y Hora**. Son datos del backend; una fecha ausente no se rellena con la hora de tu dispositivo.
4. El historial contiene como máximo diez registros, del más reciente al más antiguo. En móvil usa los controles de página para consultarlos sin desplazar toda la pantalla.
5. Deja MONITOREO abierto. Una orden enviada desde otro cliente debe cambiar el último estado y actualizar la tabla sin recargar.

La fila 1 es la más reciente; no es el identificador del vehículo ni del comando. Las filas que salen de la tabla siguen existiendo en RDS. Los pasos internos de DEMO pueden verse en el último estado, pero no se añaden al historial individual.

Las consultas exactas del vehículo 1 son:

```text
GET https://vehiculo-iot.34-225-114-88.sslip.io/vehiculos/1/estado
GET https://vehiculo-iot.34-225-114-88.sslip.io/vehiculos/1/historial
```

Puedes abrir ambas en el navegador o pegarlas en una solicitud **HTTP GET** de Postman y pulsar **Send**. No escribas `GET ` dentro del campo de URL de Postman; selecciona GET en el menú.

El código actual fija las conexiones MySQL en UTC. Por eso las fechas de RDS sin sufijo horario se interpretan como UTC. La vista las muestra en **hora de Ciudad de México**, zona `America/Mexico_City`, actualmente UTC−6. No compares una hora UTC del JSON con la hora de la pantalla sin hacer la conversión. El campo WSS `timestamp` es la hora de publicación del evento; `estado.fecha_actualizacion` es la fecha del estado persistido.

## 6. Comprobar WSS con Postman

Esta prueba escucha los eventos. Las órdenes se envían mediante HTTP POST desde CONTROL o Swagger.

1. En Postman selecciona **New → WebSocket**.
2. Pega esta dirección y pulsa **Connect**:

```text
wss://vehiculo-iot.34-225-114-88.sslip.io/ws/vehiculos/1
```

3. Debe aparecer **Connected** y un mensaje `estado_inicial`.
4. Mantén la conexión abierta **antes** de iniciar movimientos. El socket no reproduce los eventos anteriores a tu conexión.
5. Desde tu teléfono, abre CONTROL, espera la conexión automática y envía una orden. Mira Postman en la laptop: debe llegar `movimiento_individual` con `id_vehiculo: 1`.
6. Abre MONITOREO en otra ventana o dispositivo y repite la orden. El último movimiento y el historial deben actualizarse solos.
7. Inicia una DEMO. Debes recibir `demo_inicio`, `demo_movimiento` y, al terminar, `demo_fin`. Una cancelación puede mostrar `demo_cancelada`.

Usar teléfono para CONTROL y laptop para observar evita abandonar la ventana que está manejando: al perder el foco, el control puede enviar una parada de seguridad. No confundas ese DETENER individual con un paso de DEMO.

Para el historial usa el **GET del paso 5**. La URL WSS sirve para eventos en vivo, no para consultar los diez registros guardados.

## 7. Comprobaciones de la práctica

| Prueba | Cómo hacerla | Qué debe ocurrir |
|---|---|---|
| Carga inicial | Abre MONITOREO y DevTools con F12 → Network. Filtra `estado` e `historial`. | Dos GET con respuesta válida y datos coincidentes con la pantalla. |
| Evento externo | Deja MONITOREO abierto y envía un movimiento desde CONTROL en otro dispositivo o desde Swagger. | Cambia el último estado; el evento individual dispara la consulta del historial. |
| Diez registros | Envía más de diez órdenes individuales válidas. Para comprobar solo el límite puedes usar DETENER repetidamente. | Se muestran los diez últimos registros, ordenados y sin repetir `id_historial`. |
| Historial vacío | Si el vehículo ya tiene registros, verifica este caso con las pruebas automatizadas; no borres RDS para fabricar la captura. | La interfaz muestra el estado vacío cuando la API devuelve `[]`. |
| Reconexión | En un dispositivo que solo esté mostrando MONITOREO, desconecta y recupera su Wi-Fi. | WSS cambia de estado, reconecta y vuelve a consultar estado e historial. |
| DEMO | Anota el primer `id_historial`, ejecuta una DEMO completa desde otro cliente y vuelve a consultar el historial. | Los pasos DEMO actualizan el estado y no crean filas individuales. Si enviaste DETENER manual, ese sí puede aparecer. |
| Teléfono | Abre ambas vistas en vertical y horizontal; prueba palanca, barra inferior, acceso y navegación. | CONTROL no exige desplazar la página; no hay controles cortados. MONITOREO permite revisar diez filas mediante sus páginas. |
| Teclado y PC | Navega con Tab y prueba joystick con flechas, palanca y DETENER. | Foco visible, controles utilizables y parada al soltar. |

Una API saludable no garantiza cada operación. WSS abierto tampoco demuestra que la ESP esté conectada. La ejecución física se comprueba mirando el carrito; la página muestra respuestas y eventos del servidor.

## 8. Subir la ampliación al mismo GitHub Pages

Completa primero la actualización de los cuatro archivos de la API y las dos variables del paso 2. Esa actualización habilita el acceso automático. Después prueba la interfaz local y publica el frontend.

En una terminal nueva de tu laptop:

```powershell
Set-Location 'C:\Users\yolop\Desktop\APInedo\websocket_iot'
git branch --show-current
git remote -v
git status --short
```

Comprueba `main` y el remoto `https://github.com/Bauliere/vehiculo_Iot.git`. Después ejecuta uno por uno:

```powershell
$archivos = @('.gitignore','README.md','.env.example','docs','app/main.py','app/config.py','app/security.py','app/api/public_control.py','app/documentation.py','app/websocket/websocket_manager.py','tests/test_public_control.py')
git add -- @archivos
git --no-pager diff --cached --stat -- @archivos
git commit --only -m "Agregar monitoreo IoT y sesion temporal de control" -- @archivos
git push origin main
```

El commit incluye la interfaz, los README, la plantilla sin secretos, la sesión automática y sus dependencias. `@archivos` limita el commit a la lista indicada. Si Git rechaza la subida, revisa los cambios remotos antes de volver a intentarlo.

En [el repositorio](https://github.com/Bauliere/vehiculo_Iot), comprueba **Settings → Pages → Deploy from a branch → main → /docs**. Espera a que el despliegue termine correctamente en **Actions**.

Abre [https://bauliere.github.io/vehiculo_Iot/](https://bauliere.github.io/vehiculo_Iot/) y pulsa Ctrl+F5. En el teléfono, recarga la página. Repite la comprobación de WSS y un movimiento desde la publicación. La versión nueva solo estará en Pages después de este push y su despliegue.

## 9. Capturas que pide la actividad

Estas indicaciones sirven para que tomes tus propias capturas; no son un reporte ni resultados inventados.

| Evidencia | Dónde obtenerla | Descripción breve |
|---|---|---|
| 1. Repositorio original | GitHub → `Bauliere/vehiculo_Iot`, carpeta `docs`, historial de commits y README. | «Ampliación 4.2 en el repositorio original, con módulos de control y monitoreo». |
| 2. Dos vistas | CONTROL y MONITOREO en PC y teléfono; incluye tabla, último estado y créditos. | «Interfaz adaptable con control completo y monitoreo del vehículo». |
| 3. Carga REST | F12 → Network → GET `estado` y GET `historial`; muestra Response y la vista. | «Carga inicial del estado y de los movimientos persistidos». |
| 4. Evento en vivo | Postman WebSocket conectado y MONITOREO, después de una orden desde CONTROL. | «Evento recibido por WSS y actualización sin recargar». |
| 5. Límite y otra sesión | MONITOREO después de más de diez órdenes desde otro cliente; contrasta con GET historial. | «Diez registros recientes, ordenados y sin duplicados». |
| 6. Recuperación y DEMO | Indicadores antes/durante/después de una desconexión, nuevos GET y DEMO observada por WSS. | «Reconexión y sincronización; pasos DEMO separados del historial individual». |
| 7. Publicación real | Barra de dirección de Pages en teléfono físico y enlace del repositorio. | «CONTROL y MONITOREO publicados en el mismo GitHub Pages». |

No muestres claves en las capturas. Si una prueba falla, guarda el error para corregirlo antes de presentarla como aprobada.

## Estado de la verificación

El 12 de noviembre de 2026, salud, RDS, estado e historial respondieron HTTP 200. El historial devolvió diez registros y la DEMO 1 tiene siete pasos. WSS entregó `estado_inicial` para el vehículo 1. `GET /control/sesion` devolvió 404 en la versión instalada en AWS, así que debes completar la actualización del paso 2.

Las pruebas de navegador usan respuestas simuladas. La prueba con el carrito y un teléfono físico se hace después de instalar el ZIP y publicar el frontend.

# Pruebas de la aplicación

Realiza estas pruebas desde la URL publicada en GitHub Pages. Las pruebas locales sirven para preparar la página; no sustituyen la comprobación publicada ni la prueba con un teléfono real.

Para probar primero en tu laptop, detén el servidor local anterior con **Ctrl+C**, si sigue abierto. En PowerShell ejecuta:

```powershell
Set-Location 'C:\Users\yolop\Desktop\APInedo\websocket_iot\docs'
py servidor_local.py
```

Deja esa terminal abierta y abre [http://127.0.0.1:5500/](http://127.0.0.1:5500/). Pulsa **Ctrl+F5** si ya tenías la página abierta. Este servidor corrige el tipo de contenido de JavaScript que el servidor genérico puede enviar incorrectamente en Windows.


## Preparación

1. Completa [CONFIGURAR_AWS.md](CONFIGURAR_AWS.md) y [PUBLICAR_GITHUB.md](PUBLICAR_GITHUB.md).
2. Mantén encendidos el laboratorio, EC2, la API, HTTPS y RDS.
3. Para esta actividad, deja apagados la ESP y el control físico. El objetivo es comprobar solicitudes y eventos, y el firmware ya cargado podría responder si se conecta.
4. Abre la aplicación publicada en tu teléfono: [https://bauliere.github.io/vehiculo_Iot/](https://bauliere.github.io/vehiculo_Iot/), si elegiste ese nombre de repositorio.
5. Introduce la clave de control y pulsa **Activar control**. El campo se vacía y el indicador muestra **Por validar**. Pulsa **DETENER**: una respuesta 200 cambia el indicador a **Validado**. Un 401/403 muestra **No válido**. Evita que la clave aparezca en capturas o en la consola.
6. Comprueba el nombre del vehículo y los tres indicadores. WSS debe mostrar **En línea**; API **Disponible**; RDS **Disponible** solamente tras su diagnóstico.
7. Usa tu laptop para observar los eventos en Postman mientras controlas desde el teléfono. Así no cambias el foco de la página de control durante una DEMO.

La aplicación solicita detener al perder el foco, ocultarse o perder WSS si había una operación. Por eso cambiar de la página de escritorio a Postman durante una secuencia puede cancelarla. En escritorio puedes dejar las ventanas juntas y observar sin cambiar el foco; para la prueba principal es más sencillo teléfono + laptop.

## Abrir el observador independiente en Postman

1. En Postman, crea una solicitud de tipo **WebSocket**. No es una solicitud HTTP GET ni un socket de Socket.IO.
2. Escribe esta dirección completa:

```text
wss://vehiculo-iot.34-225-114-88.sslip.io/ws/vehiculos/1
```

3. Pulsa **Connect**.
4. Espera el mensaje `estado_inicial` con `id_vehiculo: 1`.
5. Déjalo conectado durante las pruebas. No necesitas enviar mensajes por WSS ni poner la clave en la URL.

La página mantiene su propia sesión WSS. Postman es una segunda conexión independiente para comprobar los mismos eventos publicados por el backend. El mensaje inicial muestra un estado almacenado; no ejecuta un movimiento nuevo ni reproduce una DEMO antigua.

## Prueba A · Movimiento individual

1. En el teléfono, mueve el joystick hacia arriba y mantenlo brevemente.
2. Comprueba la indicación de **AVANZAR** en la página.
3. La página debe mostrar la solicitud y luego **Aceptado por API · HTTP 200** si AWS acepta la orden.
4. En Postman busca un evento `movimiento_individual` con `id_vehiculo: 1`, el ID de AVANZAR, su `codigo` y su `timestamp`.
5. Suelta el joystick. Debe volver al centro y solicitar DETENER. Es normal que aparezca otro evento para DETENER.

En el catálogo actual, AVANZAR tiene `id_comando: 1` y `codigo: 1`. Comprueba los valores del evento real; no cambies una captura para que coincida con el ejemplo.

Para revisar la petición en escritorio, abre **F12 → Network → Fetch/XHR** y selecciona `movimientos`. En **Payload** se observa el cuerpo y en **Response** la respuesta. No captures los encabezados que contienen la clave.

Ejemplo del cuerpo que genera la interfaz al avanzar con el catálogo actual:

```json
{"id_comando": 1, "origen": "API"}
```

## Prueba B · Cambio de dirección y detención

1. Arrastra el joystick hacia arriba.
2. Sin soltar, cambia claramente hacia la derecha y espera la aceptación.
3. Suelta el joystick.
4. En Postman identifica AVANZAR, GIRAR_DERECHA y DETENER en ese orden, según las transiciones que efectivamente enviaste.
5. Repite pequeños movimientos del puntero dentro de la misma dirección: no debe generarse un POST por cada píxel.
6. Pulsa el botón **DETENER** durante una petición pendiente y comprueba que la interfaz no vuelva a mostrarla como acción actual al llegar su respuesta tardía.

La app conserva la última dirección pendiente para evitar ráfagas. Si cambias y sueltas demasiado rápido, puede descartar una dirección que aún no se enviaba; no debes esperar un evento para una solicitud descartada. En una parada con un POST en curso puede aparecer un segundo DETENER: reafirma la parada después de esa escritura, no es una repetición por arrastre.

## Prueba C · DEMO completa y cancelación

1. En la aplicación selecciona una DEMO existente en el desplegable.
2. Comprueba que muestra el número de pasos y el tiempo estimado. Esos datos se consultan a AWS.
3. Pulsa **Iniciar DEMO** una sola vez.
4. La aceptación HTTP debe ser 202. Esto significa que el servidor aceptó iniciar la tarea; el resultado llega por eventos.
5. Mantén la aplicación visible. En Postman observa `demo_inicio`, los N `demo_movimiento` y finalmente `demo_fin`.
6. En cada paso revisa `id_demo`, `orden`, `comando`, `codigo`, `duracion_ms` y `pausa_ms`. El servidor controla la secuencia; la página no inventa sus movimientos.
7. Inicia de nuevo la misma DEMO y, antes de terminar, pulsa **Cancelar** o **DETENER**.
8. Comprueba `demo_cancelada` y la respuesta de cancelación. La interfaz después solicita DETENER mediante el endpoint de movimientos.

Mientras la DEMO está activa, el inicio duplicado y los controles incompatibles deben quedar bloqueados. Si otra pestaña inició una DEMO, el backend también puede devolver 409.

Los pasos internos de la DEMO no generan historial individual. El POST adicional de DETENER que hace la interfaz sí es un movimiento individual y puede aparecer en el historial. Esta distinción evita interpretar ese registro como si cada paso de la DEMO se hubiera guardado.

Si aparece 409 después de abrir la página a mitad de una DEMO y no recibes eventos que indiquen su ID, consulta qué DEMO estabas ejecutando y cancélala en Swagger. El backend actual no tiene una consulta de ejecución activa que permita recuperarla inmediatamente al recargar.

## Prueba D · Indicadores separados y recuperación

### D1. Conexión WSS

1. Comprueba los tres indicadores cuando la aplicación funciona.
2. En el navegador de escritorio abre **F12 → Network** y selecciona **Offline**. Espera a que la app detecte la pérdida de conexión.
3. WSS debe abandonar **En línea** y pasar a desconectado o reconectando. API puede pasar a no disponible cuando venza su comprobación; RDS debe quedar sin verificar al no recibir diagnóstico.
4. Regresa a **No throttling / Online** y deja visible la página. Comprueba la reconexión sin volver a cargarla. Espera hasta el siguiente intento, que puede demorarse hasta unos 30 segundos.
5. El estado inicial recibido al reconectar no debe ejecutar órdenes viejas.

Desconectar solamente el WSS de Postman no debe cambiar el indicador WSS de la página: son sesiones diferentes. Puedes comprobarlo como prueba adicional de independencia.

### D2. API HTTPS sin confundirla con WSS

Para demostrarlo sin apagar AWS, usa el bloqueo de solicitudes de DevTools en el navegador de escritorio:

1. Abre el menú de DevTools **More tools → Network request blocking**, o busca **Show Network request blocking** en su menú de comandos.
2. Agrega el patrón `*vehiculo-iot.34-225-114-88.sslip.io/health*` y habilita el bloqueo. Esto bloquea las comprobaciones HTTP de esa pestaña; no apaga EC2 ni RDS.
3. Pulsa el botón de volver a comprobar en la app o espera al siguiente chequeo.
4. API debe mostrar **No disponible**; RDS **Sin verificar**. La sesión WSS puede seguir **En línea**.
5. Deshabilita el bloqueo y vuelve a comprobar. API y RDS deben recuperar su estado al recibir respuestas válidas.

Identifica esta prueba como una **interrupción de acceso HTTP simulada desde el navegador**, no como una caída real de AWS. No actives movimientos durante la prueba de fallo.

### D3. Diagnóstico real de RDS

Abre [https://vehiculo-iot.34-225-114-88.sslip.io/health/rds](https://vehiculo-iot.34-225-114-88.sslip.io/health/rds) y revisa la respuesta junto con la URL. Si devuelve `status: ok` y `database: RDS`, hay una comprobación de lectura real desde el backend.

No necesitas apagar la base para hacer esta prueba. Si no hay diagnóstico accesible, documenta **Sin verificar**. Si la API devuelve 503 con el error de dependencia reconocido, la aplicación muestra RDS no disponible. Un timeout o error CORS por sí solo no demuestra una caída de la base.

## Prueba E · Pantallas, teclado y favicon

1. En un teléfono real abre la URL publicada en vertical.
2. Comprueba joystick, botones, DETENER, selector de DEMO y textos, sin desbordamiento horizontal.
3. Gira el teléfono a horizontal y repite la comprobación. Si hay desplazamiento vertical, DETENER debe seguir siendo accesible y ningún elemento debe cubrir otro.
4. En escritorio usa Tab para recorrer los controles: el foco debe ser visible.
5. Con el joystick enfocado, usa las flechas y suéltalas para detener. Prueba también el mouse.
6. Haz zoom de texto si lo necesitas y comprueba que no se corten etiquetas.
7. En la pestaña del navegador de escritorio comprueba el favicon. Al final del contenido revisa los créditos con tu nombre completo.

La emulación de móvil en DevTools ayuda a revisar tamaños, pero no sustituye la prueba desde un teléfono real.

## Errores que pueden aparecer

| Resultado | Qué hacer |
|---|---|
| Controles deshabilitados | Revisa catálogo, clave introducida, API y WSS disponibles. No basta con escribir una clave si AWS está apagado. |
| El campo de clave se vacía sin confirmación y todos los indicadores quedan pendientes | En local, usa `py servidor_local.py` y recarga con Ctrl+F5. JavaScript puede no haberse cargado por un tipo de contenido incorrecto. |
| 401 | Revisa el valor de `API_CONTROL_KEY`, sin nombre de variable, espacios extra ni comillas. |
| 403 | La clave no permite esa operación; CONTROL solo necesita movimientos y DEMO. |
| 404 | El vehículo o la DEMO ya no existe; consulta el catálogo en Swagger. |
| 409 | Puede haber una DEMO activa o un recurso incompatible; cancela la ejecución correcta antes de mover. |
| 422 | Revisa el contrato y que los IDs sean números enteros. |
| 503 | Revisa configuración y dependencia del backend; un diagnóstico no es prueba de movimiento físico. |
| Error de red/CORS | Sigue `CONFIGURAR_AWS.md`, confirma IP y certificado y revisa el origen permitido. |
| DEMO termina al cambiar de ventana | La página solicita detener al perder el foco. Usa el teléfono como control y Postman en la laptop. |
| Solo llega `estado_inicial` | Conecta WSS antes de accionar. Las órdenes pasadas no se reproducen al abrir el socket. |



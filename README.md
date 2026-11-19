# Máquina de carga IoT

Plataforma web de control, monitoreo y administración de unidades IoT. Control incluye joystick, caja, luces, sonido, DETENER y recorridos. Monitoreo muestra el último estado y hasta diez movimientos individuales de RDS. Administración gestiona modelos, unidades, clientes, asignaciones, demostraciones y auditoría.

[GitHub Pages](https://bauliere.github.io/vehiculo_Iot/) · [Swagger UI](https://vehiculo-iot.34-225-114-88.sslip.io/docs) · [Guía de instalación y pruebas](docs/guia/MONITOREO_4_2.md)

[Actividad 4.3 · Contratos, diagrama y pruebas](docs/guia/ACTIVIDAD_4_3.md) · [Despliegue en EC2 y GitHub](docs/guia/DESPLEGAR_4_3.md)

## Abrir en local

Desde la raíz del repositorio, con Python instalado:

```powershell
cd docs
py assets/servidor_local.py
```

Abre [http://127.0.0.1:5500/](http://127.0.0.1:5500/). Mantén la terminal abierta y pulsa Ctrl+C para detener el servidor. La interfaz usa la API de AWS configurada en `docs/assets/js/config.js`. En GitHub Pages basta con un navegador y conexión a internet.

Para una API local en el puerto 8000 usa [127.0.0.1:5500/?api=local](http://127.0.0.1:5500/?api=local). Configura el backend para la copia MySQL de ensayo y arráncalo con `python -m app.main`. Las variables de despliegue se documentan en `.env.example`. `COMMERCIAL_ENABLED` activa 4.3 y `EXHIBITION_ENABLED` habilita reservas en unidades preparadas.

| Rol | Acceso |
| --- | --- |
| Administrador | Inventario, clientes, asignaciones, demostraciones de empresa y auditoría. Control y monitoreo cuando un comprador autoriza soporte. |
| Usuario | Unidades asignadas, Control, Monitoreo, demos privadas y autorización temporal de soporte. |
| Invitado | Catálogo público y reserva exclusiva de una unidad de exhibición durante un minuto. |

## Manejo y monitoreo

- Arrastra el joystick o usa las flechas del teclado con el joystick enfocado. La palanca de la caja responde al arrastre, toque y flechas verticales. Al soltar se solicita DETENER.
- Luces y sonido alternan con cada pulsación. Sus LEDs reflejan la alternancia observada durante la sesión. La comprobación del estado físico se hace en el carrito.
- La DEMO 1 se carga si está activa. Elige el recorrido y mantén pulsado **Iniciar DEMO** hasta que se llene el botón. Los eventos de cada paso iluminan o mueven el control correspondiente. DETENER tiene prioridad sobre la secuencia.
- Monitoreo consulta estado e historial por REST, recibe eventos por el mismo WSS y recupera datos cuando vuelve la conexión. El historial muestra hasta diez filas persistidas, en hora de Ciudad de México. Los pasos internos de DEMO actualizan el estado y quedan fuera del historial individual.
- CONTROL y MONITOREO caben en la pantalla del teléfono y la laptop. En horizontal, la barra de acciones queda al costado en el teléfono. El historial se consulta por páginas cuando hace falta. Pulsa el icono junto a CONTROL / IoT para cambiar la paleta, incluida Rojo grafito.
- Pantalla completa enfoca Control. Abre Fausto.IA sobre la barra de mandos para interpretar texto o voz y ejecutar el recorrido autorizado. En 4.3, las modificaciones persistentes se hacen en Administración. [Configuración de Fausto.IA](docs/README.md#faustoia-y-pantalla-completa).

## Estructura

| Ruta | Contenido |
|---|---|
| `docs/index.html` | Navegación y vistas integradas, incluido el catálogo de exhibición |
| `docs/assets/css`, `docs/assets/images`, `docs/assets/vendor` | Estilos, imágenes, favicon y Bootstrap |
| `docs/assets/js/components` | Vistas, navegación, joystick, palanca y animaciones |
| `docs/assets/js/controllers`, `domain`, `state` | Órdenes, catálogo y sincronización |
| `docs/assets/js/services` | REST, sesión temporal, WSS y diagnóstico |
| `docs/assets/react-bits` | Componentes visuales y configuración para compilarlos |
| `app/api`, `app/services` | Rutas FastAPI y reglas de negocio |
| `app/database.py`, `app/websocket` | Conexión TLS con RDS y distribución de eventos |
| `docs/tests`, `tests` | Pruebas de la interfaz y autorización |

FastAPI corre en EC2, detrás de Caddy. La base `vehiculo_iot` conserva los 21 procedimientos almacenados. El navegador consulta `GET /vehiculos/1/estado`, `GET /vehiculos/1/historial` y escucha `/ws/vehiculos/1`. `/health` comprueba la API y `/health/rds` comprueba la lectura de RDS.

## Acceso automático de 4.1 y 4.2

Con el modo comercial desactivado, `GET /control/sesion` entrega una sesión de 15 minutos para movimientos y DEMO del vehículo configurado. El navegador la guarda en memoria. Las claves maestras se configuran en el `.env` de la instancia.

El modo está desactivado por defecto. Al activar `PUBLIC_CONTROL_ENABLED=true` con `PUBLIC_CONTROL_VEHICLE_ID=1`, cualquier visitante puede operar el vehículo 1. Las operaciones administrativas requieren su clave. Para cerrar el acceso público, cambia la variable a `false` y reinicia `VehiculoIoT-API`.

La guía explica dónde extraer el ZIP, cómo reiniciar la tarea y cómo comprobar la sesión en AWS. GitHub Pages publica `main` desde `/docs`. Publica la interfaz después de comprobar `/control/sesion` en la instancia. [Pasos para AWS y Git](docs/guia/MONITOREO_4_2.md)

## Pruebas

Desde `docs`, con Node.js:

```powershell
node --test tests/*.test.js
```

Desde la raíz, con el entorno virtual de la API preparado:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests
```

La guía 4.3 identifica qué pruebas usan respuestas interceptadas y cuáles usan una copia MySQL con un cliente WSS de dispositivo. [Matriz y ejecución local](docs/guia/ACTIVIDAD_4_3.md#evidencias-y-pendientes-de-actividad).

## Efectos visuales

CRT Warp es el fondo inicial. El botón con el icono de fotografía alterna con Rectángulos y recuerda la elección. Ambos fondos usan la paleta activa. Los archivos compilados están incluidos en `docs/assets/vendor`, así que la página se sigue sirviendo como sitio estático. [CRT Warp de React Bits](https://reactbits.dev/c/backgrounds/crt-warp).

Si editas los componentes en `docs/assets/react-bits`, recompílalos desde `docs` con Node.js y pnpm:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
node assets/react-bits/build.mjs
```

Los componentes proceden del catálogo de React Bits. Los créditos y las licencias están en [iot-effects.LICENSE.txt](docs/assets/vendor/iot-effects.LICENSE.txt).

**Amador Ramírez Jesús Gabriel · 2026**  
Soluciones IoT · Profesor: Víctor Manuel Pinedo Fernández

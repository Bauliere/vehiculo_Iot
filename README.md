# Máquina de carga IoT

Aplicación web para controlar y monitorear un vehículo a distancia. CONTROL incluye joystick, palanca de caja, luces, sonido, DETENER y recorridos DEMO. MONITOREO muestra el último movimiento reportado, las respuestas de las órdenes y los diez movimientos individuales más recientes guardados en Amazon RDS.

[GitHub Pages](https://bauliere.github.io/vehiculo_Iot/) · [Swagger UI](https://vehiculo-iot.34-225-114-88.sslip.io/docs) · [Guía de instalación y pruebas](docs/guia/MONITOREO_4_2.md)

## Abrir en local

Desde la raíz del repositorio, con Python instalado:

```powershell
cd docs
py assets/servidor_local.py
```

Abre [http://127.0.0.1:5500/](http://127.0.0.1:5500/). Mantén la terminal abierta y pulsa Ctrl+C para detener el servidor. La interfaz usa la API de AWS configurada en `docs/assets/js/config.js`. En GitHub Pages basta con un navegador y conexión a internet.

## Manejo y monitoreo

- Arrastra el joystick o usa las flechas del teclado con el joystick enfocado. La palanca de la caja responde al arrastre, toque y flechas verticales. Al soltar se solicita DETENER.
- Luces y sonido alternan con cada pulsación. Sus LEDs reflejan la alternancia observada durante la sesión. La comprobación del estado físico se hace en el carrito.
- La DEMO 1 se carga si está activa. Puedes elegir otro recorrido. Los eventos de cada paso iluminan o mueven el control correspondiente. DETENER tiene prioridad sobre la secuencia.
- Monitoreo consulta estado e historial por REST, recibe eventos por el mismo WSS y recupera datos cuando vuelve la conexión. El historial muestra hasta diez filas persistidas, en hora de Ciudad de México. Los pasos internos de DEMO actualizan el estado y quedan fuera del historial individual.
- CONTROL y MONITOREO caben en la pantalla del teléfono y la laptop. En horizontal, la barra de acciones queda al costado en el teléfono. El historial se consulta por páginas cuando hace falta. Pulsa el icono junto a CONTROL / IoT para cambiar la paleta, incluida Rojo grafito.

## Estructura

| Ruta | Contenido |
|---|---|
| `docs/index.html` | Página de CONTROL y MONITOREO |
| `docs/assets/css`, `docs/assets/images`, `docs/assets/vendor` | Estilos, imágenes, favicon y Bootstrap |
| `docs/assets/js/components` | Vistas, navegación, joystick, palanca y animaciones |
| `docs/assets/js/controllers`, `domain`, `state` | Órdenes, catálogo y sincronización |
| `docs/assets/js/services` | REST, sesión temporal, WSS y diagnóstico |
| `app/api`, `app/services` | Rutas FastAPI y reglas de negocio |
| `app/database.py`, `app/websocket` | Conexión TLS con RDS y distribución de eventos |
| `docs/tests`, `tests` | Pruebas de la interfaz y autorización |

FastAPI corre en EC2, detrás de Caddy. La base `vehiculo_iot` conserva los 21 procedimientos almacenados. El navegador consulta `GET /vehiculos/1/estado`, `GET /vehiculos/1/historial` y escucha `/ws/vehiculos/1`. `/health` comprueba la API y `/health/rds` comprueba la lectura de RDS.

## Acceso automático en AWS

`GET /control/sesion` entrega una sesión de 15 minutos para movimientos y DEMO del vehículo configurado. El navegador la guarda en memoria. Las claves maestras se configuran en el `.env` de la instancia.

El modo está desactivado por defecto. Al activar `PUBLIC_CONTROL_ENABLED=true` con `PUBLIC_CONTROL_VEHICLE_ID=1`, cualquier visitante puede operar el vehículo 1. Las operaciones administrativas requieren su clave. Para cerrar el acceso público, cambia la variable a `false` y reinicia `VehiculoIoT-API`.

La guía explica dónde extraer el ZIP, cómo reiniciar la tarea y cómo comprobar la sesión en AWS. GitHub Pages publica `main` desde `/docs`. Publica la interfaz después de comprobar `/control/sesion` en la instancia. [Pasos para AWS y Git](docs/guia/MONITOREO_4_2.md)

## Pruebas

Desde `docs`, con Node.js:

```powershell
node --test tests/*.test.js
```

Desde la raíz, con el entorno virtual de la API preparado:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_public_control.py
```

Las pruebas de navegador usan respuestas REST y WSS de prueba. En la guía están los pasos para comprobar el WSS y el historial reales con Postman.

**Amador Ramírez Jesús Gabriel · 2026**  
Soluciones IoT · Profesor: Víctor Manuel Pinedo Fernández

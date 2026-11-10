# Control IoT · Máquina de carga

Panel web para conducir una máquina de carga, controlar caja, luces y sonido, y ejecutar recorridos DEMO. Está hecho con HTML, CSS, Bootstrap y JavaScript orientado a objetos. Envía órdenes por HTTPS a FastAPI y recibe eventos por WSS; la API utiliza Amazon RDS.

[Aplicación](https://bauliere.github.io/vehiculo_Iot/) · [Swagger UI](https://vehiculo-iot.34-225-114-88.sslip.io/docs)

## Ejecutar en local

Requiere Python 3 y la API de AWS disponible. Desde la raíz del repositorio:

```powershell
cd docs
py servidor_local.py
```

Abre [http://127.0.0.1:5500/](http://127.0.0.1:5500/) y mantén la terminal abierta. Para detener el servidor, pulsa Ctrl+C.

## Configuración y uso

La dirección de la API y el vehículo se configuran en `js/config.js`. El backend debe permitir el origen de la página mediante CORS.

1. Espera a que los indicadores de API, RDS y WSS estén disponibles.
2. Abre **Acceso de control**, introduce la clave y pulsa **Activar control**. La clave permanece en memoria y se elimina al recargar; no debe guardarse en el repositorio.
3. Usa el joystick o las flechas del teclado. Al soltar se envía **DETENER**. Los botones adicionales controlan la caja, las luces y el sonido.
4. Selecciona una DEMO para consultar su secuencia, iniciarla o cancelarla. **DETENER** también cancela la DEMO conocida.

Pulsa el icono junto a **CONTROL / IoT** para cambiar entre Bosque, Gris violeta, EVA-01 y Rosa claro. La paleta se recuerda en el navegador. El indicador de acceso pasa de **Por validar** a **Validado** cuando la API acepta una orden.

Si una parada no se confirma, los movimientos quedan bloqueados hasta que se pueda confirmar DETENER. Los eventos WSS confirman la orden del servidor, no el movimiento físico del vehículo.

Un error 401 indica que la API rechazó la clave. Sustitúyela en **Acceso de control** y vuelve a pulsar **DETENER**. Localhost y Pages mantienen claves independientes.

## Código

`js/app.js` conecta las clases del proyecto. `components/` maneja la interfaz, `controllers/` coordina las órdenes, `services/` comunica con la API y WSS, `domain/` valida el catálogo y `state/` conserva el estado de la página. Los estilos están en `css/` y los recursos en `assets/`.

## Pruebas

Con Node.js, desde `docs/`:

```powershell
node --test tests/*.test.js
```

Las pruebas usan servicios simulados. Las comprobaciones manuales están en [PRUEBAS.md](guia/PRUEBAS.md).

## Publicación

GitHub Pages publica la carpeta `/docs` de la rama `main`. Consulta [PUBLICAR_GITHUB.md](guia/PUBLICAR_GITHUB.md) y [CONFIGURAR_AWS.md](guia/CONFIGURAR_AWS.md) para configurar el despliegue y CORS.

## Créditos

**Autor:** Amador Ramírez Jesús Gabriel · 2026

**Profesor:** Víctor Manuel Pinedo Fernández

**Materia:** Soluciones IoT

# Publicar usando tu repositorio vehiculo_Iot

Usaremos tu repositorio existente: [Bauliere/vehiculo_Iot](https://github.com/Bauliere/vehiculo_Iot).

No necesitas crear otro proyecto de Git ni de VS Code. Abre `C:\Users\yolop\Desktop\APInedo\websocket_iot`: el backend sigue en `app/` y el frontend está en `docs/`. GitHub Pages publicará solamente `docs/`; Python seguirá ejecutándose en AWS.

## 1. Revisar antes de subir

En una terminal nueva de PowerShell copia solo los comandos, sin `PS ...>`, `(.venv)` ni las líneas de tres acentos.

```powershell
Set-Location 'C:\Users\yolop\Desktop\APInedo\websocket_iot'
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status --short
```

Comprueba que la raíz termine en `/APInedo/websocket_iot`, la rama sea `main` y `origin` apunte a `https://github.com/Bauliere/vehiculo_Iot.git`. Ya están configurados: no repitas `git init` ni `git remote add`.

Es normal ver también modificaciones anteriores de `app/` o `Postman.json`. Los siguientes comandos guardan únicamente el frontend, conservando esos cambios.

## 2. Guardar y subir

Ejecuta uno por uno:

```powershell
git add -- docs
```

```powershell
git --no-pager diff --cached --stat -- docs
```

Revisa que aparezcan HTML, CSS, JavaScript, favicon e instrucciones dentro de `docs/`. Los archivos privados y temporales están excluidos mediante `.gitignore`.

```powershell
git commit --only -m "Agregar frontend de control IoT" -- docs
```

`--only` limita este commit a `docs`, incluso si habías preparado otros archivos. No se descarta ni elimina ningún cambio del backend.

```powershell
git push origin main
```

Si aparece la autenticación de GitHub, completa el inicio de sesión en su ventana. Si Git pide tu identidad, configura una vez estos datos en el repositorio y repite el commit:

```powershell
git config user.name "Amador Ramírez Jesús Gabriel"
git config user.email "TU_CORREO_DE_GITHUB"
```

Sustituye el correo de ejemplo por el de tu cuenta o tu dirección privada noreply de GitHub. Si una subida es rechazada por cambios remotos, no uses `--force`: hay que revisar e integrar esos cambios. Si no hay cambios para guardar, no necesitas repetir el commit.

## 3. Activar GitHub Pages

En [tu repositorio](https://github.com/Bauliere/vehiculo_Iot):

1. Entra en **Settings → Pages**.
2. Selecciona **Build and deployment → Source → Deploy from a branch**.
3. Selecciona **Branch: main**.
4. Selecciona **Folder: /docs**.
5. Pulsa **Save** y espera la publicación en **Actions**.

La dirección esperada es [https://bauliere.github.io/vehiculo_Iot/](https://bauliere.github.io/vehiculo_Iot/). No se considera publicada hasta que GitHub confirme el despliegue.

GitHub admite una rama y su carpeta `/docs` como origen de publicación. [Documentación oficial de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## 4. Probar desde cualquier dispositivo

Abre la misma dirección pública desde tu teléfono, tableta o computadora. Completa [el ajuste de CORS en AWS](CONFIGURAR_AWS.md), introduce tu clave de control y sigue [las pruebas](PRUEBAS.md).

CORS permite el origen `https://bauliere.github.io`, sin `/vehiculo_Iot/`. No registra el teléfono, el navegador ni la IP del visitante.

## 5. Subir cambios posteriores

Desde `websocket_iot`:

```powershell
git add -- docs
git --no-pager diff --cached --stat -- docs
git commit --only -m "Actualizar interfaz de control IoT" -- docs
git push origin main
```

Pages actualizará la misma dirección. No vuelvas a crear el repositorio ni agregues otro remoto.

## Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| Aparece `:` en la terminal | Pulsa `q` para salir del visor de Git. |
| Aparece `>>` | Pulsa Ctrl+C y vuelve a pegar solamente el comando completo. |
| Aviso LF/CRLF | Es un aviso de saltos de línea; no significa que la subida haya fallado. |
| Pages muestra 404 | Revisa `main`, `/docs` y `docs/index.html`. |
| La página abre pero no controla | Comprueba AWS, CORS, HTTPS/WSS y la clave de control. |
| Los cuatro controles están deshabilitados | Espera el catálogo, API/WSS disponibles y activa tu clave. |
| La clave se borra al recargar | Es normal: vive únicamente en la memoria de esa pestaña. |

# Mi Dinero

Aplicación web estática de finanzas personales, preparada para GitHub Pages.

## Publicación

La rama `main` contiene directamente el sitio. GitHub Pages debe configurarse
con **Deploy from a branch**, usando la rama `main` y la carpeta `/ (root)`.

La URL esperada es:

https://cmiguezd.github.io/mi-dinero/

## Privacidad y datos

Este repositorio público no contiene movimientos, presupuestos, transferencias,
préstamos, respaldos ni credenciales.

La aplicación guarda la información en `localStorage` del navegador. Desde
**Configuración** se puede importar o exportar un respaldo JSON. Los datos
importados permanecen solamente en ese navegador y no se suben a GitHub.

Para sincronizar varios dispositivos será necesario conectar un backend privado
autenticado. Las credenciales de Google Drive o Google Sheets nunca deben
incluirse en este repositorio ni en el JavaScript del navegador.

## Desarrollo local

No requiere compilación. Abre `index.html` o sirve la carpeta con cualquier
servidor HTTP estático.

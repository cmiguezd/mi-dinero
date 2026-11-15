# Mi Dinero

Aplicación web de finanzas familiares (China y Colombia), publicada en GitHub Pages:
https://cmiguezd.github.io/mi-dinero/

## Cómo funciona

- **Datos:** se guardan en un Google Sheet privado (hoja oculta `_AppState`) y se
  sincronizan entre dispositivos. El repositorio público no contiene datos financieros
  ni credenciales.
- **Sesión de Google:** el token dura una hora y se renueva con el siguiente toque.
- **Archivos principales:**
  - `app.js`: estado, cálculos (cierres de mes, saldos, préstamos) y pantallas.
  - `ui.js`: gráficos, formularios, atajos por uso histórico y separación comercio/detalle.
  - `cloud-sync.js`: conexión con Google Sheets.
  - `styles.css` + `theme.css`: estilos (tema grafito con verde neón y amarillo).

## Pruebas de cálculos

Antes de publicar cambios que toquen la lógica:

```sh
sh tests/run.sh
```

Compara los resultados de todas las funciones de cálculo, con datos sintéticos de
13 meses, contra `tests/golden.json`. Si algo cambia, muestra la diferencia.

## Publicación

GitHub Pages publica la rama `main` desde la raíz. Los cambios se hacen en una rama
y entran por Pull Request.

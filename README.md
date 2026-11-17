# Mi Dinero

Aplicación web de finanzas familiares (China y Colombia), publicada en GitHub Pages:
https://cmiguezd.github.io/mi-dinero/

## Cómo funciona

- **Datos:** se guardan en un Google Sheet privado (hoja oculta `_AppState`) y se
  sincronizan entre dispositivos. El repositorio público no contiene datos financieros
  ni credenciales.
- **Sesión y guardado:** la URL del despliegue está en `cloud-config.js` y activa el modo rápido
  en todos los dispositivos. Cada dispositivo se vincula con Google una vez; los movimientos
  se guardan localmente al instante y se sincronizan registro por registro, incluso al recuperar
  la conexión. La URL no se vuelve a pedir en cada dispositivo. La conexión OAuth directa queda
  disponible como alternativa si se retira la configuración del Apps Script.
- **Archivos principales:**
  - `app.js`: estado, cálculos (cierres de mes, saldos, préstamos) y pantallas.
  - `ui.js`: gráficos, formularios, atajos por uso histórico y separación comercio/detalle.
  - `sync-core.js`: mezcla de cambios entre dispositivos (la misma lógica corre en el Apps Script).
  - `script-sync.js`: modo rápido con vínculo de dispositivo (cola local, envío y consulta cada 10 s).
  - `cloud-sync.js`: conexión directa anterior, como alternativa cuando no hay Apps Script configurado.
  - `apps-script/Code.gs`: servidor que se instala en el Google Sheet.
  - `sw.js`: permite abrir la app sin conexión.
  - `styles.css` + `theme.css`: estilos (tema grafito con verde neón y amarillo).

## Pruebas de cálculos

Antes de publicar cambios que toquen la lógica:

```sh
sh tests/run.sh          # cálculos idénticos a la referencia
node tests/sync.test.js  # escenarios entre dispositivos (sin conexión, conflictos, borrados)
node tests/gas-server.js # corre apps-script/Code.gs localmente con Google simulado
```

Compara los resultados de todas las funciones de cálculo, con datos sintéticos de
13 meses, contra `tests/golden.json`. Si algo cambia, muestra la diferencia.

## Publicación

GitHub Pages publica la rama `main` desde la raíz. Los cambios se hacen en una rama
y entran por Pull Request.

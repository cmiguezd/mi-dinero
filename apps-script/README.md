# Conexión sin login (Google Apps Script)

Con esto Mi Dinero:

- **No vuelve a pedir iniciar sesión cada hora.** Cada dispositivo se vincula una sola vez con tu cuenta de Google.
- **Guarda aunque no haya internet.** Los cambios quedan en el dispositivo y se envían solos al volver la conexión.
- **Mezcla registro por registro.** Si dos dispositivos cambian cosas distintas, se conservan todas; si cambian el mismo movimiento, gana la edición más reciente y el otro dispositivo recibe un aviso.

Los datos siguen en el mismo Google Sheet. El script se ejecuta con tu cuenta y solo acepta dispositivos que vinculaste iniciando sesión con tu Google.

## Instalación (una sola vez, unos 10 minutos)

1. Abre tu **Google Sheet de Mi Dinero** (el que tiene la hoja oculta `_AppState`).
2. Menú **Extensiones → Apps Script**.
3. Borra lo que haya en `Code.gs` y pega **todo** el contenido de
   [`Code.gs`](https://raw.githubusercontent.com/cmiguezd/mi-dinero/main/apps-script/Code.gs). Guarda (ícono de disquete).
4. Arriba, en el selector de funciones, elige **`probarLectura`** y pulsa **Ejecutar**.
   - Google pedirá permisos. Verás "Google no verificó esta app": es normal porque el script es tuyo.
     Pulsa **Configuración avanzada → Ir a … (no seguro) → Permitir**.
   - En el registro debe aparecer `Versión: … · movimientos: N`. Si sale el número de tus movimientos, la lectura funciona.
5. **Implementar → Nueva implementación**.
   - Tipo (ícono de engranaje): **Aplicación web**.
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**. Es necesario para que la app llegue al script; el script rechaza a cualquiera que no hayas vinculado con tu cuenta.
   - **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).
6. En la app, en el computador: **Configuración → Conexión sin login**, pega la URL y pulsa **Activar**.
   Luego pulsa **Continuar con Google** una sola vez.
7. En el iPhone y el iPad abre este enlace (reemplaza `URL` por la tuya) y vincula con Google una vez en cada uno:

   ```
   https://cmiguezd.github.io/mi-dinero/?script=URL
   ```

## Opcional: dar acceso a otra cuenta

Si tu esposa quiere vincular su propio dispositivo con su cuenta de Google:
Apps Script → **Configuración del proyecto (engranaje) → Propiedades del script → Agregar propiedad**:
`ALLOWED_EMAILS` = `correo@gmail.com` (varios separados por coma).

## Si actualizas el script en el futuro

**Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar.**
Así la URL no cambia y los dispositivos siguen vinculados.

## Desvincular un dispositivo perdido

Desde cualquier otro dispositivo: **Configuración → Conexión sin login → Desvincular**.
Ese dispositivo pierde el acceso de inmediato.

## Volver al modo anterior

**Configuración → Conexión sin login → Volver al modo anterior** (en cada dispositivo).
Los datos no cambian: siguen en el mismo Sheet.

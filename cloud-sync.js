(() => {
  const config = window.MI_DINERO_CLOUD_CONFIG || {};
  const TOKEN_KEY = "mi-dinero-google-token";
  const LOCAL_STATE_KEY = "mi-dinero-v3";
  const LOCAL_MIGRATION_KEY = "mi-dinero-cloud-migration-v1";
  let tokenClient = null;
  let syncing = false;

  const configured = () => Boolean(config.clientId && config.spreadsheetId);
  const getToken = () => sessionStorage.getItem(TOKEN_KEY) || "";
  const localMigrationPending = () => Boolean(localStorage.getItem(LOCAL_STATE_KEY)) && localStorage.getItem(LOCAL_MIGRATION_KEY) !== "complete";
  const setStatus = (text, tone = "") => {
    window.miDineroCloudStatus = { text, tone };
    const el = document.querySelector("#cloudStatus");
    if (el) {
      el.textContent = text;
      el.dataset.tone = tone;
    }
  };

  function friendlyError(error) {
    const code = error?.type || error?.error || error?.message || String(error || "");
    const description = error?.error_description || "";
    if (/popup_failed_to_open/i.test(code)) return "El navegador bloqueó la ventana de Google. Habilita las ventanas emergentes y vuelve a intentar.";
    if (/popup_closed/i.test(code)) return "La ventana de Google se cerró antes de autorizar el acceso.";
    if (/access_denied/i.test(code)) return "Google rechazó el acceso. Entra con carlosmiguez13@gmail.com y acepta los permisos.";
    if (/invalid_client|origin|redirect_uri_mismatch/i.test(`${code} ${description}`)) return "Google no reconoce este Client ID u origen. Revisa que el cliente sea de tipo Aplicación web y autorice https://cmiguezd.github.io";
    if (/idpiframe_initialization_failed|third.party|cookies/i.test(`${code} ${description}`)) return "El navegador bloqueó las cookies necesarias de Google. Permítelas para accounts.google.com y vuelve a intentar.";
    if (/timeout|tiempo de espera|abort/i.test(`${code} ${description}`)) return "Google Sheets tardó demasiado en responder. Revisa la conexión y vuelve a pulsar Sincronizar.";
    if (/403|PERMISSION_DENIED|insufficientPermissions/i.test(`${code} ${description}`)) return "Google autorizó la cuenta, pero no permitió modificar este archivo. Verifica que carlosmiguez13@gmail.com sea editor del Sheet y vuelve a conectar.";
    if (/404|NOT_FOUND|Requested entity was not found/i.test(`${code} ${description}`)) return "No se encontró el Google Sheet configurado. Revisa el ID del archivo en Configuración privada.";
    return `Error de Google: ${description || code || "no identificado"}`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("No se pudo cargar el servicio de acceso de Google"));
      document.head.appendChild(script);
    });
  }

  async function ensureGoogle() {
    if (!configured()) throw new Error("La conexión con Google aún no está configurada.");
    if (!window.google?.accounts?.oauth2) await loadScript("https://accounts.google.com/gsi/client");
    if (!window.google?.accounts?.oauth2) throw new Error("Google Identity Services no quedó disponible");
  }

  async function requestToken(prompt = "") {
    await ensureGoogle();
    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        callback: response => {
          if (response.error) return reject(response);
          sessionStorage.setItem(TOKEN_KEY, response.access_token);
          resolve(response.access_token);
        },
        error_callback: error => reject(error)
      });
      tokenClient.requestAccessToken({ prompt });
    });
  }

  async function token() { return getToken() || requestToken(""); }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Tiempo de espera agotado al consultar Google Sheets");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function api(path, options = {}) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}${path}`;
    const run = accessToken => fetchWithTimeout(url, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    let response = await run(await token());
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      response = await run(await requestToken(""));
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google Sheets HTTP ${response.status}: ${detail}`);
    }
    return response.status === 204 ? null : response.json();
  }

  async function ensureSheet() {
    const info = await api("?fields=sheets.properties");
    if (info.sheets.some(s => s.properties.title === config.sheetName)) return;
    await api(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: config.sheetName, hidden: true } } }] })
    });
  }

  const range = () => `/values/${encodeURIComponent(`${config.sheetName}!A1:A`)}`;
  async function pull({ allowOverwriteLocal = false } = {}) {
    if (localMigrationPending() && !allowOverwriteLocal) {
      const error = new Error("Hay datos de este dispositivo pendientes de subir. Conecta Google para guardarlos antes de descargar la nube.");
      setStatus(error.message, "error");
      throw error;
    }
    if (syncing) return;
    syncing = true;
    setStatus("Sincronizando…");
    try {
      await ensureSheet();
      const result = await api(`${range()}?majorDimension=COLUMNS`);
      const values = result.values?.[0] || [];
      if (!values.length || values[0] !== "MI_DINERO_STATE_V1") {
        syncing = false;
        await push();
        return;
      }
      const remote = JSON.parse(values.slice(2).join(""));
      window.miDineroApplyState(remote);
      localStorage.setItem("mi-dinero-last-sync", new Date().toISOString());
      setStatus("Sincronizado con Google Sheets", "ok");
    } catch (error) {
      console.error("Google Sheets sync:", error);
      setStatus(friendlyError(error), "error");
    } finally {
      syncing = false;
    }
  }

  async function push(nextState = window.miDineroGetState?.()) {
    if (!nextState) throw new Error("No hay datos para guardar en Google Sheets");
    if (!configured()) {
      const error = new Error("La conexión con Google aún no está configurada.");
      setStatus(error.message, "error");
      throw error;
    }
    if (syncing) {
      const error = new Error("Hay otra sincronización en curso. Espera un momento y vuelve a intentar.");
      setStatus(error.message, "error");
      throw error;
    }
    syncing = true;
    setStatus("Guardando en Google Sheets…");
    try {
      await ensureSheet();
      const payload = JSON.stringify({ ...nextState, cloud: { updatedAt: new Date().toISOString() } });
      const chunks = payload.match(/.{1,45000}/gs) || [payload];
      const writeRange = `${config.sheetName}!A1:A${chunks.length + 2}`;
      await api(`/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ range: writeRange, majorDimension: "COLUMNS", values: [["MI_DINERO_STATE_V1", new Date().toISOString(), ...chunks]] })
      });
      localStorage.setItem("mi-dinero-last-sync", new Date().toISOString());
      localStorage.setItem(LOCAL_MIGRATION_KEY, "complete");
      setStatus("Guardado en Google Sheets", "ok");
      return true;
    } catch (error) {
      console.error("Google Sheets save:", error);
      setStatus(friendlyError(error), "error");
      throw error;
    } finally { syncing = false; }
  }

  async function connect() {
    try {
      setStatus("Conectando con Google…");
      await requestToken("consent select_account");
      if (localMigrationPending()) {
        await migrateLocal();
      } else {
        await pull();
      }
      window.miDineroRefresh?.();
    } catch (error) {
      console.error("Google OAuth:", error);
      setStatus(configured() ? friendlyError(error) : "Falta configurar Google OAuth", "error");
    }
  }

  async function migrateLocal() {
    if (!localMigrationPending()) return pull();
    setStatus("Protegiendo y subiendo los datos de este dispositivo…");
    await push(window.miDineroGetState?.());
    setStatus("Datos de este dispositivo guardados en Google Sheets", "ok");
    window.miDineroRefresh?.();
    return true;
  }

  function disconnect() {
    const current = getToken();
    if (current && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(current);
    sessionStorage.removeItem(TOKEN_KEY);
    setStatus("Desconectado: conecta Google para guardar registros", "error");
    window.miDineroRefresh?.();
  }

  window.MiDineroCloud = { configured, connect, disconnect, pull, push, migrateLocal, localMigrationPending, isConnected: () => Boolean(getToken()), friendlyError };
  setStatus(configured() ? (localMigrationPending() ? "Datos de este dispositivo pendientes de subir a Google Sheets" : getToken() ? "Conectado; pulsa sincronizar" : "Listo para conectar con Google") : "Falta configurar Google OAuth");
})();

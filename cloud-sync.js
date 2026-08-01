(() => {
  const config = window.MI_DINERO_CLOUD_CONFIG || {};
  const TOKEN_KEY = "mi-dinero-google-token";
  const LOCAL_STATE_KEY = "mi-dinero-v3";
  const LOCAL_MIGRATION_KEY = "mi-dinero-cloud-migration-v1";
  const LAST_SYNC_KEY = "mi-dinero-last-sync";
  const POLL_INTERVAL_MS = 10000;
  let tokenClient = null;
  let syncing = false;
  let pollTimer = null;
  let lastRemoteVersion = localStorage.getItem(LAST_SYNC_KEY) || "";

  const configured = () => Boolean(config.clientId && config.spreadsheetId);
  const getToken = () => sessionStorage.getItem(TOKEN_KEY) || "";
  const localMigrationPending = () => Boolean(localStorage.getItem(LOCAL_STATE_KEY)) && localStorage.getItem(LOCAL_MIGRATION_KEY) !== "complete";

  const setStatus = (text, tone = "") => {
    window.miDineroCloudStatus = { text, tone };
    const settingsStatus = document.querySelector("#cloudStatus");
    if (settingsStatus) {
      settingsStatus.textContent = text;
      settingsStatus.dataset.tone = tone;
    }
    const liveStatus = document.querySelector("#liveSyncStatus");
    if (liveStatus) {
      const copy = liveStatus.querySelector(".live-sync-copy");
      if (copy) copy.textContent = text;
      liveStatus.dataset.tone = tone;
      liveStatus.title = text;
    }
  };

  const setBootState = (mode, message = "") => {
    document.documentElement.dataset.cloudBoot = mode;
    const title = document.querySelector("#cloudGateTitle");
    const status = document.querySelector("#cloudGateStatus");
    const button = document.querySelector("#cloudGateConnect");
    if (title) title.textContent = mode === "auth" ? "Accede a tu información" : mode === "error" ? "No pudimos cargar tus datos" : "Cargando tu información";
    if (status && message) status.textContent = message;
    if (button) {
      button.classList.toggle("hidden", !["auth", "error"].includes(mode));
      button.textContent = mode === "error" ? "Reintentar" : "Continuar con Google";
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
    if (/timeout|tiempo de espera|abort/i.test(`${code} ${description}`)) return "Google Sheets tardó demasiado en responder. Revisa la conexión y vuelve a intentar.";
    if (/403|PERMISSION_DENIED|insufficientPermissions/i.test(`${code} ${description}`)) return "Google autorizó la cuenta, pero no permitió modificar este archivo. Verifica que carlosmiguez13@gmail.com sea editor del Sheet y vuelve a conectar.";
    if (/404|NOT_FOUND|Requested entity was not found/i.test(`${code} ${description}`)) return "No se encontró el Google Sheet configurado. Revisa el ID del archivo en Configuración privada.";
    if (/REMOTE_CONFLICT/i.test(code)) return "Google Sheets cambió en otro dispositivo. Ya estamos cargando esa versión; repite la acción cuando termine.";
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

  const stateRange = () => `/values/${encodeURIComponent(`${config.sheetName}!A1:A`)}`;
  const versionRange = () => `/values/${encodeURIComponent(`${config.sheetName}!A1:A2`)}`;

  function rememberRemoteVersion(version) {
    lastRemoteVersion = version || new Date().toISOString();
    localStorage.setItem(LAST_SYNC_KEY, lastRemoteVersion);
    localStorage.setItem(LOCAL_MIGRATION_KEY, "complete");
  }

  function hasBlockingDialog() {
    return Boolean(document.querySelector(".modal-backdrop:not(.hidden)"));
  }

  async function pull({ silent = false, initial = false } = {}) {
    if (syncing) return false;
    syncing = true;
    if (!silent) setStatus("Consultando Google Sheets…");
    try {
      await ensureSheet();
      const result = await api(`${stateRange()}?majorDimension=COLUMNS`);
      const values = result.values?.[0] || [];
      if (!values.length || values[0] !== "MI_DINERO_STATE_V1") {
        throw new Error("Google Sheets todavía no contiene un estado válido de Mi Dinero.");
      }
      const remote = JSON.parse(values.slice(2).join(""));
      const remoteVersion = values[1] || remote.cloud?.updatedAt || new Date().toISOString();
      window.miDineroApplyState(remote, { silent: silent || initial });
      rememberRemoteVersion(remoteVersion);
      setStatus(initial ? "Última versión cargada desde Google Sheets" : silent ? "Datos al día" : "Actualizado desde Google Sheets", "ok");
      if (initial) setBootState("ready");
      startAutoSync();
      return true;
    } catch (error) {
      console.error("Google Sheets sync:", error);
      const message = friendlyError(error);
      setStatus(message, "error");
      if (initial) setBootState("error", message);
      return false;
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
    if (!getToken()) {
      const error = new Error("Tu sesión de Google no está activa. Vuelve a conectar antes de guardar.");
      setStatus(error.message, "error");
      setBootState("auth", "Inicia sesión para guardar y consultar la última versión de Google Sheets.");
      throw error;
    }
    if (syncing) {
      const error = new Error("Hay otra sincronización en curso. Espera un momento y vuelve a intentar.");
      setStatus(error.message, "error");
      throw error;
    }
    let remoteConflict = false;
    syncing = true;
    setStatus("Guardando en Google Sheets…");
    try {
      await ensureSheet();
      const current = await api(`${stateRange()}?majorDimension=COLUMNS`);
      const currentValues = current.values?.[0] || [];
      const currentVersion = currentValues[0] === "MI_DINERO_STATE_V1" ? currentValues[1] || "" : "";
      if (lastRemoteVersion && currentVersion && currentVersion !== lastRemoteVersion) {
        remoteConflict = true;
        const conflict = new Error("REMOTE_CONFLICT");
        conflict.code = "REMOTE_CONFLICT";
        throw conflict;
      }
      const writtenAt = new Date().toISOString();
      const payload = JSON.stringify({ ...nextState, cloud: { updatedAt: writtenAt } });
      const chunks = payload.match(/.{1,45000}/gs) || [payload];
      const columnValues = ["MI_DINERO_STATE_V1", writtenAt, ...chunks];
      while (columnValues.length < currentValues.length) columnValues.push("");
      const writeRange = `${config.sheetName}!A1:A${columnValues.length}`;
      await api(`/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ range: writeRange, majorDimension: "COLUMNS", values: [columnValues] })
      });
      rememberRemoteVersion(writtenAt);
      setStatus("Guardado en Google Sheets", "ok");
      startAutoSync();
      return true;
    } catch (error) {
      console.error("Google Sheets save:", error);
      setStatus(friendlyError(error), "error");
      throw error;
    } finally {
      syncing = false;
      if (remoteConflict) window.setTimeout(() => pull({ silent: true }), 0);
    }
  }

  async function checkForUpdates() {
    if (!configured() || !getToken() || syncing || document.hidden || hasBlockingDialog()) return;
    try {
      const result = await api(`${versionRange()}?majorDimension=COLUMNS`);
      const values = result.values?.[0] || [];
      const remoteVersion = values[0] === "MI_DINERO_STATE_V1" ? values[1] || "" : "";
      if (!remoteVersion) return;
      if (!lastRemoteVersion) {
        lastRemoteVersion = remoteVersion;
        return;
      }
      if (remoteVersion !== lastRemoteVersion) await pull({ silent: true });
    } catch (error) {
      console.error("Google Sheets live sync:", error);
      setStatus(friendlyError(error), "error");
    }
  }

  function startAutoSync() {
    if (pollTimer || !getToken()) return;
    pollTimer = window.setInterval(checkForUpdates, POLL_INTERVAL_MS);
  }

  function stopAutoSync() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  async function connect() {
    try {
      setBootState("loading", "Iniciando sesión y consultando la última versión de Google Sheets…");
      setStatus("Conectando con Google…");
      await requestToken("consent select_account");
      await pull({ initial: true });
      window.miDineroRefresh?.();
    } catch (error) {
      console.error("Google OAuth:", error);
      const message = configured() ? friendlyError(error) : "Falta configurar Google OAuth";
      setStatus(message, "error");
      setBootState("error", message);
    }
  }

  async function migrateLocal() {
    throw new Error("La migración inicial ya terminó. Google Sheets es ahora la única copia oficial.");
  }

  function showLogin() {
    setBootState("auth", "Inicia sesión para cargar la última versión guardada en Google Sheets.");
  }

  function disconnect() {
    const current = getToken();
    if (current && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(current);
    sessionStorage.removeItem(TOKEN_KEY);
    stopAutoSync();
    setStatus("Desconectado de Google Sheets", "error");
    showLogin();
    window.miDineroRefresh?.();
  }

  async function bootstrap() {
    const gateButton = document.querySelector("#cloudGateConnect");
    if (gateButton) gateButton.onclick = () => connect();
    window.addEventListener("focus", checkForUpdates);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkForUpdates();
    });
    if (!configured()) {
      setStatus("Falta configurar Google OAuth", "error");
      setBootState("ready");
      return;
    }
    if (!getToken()) {
      setStatus("Inicia sesión para cargar Google Sheets");
      showLogin();
      return;
    }
    setBootState("loading", "Consultando la última versión guardada en Google Sheets…");
    await pull({ initial: true });
  }

  window.MiDineroCloud = {
    configured, connect, disconnect, pull, push, migrateLocal, localMigrationPending,
    isConnected: () => Boolean(getToken()), friendlyError, checkForUpdates, showLogin
  };
  setStatus(configured() ? getToken() ? "Conectando con Google Sheets…" : "Inicia sesión para cargar Google Sheets" : "Falta configurar Google OAuth");
  bootstrap();
})();

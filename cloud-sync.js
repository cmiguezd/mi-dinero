(() => {
  const config = window.MI_DINERO_CLOUD_CONFIG || {};
  if (config.scriptUrl) return; // con Apps Script configurado se usa script-sync.js
  // El token se guarda con su vencimiento en localStorage para sobrevivir al cierre
  // de la pestaña o de la app instalada (antes vivía en sessionStorage y se perdía).
  const TOKEN_KEY = "mi-dinero-google-token-v2";
  const LEGACY_TOKEN_KEY = "mi-dinero-google-token";
  const HAD_SESSION_KEY = "mi-dinero-google-had-session";
  const EXPIRY_SAFETY_MS = 60 * 1000;
  const RENEW_MARGIN_MS = 10 * 60 * 1000;
  const TOKEN_REQUEST_TIMEOUT_MS = 90 * 1000;
  const LOCAL_STATE_KEY = "mi-dinero-v3";
  const LOCAL_MIGRATION_KEY = "mi-dinero-cloud-migration-v1";
  const LAST_SYNC_KEY = "mi-dinero-last-sync";
  const POLL_INTERVAL_MS = 10000;
  let tokenClient = null;
  let renewing = null;
  let pendingToken = null;
  let syncing = false;
  let pollTimer = null;
  let lastRemoteVersion = localStorage.getItem(LAST_SYNC_KEY) || "";

  const configured = () => Boolean(config.clientId && config.spreadsheetId);
  function readToken() {
    try {
      const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      if (saved?.token && Number(saved.expiresAt) > Date.now() + EXPIRY_SAFETY_MS) return saved;
    } catch {}
    return null;
  }
  const getToken = () => readToken()?.token || "";
  const tokenExpiresSoon = () => {
    const saved = readToken();
    return !saved || saved.expiresAt - Date.now() < RENEW_MARGIN_MS;
  };
  function storeToken(response) {
    const lifetime = (Number(response.expires_in) || 3600) * 1000;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: response.access_token, expiresAt: Date.now() + lifetime }));
    localStorage.setItem(HAD_SESSION_KEY, "1");
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  }
  function authRequired() {
    const error = new Error("AUTH_REQUIRED");
    error.code = "AUTH_REQUIRED";
    return error;
  }
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
    if (/AUTH_REQUIRED/i.test(code)) return "Tu sesión de Google venció. Toca la pantalla para renovarla.";
    if (/TOKEN_TIMEOUT/i.test(code)) return "Google no respondió al renovar la sesión. Vuelve a intentar.";
    if (/access_denied/i.test(code)) return "Google rechazó el acceso. Entra con tu cuenta y acepta los permisos.";
    if (/invalid_client|origin|redirect_uri_mismatch/i.test(`${code} ${description}`)) return "Google no reconoce este Client ID u origen. Revisa que el cliente sea de tipo Aplicación web y autorice https://cmiguezd.github.io";
    if (/idpiframe_initialization_failed|third.party|cookies/i.test(`${code} ${description}`)) return "El navegador bloqueó las cookies necesarias de Google. Permítelas para accounts.google.com y vuelve a intentar.";
    if (/timeout|tiempo de espera|abort/i.test(`${code} ${description}`)) return "Google Sheets tardó demasiado en responder. Revisa la conexión y vuelve a intentar.";
    if (/403|PERMISSION_DENIED|insufficientPermissions/i.test(`${code} ${description}`)) return "Google autorizó la cuenta, pero no permitió modificar este archivo. Verifica que tu cuenta sea editora del Sheet y vuelve a conectar.";
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

  function settlePendingToken(error, accessToken) {
    const pending = pendingToken;
    pendingToken = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(accessToken);
  }

  function getTokenClient() {
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      callback: response => {
        if (response.error) return settlePendingToken(response);
        storeToken(response);
        settlePendingToken(null, response.access_token);
      },
      error_callback: error => settlePendingToken(error)
    });
    return tokenClient;
  }

  // Debe llamarse de forma síncrona dentro de un toque o clic: si hay un "await"
  // antes, Safari en iPhone bloquea la ventana de Google. prompt "" solo muestra
  // la pantalla de permisos la primera vez; después la ventana se cierra sola.
  function requestToken(prompt = "") {
    if (renewing) return renewing;
    if (!window.google?.accounts?.oauth2) {
      return ensureGoogle().then(() => requestToken(prompt));
    }
    renewing = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("TOKEN_TIMEOUT");
        error.code = "TOKEN_TIMEOUT";
        settlePendingToken(error);
      }, TOKEN_REQUEST_TIMEOUT_MS);
      pendingToken = { resolve, reject, timer };
      try {
        getTokenClient().requestAccessToken({ prompt });
      } catch (error) {
        settlePendingToken(error);
      }
    }).finally(() => { renewing = null; });
    return renewing;
  }

  // Nunca abre la ventana de Google por su cuenta (desde un temporizador quedaba
  // bloqueada y el guardado se quedaba "cargando"). Si no hay token válido, falla
  // con AUTH_REQUIRED y la renovación ocurre en el siguiente toque del usuario.
  async function token() {
    if (renewing) {
      try { await renewing; } catch {}
    }
    const current = getToken();
    if (current) return current;
    throw authRequired();
  }

  function markSessionExpired() {
    clearToken();
    stopAutoSync();
    setStatus(friendlyError(authRequired()), "error");
  }

  function isActivationEvent(event) {
    if (event.type === "keydown") return event.key !== "Escape";
    if (event.type === "pointerdown") return event.pointerType === "mouse";
    if (event.type === "pointerup") return event.pointerType !== "mouse";
    return false;
  }

  // Renueva el token aprovechando un toque normal del usuario cuando le quedan
  // menos de 10 minutos, para que al guardar ya esté vigente.
  function renewOnGesture(event) {
    if (!isActivationEvent(event)) return;
    if (!configured() || renewing || !window.google?.accounts?.oauth2) return;
    if (document.documentElement.dataset.cloudBoot !== "ready") return;
    if (!localStorage.getItem(HAD_SESSION_KEY) || !tokenExpiresSoon()) return;
    const wasExpired = !getToken();
    requestToken("").then(() => {
      setStatus("Sesión de Google renovada", "ok");
      startAutoSync();
      if (wasExpired) checkForUpdates();
    }).catch(error => {
      console.error("Google token renewal:", error);
      setStatus(friendlyError(error), "error");
    });
  }

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
    const response = await run(await token());
    if (response.status === 401) {
      markSessionExpired();
      throw authRequired();
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
    let recurringChecksMigration = null;
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
      recurringChecksMigration = window.miDineroGetPendingRecurringChecksMigration?.() || null;
      rememberRemoteVersion(remoteVersion);
      window.miDineroMarkSynced?.();
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
      if (recurringChecksMigration) {
        window.setTimeout(async () => {
          try {
            await push(recurringChecksMigration);
            window.miDineroCompleteRecurringChecksMigration?.();
            setStatus("Datos actualizados y guardados en Google Sheets", "ok");
          } catch (error) {
            console.error("Recurring checks migration:", error);
          }
        }, 0);
      }
    }
  }

  async function push(nextState = window.miDineroGetState?.()) {
    if (!nextState) throw new Error("No hay datos para guardar en Google Sheets");
    if (!configured()) {
      const error = new Error("La conexión con Google aún no está configurada.");
      setStatus(error.message, "error");
      throw error;
    }
    if (renewing) {
      try { await renewing; } catch {}
    }
    if (!getToken()) {
      const error = authRequired();
      setStatus(friendlyError(error), "error");
      throw error;
    }
    // Si hay una consulta en curso (p. ej. justo tras renovar la sesión), se espera
    // en vez de descartar el guardado.
    for (let waited = 0; syncing && waited < 30000; waited += 150) {
      await new Promise(resolve => setTimeout(resolve, 150));
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
      window.miDineroMarkSynced?.();
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
    if (configured() && !getToken() && pollTimer) markSessionExpired();
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

  // Sin "await" antes de requestToken para conservar el gesto del usuario.
  function connect(prompt = "") {
    setBootState("loading", "Iniciando sesión y consultando la última versión de Google Sheets…");
    setStatus("Conectando con Google…");
    return requestToken(prompt)
      .then(() => pull({ initial: true }))
      .then(() => window.miDineroRefresh?.())
      .catch(error => {
        console.error("Google OAuth:", error);
        const message = configured() ? friendlyError(error) : "Falta configurar Google OAuth";
        setStatus(message, "error");
        setBootState("error", message);
      });
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
    clearToken();
    localStorage.removeItem(HAD_SESSION_KEY);
    stopAutoSync();
    setStatus("Desconectado de Google Sheets", "error");
    showLogin();
    window.miDineroRefresh?.();
  }

  async function bootstrap() {
    const gateButton = document.querySelector("#cloudGateConnect");
    if (gateButton) gateButton.onclick = () => connect();
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    for (const type of ["pointerdown", "pointerup", "keydown"]) {
      document.addEventListener(type, renewOnGesture, true);
    }
    window.addEventListener("focus", checkForUpdates);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkForUpdates();
    });
    if (!configured()) {
      setStatus("Falta configurar Google OAuth", "error");
      setBootState("ready");
      return;
    }
    // Precarga Google para que el botón abra la ventana sin esperas (iPhone).
    ensureGoogle().catch(error => console.error("Google Identity Services:", error));
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
    isConnected: () => Boolean(getToken() || renewing), friendlyError, checkForUpdates, showLogin
  };
  setStatus(configured() ? getToken() ? "Conectando con Google Sheets…" : "Inicia sesión para cargar Google Sheets" : "Falta configurar Google OAuth");
  bootstrap();
})();

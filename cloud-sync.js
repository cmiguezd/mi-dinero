(() => {
  const config = window.MI_DINERO_CLOUD_CONFIG || {};
  const TOKEN_KEY = "mi-dinero-google-token";
  let tokenClient = null;
  let saveTimer = null;
  let syncing = false;

  const configured = () => Boolean(config.clientId && config.spreadsheetId);
  const getToken = () => sessionStorage.getItem(TOKEN_KEY) || "";
  const setStatus = (text, tone = "") => {
    window.miDineroCloudStatus = { text, tone };
    const el = document.querySelector("#cloudStatus");
    if (el) {
      el.textContent = text;
      el.dataset.tone = tone;
    }
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function ensureGoogle() {
    if (!configured()) throw new Error("La conexión con Google aún no está configurada.");
    if (!window.google?.accounts?.oauth2) {
      await loadScript("https://accounts.google.com/gsi/client");
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email",
        callback: () => {}
      });
    }
  }

  async function requestToken(prompt = "") {
    await ensureGoogle();
    return new Promise((resolve, reject) => {
      tokenClient.callback = response => {
        if (response.error) return reject(new Error(response.error));
        sessionStorage.setItem(TOKEN_KEY, response.access_token);
        resolve(response.access_token);
      };
      tokenClient.requestAccessToken({ prompt });
    });
  }

  async function token() {
    return getToken() || requestToken("");
  }

  async function api(path, options = {}) {
    const accessToken = await token();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      const retryToken = await requestToken("");
      return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${retryToken}`, "Content-Type": "application/json" }
      });
    }
    if (!response.ok) throw new Error(await response.text());
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

  const range = () => `/${encodeURIComponent(`values/${config.sheetName}!A1:A`)}`;
  async function pull() {
    if (syncing) return;
    syncing = true;
    setStatus("Sincronizando…");
    try {
      await ensureSheet();
      const result = await api(`${range()}?majorDimension=COLUMNS`);
      const values = result.values?.[0] || [];
      if (!values.length || values[0] !== "MI_DINERO_STATE_V1") {
        await push();
        return;
      }
      const payload = values.slice(2).join("");
      const remote = JSON.parse(payload);
      window.miDineroApplyState(remote);
      localStorage.setItem("mi-dinero-last-sync", new Date().toISOString());
      setStatus("Sincronizado con Google Sheets", "ok");
    } finally {
      syncing = false;
    }
  }

  async function push(nextState = window.miDineroGetState?.()) {
    if (!nextState || !getToken() || syncing) return;
    syncing = true;
    setStatus("Guardando en Google Sheets…");
    try {
      await ensureSheet();
      const payload = JSON.stringify({
        ...nextState,
        cloud: { updatedAt: new Date().toISOString(), updatedBy: config.allowedEmail }
      });
      const chunks = payload.match(/.{1,45000}/gs) || [payload];
      await api(`${range()}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ range: `${config.sheetName}!A1:A${chunks.length + 2}`, majorDimension: "COLUMNS", values: [["MI_DINERO_STATE_V1", new Date().toISOString(), ...chunks]] })
      });
      localStorage.setItem("mi-dinero-last-sync", new Date().toISOString());
      setStatus("Cambios guardados", "ok");
    } finally {
      syncing = false;
    }
  }

  function queueSave(nextState) {
    if (!getToken()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => push(nextState).catch(err => setStatus("Error al guardar", "error")), 900);
  }

  async function connect() {
    try {
      setStatus("Conectando con Google…");
      await requestToken("consent");
      await pull();
      window.miDineroRefresh?.();
    } catch (error) {
      console.error(error);
      setStatus(configured() ? "No fue posible conectar" : "Falta configurar Google OAuth", "error");
    }
  }

  function disconnect() {
    const current = getToken();
    if (current && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(current);
    sessionStorage.removeItem(TOKEN_KEY);
    setStatus("Datos guardados solo en este dispositivo");
    window.miDineroRefresh?.();
  }

  window.MiDineroCloud = { configured, connect, disconnect, pull, push, queueSave, isConnected: () => Boolean(getToken()) };
  setStatus(configured() ? (getToken() ? "Conectado; pulsa sincronizar" : "Listo para conectar con Google") : "Falta configurar Google OAuth");
})();

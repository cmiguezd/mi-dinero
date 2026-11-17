/*
 * Mi Dinero · sincronización con el servidor de Apps Script (sin login cada hora).
 * Solo se activa si en Configuración se guardó la URL del Apps Script.
 * - Cada cambio se guarda al instante en este dispositivo y entra a una cola.
 * - La cola se envía en cuanto hay conexión; el servidor mezcla registro por registro.
 * - Cada 10 s (con la app abierta) pregunta si otro dispositivo cambió algo.
 */
(() => {
  const config = window.MI_DINERO_CLOUD_CONFIG || {};
  if (!config.scriptUrl) return;
  window.MI_DINERO_SCRIPT_MODE = true;

  const TOKEN_KEY = "mi-dinero-device-token", DEVICE_KEY = "mi-dinero-device-id";
  const OUTBOX_KEY = "mi-dinero-outbox", VERSION_KEY = "mi-dinero-script-version";
  const STATE_KEY = "mi-dinero-v3", POLL_MS = 10000;
  const load = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } };
  let outbox = load(OUTBOX_KEY, []);
  let version = localStorage.getItem(VERSION_KEY) || "";
  let busy = false, pollTimer = null, gisReady = null, syncError = "";
  const token = () => localStorage.getItem(TOKEN_KEY) || "";
  const saveOutbox = () => localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  const deviceId = () => { let id = localStorage.getItem(DEVICE_KEY); if (!id) { id = syncNewId(); localStorage.setItem(DEVICE_KEY, id); } return id; };

  /* ---------- Estado visible ---------- */
  const setStatus = (text, tone = "") => {
    window.miDineroCloudStatus = { text, tone };
    const s = document.querySelector("#cloudStatus"); if (s) { s.textContent = text; s.dataset.tone = tone; }
    const live = document.querySelector("#liveSyncStatus");
    if (live) { const copy = live.querySelector(".live-sync-copy"); if (copy) copy.textContent = text; live.dataset.tone = tone; live.title = text; }
  };
  const queueStatus = () => {
    const n = outbox.length, plural = n === 1 ? "cambio guardado" : "cambios guardados";
    if (!navigator.onLine) setStatus(n ? `Sin conexión · ${n} ${plural} en este dispositivo` : "Sin conexión · mostrando lo último guardado", "warn");
    else if (n && !token()) setStatus("Cambios pendientes · vuelve a vincular este dispositivo para enviarlos", "warn");
    else if (syncError) setStatus(`${syncError} · se reintentará automáticamente`, "warn");
    else if (n) setStatus(`Sincronizando ${n} ${n === 1 ? "cambio" : "cambios"}…`);
    else setStatus("Todo sincronizado", "ok");
  };
  const setBootState = (mode, message = "") => {
    document.documentElement.dataset.cloudBoot = mode;
    const title = document.querySelector("#cloudGateTitle"), status = document.querySelector("#cloudGateStatus");
    const button = document.querySelector("#cloudGateConnect"), google = document.querySelector("#cloudGateGoogle");
    if (title) title.textContent = mode === "auth" ? "Vincula este dispositivo" : mode === "error" ? "No pudimos cargar tus datos" : "Cargando tu información";
    if (status && message) status.textContent = message;
    if (button) { button.classList.toggle("hidden", mode !== "error"); button.textContent = "Reintentar"; }
    if (google) google.classList.toggle("hidden", mode !== "auth");
  };
  function friendlyError(error) {
    const code = error?.code || error?.message || String(error || "");
    if (/UNAUTHORIZED/.test(code)) return "Este dispositivo fue desvinculado. Vuelve a vincularlo con Google.";
    if (/NOT_ALLOWED/.test(code)) return "Esa cuenta de Google no tiene permiso para usar este Mi Dinero.";
    if (/WRONG_CLIENT|INVALID_GOOGLE_TOKEN/.test(code)) return "Google no confirmó tu identidad. Intenta vincular de nuevo.";
    if (/Failed to fetch|NetworkError|Load failed|timeout|abort/i.test(code)) return "Sin conexión con el servidor. Tus cambios quedan guardados en este dispositivo.";
    return `Error del servidor: ${code}`;
  }

  /* ---------- Llamadas al Apps Script ---------- */
  async function call(action, payload = {}, timeoutMs = 30000) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // text/plain evita la verificación CORS previa que el Apps Script no responde.
      const res = await fetch(config.scriptUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, token: token(), ...payload }), signal: ctrl.signal, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) { const e = new Error(data.error || "ERROR"); e.code = data.error; throw e; }
      return data;
    } finally { clearTimeout(timer); }
  }
  function handleError(error) {
    console.error("Mi Dinero sync:", error);
    syncError = friendlyError(error);
    if (error?.code === "UNAUTHORIZED") { localStorage.removeItem(TOKEN_KEY); stopPolling(); setBootState("auth", friendlyError(error)); renderGoogleButton(); }
    setStatus(friendlyError(error), error?.code === "UNAUTHORIZED" ? "error" : "warn");
  }

  /* ---------- Mezcla con el servidor ---------- */
  const clone = v => JSON.parse(JSON.stringify(v));
  function rebase(serverState) { const s = clone(serverState); syncApply(s, clone(outbox)); return s; }
  function applyFromServer(serverState, { silent = true } = {}) {
    const merged = rebase(serverState);
    window.miDineroApplyState?.(clone(merged), { silent });
    // Migraciones locales (p. ej. separar comercio y detalle) viajan como cambios normales.
    const migrated = window.miDineroGetPendingRecurringChecksMigration?.();
    if (migrated) { enqueue(syncDiff(merged, migrated, Date.now(), deviceId())); window.miDineroCompleteRecurringChecksMigration?.(); }
  }
  function enqueue(ops) {
    if (!ops.length) return;
    outbox.push(...ops); saveOutbox(); queueStatus();
    setTimeout(flush, 0);
  }
  async function flush() {
    if (busy || !outbox.length || !navigator.onLine || !token()) { queueStatus(); return; }
    busy = true;
    const sending = outbox.slice(), ids = new Set(sending.map(o => o.id));
    try {
      queueStatus();
      const r = await call("push", { ops: sending });
      syncError = "";
      outbox = outbox.filter(o => !ids.has(o.id)); saveOutbox();
      version = r.version; localStorage.setItem(VERSION_KEY, version);
      window.miDineroMarkSynced?.();
      applyFromServer(r.state);
      if (r.rejected?.length && typeof toast === "function") toast(`${r.rejected.length} ${r.rejected.length === 1 ? "cambio tuyo se reemplazó" : "cambios tuyos se reemplazaron"} por una edición más reciente de otro dispositivo`);
    } catch (error) { handleError(error); }
    finally { busy = false; queueStatus(); if (outbox.length && navigator.onLine) setTimeout(flush, 5000); }
  }
  async function pull({ initial = false, silent = true } = {}) {
    if (!token()) return false;
    if (busy) return false;
    busy = true;
    try {
      if (!initial) setStatus("Consultando cambios…");
      const r = await call("pull");
      syncError = "";
      version = r.version || ""; localStorage.setItem(VERSION_KEY, version);
      window.miDineroMarkSynced?.();
      if (r.state) applyFromServer(r.state, { silent: silent || initial });
      else enqueue(syncDiff({}, window.miDineroGetState?.() || {}, Date.now(), deviceId()));
      setBootState("ready");
      return true;
    } catch (error) {
      handleError(error);
      if (initial && !localStorage.getItem(STATE_KEY)) setBootState("error", friendlyError(error));
      return false;
    } finally { busy = false; queueStatus(); if (outbox.length) setTimeout(flush, 0); }
  }
  async function checkForUpdates() {
    if (!token() || busy || document.hidden || !navigator.onLine) { queueStatus(); return; }
    if (document.querySelector(".modal-backdrop:not(.hidden)")) return;
    if (outbox.length) return flush();
    try {
      const r = await call("version", {}, 15000);
      syncError = "";
      if (r.version && r.version !== version) await pull({ silent: true });
      else queueStatus();
    } catch (error) { handleError(error); }
  }
  function startPolling() { if (!pollTimer && token()) pollTimer = setInterval(checkForUpdates, POLL_MS); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  /* ---------- Guardar (lo llama app.js) ---------- */
  async function push(nextState, previousState) {
    const prev = previousState || window.miDineroGetState?.() || {};
    enqueue(syncDiff(prev, nextState, Date.now(), deviceId()));
    return true; // ya quedó guardado en el dispositivo; el envío sigue en segundo plano
  }

  /* ---------- Vincular dispositivo (una sola vez) ---------- */
  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => resolve(); s.onerror = () => reject(new Error("No se pudo cargar Google")); document.head.appendChild(s);
    });
    return gisReady;
  }
  function deviceName() {
    const ua = navigator.userAgent;
    const kind = /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Dispositivo";
    return `${kind} · ${new Date().toLocaleDateString("es")}`;
  }
  async function renderGoogleButton() {
    const holder = document.querySelector("#cloudGateGoogle"); if (!holder) return;
    try {
      await loadGis();
      google.accounts.id.initialize({
        client_id: config.clientId, auto_select: false, use_fedcm_for_button: true,
        callback: async ({ credential }) => {
          setBootState("loading", "Vinculando este dispositivo…");
          try {
            const r = await call("pair", { idToken: credential, deviceName: deviceName() });
            localStorage.setItem(TOKEN_KEY, r.token);
            const ok = await pull({ initial: true, silent: false });
            if (ok) { setBootState("ready"); startPolling(); window.miDineroRefresh?.(); }
          } catch (error) { setBootState("auth", friendlyError(error)); renderGoogleButton(); }
        }
      });
      holder.innerHTML = "";
      google.accounts.id.renderButton(holder, { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", locale: "es" });
    } catch (error) { setBootState("error", friendlyError(error)); }
  }
  function showLogin() { setBootState("auth", "Inicia sesión con Google una sola vez en este dispositivo. Después la app abrirá directo, incluso sin conexión."); renderGoogleButton(); }
  async function connect() { if (token()) return pull({ silent: false }); showLogin(); }
  async function disconnect() {
    if (outbox.length && !window.confirm(`Hay ${outbox.length} cambios sin enviar. Si desvinculas ahora se perderán. ¿Continuar?`)) return;
    try { const mine = (await call("devices")).devices.find(d => d.current); if (mine) await call("revoke", { deviceId: mine.id }); } catch {}
    localStorage.removeItem(TOKEN_KEY); outbox = []; saveOutbox(); stopPolling(); showLogin(); window.miDineroRefresh?.();
  }

  /* ---------- Arranque ---------- */
  function bootstrap() {
    const retry = document.querySelector("#cloudGateConnect"); if (retry) retry.onclick = () => pull({ initial: true, silent: false });
    window.addEventListener("online", () => { queueStatus(); flush(); checkForUpdates(); });
    window.addEventListener("offline", queueStatus);
    window.addEventListener("focus", checkForUpdates);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdates(); });
    if (!token()) { showLogin(); return; }
    // Con datos guardados en el dispositivo se abre al instante, aun sin conexión.
    if (localStorage.getItem(STATE_KEY)) setBootState("ready"); else setBootState("loading", "Descargando tus datos…");
    queueStatus(); startPolling(); pull({ initial: true });
  }

  window.MiDineroCloud = {
    mode: "script", configured: () => true, connect, disconnect, pull: () => pull({ silent: false }), push,
    migrateLocal: async () => {}, localMigrationPending: () => false,
    isConnected: () => Boolean(token()), friendlyError, checkForUpdates, showLogin,
    pendingCount: () => outbox.length,
    devices: () => call("devices"), revoke: id => call("revoke", { deviceId: id })
  };
  queueStatus();
  bootstrap();
})();

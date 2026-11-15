(() => {
  const defaults = {
    clientId: "391123335180-vj22bb8f64hqq3mnur27037njseiopfi.apps.googleusercontent.com",
    spreadsheetId: "1bleHD0nazER3PnBEV26BYhgRoleHjmVRl2057uncako",
    sheetName: "_AppState"
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("mi-dinero-cloud-config") || "{}"); } catch {}
  // Enlace de configuración: …/mi-dinero/?script=<URL del Apps Script> activa el modo sin login en este dispositivo.
  try {
    const params = new URLSearchParams(location.search), fromLink = params.get("script");
    if (fromLink && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(fromLink)) {
      saved = { ...saved, scriptUrl: fromLink };
      localStorage.setItem("mi-dinero-cloud-config", JSON.stringify(saved));
      params.delete("script");
      history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : "") + location.hash);
    }
  } catch {}
  window.MI_DINERO_CLOUD_CONFIG = {
    clientId: saved.clientId || defaults.clientId,
    spreadsheetId: saved.spreadsheetId || defaults.spreadsheetId,
    sheetName: defaults.sheetName,
    scriptUrl: saved.scriptUrl || ""
  };
})();

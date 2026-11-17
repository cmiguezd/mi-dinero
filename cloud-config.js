(() => {
  const defaults = {
    clientId: "391123335180-vj22bb8f64hqq3mnur27037njseiopfi.apps.googleusercontent.com",
    spreadsheetId: "1bleHD0nazER3PnBEV26BYhgRoleHjmVRl2057uncako",
    sheetName: "_AppState"
  };
  // Se configura una sola vez aquí para que el modo rápido funcione en todos los dispositivos.
  const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyXv-teb_3Os1Wo0rUV4oKAVNlIG4ah3iW-gDBdPvOndN6uSo2Xa7hNxhIggnTiVdzlNw/exec";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("mi-dinero-cloud-config") || "{}"); } catch {}
  // La URL compartida es la opción normal; `?script=` queda como alternativa para una vista previa.
  try {
    const params = new URLSearchParams(location.search), fromLink = params.get("script");
    if (fromLink && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(fromLink)) {
      saved = { ...saved, scriptUrl: fromLink };
      localStorage.setItem("mi-dinero-cloud-config", JSON.stringify(saved));
      params.delete("script");
      history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : "") + location.hash);
    }
  } catch {}
  window.MI_DINERO_GLOBAL_SCRIPT_URL = DEFAULT_SCRIPT_URL;
  window.MI_DINERO_CLOUD_CONFIG = {
    clientId: saved.clientId || defaults.clientId,
    spreadsheetId: saved.spreadsheetId || defaults.spreadsheetId,
    sheetName: defaults.sheetName,
    scriptUrl: DEFAULT_SCRIPT_URL || saved.scriptUrl || ""
  };
})();

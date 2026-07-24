(() => {
  const defaults = {
    clientId: "391123335180-vj22bb8f64hqq3mnur27037njseiopfi.apps.googleusercontent.com",
    spreadsheetId: "1bleHD0nazER3PnBEV26BYhgRoleHjmVRl2057uncako",
    sheetName: "_AppState"
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("mi-dinero-cloud-config") || "{}"); } catch {}
  window.MI_DINERO_CLOUD_CONFIG = {
    clientId: saved.clientId || defaults.clientId,
    spreadsheetId: saved.spreadsheetId || defaults.spreadsheetId,
    sheetName: defaults.sheetName
  };
})();

(() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("mi-dinero-cloud-config") || "{}"); } catch {}
  window.MI_DINERO_CLOUD_CONFIG = {
    clientId: saved.clientId || "",
    spreadsheetId: saved.spreadsheetId || "",
    sheetName: "_AppState"
  };
})();

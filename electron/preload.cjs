const { contextBridge } = require("electron");

// Minimal, safe bridge: lets the UI know it runs inside the desktop shell so it
// can surface the Settings screen (no token entry needed via .env here).
contextBridge.exposeInMainWorld("desktop", { isElectron: true });

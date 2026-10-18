const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noctanUpdater", {
  getStatus: () => ipcRenderer.invoke("updater:get-status"),
  checkNow: () => ipcRenderer.invoke("updater:check"),
  installNow: () => ipcRenderer.invoke("updater:install"),
  onStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("updater:status", handler);
    return () => ipcRenderer.removeListener("updater:status", handler);
  },
});

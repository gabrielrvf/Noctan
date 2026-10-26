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

contextBridge.exposeInMainWorld("noctanDesktop", {
  notify: (title, body) => ipcRenderer.send("desktop:notify", { title, body }),
  onHandoff: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("handoff:open", handler);
    return () => ipcRenderer.removeListener("handoff:open", handler);
  },
});

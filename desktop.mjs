import { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain } from "electron";
import updaterPackage from "electron-updater";
import { join } from "node:path";

const { autoUpdater } = updaterPackage;
const APP_PORT = Number(process.env.PORT || 4177);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;
let tray = null;
let isQuitting = false;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function setupTray(iconPath) {
  if (tray) return tray;
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip("Noctan — executando em segundo plano");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir Noctan", click: showMainWindow },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  return tray;
}

function numericVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

export function isVersionStrictlyNewer(candidate, current) {
  const next = numericVersion(candidate);
  const installed = numericVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

const updateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: 0,
  message: "",
};

function broadcastUpdateStatus() {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("updater:status", { ...updateState });
  }
}

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  broadcastUpdateStatus();
}

async function setupAutoUpdater() {
  ipcMain.handle("updater:get-status", () => ({ ...updateState }));

  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) return { ...updateState };
    await autoUpdater.checkForUpdates();
    return { ...updateState };
  });

  ipcMain.handle("updater:install", () => {
    if (updateState.status !== "downloaded") {
      return { ok: false, status: updateState.status };
    }
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { ok: true };
  });

  if (!app.isPackaged) {
    setUpdateState({
      status: "dev",
      message: "Atualizações automáticas só funcionam no app instalado.",
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({ status: "checking", message: "Verificando atualização..." });
  });

  autoUpdater.on("update-available", (info) => {
    if (!isVersionStrictlyNewer(info?.version, app.getVersion())) {
      setUpdateState({ status: "current", availableVersion: info?.version || null, percent: 0, message: "Noctan está atualizado." });
      return;
    }
    setUpdateState({
      status: "available",
      availableVersion: info.version,
      message: `Baixando Noctan v${info.version}...`,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setUpdateState({
      status: "current",
      availableVersion: info?.version || null,
      percent: 0,
      message: "Noctan está atualizado.",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
    setUpdateState({
      status: "downloading",
      percent,
      message: `Baixando atualização... ${Math.round(percent)}%`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (!isVersionStrictlyNewer(info?.version, app.getVersion())) {
      setUpdateState({ status: "current", availableVersion: info?.version || null, percent: 0, message: "Noctan está atualizado." });
      return;
    }
    setUpdateState({
      status: "downloaded",
      availableVersion: info.version,
      percent: 100,
      message: `Noctan v${info.version} pronto para instalar.`,
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({
      status: "error",
      message: String(error?.message || error).slice(0, 500),
    });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      setUpdateState({
        status: "error",
        message: String(error?.message || error).slice(0, 500),
      });
    });
  }, 2500);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${APP_URL}/api/status`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("O servidor local do Noctan não iniciou.");
}

async function createWindow(targetUrl = APP_URL) {
  process.env.NOCTAN_DATA_DIR = join(app.getPath("appData"), "Noctan", "data");
  const serverModule = await import("./server.mjs");
  await waitForServer();
  await import("./mobile-gateway.mjs");

  const appIcon = join(app.getAppPath(), "public", "noctan-mark.png");
  setupTray(appIcon);

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#141414",
    title: "Noctan",
    icon: appIcon,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0b0b0b",
      symbolColor: "#d8d8d8",
      height: 32,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(app.getAppPath(), "preload.cjs"),
      webviewTag: true,
    },
  });
  mainWindow = window;
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  serverModule.setDesktopHandoffHandler(({ sessionId }) => {
    if (window.isDestroyed()) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send("handoff:open", { sessionId });
    return true;
  });

  const localOrigin = new URL(APP_URL).origin;
  const localMediaRequest = (webContents, permission, requestingOrigin, details = {}) => {
    if (permission !== "media") return false;
    const origin = String(requestingOrigin || details.requestingUrl || "");
    const types = details.mediaTypes || [];
    return origin.startsWith(localOrigin + "/") || origin === localOrigin
      ? (!types.length || (types.includes("audio") && !types.includes("video")))
      : false;
  };

  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(localMediaRequest(contents, permission, details.requestingUrl, details));
  });

  window.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    return localMediaRequest(contents, permission, requestingOrigin, details);
  });

  window.webContents.on("context-menu", (_event, params) => {
    const editable = Boolean(params.isEditable);
    const hasSelection = Boolean(params.selectionText);
    const template = editable
      ? [
          { role: "undo", label: "Desfazer", enabled: params.editFlags?.canUndo },
          { role: "redo", label: "Refazer", enabled: params.editFlags?.canRedo },
          { type: "separator" },
          { role: "cut", label: "Recortar", enabled: params.editFlags?.canCut },
          { role: "copy", label: "Copiar", enabled: params.editFlags?.canCopy || hasSelection },
          { role: "paste", label: "Colar", enabled: params.editFlags?.canPaste },
          { type: "separator" },
          { role: "selectAll", label: "Selecionar tudo" },
        ]
      : [
          { role: "copy", label: "Copiar", enabled: hasSelection },
          { role: "selectAll", label: "Selecionar tudo" },
        ];
    Menu.buildFromTemplate(template).popup({ window });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) {
      createWindow(url).catch(console.error);
      return { action: "deny" };
    }
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) event.preventDefault();
  });

  await window.loadURL(targetUrl);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
  app.on("before-quit", () => { isQuitting = true; });
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("app.noctan.desktop");
      await setupAutoUpdater();
      return createWindow();
    })
    .catch((error) => {
      console.error(error);
      app.quit();
    });
}

app.on("window-all-closed", () => {
  // O servidor, o túnel e o PC Controller continuam ativos na bandeja.
});

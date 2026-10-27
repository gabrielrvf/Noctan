import { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, Notification } from "electron";
import updaterPackage from "electron-updater";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

// Apps opened from Finder get launchd's bare PATH; MCP servers and CLIs installed
// through the shell (nvm, ~/.local, Homebrew) only resolve with the login shell's PATH.
if (process.platform === "darwin") {
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__NOCTAN_PATH__%s__NOCTAN_PATH__" "$PATH"'], { encoding: "utf8", timeout: 5000 });
    const shellPath = out.match(/__NOCTAN_PATH__(.*)__NOCTAN_PATH__/)?.[1];
    if (shellPath) process.env.PATH = shellPath;
  } catch {}
}

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
  checkForUpdatesOnOpen();
}

function setupTray(iconPath) {
  if (tray) return tray;
  const source = nativeImage.createFromPath(iconPath);
  const icon = source.resize({ width: 20, height: 20 });
  if (process.platform === "darwin") {
    // Menu bar: 18pt template (system tints it for light/dark), with a Retina rep.
    const mac = source.resize({ width: 18, height: 18, quality: "best" });
    mac.addRepresentation({ scaleFactor: 2, buffer: source.resize({ width: 36, height: 36, quality: "best" }).toPNG() });
    mac.setTemplateImage(true);
    tray = new Tray(mac);
  } else tray = new Tray(icon);
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

// Squirrel.Mac only installs updates into a Developer ID-signed app; ad-hoc
// builds (no certificate in CI) keep pointing people to the Releases page.
function macUpdatesSupported() {
  const info = spawnSync("codesign", ["-dv", "--verbose=2", process.execPath], { encoding: "utf8" });
  return /Authority=Developer ID Application/.test(info.stderr || "");
}

async function setupAutoUpdater() {
  const updatesBlocked = process.platform === "darwin" && !macUpdatesSupported();

  ipcMain.handle("updater:get-status", () => ({ ...updateState }));

  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged || updatesBlocked) return { ...updateState };
    await autoUpdater.checkForUpdates();
    return { ...updateState };
  });

  ipcMain.handle("updater:install", () => {
    if (updateState.status !== "downloaded") {
      return { ok: false, status: updateState.status };
    }
    // quitAndInstall closes the windows before "before-quit" fires; without this the
    // tray's close handler hides the window and the app never quits (Squirrel.Mac waits forever).
    isQuitting = true;
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

  if (updatesBlocked) {
    setUpdateState({
      status: "dev",
      message: "No macOS, baixe novas versões pela página de Releases.",
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

  updaterReady = true;
  setTimeout(checkForUpdatesOnOpen, 2500);
}

// Verifica ao iniciar e sempre que a janela volta da bandeja (no máximo a cada 10 min).
let updaterReady = false;
let lastUpdateCheck = 0;
function checkForUpdatesOnOpen() {
  if (!updaterReady || Date.now() - lastUpdateCheck < 10 * 60000) return;
  if (["checking", "downloading", "downloaded"].includes(updateState.status)) return;
  lastUpdateCheck = Date.now();
  autoUpdater.checkForUpdates().catch((error) => {
    setUpdateState({
      status: "error",
      message: String(error?.message || error).slice(0, 500),
    });
  });
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
  // Use the exact Electron profile shown to the user. This avoids switching
  // stores when an installation has a customized profile path.
  process.env.NOCTAN_DATA_DIR = join(app.getPath("userData"), "data");
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
    trafficLightPosition: { x: 12, y: 10 },
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
    const origin = String(requestingOrigin || details.requestingUrl || "");
    // Botão "Copiar" dos blocos de código grava na área de transferência.
    if (permission === "clipboard-sanitized-write") return origin.startsWith(localOrigin + "/") || origin === localOrigin;
    if (permission !== "media") return false;
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
  // macOS: clicking the Dock icon reopens the window hidden by close.
  app.on("activate", showMainWindow);
  app.on("before-quit", () => { isQuitting = true; });
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("app.noctan.desktop");
      // Aviso nativo (ex.: o agente fez uma pergunta); clicar reabre a janela, mesmo da bandeja.
      ipcMain.on("desktop:notify", (_event, payload) => {
        if (!Notification.isSupported()) return;
        const notification = new Notification({ title: String(payload?.title || "Noctan").slice(0, 120), body: String(payload?.body || "").slice(0, 300) });
        notification.on("click", showMainWindow);
        notification.show();
      });
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

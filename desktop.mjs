import { app, BrowserWindow, Menu, shell } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";

const APP_PORT = Number(process.env.PORT || 4177);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

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
  await import("./server.mjs");
  await waitForServer();

  const appIcon = join(app.getAppPath(), "public", "noctan-mark.png");

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
      webviewTag: true,
    },
  });

  // Only the trusted local Noctan origin can request microphone access.
  // Chromium persists the grant inside the Electron app profile; Windows can still deny it.
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

app
  .whenReady()
  .then(() => {
    app.setAppUserModelId("app.noctan.desktop");
    return createWindow();
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });

app.on("window-all-closed", () => app.quit());

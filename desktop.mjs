import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

const APP_URL = "http://127.0.0.1:4177";

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${APP_URL}/api/status`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("O servidor local do Claude X não iniciou.");
}

async function createWindow() {
  process.env.CLAUDE_X_DATA_DIR = join(app.getPath("userData"), "data");
  await import("./server.mjs");
  await waitForServer();

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#141414",
    title: "Claude X",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) event.preventDefault();
  });
  await window.loadURL(APP_URL);
}

app
  .whenReady()
  .then(createWindow)
  .catch((error) => {
    console.error(error);
    app.quit();
  });

app.on("window-all-closed", () => app.quit());

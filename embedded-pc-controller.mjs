import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const BASE = dirname(fileURLToPath(import.meta.url));

export function embeddedPcControllerEntry() {
  const candidates = [
    join(BASE, "node_modules", "mcp-chatgpt-full-pc-dev", "src", "app.mjs"),
    process.resourcesPath
      ? join(process.resourcesPath, "app.asar", "node_modules", "mcp-chatgpt-full-pc-dev", "src", "app.mjs")
      : "",
    process.resourcesPath
      ? join(process.resourcesPath, "app.asar.unpacked", "node_modules", "mcp-chatgpt-full-pc-dev", "src", "app.mjs")
      : "",
  ].filter(Boolean);
  return candidates.find(existsSync) || candidates[0];
}

// The controller defaults to powershell.exe/msedge; on macOS seed a settings file
// (user-editable afterwards) that uses the login shell and Chrome instead.
function macSettingsPath(dir) {
  const file = join(dir, "pc-controller-settings.json");
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({
      shell: { command: process.env.SHELL || "/bin/zsh", args: ["-lc"] },
      browser: { preferredChannel: "chrome", fallbackToChromium: true },
    }, null, 2));
  }
  return file;
}

export function embeddedPcControllerDefinition() {
  const electronRuntime = Boolean(process.versions?.electron);
  const cwd = process.env.NOCTAN_DATA_DIR || process.cwd();
  return {
    command: process.execPath,
    args: [embeddedPcControllerEntry()],
    env: {
      ...(electronRuntime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      NOCTAN_EMBEDDED_PC_CONTROLLER: "1",
      ...(process.platform === "darwin"
        ? { MCP_SETTINGS_PATH: macSettingsPath(process.env.NOCTAN_DATA_DIR || join(homedir(), ".noctan", "data")) }
        : {}),
    },
    cwd,
  };
}

export function withEmbeddedPcController(definitions = {}) {
  return {
    ...definitions,
    "pc-controller": embeddedPcControllerDefinition(),
  };
}

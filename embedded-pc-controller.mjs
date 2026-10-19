import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
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

export function embeddedPcControllerDefinition() {
  const electronRuntime = Boolean(process.versions?.electron);
  return {
    command: process.execPath,
    args: [embeddedPcControllerEntry()],
    env: {
      ...(electronRuntime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      NOCTAN_EMBEDDED_PC_CONTROLLER: "1",
    },
    cwd: process.env.NOCTAN_DATA_DIR || process.cwd(),
  };
}

export function withEmbeddedPcController(definitions = {}) {
  return {
    ...definitions,
    "pc-controller": embeddedPcControllerDefinition(),
  };
}

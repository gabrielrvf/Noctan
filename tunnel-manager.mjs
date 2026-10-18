import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let child = null;
let state = {
  status: "stopped",
  message: "PC Controller parado",
  startedAt: null,
  lastError: "",
};

process.once("exit", () => {
  try { child?.kill(); } catch {}
});

export function defaultControllerPath() {
  const home = homedir();
  const direct = [
    join(home, "mcp-chatgpt"),
    join(home, "Documents", "MCP-ChatGPT"),
    join(home, "Downloads", "MCP-ChatGPT"),
  ];
  for (const candidate of direct)
    if (existsSync(join(candidate, "tunnel-client.exe"))) return candidate;

  const ignored = new Set(["node_modules", ".git", "AppData", "dist", "build"]);
  const find = (root, depth = 0) => {
    if (!root || depth > 7 || !existsSync(root)) return "";
    let entries = [];
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { return ""; }
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "tunnel-client.exe"))
      return root;
    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name)) continue;
      const found = find(join(root, entry.name), depth + 1);
      if (found) return found;
    }
    return "";
  };
  return find(join(home, "Documents", "Codex")) || find(join(home, "Downloads"));
}

function profilePath(profileName) {
  return join(
    process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
    "tunnel-client",
    `${profileName || "mcp-chatgpt-full-pc-dev"}.yaml`,
  );
}

function profileHealthAddress(profileName) {
  try {
    const text = readFileSync(profilePath(profileName), "utf8");
    return text.match(/listen_addr:\s*["']?([^"'\r\n]+)["']?/i)?.[1]?.trim() || "127.0.0.1:8080";
  } catch {
    return "127.0.0.1:8080";
  }
}

async function probeTunnelHealth(profileName, timeoutMs = 1200) {
  const address = profileHealthAddress(profileName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${address}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { healthy: false, address, body: null };
    const body = await response.json().catch(() => ({}));
    return {
      healthy: Boolean(body.ready ?? body.live ?? true),
      address,
      body,
    };
  } catch {
    return { healthy: false, address, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export function tunnelStatus() {
  return { ...state, pid: child?.pid || null };
}

export async function tunnelStatusLive(profileName) {
  const health = await probeTunnelHealth(profileName);
  if (health.healthy) {
    state = {
      ...state,
      status: "connected",
      message: "PC Controller conectado",
      startedAt:
        state.startedAt ||
        health.body?.runtime?.started_at ||
        new Date().toISOString(),
      lastError: "",
    };
    return {
      ...state,
      pid: child?.pid || null,
      external: !child,
      healthAddress: health.address,
    };
  }

  if (!child || child.killed) {
    state = {
      ...state,
      status: "stopped",
      message: "PC Controller parado",
      lastError: "",
    };
  }
  return {
    ...state,
    pid: child?.pid || null,
    external: false,
    healthAddress: health.address,
  };
}

export async function startTunnel({ controllerPath, profile, runtimeKey }) {
  const profileName = profile || "mcp-chatgpt-full-pc-dev";
  const existing = await tunnelStatusLive(profileName);
  if (existing.status === "connected") return existing;
  if (child && !child.killed) return tunnelStatus();

  let root = String(controllerPath || "").trim();
  if (!root || !existsSync(join(root, "tunnel-client.exe")))
    root = defaultControllerPath();
  const executable = join(root, "tunnel-client.exe");

  if (!root || !existsSync(executable))
    throw Error("tunnel-client.exe não foi encontrado na pasta do PC Controller.");
  if (!runtimeKey)
    throw Error("Informe a Runtime API Key do Secure MCP Tunnel.");
  if (!existsSync(profilePath(profileName)))
    throw Error("O profile do PC Controller ainda não foi inicializado neste Windows.");

  state = {
    status: "connecting",
    message: "Conectando ao PC Controller...",
    startedAt: null,
    lastError: "",
  };

  child = spawn(executable, ["run", "--profile", profileName], {
    cwd: root,
    windowsHide: true,
    shell: false,
    env: { ...process.env, CONTROL_PLANE_API_KEY: runtimeKey },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const observe = (chunk) => {
    const text = String(chunk || "");
    const detail = text
      .replace(/sk-[A-Za-z0-9_-]+/g, "[CHAVE OCULTA]")
      .trim()
      .slice(-500);
    if (/error|failed|unauthorized|forbidden/i.test(text)) {
      state = {
        ...state,
        status: "error",
        message: "Falha no Secure Tunnel",
        lastError: detail,
      };
    } else if (/dispatcher|connected|poll|tunnel/i.test(text)) {
      state = {
        ...state,
        status: "connected",
        message: "PC Controller conectado",
        startedAt: state.startedAt || new Date().toISOString(),
        lastError: "",
      };
    } else if (detail) {
      state = { ...state, lastError: detail };
    }
  };

  child.stdout.on("data", observe);
  child.stderr.on("data", observe);
  child.once("error", (error) => {
    state = {
      ...state,
      status: "error",
      message: "Não foi possível iniciar o PC Controller",
      lastError: error.message,
    };
    child = null;
  });
  child.once("exit", (code) => {
    if (state.status !== "stopping") {
      state = {
        ...state,
        status: code === 0 ? "stopped" : "error",
        message: code === 0 ? "PC Controller parado" : "Secure Tunnel encerrado",
        lastError: code === 0 ? "" : state.lastError || `Código ${code}`,
      };
    } else {
      state = {
        ...state,
        status: "stopped",
        message: "PC Controller parado",
        lastError: "",
      };
    }
    child = null;
  });

  return tunnelStatus();
}

export function stopTunnel() {
  if (!child || child.killed) return tunnelStatus();
  state = {
    ...state,
    status: "stopping",
    message: "Desconectando...",
  };
  child.kill();
  return tunnelStatus();
}

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { arch, homedir, platform } from "node:os";
import { ensureNoctanTunnelProfile, managedTunnelProfilePath, sourceTunnelProfilePath } from "./noctan-tunnel-profile.mjs";

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

function tunnelExecutableNames() {
  return platform() === "win32"
    ? ["tunnel-client-runtime-cloudflared.exe", "tunnel-client.exe"]
    : ["tunnel-client-runtime-cloudflared", "tunnel-client"];
}

export function bundledTunnelExecutable() {
  const platformArch = `${platform()}-${arch()}`;
  const roots = [
    process.env.NOCTAN_TUNNEL_CLIENT ? dirname(process.env.NOCTAN_TUNNEL_CLIENT) : "",
    process.resourcesPath ? join(process.resourcesPath, "tunnel-client", platformArch) : "",
    process.resourcesPath ? join(process.resourcesPath, "tunnel-client") : "",
  ].filter(Boolean);
  for (const root of roots)
    for (const name of tunnelExecutableNames()) {
      const candidate = join(root, name);
      if (existsSync(candidate)) return candidate;
    }
  return process.env.NOCTAN_TUNNEL_CLIENT && existsSync(process.env.NOCTAN_TUNNEL_CLIENT)
    ? process.env.NOCTAN_TUNNEL_CLIENT
    : "";
}

function profilePath(profileName) {
  return sourceTunnelProfilePath(profileName || "mcp-chatgpt-full-pc-dev");
}

/** Caminho curto do Windows (8.3), sem espaços. Sem 8.3 disponível, devolve o original. */
function shortPath(path) {
  try {
    const out = execFileSync("cmd.exe", ["/d", "/c", `for %I in ("${path}") do @echo %~sI`], { encoding: "utf8", windowsHide: true }).trim();
    return out && !out.includes(" ") ? out.replace(/\\/g, "/") : path;
  } catch {
    return path;
  }
}

/**
 * Conserta o profile antes de subir (2026-10-19, o túnel morria ao abrir o Noctan):
 * 1. Hard link com a cópia do app Codex (AppData\Local\Packages\OpenAI.Codex_*): o tunnel-client recusa com
 *    "too many levels of symbolic links". Recria o arquivo com o mesmo conteúdo, só neste Windows.
 * 2. `command` com espaço sem aspas ("C:/Program Files/nodejs/node.exe ..."): o tunnel-client corta no espaço
 *    ("exec: C:/Program"). Troca o executável pelo caminho curto.
 * Devolve o que consertou (sem segredos), para o log/UI.
 */
export function repairProfile(profileName) {
  const file = profilePath(profileName);
  const fixed = [];
  if (!existsSync(file)) return fixed;
  let text = readFileSync(file, "utf8");
  let linked = false;
  try { linked = statSync(file).nlink > 1; } catch {}
  text = text.replace(/(command:\s*["'])([A-Za-z]:[\\/][^"'\r\n]*?\.exe)(\s)/i, (all, head, exe, sep) => {
    if (!exe.includes(" ") || !existsSync(exe)) return all;
    const short = shortPath(exe);
    if (short === exe) return all;
    fixed.push("command com espaço");
    return head + short + sep;
  });
  if (linked || fixed.length) {
    // Apagar e escrever de novo desfaz o hard link (o outro nome continua com o conteúdo antigo, intacto).
    rmSync(file, { force: true });
    writeFileSync(file, text, "utf8");
    if (linked) fixed.unshift("hard link com o Codex");
  }
  return fixed;
}

function profileHealthAddress(profileName, managed = false) {
  try {
    const file = managed ? managedTunnelProfilePath(profileName) : profilePath(profileName);
    const text = readFileSync(file, "utf8");
    return text.match(/listen_addr:\s*["']?([^"'\r\n]+)["']?/i)?.[1]?.trim() || "127.0.0.1:8080";
  } catch {
    return "127.0.0.1:8080";
  }
}

async function probeTunnelHealth(profileName, timeoutMs = 1200) {
  const address = profileHealthAddress(profileName, existsSync(managedTunnelProfilePath(profileName)));
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

  // Processo morreu com erro: mantém "error" e o motivo (antes virava "parado" sem motivo e ninguém via a falha).
  if ((!child || child.killed) && state.status !== "error") {
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

  let executable = bundledTunnelExecutable();
  let root = executable ? dirname(executable) : String(controllerPath || "").trim();
  if (!executable) {
    if (!root || !tunnelExecutableNames().some((name) => existsSync(join(root, name))))
      root = defaultControllerPath();
    executable = tunnelExecutableNames().map((name) => join(root, name)).find(existsSync) || "";
  }

  if (!root || !executable || !existsSync(executable))
    throw Error("O Secure MCP Tunnel não está incluído nesta instalação do Noctan.");
  if (!runtimeKey)
    throw Error("Informe a Runtime API Key do Secure MCP Tunnel.");
  if (!existsSync(profilePath(profileName)))
    throw Error("O túnel ainda não foi vinculado à conta do ChatGPT neste computador.");
  const managed = ensureNoctanTunnelProfile(profileName, { port: Number(process.env.PORT || 4177) });
  const repaired = [];

  state = {
    status: "connecting",
    message: repaired.length ? `Conectando (consertado: ${repaired.join(", ")})...` : "Conectando ao PC Controller...",
    startedAt: null,
    lastError: "",
  };

  child = spawn(executable, ["run", "--profile-file", managed.target], {
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

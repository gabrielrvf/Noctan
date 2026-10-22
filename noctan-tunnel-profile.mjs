import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

function userProfileDir() {
  if (platform() === "win32")
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "tunnel-client");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tunnel-client");
}

export function sourceTunnelProfilePath(profileName = "mcp-chatgpt-full-pc-dev") {
  return join(userProfileDir(), `${profileName}.yaml`);
}

export function managedTunnelProfilePath(profileName = "mcp-chatgpt-full-pc-dev") {
  const dataDir = process.env.NOCTAN_DATA_DIR || join(userProfileDir(), "noctan");
  const safe = String(profileName).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 120) || "noctan";
  return join(dataDir, "tunnel", `${safe}-noctan.yaml`);
}

function field(text, name, fallback = "") {
  return text.match(new RegExp(`^\\s*${name}:\\s*["']?([^"'\\r\\n#]+)`, "mi"))?.[1]?.trim() || fallback;
}

/**
 * Creates an app-owned profile that preserves the user's tunnel identity but
 * points the tunnel at Noctan's local HTTP MCP endpoint. The original profile
 * remains untouched so migration is reversible.
 */
export function ensureNoctanTunnelProfile(profileName, {
  port = 4177,
  sourcePath = sourceTunnelProfilePath(profileName),
  targetPath = managedTunnelProfilePath(profileName),
} = {}) {
  const source = sourcePath;
  const target = targetPath;
  if (!existsSync(source) && !existsSync(target))
    throw new Error("O túnel ainda não foi vinculado à conta do ChatGPT neste computador.");

  const original = readFileSync(existsSync(source) ? source : target, "utf8");
  const tunnelId = field(original, "tunnel_id");
  if (!/^tunnel_[a-z0-9_]{32,}$/.test(tunnelId))
    throw new Error("O perfil do túnel não contém um Tunnel ID válido.");

  const baseUrl = field(original, "base_url", "https://api.openai.com");
  const urlPath = field(original, "url_path");
  const listenAddr = field(original, "listen_addr", "127.0.0.1:8080");
  const yaml = [
    "config_version: 1",
    "control_plane:",
    `  base_url: ${JSON.stringify(baseUrl)}`,
    ...(urlPath ? [`  url_path: ${JSON.stringify(urlPath)}`] : []),
    `  tunnel_id: ${JSON.stringify(tunnelId)}`,
    '  api_key: "env:CONTROL_PLANE_API_KEY"',
    "health:",
    `  listen_addr: ${JSON.stringify(listenAddr)}`,
    "admin_ui:",
    "  open_browser: false",
    "log:",
    "  level: info",
    "  format: json",
    "mcp:",
    "  server_urls:",
    "    - channel: main",
    `      url: ${JSON.stringify(`http://127.0.0.1:${port}/mcp`)}`,
    "",
  ].join("\n");

  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && readFileSync(target, "utf8") !== yaml)
    copyFileSync(target, `${target}.bak`);
  writeFileSync(target, yaml, "utf8");
  return { source, target, tunnelId, listenAddr };
}

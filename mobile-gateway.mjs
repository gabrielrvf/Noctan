import http from "node:http";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { loadSecret, saveSecret } from "./secure-key.mjs";

const DATA = process.env.NOCTAN_DATA_DIR || join(homedir(), "AppData", "Roaming", "Noctan", "data");
const TOKEN_FILE = join(DATA, "mobile-token.dpapi");
const PORT = Number(process.env.NOCTAN_MOBILE_PORT || 4178);
const HOST = "0.0.0.0";

await mkdir(DATA, { recursive: true });
let token = await loadSecret(TOKEN_FILE).catch(() => null);
if (!token) {
  token = randomBytes(32).toString("base64url");
  await saveSecret(token, TOKEN_FILE);
}

const allowed = (method, path) => {
  if (method === "GET" && (path === "/api/status" || path === "/api/sessions" || path === "/api/sessions-summary" || path === "/api/pc-controller/status" || path === "/api/tunnel/status")) return true;
  if (method === "GET" && path.startsWith("/api/sessions/") && path.split("/").length === 4) return true;
  if (method === "POST" && ["/api/run","/api/follow-up","/api/approve","/api/cancel"].includes(path)) return true;
  if (method === "PUT" && path === "/api/config") return true;
  return false;
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "content-type");
}

function isLoopback(req) {
  const ip = String(req.socket.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function proxy(req, res) {
  const headers = { ...req.headers };
  delete headers.authorization;
  delete headers.origin;
  delete headers.referer;
  headers.host = "127.0.0.1:4177";
  const upstream = http.request({ hostname: "127.0.0.1", port: 4177, path: req.url, method: req.method, headers }, (up) => {
    const outHeaders = { ...up.headers, "access-control-allow-origin": "*", "access-control-expose-headers": "content-type" };
    res.writeHead(up.statusCode || 502, outHeaders);
    up.pipe(res);
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) { cors(res); res.writeHead(502, { "content-type": "application/json" }); }
    res.end(JSON.stringify({ error: error.message }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
  if (url.pathname === "/pairing" && req.method === "GET" && isLoopback(req)) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ port: PORT, token }));
  }
  const auth = String(req.headers.authorization || "");
  if (auth !== "Bearer " + token) {
    res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "Nao autorizado" }));
  }
  if (!allowed(req.method || "GET", url.pathname)) {
    res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "Rota nao permitida no controle movel" }));
  }
  proxy(req, res);
});

server.on("error", (error) => console.error("[mobile-gateway]", error));
server.listen(PORT, HOST, () => console.log("[Noctan Mobile] gateway em " + HOST + ":" + PORT));

export function getMobilePairingToken() { return token; }


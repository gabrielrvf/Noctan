import http from "node:http";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const BASE = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.CLAUDE_X_DATA_DIR
  ? resolve(process.env.CLAUDE_X_DATA_DIR)
  : join(BASE, "data");
const CONFIG = join(DATA, "config.json");
const SESSIONS = join(DATA, "sessions.json");
const HOST = "127.0.0.1",
  PORT = Number(process.env.PORT || 4177);
const defaults = {
  workspace: "",
  vault: "",
  model: "sonnet",
  effort: "medium",
  maxTurns: 15,
  maxBudgetUsd: 1,
  settingSources: ["user", "project", "local"],
  pluginPaths: [],
  mcpConfigPaths: [],
  additionalDirectories: [],
  systemInstructions: "",
  safeMode: true,
};
let config = { ...defaults },
  sessions = {},
  active = new Map(),
  approvals = new Map();
const json = (res, code, obj) => {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(obj));
};
async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}
async function saveJson(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  await import("node:fs/promises").then((fs) => fs.rename(tmp, path));
}
const readBody = async (req) => {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 300000) throw Error("Requisição muito grande");
  }
  return JSON.parse(s || "{}");
};
function localPath(p) {
  return typeof p === "string" && p.trim() ? resolve(p) : "";
}
function cleanConfig(input) {
  const next = { ...config };
  for (const k of Object.keys(defaults)) {
    if (k in input) next[k] = input[k];
  }
  for (const k of ["workspace", "vault"]) next[k] = localPath(next[k]);
  for (const k of ["pluginPaths", "mcpConfigPaths", "additionalDirectories"])
    next[k] = Array.isArray(next[k])
      ? next[k]
          .filter((x) => typeof x === "string" && x.trim())
          .map((x) => resolve(x))
      : [];
  next.maxTurns = Math.max(1, Math.min(100, Number(next.maxTurns) || 15));
  next.maxBudgetUsd = Math.max(
    0.05,
    Math.min(100, Number(next.maxBudgetUsd) || 1),
  );
  next.safeMode = Boolean(next.safeMode);
  next.settingSources = ["user", "project", "local"].filter((s) =>
    next.settingSources?.includes(s),
  );
  next.model = String(next.model || defaults.model).slice(0, 120);
  next.effort = ["low", "medium", "high"].includes(next.effort)
    ? next.effort
    : defaults.effort;
  next.systemInstructions = String(next.systemInstructions || "").slice(
    0,
    10000,
  );
  return next;
}
function redact(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) =>
      /api.?key|token|secret|password|authorization/i.test(k)
        ? "[REDACTED]"
        : v,
    ),
  );
}
function sessionView(s) {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messages: s.messages,
    claudeSessionId: s.claudeSessionId || null,
  };
}
function send(res, type, data) {
  if (!res.writableEnded)
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
function respondError(res, e) {
  json(res, 500, { error: String(e?.message || e) });
}
async function runAgent(req, res) {
  if (!process.env.ANTHROPIC_API_KEY)
    return json(res, 409, {
      error: "ANTHROPIC_API_KEY não configurada. Execute iniciar-windows.ps1.",
    });
  if (!config.workspace || !existsSync(config.workspace))
    return json(res, 409, {
      error: "Configure um workspace existente em Configurações.",
    });
  const body = await readBody(req),
    prompt = String(body.prompt || "").trim();
  if (!prompt || prompt.length > 40000)
    return json(res, 400, { error: "Mensagem vazia ou muito longa." });
  const id =
    typeof body.sessionId === "string" && sessions[body.sessionId]
      ? body.sessionId
      : randomUUID();
  if (active.has(id))
    return json(res, 409, { error: "Já existe execução nessa conversa." });
  const s = sessions[id] || {
    id,
    title: prompt.slice(0, 65),
    createdAt: new Date().toISOString(),
    messages: [],
  };
  s.messages.push({ role: "user", text: prompt, at: new Date().toISOString() });
  s.updatedAt = new Date().toISOString();
  sessions[id] = s;
  await saveJson(SESSIONS, sessions);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
  send(res, "start", { sessionId: id });
  const ctrl = new AbortController();
  active.set(id, { ctrl, res });
  let finalText = "",
    spent = 0;
  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const extra = [config.vault, ...config.additionalDirectories].filter(
      (p) => p && existsSync(p),
    );
    const opts = {
      cwd: config.workspace,
      model: config.model,
      effort: config.effort,
      settingSources: config.settingSources,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append:
          config.systemInstructions +
          "\nFollow the project instructions and persistent memory files. Never print secrets.",
      },
      additionalDirectories: extra,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      abortController: ctrl,
      permissionMode: "default",
      includePartialMessages: false,
    };
    if (s.claudeSessionId) opts.resume = s.claudeSessionId;
    if (config.pluginPaths.length)
      opts.plugins = config.pluginPaths
        .filter(existsSync)
        .map((path) => ({ type: "local", path }));
    if (config.mcpConfigPaths.length)
      opts.mcpServers = await mergeMcpConfigs(config.mcpConfigPaths);
    opts.canUseTool = async (toolName, input) => {
      if (ctrl.signal.aborted)
        return { behavior: "deny", message: "Execução cancelada" };
      const aid = randomUUID();
      send(res, "approval", { id: aid, tool: toolName, input: redact(input) });
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          approvals.delete(aid);
          resolve({ behavior: "deny", message: "Aprovação expirou" });
        }, 120000);
        approvals.set(aid, {
          sessionId: id,
          decide: (allowed) => {
            clearTimeout(timer);
            approvals.delete(aid);
            resolve(
              allowed
                ? { behavior: "allow", updatedInput: input }
                : { behavior: "deny", message: "Negado pelo usuário" },
            );
          },
        });
      });
    };
    for await (const m of query({ prompt, options: opts })) {
      if (m.session_id) s.claudeSessionId = m.session_id;
      if (m.type === "assistant") {
        for (const b of m.message?.content || []) {
          if (b.type === "text") {
            finalText += b.text + "\n";
            send(res, "text", { text: b.text });
          } else if (b.type === "tool_use")
            send(res, "tool", { name: b.name, input: redact(b.input) });
        }
      } else if (m.type === "result") {
        spent = Number(m.total_cost_usd || 0);
        send(res, "result", {
          subtype: m.subtype,
          costUsd: spent,
          usage: m.usage || null,
          isError: m.is_error || false,
        });
        if (m.is_error && m.result)
          send(res, "notice", { text: String(m.result).slice(0, 3000) });
      } else if (m.type === "system" && m.subtype === "init")
        send(res, "init", {
          tools: m.tools || [],
          mcpServers: m.mcp_servers || [],
        });
    }
    s.messages.push({
      role: "assistant",
      text: finalText || "(Sem resposta textual)",
      costUsd: spent,
      at: new Date().toISOString(),
    });
    s.updatedAt = new Date().toISOString();
    await saveJson(SESSIONS, sessions);
    send(res, "done", { sessionId: id });
  } catch (e) {
    const msg = String(e?.message || e);
    send(res, "error", { error: msg.slice(0, 3000) });
    s.messages.push({
      role: "system",
      text: "Erro: " + msg.slice(0, 2000),
      at: new Date().toISOString(),
    });
    await saveJson(SESSIONS, sessions);
  } finally {
    active.delete(id);
    for (const [k, v] of approvals) if (v.sessionId === id) v.decide(false);
    res.end();
  }
}
async function mergeMcpConfigs(paths) {
  const all = {};
  for (const p of paths) {
    try {
      const x = JSON.parse(await readFile(p, "utf8"));
      Object.assign(all, x.mcpServers || {});
    } catch {}
  }
  return all;
}
async function findPluginPaths(root, depth = 0) {
  if (!root || depth > 5 || !existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.isFile() && entry.name === "plugin.json"))
    return [root];
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => findPluginPaths(join(root, entry.name), depth + 1)),
  );
  return nested.flat();
}
async function discover() {
  const home = homedir(),
    claude = join(home, ".claude");
  const candidates = [
    join(home, "Documents", "AI_Memory_Vault"),
    join(home, "OneDrive", "Documents", "AI_Memory_Vault"),
    join(home, "OneDrive", "Documentos", "AI_Memory_Vault"),
  ];
  const pluginRoot = join(claude, "plugins");
  return {
    platform: platform(),
    home,
    claudeDir: existsSync(claude) ? claude : null,
    vaultCandidates: candidates.filter(existsSync),
    claudeMd: [
      join(home, "CLAUDE.md"),
      join(claude, "CLAUDE.md"),
      join(config.workspace || BASE, "CLAUDE.md"),
    ].filter(existsSync),
    mcpConfigs: [
      join(home, ".claude.json"),
      join(claude, "settings.json"),
      join(config.workspace || BASE, ".mcp.json"),
    ].filter(existsSync),
    pluginRoot: existsSync(pluginRoot) ? pluginRoot : null,
    pluginPaths: await findPluginPaths(join(pluginRoot, "cache")),
    workspaceExists: Boolean(config.workspace && existsSync(config.workspace)),
    vaultExists: Boolean(config.vault && existsSync(config.vault)),
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    activeSessions: [...active.keys()],
  };
}
async function staticFile(res, path) {
  const files = {
    "/": "index.html",
    "/app.js": "app.js",
    "/style.css": "style.css",
  };
  if (!files[path]) return json(res, 404, { error: "Não encontrado" });
  const file = join(BASE, "public", files[path]);
  const ext = path.endsWith(".js")
    ? "text/javascript"
    : path.endsWith(".css")
      ? "text/css"
      : "text/html";
  res.writeHead(200, {
    "content-type": ext + "; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
  res.end(await readFile(file));
}
await mkdir(DATA, { recursive: true });
config = cleanConfig(await loadJson(CONFIG, defaults));
sessions = await loadJson(SESSIONS, {});
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    if (
      req.headers.origin &&
      !["http://127.0.0.1:" + PORT, "http://localhost:" + PORT].includes(
        req.headers.origin,
      )
    )
      return json(res, 403, { error: "Origem não autorizada" });
    if (req.method === "GET" && ["/", "/app.js", "/style.css"].includes(path))
      return await staticFile(res, path);
    if (req.method === "GET" && path === "/api/status")
      return json(res, 200, {
        discovery: await discover(),
        config,
        sessionCount: Object.keys(sessions).length,
      });
    if (req.method === "GET" && path === "/api/sessions")
      return json(
        res,
        200,
        Object.values(sessions)
          .map(sessionView)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    if (req.method === "GET" && path.startsWith("/api/sessions/"))
      return json(
        res,
        sessions[path.split("/").pop()] ? 200 : 404,
        sessions[path.split("/").pop()] || { error: "Não encontrada" },
      );
    if (req.method === "POST" && path === "/api/connect") {
      const b = await readBody(req),
        key = String(b.key || "").trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key))
        return json(res, 400, {
          error: "A chave não parece ser uma chave válida da Anthropic.",
        });
      process.env.ANTHROPIC_API_KEY = key;
      return json(res, 200, { ok: true, apiKeyConfigured: true });
    }
    if (req.method === "POST" && path === "/api/autoconfigure") {
      const detected = await discover();
      config = cleanConfig({
        ...config,
        vault: config.vault || detected.vaultCandidates[0] || "",
        mcpConfigPaths: config.mcpConfigPaths.length
          ? config.mcpConfigPaths
          : detected.mcpConfigs,
        pluginPaths: config.pluginPaths.length
          ? config.pluginPaths
          : detected.pluginPaths,
      });
      await saveJson(CONFIG, config);
      return json(res, 200, { ok: true, config });
    }
    if (req.method === "PUT" && path === "/api/config") {
      config = cleanConfig(await readBody(req));
      await saveJson(CONFIG, config);
      return json(res, 200, { ok: true, config });
    }
    if (req.method === "POST" && path === "/api/run")
      return await runAgent(req, res);
    if (req.method === "POST" && path === "/api/approve") {
      const b = await readBody(req),
        a = approvals.get(b.id);
      if (!a)
        return json(res, 404, {
          error: "Aprovação não encontrada ou expirada",
        });
      a.decide(b.allow === true);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && path === "/api/cancel") {
      const b = await readBody(req),
        a = active.get(b.sessionId);
      if (!a) return json(res, 404, { error: "Execução não encontrada" });
      a.ctrl.abort();
      for (const [k, v] of approvals)
        if (v.sessionId === b.sessionId) v.decide(false);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "Rota não encontrada" });
  } catch (e) {
    if (!res.headersSent) respondError(res, e);
    else res.end();
  }
});
server.listen(PORT, HOST, () =>
  console.log(`Claude X disponível em http://${HOST}:${PORT}`),
);

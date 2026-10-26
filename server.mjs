import http from "node:http";
import { readFile, writeFile, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { handoffFingerprint, normalizeExternalText } from "./external-handoff.mjs";
import { saveApiKey, loadApiKey, removeApiKey } from "./secure-key.mjs";
import { defaultControllerPath, startTunnel, stopTunnel, tunnelStatus, tunnelStatusLive } from "./tunnel-manager.mjs";
import { connectLocalPcController, disconnectLocalPcController, localPcControllerStatus } from "./pc-controller-manager.mjs";
import { embeddedPcControllerDefinition, withEmbeddedPcController } from "./embedded-pc-controller.mjs";
import { createNoctanMcpServer } from "./noctan-mcp.mjs";
import { importGeneratedImages } from "./generated-images.mjs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { fileURLToPath } from "node:url";
const BASE = dirname(fileURLToPath(import.meta.url));
function resolveClaudeCodeExecutable() {
  const pkg = `claude-agent-sdk-${process.platform}-${process.arch}`;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@anthropic-ai", pkg, exe) : "",
    join(BASE, "node_modules", "@anthropic-ai", pkg, exe),
  ].filter(Boolean);
  return candidates.find(existsSync) || undefined;
}
const DATA_DIR = process.env.NOCTAN_DATA_DIR || process.env.CLAUDE_X_DATA_DIR;
const DATA = DATA_DIR ? resolve(DATA_DIR) : (process.platform === "win32" && process.env.APPDATA ? join(process.env.APPDATA, "Noctan", "data") : join(homedir(), ".noctan", "data"));
const CONFIG = join(DATA, "config.json");
const SESSIONS = join(DATA, "sessions.json");
const DELETED_SESSIONS = join(DATA, "deleted-sessions.json");
const ATTACHMENTS = join(DATA, "attachments");
const SECRET_FILE = join(DATA, "anthropic-key.dpapi");
const OPENAI_SECRET_FILE = join(DATA, "openai-key.dpapi");
const TUNNEL_SECRET_FILE = join(DATA, "tunnel-runtime-key.dpapi");
const HOST = "127.0.0.1",
  PORT = Number(process.env.PORT || 4177);
const defaults = {
  provider: "anthropic",
  workspace: "",
  vault: "",
  model: "sonnet",
  anthropicModel: "sonnet",
  openaiModel: "gpt-5.4",
  effort: "medium",
  bypassAllPermissions: false,
  settingSources: ["user", "project", "local"],
  pluginPaths: [],
  mcpConfigPaths: [],
  additionalDirectories: [],
  systemInstructions: "",
  safeMode: true,
  microphoneId: "default",
  microphoneLabel: "",
  pcControllerPath: defaultControllerPath(),
  tunnelProfile: "mcp-chatgpt-full-pc-dev",
  autoStartTunnel: true,
};
let config = { ...defaults },
  sessions = {},
  deletedSessions = {},
  active = new Map(),
  approvals = new Map();
// Each server process gets its own boot id. A session left with `inFlight`
// by a previous process (app closed mid-run) is resumed at most once per boot:
// whoever claims it first (the server's own boot recovery or a UI window) runs
// the resume, every other client just follows the live run.
const BOOT_ID = randomUUID();
const bootRecoveryClaims = new Set();
const BILLING_ERROR_PATTERN = /credit balance is too low|usage limits/i;
let desktopHandoffHandler = null;
const recentHandoffs = new Map();

export function setDesktopHandoffHandler(handler) {
  desktopHandoffHandler = typeof handler === "function" ? handler : null;
}
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
async function replaceWithRetry(tmp, path) {
  const fs = await import("node:fs/promises");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tmp, path);
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
      if (attempt >= 20) {
        // Windows: antivírus/indexador ou o processo antigo da atualização seguram o destino; sobrescrever ainda funciona.
        await fs.copyFile(tmp, path);
        await fs.rm(tmp, { force: true });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * Math.min(attempt + 1, 6)));
    }
  }
}
async function takeSessionsLock() {
  const fs = await import("node:fs/promises");
  const lock = SESSIONS + ".lock";
  for (let i = 0; i < 150; i++) {
    try { await mkdir(lock); return lock; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      // Lock de um processo morto (ex.: fechado pela atualização) não pode travar as conversas para sempre.
      const age = await fs.stat(lock).then((st) => Date.now() - st.mtimeMs, () => 0);
      if (age > 30000) { await fs.rm(lock, { recursive: true, force: true }); continue; }
      if (i === 149) throw Error("Conversas ocupadas: tente novamente.");
      await new Promise(done => setTimeout(done, 50));
    }
  }
}
function isMissingClaudeSessionError(value) {
  return /No conversation found with session ID:/i.test(String(value?.message || value || ""));
}
function normalizeChromeCommand(value) {
  const prompt = String(value || "").trim();
  if (/^\/(?:chrome|anthropic-skills:chrome-browser)(?:\s+enable)?\s*$/i.test(prompt)) return "/chrome";
  return prompt;
}

function isNoisyAgentCrashMessage(message) {
  const text = String(message?.text || "");
  return message?.role === "system" && (
    /Claude Code process exited with code 3/.test(text) ||
    /Bun has crashed/.test(text) ||
    /Segmentation fault at address/.test(text)
  );
}
function shortAgentError(error) {
  const raw = String(error?.message || error || "");
  if (/Claude Code process exited with code 3|Bun has crashed|Segmentation fault at address/.test(raw)) {
    return "O processo do agente caiu inesperadamente. O Noctan preservou a conversa e pode continuar sem exibir o dump técnico.";
  }
  return raw.slice(0, 1000);
}
// A streaming assistant reply is checkpointed many times under the same `at`
// while its text grows. Two copies with the same role+timestamp are the same
// message when one text contains the other: keep the most complete one. Copies
// whose texts are unrelated are distinct messages and are both preserved, so a
// merge can never shorten the visible history or drop the latest checkpoint.
function normalizedMessageText(msg) {
  return String(msg?.text || "").replace(/\s+/g, " ").trim();
}
function sameMessageSnapshot(a, b) {
  if (!a || !b || a.role !== b.role || String(a.at || "") !== String(b.at || "")) return false;
  if (a.role !== "assistant" || !a.at) {
    return a.text === b.text && a.costUsd === b.costUsd && a.kind === b.kind && a.name === b.name;
  }
  const ta = normalizedMessageText(a), tb = normalizedMessageText(b);
  return ta === tb || ta.includes(tb) || tb.includes(ta);
}
function mergeMessageLists(...lists) {
  const merged = [];
  const byTime = new Map();
  for (const list of lists) {
    for (const msg of list || []) {
      if (!msg || isNoisyAgentCrashMessage(msg)) continue;
      const bucketKey = JSON.stringify([msg.role, msg.at || ""]);
      const bucket = byTime.get(bucketKey) || [];
      const index = bucket.find((i) => sameMessageSnapshot(merged[i], msg));
      if (index === undefined) {
        bucket.push(merged.length);
        byTime.set(bucketKey, bucket);
        merged.push(msg);
      } else if (normalizedMessageText(msg).length >= normalizedMessageText(merged[index]).length) {
        merged[index] = { ...merged[index], ...msg };
      }
    }
  }
  return merged
    .map((msg, order) => ({ msg, order }))
    .sort((a, b) => String(a.msg.at || "").localeCompare(String(b.msg.at || "")) || a.order - b.order)
    .map(({ msg }) => msg);
}
function mergeSessions(stored, incoming) {
  const merged = {...stored};
  for (const [id, current] of Object.entries(incoming || {})) {
    if (deletedSessions[id]) {
      delete merged[id];
      continue;
    }
    const previous = merged[id];
    if (!previous) { merged[id] = current; continue; }
    const messages = mergeMessageLists(previous.messages || [], current.messages || []);
    const mostRecent = String(current.updatedAt || "") >= String(previous.updatedAt || "") ? current : previous;

    const agents = { ...(previous.agents || {}) };
    for (const [agentId, incomingAgent] of Object.entries(current.agents || {})) {
      const existingAgent = agents[agentId];
      if (!existingAgent) { agents[agentId] = incomingAgent; continue; }
      const events = [...(existingAgent.events || []), ...(incomingAgent.events || [])];
      const uniqueEvents = new Map(events.map((event) => [JSON.stringify([event.kind,event.text,event.at]), event]));
      agents[agentId] = { ...existingAgent, ...incomingAgent, events: [...uniqueEvents.values()].sort((a,b) => String(a.at||"").localeCompare(String(b.at||""))) };
    }
    merged[id] = {...previous,...current,...mostRecent,messages,agents};
  }
  return merged;
}
async function saveJson(path,obj) {
  await mkdir(dirname(path), {recursive:true});
  if (path !== SESSIONS) {
    const tmp=path+".tmp-"+randomUUID();
    await writeFile(tmp, JSON.stringify(obj,null,2), {mode:0o600});
    await replaceWithRetry(tmp,path);
    return;
  }
  const lock=await takeSessionsLock();
  const taken=true;
  try {
    const onDisk=await loadJson(SESSIONS,{});
    const merged=withoutDeletedSessions(mergeSessions(onDisk,obj));
    const tmp=SESSIONS+".tmp-"+randomUUID();
    await writeFile(tmp,JSON.stringify(merged,null,2),{mode:0o600});
    await replaceWithRetry(tmp,SESSIONS);
    sessions=merged;
  } finally {
    if(taken)await import("node:fs/promises").then(fs=>fs.rm(lock,{recursive:true,force:true}));
  }
}

function withoutDeletedSessions(store) {
  const filtered = { ...(store || {}) };
  for (const id of Object.keys(deletedSessions || {})) delete filtered[id];
  return filtered;
}

async function deleteSessionById(id) {
  if (!id || active.has(id)) throw Error("Não é possível apagar uma conversa em execução.");
  await mkdir(dirname(SESSIONS), { recursive: true });
  const lock = await takeSessionsLock();
  const taken = true;
  try {
    const onDisk = withoutDeletedSessions(await loadJson(SESSIONS, {}));
    if (!onDisk[id] && !sessions[id]) return false;
    deletedSessions[id] = new Date().toISOString();
    await saveJson(DELETED_SESSIONS, deletedSessions);
    delete onDisk[id];
    delete sessions[id];
    const tmp = SESSIONS + ".tmp-" + randomUUID();
    await writeFile(tmp, JSON.stringify(onDisk, null, 2), { mode: 0o600 });
    await replaceWithRetry(tmp, SESSIONS);
    sessions = onDisk;
    return true;
  } finally {
    if (taken) await import("node:fs/promises").then(fs => fs.rm(lock, { recursive: true, force: true }));
  }
}
async function appendSessionNotice(id, text, meta = {}) {
  sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
  const session = sessions[id];
  if (!session) throw Error("Conversa não encontrada");
  const item = { role: "system", text: String(text || "").trim().slice(0, 2000), kind: String(meta.kind || "notice").slice(0, 40), model: meta.model ? String(meta.model).slice(0, 120) : undefined, at: new Date().toISOString() };
  if (!item.text) throw Error("Aviso vazio");
  session.messages.push(item); session.updatedAt = item.at; sessions[id] = session;
  await saveJson(SESSIONS, sessions);
  const running = active.get(id);
  if (running && running.res) send(running.res, "notice", { text: item.text, kind: item.kind, model: item.model || null });
  return item;
}

async function editSessionUserMessage(id, index, text) {
  if (active.has(id)) throw Error("Pare a execução antes de editar uma mensagem.");
  sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
  const session = sessions[id];
  if (!session) throw Error("Conversa não encontrada");
  const target = session.messages && session.messages[index];
  if (!target || target.role !== "user") throw Error("Mensagem de usuário não encontrada");
  const nextText = String(text || "").trim();
  if (!nextText || nextText.length > 40000) throw Error("Mensagem vazia ou muito longa.");
  target.text = nextText; target.editedAt = new Date().toISOString();
  session.messages = session.messages.slice(0, index + 1);
  delete session.claudeSessionId; delete session.openaiResponseId;
  session.updatedAt = target.editedAt; sessions[id] = session;
  await saveJson(SESSIONS, sessions);
  return { session, index };
}

async function saveAttachments(items) {
  const attachments = Array.isArray(items) ? items.slice(0, 5) : [];
  const saved = [];
  if (!attachments.length) return saved;
  await mkdir(ATTACHMENTS, { recursive: true });
  for (const item of attachments) {
    const match = String(item?.dataUrl || "").match(/^data:([^;]{1,120});base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw Error("Formato de anexo não permitido.");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 20_000_000) throw Error("Anexo maior que 20 MB.");
    const mime = String(match[1] || "application/octet-stream").toLowerCase();
    const mimeExt = {
      "image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif",
      "application/pdf":"pdf","text/plain":"txt","text/markdown":"md","application/json":"json",
      "text/csv":"csv","application/zip":"zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":"docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"xlsx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation":"pptx"
    }[mime];
    const fromName = String(item?.name || "").toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
    const ext = mimeExt || fromName || "bin";
    const path = join(ATTACHMENTS, randomUUID() + "." + ext);
    await writeFile(path, bytes, { mode: 0o600 });
    saved.push(path);
  }
  return saved;
}
function updateSessionTaskList(session, toolName, input, toolUseId) {
  const name = String(toolName || "").toLowerCase();
  const current = Array.isArray(session.taskList) ? [...session.taskList] : [];
  if (name === "todowrite" && Array.isArray(input?.todos)) {
    session.taskList = input.todos.map((task, index) => ({
      id: String(task.id || index + 1),
      text: String(task.content || task.subject || "Tarefa"),
      activeText: String(task.activeForm || task.content || task.subject || "Em andamento"),
      status: ["completed", "in_progress", "pending"].includes(task.status) ? task.status : "pending",
    }));
    return session.taskList;
  }
  if (name === "taskcreate") {
    current.push({ id: String(input?.taskId || toolUseId || current.length + 1), text: String(input?.subject || input?.description || "Tarefa"), activeText: String(input?.activeForm || input?.subject || "Em andamento"), status: "pending" });
    session.taskList = current;
    return current;
  }
  if (name === "taskupdate") {
    const index = current.findIndex((task) => String(task.id) === String(input?.taskId || ""));
    if (index >= 0) current[index] = { ...current[index], ...(input?.subject ? { text: String(input.subject) } : {}), ...(input?.activeForm ? { activeText: String(input.activeForm) } : {}), ...(input?.status ? { status: String(input.status) } : {}) };
    session.taskList = current;
    return current;
  }
  return null;
}
async function pushLiveFollowUp(body) {
  const id = String(body.sessionId || "");
  const running = active.get(id);
  if (!running) throw Error("Não há execução ativa nesta conversa.");
  if (running.provider !== "anthropic") throw Error("Follow-up ao vivo está disponível para o Claude.");

  const text = String(body.prompt || "").trim();
  const savedAttachments = await saveAttachments(body.attachments);
  if ((!text && !savedAttachments.length) || text.length > 40000)
    throw Error("Mensagem vazia ou muito longa.");

  sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
  const session = sessions[id];
  if (!session) throw Error("Conversa não encontrada");

  running.segmentBreakRequested = true;
  const item = {
    role: "user",
    text: text || "Arquivo anexado",
    attachments: savedAttachments.map((path) => basename(path)),
    provider: "anthropic",
    liveFollowUp: true,
    at: new Date().toISOString(),
  };
  session.messages.push(item);
  session.updatedAt = item.at;
  sessions[id] = session;
  await saveJson(SESSIONS, sessions);

  const attachmentContext = savedAttachments.length
    ? "\n\nArquivos anexados pelo usuário agora (use as ferramentas disponíveis para lê-los/inspecioná-los):\n" +
      savedAttachments.map((path) => "- " + path).join("\n")
    : "";
  const userContent = normalizeChromeCommand(text || "Analise os arquivos anexados.") + attachmentContext;
  const isSlashCommand = /^\/[A-Za-z0-9:_-]+(?:\s.*)?$/.test(String(text || "").trim());
  const steeringText = isSlashCommand
    ? userContent
    : "[Mensagem adicional do usuário durante a execução. Continue todas as tarefas e raciocínios já em andamento; não cancele, substitua nem abandone o trabalho atual, a menos que o usuário peça explicitamente. Incorpore esta informação aos próximos passos e faça tudo junto quando compatível.]\n\n" + userContent;

  const sdkMessage = {
    type: "user",
    message: { role: "user", content: steeringText },
    parent_tool_use_id: null,
    priority: "now",
    origin: { kind: "human" },
  };

  if (running.query) {
    async function* one() { yield sdkMessage; }
    await running.query.streamInput(one());
  } else {
    running.pendingInputs ||= [];
    running.pendingInputs.push(sdkMessage);
  }

  if (running.res) {
    send(running.res, "notice", {
      text: savedAttachments.length
        ? "Nova mensagem com arquivo recebida durante a execução."
        : "Nova mensagem recebida durante a execução.",
      kind: "follow-up",
    });
  }
  return item;
}

async function pushAgentFollowUp(sessionId, agentId, prompt) {
  const running = active.get(sessionId);
  if (!running) throw Error("Não há execução ativa nesta conversa.");
  if (running.provider !== "anthropic") throw Error("Conversa com agents está disponível para o Claude.");
  const text = String(prompt || "").trim();
  if (!text || text.length > 40000) throw Error("Mensagem vazia ou muito longa.");
  sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
  const session = sessions[sessionId];
  const agent = session?.agents?.[agentId];
  if (!session || !agent) throw Error("Agent não encontrado nesta conversa.");
  addSessionAgentEvent(agent, "user", text, { source: "user" });
  session.updatedAt = new Date().toISOString();
  await saveJson(SESSIONS, sessions);
  const steeringText = `[Mensagem direta do usuário para o subagent ${agentId} (${agent.description || agent.subagentType || "Agent"}). Use a ferramenta SendMessage para entregar a mensagem abaixo a esse subagent e mantenha a resposta no contexto dele. Não responda no chat principal.]\n\n${text}`;
  const sdkMessage = {
    type: "user",
    message: { role: "user", content: steeringText },
    parent_tool_use_id: null,
    priority: "now",
    origin: { kind: "human" },
  };
  if (running.query) {
    async function* one() { yield sdkMessage; }
    await running.query.streamInput(one());
  } else {
    running.pendingInputs ||= [];
    running.pendingInputs.push(sdkMessage);
  }
  if (running.res) emitAgent(running.res, agent);
  return agent;
}

const readBody = async (req) => {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 20_000_000) throw Error("Requisição muito grande");
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
  for (const k of ["workspace", "vault", "pcControllerPath"]) next[k] = localPath(next[k]);
  for (const k of ["pluginPaths", "mcpConfigPaths", "additionalDirectories"])
    next[k] = Array.isArray(next[k])
      ? next[k]
          .filter((x) => typeof x === "string" && x.trim())
          .map((x) => resolve(x))
      : [];
  next.safeMode = Boolean(next.safeMode);
  next.autoStartTunnel = Boolean(next.autoStartTunnel);
  next.tunnelProfile = String(next.tunnelProfile || defaults.tunnelProfile).replace(/[^A-Za-z0-9._-]/g, "").slice(0,120);
  next.provider = ["anthropic", "openai"].includes(next.provider)
    ? next.provider
    : "anthropic";
  next.microphoneId = String(next.microphoneId || "default").slice(0,512);
  next.microphoneLabel = String(next.microphoneLabel || "").slice(0,512);
  next.settingSources = ["user", "project", "local"].filter((s) =>
    next.settingSources?.includes(s),
  );
  next.model = String(next.model || defaults.model).slice(0, 120);
  next.anthropicModel = String(next.anthropicModel || "sonnet").slice(0, 120);
  next.openaiModel = String(next.openaiModel || "gpt-5.4").slice(0, 120);
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

function sessionAgentsView(s) {
  return Object.values(s.agents || {}).sort((a,b) => String(a.startedAt || "").localeCompare(String(b.startedAt || "")));
}
function textBlocks(content, includeThinking = true) {
  if (typeof content === "string") return content.trim() ? [{ kind: "message", text: content.trim() }] : [];
  const result = [];
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === "text" && String(block.text || "").trim())
      result.push({ kind: "message", text: String(block.text).trim() });
    else if (includeThinking && block?.type === "thinking" && String(block.thinking || "").trim())
      result.push({ kind: "thinking", text: String(block.thinking).trim() });
  }
  return result;
}
const claudeTranscriptCache = new Map();
async function claudeTranscriptFor(sessionId) {
  if (!sessionId || !/^[\w-]+$/.test(String(sessionId))) return null;
  const cached = claudeTranscriptCache.get(sessionId);
  if (cached && existsSync(cached.main)) return cached;
  const root = join(homedir(), ".claude", "projects");
  const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const main = join(root, project.name, sessionId + ".jsonl");
    if (!existsSync(main)) continue;
    const found = { main, subagents: join(root, project.name, sessionId, "subagents") };
    claudeTranscriptCache.set(sessionId, found);
    return found;
  }
  return null;
}
function parseJsonLines(raw) {
  const rows = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}
function agentDefinitionsFromMain(rows) {
  const toolUses = new Map();
  const byAgentId = new Map();
  for (const row of rows) {
    for (const block of Array.isArray(row?.message?.content) ? row.message.content : []) {
      if (block?.type === "tool_use" && ["Agent", "Task"].includes(block.name)) {
        toolUses.set(block.id, {
          description: String(block.input?.description || "").trim(),
          prompt: String(block.input?.prompt || "").trim(),
          subagentType: String(block.input?.subagent_type || "agent").trim(),
        });
      }
      if (block?.type !== "tool_result") continue;
      const value = typeof block.content === "string" ? block.content : JSON.stringify(block.content || "");
      const match = value.match(/agentId:\s*([\w-]+)/i);
      if (match) byAgentId.set(match[1], toolUses.get(block.tool_use_id) || {});
    }
  }
  return byAgentId;
}
// Rebuilds subagent conversations from Claude Code's own transcript
// (~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl) for agents
// that were not captured live (older Noctan versions, app closed mid-run).
async function backfillSessionAgents(session) {
  if (!session?.claudeSessionId) return false;
  const transcript = await claudeTranscriptFor(session.claudeSessionId);
  if (!transcript || !existsSync(transcript.subagents)) return false;
  const mainRows = parseJsonLines(await readFile(transcript.main, "utf8").catch(() => ""));
  const definitions = agentDefinitionsFromMain(mainRows);
  const files = await readdir(transcript.subagents, { withFileTypes: true }).catch(() => []);
  let changed = false;
  for (const file of files) {
    if (!file.isFile() || !/^agent-[\w-]+\.jsonl$/i.test(file.name)) continue;
    const id = file.name.replace(/^agent-/i, "").replace(/\.jsonl$/i, "");
    if (session.agents?.[id]?.capturedLive) continue;
    if (session.agents?.[id]?.backfilledFromTranscript && session.agents[id].events?.length) continue;
    const rows = parseJsonLines(await readFile(join(transcript.subagents, file.name), "utf8").catch(() => ""));
    const definition = definitions.get(id) || {};
    const events = [];
    let prompt = definition.prompt || "";
    let startedAt = "";
    let updatedAt = "";
    let firstUser = true;
    for (const row of rows) {
      if (!startedAt && row.timestamp) startedAt = row.timestamp;
      if (row.timestamp) updatedAt = row.timestamp;
      const role = row?.message?.role || row?.type;
      if (!["user", "assistant"].includes(role)) continue;
      const blocks = textBlocks(row?.message?.content, true);
      for (const block of blocks) {
        if (role === "user" && firstUser && !prompt) prompt = block.text;
        else if (!(role === "user" && firstUser)) events.push({
          kind: block.kind === "thinking" ? "thinking" : role,
          text: block.text.slice(0, 12000),
          at: row.timestamp || new Date().toISOString(),
        });
      }
      if (role === "user" && blocks.length) firstUser = false;
    }
    session.agents ||= {};
    const previous = session.agents[id] || {};
    session.agents[id] = {
      id,
      ...previous,
      description: previous.description || definition.description || definition.subagentType || "Agent",
      prompt: previous.prompt || prompt,
      subagentType: previous.subagentType || definition.subagentType || "agent",
      status: previous.status || "completed",
      startedAt: previous.startedAt || startedAt || session.createdAt,
      updatedAt: previous.updatedAt || updatedAt || session.updatedAt,
      events: previous.events?.length ? previous.events : events.slice(-250),
      backfilledFromTranscript: true,
    };
    changed = true;
  }
  return changed;
}
function ensureSessionAgent(s, id, patch = {}) {
  if (!id) return null;
  s.agents ||= {};
  const now = new Date().toISOString();
  const current = s.agents[id] || { id, status: "running", startedAt: now, events: [] };
  const next = { ...current, ...patch, id, updatedAt: now, capturedLive: true };
  next.events = Array.isArray(current.events) ? current.events : [];
  s.agents[id] = next;
  return next;
}
function addSessionAgentEvent(agent, kind, text, meta = {}) {
  if (!agent) return;
  agent.events ||= [];
  const value = String(text || "").trim();
  if (!value && kind !== "status") return;
  const last = agent.events[agent.events.length - 1];
  if (last && last.kind === kind && last.text === value) return;
  agent.events.push({ kind, text: value.slice(0, 12000), at: new Date().toISOString(), ...meta });
  if (agent.events.length > 250) agent.events.splice(0, agent.events.length - 250);
}
function emitAgent(res, agent) {
  if (!agent) return;
  send(res, "agent", { agent });
}
function sessionView(s) {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messages: (s.messages || []).filter((message) => !isNoisyAgentCrashMessage(message)),
    provider: s.provider || "anthropic",
    claudeSessionId: s.claudeSessionId || null,
    openaiResponseId: s.openaiResponseId || null,
    pendingPrompt: s.pendingPrompt || null,
    inFlight: s.inFlight || null,
    liveActive: active.has(s.id),
    slashCommands: Array.isArray(s.slashCommands) ? s.slashCommands : [],
    agents: sessionAgentsView(s),
    bootId: BOOT_ID,
  };
}
// A run that died on a billing/credit error must not be auto-resumed on every
// boot: it would just fail again (and spend nothing but the user's patience).
function lastRunEndedWithBillingError(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return false;
    if (message?.role === "system") return BILLING_ERROR_PATTERN.test(String(message.text || ""));
  }
  return false;
}
// Only resume runs that were cut off recently. A run left "in flight" hours ago
// (old task, user moved on) must not wake up by itself on the next launch.
const BOOT_RECOVERY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
function inFlightIsRecent(session) {
  const stamp = Date.parse(session?.inFlight?.lastCheckpointAt || session?.updatedAt || session?.inFlight?.startedAt || "");
  return Number.isFinite(stamp) && Date.now() - stamp <= BOOT_RECOVERY_MAX_AGE_MS;
}
function bootRecoveryEligible(session) {
  return Boolean(session?.inFlight) && inFlightIsRecent(session) && !active.has(session.id) && !bootRecoveryClaims.has(session.id) && !lastRunEndedWithBillingError(session);
}
function send(res, type, data) {
  if (!res.writableEnded)
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
function respondError(res, e) {
  json(res, 500, { error: String(e?.message || e) });
}
let transcriberPromise = null;
async function getTranscriber() {
  if (!transcriberPromise)
    transcriberPromise = (async () => {
      const transformers = await import("@huggingface/transformers");
      transformers.env.cacheDir = join(DATA, "models");
      await mkdir(transformers.env.cacheDir, { recursive: true });
      return transformers.pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-base",
        { dtype: "q8" },
      );
    })();
  return transcriberPromise.catch(error => { transcriberPromise = null; throw error; });
}
function decodePcm16(base64) {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 2 || bytes.length > 12_000_000)
    throw Error("Áudio vazio ou maior que o limite permitido.");
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < samples.length; index += 1)
    samples[index] = bytes.readInt16LE(index * 2) / 32768;
  return samples;
}
async function transcribeAudio(req, res) {
  const body = await readBody(req);
  const audio = decodePcm16(String(body.audio || ""));
  const transcriber = await getTranscriber();
  const result = await transcriber(audio, {
    language: "portuguese",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  return json(res, 200, { text: String(result?.text || "").trim() });
}
async function runAgent(req, res) {
  const body = await readBody(req);
  const provider = body.provider === "openai" ? "openai" : "anthropic";
  const providerKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  if (!providerKey)
    return json(res, 409, {
      error: `Conecte a chave da ${provider === "openai" ? "OpenAI" : "Anthropic"} antes de enviar.`,
    });
  if (!config.workspace || !existsSync(config.workspace))
    return json(res, 409, {
      error: "Configure um workspace existente em Configurações.",
    });
  const originalPrompt = String(body.prompt || "").trim(),
    attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : [];
  if ((!originalPrompt && !attachments.length) || originalPrompt.length > 40000)
    return json(res, 400, { error: "Mensagem vazia ou muito longa." });
  const savedAttachments = [];
  savedAttachments.push(...await saveAttachments(attachments));
  const prompt = [
    normalizeChromeCommand(originalPrompt || "Analise os arquivos anexados."),
    savedAttachments.length
      ? `\nArquivos anexados pelo usuário (use as ferramentas disponíveis para lê-los ou inspecioná-los):\n${savedAttachments.map((path) => `- ${path}`).join("\n")}`
      : "",
  ].join("");
  sessions = mergeSessions(sessions,await loadJson(SESSIONS,{}));
  const id =
    typeof body.sessionId === "string" && sessions[body.sessionId]
      ? body.sessionId
      : randomUUID();
  if (active.has(id))
    return json(res, 409, { error: "J\u00e1 existe execu\u00e7\u00e3o nessa conversa." });
  const editReplayIndex = Number.isInteger(body.editReplayIndex) ? body.editReplayIndex : null;
  const resumeInterrupted = Boolean(body.resumeInterrupted);
  let agentTargetId = typeof body.agentTargetId === "string" ? body.agentTargetId.trim() : "";
  const s = sessions[id] || {
    id,
    title: (originalPrompt || "Arquivo anexado").slice(0, 65),
    createdAt: new Date().toISOString(),
    messages: [],
    provider,
  };
  if (!agentTargetId && resumeInterrupted && s.inFlight?.kind === "agent")
    agentTargetId = String(s.inFlight.agentId || "");
  if ((s.provider || provider) !== provider && s.messages.length)
    return json(res, 409, {
      error: "Esta conversa pertence a outro provedor. Abra um novo chat para trocar.",
    });
  s.provider = provider;
  s.pendingPrompt = null;
  const replayingEdit = editReplayIndex !== null && s.messages?.[editReplayIndex]?.role === "user";
  const malformedImageSession = (s.messages || []).slice(-30).some((m) =>
    typeof m?.text === "string" && m.text.includes("an image in the conversation could not be processed")
  );
  if (malformedImageSession) delete s.claudeSessionId;
  const historyBeforeCurrent = (replayingEdit ? s.messages.slice(0, editReplayIndex) : [...(s.messages || [])])
    .filter((m) => !(typeof m?.text === "string" && (m.text.includes("an image in the conversation could not be processed") || isMissingClaudeSessionError(m.text))));
  const historyForRebuild = !s.claudeSessionId ? historyBeforeCurrent : [];
  const targetAgent = agentTargetId ? s.agents?.[agentTargetId] : null;
  if (agentTargetId && !targetAgent)
    return json(res, 404, { error: "Agent não encontrado nesta conversa." });
  if (agentTargetId && provider !== "anthropic")
    return json(res, 409, { error: "Conversa com agents está disponível para o Claude." });
  const agentPromptText = resumeInterrupted ? String(s.inFlight?.originalPrompt || originalPrompt) : originalPrompt;
  if (!replayingEdit && !resumeInterrupted && !agentTargetId) s.messages.push({
    role: "user",
    text: originalPrompt || "Arquivo anexado",
    attachments: savedAttachments.map((path) => basename(path)),
    provider,
    at: new Date().toISOString(),
  });
  s.updatedAt = new Date().toISOString();
  s.inFlight = {
    provider,
    startedAt: s.inFlight?.startedAt || s.updatedAt,
    lastCheckpointAt: s.updatedAt,
    originalPrompt: resumeInterrupted ? (s.inFlight?.originalPrompt || originalPrompt) : originalPrompt,
    resumeCount: resumeInterrupted ? Number(s.inFlight?.resumeCount || 0) + 1 : 0,
    kind: agentTargetId ? "agent" : "main",
    agentId: agentTargetId || null,
  };
  if (targetAgent && !resumeInterrupted) addSessionAgentEvent(targetAgent, "user", originalPrompt, { source: "user" });
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
  active.set(id, { ctrl, res, query: null, pendingInputs: [], provider, autoApproveAll: false, segmentBreakRequested: false, segmentStart: 0 });
  let finalText = "",
    spent = 0,
    assistantRecord = null;
  const generatedImageEvidence = [];
  const persistAssistant = async () => {
    if (agentTargetId) return;
    const running = active.get(id);
    const segmentStart = Number(running?.segmentStart || 0);
    const text = finalText.slice(segmentStart).trim();
    if (!text) return;
    if (!assistantRecord) {
      assistantRecord = { role: "assistant", text, costUsd: spent, provider, at: new Date().toISOString() };
      s.messages.push(assistantRecord);
    } else {
      assistantRecord.text = text;
      assistantRecord.costUsd = spent;
      assistantRecord.provider = provider;
    }
    s.updatedAt = new Date().toISOString();
    if (s.inFlight) s.inFlight.lastCheckpointAt = s.updatedAt;
    sessions[id] = s;
    await saveJson(SESSIONS, sessions);
  };
  try {
    if (provider === "openai") {
      const { runOpenAI } = await import("./openai-provider.mjs");
      const askApproval = async (toolName, input) => {
        if (ctrl.signal.aborted) return false;
        if (config.bypassAllPermissions || active.get(id)?.autoApproveAll) return true;
        const aid = randomUUID();
        send(res, "approval", { id: aid, tool: toolName, input: redact(input) });
        return await new Promise((resolve) => {
          const timer = setTimeout(() => {
            approvals.delete(aid);
            resolve(false);
          }, 120000);
          approvals.set(aid, {
            sessionId: id,
            decide: (allowed) => {
              clearTimeout(timer);
              approvals.delete(aid);
              resolve(Boolean(allowed));
            },
          });
        });
      };
      const result = await runOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        model: config.openaiModel,
        effort: config.effort,
        prompt: originalPrompt || "Analise as imagens anexadas.",
        attachments,
        previousResponseId: s.openaiResponseId,
        instructions:
          config.systemInstructions +
          `\nWorkspace local: ${config.workspace}. Vault: ${config.vault || "não configurado"}. Use as ferramentas MCP disponíveis quando necessário. Nunca revele segredos.`,
        mcpConfigPaths: config.mcpConfigPaths,
        mcpServers: { "pc-controller": embeddedPcControllerDefinition() },
        signal: ctrl.signal,
        approve: askApproval,
        onTool: (name, input) =>
          send(res, "tool", { name, input: redact(input) }),
      });
      finalText = result.text;
      generatedImageEvidence.push(result.imageEvidence || [], finalText);
      s.openaiResponseId = result.responseId;
      send(res, "text", { text: finalText });
      await persistAssistant();
      send(res, "result", {
        subtype: "openai_response",
        costUsd: 0,
        usage: result.usage,
        isError: false,
      });
    } else {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const extra = [config.vault, ATTACHMENTS, ...config.additionalDirectories].filter(
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
          "\nFollow the project instructions and persistent memory files. Never print secrets. For work with two or more concrete steps, create and maintain a task list with the available TodoWrite or TaskCreate/TaskUpdate tools so the user can follow progress live. When you need the user to choose between options, use the AskUserQuestion tool instead of listing the options in plain text.",
      },
      additionalDirectories: extra,
      abortController: ctrl,
      permissionMode: "default",
      includePartialMessages: false,
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutable(),
      extraArgs: { chrome: null },
    };
    if (s.claudeSessionId) opts.resume = s.claudeSessionId;
    if (config.pluginPaths.length)
      opts.plugins = config.pluginPaths
        .filter(existsSync)
        .map((path) => ({ type: "local", path }));
    opts.mcpServers = await runtimeMcpServers();
    opts.canUseTool = async (toolName, input) => {
      if (ctrl.signal.aborted)
        return { behavior: "deny", message: "Execução cancelada" };
      // Pergunta de múltipla escolha: nunca auto-aprova; espera o clique do usuário.
      if (toolName === "AskUserQuestion") {
        const qid = randomUUID();
        send(res, "question", { id: qid, questions: Array.isArray(input?.questions) ? input.questions : [] });
        return await new Promise((resolve) => {
          const timer = setTimeout(() => {
            approvals.delete(qid);
            resolve({ behavior: "deny", message: "O usuário não respondeu a pergunta" });
          }, 30 * 60000);
          approvals.set(qid, {
            sessionId: id,
            decide: (allowed, answers) => {
              clearTimeout(timer);
              approvals.delete(qid);
              resolve(
                allowed && answers && typeof answers === "object"
                  ? { behavior: "allow", updatedInput: { ...input, answers } }
                  : { behavior: "deny", message: "O usuário não respondeu a pergunta" },
              );
            },
          });
        });
      }
      if (config.bypassAllPermissions || active.get(id)?.autoApproveAll)
        return { behavior: "allow", updatedInput: input };
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
    const crashResumePrompt = "A execução anterior desta mesma conversa foi interrompida porque o aplicativo/processo fechou inesperadamente. Retome exatamente do ponto em que parou usando o estado desta sessão. Não repita ações, comandos, alterações, commits, deploys ou etapas que já tenham sido concluídos. Primeiro confira o contexto e resultados já presentes na sessão; depois continue apenas o que ficou pendente. Preserve todas as instruções e follow-ups do usuário já recebidos.";
    let effectivePrompt = resumeInterrupted ? crashResumePrompt : prompt;
    if (agentTargetId) {
      effectivePrompt = `Resume agent ${agentTargetId} and deliver this user message to that same agent. Keep the reply in the subagent conversation and do not answer in the main chat:\n\n${agentPromptText}`;
    }
    if (historyForRebuild.length && !agentTargetId) {
      const rebuilt = historyForRebuild
        .filter((m) => ["user", "assistant", "system"].includes(m.role) && m.text)
        .slice(-80)
        .map((m) => "[" + (m.role === "user" ? "Usuário" : m.role === "assistant" ? "Assistente" : "Sistema") + "] " + m.text)
        .join("\n\n");
      effectivePrompt = "Contexto reconstruído da conversa antes desta mensagem:\n\n" + rebuilt + "\n\n[Mensagem atual]\n" + (resumeInterrupted ? crashResumePrompt : prompt);
    }
    let retriedMissingSession = false;
    let retriedTerminatedToolSession = false;
    for (;;) {
      let missingSessionResult = null;
      let terminatedToolSession = false;
      const q = query({ prompt: effectivePrompt, options: opts });
      if (typeof q.supportedCommands === "function") {
        try {
          const commands = await q.supportedCommands();
          s.slashCommands = commands.map((command) => ({
            name: String(command.name || command.command || "").replace(/^\//, ""),
            description: String(command.description || ""),
          })).filter((command) => command.name);
          if (!s.slashCommands.some((command) => command.name === "chrome"))
            s.slashCommands.unshift({ name: "chrome", description: "Conectar ao seu Chrome já logado" });
          sessions[id] = s;
          await saveJson(SESSIONS, sessions);
          send(res, "commands", { commands: s.slashCommands });
        } catch {}
      }
      const runningEntry = active.get(id);
      if (runningEntry) {
        runningEntry.query = q;
        for (const queued of runningEntry.pendingInputs.splice(0)) {
          async function* oneQueued() { yield queued; }
          await q.streamInput(oneQueued());
        }
      }
      try {
      for await (const m of q) {
      generatedImageEvidence.push(m.message?.content || m.result || []);
      if ((m.message?.content || []).some((block) =>
        block?.type === "tool_result" && /session terminated/i.test(
          typeof block.content === "string" ? block.content : JSON.stringify(block.content || ""),
        )
      )) terminatedToolSession = true;

      if (m.type === "system" && m.subtype === "task_started" && (m.task_type === "local_agent" || m.subagent_type)) {
        const agent = ensureSessionAgent(s, m.task_id, {
          runId: m.run_id || null,
          description: m.description || "",
          prompt: m.prompt || "",
          subagentType: m.subagent_type || "agent",
          taskType: m.task_type || "local_agent",
          status: "running",
          isBackgrounded: Boolean(m.is_backgrounded),
          spawnDepth: Number(m.spawn_depth || 1),
          parentTaskId: m.parent_task_id || null,
          startedAt: new Date().toISOString(),
        });
        addSessionAgentEvent(agent, "status", m.description || "Agent iniciado");
        sessions[id] = s;
        await saveJson(SESSIONS, sessions);
        emitAgent(res, agent);
      } else if (m.type === "system" && m.subtype === "task_progress" && m.task_id) {
        const agent = ensureSessionAgent(s, m.task_id, {
          description: m.description || undefined,
          subagentType: m.subagent_type || undefined,
          status: "running",
          summary: m.summary || "",
          lastToolName: m.last_tool_name || "",
          usage: m.usage || undefined,
        });
        addSessionAgentEvent(agent, "progress", m.summary || m.description || m.last_tool_name || "Em execução");
        emitAgent(res, agent);
      } else if (m.type === "system" && m.subtype === "task_updated" && m.task_id) {
        const patch = m.patch || {};
        const agent = ensureSessionAgent(s, m.task_id, {
          ...patch,
          runId: m.run_id || undefined,
          endedAt: patch.end_time ? new Date(patch.end_time).toISOString() : undefined,
        });
        addSessionAgentEvent(agent, "status", patch.error || patch.status || "Atualizado");
        sessions[id] = s;
        await saveJson(SESSIONS, sessions);
        emitAgent(res, agent);
      } else if (m.type === "tool_progress" && m.task_id) {
        const agent = ensureSessionAgent(s, m.task_id, {
          status: "running",
          lastToolName: m.tool_name || "",
          subagentType: m.subagent_type || undefined,
        });
        addSessionAgentEvent(agent, "tool", m.tool_name || "Ferramenta", { elapsedSeconds: m.elapsed_time_seconds || 0 });
        emitAgent(res, agent);
      }
      if ((m.type === "assistant" || m.type === "user") && m.agent_id) {
        const agent = ensureSessionAgent(s, m.agent_id, {
          subagentType: m.subagent_type || undefined,
          description: m.task_description || undefined,
          status: "running",
        });
        for (const block of m.message?.content || []) {
          if (block.type === "text") addSessionAgentEvent(agent, m.type === "user" ? "user" : "assistant", block.text);
          else if (block.type === "thinking") addSessionAgentEvent(agent, "thinking", block.thinking || "");
          else if (block.type === "tool_use" && m.type === "assistant") addSessionAgentEvent(agent, "tool", block.name || "Ferramenta", { input: redact(block.input) });
        }
        sessions[id] = s;
        await saveJson(SESSIONS, sessions);
        emitAgent(res, agent);
      }
      if (m.session_id) {
        s.claudeSessionId = m.session_id;
        if (s.inFlight) s.inFlight.lastCheckpointAt = new Date().toISOString();
        sessions[id] = s;
        await saveJson(SESSIONS, sessions);
      }
      if (m.type === "assistant" && !m.agent_id && !agentTargetId) {
        for (const b of m.message?.content || []) {
          if (b.type === "text") {
            const liveRun = active.get(id);
            if (liveRun?.segmentBreakRequested) {
              assistantRecord = null;
              liveRun.segmentStart = finalText.length;
              liveRun.segmentBreakRequested = false;
            }
            finalText += b.text + "\n";
            send(res, "text", { text: b.text });
            await persistAssistant();
          } else if (b.type === "tool_use") {
            const taskList = updateSessionTaskList(s, b.name, b.input, b.id);
            if (taskList) {
              sessions[id] = s;
              await saveJson(SESSIONS, sessions);
              send(res, "tasks", { tasks: taskList });
            }
            send(res, "tool", { name: b.name, input: redact(b.input) });
          }
        }
      } else if (m.type === "result") {
        if (m.is_error && opts.resume && !retriedMissingSession && !finalText.trim() && isMissingClaudeSessionError(m.result)) {
          missingSessionResult = m.result;
          continue;
        }
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
        {
        if (Array.isArray(m.slash_commands)) {
          s.slashCommands = m.slash_commands.map((name) => ({ name: String(name).replace(/^\//, ""), description: "" }));
          if (!s.slashCommands.some((command) => command.name === "chrome"))
            s.slashCommands.unshift({ name: "chrome", description: "Conectar ao seu Chrome já logado" });
          sessions[id] = s;
          await saveJson(SESSIONS, sessions);
        }
        send(res, "init", {
          tools: m.tools || [],
          mcpServers: m.mcp_servers || [],
          commands: s.slashCommands || [],
        });
        }
      }
      } catch (error) {
        if (opts.resume && !retriedMissingSession && !finalText.trim() && isMissingClaudeSessionError(error)) missingSessionResult = error;
        else throw error;
      }
      if (!missingSessionResult && terminatedToolSession && !retriedTerminatedToolSession) {
        retriedTerminatedToolSession = true;
        effectivePrompt = "A sessão de uma ferramenta MCP foi encerrada durante a etapa anterior. A nova execução já recriou as conexões MCP. Continue exatamente do ponto em que parou e tente novamente somente a chamada de ferramenta que falhou com 'Session terminated'. Não repita a mensagem do usuário, comandos, alterações ou etapas já concluídas.";
        send(res, "notice", { text: "O PC Controller perdeu a sessão; reconectei e vou repetir somente a ferramenta interrompida." });
        continue;
      }
      if (!missingSessionResult) break;
      if (agentTargetId) throw Error("A sessão original deste agent expirou e não pode mais ser retomada.");
      retriedMissingSession = true;
      delete s.claudeSessionId;
      delete opts.resume;
      sessions[id] = s;
      await saveJson(SESSIONS, sessions);
      const rebuilt = historyBeforeCurrent
        .filter((m) => ["user", "assistant", "system"].includes(m.role) && m.text)
        .slice(-80)
        .map((m) => "[" + (m.role === "user" ? "Usuário" : m.role === "assistant" ? "Assistente" : "Sistema") + "] " + m.text)
        .join("\n\n");
      effectivePrompt = (rebuilt ? "Contexto reconstruído da conversa antes desta mensagem:\n\n" + rebuilt + "\n\n" : "") + "[Mensagem atual]\n" + (resumeInterrupted ? crashResumePrompt : prompt);
      send(res, "notice", { text: "A sessão anterior do Claude expirou; o contexto salvo foi restaurado automaticamente." });
    }
    }
    const generatedAttachments = agentTargetId ? [] : await importGeneratedImages({
      evidence: generatedImageEvidence,
      workspace: config.workspace,
      attachmentsDir: ATTACHMENTS,
    });
    if (generatedAttachments.length) {
      if (!assistantRecord) {
        assistantRecord = { role: "assistant", text: finalText.trim() || "Imagem gerada", costUsd: spent, provider, at: new Date().toISOString() };
        s.messages.push(assistantRecord);
      }
      assistantRecord.attachments = [...new Set([...(assistantRecord.attachments || []), ...generatedAttachments])];
      send(res, "attachments", { attachments: assistantRecord.attachments });
    }
    if (agentTargetId) {
      sessions[id] = s;
      await saveJson(SESSIONS, sessions);
    } else if (finalText.trim() || generatedAttachments.length) {
      await persistAssistant();
    } else {
      s.messages.push({ role: "assistant", text: "(Sem resposta textual)", costUsd: spent, provider, at: new Date().toISOString() });
      s.updatedAt = new Date().toISOString();
      await saveJson(SESSIONS, sessions);
    }
    delete s.inFlight;
    s.updatedAt = new Date().toISOString();
    sessions[id] = s;
    await saveJson(SESSIONS, sessions);
    send(res, "done", { sessionId: id });
  } catch (e) {
    const msg = shortAgentError(e);
    send(res, "error", { error: msg });
    if (agentTargetId) {
      const agent = s.agents?.[agentTargetId];
      if (agent) addSessionAgentEvent(agent, "assistant", "Não foi possível continuar este agent: " + msg, { isError: true });
    } else {
      if(finalText.trim()) await persistAssistant();
      s.messages.push({
        role: "system",
        text: "Erro: " + msg,
        at: new Date().toISOString(),
      });
    }
    delete s.inFlight;
    s.updatedAt = new Date().toISOString();
    sessions[id] = s;
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
async function runtimeMcpServers() {
  return withEmbeddedPcController(await mergeMcpConfigs(config.mcpConfigPaths));
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
  const detectedControllerPath =
    config.pcControllerPath && existsSync(join(config.pcControllerPath, "tunnel-client.exe"))
      ? config.pcControllerPath
      : defaultControllerPath();
  const candidates = [
    join(home, "Documents", "AI_Memory_Vault"),
    join(home, "OneDrive", "Documents", "AI_Memory_Vault"),
    join(home, "OneDrive", "Documentos", "AI_Memory_Vault"),
  ];
  const pluginRoot = join(claude, "plugins");
  const pcControllerMcp = embeddedPcControllerDefinition();
  const localPc = await localPcControllerStatus(true);
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
    apiKeyConfigured: Boolean(
      config.provider === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.ANTHROPIC_API_KEY,
    ),
    providerKeys: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
    },
    pcController: {
      installed: Boolean(detectedControllerPath),
      localMcpConfigured: Boolean(pcControllerMcp),
      localMcpCommand: pcControllerMcp?.command || null,
      localState: localPc.state,
      localConnected: localPc.connected,
      localMessage: localPc.message,
      localToolCount: localPc.toolCount,
      localLastOkAt: localPc.lastOkAt,
      localLastError: localPc.lastError,
      runtimeKeyConfigured: Boolean(process.env.NOCTAN_TUNNEL_RUNTIME_KEY),
      ...(await tunnelStatusLive(config.tunnelProfile)),
    },
    activeSessions: [...active.keys()],
  };
}
async function staticFile(res, path) {
  const files = {
    "/": "index.html",
    "/app.js": "app.js",
    "/style.css": "style.css",
    "/noctan-mark.png": "noctan-mark.png",
  };
  if (!files[path]) return json(res, 404, { error: "Não encontrado" });
  const file = join(BASE, "public", files[path]);
  const ext = path.endsWith(".js")
    ? "text/javascript"
    : path.endsWith(".css")
      ? "text/css"
      : path.endsWith(".png")
        ? "image/png"
        : "text/html";
  res.writeHead(200, {
    "content-type": ext.startsWith("text/") ? ext + "; charset=utf-8" : ext,
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:" + PORT + " ws://localhost:" + PORT + "; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
  res.end(await readFile(file));
}
async function migrateLegacyData() {
  const legacyPaths = [
    ...(process.env.APPDATA ? [join(process.env.APPDATA, "Noctan")] : []),
    ...(process.env.APPDATA ? [join(process.env.APPDATA, "Claude X", "data")] : []),
    join(BASE, "data"),
  ].filter(p => resolve(p) !== resolve(DATA));
  let currentConfig = await loadJson(CONFIG, null);
  for (const oldDir of legacyPaths) {
    const oldConfig = await loadJson(join(oldDir, "config.json"), null);
    if (!oldConfig || typeof oldConfig.workspace !== "string") continue;
    if (!currentConfig) currentConfig = oldConfig;
    else {
      if (!currentConfig.workspace && oldConfig.workspace) currentConfig.workspace = oldConfig.workspace;
      if (!currentConfig.vault && oldConfig.vault) currentConfig.vault = oldConfig.vault;
      if (!currentConfig.pcControllerPath && oldConfig.pcControllerPath) currentConfig.pcControllerPath = oldConfig.pcControllerPath;
    }
    await saveJson(CONFIG, currentConfig);
    if (currentConfig.workspace) break;
  }
  for (const name of ["anthropic-key.dpapi", "openai-key.dpapi", "tunnel-runtime-key.dpapi", "mobile-token.dpapi"]) {
    const target = join(DATA, name);
    if (existsSync(target)) continue;
    for (const oldDir of legacyPaths) {
      const source = join(oldDir, name);
      if (!existsSync(source)) continue;
      await copyFile(source, target);
      break;
    }
  }
  // Import legacy conversations only when there is no current store yet.
  // Re-running this on every update resurrected conversations the user deleted.
  if (existsSync(SESSIONS)) return;
  const all = {};
  let changed = false;
  for (const oldDir of legacyPaths) {
    const past = await loadJson(join(oldDir, "sessions.json"), {});
    for (const [id, item] of Object.entries(past)) {
      if (!item || !Array.isArray(item.messages)) continue;
      if (deletedSessions[id]) continue;
      if (!all[id] || String(item.updatedAt || "") > String(all[id].updatedAt || "")) {
        all[id] = item;
        changed = true;
      }
    }
  }
  if (changed) await saveJson(SESSIONS, all);
}
await mkdir(DATA, { recursive: true });
deletedSessions = await loadJson(DELETED_SESSIONS, {});
await migrateLegacyData();
config = cleanConfig(await loadJson(CONFIG, defaults));
sessions = withoutDeletedSessions(await loadJson(SESSIONS, {}));
for (const session of Object.values(sessions)) {
  if (Array.isArray(session?.messages)) session.messages = mergeMessageLists(session.messages);
}
// The key saved inside Noctan always wins over an old ANTHROPIC_API_KEY/
// OPENAI_API_KEY inherited from Windows: otherwise a stale key from another
// account keeps answering "Credit balance is too low" after the user adds
// credits to the account whose key is saved in the app.
if (existsSync(SECRET_FILE)) {
  try { process.env.ANTHROPIC_API_KEY = await loadApiKey(SECRET_FILE, "anthropic"); }
  catch { console.warn("Noctan: protected key unavailable for this Windows user."); }
}
if (existsSync(OPENAI_SECRET_FILE)) {
  try { process.env.OPENAI_API_KEY = await loadApiKey(OPENAI_SECRET_FILE, "openai"); }
  catch { console.warn("Noctan: protected OpenAI key unavailable for this Windows user."); }
}
if (!process.env.NOCTAN_TUNNEL_RUNTIME_KEY && existsSync(TUNNEL_SECRET_FILE)) {
  try { process.env.NOCTAN_TUNNEL_RUNTIME_KEY = await loadApiKey(TUNNEL_SECRET_FILE, "tunnel"); }
  catch { console.warn("Noctan: protected tunnel key unavailable for this Windows user."); }
}
if (config.autoStartTunnel && process.env.NOCTAN_TUNNEL_RUNTIME_KEY) {
  try {
    await startTunnel({ controllerPath: config.pcControllerPath, profile: config.tunnelProfile, runtimeKey: process.env.NOCTAN_TUNNEL_RUNTIME_KEY });
  } catch (error) {
    console.warn(`Noctan: PC Controller não iniciou: ${error.message}`);
  }
}
// Vigia do túnel do ChatGPT (2026-10-19): se cair (rede, sono do PC, processo morto), sobe de novo sozinho a cada
// minuto enquanto o autoStart estiver ligado. Ninguém precisa abrir CMD nem clicar.
setInterval(async () => {
  if (!config.autoStartTunnel || !process.env.NOCTAN_TUNNEL_RUNTIME_KEY) return;
  try {
    const st = await tunnelStatusLive(config.tunnelProfile);
    if (st.status === "connected" || st.status === "connecting" || st.pid) return;
    await startTunnel({ controllerPath: config.pcControllerPath, profile: config.tunnelProfile, runtimeKey: process.env.NOCTAN_TUNNEL_RUNTIME_KEY });
  } catch (error) {
    console.warn(`Noctan: vigia do PC Controller: ${error.message}`);
  }
}, 60_000).unref();
try {
  const bootPcController = embeddedPcControllerDefinition();
  connectLocalPcController(bootPcController).catch((error) => console.warn(`Noctan: PC Controller local não iniciou: ${error.message}`));
} catch (error) {
  console.warn(`Noctan: falha preparando PC Controller local: ${error.message}`);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    if (path === "/mcp") {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const mcpServer = createNoctanMcpServer({ baseUrl: `http://${HOST}:${PORT}` });
      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } finally {
        await mcpServer.close().catch(() => {});
      }
      return;
    }
    if (
      req.headers.origin &&
      !["http://127.0.0.1:" + PORT, "http://localhost:" + PORT].includes(
        req.headers.origin,
      )
    )
      return json(res, 403, { error: "Origem não autorizada" });
    if (
      req.method === "GET" &&
      ["/", "/app.js", "/style.css", "/noctan-mark.png"].includes(path)
    )
      return await staticFile(res, path);
    if (req.method === "GET" && path.startsWith("/api/attachments/")) {
      const name = decodeURIComponent(path.slice("/api/attachments/".length));
      if (!/^[A-Za-z0-9._-]+$/.test(name)) return json(res, 400, { error: "Anexo inválido" });
      const file = join(ATTACHMENTS, name);
      if (!existsSync(file)) return json(res, 404, { error: "Anexo não encontrado" });
      const ext = name.toLowerCase().split(".").pop();
      const type = ({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",pdf:"application/pdf",txt:"text/plain; charset=utf-8",md:"text/markdown; charset=utf-8",json:"application/json; charset=utf-8",csv:"text/csv; charset=utf-8",zip:"application/zip",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation"})[ext] || "application/octet-stream";
      res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
      return res.end(await readFile(file));
    }
    if (req.method === "GET" && path === "/api/status")
      return json(res, 200, {
        discovery: await discover(),
        config,
        sessionCount: Object.keys(sessions).length,
        bootId: BOOT_ID,
      });
    if (req.method === "GET" && path.startsWith("/api/sessions")) sessions = withoutDeletedSessions(mergeSessions(sessions,await loadJson(SESSIONS,{})));
    if (req.method === "GET" && path === "/api/sessions-summary")
      return json(res, 200, Object.values(sessions).map((session) => { const view = sessionView(session); delete view.messages; return view; }).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)));
    if (req.method === "GET" && path === "/api/sessions")
      return json(
        res,
        200,
        Object.values(sessions)
          .map(sessionView)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    const sessionGetMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "GET" && sessionGetMatch) {
      const session = sessions[sessionGetMatch[1]];
      if (!session) return json(res, 404, { error: "Conversa não encontrada" });
      if (await backfillSessionAgents(session).catch(() => false)) {
        sessions[session.id] = session;
        await saveJson(SESSIONS, sessions);
      }
      return json(res, 200, sessionView(session));
    }

    const recoveryMatch = path.match(/^\/api\/sessions\/([^/]+)\/claim-boot-recovery$/);
    if (req.method === "POST" && recoveryMatch) {
      sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
      const id = recoveryMatch[1];
      const session = sessions[id];
      if (!session) return json(res, 404, { error: "Conversa não encontrada" });
      const billingBlocked = lastRunEndedWithBillingError(session);
      const eligible = bootRecoveryEligible(session);
      if (eligible) bootRecoveryClaims.add(id);
      return json(res, 200, {
        bootId: BOOT_ID,
        claimed: eligible,
        billingBlocked,
        liveActive: active.has(id),
        resumeCount: Number(session.inFlight?.resumeCount || 0),
      });
    }

    const agentMessageMatch = path.match(/^\/api\/sessions\/([^/]+)\/agents\/([^/]+)\/messages$/);
    if (req.method === "POST" && agentMessageMatch) {
      try {
        const body = await readBody(req);
        const agent = await pushAgentFollowUp(decodeURIComponent(agentMessageMatch[1]), decodeURIComponent(agentMessageMatch[2]), body.prompt);
        return json(res, 202, { ok: true, agent });
      } catch (error) {
        return json(res, 409, { error: String(error.message || error) });
      }
    }

    const generatedImportMatch = path.match(/^\/api\/sessions\/([^/]+)\/import-generated$/);
    if (req.method === "POST" && generatedImportMatch) {
      try {
        const body = await readBody(req);
        sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
        const id = decodeURIComponent(generatedImportMatch[1]);
        const session = sessions[id];
        if (!session) return json(res, 404, { error: "Conversa não encontrada" });
        const imported = await importGeneratedImages({ evidence: body.evidence, workspace: config.workspace, attachmentsDir: ATTACHMENTS });
        if (imported.length) {
          let assistant = [...(session.messages || [])].reverse().find((item) => item.role === "assistant");
          if (!assistant) {
            assistant = { role: "assistant", text: "Imagens geradas", provider: session.provider || "anthropic", at: new Date().toISOString() };
            session.messages.push(assistant);
          }
          assistant.attachments = [...new Set([...(assistant.attachments || []), ...imported])];
          session.updatedAt = new Date().toISOString();
          sessions[id] = session;
          await saveJson(SESSIONS, sessions);
        }
        return json(res, 200, { ok: true, attachments: imported });
      } catch (error) {
        return json(res, 400, { error: String(error.message || error) });
      }
    }

    if (req.method === "DELETE" && path.startsWith("/api/sessions/")) {
      const id = path.split("/").pop();
      try {
        const deleted = await deleteSessionById(id);
        return json(res, deleted ? 200 : 404, deleted ? { ok: true, id } : { error: "Conversa não encontrada" });
      } catch (error) {
        return json(res, /execução/.test(String(error.message)) ? 409 : 500, { error: String(error.message || error) });
      }
    }
    if (req.method === "POST" && path === "/api/connect") {
      const b = await readBody(req),
        key = String(b.key || "").trim(),
        provider = b.provider === "openai" ? "openai" : "anthropic";
      const destination = provider === "openai" ? OPENAI_SECRET_FILE : SECRET_FILE;
      await saveApiKey(key, destination, provider);
      if (provider === "openai") process.env.OPENAI_API_KEY = key;
      else process.env.ANTHROPIC_API_KEY = key;
      return json(res, 200, { ok: true, provider, apiKeyConfigured: true, persisted: true });
    }
    if (req.method === "DELETE" && path === "/api/connect") {
      const b = await readBody(req).catch(() => ({}));
      const provider = b.provider === "openai" ? "openai" : "anthropic";
      await removeApiKey(provider === "openai" ? OPENAI_SECRET_FILE : SECRET_FILE);
      if (provider === "openai") delete process.env.OPENAI_API_KEY;
      else delete process.env.ANTHROPIC_API_KEY;
      return json(res, 200, { ok: true, provider, apiKeyConfigured: false });
    }
    if (req.method === "POST" && path === "/api/pc-controller/connect") {
      return json(res, 200, await connectLocalPcController(embeddedPcControllerDefinition()));
    }
    if (req.method === "POST" && path === "/api/pc-controller/disconnect")
      return json(res, 200, await disconnectLocalPcController());
    if (req.method === "GET" && path === "/api/pc-controller/status") {
      return json(res, 200, await localPcControllerStatus(true));
    }
    if (req.method === "POST" && path === "/api/tunnel/connect") {
      const body = await readBody(req);
      const key = String(body.runtimeKey || "").trim();
      if (key) {
        await saveApiKey(key, TUNNEL_SECRET_FILE, "tunnel");
        process.env.NOCTAN_TUNNEL_RUNTIME_KEY = key;
      }
      config = cleanConfig({
        ...config,
        pcControllerPath: body.controllerPath || config.pcControllerPath || defaultControllerPath(),
        tunnelProfile: body.profile || config.tunnelProfile,
        autoStartTunnel: body.autoStart !== false,
      });
      await saveJson(CONFIG, config);
      const status = await startTunnel({
        controllerPath: config.pcControllerPath,
        profile: config.tunnelProfile,
        runtimeKey: process.env.NOCTAN_TUNNEL_RUNTIME_KEY,
      });
      return json(res, 200, { ok: true, status });
    }
    if (req.method === "POST" && path === "/api/tunnel/disconnect")
      return json(res, 200, { ok: true, status: stopTunnel() });
    if (req.method === "GET" && path === "/api/tunnel/status")
      return json(res, 200, await tunnelStatusLive(config.tunnelProfile));
    if (req.method === "POST" && path === "/api/preferences/microphone") {
      const body = await readBody(req);
      config = cleanConfig({ ...config, microphoneId: String(body.deviceId || "default").slice(0,512),
        microphoneLabel: String(body.label || "").slice(0,512) });
      await saveJson(CONFIG, config);
      return json(res, 200, { ok: true });
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
    if (req.method === "POST" && path === "/api/handoff") {
      const body = await readBody(req);
      const prompt = normalizeExternalText(body.prompt);
      if (!prompt || prompt.length > 40000)
        return json(res, 400, { error: "Tarefa vazia ou muito longa." });
      const title = normalizeExternalText(body.title) || prompt;
      const source = normalizeExternalText(body.source) || "mcp";
      const fingerprint = handoffFingerprint({ prompt, title, source, requestId: body.requestId });
      const now = new Date().toISOString();
      const recent = recentHandoffs.get(fingerprint);
      const reusable = recent && Date.now() - recent.at < 60_000 && sessions[recent.id];
      const id = reusable ? recent.id : randomUUID();
      if (!reusable) {
        sessions[id] = {
          id,
          title: title.slice(0, 65),
          createdAt: now,
          updatedAt: now,
          messages: [],
          pendingPrompt: prompt,
          source: source.slice(0, 80),
        };
        await saveJson(SESSIONS, sessions);
      }
      recentHandoffs.set(fingerprint, { id, at: Date.now() });
      for (const [key, item] of recentHandoffs) if (Date.now() - item.at > 120_000) recentHandoffs.delete(key);
      let openedInDesktop = false;
      try { openedInDesktop = Boolean(await desktopHandoffHandler?.({ sessionId: id })); } catch {}
      return json(res, reusable ? 200 : 201, {
        ok: true,
        sessionId: id,
        url: `http://${HOST}:${PORT}/?session=${id}`,
        duplicate: Boolean(reusable),
        openedInDesktop,
      });
    }
    const pendingMatch = path.match(/^\/api\/sessions\/([^/]+)\/claim-pending$/);
    if (req.method === "POST" && pendingMatch) {
      sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
      const id = decodeURIComponent(pendingMatch[1]);
      const session = sessions[id];
      if (!session) return json(res, 404, { error: "Conversa não encontrada" });
      const prompt = normalizeExternalText(session.pendingPrompt);
      if (!prompt) return json(res, 200, { ok: true, claimed: false, prompt: null });
      session.pendingPrompt = null;
      session.updatedAt = new Date().toISOString();
      await saveJson(SESSIONS, sessions);
      return json(res, 200, { ok: true, claimed: true, prompt });
    }
    if (req.method === "PUT" && path === "/api/config") {
      config = cleanConfig(await readBody(req));
      await saveJson(CONFIG, config);
      return json(res, 200, { ok: true, config });
    }
    if (req.method === "POST" && path === "/api/follow-up") {
      try {
        const item = await pushLiveFollowUp(await readBody(req));
        return json(res, 202, { ok: true, item });
      } catch (error) {
        return json(res, 409, { error: String(error.message || error) });
      }
    }
    const noticeMatch = path.match(/^\/api\/sessions\/([^/]+)\/notice$/);
    if (req.method === "POST" && noticeMatch) {
      try {
        const body = await readBody(req);
        const item = await appendSessionNotice(noticeMatch[1], body.text, { kind: body.kind, model: body.model });
        return json(res, 201, { ok: true, item });
      } catch (error) {
        return json(res, 400, { error: String(error.message || error) });
      }
    }
    const editMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages\/(\d+)$/);
    if (req.method === "PATCH" && editMatch) {
      try {
        const body = await readBody(req);
        const result = await editSessionUserMessage(editMatch[1], Number(editMatch[2]), body.text);
        return json(res, 200, { ok: true, index: result.index });
      } catch (error) {
        return json(res, /execução/.test(String(error.message)) ? 409 : 400, { error: String(error.message || error) });
      }
    }
    if (req.method === "POST" && path === "/api/run")
      return await runAgent(req, res);
    if (req.method === "POST" && path === "/api/transcribe")
      return await transcribeAudio(req, res);
    if (req.method === "POST" && path === "/api/approve") {
      const b = await readBody(req),
        a = approvals.get(b.id);
      if (!a)
        return json(res, 404, {
          error: "Aprovação não encontrada ou expirada",
        });
      if (b.bypassAll === true && b.allow === true) {
        config.bypassAllPermissions = true;
        await saveJson(CONFIG, config);
      }
      if ((b.allowAll === true || b.bypassAll === true) && b.allow === true) {
        const run = active.get(a.sessionId);
        if (run) run.autoApproveAll = true;
      }
      a.decide(b.allow === true, b.answers);
      if ((b.allowAll === true || b.bypassAll === true) && b.allow === true) {
        for (const [approvalId, pending] of approvals) {
          if (approvalId !== b.id && pending.sessionId === a.sessionId) pending.decide(true);
        }
      }
      return json(res, 200, { ok: true, allowAll: Boolean(b.allowAll && b.allow), bypassAll: Boolean(b.bypassAll && b.allow) });
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
// "Toda vez que fecha o Noctan era pra ele voltar de onde parou": runs left
// `inFlight` by the previous process are resumed once by the server itself,
// even with no window open. Billing/credit failures are left untouched.
async function resumeSessionForThisBoot(session) {
  try {
    const response = await fetch(`http://${HOST}:${PORT}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        provider: session.provider || session.inFlight.provider || "anthropic",
        prompt: "Retomar execução interrompida",
        resumeInterrupted: true,
      }),
    });
    if (!response.ok) throw Error((await response.text()).slice(0, 1000));
    const reader = response.body?.getReader();
    while (reader) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch (error) {
    console.error(`Noctan: falha retomando ${session.id}:`, error?.message || error);
  }
}
async function recoverInterruptedSessionsForThisBoot() {
  const claimed = [];
  for (const session of Object.values(sessions)) {
    if (!bootRecoveryEligible(session)) continue;
    bootRecoveryClaims.add(session.id);
    claimed.push(session);
  }
  await Promise.all(claimed.map(resumeSessionForThisBoot));
}
server.listen(PORT, HOST, () => {
  console.log(`Noctan disponível em http://${HOST}:${PORT}`);
  setTimeout(() => recoverInterruptedSessionsForThisBoot().catch(() => {}), 350);
});
const { WebSocketServer } = await import("ws");
const { Worker } = await import("node:worker_threads");
const sttWss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
const sttModelName = "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11";
const sttModelLocations = [
  join(DATA, "models", "sherpa", sttModelName),
  join(BASE, "data", "models", "sherpa", sttModelName),
];
server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;
  if (req.url !== "/api/stt-stream" ||
    (origin && !["http://127.0.0.1:" + PORT, "http://localhost:" + PORT].includes(origin))) {
    socket.destroy();
    return;
  }
  sttWss.handleUpgrade(req, socket, head, (ws) => sttWss.emit("connection", ws));
});
sttWss.on("connection", (ws) => {
  const dir = sttModelLocations.find((root) => existsSync(join(root, "encoder.int8.onnx")) && existsSync(join(root, "tokens.txt")));
  if (!dir) {
    ws.send(JSON.stringify({ type: "error", error: "O modelo de voz Nemotron ainda nao foi instalado. Aguarde o download." }));
    ws.close(1013, "model unavailable");
    return;
  }
  const worker = new Worker(new URL("./realtime-stt-worker.mjs", import.meta.url), { workerData: { modelDir: dir } });
  let disposed = false;
  const timer = setTimeout(() => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", error: "Tempo esgotado carregando Nemotron." }));
    ws.close();
  }, 30000);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    worker.terminate().catch(() => {});
  };
  worker.on("message", (msg) => {
    if (msg.type === "ready") clearTimeout(timer);
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
    if (msg.type === "final" || msg.type === "error") {
      setTimeout(() => { if (ws.readyState === 1) ws.close(); }, 100);
    }
  });
  worker.on("error", (error) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", error: String(error.message) }));
    ws.close();
  });
  worker.on("exit", () => { if (ws.readyState === 1) ws.close(); });
  ws.on("message", (buffer, binary) => {
    if (!binary) {
      try {
        if (JSON.parse(buffer.toString()).type === "finish") worker.postMessage({ type: "finish" });
      } catch {}
    } else if (buffer.byteLength <= 65536) {
      worker.postMessage({ type: "audio", audio: buffer });
    }
  });
  ws.on("close", dispose);
  ws.on("error", dispose);
});

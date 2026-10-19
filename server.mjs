import http from "node:http";
import { readFile, writeFile, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { saveApiKey, loadApiKey, removeApiKey } from "./secure-key.mjs";
import { defaultControllerPath, startTunnel, stopTunnel, tunnelStatus, tunnelStatusLive } from "./tunnel-manager.mjs";
import { connectLocalPcController, disconnectLocalPcController, localPcControllerStatus } from "./pc-controller-manager.mjs";
import { fileURLToPath } from "node:url";
const BASE = dirname(fileURLToPath(import.meta.url));
function resolveClaudeCodeExecutable() {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@anthropic-ai", "claude-agent-sdk-win32-x64", "claude.exe") : "",
    join(BASE, "node_modules", "@anthropic-ai", "claude-agent-sdk-win32-x64", "claude.exe"),
  ].filter(Boolean);
  return candidates.find(existsSync) || undefined;
}
const DATA_DIR = process.env.NOCTAN_DATA_DIR || process.env.CLAUDE_X_DATA_DIR;
const DATA = DATA_DIR ? resolve(DATA_DIR) : (process.platform === "win32" && process.env.APPDATA ? join(process.env.APPDATA, "Noctan", "data") : join(homedir(), ".noctan", "data"));
const CONFIG = join(DATA, "config.json");
const SESSIONS = join(DATA, "sessions.json");
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
async function replaceWithRetry(tmp, path) {
  const fs = await import("node:fs/promises");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tmp, path);
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code) || attempt >= 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}
function isMissingClaudeSessionError(value) {
  return /No conversation found with session ID:/i.test(String(value?.message || value || ""));
}
function mergeSessions(stored, incoming) {
  const merged = {...stored};
  for (const [id, current] of Object.entries(incoming || {})) {
    const previous = merged[id];
    if (!previous) { merged[id] = current; continue; }
    const found = new Map();
    for (const msg of [...(previous.messages || []), ...(current.messages || [])]) {
      const key = JSON.stringify([msg.role, msg.text, msg.at, msg.costUsd]);
      found.set(key,msg);
    }
    const messages = [...found.values()].sort((a,b) => String(a.at || "").localeCompare(String(b.at || "")));
    const mostRecent = String(current.updatedAt || "") >= String(previous.updatedAt || "") ? current : previous;
    merged[id] = {...previous,...current,...mostRecent,messages};
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
  const lock=SESSIONS+".lock";
  let taken=false;
  for(let i=0;i<150;i++){
    try {await mkdir(lock);taken=true;break;}
    catch(e){ if(e.code!=="EEXIST")throw e;
      if(i===149)throw Error("Conversas ocupadas: tente novamente.");
      await new Promise(done=>setTimeout(done,50));
    }
  }
  try {
    const onDisk=await loadJson(SESSIONS,{});
    const merged=mergeSessions(onDisk,obj);
    const tmp=SESSIONS+".tmp-"+randomUUID();
    await writeFile(tmp,JSON.stringify(merged,null,2),{mode:0o600});
    await replaceWithRetry(tmp,SESSIONS);
    sessions=merged;
  } finally {
    if(taken)await import("node:fs/promises").then(fs=>fs.rm(lock,{recursive:true,force:true}));
  }
}

async function deleteSessionById(id) {
  if (!id || active.has(id)) throw Error("NÃƒÂ£o ÃƒÂ© possÃƒÂ­vel apagar uma conversa em execuÃƒÂ§ÃƒÂ£o.");
  await mkdir(dirname(SESSIONS), { recursive: true });
  const lock = SESSIONS + ".lock";
  let taken = false;
  for (let i = 0; i < 150; i++) {
    try { await mkdir(lock); taken = true; break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (i === 149) throw Error("Conversas ocupadas: tente novamente.");
      await new Promise(done => setTimeout(done, 50));
    }
  }
  try {
    const onDisk = await loadJson(SESSIONS, {});
    if (!onDisk[id] && !sessions[id]) return false;
    delete onDisk[id];
    delete sessions[id];
    const tmp = SESSIONS + ".tmp-" + randomUUID();
    await writeFile(tmp, JSON.stringify(onDisk, null, 2), { mode: 0o600 });
    await import("node:fs/promises").then(fs => fs.rename(tmp, SESSIONS));
    sessions = onDisk;
    return true;
  } finally {
    if (taken) await import("node:fs/promises").then(fs => fs.rm(lock, { recursive: true, force: true }));
  }
}
async function appendSessionNotice(id, text, meta = {}) {
  sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
  const session = sessions[id];
  if (!session) throw Error("Conversa nÃƒÂ£o encontrada");
  const item = { role: "system", text: String(text || "").trim().slice(0, 2000), kind: String(meta.kind || "notice").slice(0, 40), model: meta.model ? String(meta.model).slice(0, 120) : undefined, at: new Date().toISOString() };
  if (!item.text) throw Error("Aviso vazio");
  session.messages.push(item); session.updatedAt = item.at; sessions[id] = session;
  await saveJson(SESSIONS, sessions);
  const running = active.get(id);
  if (running && running.res) send(running.res, "notice", { text: item.text, kind: item.kind, model: item.model || null });
  return item;
}

async function editSessionUserMessage(id, index, text) {
  if (active.has(id)) throw Error("Pare a execuÃƒÂ§ÃƒÂ£o antes de editar uma mensagem.");
  sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
  const session = sessions[id];
  if (!session) throw Error("Conversa nÃƒÂ£o encontrada");
  const target = session.messages && session.messages[index];
  if (!target || target.role !== "user") throw Error("Mensagem de usuÃƒÂ¡rio nÃƒÂ£o encontrada");
  const nextText = String(text || "").trim();
  if (!nextText || nextText.length > 40000) throw Error("Mensagem vazia ou muito longa.");
  target.text = nextText; target.editedAt = new Date().toISOString();
  session.messages = session.messages.slice(0, index + 1);
  delete session.claudeSessionId; delete session.openaiResponseId;
  session.updatedAt = target.editedAt; sessions[id] = session;
  await saveJson(SESSIONS, sessions);
  return { session, index };
}

async function saveImageAttachments(items) {
  const attachments = Array.isArray(items) ? items.slice(0, 5) : [];
  const saved = [];
  if (!attachments.length) return saved;
  await mkdir(ATTACHMENTS, { recursive: true });
  for (const item of attachments) {
    const match = String(item?.dataUrl || "").match(/^data:([^;]{1,120});base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw Error("Formato de anexo nÃƒÂ£o permitido.");
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
    const fromName = String(item?.name || "").toLowerCase().match(/.([a-z0-9]{1,8})$/)?.[1];
    const ext = mimeExt || fromName || "bin";
    const path = join(ATTACHMENTS, randomUUID() + "." + ext);
    await writeFile(path, bytes, { mode: 0o600 });
    saved.push(path);
  }
  return saved;
}
async function pushLiveFollowUp(body) {
  const id = String(body.sessionId || "");
  const running = active.get(id);
  if (!running) throw Error("NÃƒÂ£o hÃƒÂ¡ execuÃƒÂ§ÃƒÂ£o ativa nesta conversa.");
  if (running.provider !== "anthropic") throw Error("Follow-up ao vivo estÃƒÂ¡ disponÃƒÂ­vel para o Claude.");

  const text = String(body.prompt || "").trim();
  const savedAttachments = await saveImageAttachments(body.attachments);
  if ((!text && !savedAttachments.length) || text.length > 40000)
    throw Error("Mensagem vazia ou muito longa.");

  sessions = mergeSessions(sessions, await loadJson(SESSIONS, {}));
  const session = sessions[id];
  if (!session) throw Error("Conversa nÃƒÂ£o encontrada");

  running.segmentBreakRequested = true;
  const item = {
    role: "user",
    text: text || "Imagem anexada",
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
    ? "\n\nArquivos anexados pelo usuÃƒÂ¡rio agora (use as ferramentas disponÃƒÂ­veis para lÃƒÂª-los/inspecionÃƒÂ¡-los):\n" +
      savedAttachments.map((path) => "- " + path).join("\n")
    : "";
  const userContent = (text || "Analise os arquivos anexados.") + attachmentContext;
  const steeringText =
    "[Mensagem adicional do usuÃƒÂ¡rio durante a execuÃƒÂ§ÃƒÂ£o. Continue todas as tarefas e raciocÃƒÂ­nios jÃƒÂ¡ em andamento; nÃƒÂ£o cancele, substitua nem abandone o trabalho atual, a menos que o usuÃƒÂ¡rio peÃƒÂ§a explicitamente. Incorpore esta informaÃƒÂ§ÃƒÂ£o aos prÃƒÂ³ximos passos e faÃƒÂ§a tudo junto quando compatÃƒÂ­vel.]\n\n" +
    userContent;

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
        ? "Nova mensagem com imagem recebida durante a execuÃƒÂ§ÃƒÂ£o."
        : "Nova mensagem recebida durante a execuÃƒÂ§ÃƒÂ£o.",
      kind: "follow-up",
    });
  }
  return item;
}

const readBody = async (req) => {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 20_000_000) throw Error("RequisiÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o muito grande");
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
function sessionView(s) {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messages: s.messages,
    provider: s.provider || "anthropic",
    claudeSessionId: s.claudeSessionId || null,
    openaiResponseId: s.openaiResponseId || null,
    pendingPrompt: s.pendingPrompt || null,
    inFlight: s.inFlight || null,
    liveActive: active.has(s.id),
    slashCommands: Array.isArray(s.slashCommands) ? s.slashCommands : [],
  };
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
    throw Error("ÃƒÆ’Ã‚Âudio vazio ou maior que o limite permitido.");
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
  if (attachments.length) {
    await mkdir(ATTACHMENTS, { recursive: true });
    for (const item of attachments) {
      const match = String(item?.dataUrl || "").match(
        /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/,
      );
      if (!match) throw Error("Formato de imagem nÃƒÆ’Ã‚Â£o permitido.");
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length > 8_000_000) throw Error("Imagem maior que 8 MB.");
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[match[1]];
      const path = join(ATTACHMENTS, `${randomUUID()}.${ext}`);
      await writeFile(path, bytes, { mode: 0o600 });
      savedAttachments.push(path);
    }
  }
  const prompt = [
    originalPrompt || "Analise as imagens anexadas.",
    savedAttachments.length
      ? `\nImagens anexadas pelo usuÃƒÆ’Ã‚Â¡rio (use a ferramenta Read para visualizÃƒÆ’Ã‚Â¡-las):\n${savedAttachments.map((path) => `- ${path}`).join("\n")}`
      : "",
  ].join("");
  sessions = mergeSessions(sessions,await loadJson(SESSIONS,{}));
  const id =
    typeof body.sessionId === "string" && sessions[body.sessionId]
      ? body.sessionId
      : randomUUID();
  if (active.has(id))
    return json(res, 409, { error: "JÃƒÆ’Ã‚Â¡ existe execuÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o nessa conversa." });
  const editReplayIndex = Number.isInteger(body.editReplayIndex) ? body.editReplayIndex : null;
  const resumeInterrupted = Boolean(body.resumeInterrupted);
  const s = sessions[id] || {
    id,
    title: (originalPrompt || "Imagem anexada").slice(0, 65),
    createdAt: new Date().toISOString(),
    messages: [],
    provider,
  };
  if ((s.provider || provider) !== provider && s.messages.length)
    return json(res, 409, {
      error: "Esta conversa pertence a outro provedor. Abra um novo chat para trocar.",
    });
  s.provider = provider;
  delete s.pendingPrompt;
  const replayingEdit = editReplayIndex !== null && s.messages?.[editReplayIndex]?.role === "user";
  const malformedImageSession = (s.messages || []).slice(-30).some((m) =>
    typeof m?.text === "string" && m.text.includes("an image in the conversation could not be processed")
  );
  if (malformedImageSession) delete s.claudeSessionId;
  const historyBeforeCurrent = (replayingEdit ? s.messages.slice(0, editReplayIndex) : [...(s.messages || [])])
    .filter((m) => !(typeof m?.text === "string" && (m.text.includes("an image in the conversation could not be processed") || isMissingClaudeSessionError(m.text))));
  const historyForRebuild = !s.claudeSessionId ? historyBeforeCurrent : [];
  if (!replayingEdit && !resumeInterrupted) s.messages.push({
    role: "user",
    text: originalPrompt || "Imagem anexada",
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
  };
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
  const persistAssistant = async () => {
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
          `\nWorkspace local: ${config.workspace}. Vault: ${config.vault || "nÃƒÆ’Ã‚Â£o configurado"}. Use as ferramentas MCP disponÃƒÆ’Ã‚Â­veis quando necessÃƒÆ’Ã‚Â¡rio. Nunca revele segredos.`,
        mcpConfigPaths: config.mcpConfigPaths,
        signal: ctrl.signal,
        approve: askApproval,
        onTool: (name, input) =>
          send(res, "tool", { name, input: redact(input) }),
      });
      finalText = result.text;
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
          "\nFollow the project instructions and persistent memory files. Never print secrets.",
      },
      additionalDirectories: extra,
      abortController: ctrl,
      permissionMode: "default",
      includePartialMessages: false,
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutable(),
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
        return { behavior: "deny", message: "ExecuÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o cancelada" };
      if (config.bypassAllPermissions || active.get(id)?.autoApproveAll)
        return { behavior: "allow", updatedInput: input };
      const aid = randomUUID();
      send(res, "approval", { id: aid, tool: toolName, input: redact(input) });
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          approvals.delete(aid);
          resolve({ behavior: "deny", message: "AprovaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o expirou" });
        }, 120000);
        approvals.set(aid, {
          sessionId: id,
          decide: (allowed) => {
            clearTimeout(timer);
            approvals.delete(aid);
            resolve(
              allowed
                ? { behavior: "allow", updatedInput: input }
                : { behavior: "deny", message: "Negado pelo usuÃƒÆ’Ã‚Â¡rio" },
            );
          },
        });
      });
    };
    const crashResumePrompt = "A execuÃƒÂ§ÃƒÂ£o anterior desta mesma conversa foi interrompida porque o aplicativo/processo fechou inesperadamente. Retome exatamente do ponto em que parou usando o estado desta sessÃƒÂ£o. NÃƒÂ£o repita aÃƒÂ§ÃƒÂµes, comandos, alteraÃƒÂ§ÃƒÂµes, commits, deploys ou etapas que jÃƒÂ¡ tenham sido concluÃƒÂ­dos. Primeiro confira o contexto e resultados jÃƒÂ¡ presentes na sessÃƒÂ£o; depois continue apenas o que ficou pendente. Preserve todas as instruÃƒÂ§ÃƒÂµes e follow-ups do usuÃƒÂ¡rio jÃƒÂ¡ recebidos.";
    let effectivePrompt = resumeInterrupted ? crashResumePrompt : prompt;
    if (historyForRebuild.length) {
      const rebuilt = historyForRebuild
        .filter((m) => ["user", "assistant", "system"].includes(m.role) && m.text)
        .slice(-80)
        .map((m) => "[" + (m.role === "user" ? "UsuÃƒÂ¡rio" : m.role === "assistant" ? "Assistente" : "Sistema") + "] " + m.text)
        .join("\n\n");
      effectivePrompt = "Contexto reconstruÃƒÂ­do da conversa antes desta mensagem:\n\n" + rebuilt + "\n\n[Mensagem atual]\n" + (resumeInterrupted ? crashResumePrompt : prompt);
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
      if ((m.message?.content || []).some((block) =>
        block?.type === "tool_result" && /session terminated/i.test(
          typeof block.content === "string" ? block.content : JSON.stringify(block.content || ""),
        )
      )) terminatedToolSession = true;
      if (m.session_id) {
        s.claudeSessionId = m.session_id;
        if (s.inFlight) s.inFlight.lastCheckpointAt = new Date().toISOString();
        sessions[id] = s;
        await saveJson(SESSIONS, sessions);
      }
      if (m.type === "assistant") {
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
          } else if (b.type === "tool_use")
            send(res, "tool", { name: b.name, input: redact(b.input) });
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
    if (finalText.trim()) {
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
    const msg = String(e?.message || e);
    send(res, "error", { error: msg.slice(0, 3000) });
    if(finalText.trim()) await persistAssistant();
    s.messages.push({
      role: "system",
      text: "Erro: " + msg.slice(0, 2000),
      at: new Date().toISOString(),
    });
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
  const configuredMcpServers = await mergeMcpConfigs(config.mcpConfigPaths);
  const pcControllerMcp = configuredMcpServers["pc-controller"] || configuredMcpServers["pc_controller"] || null;
  const localPc = await localPcControllerStatus(Boolean(pcControllerMcp));
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
  if (!files[path]) return json(res, 404, { error: "NÃƒÆ’Ã‚Â£o encontrado" });
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
  const all = await loadJson(SESSIONS, {});
  let changed = false;
  for (const oldDir of legacyPaths) {
    const past = await loadJson(join(oldDir, "sessions.json"), {});
    for (const [id, item] of Object.entries(past)) {
      if (!item || !Array.isArray(item.messages)) continue;
      if (!all[id] || String(item.updatedAt || "") > String(all[id].updatedAt || "")) {
        all[id] = item;
        changed = true;
      }
    }
  }
  if (changed) await saveJson(SESSIONS, all);
}
await mkdir(DATA, { recursive: true });
await migrateLegacyData();
config = cleanConfig(await loadJson(CONFIG, defaults));
sessions = await loadJson(SESSIONS, {});
if (!process.env.ANTHROPIC_API_KEY && existsSync(SECRET_FILE)) {
  try { process.env.ANTHROPIC_API_KEY = await loadApiKey(SECRET_FILE, "anthropic"); }
  catch { console.warn("Noctan: protected key unavailable for this Windows user."); }
}
if (!process.env.OPENAI_API_KEY && existsSync(OPENAI_SECRET_FILE)) {
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
    console.warn(`Noctan: PC Controller nÃƒÆ’Ã‚Â£o iniciou: ${error.message}`);
  }
}
try {
  const bootMcpServers = await mergeMcpConfigs(config.mcpConfigPaths);
  const bootPcController = bootMcpServers["pc-controller"] || bootMcpServers["pc_controller"] || null;
  if (bootPcController) connectLocalPcController(bootPcController).catch((error) => console.warn(`Noctan: PC Controller local nÃƒÆ’Ã‚Â£o iniciou: ${error.message}`));
} catch (error) {
  console.warn(`Noctan: falha preparando PC Controller local: ${error.message}`);
}
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
      return json(res, 403, { error: "Origem nÃƒÆ’Ã‚Â£o autorizada" });
    if (
      req.method === "GET" &&
      ["/", "/app.js", "/style.css", "/noctan-mark.png"].includes(path)
    )
      return await staticFile(res, path);
    if (req.method === "GET" && path === "/api/status")
      return json(res, 200, {
        discovery: await discover(),
        config,
        sessionCount: Object.keys(sessions).length,
      });
    if (req.method === "GET" && path.startsWith("/api/sessions")) sessions = mergeSessions(sessions,await loadJson(SESSIONS,{}));
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
    if (req.method === "GET" && path.startsWith("/api/sessions/"))
      return json(
        res,
        sessions[path.split("/").pop()] ? 200 : 404,
        sessions[path.split("/").pop()] || { error: "NÃƒÆ’Ã‚Â£o encontrada" },
      );

    if (req.method === "DELETE" && path.startsWith("/api/sessions/")) {
      const id = path.split("/").pop();
      try {
        const deleted = await deleteSessionById(id);
        return json(res, deleted ? 200 : 404, deleted ? { ok: true, id } : { error: "Conversa nÃƒÂ£o encontrada" });
      } catch (error) {
        return json(res, /execuÃƒÂ§ÃƒÂ£o/.test(String(error.message)) ? 409 : 500, { error: String(error.message || error) });
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
      const configuredMcpServers = await mergeMcpConfigs(config.mcpConfigPaths);
      const definition = configuredMcpServers["pc-controller"] || configuredMcpServers["pc_controller"] || null;
      if (!definition) return json(res, 409, { error: "PC Controller nÃƒÆ’Ã‚Â£o configurado nos MCPs." });
      return json(res, 200, await connectLocalPcController(definition));
    }
    if (req.method === "POST" && path === "/api/pc-controller/disconnect")
      return json(res, 200, await disconnectLocalPcController());
    if (req.method === "GET" && path === "/api/pc-controller/status") {
      const configuredMcpServers = await mergeMcpConfigs(config.mcpConfigPaths);
      const definition = configuredMcpServers["pc-controller"] || configuredMcpServers["pc_controller"] || null;
      return json(res, 200, await localPcControllerStatus(Boolean(definition)));
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
      const prompt = String(body.prompt || "").trim();
      if (!prompt || prompt.length > 40000)
        return json(res, 400, { error: "Tarefa vazia ou muito longa." });
      const id = randomUUID();
      const now = new Date().toISOString();
      sessions[id] = {
        id,
        title: String(body.title || prompt).trim().slice(0, 65),
        createdAt: now,
        updatedAt: now,
        messages: [],
        pendingPrompt: prompt,
        source: String(body.source || "mcp").slice(0, 80),
      };
      await saveJson(SESSIONS, sessions);
      return json(res, 201, {
        ok: true,
        sessionId: id,
        url: `http://${HOST}:${PORT}/?session=${id}`,
      });
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
        return json(res, /execuÃƒÂ§ÃƒÂ£o/.test(String(error.message)) ? 409 : 400, { error: String(error.message || error) });
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
          error: "AprovaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o nÃƒÆ’Ã‚Â£o encontrada ou expirada",
        });
      if (b.bypassAll === true && b.allow === true) {
        config.bypassAllPermissions = true;
        await saveJson(CONFIG, config);
      }
      if ((b.allowAll === true || b.bypassAll === true) && b.allow === true) {
        const run = active.get(a.sessionId);
        if (run) run.autoApproveAll = true;
      }
      a.decide(b.allow === true);
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
      if (!a) return json(res, 404, { error: "ExecuÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o nÃƒÆ’Ã‚Â£o encontrada" });
      a.ctrl.abort();
      for (const [k, v] of approvals)
        if (v.sessionId === b.sessionId) v.decide(false);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "Rota nÃƒÆ’Ã‚Â£o encontrada" });
  } catch (e) {
    if (!res.headersSent) respondError(res, e);
    else res.end();
  }
});
server.listen(PORT, HOST, () =>
  console.log(`Noctan disponÃƒÆ’Ã‚Â­vel em http://${HOST}:${PORT}`),
);
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

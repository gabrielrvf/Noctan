const $ = (id) => document.getElementById(id);
let state = {
  config: {},
  discovery: {},
  sessions: [],
  current: null,
  running: false,
  cost: 0,
  attachments: [],
  provider: "anthropic",
  editReplayIndex: null,
  resumeInterrupted: false,
  slashCommands: [
    { name: "compact", description: "Compactar o contexto desta conversa" },
    { name: "context", description: "Ver o uso do contexto" },
    { name: "cost", description: "Ver o custo da sessão" },
    { name: "init", description: "Criar instruções do projeto" },
    { name: "review", description: "Revisar alterações" },
  ],
};
let sentPrompts = [];
let promptHistoryIndex = -1;
let promptDraft = "";
function resetPromptNavigation() {
  promptHistoryIndex = -1;
  promptDraft = "";
}
let slashSelection = 0;
function setSlashCommands(commands) {
  if (!Array.isArray(commands) || !commands.length) return;
  const unique = new Map();
  for (const item of commands) {
    const command = typeof item === "string" ? { name: item, description: "" } : item;
    const name = String(command.name || "").replace(/^\//, "").trim();
    if (name) unique.set(name, { name, description: String(command.description || "") });
  }
  if (unique.size) state.slashCommands = [...unique.values()].sort((a,b) => a.name.localeCompare(b.name));
}
function slashMatches() {
  const value = $("prompt").value;
  if (!value.startsWith("/") || /\s/.test(value)) return [];
  const query = value.slice(1).toLowerCase();
  return state.slashCommands.filter(command => command.name.toLowerCase().includes(query)).slice(0,12);
}
function chooseSlash(command) {
  $("prompt").value = "/" + command.name + " ";
  show($("slashMenu"), false);
  $("prompt").focus();
}
function renderSlashMenu() {
  const matches = slashMatches();
  const menu = $("slashMenu");
  if (!matches.length) { show(menu, false); return; }
  slashSelection = Math.min(slashSelection, matches.length - 1);
  menu.replaceChildren();
  matches.forEach((command,index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("selected", index === slashSelection);
    button.innerHTML = `<strong>/${escapeHtml(command.name)}</strong><span>${escapeHtml(command.description || "Comando do Claude")}</span>`;
    button.onmousedown = event => { event.preventDefault(); chooseSlash(command); };
    menu.append(button);
  });
  show(menu, true);
}
function sessionPrompts(session) {
  return (session?.messages || []).filter(m => m.role === "user" && m.text)
    .map(m => m.text).reverse().slice(0,100);
}
function setPromptHistory(session) {
  sentPrompts = sessionPrompts(session);
  resetPromptNavigation();
}
const request = async (url, options = {}) => {
  const r = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Erro na solicita\u00e7\u00e3o");
  return j;
};
const show = (el, yes) => (el.hidden = !yes);
let stopDictationForSend = async () => {};
const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}
function renderMarkdown(element, text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let html = "";
  let paragraph = [];
  let list = null;
  let code = null;
  const flushParagraph = () => {
    if (paragraph.length) {
      html += `<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`;
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      closeList();
      if (code === null) code = [];
      else {
        html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1;
      html += `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;
    } else if (bullet || ordered) {
      flushParagraph();
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        list = kind;
        html += `<${kind}>`;
      }
      html += `<li>${inlineMarkdown((bullet || ordered)[1])}</li>`;
    } else if (!line.trim()) {
      flushParagraph();
      closeList();
    } else paragraph.push(line);
  }
  if (code !== null)
    html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
  flushParagraph();
  closeList();
  element.innerHTML = html;
}
function message(role, text, attachmentCount = 0, messageIndex = null) {
  const e = document.createElement("div");
  e.className = "message " + role;
  e.rawText = text;
  if (role === "assistant") renderMarkdown(e, text);
  else {
    const body = document.createElement("div");
    body.className = "messageText";
    body.textContent = text;
    e.append(body);
    if (role === "user" && Number.isInteger(messageIndex)) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "messageEdit";
      edit.title = "Editar mensagem";
      edit.setAttribute("aria-label", "Editar mensagem");
      edit.textContent = "✎";
      edit.onclick = (event) => { event.stopPropagation(); editUserMessage(messageIndex, text); };
      e.append(edit);
    }
    if (attachmentCount > 0) {
      const summary = document.createElement("div");
      summary.className = "messageAttachments";
      summary.textContent = attachmentCount + (attachmentCount === 1 ? " imagem anexada" : " imagens anexadas");
      e.append(summary);
    }
  }
  $("chat").append(e);
  $("chat").scrollTop = $("chat").scrollHeight;
  return e;
}
async function editUserMessage(index, currentText) {
  if (state.running) { alert("Aguarde a execução atual terminar para editar essa mensagem."); return; }
  if (!state.current) return;
  const next = window.prompt("Editar mensagem:", currentText);
  if (next === null || !next.trim() || next.trim() === currentText.trim()) return;
  await request("/api/sessions/" + encodeURIComponent(state.current) + "/messages/" + index, {
    method: "PATCH", body: JSON.stringify({ text: next.trim() })
  });
  state.editReplayIndex = index;
  await loadSession(state.current);
  $("prompt").value = next.trim();
  await send();
}
function note(text) { if(progressUI) addProgressEvent(text); else message("system",text); }
function openAttachmentPreview(item) {
  let dialog = $("attachmentPreviewDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "attachmentPreviewDialog";
    dialog.className = "attachmentPreviewDialog";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "attachmentPreviewClose";
    close.textContent = "×";
    close.setAttribute("aria-label", "Fechar visualização");
    const img = document.createElement("img");
    img.className = "attachmentPreviewImage";
    img.alt = "Pré-visualização da imagem";
    dialog.append(close, img);
    close.onclick = () => dialog.close();
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  const img = dialog.querySelector(".attachmentPreviewImage");
  img.src = item.dataUrl;
  img.alt = item.name || "Imagem anexada";
  dialog.showModal();
}
function renderAttachments() {
  const tray = $("attachmentTray");
  tray.replaceChildren();
  for (const [index, item] of state.attachments.entries()) {
    const card = document.createElement("div");
    card.className = "attachmentCard";
    const image = document.createElement("img");
    image.src = item.dataUrl;
    image.alt = item.name;
    image.title = "Clique para visualizar";
    image.tabIndex = 0;
    image.onclick = () => openAttachmentPreview(item);
    image.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openAttachmentPreview(item); } };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "\u00d7";
    remove.title = "Remover imagem";
    remove.onclick = () => {
      state.attachments.splice(index, 1);
      renderAttachments();
    };
    card.append(image, remove);
    tray.append(card);
  }
  show(tray, state.attachments.length > 0);
}

async function addImages(files) {
  const accepted = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  for (const file of [...files].slice(0, 5 - state.attachments.length)) {
    if (!accepted.includes(file.type)) continue;
    if (file.size > 8_000_000) {
      message("system", file.name + " \u00e9 maior que 8 MB.");
      continue;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    state.attachments.push({ name: file.name || "imagem", dataUrl });
  }
  renderAttachments();
}
async function deleteSession(id, title) {
  if (state.running && state.current === id) {
    alert("Pare a execu\u00e7\u00e3o antes de apagar esta conversa.");
    return;
  }
  if (!confirm('Apagar a conversa "' + title + '"?')) return;
  await request("/api/sessions/" + encodeURIComponent(id), { method: "DELETE" });
  if (state.current === id) newSession();
  await refresh();
}
function updateSessions() {
  const el = $("sessions");
  el.replaceChildren();
  const term = $("sessionSearch").value.trim().toLowerCase();
  for (const s of state.sessions.filter(
    (item) => !term || item.title.toLowerCase().includes(term),
  )) {
    const row = document.createElement("div");
    row.className = "sessionRow" + (state.current === s.id ? " active" : "");
    const b = document.createElement("button");
    b.className = "session";
    b.textContent = "💬 " + s.title;
    b.onclick = () => loadSession(s.id);
    const del = document.createElement("button");
    del.className = "sessionDelete";
    del.type = "button";
    del.title = "Apagar conversa";
    del.setAttribute("aria-label", "Apagar conversa");
    del.textContent = "×";
    del.onclick = (event) => {
      event.stopPropagation();
      deleteSession(s.id, s.title).catch(error => alert(error.message));
    };
    row.append(b, del);
    el.append(row);
  }
}
function totalLocalSpend() {
  return state.sessions.reduce(
    (sum, session) =>
      sum +
      (session.messages || []).reduce(
        (subtotal, item) => subtotal + (item.costUsd || 0),
        0,
      ),
    0,
  );
}
function updateCreditBalance() {
  $("creditBalance").textContent = "Ver na Anthropic";
}
function providerModel() {
  return state.config.anthropicModel || state.config.model || "sonnet";
}
function updateProviderUI() {
  $("modelBtnLabel").textContent = modelLabel(providerModel());
  $("sidebarCredits").title = "Abrir cr\u00e9ditos oficiais da Anthropic";
}
function updateTunnelUI() {
  const pc = state.discovery?.pcController || {};
  const tunnelState = pc.status || "stopped";
  const localState = pc.localState || (pc.localMcpConfigured ? "idle" : "unconfigured");
  const tunnelConnected = tunnelState === "connected";
  const localConnected = Boolean(pc.localConnected);
  const busy = pcReconnectInProgress || ["connecting", "stopping"].includes(tunnelState) || ["connecting", "stopping"].includes(localState);
  // Verde só com tudo de pé: o local (Noctan) se configurado E o túnel (ChatGPT) se a Runtime Key existe.
  // Antes bastava um dos dois e o botão ficava verde com o ChatGPT sem acesso (2026-10-19).
  const needLocal = Boolean(pc.localMcpConfigured);
  const needTunnel = Boolean(pc.runtimeKeyConfigured);
  const connected = (localConnected || !needLocal) && (tunnelConnected || !needTunnel) && (localConnected || tunnelConnected);
  const failed = !busy && !connected;
  $("pcControllerDot").className = busy ? "connecting" : connected ? "connected" : failed ? "error" : "";
  $("pcControllerBtn").classList.toggle("connected", connected);
  const down = [needLocal && !localConnected ? "local (Noctan)" : "", needTunnel && !tunnelConnected ? "túnel do ChatGPT" : ""].filter(Boolean).join(" e ");
  $("pcControllerBtn").title = connected
    ? `PC Controller conectado  -  ${pc.localToolCount || 0} ferramentas${needTunnel ? " · ChatGPT ok" : ""}`
    : busy ? "PC Controller conectando..."
      : `Fora do ar: ${down || "PC Controller"}. ${pc.lastError || pc.localLastError || pc.message || pc.localMessage || ""} Clique para reconectar.`.trim();
}
let pcReconnectInProgress = false;
async function refreshPcControllerHealth() {
  if (!state.discovery) return;
  try {
    const local = await request("/api/pc-controller/status");
    const pc = state.discovery.pcController ||= {};
    pc.localState = local.state;
    pc.localConnected = Boolean(local.connected);
    pc.localMessage = local.message;
    pc.localToolCount = local.toolCount || 0;
    pc.localLastOkAt = local.lastOkAt || null;
    pc.localLastError = local.lastError || null;
  } catch (error) {
    const pc = state.discovery.pcController ||= {};
    pc.localState = "error";
    pc.localConnected = false;
    pc.localLastError = error.message;
  }
  updateTunnelUI();
  updateConnectState();
}
async function refresh() {
  const d = await request("/api/status");
  state.config = d.config;
  if (!micServerPreferenceInitialized && d.config.microphoneId && d.config.microphoneId !== "default") {
    selectedMicId = d.config.microphoneId;
    selectedMicLabel = d.config.microphoneLabel || "";
    localStorage.setItem("noctan.microphone", selectedMicId);
    localStorage.setItem("noctan.microphoneLabel", selectedMicLabel);
  }
  micServerPreferenceInitialized = true;
  state.discovery = d.discovery;
  state.sessions = await request("/api/sessions");
  // Session-specific history: never include prompts from other conversations.
  if (state.current) {
    const currentSession = state.sessions.find(s => s.id === state.current);
    if (currentSession && promptHistoryIndex < 0) sentPrompts = sessionPrompts(currentSession);
  }
  const selectedConnected = Boolean(d.discovery.providerKeys?.anthropic);
  $("connection").textContent = selectedConnected
    ? "\u2713 Tudo conectado"
    : "\u2022 Conex\u00e3o pendente";
  $("connection").style.color = selectedConnected
    ? "#3f8f63"
    : "#b56b36";
  $("workspaceLabel").textContent =
    d.config.workspace || "Configure seu workspace";
  updateProviderUI();
  updateTunnelUI();
  $("effortLabel").textContent = effortLabel(d.config.effort || "medium");
  document
    .querySelectorAll("[data-model]")
    .forEach((button) =>
      button.classList.toggle(
        "selected",
        button.dataset.model === providerModel(),
      ),
    );
  document
    .querySelectorAll("[data-effort]")
    .forEach((button) =>
      button.classList.toggle(
        "selected",
        button.dataset.effort === d.config.effort,
      ),
    );
  updateSessions();
  updateCreditBalance();
  updateConnectState();
}
async function loadSession(id) {
  if (state.running) return;
  state.current = id;
  const s = await request("/api/sessions/" + id);
  setSlashCommands(s.slashCommands);
  state.provider = "anthropic";
  updateProviderUI();
  setPromptHistory(s);
  $("prompt").value = "";
  $("conversationTitle").textContent = s.title;
  $("chat").replaceChildren();
  let cost = 0;
  for (const [index, m] of s.messages.entries()) {
    message(m.role, m.text, Array.isArray(m.attachments) ? m.attachments.length : 0, index);
    cost += m.costUsd || 0;
  }
  state.cost = cost;
  updateCost();
  updateSessions();
  if (s.inFlight && !state.running) {
    await resumeInterruptedRun(s);
    return;
  }
  if (s.pendingPrompt && !state.running) {
    history.replaceState({}, "", "/");
    $("prompt").value = s.pendingPrompt;
    await send();
  }
}
function updateCost() {
  if ($("cost")) $("cost").textContent = "";
  updateUsageIndicator();
}
function updateUsageIndicator(){
  const total=totalLocalSpend();
  $("usageDot").style.setProperty("--usage",Math.max(20,Math.min(350,total*20))+"deg");
  $("usageDot").style.setProperty("--usage-color","#4285e1");
  if ($("usageDot")) $("usageDot").title="";
}
function modelLabel(value) {
  if (value === "gpt-5.4") return "GPT-5.4";
  if (value === "gpt-5.4-mini") return "GPT-5.4 mini";
  return value === "sonnet"
    ? "Sonnet 5.5"
    : value === "opus"
      ? "Opus 5.5"
      : value === "fable"
        ? "Fable 5.1"
        : value === "haiku"
          ? "Haiku 5.5"
          : value;
}
function effortLabel(value) { return {low:"Baixo",medium:"M\u00e9dio",high:"Alto"}[value] || "M\u00e9dio"; }
function updateUsagePopover(){
  const total=totalLocalSpend();
  $("usageTotal").textContent="US$ "+total.toFixed(4);
  $("usagePercent").textContent="Sem limite por tarefa";
  $("usageFill").style.width="0%";
  $("usageBudgetLine").textContent="Nesta conversa: US$ "+state.cost.toFixed(4);
}
function togglePopover(id) {
  const target = $(id);
  const opening = target.hidden;
  show($("modelPopover"), false);
  show($("usagePopover"), false);
  if (opening) {
    if (id === "usagePopover") updateUsagePopover();
    show(target, true);
  }
}
function newSession() {
  if (state.running) return;
  state.current = null;
  setPromptHistory(null);
  $("prompt").value = "";
  state.cost = 0;
  updateCost();
  $("conversationTitle").textContent = "Novo chat";
  $("chat").replaceChildren();
  const d = document.createElement("div");
  d.className = "welcome";
  d.innerHTML = '<div class="biglogo"><img src="/noctan-mark.png" alt="" /></div><h2>Pronto para qualquer tarefa?</h2><p>O Noctan mant\u00e9m o contexto do workspace e do Vault.</p>';
  $("chat").append(d);
  updateSessions();
}
let assistantSegmentEpoch = 0;
let progressUI=null;
let progressStarted=0;
let progressTicker=null;
const thinkingMessages=["Pensando...","Lendo o contexto...","Organizando as ideias...","Consultando o Vault...","Conectando ferramentas...","Descombobulando..."];
function formatElapsed(seconds){
  if(seconds<60)return seconds+"s";
  const minutes=Math.floor(seconds/60);
  const rest=seconds%60;
  return minutes+"m "+String(rest).padStart(2,"0")+"s";
}
function keepProgressLast(){
  if(!progressUI)return;
  const chat=$("chat");
  if(progressUI.details.parentElement===chat && chat.lastElementChild!==progressUI.details){
    chat.append(progressUI.details);
  }
  chat.scrollTop=chat.scrollHeight;
}
function progressHeadline(){
  if(!progressUI)return;
  const seconds=Math.floor((Date.now()-progressStarted)/1000);
  const randomLabel=thinkingMessages[Math.floor(seconds/3)%thinkingMessages.length];
  progressUI.headline.textContent=(progressUI.realStatus || randomLabel)+"  -  "+formatElapsed(seconds);
}
function beginProgress(){
  progressStarted=Date.now();
  const details=document.createElement("details");
  details.className="agentProgress";
  const summary=document.createElement("summary");
  const icon=document.createElement("img");
  icon.className="agentSpinner";
  icon.src="/noctan-mark.png";
  icon.alt="";
  const headline=document.createElement("span");
  summary.append(icon,headline);
  const log=document.createElement("div");
  log.className="agentProgressLog";
  details.append(summary,log);
  $("chat").append(details);
  progressUI={details,summary,headline,log,realStatus:""};
  addProgressEvent(
    state.provider === "openai"
      ? "Conectando \u00e0 OpenAI Responses API"
      : "Conectando ao Claude Agent SDK",
  );
  clearInterval(progressTicker);
  progressHeadline();
  progressTicker=setInterval(progressHeadline,650);
  $("chat").scrollTop=$("chat").scrollHeight;
}
function addProgressEvent(text){
  if(!progressUI)return;
  const item=document.createElement("div");
  item.textContent=new Date().toLocaleTimeString("pt-BR")+"  -  "+text;
  progressUI.log.append(item);
  if(progressUI.log.childElementCount>120)progressUI.log.firstElementChild.remove();
}
function updateProgress(text){
  if(!progressUI)return;
  progressUI.realStatus=/ferramenta|autoriza\u00e7\u00e3o|Erro|Falha/i.test(text)?text:"";
  addProgressEvent(text);
  progressHeadline();
}
function endProgress(){
  clearInterval(progressTicker);
  progressTicker=null;
  if(progressUI)progressUI.details.remove();
  progressUI=null;
}
function setRunning(value){
  state.running=value;
  $("send").disabled=false;
  show($("cancel"),value);
  $("runStatus").textContent=value?"Agente em execu\u00e7\u00e3o":"Aguardando mensagem";
}
async function approve(id, allow, allowAll = false, bypassAll = false) {
  await request("/api/approve", {
    method: "POST",
    body: JSON.stringify({ id, allow, allowAll, bypassAll }),
  });
  show($("pending"), false);
}
function approval(a) {
  const p = $("pending");
  p.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "Permiss\u00e3o solicitada: " + a.tool;
  p.append(title);
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(a.input, null, 2).slice(0, 6000);
  p.append(pre);
  for (const [name, allow, allowAll, bypassAll] of [
    ["Permitir", true, false, false],
    ["Permitir tudo", true, true, false],
    ["Bypass all permissions", true, true, true],
    ["Negar", false, false, false],
  ]) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => approve(a.id, allow, allowAll, bypassAll).catch((e) => note(e.message));
    p.append(b);
  }
  show(p, true);
}
async function resumeInterruptedRun(session) {
  if (!session?.inFlight || state.running) return;
  state.resumeInterrupted = true;
  $("runStatus").textContent = "Retomando execução interrompida...";
  await send();
}
async function send() {
  await stopDictationForSend();
  const resumeInterrupted = Boolean(state.resumeInterrupted);
  const prompt = resumeInterrupted ? "Retomar execução interrompida" : $("prompt").value.trim();
  if (!resumeInterrupted && !prompt && !state.attachments.length) return;
  if (state.running && state.current) {
    const attachments = [...state.attachments];
    if (!prompt && !attachments.length) return;
    if (prompt && !resumeInterrupted) { sentPrompts.unshift(prompt); sentPrompts = sentPrompts.slice(0,100); }
    resetPromptNavigation();
    $("prompt").value = "";
    message("user", prompt || "Imagem anexada", attachments.length);
    assistantSegmentEpoch += 1;
    keepProgressLast();
    try {
      await request("/api/follow-up", {
        method: "POST",
        body: JSON.stringify({ sessionId: state.current, prompt, attachments }),
      });
      state.attachments = [];
      renderAttachments();
      addProgressEvent(attachments.length ? "Nova mensagem com imagem enviada ao agente durante a execução." : "Nova mensagem enviada ao agente durante a execução.");
    } catch (error) {
      message("system", error.message);
    }
    return;
  }
  if (prompt && !resumeInterrupted) { sentPrompts.unshift(prompt); sentPrompts = sentPrompts.slice(0,100); }
  resetPromptNavigation();
  const attachments = [...state.attachments];
  const replayEditIndex = Number.isInteger(state.editReplayIndex) ? state.editReplayIndex : null;
  $("prompt").value = "";
  state.attachments = [];
  renderAttachments();
  if (!state.current) {
    $("chat").replaceChildren();
    $("conversationTitle").textContent = (prompt || "Imagem anexada").slice(0, 65);
  }
  if (!resumeInterrupted && replayEditIndex === null) message("user", prompt || "Imagem anexada", attachments.length);
  setRunning(true);
  beginProgress();
  let response = null;
  let assistant = null;
  let assistantSegmentSeen = assistantSegmentEpoch;
  try {
    response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        attachments,
        sessionId: state.current,
        provider: state.provider,
        editReplayIndex: replayEditIndex,
        resumeInterrupted,
      }),
    });
    state.editReplayIndex = null;
    state.resumeInterrupted = false;
    if (!response.ok) {
      const j = await response.json();
      throw Error(j.error || "Erro");
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n\n")) !== -1) {
        const packet = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const type = packet.match(/^event: (.+)$/m)?.[1],
          line = packet.match(/^data: (.+)$/m)?.[1];
        if (!line) continue;
        let data;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }
        if (type === "start") {
          state.current = data.sessionId;
          await refresh();
          updateProgress("Preparando execu\u00e7\u00e3o");
        }
        if (type === "text") {
          updateProgress("Respondendo");
          if (assistantSegmentSeen !== assistantSegmentEpoch) {
            assistant = null;
            assistantSegmentSeen = assistantSegmentEpoch;
          }
          if (!assistant) assistant = message("assistant", "");
          assistant.rawText += (assistant.rawText ? "\n" : "") + data.text;
          renderMarkdown(assistant, assistant.rawText);
          keepProgressLast();
        }
        if (type === "tool") {
          keepProgressLast();
          updateProgress("Usando ferramenta: "+String(data.name || "ferramenta"));
          addProgressEvent(JSON.stringify(data.input || {}).slice(0,600));
        }
        if (type === "init") {
          setSlashCommands(data.commands);
          renderSlashMenu();
          keepProgressLast();
          updateProgress("Agente inicializado");
          addProgressEvent("Ferramentas dispon\u00edveis: "+(data.tools || []).length);
        }
        if (type === "commands") { setSlashCommands(data.commands); renderSlashMenu(); }
        if (type === "approval") updateProgress("Aguardando autoriza\u00e7\u00e3o");
        if (type === "approval") approval(data);
        if (type === "result") {
          state.cost += data.costUsd || 0;
          updateCost();
          updateProgress("Execu\u00e7\u00e3o conclu\u00edda");
          addProgressEvent("Resultado: "+data.subtype+" · US$ "+(data.costUsd || 0).toFixed(4));
        }
        if (type === "done") updateProgress("Concluído");
        if (type === "error") updateProgress("Erro na execu\u00e7\u00e3o");
        if (type === "notice") addProgressEvent(String(data.text || ""));
        if (type === "error") message("system", data.error);

      }
    }
    await refresh();
  } catch (e) {
    updateProgress("Falha na execu\u00e7\u00e3o");
    addProgressEvent(e.message);
    message("system", e.message);
  } finally {
    endProgress();
    await refresh().catch(() => {});
    setRunning(false);
    show($("pending"), false);
  }
}
function lines(id) {
  return $(id)
    .value.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function populate() {
  const c = state.config;
  $("workspace").value = c.workspace || "";
  $("vault").value = c.vault || "";
  $("model").value = c.model || "";
  $("mcp").value = (c.mcpConfigPaths || []).join("\n");
  $("plugins").value = (c.pluginPaths || []).join("\n");
  $("extra").value = (c.additionalDirectories || []).join("\n");
  $("instructions").value = c.systemInstructions || "";
}
function displayDiscovery() {
  const d = state.discovery;
  $("discovery").textContent =
    "Detectado no computador:\n" +
    JSON.stringify(
      {
        vaults: d.vaultCandidates,
        claudeMd: d.claudeMd,
        mcpConfigs: d.mcpConfigs,
        pluginRoot: d.pluginRoot,
        apiKeyConfigured: d.apiKeyConfigured,
        workspaceExists: d.workspaceExists,
      },
      null,
      2,
    );
}
function updateConnectState() {
  const d = state.discovery || {};
  const anthropicConnected = Boolean(d.providerKeys?.anthropic);
  $("apiState").textContent = anthropicConnected ? "Conectada" : "Pendente";
  $("apiState").className = anthropicConnected ? "ok" : "warn";
  const tunnel = d.pcController || {};
  const pcLocalConnected = Boolean(tunnel.localConnected);
  const pcLocalState = tunnel.localState || (tunnel.localMcpConfigured ? "idle" : "unconfigured");
  $("tunnelState").textContent = pcLocalConnected
    ? "PC Controller conectado"
    : ["connecting", "stopping"].includes(pcLocalState) ? "Conectando..."
      : pcLocalState === "error" ? "Desconectado / erro"
        : tunnel.localMcpConfigured ? "Configurado, desconectado"
          : tunnel.status === "connected" ? "Tunnel conectado" : "Pendente";
  $("tunnelState").className = (pcLocalConnected || tunnel.status === "connected") ? "ok" : "warn";
  $("vaultState").textContent =
    d.vaultExists || d.vaultCandidates?.length ? "Conectado" : "N\u00e3o encontrado";
  $("mcpState").textContent = d.mcpConfigs?.length
    ? d.mcpConfigs.length + " fontes"
    : "NÃ£o encontrados";
  $("pluginState").textContent = d.pluginRoot
    ? "Conectados"
    : "NÃ£o encontrados";
}
function openConnect() {
  updateConnectState();
  $("anthropicApiKey").value = "";
  $("tunnelRuntimeKey").value = "";
  $("connectError").textContent = "";
  show($("connectError"), false);
  show($("connectModal"), true);
  $("anthropicApiKey").focus();
}
$("connectBtn").onclick = openConnect;
$("newWindow").onclick = () =>
  window.open("/", "_blank");
$("pcControllerBtn").onclick = async () => {
  const button = $("pcControllerBtn");
  const dot = $("pcControllerDot");
  pcReconnectInProgress = true;
  dot.className = "connecting";
  button.classList.remove("connected");
  button.title = "Reconectando PC Controller...";
  try {
    await request("/api/pc-controller/connect", { method: "POST", body: "{}" });
    await request("/api/tunnel/connect", { method: "POST", body: JSON.stringify({ autoStart: true }) }).catch(() => null);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await refreshPcControllerHealth();
      const pc = state.discovery?.pcController || {};
      if (pc.localConnected || pc.status === "connected") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const pc = state.discovery?.pcController || {};
    if (!pc.localConnected && pc.status !== "connected") throw Error(pc.lastError || pc.localLastError || "Não foi possível reconectar o PC Controller.");
  } catch (error) {
    const current = state.discovery?.pcController || {};
    current.status = "error";
    current.localState = "error";
    current.lastError = error.message;
  } finally {
    pcReconnectInProgress = false;
    updateTunnelUI();
  }
};
$("sessionSearch").oninput = updateSessions;
$("projectBtn").onclick = () => $("discoverBtn").click();
$("usageBtn").onclick = (event) => {
  event.stopPropagation();
  togglePopover("usagePopover");
};
$("usageDot").onclick = (event) => {
  event.stopPropagation();
  togglePopover("usagePopover");
};
$("modelBtn").onclick = (event) => {
  event.stopPropagation();
  togglePopover("modelPopover");
};
$("modelPopover").onclick = (event) => event.stopPropagation();
$("usagePopover").onclick = (event) => event.stopPropagation();
$("micPopover").onclick = (event) => event.stopPropagation();
document.querySelectorAll("[data-model]").forEach((button) => {
  button.onclick = async () => {
    const previous = providerModel();
    const nextModel = button.dataset.model;
    if (previous === nextModel) { show($("modelPopover"), false); return; }
    await request("/api/config", {
      method: "PUT",
      body: JSON.stringify({ ...state.config, anthropicModel: nextModel, model: nextModel }),
    });
    const noticeText = "Modelo alterado para " + modelLabel(nextModel) + (state.running ? " — passa a valer no próximo turno." : ".");
    if (state.current) {
      await request("/api/sessions/" + encodeURIComponent(state.current) + "/notice", {
        method: "POST", body: JSON.stringify({ text: noticeText, kind: "model-change", model: nextModel })
      }).catch(() => {});
    }
    message("system", noticeText);
    keepProgressLast();
    show($("modelPopover"), false);
    await refresh();
  };
});
document.querySelectorAll("[data-effort]").forEach((button) => {
  button.onclick = async () => {
    await request("/api/config", {
      method: "PUT",
      body: JSON.stringify({ ...state.config, effort: button.dataset.effort }),
    });
    await refresh();
  };
});
document.addEventListener("click", () => {
  show($("modelPopover"), false);
  show($("usagePopover"), false);
  show($("micPopover"), false);
});

document.querySelectorAll(".overlay").forEach((overlay) => {
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) show(overlay, false);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".overlay:not([hidden])").forEach((overlay) =>
    show(overlay, false),
  );
});

$("closeConnect").onclick = () => show($("connectModal"), false);
$("sidebarCredits").onclick = (event) => {
  event.stopPropagation();
  show($("usagePopover"), false);
  window.open("https://platform.claude.com/settings/billing", "_blank", "noopener,noreferrer");
};

$("closeOfficialCredits").onclick = () => show($("officialCreditsModal"), false);
$("creditsLogin").onclick = () => window.open("https://platform.claude.com/settings/billing", "_blank", "noopener,noreferrer");
$("creditsReload").onclick = () => {
  const view = $("officialCreditsView");
  if (typeof view?.reload === "function") view.reload();
  else window.open("https://platform.claude.com/settings/billing", "_blank", "noopener,noreferrer");
};

$("openAdvanced").onclick = () => {
  show($("connectModal"), false);
  $("settingsBtn").click();
};
$("connectAll").onclick = async () => {
  const anthropicKey = $("anthropicApiKey").value.trim();
  const runtimeKey = $("tunnelRuntimeKey").value.trim();
  const button = $("connectAll");
  button.disabled = true;
  button.textContent = "Conectando...";
  show($("connectError"), false);
  try {
    if (
      !anthropicKey &&
      !runtimeKey &&
      !state.discovery.providerKeys?.anthropic &&
      !state.discovery.pcController?.localMcpConfigured &&
      !state.discovery.pcController?.runtimeKeyConfigured
    )
      throw Error("Conecte a Anthropic ou configure o PC Controller local.");
    if (anthropicKey)
      await request("/api/connect", {
        method: "POST",
        body: JSON.stringify({ key: anthropicKey, provider: "anthropic" }),
      });
    if (runtimeKey || state.discovery.pcController?.runtimeKeyConfigured)
      await request("/api/tunnel/connect", {
        method: "POST",
        body: JSON.stringify({
          runtimeKey,
          autoStart: true,
        }),
      });
    await request("/api/autoconfigure", { method: "POST", body: "{}" });
    $("anthropicApiKey").value = "";
    $("tunnelRuntimeKey").value = "";
    await refresh();
    button.textContent = "Conectado \u2713";
    setTimeout(() => show($("connectModal"), false), 650);
  } catch (e) {
    $("connectError").textContent = e.message;
    show($("connectError"), true);
    button.textContent = "Conectar tudo";
  } finally {
    button.disabled = false;
  }
};
$("settingsBtn").onclick = () => {
  populate();
  displayDiscovery();
  show($("modal"), true);
};
$("closeSettings").onclick = () => show($("modal"), false);
$("discoverBtn").onclick = async () => {
  await refresh();
  $("settingsBtn").click();
};
$("scan").onclick = async () => {
  await refresh();
  displayDiscovery();
  if (!state.config.vault && state.discovery.vaultCandidates.length)
    $("vault").value = state.discovery.vaultCandidates[0];
  if (!state.config.mcpConfigPaths?.length)
    $("mcp").value = state.discovery.mcpConfigs.join("\n");
};
$("saveSettings").onclick = async () => {
  try {
    const c = {
      ...state.config,
      workspace: $("workspace").value,
      vault: $("vault").value,
      model: $("model").value,
      mcpConfigPaths: lines("mcp"),
      pluginPaths: lines("plugins"),
      additionalDirectories: lines("extra"),
      systemInstructions: $("instructions").value,
    };
    await request("/api/config", { method: "PUT", body: JSON.stringify(c) });
    await refresh();
    show($("modal"), false);
  } catch (e) {
    alert(e.message);
  }
};
$("new").onclick = newSession;
$("send").onclick = send;
$("attachImage").onclick = () => $("imageInput").click();
$("imageInput").onchange = async (event) => {
  await addImages(event.target.files);
  event.target.value = "";
};
$("prompt").addEventListener("paste", async (event) => {
  const images = [...event.clipboardData.files].filter((file) =>
    file.type.startsWith("image/"),
  );
  if (images.length) {
    event.preventDefault();
    await addImages(images);
  }
});
const composer = document.querySelector(".composer");
for (const name of ["dragenter", "dragover"]) {
  composer.addEventListener(name, (event) => {
    event.preventDefault();
    composer.classList.add("dragging");
  });
}
for (const name of ["dragleave", "drop"]) {
  composer.addEventListener(name, (event) => {
    event.preventDefault();
    composer.classList.remove("dragging");
  });
}
composer.addEventListener("drop", async (event) => {
  await addImages(event.dataTransfer.files);
});

let microphoneStream = null;
let audioContext = null;
let audioProcessor = null;
let audioSource = null;
let audioChunks = [];
let selectedMicId = localStorage.getItem("noctan.microphone") || "default";
let selectedMicLabel = localStorage.getItem("noctan.microphoneLabel") || "";
let micServerPreferenceInitialized = false;
function rememberMic(id, label) {
 selectedMicId = id || "default"; selectedMicLabel = label || "";
 localStorage.setItem("noctan.microphone", selectedMicId);
 localStorage.setItem("noctan.microphoneLabel", selectedMicLabel);
 request("/api/preferences/microphone", { method: "POST", body: JSON.stringify({ deviceId: selectedMicId, label: selectedMicLabel }) }).catch(() => {});
}
async function resolveMic() {
 if (selectedMicId === "default") return;
 const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
 if (!devices.some(d => d.deviceId === selectedMicId)) {
  const found = devices.find(d => d.label && d.label === selectedMicLabel);
  rememberMic(found?.deviceId || "default", found?.label || "");
 }
}

async function listMicrophones() {
  const container = $("micDevices");
  container.replaceChildren();
  try {
    const permission = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    permission.getTracks().forEach((track) => track.stop());
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    if (!devices.length) throw Error("Nenhum microfone encontrado");
    for (const [index, device] of devices.entries()) {
      const button = document.createElement("button");
      button.className = "micChoice";
      if (device.deviceId === selectedMicId) button.classList.add("selected");
      button.textContent = device.label || `Microfone ${index + 1}`;
      button.onclick = () => {
        rememberMic(device.deviceId, device.label);
        listMicrophones();
      };
      container.append(button);
    }
  } catch (error) {
    const hint = document.createElement("span");
    hint.className = "micHint";
    hint.textContent = `Libere o microfone no Windows para listar os dispositivos. (${error.message})`;
    container.append(hint);
  }
}

$("micMenuBtn").onclick = async (event) => {
  event.stopPropagation();
  const opening = $("micPopover").hidden;
  show($("modelPopover"), false);
  show($("usagePopover"), false);
  show($("micPopover"), opening);
  if (opening) await listMicrophones();
};

function resampleAudio(chunks, sourceRate, targetRate = 16000) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const source = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    source.set(chunk, offset);
    offset += chunk.length;
  }
  if (sourceRate === targetRate) return source;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(source.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end && cursor < source.length; cursor += 1)
      sum += source[cursor];
    output[index] = sum / (end - start);
  }
  return output;
}

function pcmBase64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32768)
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(binary);
}


const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRecognition = null;
let speechBase = "";
let speechFinal = "";
let speechActive = false;
let speechStopPromise = null;
let speechStopResolve = null;
let speechLastError = "";

function updateSpeechPrompt(interim = "") {
  $("prompt").value = [speechBase, speechFinal, interim].filter(Boolean).join(" ").trim();
}
function finishSpeechSession() {
  speechActive = false;
  $("dictate").classList.remove("recording");
  $("runStatus").textContent = speechLastError
    ? "Ditado interrompido: " + speechLastError
    : "Ditado conclu\u00eddo";
  if (speechStopResolve) speechStopResolve();
  speechStopResolve = null;
  speechStopPromise = null;
  speechRecognition = null;
}
async function startLegacyRecording() {
  if ($("dictate").classList.contains("recording")) return;
  if (SpeechRecognitionAPI && selectedMicId === "default") {
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    speechRecognition = recognition;
    speechBase = $("prompt").value.trim();
    speechFinal = "";
    speechLastError = "";
    speechActive = true;
    recognition.onresult = (event) => {
      let interim = "";
      let confirmed = "";
      for (let i = 0; i < event.results.length; i++) {
        const text = event.results[i][0]?.transcript?.trim() || "";
        if (event.results[i].isFinal) confirmed += " " + text;
        else interim += " " + text;
      }
      speechFinal = confirmed.trim();
      updateSpeechPrompt(interim.trim());
      $("runStatus").textContent = interim.trim() ? "Transcrevendo ao vivo..." : "Ouvindo...";
    };
    recognition.onerror = (event) => {
      speechLastError = event.error || "indisponível";
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "network") {
        $("runStatus").textContent = "Reconhecimento ao vivo indisponível; tente o modo local";
      }
    };
    recognition.onend = () => {
      const failed = speechLastError && !speechFinal;
      finishSpeechSession();
      if (failed) $("runStatus").textContent = "Reconhecimento ao vivo indisponível. Use Chrome ou selecione outro microfone para o modo local.";
    };
    try {
      recognition.start();
      $("dictate").classList.add("recording");
    $("runStatus").textContent = "Ouvindo... texto aparece enquanto voc\u00ea fala";
      return;
    } catch (error) {
      speechRecognition = null;
      speechActive = false;
      $("runStatus").textContent = "Ditado ao vivo indisponível; iniciando modo local";
    }
  }
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: { ...(selectedMicId === "default" ? {} : { deviceId: { exact: selectedMicId } }), echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioContext = new AudioContext();
    audioChunks = [];
    audioSource = audioContext.createMediaStreamSource(microphoneStream);
    audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    audioProcessor.onaudioprocess = (event) => audioChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    audioSource.connect(audioProcessor);
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    audioProcessor.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    $("dictate").classList.add("recording");
    $("runStatus").textContent = "Gravando localmente... transcri\u00e7\u00e3o ao parar";
  } catch (error) {
    message("system", "N\u00e3o foi poss\u00edvel abrir o microfone: " + error.message);
  }
}

async function stopLegacyRecording() {
  if (speechRecognition) {
    if (!speechStopPromise) {
      speechStopPromise = new Promise(resolve => { speechStopResolve = resolve; });
      speechRecognition.stop();
    }
    await Promise.race([speechStopPromise, new Promise(resolve => setTimeout(resolve, 2000))]);
    return;
  }
  if (!$("dictate").classList.contains("recording") || !audioContext) return;
  $("dictate").classList.remove("recording");
  const sampleRate = audioContext.sampleRate;
  audioProcessor.disconnect();
  audioSource.disconnect();
  microphoneStream.getTracks().forEach(track => track.stop());
  await audioContext.close();
  microphoneStream = null;
  audioContext = null;
  $("runStatus").textContent = "Transcrevendo localmente...";
  try {
    const audio = pcmBase64(resampleAudio(audioChunks, sampleRate));
    const result = await request("/api/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio }),
    });
    if (result.text) $("prompt").value = [$("prompt").value.trim(), result.text].filter(Boolean).join(" ");
    $("runStatus").textContent = "Transcri\u00e7\u00e3o conclu\u00edda";
  } catch (error) {
    $("runStatus").textContent = "Falha na transcri\u00e7\u00e3o";
    message("system", "N\u00e3o foi poss\u00edvel transcrever o \u00e1udio: " + error.message);
  } finally { audioChunks = []; }
}

let sttSocket = null;
let sttWarmSocket = null;
let sttWarmReady = false;
let sttWarmPromise = null;
function prewarmStt() {
  if (sttActive || sttSocket) return Promise.resolve(null);
  if (sttWarmSocket && (sttWarmSocket.readyState === WebSocket.OPEN || sttWarmSocket.readyState === WebSocket.CONNECTING)) return sttWarmPromise || Promise.resolve(sttWarmSocket);
  const ws = new WebSocket("ws://" + location.host + "/api/stt-stream");
  sttWarmSocket = ws; sttWarmReady = false;
  sttWarmPromise = new Promise((resolve) => {
    const finish = (value) => resolve(value);
    ws.onmessage = ({ data }) => {
      let event; try { event = JSON.parse(data); } catch { return; }
      if (event.type === "ready") { sttWarmReady = true; finish(ws); }
      if (event.type === "error") { sttWarmReady = false; finish(null); ws.close(); }
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => { if (sttWarmSocket === ws) { sttWarmSocket = null; sttWarmReady = false; sttWarmPromise = null; } };
  });
  return sttWarmPromise;
}
function takeWarmSttSocket() {
  const canReuse = sttWarmSocket && (sttWarmSocket.readyState === WebSocket.OPEN || sttWarmSocket.readyState === WebSocket.CONNECTING);
  const ws = canReuse ? sttWarmSocket : new WebSocket("ws://" + location.host + "/api/stt-stream");
  const ready = Boolean(canReuse && sttWarmReady);
  sttWarmSocket = null; sttWarmReady = false; sttWarmPromise = null;
  return { ws, ready };
}
let sttReady = false;
let sttBuffered = [];
let sttBufferedBytes = 0;
let sttFinishingBeforeReady = false;
let sttActive = false;
let sttBase = "";
let sttPartial = "";
let sttDone = null;
let sttResolve = null;
let voiceStartedAt = 0;
let voiceAnimation = null;
let voiceLevel = 0;
let voiceHistory = Array(58).fill(0);
let voiceBarsReady = false;
let voiceDiscard = false;
function initVoiceBars() {
  if (voiceBarsReady) return;
  const container = $("voiceWave");
  if (!container) return;
  const bars = document.createDocumentFragment();
  for (let i = 0; i < voiceHistory.length; i++) {
    const bar = document.createElement("span");
    bar.className = "voiceBar";
    bars.append(bar);
  }
  container.append(bars);
  voiceBarsReady = true;
}
function renderVoiceWave() {
  if (!$("liveVoiceBar") || $("liveVoiceBar").hidden) return;
  voiceHistory.push(voiceLevel);
  voiceHistory.shift();
  voiceLevel *= 0.76;
  const bars = $("voiceWave").children;
  for (let i = 0; i < bars.length; i++) {
    bars[i].style.height = (3 + Math.min(1, voiceHistory[i] * 8) * 23) + "px";
  }
  const sec = Math.max(0, Math.floor((Date.now() - voiceStartedAt) / 1000));
  $("voiceTimer").textContent = String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
}
function beginVoiceVisual() {
  initVoiceBars();
  voiceStartedAt = Date.now();
  voiceHistory.fill(0);
  voiceLevel = 0;
  $("liveVoiceBar").hidden = false;
  if (voiceAnimation) clearInterval(voiceAnimation);
  voiceAnimation = setInterval(renderVoiceWave, 80);
}
function endVoiceVisual() {
  if (voiceAnimation) clearInterval(voiceAnimation);
  voiceAnimation = null;
  $("liveVoiceBar").hidden = true;
}
function analyzeVoiceLevel(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 8) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.ceil(samples.length / 8));
  voiceLevel = Math.max(voiceLevel * 0.65, Math.min(1, rms * 8));
}
$("voiceFinish").onclick = () => stopRecording();
$("voiceCancel").onclick = async () => {
  voiceDiscard = true;
  await stopRecording();
  $("prompt").value = sttBase;
  $("runStatus").textContent = "Ditado descartado";
  endVoiceVisual();
};


async function releaseStreamingMic() {
  if (audioProcessor) { audioProcessor.disconnect(); audioProcessor = null; }
  if (audioSource) { audioSource.disconnect(); audioSource = null; }
  if (microphoneStream) {
    microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
  }
  if (audioContext) { await audioContext.close().catch(() => {}); audioContext = null; }
}
function commitStreamingText(text) {
  sttPartial = text || "";
  $("prompt").value = [sttBase, sttPartial].filter(Boolean).join(" ").trim();
}
function resolveStreamingStop() {
  if (sttResolve) sttResolve();
  sttResolve = null;
  sttDone = null;
}
async function startRecording() {
  if (sttActive || $("dictate").classList.contains("recording")) return;
  sttActive = true;
  sttBase = $("prompt").value.trim();
  sttPartial = "";
  voiceDiscard = false;
  sttReady = false; sttBuffered = []; sttBufferedBytes = 0; sttFinishingBeforeReady = false;
  const url = "ws://" + location.host + "/api/stt-stream";
  $("runStatus").textContent = "Carregando reconhecimento local...";
  beginVoiceVisual();
  try {
    const warm = takeWarmSttSocket();
    const ws = warm.ws;
    sttReady = warm.ready;
    sttSocket = ws;
    if (sttReady) $("runStatus").textContent = "Transcrevendo ao vivo...";
    ws.onmessage = async ({ data }) => {
      let event;
      try { event = JSON.parse(data); } catch { return; }
      if (event.type === "error") {
        const error = String(event.error || "Falha no reconhecimento");
        $("runStatus").textContent = error;
        await releaseStreamingMic();
        endVoiceVisual();
        sttActive = false;
        $("dictate").classList.remove("recording");
        sttSocket = null;
        ws.close();
        resolveStreamingStop();
        if (!sttPartial) await startLegacyRecording();
        return;
      }
      if (event.type === "partial") {
        if (!voiceDiscard) commitStreamingText(event.text);
        $("runStatus").textContent = "Transcrevendo ao vivo...";
        return;
      }
      if (event.type === "final") {
        if (!voiceDiscard) commitStreamingText(event.text);
        endVoiceVisual();
        $("runStatus").textContent = "Transcri\u00e7\u00e3o conclu\u00edda";
        sttSocket = null;
        sttActive = false;
        $("dictate").classList.remove("recording");
        ws.close();
        resolveStreamingStop();
        setTimeout(() => prewarmStt().catch(() => {}), 250);
        return;
      }
      if (event.type !== "ready") return;
      sttReady = true;
      for (const chunk of sttBuffered) if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      sttBuffered = []; sttBufferedBytes = 0;
      if (sttFinishingBeforeReady && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "finish" }));
  $("runStatus").textContent = "Transcrevendo desde o in\u00edcio...";
    };
    try {
      await resolveMic();
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(selectedMicId === "default" ? {} : { deviceId: { exact: selectedMicId } }),
            echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          },
        });

        audioContext = new AudioContext();
        audioSource = audioContext.createMediaStreamSource(microphoneStream);
        audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        audioProcessor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN || !sttActive) return;
          const samples = e.inputBuffer.getChannelData(0);
          analyzeVoiceLevel(samples);
          const resampled = resampleAudio([new Float32Array(samples)], audioContext.sampleRate);
          const raw = new ArrayBuffer(resampled.length * 2);
          const pcm = new DataView(raw);
          for (let i = 0; i < resampled.length; i++) {
            const sample = Math.max(-1, Math.min(1, resampled[i]));
            pcm.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
          }
          if (sttReady && ws.readyState === WebSocket.OPEN) {
  if (ws.bufferedAmount < 160000) ws.send(raw);
} else if (sttBufferedBytes + raw.byteLength <= 192000) {
  sttBuffered.push(raw); sttBufferedBytes += raw.byteLength;
}
        };
        audioSource.connect(audioProcessor);
        const silent = audioContext.createGain();
        silent.gain.value = 0;
        audioProcessor.connect(silent);
        silent.connect(audioContext.destination);
        $("dictate").classList.add("recording");
  $("runStatus").textContent = "Ouvindo desde agora... preparando transcri\u00e7\u00e3o";

    } catch (error) {
      sttActive = false;
      $("runStatus").textContent = "Microfone indisponível: " + error.message;
      ws.close();
      await releaseStreamingMic();
      endVoiceVisual();
      resolveStreamingStop();
    }
  ws.onerror = () => { $("runStatus").textContent = "Falha na conex\u00e3o local de voz"; };
    ws.onclose = async () => {
      if (!sttActive) return;
      sttActive = false;
      $("dictate").classList.remove("recording");
      await releaseStreamingMic();
      endVoiceVisual();
      sttSocket = null;
      resolveStreamingStop();
      setTimeout(() => prewarmStt().catch(() => {}), 250);
    };
  } catch (error) {
    sttActive = false;
    await startLegacyRecording();
  }
}
async function stopRecording() {
  if (sttSocket) {
    const ws = sttSocket;
    if (!sttDone) sttDone = new Promise((resolve) => { sttResolve = resolve; });
    sttActive = false;
    $("dictate").classList.remove("recording");
    await releaseStreamingMic();
    endVoiceVisual();
    if (ws.readyState === WebSocket.OPEN) {
      if (sttReady) ws.send(JSON.stringify({ type: "finish" }));
      else sttFinishingBeforeReady = true;
  $("runStatus").textContent = "Finalizando transcri\u00e7\u00e3o...";
    } else {
      ws.close();
      resolveStreamingStop();
    }
    const completed = await Promise.race([
      sttDone.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!completed) {
      try { ws.close(); } catch {}
      resolveStreamingStop();
      if (!voiceDiscard && sttPartial) $("runStatus").textContent = "Transcrição concluída";
      else if (!voiceDiscard) $("runStatus").textContent = "Não foi possível finalizar a transcrição";
      setTimeout(() => prewarmStt().catch(() => {}), 250);
    }
    sttSocket = null;
    return;
  }
  endVoiceVisual();
  await stopLegacyRecording();
}

stopDictationForSend = stopRecording;
$("dictate").onclick = () => {
  if ($("dictate").classList.contains("recording")) stopRecording();
  else startRecording();
};
$("prompt").onkeydown = (e) => {
  const slash = slashMatches();
  if (slash.length && ["ArrowUp","ArrowDown","Tab","Enter"].includes(e.key)) {
    if (e.key === "ArrowUp") slashSelection = (slashSelection - 1 + slash.length) % slash.length;
    else if (e.key === "ArrowDown") slashSelection = (slashSelection + 1) % slash.length;
    else chooseSlash(slash[slashSelection]);
    e.preventDefault();
    renderSlashMenu();
    return;
  }
  if (e.key === "ArrowUp" && !e.shiftKey && !e.ctrlKey && !e.metaKey && ($("prompt").selectionStart === 0 || !$("prompt").value)) {
    if (promptHistoryIndex === -1) promptDraft = $("prompt").value;
    if (sentPrompts.length) {
      promptHistoryIndex = Math.min(promptHistoryIndex + 1, sentPrompts.length - 1);
      $("prompt").value = sentPrompts[promptHistoryIndex];
      e.preventDefault();
    }
    return;
  }
  if (e.key === "ArrowDown" && promptHistoryIndex >= 0) {
    promptHistoryIndex -= 1;
    $("prompt").value = promptHistoryIndex < 0 ? promptDraft : sentPrompts[promptHistoryIndex];
    e.preventDefault();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
};
$("prompt").addEventListener("input", () => { slashSelection = 0; renderSlashMenu(); });
$("cancel").onclick = async () => {
  if (state.current)
    await request("/api/cancel", {
      method: "POST",
      body: JSON.stringify({ sessionId: state.current }),
    }).catch((e) => note(e.message));
};
document.querySelectorAll("[data-prompt]").forEach(
  (b) =>
    (b.onclick = () => {
      $("prompt").value = b.dataset.prompt;
      $("prompt").focus();
    }),
);
const pcHealthTimer = setInterval(() => refreshPcControllerHealth().catch(() => {}), 2000);
refresh()
  .then(async () => {
    const requested = new URLSearchParams(location.search).get("session");
    const interrupted = state.sessions.find((session) => session.inFlight);
    const latest = [...state.sessions].sort((a,b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
    const selected = requested && state.sessions.some(session => session.id === requested)
      ? requested
      : interrupted?.id || latest?.id;
    if (selected) await loadSession(selected);
  })
  .catch((e) => message("system", e.message));



setTimeout(() => prewarmStt().catch(() => {}), 600);

function renderUpdaterStatus(status = {}) {
  if ($("appVersion") && status.currentVersion) $("appVersion").textContent = "v" + status.currentVersion;
  const button = $("updateBtn");
  if (!button) return;
  const current = status.status || "idle";
  button.disabled = current === "checking" || current === "downloading";
  if (current === "checking") button.textContent = "↻ Verificando...";
  else if (current === "available" || current === "downloading") button.textContent = "↓ " + (status.message || "Baixando atualização...");
  else if (current === "downloaded") button.textContent = "↻ Reiniciar para atualizar";
  else if (current === "error") button.textContent = "⚠ Atualizações";
  else button.textContent = "↻ Atualizações";
  button.title = status.message || "Verificar atualizações";
}
if (window.noctanUpdater) {
  window.noctanUpdater.getStatus().then(renderUpdaterStatus).catch(() => {});
  window.noctanUpdater.onStatus(renderUpdaterStatus);
  $("updateBtn").onclick = async () => {
    const status = await window.noctanUpdater.getStatus();
    if (status.status === "downloaded") {
      await window.noctanUpdater.installNow();
      return;
    }
    renderUpdaterStatus({ status: "checking", message: "Verificando atualização..." });
    try {
      renderUpdaterStatus(await window.noctanUpdater.checkNow());
    } catch (error) {
      renderUpdaterStatus({ status: "error", message: error.message });
    }
  };
} else if ($("updateBtn")) {
  $("updateBtn").hidden = true;
}

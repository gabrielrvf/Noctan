const $ = (id) => document.getElementById(id);
let state = {
  config: {},
  discovery: {},
  sessions: [],
  current: null,
  running: false,
  cost: 0,
};
const request = async (url, options = {}) => {
  const r = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Erro na solicitação");
  return j;
};
const show = (el, yes) => (el.hidden = !yes);
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
function message(role, text) {
  const e = document.createElement("div");
  e.className = "message " + role;
  e.rawText = text;
  if (role === "assistant") renderMarkdown(e, text);
  else e.textContent = text;
  $("chat").append(e);
  $("chat").scrollTop = $("chat").scrollHeight;
  return e;
}
function note(text) {
  const e = document.createElement("div");
  e.className = "tool";
  e.textContent = text;
  $("chat").append(e);
  $("chat").scrollTop = $("chat").scrollHeight;
}
function updateSessions() {
  const el = $("sessions");
  el.replaceChildren();
  const term = $("sessionSearch").value.trim().toLowerCase();
  for (const s of state.sessions.filter(
    (item) => !term || item.title.toLowerCase().includes(term),
  )) {
    const b = document.createElement("button");
    b.className = "session" + (state.current === s.id ? " active" : "");
    b.textContent = "▤ " + s.title;
    b.onclick = () => loadSession(s.id);
    el.append(b);
  }
}
async function refresh() {
  const d = await request("/api/status");
  state.config = d.config;
  state.discovery = d.discovery;
  state.sessions = await request("/api/sessions");
  $("connection").textContent = d.discovery.apiKeyConfigured
    ? "● Tudo conectado"
    : "○ Conexão pendente";
  $("connection").style.color = d.discovery.apiKeyConfigured
    ? "#3f8f63"
    : "#b56b36";
  $("workspaceLabel").textContent =
    d.config.workspace || "Configure seu workspace";
  $("modelBtnLabel").textContent = modelLabel(d.config.model || "sonnet");
  $("effortLabel").textContent = effortLabel(d.config.effort || "medium");
  document
    .querySelectorAll("[data-model]")
    .forEach((button) =>
      button.classList.toggle(
        "selected",
        button.dataset.model === d.config.model,
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
  updateConnectState();
}
async function loadSession(id) {
  if (state.running) return;
  state.current = id;
  const s = await request("/api/sessions/" + id);
  $("conversationTitle").textContent = s.title;
  $("chat").replaceChildren();
  let cost = 0;
  for (const m of s.messages) {
    message(m.role, m.text);
    cost += m.costUsd || 0;
  }
  state.cost = cost;
  updateCost();
  updateSessions();
}
function updateCost() {
  $("cost").textContent = "US$ " + state.cost.toFixed(4) + " nesta conversa";
  updateUsageIndicator();
}
function updateUsageIndicator() {
  const budget = Number(state.config?.maxBudgetUsd || 0.25);
  const percent = Math.min(100, budget ? (state.cost / budget) * 100 : 0);
  const color =
    percent >= 90 ? "#dc4c4c" : percent >= 65 ? "#e1ac3c" : "#4285e1";
  $("usageDot").style.setProperty(
    "--usage",
    Math.max(18, percent * 3.6) + "deg",
  );
  $("usageDot").style.setProperty("--usage-color", color);
  $("usageDot").title =
    percent.toFixed(percent < 1 ? 1 : 0) + "% do limite desta tarefa";
}
function modelLabel(value) {
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
function effortLabel(value) {
  return { low: "Baixo", medium: "Médio", high: "Alto" }[value] || "Médio";
}
function updateUsagePopover() {
  const total = state.sessions.reduce(
    (sum, session) =>
      sum +
      (session.messages || []).reduce(
        (subtotal, message) => subtotal + (message.costUsd || 0),
        0,
      ),
    0,
  );
  const budget = Number(state.config.maxBudgetUsd || 0.25);
  const percent = Math.min(100, budget ? (state.cost / budget) * 100 : 0);
  $("usageTotal").textContent = "US$ " + total.toFixed(4);
  $("usagePercent").textContent =
    percent.toFixed(percent < 1 ? 1 : 0) + "% usado";
  $("usageFill").style.width = percent + "%";
  $("usageFill").style.background =
    percent >= 90 ? "#dc4c4c" : percent >= 65 ? "#e1ac3c" : "#4285e1";
  $("usageBudgetLine").textContent =
    "US$ " + state.cost.toFixed(4) + " de US$ " + budget.toFixed(2);
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
  state.cost = 0;
  updateCost();
  $("conversationTitle").textContent = "Novo chat";
  $("chat").replaceChildren();
  const d = document.createElement("div");
  d.className = "welcome";
  d.innerHTML =
    '<div class="biglogo">✦</div><h2>Pronto para qualquer tarefa?</h2><p>O Claude X mantém o contexto do workspace e do Vault.</p>';
  $("chat").append(d);
  updateSessions();
}
let thinkingTimer = null;
const thinkingMessages = [
  "Pensando...",
  "Lendo o contexto...",
  "Organizando as ideias...",
  "Consultando o Vault...",
  "Clauding...",
  "Descombobulando...",
];
function setRunning(value) {
  state.running = value;
  $("send").disabled = value;
  show($("cancel"), value);
  clearInterval(thinkingTimer);
  thinkingTimer = null;
  if (value) {
    let index = 0;
    $("runStatus").textContent = thinkingMessages[index];
    thinkingTimer = setInterval(() => {
      index = (index + 1) % thinkingMessages.length;
      $("runStatus").textContent = thinkingMessages[index];
    }, 2200);
  } else {
    $("runStatus").textContent = "Aguardando mensagem";
  }
}
async function approve(id, allow) {
  await request("/api/approve", {
    method: "POST",
    body: JSON.stringify({ id, allow }),
  });
  show($("pending"), false);
}
function approval(a) {
  const p = $("pending");
  p.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "Permissão solicitada: " + a.tool;
  p.append(title);
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(a.input, null, 2).slice(0, 6000);
  p.append(pre);
  for (const [name, allow] of [
    ["Permitir", true],
    ["Negar", false],
  ]) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => approve(a.id, allow).catch((e) => note(e.message));
    p.append(b);
  }
  show(p, true);
}
async function send() {
  const prompt = $("prompt").value.trim();
  if (!prompt || state.running) return;
  $("prompt").value = "";
  if (!state.current) {
    $("chat").replaceChildren();
    $("conversationTitle").textContent = prompt.slice(0, 65);
  }
  message("user", prompt);
  setRunning(true);
  let response = null;
  let assistant = null;
  try {
    response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, sessionId: state.current }),
    });
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
          updateSessions();
        }
        if (type === "text") {
          if (!assistant) assistant = message("assistant", "");
          assistant.rawText += (assistant.rawText ? "\n" : "") + data.text;
          renderMarkdown(assistant, assistant.rawText);
          $("chat").scrollTop = $("chat").scrollHeight;
        }
        if (type === "tool")
          note(
            "⚙ " + data.name + " · " + JSON.stringify(data.input).slice(0, 450),
          );
        if (type === "approval") approval(data);
        if (type === "result") {
          state.cost += data.costUsd || 0;
          updateCost();
          note(
            "Execução: " +
              data.subtype +
              " · US$ " +
              (data.costUsd || 0).toFixed(4),
          );
        }
        if (type === "error") message("system", data.error);
        if (type === "notice") note(data.text);
      }
    }
    await refresh();
  } catch (e) {
    message("system", e.message);
  } finally {
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
  $("budget").value = c.maxBudgetUsd || 1;
  $("turns").value = c.maxTurns || 15;
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
  $("apiState").textContent = d.apiKeyConfigured ? "Conectada" : "Pendente";
  $("apiState").className = d.apiKeyConfigured ? "ok" : "warn";
  $("vaultState").textContent =
    d.vaultExists || d.vaultCandidates?.length ? "Conectado" : "Não encontrado";
  $("mcpState").textContent = d.mcpConfigs?.length
    ? d.mcpConfigs.length + " fontes"
    : "Não encontrados";
  $("pluginState").textContent = d.pluginRoot
    ? "Conectados"
    : "Não encontrados";
}
function openConnect() {
  updateConnectState();
  $("apiKey").value = "";
  $("connectError").textContent = "";
  show($("connectError"), false);
  show($("connectModal"), true);
  $("apiKey").focus();
}
$("connectBtn").onclick = openConnect;
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
document.querySelectorAll("[data-model]").forEach((button) => {
  button.onclick = async () => {
    await request("/api/config", {
      method: "PUT",
      body: JSON.stringify({ ...state.config, model: button.dataset.model }),
    });
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
});
$("closeConnect").onclick = () => show($("connectModal"), false);
$("openAdvanced").onclick = () => {
  show($("connectModal"), false);
  $("settingsBtn").click();
};
$("connectAll").onclick = async () => {
  const key = $("apiKey").value.trim();
  const button = $("connectAll");
  button.disabled = true;
  button.textContent = "Conectando...";
  show($("connectError"), false);
  try {
    await request("/api/connect", {
      method: "POST",
      body: JSON.stringify({ key }),
    });
    await request("/api/autoconfigure", { method: "POST", body: "{}" });
    $("apiKey").value = "";
    await refresh();
    button.textContent = "Conectado ✓";
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
      maxBudgetUsd: Number($("budget").value),
      maxTurns: Number($("turns").value),
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
$("prompt").onkeydown = (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
  }
};
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
refresh().catch((e) => message("system", e.message));

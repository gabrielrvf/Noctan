import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client = null;
let transport = null;
let state = "idle";
let message = "Configurado, mas desconectado";
let toolCount = 0;
let lastOkAt = null;
let lastError = null;
let closing = false;

function snapshot(configured = true) {
  return {
    configured,
    state: configured ? state : "unconfigured",
    connected: configured && state === "connected",
    message: configured ? message : "PC Controller não configurado",
    toolCount,
    lastOkAt,
    lastError,
  };
}

function markDead(error) {
  client = null;
  transport = null;
  toolCount = 0;
  if (closing) {
    state = "idle";
    message = "Desconectado";
    lastError = null;
  } else {
    state = "error";
    lastError = String(error?.message || error || "Conexão encerrada");
    message = "PC Controller desconectado";
  }
}

export async function connectLocalPcController(definition) {
  if (!definition?.command) {
    state = "error";
    message = "PC Controller não configurado";
    lastError = "Definição MCP sem command";
    return snapshot(false);
  }
  if (client && state === "connected") return snapshot(true);

  closing = false;
  state = "connecting";
  message = "Conectando PC Controller...";
  lastError = null;

  try {
    const nextClient = new Client(
      { name: "noctan-pc-health", version: "1.0.0" },
      { capabilities: {} },
    );
    const nextTransport = new StdioClientTransport({
      command: definition.command,
      args: definition.args || [],
      env: { ...process.env, ...(definition.env || {}) },
      cwd: definition.cwd,
      stderr: "pipe",
    });
    nextTransport.onclose = () => markDead("Processo do PC Controller foi encerrado");
    nextTransport.onerror = (error) => markDead(error);

    await nextClient.connect(nextTransport);
    const listed = await nextClient.listTools();

    client = nextClient;
    transport = nextTransport;
    toolCount = listed.tools?.length || 0;
    state = "connected";
    message = "PC Controller conectado";
    lastOkAt = new Date().toISOString();
    return snapshot(true);
  } catch (error) {
    try { await transport?.close(); } catch {}
    markDead(error);
    return snapshot(true);
  }
}

let pending = null;

// Proxy usado pelo endpoint /mcp: fala com o mesmo processo do PC Controller, reconectando se ele caiu.
export function localPcControllerProxy(getDefinition) {
  async function ready() {
    if (!client || state !== "connected") {
      pending ||= connectLocalPcController(getDefinition()).finally(() => { pending = null; });
      await pending;
    }
    if (!client) throw new Error(lastError || message);
    return client;
  }
  return {
    async listTools() {
      return (await (await ready()).listTools()).tools || [];
    },
    async callTool(name, args) {
      // Comandos longos do controlador vão até 300 s (maxCommandTimeoutMs).
      return (await ready()).callTool({ name, arguments: args }, undefined, { timeout: 310_000 });
    },
  };
}

export async function disconnectLocalPcController() {
  closing = true;
  state = "stopping";
  message = "Desconectando PC Controller...";
  try { await client?.close(); } catch {}
  try { await transport?.close(); } catch {}
  client = null;
  transport = null;
  toolCount = 0;
  state = "idle";
  message = "Desconectado";
  lastError = null;
  closing = false;
  return snapshot(true);
}

export async function localPcControllerStatus(configured = true) {
  if (!configured) return snapshot(false);
  if (!client || state !== "connected") return snapshot(true);
  try {
    const listed = await Promise.race([
      client.listTools(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Health check expirou")), 1500)),
    ]);
    toolCount = listed.tools?.length || toolCount;
    lastOkAt = new Date().toISOString();
    message = "PC Controller conectado";
    return snapshot(true);
  } catch (error) {
    markDead(error);
    return snapshot(true);
  }
}

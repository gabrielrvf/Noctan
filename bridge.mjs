#!/usr/bin/env node
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const baseUrl = String(
  process.env.NOCTAN_URL || "http://127.0.0.1:4177",
).replace(/\/$/, "");

async function noctan(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  }).catch(() => null);
  if (!response)
    throw new Error(
      "O Noctan não está aberto. Inicie o aplicativo e tente novamente.",
    );
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Falha ao chamar o Noctan.");
  return body;
}

function openLocalUrl(url) {
  const os = platform();
  const command =
    os === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : os === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

const server = new McpServer({ name: "noctan", version: "1.0.0" });

server.registerTool(
  "noctan_status",
  {
    description:
      "Verifica se o Noctan local está aberto e retorna o workspace configurado.",
    inputSchema: {},
  },
  async () => {
    const status = await noctan("/api/status");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            connected: true,
            workspace: status.config?.workspace || null,
            vault: status.config?.vault || null,
            apiKeyConfigured: Boolean(status.discovery?.apiKeyConfigured),
          }),
        },
      ],
    };
  },
);

server.registerTool(
  "handoff_to_noctan",
  {
    description:
      "Entrega uma tarefa ao Noctan local, abre a conversa na tela e mantém as aprovações de segurança no aplicativo.",
    inputSchema: {
      prompt: z.string().min(1).max(40000).describe("Tarefa completa para o Noctan"),
      title: z.string().max(65).optional().describe("Título curto opcional"),
    },
  },
  async ({ prompt, title }) => {
    const handoff = await noctan("/api/handoff", {
      method: "POST",
      body: JSON.stringify({ prompt, title, source: "ChatGPT/Codex MCP" }),
    });
    if (process.env.NOCTAN_NO_OPEN !== "1") openLocalUrl(handoff.url);
    return {
      content: [
        {
          type: "text",
          text: `Tarefa entregue ao Noctan e aberta na tela. Sessão: ${handoff.sessionId}`,
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());

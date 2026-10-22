import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizeExternalText } from "./external-handoff.mjs";

export function createNoctanMcpServer({
  baseUrl = "http://127.0.0.1:4177",
  fetchImpl = fetch,
  openLocalUrl = null,
} = {}) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/$/, "");

  async function noctan(path, options = {}) {
    const response = await fetchImpl(normalizedBaseUrl + path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    }).catch(() => null);
    if (!response)
      throw new Error("O Noctan não está aberto. Inicie o aplicativo e tente novamente.");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Falha ao chamar o Noctan.");
    return body;
  }

  const server = new McpServer({ name: "noctan", version: "1.0.0" });

  server.registerTool(
    "noctan_status",
    {
      description: "Verifica se o Noctan está aberto e retorna o workspace configurado.",
      inputSchema: {},
    },
    async () => {
      const status = await noctan("/api/status");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            connected: true,
            workspace: status.config?.workspace || null,
            vault: status.config?.vault || null,
            apiKeyConfigured: Boolean(status.discovery?.apiKeyConfigured),
          }),
        }],
      };
    },
  );

  server.registerTool(
    "handoff_to_noctan",
    {
      description:
        "Entrega uma tarefa completa ao Noctan. O Noctan executa com o provedor e as ferramentas locais configuradas, preservando histórico e aprovações no aplicativo.",
      inputSchema: {
        prompt: z.unknown().describe("Tarefa completa para o Noctan"),
        title: z.unknown().optional().describe("Título curto opcional"),
        requestId: z.string().optional().describe("Identificador idempotente opcional"),
      },
    },
    async ({ prompt, title, requestId }) => {
      prompt = normalizeExternalText(prompt);
      title = normalizeExternalText(title);
      if (!prompt || prompt.length > 40000) throw new Error("Tarefa vazia ou muito longa.");
      const handoff = await noctan("/api/handoff", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          title,
          requestId,
          source: "ChatGPT via Noctan Tunnel",
        }),
      });
      if (!handoff.openedInDesktop && openLocalUrl) openLocalUrl(handoff.url);
      return {
        content: [{
          type: "text",
          text: `Tarefa entregue ao Noctan. Sessão: ${handoff.sessionId}${handoff.duplicate ? " (requisição já recebida)" : ""}`,
        }],
      };
    },
  );

  return server;
}

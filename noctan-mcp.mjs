import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { normalizeExternalText } from "./external-handoff.mjs";

// Ferramentas do PC Controller expostas direto ao ChatGPT: transporte MCP puro, sem IA no meio.
export const PC_CONTROLLER_PREFIX = "pc_controller_";

/**
 * pcController (opcional): { listTools(): Promise<Tool[]>, callTool(name, args): Promise<CallToolResult> }.
 * Com ele, cada ferramenta do PC Controller aparece como `pc_controller_<nome>` com a mesma descrição e o
 * mesmo JSON Schema, e tools/call vai direto ao processo local do controlador.
 */
export function createNoctanMcpServer({
  baseUrl = "http://127.0.0.1:4177",
  fetchImpl = fetch,
  openLocalUrl = null,
  pcController = null,
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

  const native = {
    noctan_status: {
      tool: {
        name: "noctan_status",
        description: "Verifica se o Noctan está aberto e retorna o workspace configurado.",
        inputSchema: { type: "object", properties: {} },
      },
      async run() {
        const status = await noctan("/api/status");
        return JSON.stringify({
          connected: true,
          workspace: status.config?.workspace || null,
          vault: status.config?.vault || null,
          apiKeyConfigured: Boolean(status.discovery?.apiKeyConfigured),
        });
      },
    },
    handoff_to_noctan: {
      tool: {
        name: "handoff_to_noctan",
        description:
          "Entrega uma tarefa completa ao Noctan. O Noctan executa com o provedor de IA e as ferramentas locais configuradas, preservando histórico e aprovações no aplicativo. Consome a API de IA do usuário: use só quando ele pedir explicitamente para delegar ao Noctan; para ler, escrever ou rodar comandos no PC, use as ferramentas pc_controller_*.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { description: "Tarefa completa para o Noctan" },
            title: { description: "Título curto opcional" },
            requestId: { type: "string", description: "Identificador idempotente opcional" },
          },
          required: ["prompt"],
        },
      },
      async run({ prompt, title, requestId }) {
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
        return `Tarefa entregue ao Noctan. Sessão: ${handoff.sessionId}${handoff.duplicate ? " (requisição já recebida)" : ""}`;
      },
    },
  };

  const server = new Server({ name: "noctan", version: "1.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = Object.values(native).map((entry) => entry.tool);
    if (pcController) {
      for (const tool of await pcController.listTools())
        tools.push({ ...tool, name: PC_CONTROLLER_PREFIX + tool.name });
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const { name, arguments: args = {} } = params;
    if (native[name]) {
      try {
        return { content: [{ type: "text", text: await native[name].run(args) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
    }
    if (pcController && name.startsWith(PC_CONTROLLER_PREFIX))
      return pcController.callTool(name.slice(PC_CONTROLLER_PREFIX.length), args);
    throw new McpError(ErrorCode.InvalidParams, `Ferramenta não encontrada: ${name}`);
  });

  return server;
}

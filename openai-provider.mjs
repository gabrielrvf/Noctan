import OpenAI from "openai";
import { connectMcpTools } from "./mcp-client.mjs";

export async function runOpenAI({
  apiKey,
  model,
  effort,
  prompt,
  attachments = [],
  previousResponseId,
  instructions,
  mcpConfigPaths = [],
  signal,
  allowTools = true,
  approve,
  onTool,
}) {
  const client = new OpenAI({ apiKey });
  const mcp = allowTools
    ? await connectMcpTools(mcpConfigPaths)
    : { tools: [], call: async () => "", close: async () => {} };
  const tools = allowTools
    ? [{ type: "web_search" }, ...mcp.tools]
    : [];
  const content = [{ type: "input_text", text: prompt }];
  for (const item of attachments) {
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(item.dataUrl || ""))
      content.push({ type: "input_image", image_url: item.dataUrl, detail: "auto" });
  }

  let response;
  let input = [{ role: "user", content }];
  try {
    for (let turn = 0; turn < 20; turn += 1) {
      response = await client.responses.create(
        {
          model: model || "gpt-5.4",
          reasoning: { effort: effort || "medium" },
          instructions,
          input,
          tools,
          previous_response_id: turn === 0 ? previousResponseId : response?.id,
          store: true,
        },
        { signal },
      );
      const calls = (response.output || []).filter(
        (item) => item.type === "function_call",
      );
      if (!calls.length)
        return {
          text: response.output_text || "(Sem resposta textual)",
          responseId: response.id,
          usage: response.usage || null,
        };

      input = [];
      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {}
        onTool?.(call.name, args);
        const allowed = await approve(call.name, args);
        let output = "Negado pelo usuário.";
        if (allowed) {
          try {
            output = await mcp.call(call.name, args);
          } catch (error) {
            output = `Erro da ferramenta: ${error.message}`;
          }
        }
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output,
        });
      }
    }
    throw Error("A execução atingiu o limite de 20 rodadas de ferramentas.");
  } finally {
    await mcp.close();
  }
}

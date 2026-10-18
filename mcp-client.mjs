import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const safeName = (value) =>
  String(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

export async function connectMcpTools(configPaths = []) {
  const definitions = {};
  for (const path of configPaths) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      Object.assign(definitions, parsed.mcpServers || {});
    } catch {}
  }

  const clients = [];
  const tools = [];
  const calls = new Map();
  for (const [serverName, definition] of Object.entries(definitions)) {
    try {
      const client = new Client(
        { name: "noctan", version: "1.0.0" },
        { capabilities: {} },
      );
      const transport = definition.url
        ? new StreamableHTTPClientTransport(new URL(definition.url), {
            requestInit: definition.headers
              ? { headers: definition.headers }
              : undefined,
          })
        : new StdioClientTransport({
            command: definition.command,
            args: definition.args || [],
            env: { ...process.env, ...(definition.env || {}) },
            cwd: definition.cwd,
            stderr: "pipe",
          });
      await client.connect(transport);
      clients.push(client);
      const listed = await client.listTools();
      for (const tool of listed.tools || []) {
        const name = safeName(`${serverName}__${tool.name}`);
        tools.push({
          type: "function",
          name,
          description: `[${serverName}] ${tool.description || tool.name}`.slice(
            0,
            1024,
          ),
          parameters: tool.inputSchema || { type: "object", properties: {} },
          strict: false,
        });
        calls.set(name, { client, originalName: tool.name, serverName });
      }
    } catch {}
  }

  return {
    tools,
    async call(name, args) {
      const target = calls.get(name);
      if (!target) throw Error(`Ferramenta MCP não encontrada: ${name}`);
      const result = await target.client.callTool({
        name: target.originalName,
        arguments: args || {},
      });
      return JSON.stringify(result.content || result, null, 2).slice(0, 100000);
    },
    async close() {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}

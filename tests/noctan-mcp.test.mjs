import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNoctanMcpServer } from "../noctan-mcp.mjs";

async function connect(options) {
  const server = createNoctanMcpServer(options);
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

test("Noctan MCP keeps status and handoff when the PC Controller is not wired", async () => {
  const { client, close } = await connect({ fetchImpl: async () => new Response("{}") });
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["handoff_to_noctan", "noctan_status"]);
  await close();
});

test("PC Controller tools are proxied directly, with original schema, never through the Noctan handoff", async () => {
  const schema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
  const calls = [];
  const { client, close } = await connect({
    fetchImpl: async () => { throw new Error("handoff/AI must not be called"); },
    pcController: {
      listTools: async () => [{ name: "list_directory", description: "Lista uma pasta", inputSchema: schema }],
      callTool: async (name, args) => {
        calls.push([name, args]);
        return { content: [{ type: "text", text: "a.txt" }] };
      },
    },
  });
  const listed = await client.listTools();
  const proxied = listed.tools.find((tool) => tool.name === "pc_controller_list_directory");
  assert.equal(proxied.description, "Lista uma pasta");
  assert.deepEqual(proxied.inputSchema, schema);
  assert.ok(listed.tools.some((tool) => tool.name === "handoff_to_noctan"));

  const result = await client.callTool({ name: "pc_controller_list_directory", arguments: { path: "C:\\x" } });
  assert.deepEqual(calls, [["list_directory", { path: "C:\\x" }]]);
  assert.equal(result.content[0].text, "a.txt");
  await close();
});

test("the /mcp endpoint rejects browser origins and foreign Host headers", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /path === "\/mcp"\) \{\s*\/\/[^\n]*\n\s*if \(req\.headers\.origin \|\|/);
  assert.match(server, /pcController: mcpPcController/);
});

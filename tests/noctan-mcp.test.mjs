import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNoctanMcpServer } from "../noctan-mcp.mjs";

test("Noctan MCP exposes status and handoff instead of running the old controller in ChatGPT", async () => {
  const server = createNoctanMcpServer({ fetchImpl: async () => new Response("{}") });
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["handoff_to_noctan", "noctan_status"]);
  await Promise.all([client.close(), server.close()]);
});

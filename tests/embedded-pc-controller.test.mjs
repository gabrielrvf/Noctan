import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  embeddedPcControllerDefinition,
  embeddedPcControllerEntry,
  withEmbeddedPcController,
} from "../embedded-pc-controller.mjs";

test("Noctan ships a runnable PC Controller entrypoint", () => {
  assert.ok(existsSync(embeddedPcControllerEntry()));
  const definition = embeddedPcControllerDefinition();
  assert.equal(definition.command, process.execPath);
  assert.deepEqual(definition.args, [embeddedPcControllerEntry()]);
  assert.equal(definition.env.NOCTAN_EMBEDDED_PC_CONTROLLER, "1");
});

test("embedded PC Controller replaces stale external definitions", () => {
  const merged = withEmbeddedPcController({
    github: { url: "https://example.test/mcp" },
    "pc-controller": { command: "C:/missing/node.exe" },
  });
  assert.equal(merged.github.url, "https://example.test/mcp");
  assert.equal(merged["pc-controller"].command, process.execPath);
});

test("both OpenAI and Claude receive the embedded PC Controller", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /mcpServers:\s*\{\s*"pc-controller": embeddedPcControllerDefinition\(\)\s*\}/);
  assert.match(server, /opts\.mcpServers = await runtimeMcpServers\(\)/);
});

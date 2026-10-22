import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handoffFingerprint, normalizeExternalText } from "../external-handoff.mjs";

test("external structured prompts never render as object Object", () => {
  assert.equal(normalizeExternalText({ content: [{ text: "Build e QA" }] }), "Build e QA");
  assert.equal(normalizeExternalText({ task: "Execute os testes" }), "Execute os testes");
});

test("equivalent handoffs have the same idempotency fingerprint", () => {
  const first = handoffFingerprint({ prompt: "Teste", title: "QA", source: "MCP" });
  const second = handoffFingerprint({ prompt: { text: "Teste" }, title: "QA", source: "mcp" });
  assert.equal(first, second);
});

test("desktop handoff avoids browser fallback and claims pending prompt once", () => {
  const bridge = readFileSync(new URL("../bridge.mjs", import.meta.url), "utf8");
  const noctanMcp = readFileSync(new URL("../noctan-mcp.mjs", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(bridge, /createNoctanMcpServer/);
  assert.match(noctanMcp, /!handoff\.openedInDesktop/);
  assert.match(server, /claim-pending/);
  assert.match(app, /\/claim-pending/);
  assert.match(app, /noctanDesktop\?\.onHandoff/);
});

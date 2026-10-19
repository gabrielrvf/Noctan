import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server=readFileSync(new URL("../server.mjs",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");

test("subagent SDK messages are isolated from the main conversation and persisted",()=>{
  assert.match(server,/m\.type === "assistant" && m\.agent_id/);
  assert.match(server,/m\.type === "assistant" && !m\.agent_id/);
  assert.match(server,/m\.subtype === "task_started"/);
  assert.match(server,/m\.subtype === "task_updated"/);
  assert.match(server,/sessionAgentsView\(s\)/);
});
test("desktop exposes an agents panel with live events",()=>{
  assert.match(html,/id="agentsBtn"/);
  assert.match(html,/id="agentsPanel"/);
  assert.match(app,/function renderAgents\(/);
  assert.match(app,/function renderAgentDetail\(/);
  assert.match(app,/if \(type === "agent"\)/);
});

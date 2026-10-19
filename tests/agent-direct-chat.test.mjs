import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const server = read("server.mjs");
const app = read("public/app.js");
const html = read("public/index.html");
const css = read("public/style.css");
const mobile = read("mobile/android/app/src/main/assets/index.html");
const gateway = read("mobile-gateway.mjs");

test("live subagents accept direct user messages through their own route", () => {
  assert.match(server, /async function pushAgentFollowUp\(sessionId, agentId, prompt\)/);
  assert.match(server, /addSessionAgentEvent\(agent, "user", text, \{ source: "user" \}\)/);
  assert.match(server, /\/\^\\\/api\\\/sessions\\\/\(\[\^\/\]\+\)\\\/agents\\\/\(\[\^\/\]\+\)\\\/messages\$\//);
  assert.match(server, /await pushAgentFollowUp\(/);
  assert.match(server, /running\.query\.streamInput\(one\(\)\)/);
});

test("agent-targeted runs stay out of the main chat and resume as agent runs", () => {
  assert.match(server, /let agentTargetId = typeof body\.agentTargetId === "string"/);
  assert.match(server, /resumeInterrupted && s\.inFlight\?\.kind === "agent"/);
  assert.match(server, /kind: agentTargetId \? "agent" : "main"/);
  assert.match(server, /agentId: agentTargetId \|\| null/);
  assert.match(server, /if \(!replayingEdit && !resumeInterrupted && !agentTargetId\) s\.messages\.push/);
  assert.match(server, /if \(agentTargetId\) return;/);
  assert.match(server, /m\.type === "assistant" && !m\.agent_id && !agentTargetId/);
  assert.match(server, /else if \(block\.type === "thinking"\) addSessionAgentEvent\(agent, "thinking"/);
});

test("subagent conversations are backfilled from the Claude transcript", () => {
  for (const name of ["textBlocks", "claudeTranscriptFor", "parseJsonLines", "agentDefinitionsFromMain", "backfillSessionAgents"])
    assert.match(server, new RegExp(`function ${name}\\(`));
  assert.match(server, /capturedLive: true/);
  assert.match(server, /if \(session\.agents\?\.\[id\]\?\.capturedLive\) continue;/);
  assert.match(server, /sessionGetMatch[\s\S]{0,200}backfillSessionAgents\(session\)/);
});

test("interrupted runs are resumed once per boot and never after a billing error", () => {
  assert.match(server, /const BOOT_ID = randomUUID\(\);/);
  assert.match(server, /const bootRecoveryClaims = new Set\(\);/);
  assert.match(server, /bootId: BOOT_ID/);
  assert.match(server, /claim-boot-recovery/);
  assert.match(server, /async function recoverInterruptedSessionsForThisBoot\(\)/);
  assert.match(server, /server\.listen\(PORT, HOST, \(\) => \{[\s\S]{0,200}recoverInterruptedSessionsForThisBoot\(\)/);
  assert.match(server, /function bootRecoveryEligible\(session\)[\s\S]{0,250}!lastRunEndedWithBillingError\(session\)/);
  assert.match(app, /claim-boot-recovery/);
  assert.match(app, /if \(!claim\.claimed\)/);
  assert.match(app, /recoverInterruptedSessionsAtBoot\(\);/);
  assert.match(app, /state\.bootId = d\.bootId/);
});

test("billing/credit failures block automatic resume", () => {
  const pattern = server.match(/const BILLING_ERROR_PATTERN = (\/.+\/i);/)[1];
  const source = server.match(/function lastRunEndedWithBillingError\(session\) \{[\s\S]*?\n\}/)[0];
  const lastRunEndedWithBillingError = new Function(`const BILLING_ERROR_PATTERN = ${pattern}; return (${source});`)();
  const user = { role: "user", text: "faça" };
  assert.equal(lastRunEndedWithBillingError({ messages: [user, { role: "system", text: "Erro: Credit balance is too low" }] }), true);
  assert.equal(lastRunEndedWithBillingError({ messages: [user, { role: "system", text: "You have reached your usage limits" }, { role: "assistant", text: "" }] }), true);
  assert.equal(lastRunEndedWithBillingError({ messages: [{ role: "system", text: "Credit balance is too low" }, user] }), false);
  assert.equal(lastRunEndedWithBillingError({ messages: [user, { role: "system", text: "Erro: rede caiu" }] }), false);
  assert.equal(lastRunEndedWithBillingError({}), false);
});

test("desktop agents panel has a composer and resizable columns", () => {
  assert.match(app, /async function sendAgentMessage\(agentId, prompt\)/);
  assert.match(app, /agentTargetId: agentId/);
  assert.match(app, /\/agents\/\$\{encodeURIComponent\(agentId\)\}\/messages/);
  assert.match(app, /composer\.className="agentComposer"/);
  assert.match(app, /function installHorizontalResize\(/);
  assert.match(html, /id="agentsResize"/);
  assert.match(html, /id="agentListResize"/);
  assert.match(css, /\.agentsResize\{/);
  assert.match(css, /\.agentListResize\{/);
  assert.match(css, /\.agentComposer\{/);
});

test("Android mirrors the agent direct chat through the authenticated gateway", () => {
  assert.match(mobile, /async function sendAgentMessage\(agentId,prompt\)/);
  assert.match(mobile, /agentTargetId:agentId/);
  assert.match(mobile, /"\/agents\/"\+encodeURIComponent\(agentId\)\+"\/messages"/);
  assert.match(mobile, /composer\.className="agentComposer"/);
  assert.match(gateway, /agents\\\/\[\^\/\]\+\\\/messages\$\/\.test\(path\)/);
});

test("boot recovery skips runs interrupted long ago", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /BOOT_RECOVERY_MAX_AGE_MS/);
  assert.match(source, /inFlightIsRecent\(session\) && !active\.has/);
});

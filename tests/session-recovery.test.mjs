import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

test("stale Claude resume is discarded and retried once from saved history", () => {
  assert.match(server, /isMissingClaudeSessionError/);
  assert.match(server, /retriedMissingSession/);
  assert.match(server, /delete s\.claudeSessionId/);
  assert.match(server, /delete opts\.resume/);
  assert.match(server, /historyBeforeCurrent/);
  assert.match(server, /contexto salvo foi restaurado automaticamente/);
});

test("session writes use unique temporary files and retry transient Windows locks", () => {
  assert.match(server, /\.tmp-"\+randomUUID\(\)/);
  assert.match(server, /replaceWithRetry/);
  assert.match(server, /"EPERM", "EBUSY", "EACCES"/);
  assert.match(server, /fs\.copyFile\(tmp, path\)/);
  assert.doesNotMatch(server, /fs\.rename\(tmp, SESSIONS\)/);
});

test("a lock left by a killed process (app update) is reclaimed", () => {
  assert.match(server, /takeSessionsLock/);
  assert.match(server, /age > 30000/);
});

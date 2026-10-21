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

test("deleted conversations are tombstoned and legacy migration cannot resurrect them", () => {
  assert.match(server, /const DELETED_SESSIONS = join\(DATA, "deleted-sessions\.json"\)/);
  assert.match(server, /deletedSessions\[id\] = new Date\(\)\.toISOString\(\)/);
  assert.match(server, /if \(deletedSessions\[id\]\) \{\s*delete merged\[id\]/);
  assert.match(server, /if \(existsSync\(SESSIONS\)\) return/);
  assert.match(server, /if \(deletedSessions\[id\]\) continue/);
});

test("history merge keeps the most complete snapshot and never drops distinct messages", async () => {
  const start = server.indexOf("function normalizedMessageText");
  const end = server.indexOf("function mergeSessions(");
  assert.ok(start > 0 && end > start);
  const isNoisyAgentCrashMessage = () => false;
  const mergeMessageLists = new Function("isNoisyAgentCrashMessage", server.slice(start, end) + "; return mergeMessageLists;")(isNoisyAgentCrashMessage);
  const at = "2026-10-19T16:27:56.828Z";
  const disk = [{ role: "assistant", at, text: "Vou fazer" }];
  const memory = [{ role: "assistant", at, text: "Vou fazer em duas frentes. Pronto." }];
  assert.deepEqual(mergeMessageLists(memory, disk).map((m) => m.text), ["Vou fazer em duas frentes. Pronto."]);
  assert.deepEqual(mergeMessageLists(disk, memory).map((m) => m.text), ["Vou fazer em duas frentes. Pronto."]);
  const distinct = mergeMessageLists([{ role: "assistant", at, text: "A" }], [{ role: "assistant", at, text: "B" }]);
  assert.equal(distinct.length, 2);
  const users = mergeMessageLists([{ role: "user", at, text: "oi" }], [{ role: "user", at, text: "oi" }]);
  assert.equal(users.length, 1);
});

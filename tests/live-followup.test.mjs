import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('active Claude session accepts additive live steering', () => {
  assert.match(server, /path === "\/api\/follow-up"/);
  assert.match(server, /streamInput\(one\(\)\)/);
  assert.match(server, /priority: "now"/);
  assert.match(server, /origin: \{ kind: "human" \}/);
  assert.match(server, /Continue todas as tarefas e raciocínios já em andamento/);
  assert.match(app, /if \(state\.running && state\.current\)/);
  assert.match(app, /request\("\/api\/follow-up"/);
});

test('live follow-up stays after current assistant response and before progress', () => {
  assert.doesNotMatch(app, /activeAssistantBubble/);
  assert.match(app, /message\("user", prompt\);\n    keepProgressLast\(\);/);
  assert.match(server, /session\.messages\.push\(item\); session\.updatedAt = item\.at/);
});

test('editing a user message branches and rebuilds context', () => {
  assert.match(server, /editSessionUserMessage/);
  assert.match(server, /session\.messages = session\.messages\.slice\(0, index \+ 1\)/);
  assert.match(server, /delete session\.claudeSessionId/);
  assert.match(server, /Contexto reconstruído da conversa antes desta mensagem/);
  assert.match(app, /editReplayIndex/);
});

test('unexpected exit is checkpointed and resumed without duplicating the user prompt', () => {
  assert.match(server, /s\.inFlight = \{/);
  assert.match(server, /lastCheckpointAt/);
  assert.match(server, /if \(!replayingEdit && !resumeInterrupted\) s\.messages\.push/);
  assert.match(server, /opts\.resume = s\.claudeSessionId/);
  assert.match(server, /Não repita ações, comandos, alterações, commits, deploys/);
  assert.match(server, /delete s\.inFlight/);
  assert.match(app, /resumeInterruptedRun/);
  assert.match(app, /session\?\.inFlight/);
  assert.match(app, /interrupted\?\.id \|\| latest\?\.id/);
  assert.match(app, /resumeInterrupted,/);
});

test('model changes create a persisted chat notice', () => {
  assert.match(server, /appendSessionNotice/);
  assert.match(app, /Modelo alterado para/);
  assert.match(app, /kind: "model-change"/);
});

test('speech recognizer is prewarmed before first dictation', () => {
  assert.match(app, /function prewarmStt/);
  assert.match(app, /takeWarmSttSocket/);
});

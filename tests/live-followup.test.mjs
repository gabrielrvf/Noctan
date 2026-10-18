import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('active Claude session accepts live follow-up without cancelling current task',()=>{
 assert.match(server,/path === "\/api\/follow-up"/);
 assert.match(server,/streamInput\(one\(\)\)/);
 assert.match(server,/priority: "now"/);
 assert.match(server,/origin: \{ kind: "human" \}/);
 assert.match(server,/Continue todas as tarefas e raciocínios já em andamento/);
 assert.match(app,/if \(state\.running && state\.current\)/);
 assert.match(app,/request\("\/api\/follow-up"/);
 assert.match(app,/\$\("send"\)\.disabled=false/);
});

test('editing a user message branches and rebuilds context',()=>{
 assert.match(server,/editSessionUserMessage/);
 assert.match(server,/session\.messages = session\.messages\.slice\(0, index \+ 1\)/);
 assert.match(server,/delete session\.claudeSessionId/);
 assert.match(server,/Contexto reconstruído da conversa antes desta mensagem/);
 assert.match(app,/editReplayIndex/);
 assert.match(app,/Editar mensagem/);
});

test('model changes create a persisted chat notice',()=>{
 assert.match(server,/appendSessionNotice/);
 assert.match(app,/Modelo alterado para/);
 assert.match(app,/kind: "model-change"/);
});

test('speech recognizer is prewarmed before first dictation',()=>{
 assert.match(app,/function prewarmStt/);
 assert.match(app,/setTimeout\(\(\) => prewarmStt\(\)/);
 assert.match(app,/takeWarmSttSocket/);
});

test('active assistant bubble moves below live follow-ups',()=>{
 assert.match(app,/activeAssistantBubble/);
 assert.match(app,/append\(activeAssistantBubble\)/);
 assert.match(server,/assistantRecordRef/);
});

test('active assistant response moves below follow-ups and keeps streaming',()=>{
 assert.match(app,/activeAssistantBubble/);
 assert.match(app,/append\(activeAssistantBubble\)/);
 assert.match(server,/assistantRecordRef/);
 assert.doesNotMatch(server,/newAssistantSegment/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('approval UI exposes session-scoped allow all', () => {
  assert.match(app, /\["Permitir tudo", true, true\]/);
  assert.match(app, /JSON\.stringify\(\{ id, allow, allowAll \}\)/);
});

test('allow all auto-approves future tools only for the active run', () => {
  assert.match(server, /autoApproveAll: false/);
  assert.match(server, /active\.get\(id\)\?\.autoApproveAll/);
  assert.match(server, /return \{ behavior: "allow", updatedInput: input \}/);
  assert.match(server, /run\.autoApproveAll = true/);
  assert.match(server, /pending\.sessionId === a\.sessionId/);
  assert.match(server, /active\.delete\(id\)/);
});

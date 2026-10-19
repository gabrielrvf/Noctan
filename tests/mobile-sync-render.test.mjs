import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../mobile/android/app/src/main/assets/index.html', import.meta.url), 'utf8');

test('mobile uses lightweight session summaries then fetches one full session', () => {
  assert.match(server, /path === "\/api\/sessions-summary"/);
  assert.match(mobile, /api\("\/api\/sessions-summary"\)/);
  assert.match(mobile, /api\("\/api\/sessions\/"\+encodeURIComponent\(state\.current\)\)/);
});

test('mobile assistant messages render markdown like desktop', () => {
  assert.match(mobile, /function renderMarkdown\(/);
  assert.match(mobile, /function inlineMarkdown\(/);
  assert.match(mobile, /<pre><code>/);
  assert.match(mobile, /renderMarkdown\(state\.assistant,state\.assistant\.rawText\)/);
  assert.match(mobile, /\.msg\.assistant code/);
});

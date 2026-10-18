import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gateway = readFileSync(new URL('../mobile-gateway.mjs', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../desktop.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const gradle = readFileSync(new URL('../mobile/android/app/build.gradle', import.meta.url), 'utf8');
const html = readFileSync(new URL('../mobile/android/app/src/main/assets/index.html', import.meta.url), 'utf8');
const java = readFileSync(new URL('../mobile/android/app/src/main/java/app/noctan/mobile/MainActivity.java', import.meta.url), 'utf8');

test('desktop starts authenticated mobile gateway without exposing core API port', () => {
  assert.match(desktop, /mobile-gateway\.mjs/);
  assert.ok(pkg.build.files.includes('mobile-gateway.mjs'));
  assert.match(gateway, /HOST = "0\.0\.0\.0"/);
  assert.match(gateway, /authorization/);
  assert.match(gateway, /Bearer /);
  assert.match(gateway, /127\.0\.0\.1/);
  assert.match(gateway, /controle movel/);
});

test('mobile source contains no committed pairing token', () => {
  assert.match(gradle, /NOCTAN_MOBILE_TOKEN/);
  assert.match(java, /getDefaultToken\(\)/);
  assert.match(html, /getDefaultToken/);
  assert.doesNotMatch(html, /DkztzCP0c_/);
});

test('mobile client supports live chat, attachments, voice, approvals and stop', () => {
  assert.match(html, /\/api\/follow-up/);
  assert.match(html, /\/api\/run/);
  assert.match(html, /\/api\/approve/);
  assert.match(html, /\/api\/cancel/);
  assert.match(html, /startVoice/);
  assert.match(html, /fileInput/);
  assert.match(html, /Permitir tudo/);
  assert.match(html, /previewDialog/);
});

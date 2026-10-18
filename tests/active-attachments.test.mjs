import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('active run accepts image-only and text-plus-image follow-ups', () => {
  assert.match(server, /saveImageAttachments\(body\.attachments\)/);
  assert.match(server, /text \|\| "Imagem anexada"/);
  assert.match(server, /Imagens anexadas pelo usuário agora/);
  assert.match(server, /priority: "now"/);
  assert.match(app, /const attachments = \[\.\.\.state\.attachments\]/);
  assert.match(app, /JSON\.stringify\(\{ sessionId: state\.current, prompt, attachments \}\)/);
  assert.match(app, /prompt \|\| "Imagem anexada"/);
  assert.doesNotMatch(app, /Imagens serão enviadas quando a execução atual terminar/);
  assert.doesNotMatch(app, /Envie texto no follow-up enquanto a execução está ativa/);
});

test('pending attachment thumbnail opens a large preview', () => {
  assert.match(app, /function openAttachmentPreview\(item\)/);
  assert.match(app, /dialog\.showModal\(\)/);
  assert.match(app, /image\.onclick = \(\) => openAttachmentPreview\(item\)/);
  assert.match(app, /image\.onkeydown/);
  assert.match(css, /\.attachmentPreviewDialog/);
  assert.match(css, /cursor:zoom-in/);
});

test('mic control uses one aligned height and centered contents', () => {
  assert.match(css, /\.micControl \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*height: 30px;/);
  assert.match(css, /\.micArrow \{[\s\S]*align-items: center;[\s\S]*padding: 0;/);
});

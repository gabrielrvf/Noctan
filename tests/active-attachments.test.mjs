import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

test("active run accepts file-only and text-plus-file follow-ups", () => {
  assert.match(server, /saveAttachments\(body\.attachments\)/);
  assert.match(server, /savedAttachments\.length/);
  assert.match(server, /priority: "now"/);
  assert.match(app, /const attachments = \[\.\.\.state\.attachments\]/);
  assert.match(app, /JSON\.stringify\(\{ sessionId: targetSessionId, prompt, attachments \}\)/);
  assert.match(app, /prompt \|\| "Arquivo anexado"/);
});

test("pending attachment thumbnail opens a large preview", () => {
  assert.match(app, /function openAttachmentPreview\(item\)/);
  assert.match(app, /dialog\.showModal\(\)/);
  assert.match(app, /openAttachmentPreview\(item\)/);
  assert.match(css, /\.attachmentPreviewDialog/);
  assert.match(css, /cursor:zoom-in/);
  assert.match(app, /attachmentPreviewControls/);
  assert.match(app, /event\.deltaY<0/);
});

test("mic control uses one aligned height and centered contents", () => {
  assert.match(css, /\.micControl \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*height: 30px;/);
  assert.match(css, /\.micArrow \{[\s\S]*align-items: center;[\s\S]*padding: 0;/);
});

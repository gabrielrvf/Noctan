import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.mjs",import.meta.url),"utf8");
test("sent images leave composer and remain as thumbnails",()=>{
  assert.match(app,/messageAttachmentGallery/);
  assert.match(app,/message\("user", prompt \|\| "Arquivo anexado", attachments\)/);
  assert.match(app,/state\.attachments = \[\];\s*renderAttachments\(\)/);
});
test("saved attachments have a safe image endpoint",()=>{
  assert.match(server,/path\.startsWith\("\/api\/attachments\/"\)/);
  assert.match(server,/join\(ATTACHMENTS, name\)/);
});

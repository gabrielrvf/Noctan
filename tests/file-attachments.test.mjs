import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("desktop accepts arbitrary files and renders non-image attachments", async () => {
  const [html, app, server] = await Promise.all([
    readFile(new URL("public/index.html", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
    readFile(new URL("server.mjs", root), "utf8"),
  ]);
  assert.match(html, /id="imageInput" type="file" multiple/);
  assert.doesNotMatch(html, /id="imageInput"[^>]+accept="image\//);
  assert.match(app, /async function addFiles\(files\)/);
  assert.match(app, /file\.size > 20_000_000/);
  assert.match(app, /messageFileAttachment/);
  assert.match(server, /async function saveAttachments\(items\)/);
  assert.match(server, /application\/pdf/);
  assert.doesNotMatch(server, /Formato de imagem não permitido/);
});

test("Android picker and chat accept arbitrary file types", async () => {
  const [mobile, activity] = await Promise.all([
    readFile(new URL("mobile/android/app/src/main/assets/index.html", root), "utf8"),
    readFile(new URL("mobile/android/app/src/main/java/app/noctan/mobile/MainActivity.java", root), "utf8"),
  ]);
  assert.match(activity, /intent\.setType\("\*\/\*"\)/);
  assert.doesNotMatch(activity, /EXTRA_MIME_TYPES/);
  assert.match(mobile, /className="messageFile"/);
  assert.match(mobile, /20 MB/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("a new chat adopts the session id from the start event instead of opening another chat", async () => {
  const app = await read("public/app.js");
  assert.match(app, /const sendViewEpoch = viewEpoch;/);
  assert.match(app, /if \(!previousStreamSessionId && !state\.current && viewEpoch === sendViewEpoch\) \{\s*state\.current = streamSessionId;/);
});

test("unsent prompt text is kept per conversation", async () => {
  const app = await read("public/app.js");
  assert.match(app, /localStorage\.getItem\("noctan\.drafts"\)/);
  assert.match(app, /async function loadSession\(id\) \{\s*if \(state\.running && state\.current === id\) return;\s*saveDraft\(\);/);
  assert.match(app, /function newSession\(\) \{\s*saveDraft\(\);/);
  assert.match(app, /restoreDraft\(id\);/);
  assert.match(app, /restoreDraft\("new"\);/);
});

test("AskUserQuestion becomes a clickable question that answers the agent", async () => {
  const [server, app, desktop, preload] = await Promise.all([read("server.mjs"), read("public/app.js"), read("desktop.mjs"), read("preload.cjs")]);
  assert.match(server, /toolName === "AskUserQuestion"/);
  assert.match(server, /send\(res, "question", \{ id: qid, questions:/);
  assert.match(server, /updatedInput: \{ \.\.\.input, answers \}/);
  assert.match(server, /a\.decide\(b\.allow === true, b\.answers\)/);
  assert.match(app, /type === "question"/);
  assert.match(app, /function askQuestion\(q\)/);
  assert.match(app, /noctanDesktop\?\.notify\?\.\("Noctan está fazendo uma pergunta"/);
  assert.match(preload, /notify: \(title, body\) => ipcRenderer\.send\("desktop:notify"/);
  assert.match(desktop, /ipcMain\.on\("desktop:notify"/);
});

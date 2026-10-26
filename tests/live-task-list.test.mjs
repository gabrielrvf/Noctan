import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Claude task tools are persisted and streamed as a live checklist", async () => {
  const [server, app, css, mobile] = await Promise.all([
    readFile(new URL("server.mjs", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
    readFile(new URL("public/style.css", root), "utf8"),
    readFile(new URL("mobile/android/app/src/main/assets/index.html", root), "utf8"),
  ]);
  assert.match(server, /function updateSessionTaskList/);
  assert.match(server, /send\(res, "tasks", \{ tasks: taskList \}\)/);
  assert.match(server, /TodoWrite or TaskCreate\/TaskUpdate/);
  assert.match(app, /function renderProgressTasks\(tasks\)/);
  assert.match(app, /function pollLiveSnapshot\(id, signal\)/);
  assert.match(app, /type === "tasks"/);
  assert.match(css, /\.agentTaskList/);
  assert.match(css, /\.agentTask\.active/);
  assert.match(mobile, /function renderTaskList\(tasks\)/);
  assert.match(mobile, /event==="tasks"/);
});

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

test("code blocks get a copy button that writes to the clipboard", async () => {
  const [app, css, desktop] = await Promise.all([read("public/app.js"), read("public/style.css"), read("desktop.mjs")]);
  assert.match(app, /class="codeCopy" title="Copiar" aria-label="Copiar"><svg[\s\S]*?<\/svg><\/button><pre><code>/);
  assert.match(css, /\.codeCopy\.copied::before \{\s*content: "Copiado";/);
  assert.match(app, /navigator\.clipboard\.writeText\(button\.nextElementSibling\.textContent\)/);
  assert.doesNotMatch(app, /html \+= `<pre><code>/);
  assert.match(css, /\.codeCopy \{/);
  assert.match(desktop, /permission === "clipboard-sanitized-write"/);
});

test("background shell tasks do not become agents and finished agents stop the purple badge", async () => {
  const [server, app, css, html] = await Promise.all([read("server.mjs"), read("public/app.js"), read("public/style.css"), read("public/index.html")]);
  assert.match(server, /else if \(!isAgentTask\(s, m\)\) \{/);
  assert.match(server, /Object\.values\(s\.agents \|\| \{\}\)\.filter\(isRealAgent\)/);
  assert.match(server, /m\.subtype === "task_notification" && s\.agents\?\.\[m\.task_id\]/);
  assert.match(app, /classList\.toggle\("running", state\.agents\.some/);
  assert.match(css, /\.agentsButton\.running\{/);
  assert.doesNotMatch(html, /assistente local/);
});

test("Android APK checks the latest GitHub release and opens the system installer", async () => {
  const [activity, manifest] = await Promise.all([
    read("mobile/android/app/src/main/java/app/noctan/mobile/MainActivity.java"),
    read("mobile/android/app/src/main/AndroidManifest.xml"),
  ]);
  assert.match(activity, /api\.github\.com\/repos\/yanoliveira16\/Noctan\/releases\/latest/);
  assert.match(activity, /isNewerVersion\(version, BuildConfig\.VERSION_NAME\)/);
  assert.match(activity, /PackageInstaller\.STATUS_PENDING_USER_ACTION/);
  assert.doesNotMatch(activity, /\.transferTo\(|\.readAllBytes\(/);
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android:launchMode="singleTop"/);
});

test("Android keeps the working pairing and shows its version", async () => {
  const [mobile, activity] = await Promise.all([
    read("mobile/android/app/src/main/assets/index.html"),
    read("mobile/android/app/src/main/java/app/noctan/mobile/MainActivity.java"),
  ]);
  assert.match(mobile, /await refreshStatus\(\);rememberConnection\(\);await loadSessions\(false\)/);
  assert.match(mobile, /await refreshStatus\(\);rememberConnection\(\);await loadSessions\(true\)/);
  assert.match(mobile, /\$\("appVersion"\)\.textContent="v"\+window\.NoctanNative\.getVersion\(\)/);
  assert.match(activity, /public String getVersion\(\) \{ return BuildConfig\.VERSION_NAME; \}/);
});

test("phone loads PC image attachments with the pairing token and stops re-rendering every second", async () => {
  const [mobile, gateway] = await Promise.all([read("mobile/android/app/src/main/assets/index.html"), read("mobile-gateway.mjs")]);
  assert.match(gateway, /\/\^\\\/api\\\/attachments\\\/\[\^\/\]\+\$\/\.test\(path\)/);
  assert.match(mobile, /function setImageSource\(img,src\)/);
  assert.match(mobile, /fetch\(src,\{headers:authHeaders\(\)\}\)/);
  assert.match(mobile, /if\(sig!==state\.renderSig\|\|\$\("chat"\)\.childElementCount===0\)\{state\.renderSig=sig;renderSession\(s\)\}/);
});

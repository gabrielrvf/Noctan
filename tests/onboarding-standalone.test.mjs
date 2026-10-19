import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop onboarding exposes the OpenAI inference key separately from the optional tunnel key", () => {
  const html = read("public/index.html");
  const app = read("public/app.js");
  assert.match(html, /id="openaiApiKey"/);
  assert.match(html, /id="tunnelRuntimeKey"/);
  assert.match(html, /id="defaultProvider"/);
  assert.match(app, /provider:\s*"openai"/);
  assert.match(app, /state\.config\.provider === "openai"/);
});

test("agents drawer stays below the native Windows title bar", () => {
  const css = read("public/style.css");
  // The panel is now a resizable column of <main>, which already sits below
  // the 32px drag bar (.layout margin-top), instead of a fixed overlay.
  assert.match(css, /\.layout \{\s*margin-top: 32px;/);
  assert.match(css, /main\.agentsOpen\{[^}]*display:grid/);
  assert.match(css, /\.agentsPanel\{[^}]*grid-row:1\/4/);
  assert.doesNotMatch(css, /\.agentsPanel\{[^}]*position:fixed/);
});

test("Android follows the provider configured on the desktop", () => {
  const mobile = read("mobile/android/app/src/main/assets/index.html");
  assert.match(mobile, /id="providerSelect"/);
  assert.match(mobile, /provider:state\.config\?\.provider==="openai"\?"openai":"anthropic"/);
  assert.match(mobile, /openaiModel/);
});

test("README documents standalone install, API keys, APK pairing, and history preservation", () => {
  const readme = read("README.md");
  assert.match(readme, /PC Controller integrado/);
  assert.match(readme, /platform\.openai\.com\/api-keys/);
  assert.match(readme, /Runtime API Key do Secure Tunnel/);
  assert.match(readme, /Noctan-Mobile-<versão>\.apk/);
  assert.match(readme, /Não apague nem substitua `sessions\.json`/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("UI references required controls", () => {
  const s = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  for (const id of [
    "chat",
    "send",
    "cancel",
    "modal",
    "workspace",
    "vault",
    "mcp",
    "plugins",
    "sessions",
    "connectBtn",
    "connectModal",
    "apiKey",
    "connectAll",
    "usageBtn",
    "usagePopover",
    "modelBtn",
    "sessionSearch",
  ])
    assert.ok(s.includes(`id="${id}"`), id);
});
test("backend binds to loopback only", () => {
  const s = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(s, /HOST\s*=\s*["']127\.0\.0\.1["']/);
  assert.ok(!s.includes("bypassPermissions"));
});
test("configuration path arrays resolve one path at a time", () => {
  const s = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(s, /\.map\(\s*\(x\)\s*=>\s*resolve\(x\)\s*\)/);
  assert.doesNotMatch(s, /\.map\(\s*resolve\s*\)/);
});
test("API key is accepted only in memory and never written by connect route", () => {
  const s = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const route = s.slice(
    s.indexOf('path === "/api/connect"'),
    s.indexOf('path === "/api/autoconfigure"'),
  );
  assert.match(route, /process\.env\.ANTHROPIC_API_KEY\s*=\s*key/);
  assert.ok(!route.includes("saveJson"));
  assert.ok(!route.includes("writeFile"));
});

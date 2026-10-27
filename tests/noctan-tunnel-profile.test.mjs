import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureNoctanTunnelProfile } from "../noctan-tunnel-profile.mjs";

test("managed tunnel profile routes ChatGPT to Noctan without changing the legacy profile", () => {
  const root = mkdtempSync(join(tmpdir(), "noctan-tunnel-profile-"));
  const source = join(root, "legacy.yaml");
  const target = join(root, "managed", "noctan.yaml");
  const legacy = [
    "config_version: 1",
    "control_plane:",
    '  base_url: "https://api.openai.com"',
    '  tunnel_id: "tunnel_6ace9ab154788191855a7ba1b5da9351"',
    '  api_key: "secret-that-must-not-be-copied"',
    "health:",
    '  listen_addr: "127.0.0.1:8080"',
    "mcp:",
    "  commands:",
    "    - channel: main",
    '      command: "node old-controller.mjs"',
    "",
  ].join("\n");
  writeFileSync(source, legacy, "utf8");

  const result = ensureNoctanTunnelProfile("legacy", {
    port: 4999,
    sourcePath: source,
    targetPath: target,
  });
  const managed = readFileSync(target, "utf8");

  assert.equal(result.tunnelId, "tunnel_6ace9ab154788191855a7ba1b5da9351");
  assert.equal(readFileSync(source, "utf8"), legacy);
  assert.match(managed, /server_urls:\s+\- channel: main\s+url: "http:\/\/127\.0\.0\.1:4999\/mcp"/);
  assert.match(managed, /api_key: "env:CONTROL_PLANE_API_KEY"/);
  assert.doesNotMatch(managed, /secret-that-must-not-be-copied|old-controller/);
});

test("a Tunnel ID typed in Noctan links a new PC without a legacy profile and sticks on reconnect", () => {
  const root = mkdtempSync(join(tmpdir(), "noctan-tunnel-new-pc-"));
  const source = join(root, "missing.yaml");
  const target = join(root, "managed", "noctan.yaml");
  const id = "tunnel_0123456789abcdef0123456789abcdef";

  assert.throws(() => ensureNoctanTunnelProfile("x", { sourcePath: source, targetPath: target }), /Tunnel ID/);
  assert.throws(() => ensureNoctanTunnelProfile("x", { sourcePath: source, targetPath: target, tunnelId: "abc" }), /inválido/);

  ensureNoctanTunnelProfile("x", { port: 4999, sourcePath: source, targetPath: target, tunnelId: id });
  assert.match(readFileSync(target, "utf8"), new RegExp(`tunnel_id: "${id}"`));

  writeFileSync(source, 'control_plane:\n  tunnel_id: "tunnel_ffffffffffffffffffffffffffffffff"\n', "utf8");
  assert.equal(ensureNoctanTunnelProfile("x", { port: 4999, sourcePath: source, targetPath: target }).tunnelId, id);
});

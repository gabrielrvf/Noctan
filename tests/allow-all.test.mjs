import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("approval UI exposes run allow-all and persistent bypass-all", () => {
  assert.match(app, /Permitir tudo/);
  assert.match(app, /Bypass all permissions/);
  assert.match(app, /bypassAll/);
  assert.match(app, /JSON\.stringify\(\{ id, allow, allowAll, bypassAll \}\)/);
});

test("allow-all and bypass-all auto-approve future tools", () => {
  assert.match(server, /autoApproveAll: false/);
  assert.match(server, /bypassAllPermissions/);
  assert.match(server, /config\.bypassAllPermissions \|\| active\.get\(id\)\?\.autoApproveAll/);
  assert.match(server, /run\.autoApproveAll = true/);
  assert.match(server, /pending\.sessionId === a\.sessionId/);
  assert.match(server, /active\.delete\(id\)/);
});

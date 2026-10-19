// O túnel do ChatGPT morria ao abrir o Noctan (2026-10-19): profile em hard link com a cópia do Codex e
// `command` com "C:/Program Files" sem aspas. repairProfile conserta os dois antes de subir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("repairProfile desfaz o hard link e tira o espaço do executável", async () => {
  const appdata = mkdtempSync(join(tmpdir(), "noctan-tun-"));
  process.env.APPDATA = appdata;
  mkdirSync(join(appdata, "tunnel-client"));
  const file = join(appdata, "tunnel-client", "teste.yaml");
  const node = "C:/Program Files/nodejs/node.exe";
  writeFileSync(file, `mcp:\n  commands:\n    - channel: main\n      command: "${node} C:/x/app.mjs"\n`);
  linkSync(file, join(appdata, "copia-do-codex.yaml"));
  assert.equal(statSync(file).nlink, 2);
  const { repairProfile } = await import("../tunnel-manager.mjs");
  const fixed = repairProfile("teste");
  assert.equal(statSync(file).nlink, 1);
  assert.ok(fixed.includes("hard link com o Codex"));
  const text = readFileSync(file, "utf8");
  if (fixed.includes("command com espaço")) assert.doesNotMatch(text, /Program Files/);
  assert.match(text, /C:\/x\/app\.mjs/);
  assert.deepEqual(repairProfile("teste"), []); // segunda vez: nada a consertar
});

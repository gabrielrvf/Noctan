import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveApiKey, loadApiKey } from "../secure-key.mjs";

test("macOS keychain round-trips a key without persisting plaintext", { skip: process.platform !== "darwin" }, async () => {
  const file = join(await mkdtemp(join(tmpdir(), "noctan-key-")), "anthropic-key.dpapi");
  const key = "sk-ant-" + "a".repeat(40);
  await saveApiKey(key, file);
  assert.ok(!(await readFile(file, "utf8")).includes(key));
  assert.equal(await loadApiKey(file), key);
});

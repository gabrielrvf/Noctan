import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
test("malformed Claude image session is discarded before context rebuild", () => {
  assert.match(server, /malformedImageSession/);
  assert.match(server, /delete s\.claudeSessionId/);
  assert.match(server, /an image in the conversation could not be processed/);
  assert.match(server, /historyForRebuild = !s\.claudeSessionId/);
});

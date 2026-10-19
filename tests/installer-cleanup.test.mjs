import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("installer stops leftover Noctan processes before removing the old version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.build.nsis.include, "build/installer.nsh");
  const nsh = readFileSync(new URL("../build/installer.nsh", import.meta.url), "utf8");
  assert.match(nsh, /!macro customInit/);
  assert.match(nsh, /!macro customUnInit/);
  assert.match(nsh, /Stop-Process -Force/);
  // Only processes from the Noctan folder: never kill other claude.exe / Chrome.
  assert.match(nsh, /StartsWith\(\$\$_, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.doesNotMatch(nsh, /taskkill \/IM claude\.exe/i);
});

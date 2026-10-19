import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sourceFiles = [
  "server.mjs",
  "public/app.js",
  "public/index.html",
  "mobile/android/app/src/main/assets/index.html",
  "mobile/android/app/src/main/java/app/noctan/mobile/MainActivity.java",
];

test("desktop and Android sources contain no mojibake markers", () => {
  for (const path of sourceFiles) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /Ã|Â|â€|â€¢|â—|ðŸ/, path);
  }
});

test("desktop and Android documents explicitly declare UTF-8", () => {
  for (const path of ["public/index.html", "mobile/android/app/src/main/assets/index.html"]) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(text, /<meta charset=["']utf-8["']/i, path);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const mobile=readFileSync(new URL("../mobile/android/app/src/main/assets/index.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.mjs",import.meta.url),"utf8");

test("mobile sends live messages as follow-ups and falls back on run races",()=>{
  assert.match(mobile,/const summary=state\.sessions\.find\(x=>x\.id===state\.current\)/);
  assert.match(mobile,/summary\?\.liveActive/);
  assert.match(mobile,/async function sendFollowUp/);
  assert.match(mobile,/error\?\.status===409/);
  assert.match(mobile,/await sendFollowUp\(prompt,attachments\)/);
});

test("individual session endpoint includes computed liveActive",()=>{
  assert.match(server,/session \? sessionView\(session\)/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const mobile=readFileSync(new URL("../mobile/android/app/src/main/assets/index.html",import.meta.url),"utf8");

test("mobile shows a persistent purple thinking state for live conversations",()=>{
  assert.match(mobile,/const active=!!s\?\.liveActive/);
  assert.match(mobile,/progress\("Pensando\.\.\."\)/);
  assert.match(mobile,/border-left:3px solid #9b6bc6/);
  assert.match(mobile,/noctanPulse/);
});

test("mobile follows remote live runs every second",()=>{
  assert.match(mobile,/setInterval\([\s\S]*loadSessions\(true\)[\s\S]*1000\)/);
});

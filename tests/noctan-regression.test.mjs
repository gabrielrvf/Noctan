import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const js=read("public/app.js"), html=read("public/index.html"), server=read("server.mjs");

test("UI references required controls",()=>{
  for(const id of ["prompt","send","runStatus","dictate","cancel","sessions","modelBtn","modelBtnLabel"])
    assert.match(html,new RegExp(`id=["']${id}["']`));
});

test("backend binds to loopback only",()=>{
  assert.match(server,/HOST = "127\.0\.0\.1"/);
});

test("Claude slash commands are discovered, persisted and exposed to the clients",()=>{
  assert.match(server,/supportedCommands\(\)/);
  assert.match(server,/slashCommands/);
  assert.match(js,/renderSlashMenu/);
});

test("Claude sessions start with the user's Chrome extension integration enabled",()=>{
  assert.match(server,/extraArgs:\s*\{\s*chrome:\s*null\s*\}/);
});

test("Chrome slash commands stay native to Claude in Chrome",()=>{
  assert.match(server,/function normalizeChromeCommand/);
  assert.match(server,/return "\/chrome"/);
  assert.doesNotMatch(server,/mcp__plugin_superpowers-chrome_chrome__use_browser/);
  assert.match(server,/const isSlashCommand =/);
  assert.match(server,/normalizeChromeCommand\(text/);
  assert.match(server,/normalizeChromeCommand\(originalPrompt/);
});

test("README presents Noctan logo and product name",()=>{
 const docs=read("README.md");
 assert.match(docs,/public\/noctan-mark\.png/);
 assert.match(docs,/github\.com\/yanoliveira16\/noctan/);
});

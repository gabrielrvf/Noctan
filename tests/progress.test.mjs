import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
test("run progress is in the chat, expandable and tied to actual events",()=>{
  assert.match(src,/document\.createElement\("details"\)/);
  assert.match(src,/\$\("chat"\)\.append\(details\)/);
  assert.match(src,/updateProgress\("Agente inicializado"\)/);
  assert.match(src,/updateProgress\("Usando ferramenta:/);
  assert.match(src,/updateProgress\("Aguardando autoriza/);
  assert.match(src,/thinkingMessages/);
  assert.match(css,/\.agentProgressLog/);
});
test("Medium label is valid unicode",()=>{
 assert.match(src,/M\\u00e9dio|Médio/);
});

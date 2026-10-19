import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read = p => readFileSync(new URL("../"+p,import.meta.url),"utf8");
const html=read("public/index.html"),js=read("public/app.js"),server=read("server.mjs"),css=read("public/style.css");
test("composer has exactly one send and usage control",()=>{
 assert.equal((html.match(/id="send"/g)||[]).length,1);
 assert.equal((html.match(/id="usageDot"/g)||[]).length,1);
 assert.match(html,/class="promptShell"/);
 assert.match(html,/class="primary sendInside"/);
 assert.match(js,/e\.key === "Enter" && !e\.shiftKey && !e\.isComposing/);
});
test("SDK imposes no Noctan turn or dollar budget",()=>{
 const opts=server.slice(server.indexOf("const opts = {"),server.indexOf("if (s.claudeSessionId)"));
 assert.doesNotMatch(opts,/maxTurns|maxBudgetUsd/);
 assert.match(js,/Sem limite por tarefa/);
});
test("progress is animated but removed when complete",()=>{
 assert.match(js,/thinkingMessages/);
 assert.match(js,/progressUI\.details\.remove\(\)/);
 assert.match(css,/agentSpinner/);
 assert.match(js,/icon\.src="\/noctan-mark\.png"/);
});
test("sessions auto reopen latest and do not lose updates in merger",()=>{
 assert.match(js,/if \(selected\) await loadSession\(selected\)/);
 const a=server.indexOf("function mergeSessions("),b=server.indexOf("async function saveJson(",a);
 assert.ok(a>=0 && b>a);
 const merge=runInNewContext(server.slice(a,b)+"\nmergeSessions");
 const previous={x:{id:"x",updatedAt:"2026-10-16",messages:[{role:"user",text:"Mensagem antiga",at:"1"}]}};
 const newer={x:{id:"x",updatedAt:"2026-10-17",messages:[{role:"assistant",text:"Resposta nova",at:"2"}]}};
 const result=merge(previous,newer);
 assert.equal(result.x.messages.length,2);
 assert.match(result.x.messages[0].text,/antiga/);
 assert.match(result.x.messages[1].text,/nova/);
});
test("PC Controller local MCP is independent from Secure Tunnel",()=>{
 assert.match(server,/localMcpConfigured: Boolean\(pcControllerMcp\)/);
 assert.match(js,/PC Controller conectado/); assert.match(js,/\/api\/tunnel\/connect/);
 assert.match(js,/state\.discovery\.pcController\?\.localMcpConfigured/);
});

test("terminated PC Controller tool sessions reconnect without duplicating the user prompt",()=>{
  assert.match(server,/session terminated/i);
  assert.match(server,/retriedTerminatedToolSession/);
  assert.match(server,/tente novamente somente a chamada de ferramenta que falhou/);
  assert.match(server,/Não repita a mensagem do usuário/);
});

test("Claude slash commands are discovered, persisted and exposed to the clients",()=>{
  assert.match(server,/supportedCommands/);
  assert.match(server,/slashCommands/);
  assert.match(server,/send\(res, "commands"/);
  assert.match(js,/slashMenu/);
  assert.match(js,/renderSlashMenu/);
});

test("Claude sessions start with the user's Chrome extension integration enabled",()=>{
  assert.match(server,/extraArgs:\s*\{\s*chrome:\s*null\s*\}/);
});
test("README presents Noctan logo and product name",()=>{
 const docs=read("README.md");
 assert.match(docs,/public\/noctan-mark\.png/);
 assert.match(docs,/github\.com\/yanoliveira16\/noctan/);
});


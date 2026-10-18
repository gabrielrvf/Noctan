import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('history is taken only from the active session',()=>{
 assert.match(s,/function sessionPrompts\(session\)/);
 assert.match(s,/state\.sessions\.find\(s => s\.id === state\.current\)/);
 assert.doesNotMatch(s,/state\.sessions\.flatMap/);
 assert.match(s,/setPromptHistory\(s\)/);
});
test('new chat clears prompt history and draft',()=>{
 const block=s.slice(s.indexOf('function newSession()'),s.indexOf('let thinkingTimer'));
 assert.match(block,/setPromptHistory\(null\)/);
 assert.match(block,/\$\("prompt"\)\.value = ""/);
});

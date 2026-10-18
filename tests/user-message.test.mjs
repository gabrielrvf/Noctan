import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('user text and attachment count render separately',()=>{
 assert.match(js,/function message\(role, text, attachmentCount = 0, messageIndex = null\)/);
 assert.match(js,/body\.textContent = text/);
 assert.match(js,/summary\.textContent = attachmentCount/);
 assert.match(js,/message\("user", prompt \|\| "Imagem anexada", attachments\.length\)/);
 assert.match(js,/Array\.isArray\(m\.attachments\) \? m\.attachments\.length : 0/);
 assert.match(js,/messageEdit/);
 assert.doesNotMatch(js,/imagem\(ns\)/);
});

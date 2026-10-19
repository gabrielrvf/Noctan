import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('user text and sent image thumbnails render separately',()=>{
  assert.match(js,/function message\(role, text, attachments = \[\], messageIndex = null\)/);
  assert.match(js,/body\.textContent = text/);
  assert.match(js,/messageAttachmentGallery/);
  assert.match(js,/image\.src = src/);
  assert.match(js,/message\("user", prompt \|\| "Imagem anexada", attachments\)/);
  assert.match(js,/Array\.isArray\(m\.attachments\) \? m\.attachments : \[\]/);
  assert.match(js,/messageEdit/);
});

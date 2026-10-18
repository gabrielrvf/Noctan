import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url),'utf8');
test('voice waveform and streamed words share composer', () => {
 const html=read('public/index.html'); const js=read('public/app.js');
 for(const id of ['liveVoiceBar','voiceWave','voiceCancel','voiceFinish','voiceTimer','prompt']) assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/function analyzeVoiceLevel/);
 assert.match(js,/commitStreamingText\(event\.text\)/);
 assert.match(js,/function renderVoiceWave/);
 assert.match(js,/function prewarmStt/);
 assert.match(js,/takeWarmSttSocket\(\)/);
});
test('credits open in the authenticated system browser',()=>{
 const html=read('public/index.html');const js=read('public/app.js');
 assert.ok(html.includes('id="sidebarCredits"'));
 assert.match(js,/window\.open\("https:\/\/platform\.claude\.com\/settings\/billing"/);
 assert.doesNotMatch(js,/show\(\$\("officialCreditsModal"\), true\)/);
});

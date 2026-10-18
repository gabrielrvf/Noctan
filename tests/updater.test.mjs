import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const desktop = readFileSync(new URL('../desktop.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('packaged app has GitHub auto updater configured', () => {
  assert.ok(pkg.dependencies['electron-updater']);
  assert.ok(pkg.build.files.includes('preload.cjs'));
  assert.equal(pkg.build.publish?.[0]?.provider, 'github');
  assert.equal(pkg.build.publish?.[0]?.owner, 'yanoliveira16');
  assert.equal(pkg.build.publish?.[0]?.repo, 'Noctan');
  assert.match(desktop, /autoUpdater\.autoDownload = true/);
  assert.match(desktop, /autoUpdater\.autoInstallOnAppQuit = true/);
  assert.match(desktop, /checkForUpdates\(\)/);
  assert.match(desktop, /quitAndInstall\(false, true\)/);
});

test('renderer exposes update button and restart-to-update flow', () => {
  assert.match(html, /id="updateBtn"/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("noctanUpdater"/);
  assert.match(app, /Reiniciar para atualizar/);
  assert.match(app, /window\.noctanUpdater\.checkNow/);
  assert.match(app, /window\.noctanUpdater\.installNow/);
});

test('main branch publishes incrementing GitHub releases', () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /github\.run_number/);
  assert.match(workflow, /electron-builder --win nsis --publish always/);
  assert.match(workflow, /GITHUB_TOKEN/);
});

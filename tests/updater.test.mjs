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
  assert.match(desktop, /requestSingleInstanceLock\(\)/);
  assert.match(desktop, /isVersionStrictlyNewer\(info\?\.version, app\.getVersion\(\)\)/);
});

test('renderer exposes update button and restart-to-update flow', () => {
  assert.match(html, /id="updateBtn"/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("noctanUpdater"/);
  assert.match(app, /Reiniciar para atualizar/);
  assert.match(app, /window\.noctanUpdater\.checkNow/);
  assert.match(app, /window\.noctanUpdater\.installNow/);
});

test('main branch publishes incrementing GitHub releases deterministically', () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /github\.run_number/);
  assert.match(workflow, /electron-builder --win nsis --publish never/);
  assert.match(workflow, /gh release create .*--draft/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /Noctan-Mobile\.apk/);
  assert.match(workflow, /NOCTAN_RELEASE_VERSION/);
  assert.doesNotMatch(workflow, /^  mobile:/m);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /NOCTAN_ANDROID_DEBUG_KEYSTORE/);
  assert.ok(workflow.indexOf('Build matching Android APK') < workflow.indexOf('Publish desktop and Android atomically'));
  assert.match(workflow, /GITHUB_TOKEN/);
});

test('legacy configuration migration preserves workspace and protected keys', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /join\(process\.env\.APPDATA, "Noctan"\)/);
  assert.match(server, /if \(!currentConfig\.workspace && oldConfig\.workspace\)/);
  assert.match(server, /"anthropic-key\.dpapi"/);
  assert.match(server, /copyFile\(source, target\)/);
});

test('PC Controller is green when either local controller or tunnel is connected', () => {
  assert.match(app, /const connected = localConnected \|\| tunnelConnected/);
  assert.match(app, /const failed = !busy && !connected/);
});

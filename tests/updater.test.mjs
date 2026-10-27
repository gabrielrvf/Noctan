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
  assert.match(desktop, /quitAndInstall\(true, true\)/); // silencioso: sem abrir o assistente do NSIS
  assert.match(desktop, /isQuitting = true;\s*setImmediate\(\(\) => autoUpdater\.quitAndInstall/); // a bandeja não segura o app no Mac
  assert.match(desktop, /requestSingleInstanceLock\(\)/);
  assert.match(desktop, /isVersionStrictlyNewer\(info\?\.version, app\.getVersion\(\)\)/);
});

test('renderer exposes update button and restart-to-update flow', () => {
  assert.match(html, /id="updateBtn"/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("noctanUpdater"/);
  assert.match(app, /Reiniciar para atualizar/);
  assert.match(app, /window\.noctanUpdater\.checkNow/);
  assert.match(app, /window\.noctanUpdater\.installNow/);
  assert.match(html, /id="appVersion"/);
  assert.match(app, /status\.currentVersion/);
});

test('closing the desktop window keeps Noctan running in the system tray', () => {
  assert.match(desktop, /new Tray\(icon\)/);
  assert.match(desktop, /Noctan — executando em segundo plano/);
  assert.match(desktop, /window\.on\("close", \(event\) =>/);
  assert.match(desktop, /event\.preventDefault\(\);\s*window\.hide\(\);/s);
  assert.match(desktop, /label: "Abrir Noctan"/);
  assert.match(desktop, /label: "Sair"/);
  assert.match(desktop, /app\.on\("before-quit", \(\) => \{ isQuitting = true; \}\)/);
  assert.doesNotMatch(desktop, /window-all-closed", \(\) => app\.quit\(\)/);
});

test('main branch publishes incrementing GitHub releases deterministically', () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /github\.run_number/);
  assert.match(workflow, /npm version --allow-same-version --no-git-tag-version/);
  assert.match(workflow, /npm run dist:win -- --publish never/);
  assert.match(pkg.scripts['dist:win'], /tunnel:fetch.*electron-builder --win nsis/);
  assert.match(workflow, /gh release create .*--draft/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /Noctan-Mobile\.apk/);
  assert.match(workflow, /NOCTAN_RELEASE_VERSION/);
  assert.doesNotMatch(workflow, /^  mobile:/m);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /NOCTAN_ANDROID_DEBUG_KEYSTORE/);
  assert.ok(workflow.indexOf('Build matching Android APK') < workflow.indexOf('Upload Windows and Android to draft release'));
  assert.match(workflow, /npm run dist:mac -- --arm64 --publish never/);
  assert.match(pkg.scripts['dist:mac'], /tunnel:fetch.*electron-builder --mac dmg zip/);
  assert.match(workflow, /needs: \[release, mac\]/);
  assert.equal(pkg.build.mac.hardenedRuntime, true);
  assert.equal(pkg.build.mac.entitlements, 'build/entitlements.mac.plist');
  // Notarization rejects the unsigned binaries inside the downloaded tunnel archive.
  assert.ok(pkg.build.extraResources[0].filter.includes('!**/*.zip'));
  assert.match(workflow, /CSC_LINK: \$\{\{ secrets\.CSC_LINK \}\}/);
  assert.match(workflow, /-c\.mac\.identity=- -c\.mac\.hardenedRuntime=false/);
  assert.match(workflow, /dist\/latest-mac\.yml/);
  assert.match(workflow, /gh release edit "\$tag" --draft=false --latest/);
  assert.match(workflow, /GITHUB_TOKEN/);
});

test('legacy configuration migration preserves workspace and protected keys', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /join\(process\.env\.APPDATA, "Noctan"\)/);
  assert.match(server, /if \(!currentConfig\.workspace && oldConfig\.workspace\)/);
  assert.match(server, /"anthropic-key\.dpapi"/);
  assert.match(server, /copyFile\(source, target\)/);
});

test('desktop stores conversations in the active Electron profile', () => {
  const desktop = readFileSync(new URL('../desktop.mjs', import.meta.url), 'utf8');
  assert.match(desktop, /NOCTAN_DATA_DIR = join\(app\.getPath\("userData"\), "data"\)/);
  assert.doesNotMatch(desktop, /app\.getPath\("appData"\), "Noctan", "data"/);
});

test('PC Controller is green only when local (if configured) AND tunnel (if key configured) are connected', () => {
  assert.match(app, /const connected = \(localConnected \|\| !needLocal\) && \(tunnelConnected \|\| !needTunnel\)/);
  assert.match(app, /const failed = !busy && !connected/);
});

test('PC Controller click shows a spinning Noctan logo until reconnection completes', () => {
  assert.match(html, /id="pcControllerDot"[^>]*><img src="\/noctan-mark\.png"/);
  assert.match(app, /pcReconnectInProgress = true/);
  assert.match(app, /for \(let attempt = 0; attempt < 20/);
  assert.match(app, /pcReconnectInProgress = false/);
});

test('update check runs at startup and again when the window comes back from the tray', () => {
  assert.match(desktop, /setTimeout\(checkForUpdatesOnOpen, 2500\)/);
  assert.match(desktop, /function showMainWindow\(\) \{[\s\S]*?checkForUpdatesOnOpen\(\);\s*\}/);
  assert.match(desktop, /Date\.now\(\) - lastUpdateCheck < 10 \* 60000/);
});

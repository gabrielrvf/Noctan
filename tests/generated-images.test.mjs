import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generatedImagePathCandidates, importGeneratedImages } from "../generated-images.mjs";

test("generated image paths are found inside tool results", () => {
  const root = join(tmpdir(), "noctan-workspace");
  const path = join(root, "art", "imagem final.png");
  const candidates = generatedImagePathCandidates({ content: `Imagem salva em \"${path}\"` }, root);
  assert.ok(candidates.includes(path));
});

test("generated images are copied into chat attachments without moving the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "noctan-generated-"));
  const workspace = join(root, "workspace");
  const attachmentsDir = join(root, "attachments");
  await mkdir(workspace, { recursive: true });
  const source = join(workspace, "resultado.png");
  await writeFile(source, Buffer.from([137, 80, 78, 71]));
  const saved = await importGeneratedImages({ evidence: [source, source], workspace, attachmentsDir });
  assert.equal(saved.length, 1);
  assert.deepEqual(await readFile(source), Buffer.from([137, 80, 78, 71]));
  assert.deepEqual(await readFile(join(attachmentsDir, saved[0])), Buffer.from([137, 80, 78, 71]));
});

test("images linked by a generated local HTML preview are imported into chat", async () => {
  const root = await mkdtemp(join(tmpdir(), "noctan-preview-"));
  const attachmentsDir = join(root, "attachments");
  const source = join(root, "preview-image.png");
  const preview = join(root, "preview.html");
  await writeFile(source, Buffer.from([137, 80, 78, 71]));
  await writeFile(preview, '<img src="preview-image.png">');
  const saved = await importGeneratedImages({ evidence: [`Abra ${preview}`], workspace: root, attachmentsDir });
  assert.equal(saved.length, 1);
  assert.deepEqual(await readFile(join(attachmentsDir, saved[0])), Buffer.from([137, 80, 78, 71]));
});

test("images beside a data-url HTML preview are imported into chat", async () => {
  const root = await mkdtemp(join(tmpdir(), "noctan-data-preview-"));
  const attachmentsDir = join(root, "attachments");
  const source = join(root, "generated-output.png");
  const preview = join(root, "preview.html");
  await writeFile(source, Buffer.from([137, 80, 78, 71]));
  await writeFile(preview, '<img src="data:image/png;base64,iVBORw0KGgo=">');
  const saved = await importGeneratedImages({ evidence: [`Abra ${preview}`], workspace: root, attachmentsDir });
  assert.equal(saved.length, 1);
  assert.deepEqual(await readFile(join(attachmentsDir, saved[0])), Buffer.from([137, 80, 78, 71]));
});

test("images that already existed before the run are not treated as generated", async () => {
  const root = await mkdtemp(join(tmpdir(), "noctan-old-image-"));
  const attachmentsDir = join(root, "attachments");
  const logo = join(root, "noctan-mark.png");
  const page = join(root, "index.html");
  await writeFile(logo, Buffer.from([137, 80, 78, 71]));
  await writeFile(page, '<img src="/noctan-mark.png">');
  const old = new Date(Date.now() - 60_000);
  await utimes(logo, old, old);
  const saved = await importGeneratedImages({ evidence: [`${page}:96: <div id="pending">`], workspace: root, attachmentsDir, since: Date.now() - 2000 });
  assert.equal(saved.length, 0);
});

test("desktop and Android render assistant image attachments inline", async () => {
  const desktop = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../mobile/android/app/src/main/assets/index.html", import.meta.url), "utf8");
  assert.match(desktop, /appendMessageAttachments\(e, attachments, "Arquivo gerado"\)/);
  assert.match(mobile, /role==="assistant"\?"Imagem gerada":"Imagem enviada"/);
});

test("a completed conversation can recover generated images from explicit evidence", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /\/import-generated\$/);
  assert.match(server, /assistant\.attachments = \[\.\.\.new Set/);
});

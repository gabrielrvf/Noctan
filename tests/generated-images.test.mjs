import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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

test("desktop and Android render assistant image attachments inline", async () => {
  const desktop = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../mobile/android/app/src/main/assets/index.html", import.meta.url), "utf8");
  assert.match(desktop, /appendMessageAttachments\(e, attachments, "Imagem gerada"\)/);
  assert.match(mobile, /role==="assistant"\?"Imagem gerada":"Imagem enviada"/);
});

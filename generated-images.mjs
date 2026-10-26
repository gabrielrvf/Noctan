import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/i;
const ABSOLUTE_IMAGE_PATH = /(?:file:\/\/\/)?(?:[A-Za-z]:[\\/]|\/)[^<>"'|\r\n]*?\.(?:png|jpe?g|webp|gif)\b/gi;
const ABSOLUTE_HTML_PATH = /(?:file:\/\/\/)?(?:[A-Za-z]:[\\/]|\/)[^<>"'|\r\n]*?\.html?\b/gi;

function textValues(value, output = [], depth = 0) {
  if (depth > 8 || output.length > 500) return output;
  if (typeof value === "string") {
    if (value.length <= 200_000 && !value.startsWith("data:image/")) output.push(value);
    return output;
  }
  if (Array.isArray(value)) for (const item of value) textValues(item, output, depth + 1);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) textValues(item, output, depth + 1);
  }
  return output;
}

export function generatedImagePathCandidates(value, workspace = "") {
  const candidates = new Set();
  for (const text of textValues(value)) {
    const trimmed = text.trim().replace(/^['"`]|['"`]$/g, "");
    if (IMAGE_EXTENSION.test(trimmed) && trimmed.length < 4096) {
      candidates.add(isAbsolute(trimmed) ? trimmed : resolve(workspace || ".", trimmed));
    }
    for (const match of text.matchAll(ABSOLUTE_IMAGE_PATH)) {
      let candidate = match[0].replace(/^file:\/\/\//i, "");
      try { candidate = decodeURIComponent(candidate); } catch {}
      candidates.add(candidate);
    }
  }
  return [...candidates];
}

// `since` (ms): só importa arquivos criados/alterados depois disso, para uma imagem
// que já existia (ex.: o logo ao lado de um index.html lido) não virar "imagem gerada".
export async function importGeneratedImages({ evidence, workspace, attachmentsDir, since = 0 }) {
  const saved = [];
  const seen = new Set();
  const attachmentRoot = resolve(attachmentsDir);
  await mkdir(attachmentRoot, { recursive: true });
  const candidates = generatedImagePathCandidates(evidence, workspace);
  for (const text of textValues(evidence)) {
    for (const match of text.matchAll(ABSOLUTE_HTML_PATH)) {
      let htmlPath = match[0].replace(/^file:\/\/\//i, "");
      try { htmlPath = decodeURIComponent(htmlPath); } catch {}
      if (!existsSync(htmlPath)) continue;
      const html = await readFile(htmlPath, "utf8").catch(() => "");
      for (const sourceMatch of html.matchAll(/(?:src|href)=["']([^"']+\.(?:png|jpe?g|webp|gif)(?:\?[^"']*)?)["']/gi)) {
        const clean = sourceMatch[1].replace(/\?.*$/, "");
        if (!/^data:/i.test(clean)) candidates.push(isAbsolute(clean) ? clean : resolve(htmlPath, "..", clean));
      }
      // Generated preview pages commonly embed data URLs while writing the
      // original PNGs beside the HTML. Include those files as chat evidence.
      const siblings = await readdir(dirname(htmlPath), { withFileTypes: true }).catch(() => []);
      for (const sibling of siblings) {
        if (sibling.isFile() && IMAGE_EXTENSION.test(sibling.name)) {
          candidates.push(join(dirname(htmlPath), sibling.name));
        }
      }
    }
  }
  for (const candidate of candidates) {
    if (saved.length >= 20) break;
    const source = resolve(candidate);
    const key = source.toLowerCase();
    if (seen.has(key) || source === attachmentRoot || source.startsWith(attachmentRoot + sep)) continue;
    seen.add(key);
    if (!existsSync(source) || !IMAGE_EXTENSION.test(source)) continue;
    const info = await stat(source).catch(() => null);
    if (!info?.isFile() || info.size < 1 || info.size > 20_000_000 || info.mtimeMs < since) continue;
    const extension = extname(source).toLowerCase() || ".png";
    const safeBase = basename(source, extname(source)).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "imagem";
    const name = `generated-${safeBase}-${randomUUID()}${extension}`;
    await copyFile(source, join(attachmentRoot, name));
    saved.push(name);
  }
  return saved;
}

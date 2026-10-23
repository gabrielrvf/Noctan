import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const version = process.env.NOCTAN_TUNNEL_VERSION || "v0.0.15";
const os = platform();
const cpu = arch() === "x64" ? "amd64" : arch();
if (!["win32", "darwin"].includes(os) || !["amd64", "arm64"].includes(cpu))
  throw new Error(`Plataforma do Secure MCP Tunnel não suportada: ${os}-${cpu}`);

const releaseOs = os === "win32" ? "windows" : "darwin";
const file = `tunnel-client-runtime-cloudflared-${version}-${releaseOs}-${cpu}.zip`;
const base = `https://github.com/openai/tunnel-client/releases/download/${version}`;
const target = resolve("vendor", "tunnel-client", `${os}-${arch()}`);
const zip = join(target, file);
await mkdir(target, { recursive: true });

async function download(name) {
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`Download ${name} falhou: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const [archive, sums] = await Promise.all([download(file), download("SHA256SUMS.txt")]);
const expected = sums.toString("utf8").split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts.at(-1)?.replace(/^\*/, "") === file)?.[0];
const actual = createHash("sha256").update(archive).digest("hex");
if (!expected || expected.toLowerCase() !== actual)
  throw new Error(`Checksum inválido para ${file}`);

await writeFile(zip, archive);
const extracted = spawnSync("tar", ["-xf", zip, "-C", target], { stdio: "inherit" });
if (extracted.status !== 0) throw new Error(`Não foi possível extrair ${file}`);
if (os !== "win32") {
  await chmod(join(target, "tunnel-client-runtime-cloudflared"), 0o755);
  await chmod(join(target, "cloudflared"), 0o755);
}
const notice = await readFile(join(target, "NOTICE"), "utf8");
if (!notice.trim()) throw new Error("Pacote do túnel veio sem NOTICE.");
console.log(`Secure MCP Tunnel ${version} verificado em ${target}`);

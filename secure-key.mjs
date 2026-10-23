import { spawnSync } from "node:child_process";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";

// Windows user-scoped DPAPI: only ciphertext is ever persisted.
// Payloads are supplied over stdin, never placed in command arguments.
const WINDOWS_SCRIPT = {
  protect: [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$plain=[Console]::In.ReadToEnd()",
    "$bytes=[Text.Encoding]::UTF8.GetBytes($plain)",
    "$encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($encrypted))",
  ].join("\n"),
  unprotect: [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$encrypted=[Convert]::FromBase64String([Console]::In.ReadToEnd())",
    "$bytes=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes)) }",
    "finally { [Array]::Clear($bytes,0,$bytes.Length) }",
  ].join("\n"),
};
// macOS: a random AES-256-GCM master key lives in the user's login Keychain;
// files hold base64(iv | tag | ciphertext). Keychain writes go over stdin (`security -i`).
const KEYCHAIN_ITEM = ["-s", "Noctan", "-a", "secure-key"];
let macKey = null;
function macMasterKey() {
  if (macKey) return macKey;
  const found = spawnSync("security", ["find-generic-password", ...KEYCHAIN_ITEM, "-w"], { encoding: "utf8", timeout: 12000 });
  const hex = found.status === 0 ? found.stdout.trim() : "";
  if (/^[0-9a-f]{64}$/.test(hex)) return (macKey = Buffer.from(hex, "hex"));
  const key = randomBytes(32);
  const added = spawnSync("security", ["-i"], {
    input: `add-generic-password -U ${KEYCHAIN_ITEM.join(" ")} -w ${key.toString("hex")}\n`,
    encoding: "utf8", timeout: 12000,
  });
  if (added.error || added.status !== 0)
    throw Error(`Não foi possível acessar o Keychain do macOS. (${String(added.error?.message || added.stderr || "erro desconhecido").slice(0, 240)})`);
  return (macKey = key);
}
function macTransform(mode, value) {
  const key = macMasterKey();
  if (mode === "protect") {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  const raw = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
function transform(mode, value) {
  if (process.platform === "darwin") return macTransform(mode, value);
  if (process.platform !== "win32") throw Error("Armazenamento seguro da chave requer Windows ou macOS neste build.");
  const script = Buffer.from(WINDOWS_SCRIPT[mode], "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", script
  ], { input: value, encoding: "utf8", windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0 || !result.stdout) {
    const detail = String(result.error?.message || result.stderr || "erro desconhecido")
      .replace(/\s+/g, " ").slice(0, 240);
    throw Error(`Não foi possível acessar a proteção de credenciais do Windows. (${detail})`);
  }
  return result.stdout.trim();
}
function validKey(key, provider) {
  if (provider === "openai") return /^sk-[A-Za-z0-9_-]{20,}$/.test(key);
  if (provider === "tunnel") return /^sk-[A-Za-z0-9_-]{20,}$/.test(key);
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key);
}
function providerLabel(provider) {
  if (provider === "openai") return "OpenAI";
  if (provider === "tunnel") return "Runtime do Secure Tunnel";
  return "Anthropic";
}
export async function saveApiKey(key, destination, provider = "anthropic") {
  if (!validKey(key, provider)) throw Error(`Chave ${providerLabel(provider)} inválida.`);
  const encrypted = transform("protect", key);
  await mkdir(dirname(destination), { recursive: true });
  const temp = destination + ".tmp";
  await writeFile(temp, encrypted, { encoding: "utf8", mode: 0o600, flag: "w" });
  await rename(temp, destination);
}
export async function loadApiKey(destination, provider = "anthropic") {
  if (!existsSync(destination)) return null;
  const encrypted = await readFile(destination, "utf8");
  const key = transform("unprotect", encrypted.trim());
  if (!validKey(key, provider)) throw Error(`Chave ${providerLabel(provider)} protegida inválida.`);
  return key;
}
export async function removeApiKey(destination) {
  await unlink(destination).catch(e => { if (e.code !== "ENOENT") throw e; });
}



export async function saveSecret(value, destination) {
  if (!value) throw Error("Segredo vazio.");
  const encrypted = transform("protect", String(value));
  await mkdir(dirname(destination), { recursive: true });
  const temp = destination + ".tmp";
  await writeFile(temp, encrypted, { encoding: "utf8", mode: 0o600, flag: "w" });
  await rename(temp, destination);
}
export async function loadSecret(destination) {
  if (!existsSync(destination)) return null;
  const encrypted = await readFile(destination, "utf8");
  return transform("unprotect", encrypted.trim());
}

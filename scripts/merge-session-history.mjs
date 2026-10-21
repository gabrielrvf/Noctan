import { readFile, writeFile } from "node:fs/promises";

const [basePath, currentPath, outputPath] = process.argv.slice(2);
if (!basePath || !currentPath || !outputPath) {
  throw new Error("Usage: node scripts/merge-session-history.mjs <base> <current> <output>");
}

const [base, current] = await Promise.all([
  readFile(basePath, "utf8").then(JSON.parse),
  readFile(currentPath, "utf8").then(JSON.parse),
]);

const signature = (message) => JSON.stringify([
  message?.role ?? "",
  message?.at ?? "",
  message?.text ?? "",
  message?.kind ?? "",
  message?.name ?? "",
  message?.attachments ?? [],
]);

const merged = {};
for (const id of new Set([...Object.keys(base), ...Object.keys(current)])) {
  const older = base[id] || {};
  const newer = current[id] || {};
  // Preserve the recovered baseline byte-for-byte, including repeated turns that
  // may be intentional. Only deduplicate messages coming from the newer file.
  const messages = [...(older.messages || [])];
  const seen = new Set(messages.map(signature));
  for (const message of newer.messages || []) {
    const key = signature(message);
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push(message);
  }
  messages.sort((a, b) => String(a?.at || "").localeCompare(String(b?.at || "")));
  merged[id] = { ...older, ...newer, messages };
}

await writeFile(outputPath, JSON.stringify(merged, null, 2), "utf8");
const messageCount = Object.values(merged).reduce((sum, session) => sum + (session.messages?.length || 0), 0);
console.log(JSON.stringify({ sessions: Object.keys(merged).length, messages: messageCount }));

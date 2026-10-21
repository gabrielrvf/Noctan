import { createHash } from "node:crypto";

const TEXT_KEYS = ["prompt", "text", "task", "message", "content", "description", "value"];

export function normalizeExternalText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(normalizeExternalText).filter(Boolean).join("\n").trim();
  if (value && typeof value === "object") {
    for (const key of TEXT_KEYS) {
      const text = normalizeExternalText(value[key]);
      if (text) return text;
    }
    try { return JSON.stringify(value, null, 2).trim(); } catch { return ""; }
  }
  return value == null ? "" : String(value).trim();
}

export function handoffFingerprint({ prompt, title, source, requestId } = {}) {
  const explicit = normalizeExternalText(requestId);
  if (explicit) return `request:${explicit.slice(0, 300)}`;
  return createHash("sha256")
    .update(JSON.stringify([
      normalizeExternalText(source).toLowerCase(),
      normalizeExternalText(title).toLowerCase(),
      normalizeExternalText(prompt),
    ]))
    .digest("hex");
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answeredQuestionsMarkdown } from "../question-record.mjs";

test("answered questions stay in the conversation with every option and the picked ones marked", () => {
  const questions = [
    { question: "Publicar?", options: [{ label: "Agora", description: "15 min" }, { label: "Depois" }] },
    { question: "Plataformas?", multiSelect: true, options: [{ label: "Windows" }, { label: "Mac" }] },
  ];
  const text = answeredQuestionsMarkdown(questions, { "Publicar?": "Agora", "Plataformas?": "Windows, só hoje" });
  assert.equal(text, [
    "**❓ Publicar?**", "- ✅ **Agora** — 15 min", "- Depois", "",
    "**❓ Plataformas?**", "- ✅ **Windows**", "- Mac", "- ✅ **Outra resposta:** só hoje",
  ].join("\n"));
});

test("question panel stacks one block per question and the server records the answer", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(app, /block\.className = "question"/);
  assert.match(server, /answeredQuestionsMarkdown\(input\?\.questions, answers\)/);
});

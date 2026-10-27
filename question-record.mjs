// Markdown da pergunta respondida (AskUserQuestion): todas as opções como foram enviadas, com a escolhida marcada.
export function answeredQuestionsMarkdown(questions, answers) {
  return (Array.isArray(questions) ? questions : []).map((item) => {
    const answer = String(answers?.[item.question] ?? "").trim();
    const parts = answer ? answer.split(", ") : [];
    const labels = (item.options || []).map((option) => option.label);
    const lines = (item.options || []).map((option) => {
      const description = option.description ? ` — ${option.description}` : "";
      return parts.includes(option.label) ? `- ✅ **${option.label}**${description}` : `- ${option.label}${description}`;
    });
    const other = parts.filter((part) => !labels.includes(part)).join(", ");
    if (other) lines.push(`- ✅ **Outra resposta:** ${other}`);
    if (!answer) lines.push("- _(sem resposta)_");
    return `**❓ ${item.question || item.header || "Pergunta"}**\n${lines.join("\n")}`;
  }).join("\n\n");
}

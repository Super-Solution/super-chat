// Thread export.
//
// Markdown rather than JSON: the point of exporting a conversation is to read it
// somewhere else or paste it into a ticket, and JSON serves neither. Cards are
// rendered as their data, not as their markup — a table exported as HTML is
// useless in a text file, but as a markdown table it survives.
//
// Sharing (a hosted link) is deliberately NOT here: it needs a backend the kit
// does not have, and faking it with a data: URL would produce links that break
// the moment they leave the browser.

import type { Card, ContentPart, Message } from "@super-solution/super-chat-core";

function cardToMarkdown(spec: Record<string, unknown>): string {
  const kind = String(spec.kind ?? "unknown");
  const title = spec.title ? `**${spec.title}**\n\n` : "";

  if (kind === "table" && Array.isArray(spec.columns) && Array.isArray(spec.rows)) {
    const cols = spec.columns as { key: string; label: string }[];
    const rows = spec.rows as Record<string, unknown>[];
    const head = `| ${cols.map((c) => c.label).join(" | ")} |`;
    const rule = `| ${cols.map(() => "---").join(" | ")} |`;
    const body = rows.map((r) => `| ${cols.map((c) => String(r[c.key] ?? "")).join(" | ")} |`).join("\n");
    return `${title}${head}\n${rule}\n${body}`;
  }

  if (kind === "markdown" && typeof spec.body === "string") return `${title}${spec.body}`;
  if (kind === "code" && typeof spec.code === "string") {
    return `${title}\`\`\`${spec.language ?? ""}\n${spec.code}\n\`\`\``;
  }
  if (kind === "callout" && typeof spec.body === "string") return `> ${title}${spec.body}`;

  // Everything else keeps its data rather than being dropped — an export that
  // silently omits a card is worse than one that is a little verbose.
  return `${title}\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
}

function partToMarkdown(part: ContentPart): string | null {
  switch (part.type) {
    case "text":
      return part.text;
    case "reasoning":
      return `<details><summary>Reasoning</summary>\n\n${part.text}\n\n</details>`;
    case "tool-call":
      return `- \`${part.name}(${JSON.stringify(part.input ?? {})})\``;
    case "tool-result":
      return part.failure ? `- \`${part.name}\` failed: ${part.failure}` : null;
    case "image":
      return "_(image)_";
    case "file":
      return `_(file: ${part.filename ?? "attachment"})_`;
    case "artifact":
      return part.kind.startsWith("card:")
        ? cardToMarkdown(((part.data as { spec?: Card["spec"] }).spec ?? part.data) as Record<string, unknown>)
        : null;
    default:
      return null;
  }
}

/** Render a thread as markdown. `title` becomes the H1 when given. */
export function threadToMarkdown(messages: readonly Message[], title?: string): string {
  const out: string[] = title ? [`# ${title}`, ""] : [];

  for (const m of messages) {
    if (m.role === "system") continue;
    const body = m.parts.map(partToMarkdown).filter(Boolean).join("\n\n");
    if (!body) continue;
    const who = m.role === "user" ? "You" : m.role === "tool" ? "Tools" : "Assistant";
    const when = m.createdAt ? ` · ${new Date(m.createdAt).toISOString().slice(0, 16).replace("T", " ")}` : "";
    out.push(`## ${who}${when}`, "", body, "");
  }

  return out.join("\n").trimEnd() + "\n";
}

/** Trigger a download of the thread as a `.md` file. */
export function downloadThread(messages: readonly Message[], filename = "conversation.md", title?: string): void {
  const blob = new Blob([threadToMarkdown(messages, title)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking immediately can race the download in some browsers; one frame is
  // enough for the click to have been consumed.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

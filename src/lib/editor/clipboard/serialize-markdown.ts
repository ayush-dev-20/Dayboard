import { isAllowedLink } from "../schema";
import { markerFor } from "../list-markers";
import type { TiptapNode } from "../types";

// Markdown text for the plain-text flavour and for "Copy as Markdown" (V2 feature 02 §4). Numbered
// items use the markers shown on screen (1. a. i.) with indentation, so the text reads like the
// editor and Dayboard can read it back. Pure: nodes in, string out.

/** Characters that would turn into formatting if left as they are. */
function escapeInline(value: string): string {
  let out = value.replace(/[\\`*[\]]/g, "\\$&");
  // Underscores only matter at a word edge (snake_case stays as it is).
  out = out.replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace("_", "\\_"));
  out = out.replace(/~~/g, "\\~\\~");
  out = out.replace(/<(?=[a-zA-Z/])/g, "\\<");
  return out;
}

/** A line that would start a block (heading, list, quote, fence) is escaped at its marker. */
function escapeLineStart(line: string): string {
  const numbered = /^(\s*\d{1,7})([.)])(\s)/.exec(line);
  if (numbered) return line.replace(/^(\s*\d{1,7})([.)])/, "$1\\$2");
  if (/^(\s*)(#{1,6}\s|>|[-+*]\s|`{3,}|~{3,}|([-*_])(\s*\3){2,}\s*$)/.test(line)) {
    return line.replace(/^(\s*)(.)/, "$1\\$2");
  }
  return line;
}

function inline(nodes: TiptapNode[] | undefined): string {
  let out = "";
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      out += "  \n";
      continue;
    }
    if (node.type !== "text") continue;
    const marks = new Set((node.marks ?? []).map((m) => m.type));
    const raw = node.text ?? "";
    if (marks.has("code")) {
      const fence = raw.includes("`") ? "``" : "`";
      const body = `${fence}${raw.startsWith("`") || raw.endsWith("`") ? ` ${raw} ` : raw}${fence}`;
      out += wrapLink(body, node);
      continue;
    }
    // Spaces at the edges stay outside the markers (`** a **` is not bold).
    const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw) ?? [];
    if (core === "") {
      out += raw;
      continue;
    }
    let text = escapeInline(core);
    if (marks.has("strike")) text = `~~${text}~~`;
    if (marks.has("italic")) text = `*${text}*`;
    if (marks.has("bold")) text = `**${text}**`;
    out += lead + wrapLink(text, node) + trail;
  }
  return out;
}

function wrapLink(text: string, node: TiptapNode): string {
  const link = node.marks?.find((m) => m.type === "link");
  const href = link?.attrs?.href;
  if (typeof href !== "string" || !isAllowedLink(href)) return text;
  return `[${text}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20")})`;
}

const indentLines = (lines: string[], pad: string) =>
  lines.map((line) => (line === "" ? line : pad + line));

type Ctx = { listDepth: number };

function listLines(node: TiptapNode, ctx: Ctx): string[] {
  const items = node.content ?? [];
  const isOrdered = node.type === "orderedList";
  const isTask = node.type === "taskList";
  const depth = isTask ? ctx.listDepth : ctx.listDepth + 1;
  const start =
    isOrdered && typeof node.attrs?.start === "number" && node.attrs.start > 0
      ? node.attrs.start
      : 1;
  const lines: string[] = [];

  items.forEach((item, index) => {
    const marker = isTask
      ? `- [${item.attrs?.checked === true ? "x" : " "}]`
      : isOrdered
        ? markerFor("ordered", depth, start + index)
        : "-";
    const pad = " ".repeat(marker.length + 1);
    const children = item.content ?? [];
    let lead = 0;
    while (children[lead]?.type === "paragraph") lead += 1;
    const own = children.slice(0, lead).map((p) => inline(p.content).replace(/ {2}\n/g, "\n"));
    const text = own.join("\n").split("\n");
    lines.push(`${marker} ${escapeLineStart(text[0] ?? "")}`.trimEnd());
    for (const extra of text.slice(1)) lines.push(pad + extra);
    for (const child of children.slice(lead)) {
      lines.push(...indentLines(blockLines(child, { listDepth: depth }), pad));
    }
  });
  return lines;
}

function tableLines(node: TiptapNode): string[] {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((p) =>
          inline(p.content)
            .replace(/ {2}\n/g, " ")
            .replace(/\|/g, "\\|"),
        )
        .join(" ")
        .trim(),
    ),
  );
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((r) => r.length), 1);
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [
    line(rows[0]!),
    line(Array.from({ length: width }, () => "---")),
    ...rows.slice(1).map(line),
  ];
}

function blockLines(node: TiptapNode, ctx: Ctx): string[] {
  const content = node.content ?? [];
  switch (node.type) {
    case "paragraph": {
      const text = inline(content);
      return text === "" ? [] : text.split("\n").map(escapeLineStart);
    }
    case "heading": {
      const level = node.attrs?.level === 1 || node.attrs?.level === 2 ? node.attrs.level : 3;
      return [`${"#".repeat(level)} ${inline(content).replace(/ {2}\n/g, " ")}`];
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return listLines(node, ctx);
    case "blockquote":
      return quote(join(content, ctx));
    case "callout": {
      const emoji = typeof node.attrs?.emoji === "string" ? node.attrs.emoji : "💡";
      const body = join(content, ctx);
      body[0] = `${emoji} ${body[0] ?? ""}`.trimEnd();
      return quote(body);
    }
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const body = content.map((n) => n.text ?? "").join("");
      const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(longest + 1);
      return [`${fence}${language}`, ...body.split("\n"), fence];
    }
    case "horizontalRule":
      return ["---"];
    case "toggle": {
      const summary = content[0];
      const level = Number(summary?.attrs?.level) || 0;
      const title = inline(summary?.content).replace(/ {2}\n/g, " ");
      const head = level > 0 ? `${"#".repeat(level)} ${title}` : escapeLineStart(title);
      const body = join(content[1]?.content ?? [], ctx);
      return [head, ...(body.length > 0 ? ["", ...indentLines(body, "  ")] : [])];
    }
    case "table":
      return tableLines(node);
    default:
      return [];
  }
}

const quote = (lines: string[]) => lines.map((line) => (line === "" ? ">" : `> ${line}`));

/** Blocks separated by a blank line, except that a list stays together. */
function join(blocks: TiptapNode[], ctx: Ctx): string[] {
  const out: string[] = [];
  for (const node of blocks) {
    const lines = blockLines(node, ctx);
    if (lines.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(...lines);
  }
  return out;
}

/** Whole blocks as Markdown. */
export function serializeMarkdown(blocks: TiptapNode[]): string {
  return join(blocks, { listDepth: 0 }).join("\n");
}

/** Inline content as Markdown without block syntax, for a selection inside one text block. */
export function serializeInlineMarkdown(nodes: TiptapNode[]): string {
  return inline(nodes).replace(/ {2}\n/g, "\n");
}

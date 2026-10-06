import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "./limits";
import { isAllowedLink, MAX_DOC_BYTES, sanitizeDoc } from "./schema";
import type { TiptapDoc, TiptapMark, TiptapNode } from "./types";

// Markdown from an AI → the editor's own document, and nothing the editor can't hold (feature 08
// §4.1). Pure, no I/O, no dependencies, and it never throws: syntax it doesn't know degrades to
// paragraph text. Whatever it returns passes `sanitizeDoc`.
//
// It also reads text that is still arriving (`final: false`): complete lines parse normally, the
// last unfinished line is shown as plain text without half-formed marks, and an open code fence
// shows its lines so far.

export type MarkdownOptions = {
  /** The text is complete. Without it, the last line may still be growing. */
  final?: boolean;
};

export type MarkdownResult = { doc: TiptapDoc; truncated: boolean };

const MAX_LIST_DEPTH = 3;
const MAX_QUOTE_DEPTH = 3;

// ---- Inline -----------------------------------------------------------------------------------

type Mark = TiptapMark;

const TAG = /^<\/?[a-zA-Z][^<>]*>/;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~>|]/;

function withMark(marks: Mark[], mark: Mark): Mark[] {
  return marks.some((m) => m.type === mark.type) ? marks : [...marks, mark];
}

function textNode(text: string, marks: Mark[]): TiptapNode | null {
  if (text === "") return null;
  // The code mark excludes every other mark in the editor.
  const useMarks = marks.some((m) => m.type === "code") ? [{ type: "code" }] : marks;
  return useMarks.length > 0
    ? { type: "text", text, marks: useMarks.map((m) => ({ ...m })) }
    : { type: "text", text };
}

/** Joins neighbouring text with the same marks and drops empty pieces. */
function merge(nodes: (TiptapNode | null)[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const node of nodes) {
    if (!node || node.text === "") continue;
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      last.text = (last.text ?? "") + (node.text ?? "");
    } else {
      out.push({ ...node });
    }
  }
  return out;
}

function findClosing(text: string, from: number, token: string): number {
  let i = from;
  while (i < text.length) {
    const at = text.indexOf(token, i);
    if (at === -1) return -1;
    // Skip an escaped delimiter.
    if (at > 0 && text[at - 1] === "\\") {
      i = at + token.length;
      continue;
    }
    return at;
  }
  return -1;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

function parseInline(text: string, marks: Mark[] = [], depth = 0): TiptapNode[] {
  if (depth > 6) return merge([textNode(text, marks)]);
  const out: (TiptapNode | null)[] = [];
  let buffer = "";
  const flush = () => {
    out.push(textNode(buffer, marks));
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i]!;

    if (c === "\\" && i + 1 < text.length && ESCAPABLE.test(text[i + 1]!)) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (c === "<") {
      const tag = TAG.exec(text.slice(i));
      if (tag) {
        if (/^<br\s*\/?>/i.test(tag[0])) buffer += " ";
        i += tag[0].length;
        continue;
      }
    }

    if (c === "`") {
      const close = text.indexOf("`", i + 1);
      if (close > i + 1) {
        flush();
        out.push(textNode(text.slice(i + 1, close), [{ type: "code" }]));
        i = close + 1;
        continue;
      }
    }

    if (c === "!" && text[i + 1] === "[") {
      const image = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(text.slice(i));
      if (image) {
        // An image has no place in the editor: keep what it says.
        buffer += image[1] ?? "";
        i += image[0].length;
        continue;
      }
    }

    if (c === "[") {
      // The address may hold one level of brackets, e.g. a link to "f(x)".
      const link = /^\[([^\]]+)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)/.exec(
        text.slice(i),
      );
      if (link) {
        flush();
        const url = link[2]!;
        const inner = isAllowedLink(url)
          ? withMark(marks, { type: "link", attrs: { href: url } })
          : marks;
        out.push(...parseInline(link[1]!, inner, depth + 1));
        i += link[0].length;
        continue;
      }
    }

    if (c === "*" || c === "_" || c === "~") {
      const double = text.startsWith(c + c, i);
      const token = double ? c + c : c;
      // `~~` strikes; `**` and `__` are bold; a single `*` or `_` is italic; a lone `~` is text.
      const markType = c === "~" ? (double ? "strike" : null) : double ? "bold" : "italic";
      if (markType) {
        const start = i + token.length;
        // `_` inside a word (snake_case) is just text.
        const wordInside = c === "_" && isWordChar(text[i - 1]);
        const next = text[start];
        if (!wordInside && next !== undefined && !/\s/.test(next)) {
          let close = findClosing(text, start, token);
          // For a single `*`, a `**` is not the closer.
          while (close !== -1 && !double && text[close + 1] === c)
            close = findClosing(text, close + 2, token);
          // `***` ends a bold inside an italic (or the reverse): the pair that closes this mark is
          // the last two characters of the run, so the outer mark can use the first.
          if (close !== -1 && double) {
            let runEnd = close;
            while (text[runEnd] === c) runEnd += 1;
            if (runEnd - close > token.length) close = runEnd - token.length;
          }
          if (
            close > start &&
            !/\s/.test(text[close - 1]!) &&
            !(c === "_" && isWordChar(text[close + token.length]))
          ) {
            flush();
            out.push(
              ...parseInline(
                text.slice(start, close),
                withMark(marks, { type: markType }),
                depth + 1,
              ),
            );
            i = close + token.length;
            continue;
          }
        }
      }
    }

    buffer += c;
    i += 1;
  }
  flush();
  return merge(out);
}

/** For a line that is still arriving: drop delimiters that haven't been closed yet. */
function trimUnfinished(line: string): string {
  let s = line;
  // A link cut off in the middle shows just its text.
  s = s.replace(/\[([^\]]*)\]\([^)]*$/, "$1").replace(/\[[^\]]*$/, (m) => m.slice(1));
  const odd = (pattern: RegExp) => (s.match(pattern)?.length ?? 0) % 2 === 1;
  const dropLast = (token: string) => {
    const at = s.lastIndexOf(token);
    if (at !== -1) s = s.slice(0, at) + s.slice(at + token.length);
  };
  if (odd(/`/g)) dropLast("`");
  if (odd(/\*\*/g)) dropLast("**");
  if (odd(/~~/g)) dropLast("~~");
  // A single `*` left open: drop the last one that isn't half of a `**`.
  const singles = [...s.matchAll(/(?<!\*)\*(?!\*)/g)];
  if (singles.length % 2 === 1) {
    const at = singles[singles.length - 1]!.index!;
    s = s.slice(0, at) + s.slice(at + 1);
  }
  return s;
}

// ---- Blocks -----------------------------------------------------------------------------------

type ListKind = "bullet" | "ordered" | "task";
type Item = { indent: number; kind: ListKind; checked: boolean; start: number; text: string };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,7}[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const paragraph = (text: string, partial = false): TiptapNode | null => {
  const nodes = parseInline(partial ? trimUnfinished(text) : text);
  return nodes.length > 0 ? { type: "paragraph", content: nodes } : null;
};

const isBlockStart = (line: string) =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  RULE.test(line) ||
  QUOTE.test(line) ||
  LIST_ITEM.test(line);

function indentWidth(spaces: string): number {
  return spaces.replace(/\t/g, "    ").length;
}

function itemFromLine(line: string): Item | null {
  const m = LIST_ITEM.exec(line);
  if (!m) return null;
  const marker = m[2]!;
  let text = m[3]!;
  const ordered = /\d/.test(marker);
  let kind: ListKind = ordered ? "ordered" : "bullet";
  let checked = false;
  if (!ordered) {
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
    if (task) {
      kind = "task";
      checked = task[1] !== " ";
      text = task[2]!;
    }
  }
  return {
    indent: indentWidth(m[1]!),
    kind,
    checked,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    text,
  };
}

type ListFrame = { indent: number; kind: ListKind; node: TiptapNode; depth: number };

function itemNode(item: Item, partial: boolean): TiptapNode {
  const p = paragraph(item.text, partial) ?? { type: "paragraph" };
  return item.kind === "task"
    ? { type: "taskItem", attrs: { checked: item.checked }, content: [p] }
    : { type: "listItem", content: [p] };
}

function newList(item: Item): TiptapNode {
  if (item.kind === "task") return { type: "taskList", content: [] };
  if (item.kind === "ordered") {
    return item.start > 1 && item.start <= 1_000_000
      ? { type: "orderedList", attrs: { start: item.start }, content: [] }
      : { type: "orderedList", content: [] };
  }
  return { type: "bulletList", content: [] };
}

/** Turns consecutive list lines (with their indented continuations) into nested lists. */
function buildList(items: Item[], partialLast: boolean): TiptapNode[] {
  const roots: TiptapNode[] = [];
  const stack: ListFrame[] = [];

  items.forEach((item, index) => {
    const node = itemNode(item, partialLast && index === items.length - 1);
    while (stack.length > 0 && stack[stack.length - 1]!.indent > item.indent) stack.pop();

    let top = stack[stack.length - 1];
    if (top && top.indent === item.indent && top.kind !== item.kind) {
      stack.pop();
      top = stack[stack.length - 1];
    }

    if (!top || top.indent < item.indent) {
      // Deeper than the current list: nest inside its last item, unless that would break the
      // editor's rules (no lists inside checklist items, at most three levels deep).
      const parent = top?.node.content?.at(-1);
      const depth = (top?.depth ?? 0) + 1;
      if (top && parent && top.kind !== "task" && depth <= MAX_LIST_DEPTH) {
        const list = newList(item);
        parent.content = [...(parent.content ?? []), list];
        stack.push({ indent: item.indent, kind: item.kind, node: list, depth });
        list.content!.push(node);
        return;
      }
      if (top) {
        // Flatten into the list we are already in, as one of its own kind of item.
        top.node.content!.push(top.kind === "task" ? asTaskItem(node) : asListItem(node));
        return;
      }
      const list = newList(item);
      roots.push(list);
      stack.push({ indent: item.indent, kind: item.kind, node: list, depth: 1 });
      list.content!.push(node);
      return;
    }

    // Same level as the current list.
    if (top.kind !== item.kind) {
      const list = newList(item);
      roots.push(list);
      stack.length = 0;
      stack.push({ indent: item.indent, kind: item.kind, node: list, depth: 1 });
      list.content!.push(node);
      return;
    }
    top.node.content!.push(node);
  });
  return roots;
}

function asTaskItem(node: TiptapNode): TiptapNode {
  return node.type === "taskItem"
    ? node
    : { type: "taskItem", attrs: { checked: false }, content: node.content?.slice(0, 1) };
}

function asListItem(node: TiptapNode): TiptapNode {
  return node.type === "listItem" ? node : { type: "listItem", content: node.content?.slice(0, 1) };
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * A pipe table becomes a real table (V2 feature 01): the first row is the header. Rows are made the
 * same width, and a table over the limits keeps its first columns and rows.
 */
function convertTable(rows: string[]): TiptapNode[] {
  const parsed = rows.map(splitRow).slice(0, TABLE_MAX_ROWS);
  const width = Math.min(Math.max(...parsed.map((cells) => cells.length), 1), TABLE_MAX_COLUMNS);
  const cell = (type: "tableHeader" | "tableCell", text: string): TiptapNode => ({
    type,
    content: [{ type: "paragraph", ...(text ? { content: parseInline(text) } : {}) }],
  });
  const table: TiptapNode = {
    type: "table",
    content: parsed.map((cells, index) => ({
      type: "tableRow",
      content: Array.from({ length: width }, (_, column) =>
        cell(index === 0 ? "tableHeader" : "tableCell", cells[column] ?? ""),
      ),
    })),
  };
  return [table];
}

function parseBlocks(lines: string[], partialLast: boolean, quoteDepth = 0): TiptapNode[] {
  const out: TiptapNode[] = [];
  let i = 0;
  const lastIndex = lines.length - 1;
  const isPartial = (index: number) => partialLast && index === lastIndex;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code: everything up to the closing fence, verbatim. Still open while streaming.
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]![0]!.repeat(3);
      const language = fence[2]!.slice(0, 32);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker}+\\s*$`).test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // the closing fence (or the end of the text)
      const text = body.join("\n");
      out.push({
        type: "codeBlock",
        ...(language ? { attrs: { language } } : {}),
        ...(text ? { content: [{ type: "text", text }] } : {}),
      });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const content = parseInline(isPartial(i) ? trimUnfinished(heading[2]!) : heading[2]!);
      out.push({
        type: "heading",
        attrs: { level: Math.min(heading[1]!.length, 3) },
        ...(content.length > 0 ? { content } : {}),
      });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ type: "horizontalRule" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      const start = i;
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        inner.push(QUOTE.exec(lines[i]!)![1]!);
        i += 1;
      }
      const touchesEnd = partialLast && i - 1 === lastIndex;
      const content =
        quoteDepth >= MAX_QUOTE_DEPTH
          ? inner.map((l) => paragraph(l)).filter((n): n is TiptapNode => n !== null)
          : parseBlocks(inner, touchesEnd, quoteDepth + 1);
      if (content.length > 0) out.push({ type: "blockquote", content });
      if (i === start) i += 1;
      continue;
    }

    if (LIST_ITEM.test(line) && !RULE.test(line)) {
      const items: Item[] = [];
      let touchesEnd = false;
      while (i < lines.length) {
        const current = lines[i]!;
        const item = itemFromLine(current);
        if (item && !RULE.test(current)) {
          items.push(item);
          touchesEnd = isPartial(i);
          i += 1;
        } else if (
          items.length > 0 &&
          current.trim() !== "" &&
          /^\s+\S/.test(current) &&
          !isBlockStart(current)
        ) {
          // An indented continuation line belongs to the item above.
          items[items.length - 1]!.text += ` ${current.trim()}`;
          touchesEnd = isPartial(i);
          i += 1;
        } else {
          break;
        }
      }
      out.push(...buildList(items, touchesEnd));
      continue;
    }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
      const rows = [line];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        rows.push(lines[i]!);
        i += 1;
      }
      out.push(...convertTable(rows));
      continue;
    }

    // A paragraph: lines up to a blank line or the next kind of block, joined with spaces.
    const parts: string[] = [];
    let touchesEnd = false;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      (parts.length === 0 || !isBlockStart(lines[i]!))
    ) {
      parts.push(lines[i]!.trim());
      touchesEnd = isPartial(i);
      i += 1;
    }
    const p = paragraph(parts.join(" "), touchesEnd);
    if (p) out.push(p);
  }
  return out;
}

// ---- Public -----------------------------------------------------------------------------------

/** The longest run of blocks from the start that stays within the document size limit. */
function withinLimit(blocks: TiptapNode[]): { kept: TiptapNode[]; truncated: boolean } {
  const encoder = new TextEncoder();
  // Room for the wrapper object; each block costs its own JSON plus a comma.
  let used = 24;
  for (let i = 0; i < blocks.length; i += 1) {
    used += encoder.encode(JSON.stringify(blocks[i])).length + 1;
    if (used > MAX_DOC_BYTES) return { kept: blocks.slice(0, i), truncated: true };
  }
  return { kept: blocks, truncated: false };
}

/** The plain-text fallback used if (against all expectation) a result fails sanitizing. */
function plainFallback(markdown: string): TiptapDoc {
  const content = markdown
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((text): TiptapNode => ({ type: "paragraph", content: [{ type: "text", text }] }));
  return { type: "doc", content: content.slice(0, 500) };
}

export function convertMarkdown(markdown: string, options: MarkdownOptions = {}): MarkdownResult {
  try {
    const normalized = markdown.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    // Without a final newline the last line may still be growing.
    const partialLast = !options.final && !normalized.endsWith("\n") && lines.length > 0;
    const { kept, truncated } = withinLimit(parseBlocks(lines, partialLast));
    return { doc: sanitizeDoc({ type: "doc", content: kept }), truncated };
  } catch {
    return { doc: plainFallback(markdown), truncated: false };
  }
}

/** Markdown (possibly still arriving) as an editor document. Never throws. */
export function markdownToDoc(markdown: string, options: MarkdownOptions = {}): TiptapDoc {
  return convertMarkdown(markdown, options).doc;
}

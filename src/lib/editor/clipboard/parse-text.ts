import { LIST_MAX_DEPTH, MESSAGES } from "../limits";
import { fitToBudget } from "./budget";
import { convertMarkdown } from "../markdown";
import type { TiptapDoc, TiptapNode } from "../types";
import { plainInline, paragraphOf } from "./inline";
import { classifyLine, type LineMarker } from "./list-lines";
import { buildNestedLists, type FlatItem } from "./lists";

// Plain text from the clipboard → the editor's document (V2 feature 02 §5). Text that is clearly
// Markdown goes through the same converter as AI output. Everything else is paragraphs, except that
// lines starting with a bullet or a number are lists (this is how a list copied from Slack arrives
// when the tool gives only text). Pasted lists always take the marker style of their depth.

export type ParseTextResult = {
  doc: TiptapDoc;
  kind: "markdown" | "plain";
  notices: string[];
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}\s+\S/;
const QUOTE = /^\s{0,3}>\s?\S/;
const MD_LIST = /^[ \t]*([-*+]|\d{1,7}[.)])[ \t]+\S/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const WEAK = [/\*\*[^*\n]+\*\*/, /\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/, /`[^`\n]+`/, /~~[^~\n]+~~/];

/**
 * True when the text clearly contains Markdown: one strong signal at the start of a line
 * (heading, fence, list marker with content, quote, pipe table), or two weak ones inside lines
 * (bold, link, inline code, strikethrough). A single stray `*` or `#` does not count.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (FENCE.test(line)) return true;
    if (HEADING.test(line) || QUOTE.test(line) || MD_LIST.test(line)) return true;
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) return true;
  }
  return WEAK.filter((pattern) => pattern.test(text)).length >= 2;
}

type Entry =
  | { type: "blank" }
  | { type: "text"; text: string; indent: number }
  | { type: "item"; marker: LineMarker };

/**
 * Classifies every line. A lettered marker ("a.", "ii.") is believed only in a run of two or more
 * list lines, or beside a clearer one, so a sentence that starts "I. " is left alone.
 */
function classify(lines: string[]): Entry[] {
  const found = lines.map((line) => (line.trim() === "" ? null : classifyLine(line)));
  const accepted = found.map(() => false);

  let i = 0;
  while (i < lines.length) {
    if (!found[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && found[j]) j += 1;
    const run = found.slice(i, j) as LineMarker[];
    const believed = run.length >= 2 || run.some((marker) => !marker.ambiguous);
    for (let k = i; k < j; k += 1) accepted[k] = believed;
    i = j;
  }

  return lines.map((line, index): Entry => {
    if (line.trim() === "") return { type: "blank" };
    if (found[index] && accepted[index]) return { type: "item", marker: found[index]! };
    return { type: "text", text: line.trim(), indent: line.length - line.trimStart().length };
  });
}

function blocksFrom(entries: Entry[]): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  const items: FlatItem[] = [];
  const stack: number[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(paragraphOf(plainInline(paragraph.join(" "))));
      paragraph = [];
    }
  };
  const flushItems = () => {
    if (items.length > 0) {
      blocks.push(...buildNestedLists(items));
      items.length = 0;
      stack.length = 0;
    }
  };

  for (const entry of entries) {
    if (entry.type === "blank") {
      flushParagraph();
      flushItems();
      continue;
    }
    if (entry.type === "item") {
      flushParagraph();
      const { marker } = entry;
      while (stack.length > 0 && stack.at(-1)! > marker.indent) stack.pop();
      if (stack.length === 0 || stack.at(-1)! < marker.indent) stack.push(marker.indent);
      items.push({
        depth: stack.length - 1,
        kind: marker.kind,
        ...(marker.start ? { start: marker.start } : {}),
        ...(marker.kind === "task" ? { checked: marker.checked === true } : {}),
        content: [paragraphOf(plainInline(marker.rest.trim()))],
      });
      continue;
    }
    // A line indented under an item continues it.
    if (items.length > 0 && entry.indent > 0) {
      const last = items.at(-1)!;
      const text = `${last.content[0]!.content?.map((n) => n.text ?? "").join("") ?? ""} ${entry.text}`;
      last.content = [paragraphOf(plainInline(text.trim()))];
      continue;
    }
    flushItems();
    paragraph.push(entry.text);
  }
  flushParagraph();
  flushItems();
  return blocks;
}

/** Rewrites list markers Markdown does not know (•, a., (1), ☐) into ones it does, outside fences. */
function toMarkdownLists(lines: string[]): string[] {
  const entries = classify(lines);
  let fence: string | null = null;
  return lines.map((line, index) => {
    const marker = FENCE.exec(line);
    if (marker) {
      const mark = marker[1]![0]!;
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      return line;
    }
    const entry = entries[index]!;
    if (fence !== null || entry.type !== "item") return line;
    const { marker: m } = entry;
    const pad = " ".repeat(m.indent);
    if (m.kind === "task") return `${pad}- [${m.checked ? "x" : " "}] ${m.rest}`;
    if (m.kind === "ordered") return `${pad}${m.start ?? 1}. ${m.rest}`;
    return `${pad}- ${m.rest}`;
  });
}

export function parseText(text: string): ParseTextResult {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const lines = normalized.split("\n");

  if (looksLikeMarkdown(normalized)) {
    const result = convertMarkdown(toMarkdownLists(lines).join("\n"), {
      final: true,
      maxListDepth: LIST_MAX_DEPTH,
    });
    return {
      doc: result.doc,
      kind: "markdown",
      notices: [
        ...(result.tableCut ? [MESSAGES.tableCut] : []),
        ...(result.truncated ? [MESSAGES.pasteShortened] : []),
      ],
    };
  }

  const { blocks, shortened } = fitToBudget(blocksFrom(classify(lines)), 0);
  return {
    doc: { type: "doc", content: blocks },
    kind: "plain",
    notices: shortened ? [MESSAGES.pasteShortened] : [],
  };
}

/** Text with no detection at all: one paragraph per line (the Cmd/Ctrl+Shift+V paste). */
export function plainParagraphs(text: string): TiptapNode[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => paragraphOf(plainInline(line)));
}

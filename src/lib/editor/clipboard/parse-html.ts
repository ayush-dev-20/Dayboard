import { EditorDocError, isAllowedLink, MAX_DOC_BYTES, sanitizeDoc } from "../schema";
import { MESSAGES, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "../limits";
import type { TiptapDoc, TiptapMark, TiptapNode } from "../types";
import { fitToBudget } from "./budget";
import { fitTop } from "./fit";
import { paragraphOf, plainInline, textNode, trimInline, withoutBold } from "./inline";
import { buildNestedLists, type FlatItem, type ListKind } from "./lists";
import { detectProducer } from "./producers";
import {
  MONOSPACE,
  styleOf,
  type Producer,
  type ProducerApi,
  type ProducerName,
} from "./producers/types";
import { classifyLine, type LineMarker } from "./list-lines";

// HTML from the clipboard → the editor's document (V2 feature 02 §5). The HTML is parsed into an
// inert document (no script runs, nothing loads), walked, and rebuilt from the nodes the editor
// allows; nothing is inserted as markup. Colours, fonts, sizes, classes and unknown elements are
// dropped. The result passes `sanitizeDoc`.

/** Larger pastes are read as plain text instead. */
export const MAX_HTML_CHARS = 2_000_000;

export type ParseHtmlOptions = {
  /** The language VS Code reported (its `vscode-editor-data` flavour). */
  vscodeMode?: string;
};

export type ParseHtmlResult = {
  doc: TiptapDoc;
  producer: ProducerName;
  /** Quiet messages for the person ("Table was cut…"). */
  notices: string[];
};

const SKIP = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "video",
  "audio",
  "button",
  "select",
  "textarea",
  "noscript",
  "template",
  "head",
  "title",
  "meta",
  "link",
  "base",
  "applet",
  "frame",
  "frameset",
  "input",
  "caption",
  "colgroup",
  "col",
  "map",
  "math",
  "dialog",
]);

/** Elements that start and end a line of their own; their children are read as blocks. */
const CONTAINERS = new Set([
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "nav",
  "address",
  "figure",
  "figcaption",
  "center",
  "form",
  "fieldset",
  "dl",
  "dt",
  "dd",
  "li",
  "body",
  "html",
  "hgroup",
  "legend",
  "tbody",
  "thead",
  "tfoot",
  "tr",
  "td",
  "th",
  "details",
  "summary",
]);

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const collapse = (value: string) =>
  value
    .replace(ZERO_WIDTH, "")
    .replace(/[   ]/g, " ")
    .replace(/[ \t\n\r\f]+/g, " ");

const tagOf = (node: Node) => (node as Element).localName?.toLowerCase() ?? "";
const isElement = (node: Node): node is Element => node.nodeType === 1;

// ---- Marks -----------------------------------------------------------------------------------

function withMark(marks: TiptapMark[], mark: TiptapMark): TiptapMark[] {
  return [...marks.filter((m) => m.type !== mark.type), mark];
}
const withoutMark = (marks: TiptapMark[], type: string) => marks.filter((m) => m.type !== type);

/** The marks for the content of `el`, from its tag and its inline style. */
function marksFor(el: Element, marks: TiptapMark[]): TiptapMark[] {
  const tag = tagOf(el);
  const style = styleOf(el);
  let next = marks;

  if (tag === "strong" || tag === "b") next = withMark(next, { type: "bold" });
  if (tag === "em" || tag === "i" || tag === "cite" || tag === "dfn")
    next = withMark(next, { type: "italic" });
  if (tag === "u" || tag === "ins") next = withMark(next, { type: "underline" });
  if (tag === "s" || tag === "del" || tag === "strike") next = withMark(next, { type: "strike" });
  if (["code", "kbd", "samp", "tt"].includes(tag)) next = withMark(next, { type: "code" });

  const weight = style["font-weight"];
  if (weight) {
    const numeric = Number(weight);
    if (weight === "bold" || weight === "bolder" || numeric >= 600)
      next = withMark(next, { type: "bold" });
    else if (weight === "normal" || weight === "lighter" || numeric <= 500)
      next = withoutMark(next, "bold");
  }
  const fontStyle = style["font-style"];
  if (fontStyle === "italic" || fontStyle === "oblique") next = withMark(next, { type: "italic" });
  else if (fontStyle === "normal") next = withoutMark(next, "italic");

  const decoration = `${style["text-decoration"] ?? ""} ${style["text-decoration-line"] ?? ""}`;
  // Links are underlined by default and Google Docs says so again on every link: not a mark.
  const inLink = next.some((m) => m.type === "link");
  if (decoration.includes("underline") && !inLink) next = withMark(next, { type: "underline" });
  if (decoration.includes("line-through")) next = withMark(next, { type: "strike" });

  if (MONOSPACE.test(style["font-family"] ?? "")) next = withMark(next, { type: "code" });

  if (tag === "a") {
    const href = el.getAttribute("href")?.trim() ?? "";
    // Only absolute, safe addresses: a relative link means nothing once it leaves its page.
    if (href && isAllowedLink(href))
      next = withMark(withoutMark(next, "underline"), { type: "link", attrs: { href } });
  }
  return next;
}

// ---- Walker ----------------------------------------------------------------------------------

/** Deeper than any real page nests its content; below this the text is taken as it is. */
const MAX_WALK_DEPTH = 120;

type Walk = {
  depth: number;
  /** Size of the blocks collected for the whole paste so far (characters of JSON). */
  bytes: number;
  /** The paste is already larger than a document can be; the rest is not read. */
  full: boolean;
  producer: Producer;
  notices: Set<string>;
  api: ProducerApi;
};

/** Gathers the blocks and inline runs found while walking, in document order. */
class Collector {
  blocks: TiptapNode[] = [];
  inline: TiptapNode[] = [];
  items: FlatItem[] = [];

  constructor(
    readonly walk: Walk,
    readonly inlineOnly = false,
    /** The collector for the whole paste: it stops the walk once there is more than a document can hold. */
    readonly root = false,
  ) {}

  pushBlocks(nodes: TiptapNode[]) {
    this.blocks.push(...nodes);
    if (!this.root) return;
    for (const node of nodes) this.walk.bytes += JSON.stringify(node).length + 1;
    if (this.walk.bytes > MAX_DOC_BYTES) this.walk.full = true;
  }

  addText(value: string, marks: TiptapMark[]) {
    const text = collapse(value);
    if (text === "") return;
    const blank = text.trim() === "";
    if (blank && this.inline.length === 0) return;
    if (!blank && this.items.length > 0) this.flushItems();
    const node = textNode(text, marks);
    if (node) this.inline.push(node);
  }

  breakLine() {
    const last = this.inline.at(-1);
    if (this.inline.length === 0 && !this.inlineOnly) return;
    if (last?.type === "hardBreak") return;
    this.inline.push({ type: "hardBreak" });
  }

  /** A block boundary inside inline-only content (a table cell): one line break, no more. */
  softBreak() {
    if (this.inline.length > 0 && this.inline.at(-1)?.type !== "hardBreak") {
      this.inline.push({ type: "hardBreak" });
    }
  }

  flushItems() {
    if (this.items.length === 0) return;
    this.pushBlocks(buildNestedLists(this.items));
    this.items = [];
  }

  /** The text collected so far becomes a paragraph, or list items when it is made of bullet lines. */
  flushInline() {
    if (this.inlineOnly) return;
    const run = trimInline(this.inline);
    this.inline = [];
    if (run.length === 0) return;

    const lines = splitLines(run);
    const listLines = lines.map(classifyInline);
    if (listLines.every((line) => line !== null)) {
      // Lines of bullets (Slack and others copy lists as text with a glyph in front).
      for (const [index, line] of listLines.entries()) {
        this.items.push({
          depth: 0,
          kind: line!.kind,
          ...(line!.start ? { start: line!.start } : {}),
          content: [paragraphOf(stripInlineMarker(lines[index]!, line!))],
        });
      }
      return;
    }
    this.flushItems();
    this.pushBlocks([paragraphOf(run)]);
  }

  flush() {
    this.flushInline();
    this.flushItems();
  }

  addBlocks(nodes: TiptapNode[]) {
    this.flush();
    this.pushBlocks(nodes);
  }

  done(): TiptapNode[] {
    this.flush();
    return this.blocks;
  }
}

function splitLines(run: TiptapNode[]): TiptapNode[][] {
  const lines: TiptapNode[][] = [[]];
  for (const node of run) {
    if (node.type === "hardBreak") lines.push([]);
    else lines.at(-1)!.push(node);
  }
  return lines.filter((line) => line.length > 0);
}

/** A line of inline nodes that begins with a bullet glyph (or, for two lines or more, a number). */
function classifyInline(line: TiptapNode[]) {
  const first = line[0];
  if (first?.type !== "text") return null;
  const found = classifyLine(first.text ?? "");
  // A glyph bullet is clear on its own; "1." at the start of a paragraph is prose too often.
  if (!found || !found.glyph) return null;
  return found;
}

function stripInlineMarker(line: TiptapNode[], found: LineMarker) {
  const [first, ...rest] = line;
  const head = found.rest ? [{ ...first!, text: found.rest }] : [];
  return trimInline([...head, ...rest]);
}

function walkChildren(c: Collector, parent: Node, marks: TiptapMark[]) {
  const walk = c.walk;
  if (walk.depth >= MAX_WALK_DEPTH) {
    c.addText(parent.textContent ?? "", marks);
    return;
  }
  walk.depth += 1;
  try {
    parent.childNodes.forEach((child) => walkNode(c, child, marks));
  } finally {
    walk.depth -= 1;
  }
}

function collectInline(el: Element, marks: TiptapMark[], walk: Walk): TiptapNode[] {
  const sub = new Collector(walk, true);
  walkChildren(sub, el, marks);
  return trimInline(sub.inline);
}

function collectBlocks(el: Element, marks: TiptapMark[], walk: Walk, root = false): TiptapNode[] {
  const sub = new Collector(walk, false, root);
  walkChildren(sub, el, marks);
  return sub.done();
}

const ariaLevel = (el: Element): number | null => {
  const level = Number(el.getAttribute("aria-level"));
  return Number.isInteger(level) && level >= 1 ? level - 1 : null;
};

function checkboxOf(li: Element): { checked: boolean } | null {
  if (li.hasAttribute("aria-checked"))
    return { checked: li.getAttribute("aria-checked") === "true" };
  const own = (el: Element | null) => (el && el.closest("li") === li ? el : null);
  const input = own(li.querySelector('input[type="checkbox"]'));
  if (input) return { checked: input.hasAttribute("checked") };
  const box = own(li.querySelector(".checkbox"));
  if (box) return { checked: /checkbox-on|checked/.test(box.getAttribute("class") ?? "") };
  return null;
}

const isList = (node: Node) => ["ul", "ol"].includes(tagOf(node));

function collectItems(
  list: Element,
  base: number,
  marks: TiptapMark[],
  walk: Walk,
  out: FlatItem[],
) {
  const ordered = tagOf(list) === "ol";
  const kind: ListKind = ordered ? "ordered" : "bullet";
  const startAttr = Number.parseInt(list.getAttribute("start") ?? "", 10);
  const start = ordered && Number.isInteger(startAttr) && startAttr > 1 ? startAttr : undefined;
  const levelOfList = walk.producer.level?.(list) ?? null;
  const here = levelOfList ?? base;
  let first = true;

  for (const child of Array.from(list.children)) {
    if (isList(child)) {
      // Google Docs puts a nested list beside the item that owns it.
      collectItems(child, here + 1, marks, walk, out);
      continue;
    }
    if (tagOf(child) !== "li") continue;

    const checkbox = checkboxOf(child);
    const depth = ariaLevel(child) ?? here;
    const own = new Collector(walk);
    const nested: Element[] = [];
    child.childNodes.forEach((node) => {
      if (isElement(node) && isList(node)) nested.push(node);
      else walkNode(own, node, marks);
    });
    out.push({
      depth,
      kind: checkbox ? "task" : kind,
      ...(first && start ? { start } : {}),
      ...(checkbox ? { checked: checkbox.checked } : {}),
      content: own.done(),
    });
    first = false;
    for (const list2 of nested) collectItems(list2, depth + 1, marks, walk, out);
  }
}

const onlyDetails = (li: Element) => {
  const elements = Array.from(li.children);
  const stray = Array.from(li.childNodes).some(
    (node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
  );
  return !stray && elements.length === 1 && tagOf(elements[0]!) === "details";
};

// ---- Code ------------------------------------------------------------------------------------

/** The text of an element with its line breaks: `<br>` and block elements end a line. */
function codeText(el: Node): string {
  let out = "";
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      out += (node.textContent ?? "").replace(ZERO_WIDTH, "").replace(/ /g, " ");
      return;
    }
    if (!isElement(node)) return;
    const tag = tagOf(node);
    if (SKIP.has(tag) && tag !== "caption") return;
    if (tag === "br") {
      out += "\n";
      return;
    }
    const block = CONTAINERS.has(tag) || tag === "p";
    if (block && out !== "" && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach(visit);
    if (block && out !== "" && !out.endsWith("\n")) out += "\n";
  };
  visit(el);
  return out.replace(/^\n/, "").replace(/\n+$/, "");
}

function languageOf(pre: Element, producer: Producer): string | null {
  const code = pre.querySelector("code");
  for (const el of [code, pre]) {
    if (!el) continue;
    const m = /(?:^|\s)(?:language|lang)-([\w+#.-]{1,32})(?:\s|$)/.exec(
      el.getAttribute("class") ?? "",
    );
    if (m) return m[1]!;
    const data = el.getAttribute("data-language") ?? el.getAttribute("data-lang");
    if (data && /^[\w+#.-]{1,32}$/.test(data)) return data;
  }
  return producer.codeLanguage?.(pre) ?? null;
}

// ---- Tables ----------------------------------------------------------------------------------

function tableNode(el: Element, marks: TiptapMark[], walk: Walk): TiptapNode | null {
  const rows = Array.from(el.querySelectorAll("tr")).filter((tr) => tr.closest("table") === el);
  type Cell = { header: boolean; inline: TiptapNode[] };
  const grid: (Cell | undefined)[][] = [];

  rows.forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of Array.from(tr.children)) {
      const tag = tagOf(cell);
      if (tag !== "td" && tag !== "th") continue;
      while (grid[r]![c]) c += 1;
      const colspan = Math.min(
        Math.max(Number.parseInt(cell.getAttribute("colspan") ?? "1", 10) || 1, 1),
        50,
      );
      const rowspan = Math.min(
        Math.max(Number.parseInt(cell.getAttribute("rowspan") ?? "1", 10) || 1, 1),
        200,
      );
      const inline = collectInline(cell, marks, walk);
      for (let dr = 0; dr < rowspan; dr += 1) {
        for (let dc = 0; dc < colspan; dc += 1) {
          grid[r + dr] ??= [];
          grid[r + dr]![c + dc] = {
            header: tag === "th",
            inline: dr === 0 && dc === 0 ? inline : [],
          };
        }
      }
      c += colspan;
    }
  });

  const used = grid.filter((row) => row && row.length > 0);
  if (used.length === 0) return null;
  const widest = Math.max(...used.map((row) => row.length));
  const width = Math.min(widest, TABLE_MAX_COLUMNS);
  if (used.length > TABLE_MAX_ROWS || widest > TABLE_MAX_COLUMNS)
    walk.notices.add(MESSAGES.tableCut);

  return {
    type: "table",
    content: used.slice(0, TABLE_MAX_ROWS).map((row) => ({
      type: "tableRow",
      content: Array.from({ length: width }, (_, column) => {
        const cell = row[column];
        return {
          type: cell?.header ? "tableHeader" : "tableCell",
          content: [paragraphOf(cell?.inline ?? [])],
        };
      }),
    })),
  };
}

// ---- Node by node ----------------------------------------------------------------------------

function walkNode(c: Collector, node: Node, marks: TiptapMark[]) {
  if (c.walk.full) return;
  if (node.nodeType === 3) {
    c.addText(node.textContent ?? "", marks);
    return;
  }
  if (!isElement(node)) return;
  const walk = c.walk;
  const tag = tagOf(node);
  if (SKIP.has(tag)) return;

  if (!c.inlineOnly) {
    const custom = walk.producer.block?.(node, walk.api);
    if (custom) {
      c.addBlocks(custom);
      return;
    }
  }

  // Inside inline-only content (a table cell), every block element is just a line break.
  if (
    c.inlineOnly &&
    (CONTAINERS.has(tag) ||
      [
        "p",
        "ul",
        "ol",
        "pre",
        "blockquote",
        "table",
        "hr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
      ].includes(tag))
  ) {
    c.softBreak();
    walkChildren(c, node, marks);
    c.softBreak();
    return;
  }

  switch (tag) {
    case "br":
      c.breakLine();
      return;
    case "img": {
      const alt = node.getAttribute("alt")?.trim();
      if (alt) c.addText(alt, marks);
      return;
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      c.flush();
      const inline = withoutBold(collectInline(node, marks, walk));
      if (inline.length > 0) {
        c.pushBlocks([
          {
            type: "heading",
            attrs: { level: Math.min(Number(tag[1]), 3) },
            content: inline,
          },
        ]);
      }
      return;
    }
    case "p": {
      const item = walk.producer.listParagraph?.(node, walk.api);
      if (item) {
        c.flushInline();
        c.items.push(item);
        return;
      }
      c.flushInline();
      c.inline.push(...collectInline(node, marks, walk));
      c.flushInline();
      return;
    }
    case "blockquote": {
      const content = collectBlocks(node, marks, walk);
      c.flush();
      if (content.length > 0) c.pushBlocks([{ type: "blockquote", content }]);
      return;
    }
    case "pre": {
      const text = codeText(node);
      const language = languageOf(node, walk.producer);
      c.addBlocks([
        {
          type: "codeBlock",
          ...(language ? { attrs: { language } } : {}),
          ...(text ? { content: [{ type: "text", text }] } : {}),
        },
      ]);
      return;
    }
    case "hr":
      c.addBlocks([{ type: "horizontalRule" }]);
      return;
    case "ul":
    case "ol": {
      const lis = Array.from(node.children).filter((child) => tagOf(child) === "li");
      if (lis.length > 0 && lis.every(onlyDetails)) {
        // Notion writes a toggle as a list of one `<details>`.
        lis.forEach((li) => walkNode(c, li.firstElementChild!, marks));
        return;
      }
      const items: FlatItem[] = [];
      collectItems(node, 0, marks, walk, items);
      c.flushInline();
      c.items.push(...items);
      return;
    }
    case "table": {
      const table = tableNode(node, marks, walk);
      if (table) c.addBlocks([table]);
      return;
    }
    case "details": {
      const summary = Array.from(node.children).find((child) => tagOf(child) === "summary");
      const heading =
        summary && Array.from(summary.children).find((child) => /^h[1-3]$/.test(tagOf(child)));
      const level = heading ? Number(tagOf(heading)[1]) : 0;
      const title = summary ? collectInline(heading ?? summary, marks, walk) : [];
      const body = new Collector(walk);
      node.childNodes.forEach((child) => {
        if (child !== summary) walkNode(body, child, marks);
      });
      const content = body.done();
      c.addBlocks([
        {
          type: "toggle",
          content: [
            {
              type: "toggleSummary",
              attrs: { level },
              content: (level > 0 ? withoutBold(title) : title).filter(
                (n) => n.type === "text" || n.type === "hardBreak",
              ),
            },
            {
              type: "toggleContent",
              content: content.length > 0 ? content : [{ type: "paragraph" }],
            },
          ],
        },
      ]);
      return;
    }
    default:
      break;
  }

  if (CONTAINERS.has(tag)) {
    c.flush();
    walkChildren(c, node, marksFor(node, marks));
    c.flush();
    return;
  }
  // Anything else (span, a, b, font, an unknown element) is a wrapper: its content continues the line.
  walkChildren(c, node, marksFor(node, marks));
}

// ---- Entry -----------------------------------------------------------------------------------

/** Word and others wrap the copied part in these comments; everything outside is page chrome. */
function fragmentOf(html: string): string {
  const start = html.indexOf("<!--StartFragment-->");
  const end = html.indexOf("<!--EndFragment-->");
  return start >= 0 && end > start ? html.slice(start + "<!--StartFragment-->".length, end) : html;
}

const BLOCK_TAG = /<(p|div|h[1-6]|ul|ol|li|table|pre|blockquote|br|hr|details|section|article)\b/i;

/**
 * A fragment of a line (a word or two copied from a web page, with the space that came with it) is
 * pasted into a sentence, where that space matters. Block edges are trimmed everywhere else.
 */
function restoreEdgeSpaces(blocks: TiptapNode[], body: HTMLElement): TiptapNode[] {
  const only = blocks[0];
  if (blocks.length !== 1 || only?.type !== "paragraph" || !only.content?.length) return blocks;
  if (BLOCK_TAG.test(body.innerHTML)) return blocks;
  const text = collapse(body.textContent ?? "");
  const content = only.content.map((node) => ({ ...node }));
  const first = content[0]!;
  const last = content[content.length - 1]!;
  if (text.startsWith(" ") && first.type === "text") first.text = ` ${first.text}`;
  if (text.endsWith(" ") && last.type === "text") last.text = `${last.text} `;
  return [{ ...only, content }];
}

function plainFallback(text: string): TiptapDoc {
  const content = text
    .split(/\n{2,}/)
    .map((chunk) => paragraphOf(plainInline(chunk.replace(/[ \t]+/g, " ").trim())))
    .filter((p) => p.content);
  return { type: "doc", content: content.slice(0, 500) };
}

/**
 * Reads pasted HTML. Returns null when it is too large (the caller reads the plain text instead).
 * Needs a DOM `DOMParser`: the browser, or jsdom in tests.
 */
export function parseHtml(html: string, options: ParseHtmlOptions = {}): ParseHtmlResult | null {
  if (html.length > MAX_HTML_CHARS) return null;
  const parsed = new DOMParser().parseFromString(fragmentOf(html), "text/html");
  const producer = detectProducer(parsed, html);
  producer.prepare?.(parsed.body);

  const walk: Walk = {
    depth: 0,
    bytes: 0,
    full: false,
    producer,
    notices: new Set(),
    api: {
      inline: (el) => collectInline(el, [], walk),
      blocks: (el) => collectBlocks(el, [], walk),
      code: (el) => codeText(el),
      vscodeMode: options.vscodeMode,
    },
  };

  const whole = restoreEdgeSpaces(fitTop(collectBlocks(parsed.body, [], walk, true)), parsed.body);
  // More than a document can hold is cut at a block boundary (the person is told).
  const { blocks, shortened } = fitToBudget(whole, 0);
  if (shortened) walk.notices.add(MESSAGES.pasteShortened);
  let doc: TiptapDoc;
  try {
    doc = sanitizeDoc({ type: "doc", content: blocks });
  } catch (error) {
    if (!(error instanceof EditorDocError)) throw error;
    doc = plainFallback(parsed.body.textContent ?? "");
  }
  return { doc, producer: producer.name, notices: [...walk.notices] };
}

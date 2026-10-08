import { isAllowedLink } from "../schema";
import type { TiptapMark, TiptapNode } from "../types";
import { levelOf } from "../list-markers";

// Clean, plain HTML for other tools (V2 feature 02 §4). Only semantic elements, no classes, ids,
// styles or editor wrappers, tight lists (no <p> inside <li>), each ordered level carrying its
// marker type. The other tool decides what to keep. Pure: nodes in, string out.

const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (value: string) => escapeText(value).replace(/"/g, "&quot;");

const ORDERED_TYPE = { 1: "1", 2: "a", 3: "i" } as const;

type Wrap = (inner: string) => string;

/** Outermost first: the link, then bold, italic, underline, strikethrough, and code innermost. */
const MARK_ORDER = ["link", "bold", "italic", "underline", "strike", "code"];

function wrapFor(mark: TiptapMark): Wrap | null {
  switch (mark.type) {
    case "bold":
      return (s) => `<strong>${s}</strong>`;
    case "italic":
      return (s) => `<em>${s}</em>`;
    case "underline":
      return (s) => `<u>${s}</u>`;
    case "strike":
      return (s) => `<s>${s}</s>`;
    case "code":
      return (s) => `<code>${s}</code>`;
    case "link": {
      const href = mark.attrs?.href;
      if (typeof href !== "string" || !isAllowedLink(href)) return null;
      return (s) => `<a href="${escapeAttr(href)}">${s}</a>`;
    }
    default:
      return null;
  }
}

function inline(nodes: TiptapNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "hardBreak") return "<br>";
      if (node.type !== "text") return "";
      const marks = [...(node.marks ?? [])].sort(
        (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
      );
      // Wrap from the innermost mark outwards.
      return marks.reduceRight(
        (html, mark) => wrapFor(mark)?.(html) ?? html,
        escapeText(node.text ?? ""),
      );
    })
    .join("");
}

type Ctx = { listDepth: number };

function listItem(item: TiptapNode, ctx: Ctx, task: boolean): string {
  const children = item.content ?? [];
  // The leading paragraphs are the item's own text (joined by line breaks); the rest nest inside.
  let lead = 0;
  while (children[lead]?.type === "paragraph") lead += 1;
  const own = children
    .slice(0, lead)
    .map((p) => inline(p.content))
    .join("<br>");
  const rest = children
    .slice(lead)
    .map((child) => block(child, ctx))
    .join("");
  const box = task
    ? `<input type="checkbox" disabled${item.attrs?.checked === true ? " checked" : ""}> `
    : "";
  return `<li>${box}${own}${rest}</li>`;
}

function block(node: TiptapNode, ctx: Ctx): string {
  const content = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return `<p>${inline(content)}</p>`;
    case "heading": {
      const level = node.attrs?.level === 1 || node.attrs?.level === 2 ? node.attrs.level : 3;
      return `<h${level}>${inline(content)}</h${level}>`;
    }
    case "bulletList": {
      const next = { listDepth: ctx.listDepth + 1 };
      return `<ul>${content.map((item) => listItem(item, next, false)).join("")}</ul>`;
    }
    case "orderedList": {
      const next = { listDepth: ctx.listDepth + 1 };
      const type = ORDERED_TYPE[levelOf(next.listDepth)];
      const start =
        typeof node.attrs?.start === "number" && node.attrs.start > 1 ? node.attrs.start : null;
      return `<ol type="${type}"${start ? ` start="${start}"` : ""}>${content
        .map((item) => listItem(item, next, false))
        .join("")}</ol>`;
    }
    case "taskList":
      return `<ul>${content.map((item) => listItem(item, ctx, true)).join("")}</ul>`;
    case "blockquote":
      return `<blockquote>${content.map((child) => block(child, ctx)).join("")}</blockquote>`;
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const body = escapeText(content.map((n) => n.text ?? "").join(""));
      // The one class: the language, in the form other tools already read.
      return `<pre><code${language ? ` class="language-${escapeAttr(language)}"` : ""}>${body}</code></pre>`;
    }
    case "horizontalRule":
      return "<hr>";
    case "callout": {
      const emoji = typeof node.attrs?.emoji === "string" ? node.attrs.emoji : "💡";
      const [first, ...rest] = content;
      const lead =
        first?.type === "paragraph"
          ? `<p>${escapeText(emoji)} ${inline(first.content)}</p>`
          : `<p>${escapeText(emoji)}</p>${first ? block(first, ctx) : ""}`;
      return `<blockquote>${lead}${rest.map((child) => block(child, ctx)).join("")}</blockquote>`;
    }
    case "toggle": {
      const summary = content[0];
      const body = content[1]?.content ?? [];
      const level = Number(summary?.attrs?.level) || 0;
      const title = inline(summary?.content);
      const head = level > 0 ? `<h${level}>${title}</h${level}>` : title;
      return `<details open><summary>${head}</summary>${body.map((child) => block(child, ctx)).join("")}</details>`;
    }
    case "table": {
      const rows = content.map((row) => {
        const cells = (row.content ?? []).map((cell) => {
          const tag = cell.type === "tableHeader" ? "th" : "td";
          const text = (cell.content ?? []).map((p) => inline(p.content)).join("<br>");
          return `<${tag}>${text}</${tag}>`;
        });
        return `<tr>${cells.join("")}</tr>`;
      });
      return `<table>${rows.join("")}</table>`;
    }
    case "bookmark": {
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      if (!url || !isAllowedLink(url)) return "";
      const title =
        typeof node.attrs?.title === "string" && node.attrs.title ? node.attrs.title : url;
      return `<p><a href="${escapeAttr(url)}">${escapeText(title)}</a></p>`;
    }
    default:
      // The table of contents, a picture or a file (they hold only an id, which means nothing to
      // another tool), and anything unknown, add nothing.
      return "";
  }
}

/** Whole blocks as HTML. */
export function serializeHtml(blocks: TiptapNode[]): string {
  // The editor keeps an empty paragraph after a last list or table; it is not content.
  let end = blocks.length;
  while (end > 1 && blocks[end - 1]!.type === "paragraph" && !blocks[end - 1]!.content?.length)
    end -= 1;
  return blocks
    .slice(0, end)
    .map((node) => block(node, { listDepth: 0 }))
    .join("");
}

/** Inline content only, for a selection inside one text block: pasting it adds no paragraph break. */
export function serializeInlineHtml(nodes: TiptapNode[]): string {
  return inline(nodes);
}

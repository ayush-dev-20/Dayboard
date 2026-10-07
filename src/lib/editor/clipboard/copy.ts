import type { TiptapNode } from "../types";
import { inlineText } from "./inline";
import { serializeHtml, serializeInlineHtml } from "./serialize-html";
import { serializeMarkdown } from "./serialize-markdown";
import { encodeInternal } from "./slice";

// What copy and cut put on the clipboard (V2 feature 02 §4): three flavours from one slice. Pure.

export type Flavours = { html: string; text: string; internal: string };

const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock", "toggleSummary"]);

const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A selection that lies inside one text block: the slice is wrapped in the parents it sits in
 * (list, list item…), all open at both ends. Returns that block, or null for a selection across
 * blocks.
 */
function singleTextblock(content: TiptapNode[], openStart: number, openEnd: number) {
  let nodes = content;
  let start = openStart;
  let end = openEnd;
  while (nodes.length === 1 && start > 0 && end > 0 && !TEXTBLOCKS.has(nodes[0]!.type)) {
    nodes = nodes[0]!.content ?? [];
    start -= 1;
    end -= 1;
  }
  const only = nodes[0];
  return nodes.length === 1 && start > 0 && end > 0 && only && TEXTBLOCKS.has(only.type)
    ? only
    : null;
}

/**
 * The three flavours for a slice. A selection inside one text block is written as inline HTML (no
 * wrapping block, so pasting a word into a sentence adds no paragraph break) and as bare text.
 * Anything larger is clean HTML and Markdown. The internal flavour keeps the slice exactly.
 */
export function flavoursFor(content: TiptapNode[], openStart: number, openEnd: number): Flavours {
  const internal = encodeInternal(content, openStart, openEnd);
  const block = singleTextblock(content, openStart, openEnd);
  if (block) {
    const text = inlineText(block.content);
    return {
      html:
        block.type === "codeBlock" ? escapeText(text) : serializeInlineHtml(block.content ?? []),
      text,
      internal,
    };
  }
  return { html: serializeHtml(content), text: serializeMarkdown(content), internal };
}

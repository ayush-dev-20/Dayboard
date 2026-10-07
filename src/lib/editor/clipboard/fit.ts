import type { TiptapNode } from "../types";
import {
  blocksToInline,
  inlineText,
  mergeInline,
  paragraphOf,
  plainInline,
  textNode,
} from "./inline";

// Makes a run of blocks fit where it is going (V2 feature 02 §5). The editor's structural blocks
// (callout, toggle, table, contents) live only at the top of a document or in a toggle's body; a
// pasted table inside a list item, say, would be invalid. These functions flatten what cannot go
// where it is headed into the nearest plain form instead of dropping it. Pure.

const isTop = (node: TiptapNode) =>
  node.type === "callout" ||
  node.type === "toggle" ||
  node.type === "table" ||
  node.type === "tableOfContents";

/** A table as one line per row, cells separated by " | " (the form for places without tables). */
function tableAsLines(table: TiptapNode): TiptapNode[] {
  return (table.content ?? [])
    .map((row) => {
      const cells = (row.content ?? []).map((cell) => blocksToInline(cell.content ?? []));
      const line: TiptapNode[] = [];
      cells.forEach((cell, i) => {
        if (i > 0) line.push({ type: "text", text: " | " });
        line.push(...cell);
      });
      return paragraphOf(mergeInline(line));
    })
    .filter((p) => p.content);
}

/** Blocks for a place that takes only paragraphs and lists (a callout's body). */
export function toCalloutChildren(blocks: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "bulletList":
      case "orderedList":
      case "taskList":
        out.push(block);
        break;
      case "heading":
        out.push(paragraphOf(block.content ?? []));
        break;
      case "codeBlock":
        out.push(paragraphOf(plainInline(inlineText(block.content))));
        break;
      case "blockquote":
        out.push(...toCalloutChildren(block.content ?? []));
        break;
      case "horizontalRule":
        break;
      default:
        // A table, toggle or callout inside a callout is flattened; anything else is dropped.
        if (isTop(block)) out.push(...toCalloutChildren(fitInner([block])));
    }
  }
  return out.length > 0 ? out : [{ type: "paragraph" }];
}

/** Blocks for a place that cannot hold the structural blocks: lists, quotes, callouts. */
export function fitInner(blocks: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const block of blocks) {
    if (!isTop(block)) {
      out.push(fitContainer(block));
      continue;
    }
    switch (block.type) {
      case "table":
        out.push(...tableAsLines(block));
        break;
      case "toggle": {
        const summary = block.content?.[0];
        const body = block.content?.[1];
        const title = (summary?.content ?? [])
          .map((n) => (n.type === "text" ? textNode(n.text ?? "", [{ type: "bold" }]) : n))
          .filter((n): n is TiptapNode => n !== null);
        if (title.length > 0) out.push(paragraphOf(title));
        out.push(...fitInner(body?.content ?? []));
        break;
      }
      case "callout":
        out.push(...fitInner(block.content ?? []));
        break;
      default:
        break;
    }
  }
  return out;
}

/** Applies `fitInner` below nodes that hold blocks. */
function fitContainer(node: TiptapNode): TiptapNode {
  if (node.type === "blockquote") {
    const content = fitInner(node.content ?? []);
    return { ...node, content: content.length > 0 ? content : [{ type: "paragraph" }] };
  }
  return node;
}

/** Blocks for the top of a document or a toggle's body. */
export function fitTop(blocks: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "callout":
        out.push({ ...block, content: toCalloutChildren(block.content ?? []) });
        break;
      case "toggle": {
        const [summary, body] = block.content ?? [];
        const content = fitTop(body?.content ?? []);
        out.push({
          ...block,
          content: [
            summary ?? { type: "toggleSummary", attrs: { level: 0 } },
            {
              type: "toggleContent",
              content: content.length > 0 ? content : [{ type: "paragraph" }],
            },
          ],
        });
        break;
      }
      case "tableOfContents":
        break;
      default:
        out.push(fitContainer(block));
    }
  }
  return out;
}

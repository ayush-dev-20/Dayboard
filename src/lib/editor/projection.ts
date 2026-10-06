import type { TiptapDoc, TiptapNode } from "./types";

// Plain text built from a document, for search and AI retrieval. Built on the server from the
// saved JSON; the client never supplies it.

function inlineText(node: TiptapNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineText).join("");
}

function blockLines(node: TiptapNode, listPrefix = ""): string[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "codeBlock": {
      const text = inlineText(node);
      return text.split("\n").map((line, index) => (index === 0 ? listPrefix + line : line));
    }
    case "blockquote":
      return (node.content ?? []).flatMap((child) => blockLines(child));
    case "bulletList":
      return (node.content ?? []).flatMap((item) => blockLines(item, "- "));
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return (node.content ?? []).flatMap((item, index) => blockLines(item, `${start + index}. `));
    }
    case "taskList":
      return (node.content ?? []).flatMap((item) => blockLines(item, ""));
    case "taskItem": {
      const mark = node.attrs?.checked === true ? "[x] " : "[ ] ";
      return flattenItem(node, mark);
    }
    case "listItem":
      return flattenItem(node, listPrefix);
    // V2 feature 01. Words only: no emoji, no pipes, closed toggles included, no contents list.
    case "callout":
    case "toggle":
    case "toggleContent":
      return (node.content ?? []).flatMap((child) => blockLines(child));
    case "toggleSummary": {
      const text = inlineText(node);
      return text.split("\n").map((line) => line.trim());
    }
    case "table":
      return (node.content ?? [])
        .map((row) =>
          (row.content ?? [])
            .map((cell) => inlineText(cell).replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean);
    default:
      return [];
  }
}

function flattenItem(item: TiptapNode, prefix: string): string[] {
  const lines: string[] = [];
  let first = true;
  for (const child of item.content ?? []) {
    const childLines = blockLines(child, first ? prefix : "  ");
    lines.push(...childLines);
    if (childLines.length > 0) first = false;
  }
  return lines.length > 0 ? lines : [prefix.trimEnd()];
}

export function toPlainText(doc: TiptapDoc): string {
  return (doc.content ?? [])
    .flatMap((node) => blockLines(node))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A document with no visible text is stored as null rather than as an empty paragraph. */
export function isEmptyDoc(doc: TiptapDoc): boolean {
  return toPlainText(doc) === "" && !(doc.content ?? []).some((n) => n.type === "horizontalRule");
}

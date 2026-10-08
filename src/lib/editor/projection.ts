import type { TiptapDoc, TiptapNode } from "./types";

// Plain text built from a document, for search and AI retrieval. Built on the server from the
// saved JSON; the client never supplies it.

/**
 * Notes a document links to or holds as sub-notes carry only an id. The server looks their titles
 * up when it saves and passes them in, so searching a title also finds the notes that mention it
 * (V2 feature 07 §2). A later rename does not rewrite other notes' text.
 */
export type TitleOf = (noteId: string) => string | undefined;

function inlineText(node: TiptapNode, titleOf?: TitleOf): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "noteLink") return titleOf?.(String(node.attrs?.noteId ?? "")) ?? "";
  return (node.content ?? []).map((child) => inlineText(child, titleOf)).join("");
}

function blockLines(node: TiptapNode, titleOf?: TitleOf, listPrefix = ""): string[] {
  switch (node.type) {
    case "subNote": {
      const title = titleOf?.(String(node.attrs?.noteId ?? ""))?.trim();
      return title ? [listPrefix + title] : [];
    }
    // V2 feature 09. Words only: an image's caption, a bookmark's title and description. A file's
    // name is not in the document (it is on the attachment), so it adds nothing here.
    case "image": {
      const caption = String(node.attrs?.caption ?? "").trim();
      return caption ? [listPrefix + caption] : [];
    }
    case "bookmark": {
      const lines = [node.attrs?.title, node.attrs?.description]
        .map((v) => String(v ?? "").trim())
        .filter(Boolean);
      return lines.map((line, i) => (i === 0 ? listPrefix + line : line));
    }
    case "paragraph":
    case "heading":
    case "codeBlock": {
      const text = inlineText(node, titleOf);
      return text.split("\n").map((line, index) => (index === 0 ? listPrefix + line : line));
    }
    case "blockquote":
      return (node.content ?? []).flatMap((child) => blockLines(child, titleOf));
    case "bulletList":
      return (node.content ?? []).flatMap((item) => blockLines(item, titleOf, "- "));
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return (node.content ?? []).flatMap((item, index) =>
        blockLines(item, titleOf, `${start + index}. `),
      );
    }
    case "taskList":
      return (node.content ?? []).flatMap((item) => blockLines(item, titleOf, ""));
    case "taskItem": {
      const mark = node.attrs?.checked === true ? "[x] " : "[ ] ";
      return flattenItem(node, mark, titleOf);
    }
    case "listItem":
      return flattenItem(node, listPrefix, titleOf);
    // V2 feature 01. Words only: no emoji, no pipes, closed toggles included, no contents list.
    case "callout":
    case "toggle":
    case "toggleContent":
      return (node.content ?? []).flatMap((child) => blockLines(child, titleOf));
    case "toggleSummary": {
      const text = inlineText(node, titleOf);
      return text.split("\n").map((line) => line.trim());
    }
    case "table":
      return (node.content ?? [])
        .map((row) =>
          (row.content ?? [])
            .map((cell) => inlineText(cell, titleOf).replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean);
    default:
      return [];
  }
}

function flattenItem(item: TiptapNode, prefix: string, titleOf?: TitleOf): string[] {
  const lines: string[] = [];
  let first = true;
  for (const child of item.content ?? []) {
    const childLines = blockLines(child, titleOf, first ? prefix : "  ");
    lines.push(...childLines);
    if (childLines.length > 0) first = false;
  }
  return lines.length > 0 ? lines : [prefix.trimEnd()];
}

export function toPlainText(doc: TiptapDoc, titleOf?: TitleOf): string {
  return (doc.content ?? [])
    .flatMap((node) => blockLines(node, titleOf))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A document with no visible text is stored as null rather than as an empty paragraph. */
export function isEmptyDoc(doc: TiptapDoc): boolean {
  return (
    toPlainText(doc) === "" &&
    !(doc.content ?? []).some(
      (n) =>
        n.type === "horizontalRule" ||
        n.type === "subNote" ||
        n.type === "image" ||
        n.type === "file" ||
        n.type === "bookmark" ||
        containsNoteLink(n),
    )
  );
}

function containsNoteLink(node: TiptapNode): boolean {
  return node.type === "noteLink" || (node.content ?? []).some(containsNoteLink);
}

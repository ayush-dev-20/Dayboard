import type { TiptapMark, TiptapNode } from "../types";

// Small helpers for inline content (text and hard breaks) shared by the clipboard parsers. Pure.

/** The order marks are written in, so two documents with the same formatting compare equal. */
export const MARK_ORDER = ["link", "bold", "italic", "underline", "strike", "code"] as const;

export function sortMarks(marks: TiptapMark[]): TiptapMark[] {
  return [...marks].sort(
    (a, b) =>
      (MARK_ORDER as readonly string[]).indexOf(a.type) -
      (MARK_ORDER as readonly string[]).indexOf(b.type),
  );
}

/** A text node. The code mark excludes every other mark in the editor, so it stands alone. */
export function textNode(value: string, marks: TiptapMark[] = []): TiptapNode | null {
  if (value === "") return null;
  const code = marks.find((m) => m.type === "code");
  const use = code ? [{ type: "code" }] : sortMarks(dedupe(marks));
  return use.length > 0
    ? { type: "text", text: value, marks: use.map((m) => ({ ...m })) }
    : { type: "text", text: value };
}

function dedupe(marks: TiptapMark[]): TiptapMark[] {
  const out: TiptapMark[] = [];
  for (const mark of marks) if (!out.some((m) => m.type === mark.type)) out.push(mark);
  return out;
}

const sameMarks = (a?: TiptapMark[], b?: TiptapMark[]) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Joins neighbouring text with the same marks and drops empty pieces. */
export function mergeInline(nodes: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const node of nodes) {
    if (node.type === "text" && !node.text) continue;
    const last = out[out.length - 1];
    if (node.type === "text" && last?.type === "text" && sameMarks(last.marks, node.marks)) {
      out[out.length - 1] = { ...last, text: (last.text ?? "") + (node.text ?? "") };
    } else {
      out.push(node);
    }
  }
  return out;
}

/** Removes breaks and spaces at both ends, and a space that follows a space. */
export function trimInline(nodes: TiptapNode[]): TiptapNode[] {
  let list = mergeInline(nodes).map((n) => ({ ...n }));
  // A space right after a hard break or another space adds nothing.
  for (let i = 0; i < list.length; i += 1) {
    const node = list[i]!;
    if (node.type !== "text" || !node.text) continue;
    const before = list[i - 1];
    const beforeEnds = before?.type === "hardBreak" || (before?.text ?? "").endsWith(" ");
    if (beforeEnds && node.text.startsWith(" ")) node.text = node.text.replace(/^ +/, "");
  }
  list = list.filter((n) => n.type !== "text" || n.text);
  while (list[0]?.type === "hardBreak") list.shift();
  while (list.at(-1)?.type === "hardBreak") list.pop();
  const first = list[0];
  if (first?.type === "text") first.text = (first.text ?? "").replace(/^ +/, "");
  const last = list.at(-1);
  if (last?.type === "text") last.text = (last.text ?? "").replace(/ +$/, "");
  // A space before a hard break is invisible.
  list.forEach((node, i) => {
    if (node.type === "hardBreak" && list[i - 1]?.type === "text") {
      const prev = list[i - 1]!;
      prev.text = (prev.text ?? "").replace(/ +$/, "");
    }
  });
  return mergeInline(list.filter((n) => n.type !== "text" || n.text));
}

export function inlineText(nodes: TiptapNode[] | undefined): string {
  return (nodes ?? []).map((n) => (n.type === "hardBreak" ? "\n" : (n.text ?? ""))).join("");
}

export const paragraphOf = (inline: TiptapNode[]): TiptapNode =>
  inline.length > 0 ? { type: "paragraph", content: inline } : { type: "paragraph" };

/** Text with no formatting as inline nodes; newlines become hard breaks. */
export function plainInline(value: string): TiptapNode[] {
  const out: TiptapNode[] = [];
  value.split("\n").forEach((line, index) => {
    if (index > 0) out.push({ type: "hardBreak" });
    const node = textNode(line);
    if (node) out.push(node);
  });
  return out;
}

/**
 * The inline content of any run of blocks, as one line of inline nodes with hard breaks between
 * the blocks. Used where only inline content fits: a table cell, a toggle title.
 */
export function blocksToInline(blocks: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  const addLine = (line: TiptapNode[]) => {
    if (line.length === 0) return;
    if (out.length > 0) out.push({ type: "hardBreak" });
    out.push(...line);
  };
  const visit = (node: TiptapNode) => {
    switch (node.type) {
      case "paragraph":
      case "heading":
      case "toggleSummary":
        addLine(
          (node.content ?? []).filter(
            (c) => c.type === "text" || c.type === "hardBreak" || c.type === "noteLink",
          ),
        );
        break;
      case "codeBlock":
        addLine(plainInline(inlineText(node.content)));
        break;
      case "subNote":
        // A block that points at a note becomes the link where only a line of text fits.
        addLine([{ type: "noteLink", attrs: node.attrs }]);
        break;
      case "horizontalRule":
      case "tableOfContents":
        break;
      case "table":
        for (const row of node.content ?? []) {
          const cells = (row.content ?? []).map((cell) => blocksToInline(cell.content ?? []));
          const line: TiptapNode[] = [];
          cells.forEach((cell, i) => {
            if (i > 0) line.push({ type: "text", text: " | " });
            line.push(...cell);
          });
          addLine(line);
        }
        break;
      default:
        (node.content ?? []).forEach(visit);
    }
  };
  blocks.forEach(visit);
  return trimInline(out);
}

export const withoutBold = (nodes: TiptapNode[]): TiptapNode[] =>
  mergeInline(
    nodes.map((node) => {
      if (!node.marks?.some((m) => m.type === "bold")) return node;
      const marks = node.marks.filter((m) => m.type !== "bold");
      const { marks: _drop, ...rest } = node;
      void _drop;
      return marks.length > 0 ? { ...rest, marks } : rest;
    }),
  );

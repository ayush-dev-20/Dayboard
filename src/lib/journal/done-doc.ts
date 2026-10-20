import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";
import type { DoneItem } from "./dto";

// "Add to entry" (V3 feature 02 §5): the day's finished work as text in the note, a heading "Done" and a bullet
// list of titles. Plain text, no links, so the note reads the same wherever it is copied. The Done section itself is
// never part of the document; this is only what the button inserts.

const paragraph = (text: string): TiptapNode => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});

/** The document to append, or null when nothing was completed (an empty list adds nothing). */
export function doneDocument(
  items: readonly Pick<DoneItem, "title" | "parentTitle">[],
): TiptapDoc | null {
  const titles = items.map((item) => item.title.replace(/\s+/g, " ").trim());
  if (titles.length === 0) return null;
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Done" }] },
      {
        type: "bulletList",
        content: titles.map((title) => ({
          type: "listItem",
          content: [paragraph(title || "Untitled")],
        })),
      },
    ],
  };
}

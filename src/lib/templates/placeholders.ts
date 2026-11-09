import { doneTime, journalDateLabel, weekdayName } from "@/lib/dates/journal";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";
import { TITLE_PATTERN_MAX } from "./types";

// Placeholders (V3 feature 03 §4): `{{date}}`, `{{day}}`, `{{time}}` and `{{title}}`, filled in once when a note is made.
// Plain text replacement inside text nodes only: the value cannot make a node, a link or HTML, and nothing is a
// formula (`{{date+1}}` stays as typed). A name that is not one of the four, or one with spaces (`{{ date }}`), is left
// alone. A placeholder split across two text nodes by a mark is not matched, which is why the template editor inserts
// each one as a single node. These functions never throw.

export type PlaceholderContext = {
  /** The day the note is for, "YYYY-MM-DD" (today for a note, the entry's own day for a journal entry). */
  day: string;
  /** The moment of making it, for `{{time}}`. */
  now: Date;
  timezone: string;
  /** The new note's title ("" when there is none). */
  title: string;
};

export const PLACEHOLDERS = ["date", "day", "time", "title"] as const;
export type PlaceholderName = (typeof PLACEHOLDERS)[number];

const PATTERN = /\{\{(date|day|time|title)\}\}/g;

function valueOf(name: PlaceholderName, ctx: PlaceholderContext): string {
  switch (name) {
    case "date":
      return journalDateLabel(ctx.day);
    case "day":
      return weekdayName(ctx.day);
    case "time":
      return doneTime(ctx.now.toISOString(), ctx.timezone);
    case "title":
      return ctx.title;
  }
}

function fill(text: string, ctx: PlaceholderContext): string {
  // A function replacement: the value is inserted literally, whatever characters it holds ($&, braces, HTML).
  return text.replace(PATTERN, (_match, name: PlaceholderName) => valueOf(name, ctx));
}

function mapNode(node: TiptapNode, ctx: PlaceholderContext): TiptapNode | null {
  if (node.type === "text" && typeof node.text === "string") {
    const text = fill(node.text, ctx);
    // An empty text node is not valid in the editor: a placeholder that came out empty leaves nothing.
    return text === "" ? null : { ...node, text };
  }
  if (!node.content) return node;
  const content = node.content
    .map((child) => mapNode(child, ctx))
    .filter((child): child is TiptapNode => child !== null);
  return { ...node, content };
}

/** The document with every placeholder in its text filled in. A malformed document comes back unchanged. */
export function applyPlaceholders(doc: TiptapDoc, ctx: PlaceholderContext): TiptapDoc {
  try {
    const content = (doc.content ?? [])
      .map((node) => mapNode(node, ctx))
      .filter((node): node is TiptapNode => node !== null);
    return { ...doc, content };
  } catch {
    return doc;
  }
}

/** A title pattern with its placeholders filled in, cut to the title limit. */
export function applyToTitle(pattern: string, ctx: PlaceholderContext): string {
  try {
    return fill(pattern, ctx).slice(0, TITLE_PATTERN_MAX).trim();
  } catch {
    return pattern;
  }
}

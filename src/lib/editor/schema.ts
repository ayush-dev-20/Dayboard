import { z } from "zod";
import { isSingleEmoji } from "@/lib/emoji";
import {
  CALLOUT_TONES,
  DEFAULT_CALLOUT_EMOJI,
  LIST_MAX_DEPTH,
  MESSAGES,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  TOGGLE_LEVELS,
} from "./limits";
import type { TiptapDoc, TiptapMark, TiptapNode } from "./types";

// Incoming rich text is never trusted. A document is accepted only if every node and mark is one
// the editor can produce; attributes are whitelisted, so anything else is dropped, and size and
// depth are capped. The result is a clean copy, not the input object.

export const MAX_DOC_BYTES = 200_000;
// Raised from 20 (V2 feature 01): six nested list levels inside a toggle inside a table cell's
// neighbour block approach the old limit.
export const MAX_DEPTH = 32;

export class EditorDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorDocError";
  }
}

const NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  // V2 feature 01: structural blocks.
  "callout",
  "toggle",
  "toggleSummary",
  "toggleContent",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "tableOfContents",
]);
const LEAF_TYPES = new Set(["horizontalRule", "hardBreak", "tableOfContents"]);

/** Blocks that live only at the top of a document or inside a toggle (never in lists or quotes). */
const TOP_BLOCKS = new Set(["callout", "toggle", "table", "tableOfContents"]);
const TOP_PARENTS = new Set(["doc", "toggleContent"]);

const PLAIN_BLOCKS = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
];

/** What each structural node may contain, in order, with the number of children it needs. */
const CHILDREN: Record<string, { allowed: Set<string>; min: number; max: number }> = {
  callout: {
    allowed: new Set(["paragraph", "bulletList", "orderedList", "taskList"]),
    min: 1,
    max: Infinity,
  },
  toggleSummary: { allowed: new Set(["text", "hardBreak"]), min: 0, max: Infinity },
  toggleContent: {
    allowed: new Set([...PLAIN_BLOCKS, ...TOP_BLOCKS]),
    min: 0,
    max: Infinity,
  },
  table: { allowed: new Set(["tableRow"]), min: 1, max: TABLE_MAX_ROWS },
  tableRow: { allowed: new Set(["tableHeader", "tableCell"]), min: 1, max: TABLE_MAX_COLUMNS },
  tableHeader: { allowed: new Set(["paragraph"]), min: 1, max: Infinity },
  tableCell: { allowed: new Set(["paragraph"]), min: 1, max: Infinity },
};

/** Nodes that may only appear directly inside a particular parent. */
const ONLY_IN: Record<string, string> = {
  toggleSummary: "toggle",
  toggleContent: "toggle",
  tableRow: "table",
  tableHeader: "tableRow",
  tableCell: "tableRow",
};
const MARK_TYPES = new Set(["bold", "italic", "underline", "strike", "code", "link"]);
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAllowedLink(href: string): boolean {
  if (href.length > 2048) return false;
  try {
    return LINK_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

function sanitizeMarks(raw: unknown): TiptapMark[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new EditorDocError("Marks must be a list.");

  const marks: TiptapMark[] = [];
  for (const mark of raw) {
    if (!isRecord(mark) || typeof mark.type !== "string" || !MARK_TYPES.has(mark.type)) {
      throw new EditorDocError("This text uses formatting that isn't supported.");
    }
    if (mark.type === "link") {
      const href = isRecord(mark.attrs) ? mark.attrs.href : undefined;
      if (typeof href !== "string" || !isAllowedLink(href)) {
        throw new EditorDocError("Links must start with http://, https:// or mailto:.");
      }
      marks.push({ type: "link", attrs: { href } });
    } else {
      marks.push({ type: mark.type });
    }
  }
  return marks.length > 0 ? marks : undefined;
}

function sanitizeAttrs(type: string, raw: unknown): Record<string, unknown> | undefined {
  const attrs = isRecord(raw) ? raw : {};
  switch (type) {
    case "heading": {
      const level = attrs.level;
      if (level !== 1 && level !== 2 && level !== 3) {
        throw new EditorDocError("Headings can be level 1, 2 or 3.");
      }
      return { level };
    }
    case "orderedList": {
      const start = attrs.start;
      return typeof start === "number" &&
        Number.isInteger(start) &&
        start >= 1 &&
        start <= 1_000_000
        ? { start }
        : undefined;
    }
    case "taskItem":
      return { checked: attrs.checked === true };
    case "callout": {
      const emoji = typeof attrs.emoji === "string" ? attrs.emoji : DEFAULT_CALLOUT_EMOJI;
      if (!isSingleEmoji(emoji)) throw new EditorDocError("A callout needs a single emoji.");
      const tone = attrs.tone ?? "neutral";
      if (!(CALLOUT_TONES as readonly unknown[]).includes(tone)) {
        throw new EditorDocError("That callout style isn't supported.");
      }
      return { emoji, tone };
    }
    case "toggle": {
      const id = attrs.id;
      return typeof id === "string" && /^[a-z0-9]{4,16}$/.test(id) ? { id } : undefined;
    }
    case "toggleSummary": {
      const level = attrs.level ?? 0;
      if (!(TOGGLE_LEVELS as readonly unknown[]).includes(level)) {
        throw new EditorDocError("Toggle headings can be level 1, 2 or 3.");
      }
      return { level };
    }
    case "tableCell":
    case "tableHeader": {
      const width = attrs.colwidth;
      if (width === null || width === undefined) return undefined;
      const valid =
        Array.isArray(width) &&
        width.length === 1 &&
        typeof width[0] === "number" &&
        Number.isInteger(width[0]) &&
        width[0] > 0 &&
        width[0] <= 2000;
      return valid ? { colwidth: width } : undefined;
    }
    case "codeBlock": {
      const language = attrs.language;
      return typeof language === "string" && language.length > 0 && language.length <= 32
        ? { language }
        : undefined;
    }
    default:
      return undefined;
  }
}

type Context = { depth: number; parent: string; listDepth: number };

function sanitizeNode(raw: unknown, ctx: Context): TiptapNode {
  if (ctx.depth > MAX_DEPTH) throw new EditorDocError("This document is nested too deeply.");
  if (!isRecord(raw) || typeof raw.type !== "string") throw new EditorDocError("Invalid document.");

  if (raw.type === "text") {
    if (typeof raw.text !== "string" || raw.text.length === 0) {
      throw new EditorDocError("Invalid text in the document.");
    }
    const marks = sanitizeMarks(raw.marks);
    return marks ? { type: "text", text: raw.text, marks } : { type: "text", text: raw.text };
  }

  const type = raw.type;
  if (!NODE_TYPES.has(type))
    throw new EditorDocError("This document has content that isn't supported.");

  // Structural blocks only go where the editor can put them.
  if (TOP_BLOCKS.has(type) && !TOP_PARENTS.has(ctx.parent)) {
    throw new EditorDocError("This content can't go there.");
  }
  const only = ONLY_IN[type];
  if (only && ctx.parent !== only) throw new EditorDocError("This content can't go there.");

  const node: TiptapNode = { type };
  const attrs = sanitizeAttrs(type, raw.attrs);
  if (attrs) node.attrs = attrs;

  if (LEAF_TYPES.has(type)) return node;

  const isList = type === "bulletList" || type === "orderedList";
  const listDepth = isList ? ctx.listDepth + 1 : ctx.listDepth;
  if (listDepth > LIST_MAX_DEPTH) throw new EditorDocError(MESSAGES.listDepth);

  if (raw.content !== undefined) {
    if (!Array.isArray(raw.content)) throw new EditorDocError("Invalid document.");
    const rule = CHILDREN[type];
    if (rule) {
      if (raw.content.length < rule.min) throw new EditorDocError("Invalid document.");
      if (raw.content.length > rule.max) {
        throw new EditorDocError(type === "table" ? MESSAGES.tableRows : MESSAGES.tableColumns);
      }
      for (const child of raw.content) {
        if (!isRecord(child) || typeof child.type !== "string" || !rule.allowed.has(child.type)) {
          throw new EditorDocError("This content can't go there.");
        }
      }
    }
    const childCtx: Context = { depth: ctx.depth + 1, parent: type, listDepth };
    node.content = raw.content.map((child) => sanitizeNode(child, childCtx));
  } else if (CHILDREN[type] && CHILDREN[type].min > 0) {
    throw new EditorDocError("Invalid document.");
  }

  if (type === "toggle") {
    const kinds = (node.content ?? []).map((child) => child.type);
    if (kinds.length !== 2 || kinds[0] !== "toggleSummary" || kinds[1] !== "toggleContent") {
      throw new EditorDocError("Invalid document.");
    }
  }
  if (type === "table") {
    const widths = new Set((node.content ?? []).map((row) => row.content?.length ?? 0));
    if (widths.size > 1) throw new EditorDocError("Table rows need the same number of cells.");
  }
  return node;
}

/** Validates and cleans a document. Throws `EditorDocError` with a plain-language message. */
export function sanitizeDoc(input: unknown): TiptapDoc {
  const size = new TextEncoder().encode(JSON.stringify(input) ?? "").length;
  if (size > MAX_DOC_BYTES) throw new EditorDocError("This text is too long to save.");

  if (!isRecord(input) || input.type !== "doc") throw new EditorDocError("Invalid document.");
  if (input.content !== undefined && !Array.isArray(input.content)) {
    throw new EditorDocError("Invalid document.");
  }
  const content =
    (input.content as unknown[] | undefined)?.map((child) =>
      sanitizeNode(child, { depth: 1, parent: "doc", listDepth: 0 }),
    ) ?? [];
  return { type: "doc", content };
}

/** Zod schema form of `sanitizeDoc`, so Server Actions can use it like any other field. */
export const richTextSchema = z.unknown().transform((value, ctx) => {
  try {
    return sanitizeDoc(value);
  } catch (error) {
    if (error instanceof EditorDocError) {
      ctx.issues.push({ code: "custom", message: error.message, input: value });
      return z.NEVER;
    }
    throw error;
  }
});

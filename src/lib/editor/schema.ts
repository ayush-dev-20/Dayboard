import { z } from "zod";
import type { TiptapDoc, TiptapMark, TiptapNode } from "./types";

// Incoming rich text is never trusted. A document is accepted only if every node and mark is one
// the editor can produce; attributes are whitelisted, so anything else is dropped, and size and
// depth are capped. The result is a clean copy, not the input object.

export const MAX_DOC_BYTES = 200_000;
export const MAX_DEPTH = 20;

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
]);
const LEAF_TYPES = new Set(["horizontalRule", "hardBreak"]);
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

function sanitizeNode(raw: unknown, depth: number): TiptapNode {
  if (depth > MAX_DEPTH) throw new EditorDocError("This document is nested too deeply.");
  if (!isRecord(raw) || typeof raw.type !== "string") throw new EditorDocError("Invalid document.");

  if (raw.type === "text") {
    if (typeof raw.text !== "string" || raw.text.length === 0) {
      throw new EditorDocError("Invalid text in the document.");
    }
    const marks = sanitizeMarks(raw.marks);
    return marks ? { type: "text", text: raw.text, marks } : { type: "text", text: raw.text };
  }

  if (!NODE_TYPES.has(raw.type))
    throw new EditorDocError("This document has content that isn't supported.");

  const node: TiptapNode = { type: raw.type };
  const attrs = sanitizeAttrs(raw.type, raw.attrs);
  if (attrs) node.attrs = attrs;

  if (LEAF_TYPES.has(raw.type)) return node;

  if (raw.content !== undefined) {
    if (!Array.isArray(raw.content)) throw new EditorDocError("Invalid document.");
    node.content = raw.content.map((child) => sanitizeNode(child, depth + 1));
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
    (input.content as unknown[] | undefined)?.map((child) => sanitizeNode(child, 1)) ?? [];
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

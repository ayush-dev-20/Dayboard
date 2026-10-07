import { EditorDocError, NODE_TYPES, sanitizeAttrs, sanitizeMarks } from "../schema";
import type { TiptapNode } from "../types";

// The clipboard flavour only Dayboard reads (V2 feature 02 §2): the exact slice that was copied,
// open ends included, so a paste back into Dayboard loses nothing. It is read back with suspicion:
// any page can put anything on the clipboard, so nodes, marks and attributes are checked against
// the same whitelist as a saved document before the editor sees them.

export const INTERNAL_MIME = "application/x-dayboard-slice+json";
const VERSION = 1;
const MAX_CHARS = 2_000_000;
const MAX_DEPTH = 40;
const MAX_NODES = 100_000;

export type InternalSlice = {
  v: 1;
  doc: { type: "doc"; content: TiptapNode[] };
  openStart: number;
  openEnd: number;
};

export function encodeInternal(content: TiptapNode[], openStart: number, openEnd: number): string {
  const slice: InternalSlice = { v: VERSION, doc: { type: "doc", content }, openStart, openEnd };
  return JSON.stringify(slice);
}

function scrub(raw: unknown, depth: number, count: { n: number }): TiptapNode {
  if (depth > MAX_DEPTH || (count.n += 1) > MAX_NODES) throw new EditorDocError("Too large.");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new EditorDocError("Bad node.");
  const node = raw as Record<string, unknown>;
  const type = node.type;
  if (typeof type !== "string") throw new EditorDocError("Bad node.");

  if (type === "text") {
    if (typeof node.text !== "string" || node.text === "") throw new EditorDocError("Bad text.");
    const marks = sanitizeMarks(node.marks);
    return marks ? { type, text: node.text, marks } : { type, text: node.text };
  }
  if (!NODE_TYPES.has(type)) throw new EditorDocError("Unknown node.");

  const out: TiptapNode = { type };
  const attrs = sanitizeAttrs(type, node.attrs);
  if (attrs) out.attrs = attrs;
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) throw new EditorDocError("Bad content.");
    out.content = node.content.map((child) => scrub(child, depth + 1, count));
  }
  return out;
}

/** The slice from the clipboard flavour, or null when it is missing, from a newer version, or unsafe. */
export function decodeInternal(raw: string | undefined): InternalSlice | null {
  if (!raw || raw.length > MAX_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { v, doc, openStart, openEnd } = parsed as Record<string, unknown>;
    if (v !== VERSION) return null;
    if (!Number.isInteger(openStart) || !Number.isInteger(openEnd)) return null;
    const content = (doc as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content) || content.length === 0) return null;
    const count = { n: 0 };
    return {
      v: VERSION,
      doc: { type: "doc", content: content.map((node) => scrub(node, 1, count)) },
      openStart: openStart as number,
      openEnd: openEnd as number,
    };
  } catch {
    return null;
  }
}

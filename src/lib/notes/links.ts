import type { TiptapDoc, TiptapNode } from "../editor/types";

// Note links and sub-note blocks inside a document (V2 feature 07 §2, §4). A link is an inline atom
// and a sub-note is a block atom; both hold only a note's identity. These helpers read them out of
// a saved document: which notes does it point at, and what words surround each link.

export const NOTE_LINK_NODE = "noteLink";
export const SUB_NOTE_NODE = "subNote";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isNoteId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

export const SNIPPET_MAX = 200;

/** The text blocks that can hold a link (the ones whose children are inline). */
const TEXT_BLOCKS = new Set(["paragraph", "heading", "toggleSummary"]);

function noteIdOf(node: TiptapNode): string | null {
  const id = node.attrs?.noteId;
  return isNoteId(id) ? id.toLowerCase() : null;
}

export type NoteRefs = {
  /** Distinct notes linked inline, in the order they first appear. */
  links: string[];
  /** Distinct notes shown as sub-note blocks. */
  blocks: string[];
};

/** Every note a document points at. Sub-note blocks are listed apart: they are hierarchy, not links. */
export function collectNoteRefs(doc: TiptapDoc | null | undefined): NoteRefs {
  const links = new Set<string>();
  const blocks = new Set<string>();
  const walk = (node: TiptapNode) => {
    if (node.type === NOTE_LINK_NODE) {
      const id = noteIdOf(node);
      if (id) links.add(id);
    } else if (node.type === SUB_NOTE_NODE) {
      const id = noteIdOf(node);
      if (id) blocks.add(id);
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const node of doc?.content ?? []) walk(node);
  return { links: [...links], blocks: [...blocks] };
}

/** Every note id a document mentions, either way (their titles go into the searchable text). */
export function allNoteRefs(doc: TiptapDoc | null | undefined): string[] {
  const { links, blocks } = collectNoteRefs(doc);
  return [...new Set([...links, ...blocks])];
}

/** The title a link or block shows when its note has none. */
export const UNTITLED = "Untitled";

/**
 * For each linked note, a short piece of the text around its first link: the whole block when it is
 * short, otherwise a window of about `SNIPPET_MAX` characters centred on the link. The link itself
 * reads as the note's title, so "see the plan" reads the way it looks on the screen.
 */
export function linkSnippets(
  doc: TiptapDoc | null | undefined,
  titleOf: (id: string) => string | undefined,
): Map<string, string> {
  const out = new Map<string, string>();

  const visit = (node: TiptapNode) => {
    if (TEXT_BLOCKS.has(node.type)) {
      let text = "";
      const spots: { id: string; at: number; length: number }[] = [];
      for (const child of node.content ?? []) {
        if (child.type === "text") text += child.text ?? "";
        else if (child.type === "hardBreak") text += " ";
        else if (child.type === NOTE_LINK_NODE) {
          const id = noteIdOf(child);
          if (!id) continue;
          const label = (titleOf(id) ?? "").trim() || UNTITLED;
          spots.push({ id, at: text.length, length: label.length });
          text += label;
        }
      }
      for (const spot of spots) {
        if (!out.has(spot.id)) out.set(spot.id, windowAround(text, spot.at, spot.length));
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of doc?.content ?? []) visit(node);
  return out;
}

/** At most `SNIPPET_MAX` characters of `text` that include the span, with an ellipsis where cut. */
export function windowAround(text: string, at: number, length: number): string {
  const flat = text.replace(/\s+/g, " ");
  // Whitespace was collapsed, so find the span again by counting collapsed characters.
  const before = text.slice(0, at).replace(/\s+/g, " ").length;
  const start0 = Math.min(before, Math.max(0, flat.length - 1));
  if (flat.length <= SNIPPET_MAX) return flat.trim();

  const room = SNIPPET_MAX - 2; // leave space for an ellipsis on each side
  const half = Math.max(0, Math.floor((room - length) / 2));
  let from = Math.max(0, start0 - half);
  const to = Math.min(flat.length, from + room);
  from = Math.max(0, to - room);
  let piece = flat.slice(from, to).trim();
  if (from > 0) piece = `…${piece}`;
  if (to < flat.length) piece = `${piece}…`;
  return piece.length > SNIPPET_MAX ? piece.slice(0, SNIPPET_MAX) : piece;
}

/** Where a link leads, and what the person sees (feature 07 §4). */
export type NoteState = "ok" | "archived" | "trashed" | "missing";

export function noteState(
  row: { archivedAt: Date | string | null; deletedAt: Date | string | null } | null | undefined,
): NoteState {
  if (!row) return "missing";
  if (row.deletedAt !== null) return "trashed";
  if (row.archivedAt !== null) return "archived";
  return "ok";
}

export type NoteMeta = {
  id: string;
  title: string;
  emoji: string | null;
  state: NoteState;
};

/** The title as shown: "Untitled" for none, and a plain label for a note that is gone. */
export function displayTitle(meta: Pick<NoteMeta, "title" | "state"> | undefined): string {
  if (!meta || meta.state === "missing") return "Note no longer exists";
  if (meta.state === "trashed") return "Deleted note";
  return meta.title.trim() || UNTITLED;
}

/** A Dayboard note address: `…/notes/<uuid>` (no extra path, no query that matters). */
export function noteIdFromAddress(text: string, origins: readonly string[]): string | null {
  const trimmed = text.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!origins.includes(url.origin)) return null;
  const match = /^\/notes\/([0-9a-f-]{36})\/?$/i.exec(url.pathname);
  return match && isNoteId(match[1]) ? match[1].toLowerCase() : null;
}

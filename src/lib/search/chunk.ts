import { toPlainText, type TitleOf } from "@/lib/editor/projection";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// Cuts an item's text into pieces that are embedded one by one (V2 feature 10 §4). Pure: no database,
// no network, so the rules can be tested exactly.
//
// A note is cut at headings and paragraphs into pieces of about 300 to 500 tokens. Each piece starts with
// the note's title and its nearest heading, so a paragraph still says what it belongs to when it is read
// on its own. A task, todo or project is one piece: its title and description.

/** At most this many pieces per item; text beyond them is not searched by meaning. */
export const MAX_CHUNKS = 200;
/** A piece is closed once it reaches this size (about 450 tokens). */
const TARGET_CHARS = 1800;
/** No piece is longer than this, even when one paragraph is. */
const MAX_CHARS = 2400;
/** The tail of a closed piece that opens the next one in the same section. */
const OVERLAP_CHARS = 200;
/** A task or project description is cut here (about 2,000 tokens). */
export const MAX_DESCRIPTION_CHARS = 8000;

export type Chunk = { index: number; text: string; tokenEstimate: number };

/** A rough size in tokens. Good enough to cap and to count; the provider does the real counting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const collapse = (s: string) =>
  s
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function toChunks(texts: string[]): Chunk[] {
  return texts.slice(0, MAX_CHUNKS).map((text, index) => ({
    index,
    text,
    tokenEstimate: estimateTokens(text),
  }));
}

/** Splits one long paragraph at sentence ends (or at a hard length when there are none). */
function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS);
    const cut = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("\n"),
      window.lastIndexOf("? "),
    );
    const end = cut > MAX_CHARS / 2 ? cut + 1 : MAX_CHARS;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(Math.max(end - OVERLAP_CHARS / 2, 1)).trim();
    if (rest.length === 0) break;
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

type Section = { heading: string; units: string[] };

function headingText(node: TiptapNode, titleOf?: TitleOf): string {
  return (
    toPlainText({ type: "doc", content: [node] }, titleOf)
      .split("\n")[0]
      ?.trim() ?? ""
  );
}

/**
 * Pieces for a note. `title` and the nearest heading are put in front of every piece. A note with a title
 * and no body is one piece (its title), so it can still be found. A note with neither has none.
 */
export function chunkNote(title: string, doc: TiptapDoc | null, titleOf?: TitleOf): Chunk[] {
  const sections: Section[] = [{ heading: "", units: [] }];
  for (const node of doc?.content ?? []) {
    if (node.type === "heading") {
      sections.push({ heading: headingText(node, titleOf), units: [] });
      continue;
    }
    const text = toPlainText({ type: "doc", content: [node] }, titleOf);
    if (text) sections[sections.length - 1]!.units.push(...splitLong(text));
  }

  const noteTitle = title.trim();
  const out: string[] = [];
  for (const section of sections) {
    if (section.units.length === 0) continue;
    const prefix = [noteTitle, section.heading].filter(Boolean).join(" > ");
    let body = "";
    let lastUnit = "";
    const close = () => {
      if (!body.trim()) return;
      out.push(collapse(prefix ? `${prefix}\n${body}` : body));
    };
    for (const unit of section.units) {
      if (body && body.length + unit.length + 1 > TARGET_CHARS) {
        close();
        // The next piece opens with the end of this one when that end is short enough to be context.
        body = lastUnit.length <= OVERLAP_CHARS ? lastUnit : "";
      }
      body = body ? `${body}\n${unit}` : unit;
      lastUnit = unit;
    }
    close();
  }

  if (out.length === 0) return noteTitle ? toChunks([noteTitle]) : [];
  return toChunks(out);
}

/**
 * One piece for a task, todo or project: the title, then the description (cut at about 2,000 tokens).
 * Nothing to embed (no title and no text) gives no pieces.
 */
export function chunkPlain(title: string, description: string | null | undefined): Chunk[] {
  const head = title.trim();
  const body = collapse(description ?? "").slice(0, MAX_DESCRIPTION_CHARS);
  const text = [head, body].filter(Boolean).join("\n");
  return text ? toChunks([text]) : [];
}

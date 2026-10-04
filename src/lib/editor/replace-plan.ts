// The pure half of Writing help's "Replace" (feature 08 §7.5): decide how a model's answer maps onto
// the blocks the person selected. The editor half (ai-apply.ts) turns the decision into one
// ProseMirror transaction.

/** Most characters of a selection that are sent (and so the most that can be replaced). */
export const MAX_EDIT_CHARS = 6000;
/** Most characters before the cursor that Continue sends. */
export const MAX_BEFORE_CHARS = 2000;

export const REFUSE_UNSAFE = "Select text only, without code or dividers.";
export const REFUSE_TOO_LONG = "Select a shorter passage.";
export const STALE = "The text changed. Regenerate.";
export const SIMPLIFIED = "Formatting inside the selection is simplified.";

/** Block kinds a selection may not cross for Improve, Shorten and Fix grammar. */
const UNSAFE = new Set(["codeBlock", "horizontalRule"]);

/** Why this selection can't be edited, or null when it can. */
export function selectionRefusal(blockTypes: readonly string[], text: string): string | null {
  if (blockTypes.some((t) => UNSAFE.has(t))) return REFUSE_UNSAFE;
  if (text.length > MAX_EDIT_CHARS) return REFUSE_TOO_LONG;
  return null;
}

/**
 * The model's answer as paragraphs. A blank line separates paragraphs. A model that used single
 * newlines instead is read that way only when that gives exactly the number of blocks selected.
 */
export function splitParagraphs(text: string, expected?: number): string[] {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  const blank = clean
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  if (expected !== undefined && blank.length !== expected) {
    const lines = clean
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === expected) return lines;
  }
  return blank;
}

export type ReplacementPlan =
  /** One new text per selected block, written into that block in place. */
  | { kind: "inPlace"; texts: string[] }
  /** The whole selected range becomes these paragraphs. */
  | { kind: "range"; paragraphs: string[] };

/**
 * Equal counts keep each block as it is (a list item stays a list item, a heading a heading);
 * anything else replaces the range with the new paragraphs.
 */
export function planReplacement(blockCount: number, answer: string): ReplacementPlan | null {
  const paragraphs = splitParagraphs(answer, blockCount);
  if (paragraphs.length === 0) return null;
  if (paragraphs.length === blockCount) return { kind: "inPlace", texts: paragraphs };
  return { kind: "range", paragraphs };
}

export type LinkSpan = { text: string; href: string };
export type InlinePiece = { text: string; href?: string };

/**
 * Keeps a link only when the new text still contains the link's exact words; otherwise the words
 * are plain text. Each link is applied to its first occurrence.
 */
export function placeLinks(text: string, links: readonly LinkSpan[]): InlinePiece[] {
  let pieces: InlinePiece[] = [{ text }];
  for (const link of links) {
    if (!link.text) continue;
    const next: InlinePiece[] = [];
    let used = false;
    for (const piece of pieces) {
      const at = piece.href || used ? -1 : piece.text.indexOf(link.text);
      if (at === -1) {
        next.push(piece);
        continue;
      }
      used = true;
      if (at > 0) next.push({ text: piece.text.slice(0, at) });
      next.push({ text: link.text, href: link.href });
      const rest = piece.text.slice(at + link.text.length);
      if (rest) next.push({ text: rest });
    }
    pieces = next;
  }
  return pieces.filter((p) => p.text !== "");
}

/** True when the selected text is still exactly what the preview started from. */
export function rangeUnchanged(original: string, current: string): boolean {
  return original === current;
}

import { NOTE_TITLE_MAX } from "@/lib/validations/notes";

// Generate with AI can write a note's title as the first line of its answer (feature 08 §4.2):
//
//   TITLE: Acme rebrand brief
//
//   # The Markdown body starts here…
//
// The route splits that line off as its own event, so the browser never sees "TITLE:".

export type TitleSplit = {
  /** The suggested title, once its line has arrived. Null when none was written. */
  title: string | null;
  /** Everything after the title line (the whole answer when there is no title line). */
  body: string;
  /** False while it is still unclear whether a title line is coming. */
  decided: boolean;
};

const MARKER = "TITLE:";

/** Plain text: no Markdown marks or quotes, one line, at most 300 characters. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/[*_`~#]+/g, "")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, NOTE_TITLE_MAX)
    .trim();
}

/**
 * Splits what has arrived so far. Safe to call again with a longer buffer; the result for a
 * decided buffer never changes its `title`.
 */
export function splitTitle(buffer: string, final = false): TitleSplit {
  const start = buffer.search(/\S/);
  if (start === -1) return { title: null, body: "", decided: final };

  const head = buffer.slice(start);
  const newline = head.indexOf("\n");
  const first = newline === -1 ? head : head.slice(0, newline);

  // Could this still become "TITLE:"? If the first characters rule it out, there is no title.
  const compare = first.slice(0, MARKER.length).toUpperCase();
  const mightBeTitle = MARKER.startsWith(compare) || compare === MARKER;
  if (!mightBeTitle) return { title: null, body: buffer.trimStart(), decided: true };

  if (newline === -1) {
    if (!final || compare !== MARKER) {
      return { title: null, body: "", decided: final && compare !== MARKER };
    }
    return { title: cleanTitle(first.slice(MARKER.length)) || null, body: "", decided: true };
  }

  const title = cleanTitle(first.slice(MARKER.length));
  return {
    title: title || null,
    body: head
      .slice(newline + 1)
      .replace(/^\s*\n/, "")
      .trimStart(),
    decided: true,
  };
}

/** Per-length output caps and the sentences the prompt uses to set the size (feature 08 §5.1). */
export const LENGTH_PLAN = {
  SHORT: { maxOutputTokens: 600, guide: "about 80 to 150 words, a few lines, no headings" },
  STANDARD: {
    maxOutputTokens: 1500,
    guide: "about 250 to 400 words, with headings where they help",
  },
  DETAILED: {
    maxOutputTokens: 4000,
    guide:
      "about 700 to 1,200 words, structured with ## and ### headings and lists, and a checklist of next steps when relevant",
  },
} as const;

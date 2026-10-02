// Search results show a short window of text around the first match. The window is returned as
// plain text segments ({ before, match, after }) and rendered as text with <mark>, never as HTML.

export type Snippet = { before: string; match: string; after: string };

const WINDOW = 120;

function regexFor(q: string): RegExp {
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
}

// JavaScript strings are UTF-16: a window edge must not land between the halves of an emoji.
function safeStart(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff ? index + 1 : index;
}
function safeEnd(text: string, index: number): number {
  const code = text.charCodeAt(index - 1);
  return code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
}

/**
 * A window of about 120 characters with the first match near the middle, or null when `text`
 * doesn't contain the query. `…` marks a cut, outside the match so highlighting stays exact.
 */
export function buildSnippet(text: string, q: string, width = WINDOW): Snippet | null {
  const flat = text.replace(/\s+/g, " ");
  const found = regexFor(q).exec(flat);
  if (!found) return null;

  const matchStart = found.index;
  const matchEnd = matchStart + found[0].length;
  const room = Math.max(0, width - found[0].length);
  const rawStart = Math.max(0, matchStart - Math.floor(room / 2));
  // Whatever room the left side didn't use goes to the right, so a match near the start still
  // gets a full window.
  const rawEnd = Math.min(flat.length, matchEnd + (room - (matchStart - rawStart)));
  const start = rawStart === 0 ? 0 : safeStart(flat, rawStart);
  const end = safeEnd(flat, rawEnd);

  return {
    before: `${start > 0 ? "… " : ""}${flat.slice(start, matchStart).trimStart()}`,
    match: flat.slice(matchStart, matchEnd),
    after: `${flat.slice(matchEnd, end).trimEnd()}${end < flat.length ? " …" : ""}`,
  };
}

/** Splits a title into text and matching parts, for <mark>. */
export function highlightParts(title: string, q: string): { text: string; match: boolean }[] {
  const found = regexFor(q).exec(title);
  if (!found) return [{ text: title, match: false }];
  const parts = [
    { text: title.slice(0, found.index), match: false },
    { text: found[0], match: true },
    { text: title.slice(found.index + found[0].length), match: false },
  ];
  return parts.filter((p) => p.text !== "");
}

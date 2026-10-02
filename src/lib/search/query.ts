// Search input rules. User text goes into an ILIKE pattern, so `%`, `_` and `\` are escaped and a
// person can search for "50%" or "snake_case" literally.

export const MIN_QUERY = 2;
export const MAX_QUERY = 200;

export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The LIKE pattern for "contains". */
export const containsPattern = (q: string) => `%${escapeLike(q)}%`;
export const prefixPattern = (q: string) => `${escapeLike(q)}%`;

export type ParsedQuery = { ok: true; q: string } | { ok: false; reason: "too_short" | "too_long" };

/** Trims, collapses inner whitespace, then checks the 2–200 character rule. */
export function parseQuery(raw: string | null | undefined): ParsedQuery {
  const q = (raw ?? "").trim().replace(/\s+/g, " ");
  if (Array.from(q).length < MIN_QUERY) return { ok: false, reason: "too_short" };
  if (q.length > MAX_QUERY) return { ok: false, reason: "too_long" };
  return { ok: true, q };
}

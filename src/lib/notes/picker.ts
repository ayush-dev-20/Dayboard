// Ordering for the note picker that `@` and `[[` open (V2 feature 07 §3, §4). With nothing typed it
// is the notes touched most recently; with a query, title matches come first (exactly the query,
// then starting with it, then containing it), then notes that only mention it in the body. The note
// being edited is never offered, so a note cannot link to itself from the picker.

export type PickerCandidate = {
  id: string;
  title: string;
  emoji: string | null;
  /** Titles of the note's parents, top-level first: tells two notes with the same title apart. */
  path: string[];
  updatedAt: string;
  /** The query occurs in the body (the database already decided; the title is checked here). */
  bodyMatch?: boolean;
};

export const PICKER_LIMIT = 8;

function titleRank(title: string, query: string): number | null {
  const t = title.trim().toLowerCase();
  if (t === query) return 0;
  if (t.startsWith(query)) return 1;
  if (t.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (t.includes(query)) return 3;
  return null;
}

export function rankPickerResults(
  candidates: readonly PickerCandidate[],
  rawQuery: string,
  options: { excludeId?: string | null; limit?: number } = {},
): PickerCandidate[] {
  const query = rawQuery.trim().toLowerCase();
  const limit = options.limit ?? PICKER_LIMIT;
  const pool = candidates.filter((c) => c.id !== options.excludeId);
  const newestFirst = (a: PickerCandidate, b: PickerCandidate) =>
    b.updatedAt.localeCompare(a.updatedAt);

  if (!query) return [...pool].sort(newestFirst).slice(0, limit);

  const scored: { item: PickerCandidate; score: number }[] = [];
  for (const item of pool) {
    const title = titleRank(item.title, query);
    if (title !== null) scored.push({ item, score: title });
    else if (item.bodyMatch) scored.push({ item, score: 10 });
  }
  return scored
    .sort((a, b) => a.score - b.score || newestFirst(a.item, b.item))
    .slice(0, limit)
    .map((s) => s.item);
}

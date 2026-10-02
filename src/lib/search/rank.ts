// Ranking: exact title match, then title prefix, then title contains, then body contains. The same
// order is built into the SQL (see db/queries/search.ts); this is the readable version and what
// the tests check. Ties are broken by most recently updated.

export type MatchRank = 0 | 1 | 2 | 3;
export const NO_MATCH = 4;

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export function rankOf(title: string, body: string | null, q: string): MatchRank | typeof NO_MATCH {
  const t = title.toLocaleLowerCase();
  const needle = q.toLocaleLowerCase();
  if (same(t, needle)) return 0;
  if (t.startsWith(needle)) return 1;
  if (t.includes(needle)) return 2;
  if (body && body.toLocaleLowerCase().includes(needle)) return 3;
  return NO_MATCH;
}

export function sortByRank<T extends { rank: number; updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.rank - b.rank || b.updatedAt.localeCompare(a.updatedAt));
}

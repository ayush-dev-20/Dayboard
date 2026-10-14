// Joins the keyword ranking and the meaning ranking into one (V2 feature 10 §5). Pure and deterministic:
// the same two lists always give the same order. Reciprocal Rank Fusion needs only the positions, so the two
// scores (a text rank and a cosine similarity) never have to be compared.

/** The standard constant from the original RRF paper; larger values flatten the difference between ranks. */
export const RRF_K = 60;

/** Meaning matches below this cosine similarity are dropped before merging. Tuned against the fixtures. */
export const MIN_SIMILARITY = 0.35;

export type MatchKind = "keyword" | "semantic" | "both";

export type Fused = {
  id: string;
  score: number;
  kind: MatchKind;
  /** 1-based positions in the two lists, null when the list did not have the item. */
  keywordRank: number | null;
  semanticRank: number | null;
};

/**
 * Extra weight on top of the fused score. One rank step near the top is worth about 0.0003, and first place
 * about 0.016. An exact phrase is a strong signal and outweighs position; the others only reorder neighbours.
 */
export type BoostFeatures = {
  /** Every quoted phrase appears in the item. */
  phrase?: boolean;
  /** A query word is in the title. */
  titleMatch?: boolean;
  /** Days since the item changed; newer is a little better. */
  ageDays?: number;
  /** An open task ranks over a finished one. */
  open?: boolean;
};

export function boostOf(f: BoostFeatures): number {
  let boost = 0;
  if (f.phrase) boost += 0.02;
  if (f.titleMatch) boost += 0.008;
  if (f.ageDays !== undefined) boost += 0.004 * Math.exp(-Math.max(0, f.ageDays) / 60);
  if (f.open) boost += 0.003;
  return boost;
}

/** Keeps meaning matches that are close enough. `scores` are cosine similarities, best first. */
export function aboveMinimum(
  hits: { id: string; similarity: number }[],
  min = MIN_SIMILARITY,
): { id: string; similarity: number }[] {
  return hits.filter((h) => h.similarity >= min);
}

/**
 * Reciprocal Rank Fusion of two ranked id lists (best first). An id in both lists scores the sum of both
 * and is marked `both`. Ties break on the better of the two positions, then the keyword position, then the
 * id, so the order never depends on object or map iteration.
 */
export function fuse(
  keywordIds: string[],
  semanticIds: string[],
  boosts: ReadonlyMap<string, number> = new Map(),
): Fused[] {
  const rows = new Map<string, Fused>();
  const take = (ids: string[], field: "keywordRank" | "semanticRank") => {
    ids.forEach((id, i) => {
      const row = rows.get(id) ?? {
        id,
        score: 0,
        kind: "keyword",
        keywordRank: null,
        semanticRank: null,
      };
      if (row[field] === null) {
        row[field] = i + 1;
        row.score += 1 / (RRF_K + i + 1);
      }
      rows.set(id, row);
    });
  };
  take(keywordIds, "keywordRank");
  take(semanticIds, "semanticRank");

  const best = (r: Fused) => Math.min(r.keywordRank ?? Infinity, r.semanticRank ?? Infinity);
  return [...rows.values()]
    .map((r) => ({
      ...r,
      score: r.score + (boosts.get(r.id) ?? 0),
      kind: (r.keywordRank !== null && r.semanticRank !== null
        ? "both"
        : r.keywordRank !== null
          ? "keyword"
          : "semantic") as MatchKind,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        best(a) - best(b) ||
        (a.keywordRank ?? Infinity) - (b.keywordRank ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
}

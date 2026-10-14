import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { UserPreferences } from "@/db/schema";
import { NO_RESULTS, searchByIds, searchWorkspace } from "@/db/queries/search";
import { areEmbeddingsAvailable, embedTexts, getProvider, PROMPT_VERSIONS } from "@/lib/ai";
import { checkLimits } from "@/lib/ai/usage";
import type { DayPrefs } from "@/lib/dates/today";
import { logger } from "@/lib/logger";
import { aboveMinimum, boostOf, fuse } from "@/lib/search/merge";
import { parseSearchText } from "@/lib/search/parse";
import {
  SEARCH_TYPES,
  type SearchHit,
  type SearchParams,
  type SearchResults,
  type SearchType,
} from "@/lib/search/types";
import { currentModelLabel } from "./indexer";
import { idsContainingPhrases } from "./store";

// Hybrid search (V2 feature 10 §5): the keyword search that always ran, merged with a search by meaning
// when the person turned it on. The keyword branch is never replaced, and any trouble with the meaning
// branch (off, slow, over a limit, provider down) just returns the keyword results with a note.

/** How long the meaning branch may take before the keyword results are returned without it. */
export const SEMANTIC_BUDGET_MS = 2000;
const CANDIDATES = 60;

export type SemanticState = "used" | "off" | "unavailable";
export type HybridResult = { results: SearchResults; semantic: SemanticState };

const TYPE_OF: Record<string, SearchType> = {
  TASK: "task",
  TODO: "todo",
  NOTE: "note",
  PROJECT: "project",
};
const ENTITY_OF: Record<string, "TASK" | "TODO" | "NOTE" | "PROJECT"> = {
  task: "TASK",
  todo: "TODO",
  note: "NOTE",
  project: "PROJECT",
};
const MEANING_TYPES = ["task", "todo", "note", "project"] as const;

type Candidate = { type: SearchType; id: string; similarity: number; passage: string };

function wantsSemantic(prefs: UserPreferences): boolean {
  return prefs.semanticSearchEnabled && prefs.aiEnabled && areEmbeddingsAvailable();
}

/** The closest pieces of this person's indexed text, best piece per item. */
async function nearest(
  userId: string,
  vector: number[],
  tab: SearchParams["tab"],
  model: string,
): Promise<Candidate[]> {
  const literal = JSON.stringify(vector);
  const types = MEANING_TYPES.filter((t) => tab === "all" || tab === t).map((t) => ENTITY_OF[t]!);
  if (types.length === 0) return [];
  const rows = await db.transaction(async (tx) => {
    // Lets the index keep looking when most of the nearest pieces belong to someone else's filter.
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    await tx.execute(sql`set local hnsw.ef_search = 100`);
    return tx.execute<{
      entity_type: string;
      entity_id: string;
      text: string;
      similarity: number;
    }>(sql`
      select d.entity_type, d.entity_id, c.text, 1 - (c.embedding <=> ${literal}::vector) as similarity
      from embedding_chunks c
      join search_documents d on d.id = c.document_id
      where c.user_id = ${userId} and c.model = ${model} and d.status = 'INDEXED'
        and d.entity_type in (${sql.join(
          types.map((t) => sql`${t}`),
          sql`, `,
        )})
      order by c.embedding <=> ${literal}::vector
      limit ${CANDIDATES}`);
  });
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of rows) {
    const key = `${r.entity_type}:${r.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: TYPE_OF[r.entity_type]!,
      id: r.entity_id,
      similarity: Number(r.similarity),
      passage: r.text,
    });
  }
  return out;
}

async function meaningBranch(
  userId: string,
  params: SearchParams,
  text: string,
  phrases: string[],
  dayPrefs: DayPrefs,
  timezone: string,
): Promise<{ hits: SearchResults; best: Map<string, Candidate> } | null> {
  const provider = getProvider();
  // One AI action per search, against the normal per-minute and per-day limits (throws RATE_LIMITED).
  await checkLimits(userId, timezone, {
    feature: "EMBED_QUERY",
    provider: provider.id,
    model: provider.embeddingModelName(),
    promptVersion: PROMPT_VERSIONS.EMBED_QUERY,
  });
  const { vectors } = await embedTexts({
    userId,
    feature: "EMBED_QUERY",
    task: "query",
    texts: [text],
    signal: AbortSignal.timeout(SEMANTIC_BUDGET_MS),
  });
  const found = await nearest(userId, vectors[0]!, params.tab, currentModelLabel());
  const close = new Set(
    aboveMinimum(found.map((c) => ({ id: `${c.type}:${c.id}`, similarity: c.similarity }))).map(
      (c) => c.id,
    ),
  );
  if (close.size === 0) return { hits: { ...NO_RESULTS }, best: new Map() };
  const all = found.filter((c) => close.has(`${c.type}:${c.id}`));
  const best = new Map(all.map((c) => [`${c.type}:${c.id}`, c]));

  const ids = {
    task: [] as string[],
    todo: [] as string[],
    note: [] as string[],
    project: [] as string[],
  };
  for (const c of all) ids[c.type as keyof typeof ids].push(c.id);
  if (phrases.length > 0) {
    for (const t of MEANING_TYPES) {
      const keep = await idsContainingPhrases(userId, ENTITY_OF[t]!, ids[t], phrases);
      ids[t] = ids[t].filter((id) => keep.has(id));
    }
  }
  return { hits: await searchByIds(userId, { ...params, q: text }, dayPrefs, ids), best };
}

const excerpt = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 240);

/** Keyword results, merged with the search by meaning when the person has it on. */
export async function searchHybrid(
  userId: string,
  params: SearchParams,
  prefs: UserPreferences,
  dayPrefs: DayPrefs,
  limitPerType: number,
): Promise<HybridResult> {
  const parsed = parseSearchText(params.q);
  // A quoted phrase is the keyword search; the words outside it are what is searched by meaning.
  const keywordQ = parsed.phrases[0] ?? (parsed.text || params.q);
  const keyword = await searchWorkspace(userId, { ...params, q: keywordQ }, dayPrefs, limitPerType);
  const terms = [...parsed.phrases, ...parsed.text.split(" ").filter((w) => w.length >= 2)];

  const stamp = (hit: SearchHit): SearchHit => ({
    ...hit,
    reasons: { terms, passage: null, phrase: parsed.phrases.length > 0 },
  });
  const plain: SearchResults = { ...keyword };
  for (const t of SEARCH_TYPES) plain[t] = keyword[t].map(stamp);

  if (!wantsSemantic(prefs)) return { results: plain, semantic: "off" };
  if (parsed.onlyPhrases || parsed.text.length < 2) return { results: plain, semantic: "used" };

  let meaning: Awaited<ReturnType<typeof meaningBranch>>;
  try {
    meaning = await meaningBranch(
      userId,
      params,
      parsed.text,
      parsed.phrases,
      dayPrefs,
      prefs.timezone,
    );
  } catch (error) {
    logger.info("meaning search skipped", {
      reason: (error as { code?: string })?.code ?? "error",
    });
    return { results: plain, semantic: "unavailable" };
  }
  if (!meaning) return { results: plain, semantic: "unavailable" };

  const results: SearchResults = { ...plain };
  let total = plain.tag.length;
  for (const type of MEANING_TYPES) {
    const kw = new Map(plain[type].map((h) => [h.id, h]));
    // Items found by meaning that are archived are left out: the index holds live items only.
    const sem = new Map(meaning.hits[type].filter((h) => !h.archived).map((h) => [h.id, h]));
    const order = [...sem.keys()].sort(
      (a, b) =>
        (meaning.best.get(`${type}:${b}`)?.similarity ?? 0) -
        (meaning.best.get(`${type}:${a}`)?.similarity ?? 0),
    );
    const words = parsed.text
      .toLowerCase()
      .split(" ")
      .filter((w) => w.length >= 3);
    const boosts = new Map<string, number>();
    for (const hit of [...kw.values(), ...sem.values()]) {
      boosts.set(
        hit.id,
        boostOf({
          phrase: parsed.phrases.length > 0,
          titleMatch: words.some((w) => hit.title.toLowerCase().includes(w)),
          ageDays: (Date.now() - Date.parse(hit.updatedAt)) / 86_400_000,
          open: type === "task" ? !hit.done : undefined,
        }),
      );
    }
    results[type] = fuse([...kw.keys()], order, boosts)
      .slice(0, limitPerType)
      .map((f) => {
        const base = (kw.get(f.id) ?? sem.get(f.id))!;
        const passage = meaning.best.get(`${type}:${f.id}`)?.passage ?? null;
        const semanticHit = f.kind !== "keyword" && passage;
        return {
          ...base,
          matchKind: f.kind,
          snippet:
            base.snippet ??
            (semanticHit ? { before: excerpt(passage), match: "", after: "" } : null),
          reasons: {
            terms,
            passage: semanticHit ? excerpt(passage) : null,
            phrase: parsed.phrases.length > 0,
          },
        };
      });
    total += results[type].length;
  }
  results.total = total;
  return { results, semantic: "used" };
}

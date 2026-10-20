import "server-only";
import { createHash } from "node:crypto";
import { and, count, eq, max, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Executor } from "@/db/executor";
import { plainTasks } from "@/db/queries/task-filters";
import {
  embeddingChunks,
  embeddingUsageDays,
  notes,
  projects,
  searchDocuments,
  tasks,
  todos,
  userPreferences,
  type SearchEntityType,
} from "@/db/schema";
import { env } from "@/lib/env";
import { chunkNote, chunkPlain, type Chunk } from "@/lib/search/chunk";
import { containsPattern } from "@/lib/search/query";

// Reads and writes for the search index (V2 feature 10 §4). Everything is scoped to one person. The index
// is built by reading the items' own tables: nothing here is called from a task, todo, note or project
// mutation.

export const SCAN_LIMIT = 200;

const TABLE: Record<SearchEntityType, string> = {
  TASK: "tasks",
  TODO: "todos",
  NOTE: "notes",
  PROJECT: "projects",
};
export const ENTITY_TYPES = Object.keys(TABLE) as SearchEntityType[];

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The day the daily cap counts in: UTC, so it does not depend on where the server runs. */
export function usageDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function chunksUsedToday(userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ chunks: embeddingUsageDays.chunks })
    .from(embeddingUsageDays)
    .where(and(eq(embeddingUsageDays.userId, userId), eq(embeddingUsageDays.day, usageDay(now))));
  return row?.chunks ?? 0;
}

export async function remainingToday(userId: string, now: Date = new Date()): Promise<number> {
  return Math.max(0, env.EMBED_DAILY_LIMIT - (await chunksUsedToday(userId, now)));
}

export async function addChunkUsage(
  executor: Executor,
  userId: string,
  chunks: number,
  now: Date = new Date(),
): Promise<void> {
  if (chunks <= 0) return;
  await executor
    .insert(embeddingUsageDays)
    .values({ userId, day: usageDay(now), chunks })
    .onConflictDoUpdate({
      target: [embeddingUsageDays.userId, embeddingUsageDays.day],
      set: { chunks: sql`${embeddingUsageDays.chunks} + ${chunks}` },
    });
}

/** People who turned meaning-based search on, and have not turned AI off. */
export async function optedInUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(
      and(eq(userPreferences.semanticSearchEnabled, true), eq(userPreferences.aiEnabled, true)),
    );
  return rows.map((r) => r.userId);
}

export async function isOptedIn(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: userPreferences.semanticSearchEnabled, ai: userPreferences.aiEnabled })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  return Boolean(row?.on && row.ai);
}

/**
 * What needs indexing for one type: a live item with no index row, one that changed since it was indexed,
 * or one whose pieces came from another model. The item's time is cut to milliseconds because that is the
 * precision the stored copy has.
 */
function changedCondition(type: SearchEntityType, userId: string, model: string) {
  const table = sql.identifier(TABLE[type]);
  return sql`from ${table} e
    left join search_documents d on d.entity_type = ${type} and d.entity_id = e.id
    where e.user_id = ${userId} and e.deleted_at is null and e.archived_at is null
      and (d.id is null
        or date_trunc('milliseconds', e.updated_at) > d.source_updated_at
        or (d.status = 'INDEXED' and exists (
          select 1 from embedding_chunks c where c.document_id = d.id and c.model <> ${model})))`;
}

export async function findChanged(
  userId: string,
  model: string,
  limit: number,
): Promise<{ type: SearchEntityType; id: string }[]> {
  const out: { type: SearchEntityType; id: string }[] = [];
  for (const type of ENTITY_TYPES) {
    if (out.length >= limit) break;
    const rows = await db.execute<{ id: string }>(
      sql`select e.id ${changedCondition(type, userId, model)} order by e.updated_at desc limit ${limit - out.length}`,
    );
    for (const row of rows) out.push({ type, id: row.id });
  }
  return out;
}

export async function countChanged(userId: string, model: string): Promise<number> {
  let total = 0;
  for (const type of ENTITY_TYPES) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n ${changedCondition(type, userId, model)}`,
    );
    total += row?.n ?? 0;
  }
  return total;
}

export async function countEligible(userId: string): Promise<number> {
  let total = 0;
  for (const type of ENTITY_TYPES) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(TABLE[type])} e
          where e.user_id = ${userId} and e.deleted_at is null and e.archived_at is null`,
    );
    total += row?.n ?? 0;
  }
  return total;
}

/** Removes index rows whose item is gone, in Trash or archived. Their pieces go with them. */
export async function removeGone(userId: string): Promise<number> {
  let removed = 0;
  for (const type of ENTITY_TYPES) {
    const rows = await db.execute<{ id: string }>(
      sql`delete from search_documents d
          where d.user_id = ${userId} and d.entity_type = ${type} and not exists (
            select 1 from ${sql.identifier(TABLE[type])} e
            where e.id = d.entity_id and e.user_id = ${userId}
              and e.deleted_at is null and e.archived_at is null)
          returning d.id`,
    );
    removed += rows.length;
  }
  return removed;
}

export async function deleteIndex(userId: string): Promise<void> {
  await db.delete(searchDocuments).where(eq(searchDocuments.userId, userId));
}

export async function deleteDocument(
  executor: Executor,
  userId: string,
  type: SearchEntityType,
  id: string,
): Promise<void> {
  await executor
    .delete(searchDocuments)
    .where(
      and(
        eq(searchDocuments.userId, userId),
        eq(searchDocuments.entityType, type),
        eq(searchDocuments.entityId, id),
      ),
    );
}

/** Makes every index row look out of date, so the next scan checks each item again. */
export async function markAllStale(userId: string, force: boolean): Promise<void> {
  await db
    .update(searchDocuments)
    .set({
      sourceUpdatedAt: new Date(0),
      status: "INDEXED",
      failureCount: 0,
      lastErrorCode: null,
      // A forced re-index must embed again even when the text is the same.
      ...(force ? { contentHash: "" } : {}),
    })
    .where(eq(searchDocuments.userId, userId));
  if (force) await db.delete(embeddingChunks).where(eq(embeddingChunks.userId, userId));
}

export type Source = { title: string; hashText: string; updatedAt: Date; chunks: Chunk[] };

/** Loads one live item by id and owner, with its pieces. Null when it is gone, in Trash or archived. */
export async function loadSource(
  userId: string,
  type: SearchEntityType,
  id: string,
): Promise<Source | null> {
  if (type === "TASK") {
    const [r] = await db
      .select({
        title: tasks.title,
        text: tasks.descriptionText,
        updatedAt: tasks.updatedAt,
        deletedAt: tasks.deletedAt,
        archivedAt: tasks.archivedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId), plainTasks));
    if (!r || r.deletedAt || r.archivedAt) return null;
    return {
      title: r.title,
      hashText: `${r.title}\n${r.text ?? ""}`,
      updatedAt: r.updatedAt,
      chunks: chunkPlain(r.title, r.text),
    };
  }
  if (type === "TODO") {
    const [r] = await db
      .select({
        title: todos.title,
        updatedAt: todos.updatedAt,
        deletedAt: todos.deletedAt,
        archivedAt: todos.archivedAt,
      })
      .from(todos)
      .where(and(eq(todos.id, id), eq(todos.userId, userId)));
    if (!r || r.deletedAt || r.archivedAt) return null;
    return {
      title: r.title,
      hashText: r.title,
      updatedAt: r.updatedAt,
      chunks: chunkPlain(r.title, null),
    };
  }
  if (type === "NOTE") {
    const [r] = await db
      .select({
        title: notes.title,
        text: notes.contentText,
        json: notes.contentJson,
        updatedAt: notes.updatedAt,
        deletedAt: notes.deletedAt,
        archivedAt: notes.archivedAt,
      })
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId)));
    if (!r || r.deletedAt || r.archivedAt) return null;
    return {
      title: r.title,
      hashText: `${r.title}\n${r.text}`,
      updatedAt: r.updatedAt,
      chunks: chunkNote(r.title, r.json),
    };
  }
  const [r] = await db
    .select({
      title: projects.name,
      text: projects.description,
      updatedAt: projects.updatedAt,
      deletedAt: projects.deletedAt,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  if (!r || r.deletedAt || r.archivedAt) return null;
  return {
    title: r.title,
    hashText: `${r.title}\n${r.text ?? ""}`,
    updatedAt: r.updatedAt,
    chunks: chunkPlain(r.title, r.text),
  };
}

export type IndexStatus = {
  enabled: boolean;
  available: boolean;
  eligible: number;
  indexed: number;
  backlog: number;
  failed: number;
  lastIndexedAt: string | null;
  paused: boolean;
  model: string;
};

export async function documentCounts(
  userId: string,
): Promise<{ indexed: number; failed: number; lastIndexedAt: Date | null }> {
  const rows = await db
    .select({ status: searchDocuments.status, n: count(), last: max(searchDocuments.indexedAt) })
    .from(searchDocuments)
    .where(eq(searchDocuments.userId, userId))
    .groupBy(searchDocuments.status);
  let indexed = 0;
  let failed = 0;
  let lastIndexedAt: Date | null = null;
  for (const row of rows) {
    if (row.status === "FAILED") failed += row.n;
    else indexed += row.n;
    if (row.last && (!lastIndexedAt || row.last > lastIndexedAt)) lastIndexedAt = row.last;
  }
  return { indexed, failed, lastIndexedAt };
}

/** Of these ids, the ones whose title or text contains every phrase (any letter case). */
export async function idsContainingPhrases(
  userId: string,
  type: SearchEntityType,
  ids: string[],
  phrases: string[],
): Promise<Set<string>> {
  if (ids.length === 0 || phrases.length === 0) return new Set(ids);
  const column: Record<SearchEntityType, string> = {
    TASK: "coalesce(e.description_text, '')",
    TODO: "''",
    NOTE: "e.content_text",
    PROJECT: "coalesce(e.description, '')",
  };
  const title = type === "PROJECT" ? "e.name" : "e.title";
  const likes = phrases.map(
    (p) =>
      sql`(${sql.raw(title)} ilike ${containsPattern(p)} or ${sql.raw(column[type])} ilike ${containsPattern(p)})`,
  );
  const rows = await db.execute<{ id: string }>(
    sql`select e.id from ${sql.identifier(TABLE[type])} e
        where e.user_id = ${userId} and e.id in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )}) and ${sql.join(likes, sql` and `)}`,
  );
  return new Set(rows.map((r) => r.id));
}

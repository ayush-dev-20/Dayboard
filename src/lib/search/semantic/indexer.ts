import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { embeddingChunks, searchDocuments, type SearchEntityType } from "@/db/schema";
import { areEmbeddingsAvailable, embedTexts, getProvider } from "@/lib/ai";
import { embeddingLabel } from "@/lib/ai/embedding";
import { uuidv7 } from "@/lib/ids";
import {
  addChunkUsage,
  deleteDocument,
  isOptedIn,
  loadSource,
  remainingToday,
  sha256,
} from "./store";

// Indexes one item (V2 feature 10 §4): load it fresh, compare hashes, embed only the pieces that changed,
// and write the result in one transaction. Safe to run twice: the second run finds nothing to do.

export type IndexOutcome =
  "indexed" | "unchanged" | "empty" | "removed" | "skipped_off" | "skipped_cap";

export function currentModelLabel(): string {
  return embeddingLabel(getProvider().embeddingModelName());
}

export async function indexEntity(
  userId: string,
  type: SearchEntityType,
  id: string,
  signal?: AbortSignal,
): Promise<IndexOutcome> {
  // The person may have switched it off after this job was queued: nothing is read or sent then.
  if (!areEmbeddingsAvailable() || !(await isOptedIn(userId))) return "skipped_off";

  const source = await loadSource(userId, type, id);
  if (!source) {
    await deleteDocument(db, userId, type, id);
    return "removed";
  }

  const model = currentModelLabel();
  const contentHash = sha256(source.hashText);
  const [doc] = await db
    .select()
    .from(searchDocuments)
    .where(
      and(
        eq(searchDocuments.userId, userId),
        eq(searchDocuments.entityType, type),
        eq(searchDocuments.entityId, id),
      ),
    );
  const existing = doc
    ? await db
        .select({
          id: embeddingChunks.id,
          contentHash: embeddingChunks.contentHash,
          model: embeddingChunks.model,
        })
        .from(embeddingChunks)
        .where(eq(embeddingChunks.documentId, doc.id))
    : [];

  // Same text and the same model as last time: only note that this version has been seen. No model call.
  const sameModel = existing.every((c) => c.model === model);
  if (doc && doc.status !== "FAILED" && doc.contentHash === contentHash && sameModel) {
    await db
      .update(searchDocuments)
      .set({ sourceUpdatedAt: source.updatedAt })
      .where(eq(searchDocuments.id, doc.id));
    return "unchanged";
  }

  // Pieces whose text and model are unchanged keep their vector. Equal pieces are matched one for one.
  const reusable = new Map<string, string[]>();
  for (const c of existing) {
    if (c.model !== model) continue;
    reusable.set(c.contentHash, [...(reusable.get(c.contentHash) ?? []), c.id]);
  }
  const planned = source.chunks.map((chunk) => {
    const hash = sha256(chunk.text);
    const keepId = reusable.get(hash)?.shift();
    return { chunk, hash, keepId };
  });
  const fresh = planned.filter((p) => !p.keepId);

  if (fresh.length > (await remainingToday(userId))) return "skipped_cap";

  const vectors =
    fresh.length > 0
      ? (
          await embedTexts({
            userId,
            feature: "EMBED",
            task: "document",
            texts: fresh.map((p) => p.chunk.text),
            signal,
          })
        ).vectors
      : [];

  await db.transaction(async (tx) => {
    const documentId = doc?.id ?? uuidv7();
    const values = {
      contentHash,
      sourceUpdatedAt: source.updatedAt,
      chunkCount: planned.length,
      status: planned.length === 0 ? ("EMPTY" as const) : ("INDEXED" as const),
      failureCount: 0,
      lastErrorCode: null,
      indexedAt: new Date(),
    };
    if (doc) {
      await tx.update(searchDocuments).set(values).where(eq(searchDocuments.id, doc.id));
    } else {
      await tx
        .insert(searchDocuments)
        .values({ id: documentId, userId, entityType: type, entityId: id, ...values });
    }

    const kept = new Set(planned.flatMap((p) => (p.keepId ? [p.keepId] : [])));
    const drop = existing.filter((c) => !kept.has(c.id)).map((c) => c.id);
    if (drop.length > 0) await tx.delete(embeddingChunks).where(inArray(embeddingChunks.id, drop));
    for (const p of planned) {
      if (!p.keepId) continue;
      await tx
        .update(embeddingChunks)
        .set({ chunkIndex: p.chunk.index })
        .where(eq(embeddingChunks.id, p.keepId));
    }
    if (fresh.length > 0) {
      await tx.insert(embeddingChunks).values(
        fresh.map((p, i) => ({
          userId,
          documentId,
          chunkIndex: p.chunk.index,
          text: p.chunk.text,
          tokenEstimate: p.chunk.tokenEstimate,
          embedding: vectors[i]!,
          model,
          contentHash: p.hash,
        })),
      );
    }
    await addChunkUsage(tx, userId, fresh.length);
  });
  return planned.length === 0 ? "empty" : "indexed";
}

/** After the last failed attempt: remember it, so the scan leaves the item alone until it changes. */
export async function markFailed(
  userId: string,
  type: SearchEntityType,
  id: string,
  code: string,
): Promise<void> {
  const source = await loadSource(userId, type, id);
  if (!source) return;
  const values = {
    contentHash: sha256(source.hashText),
    sourceUpdatedAt: source.updatedAt,
    status: "FAILED" as const,
    lastErrorCode: code,
    indexedAt: new Date(),
  };
  await db
    .insert(searchDocuments)
    .values({ userId, entityType: type, entityId: id, failureCount: 1, ...values })
    .onConflictDoUpdate({
      target: [searchDocuments.entityType, searchDocuments.entityId],
      set: values,
    });
}

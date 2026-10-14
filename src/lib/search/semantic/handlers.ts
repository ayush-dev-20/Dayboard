import "server-only";
import { z } from "zod";
import { db } from "@/db/client";
import { SEARCH_ENTITY_TYPES } from "@/db/schema";
import { areEmbeddingsAvailable } from "@/lib/ai";
import { enqueue } from "@/lib/jobs/enqueue";
import { findHandler, registerHandler } from "@/lib/jobs/registry";
import { PermanentError } from "@/lib/jobs/types";
import { currentModelLabel, indexEntity, markFailed } from "./indexer";
import {
  findChanged,
  isOptedIn,
  optedInUserIds,
  remainingToday,
  removeGone,
  SCAN_LIMIT,
} from "./store";

// The three jobs that keep the search index up to date (V2 feature 10 §4). A schedule fires
// `embedding.scan` every five minutes; nothing here is called from a mutation. Every job is safe to run
// twice, takes the person from `ctx.userId`, and logs counts only.

export const INDEX_MAX_ATTEMPTS = 5;

/** Queues a scan for one person now. A scan already waiting or running is reused. */
export async function enqueueUserScan(userId: string): Promise<string> {
  return enqueue(db, {
    type: "embedding.scan_user",
    payload: {},
    userId,
    queue: "ai",
    dedupeKey: `embedding.scan_user:${userId}`,
  });
}

/** One scan for one person: drop what is gone, queue what changed. Returns counts for the log and tests. */
export async function scanUser(userId: string): Promise<{
  removed: number;
  queued: number;
  paused: boolean;
}> {
  if (!areEmbeddingsAvailable() || !(await isOptedIn(userId))) {
    return { removed: 0, queued: 0, paused: false };
  }
  const removed = await removeGone(userId);
  if ((await remainingToday(userId)) <= 0) return { removed, queued: 0, paused: true };

  const changed = await findChanged(userId, currentModelLabel(), SCAN_LIMIT);
  for (const item of changed) {
    await enqueue(db, {
      type: "embedding.index",
      payload: { entityType: item.type, entityId: item.id },
      userId,
      queue: "ai",
      maxAttempts: INDEX_MAX_ATTEMPTS,
      dedupeKey: `embedding.index:${item.type}:${item.id}`,
    });
  }
  return { removed, queued: changed.length, paused: false };
}

let registered = false;

/** Called by every entry point that runs jobs (through `ensureBuiltinHandlers`). */
export function ensureEmbeddingHandlers(): void {
  if (registered) return;
  registered = true;

  if (!findHandler("embedding.scan")) {
    registerHandler({
      type: "embedding.scan",
      queue: "ai",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        if (!areEmbeddingsAvailable()) return;
        const users = await optedInUserIds();
        for (const userId of users) await enqueueUserScan(userId);
        ctx.log("embedding scan queued", { people: users.length });
      },
    });
  }

  if (!findHandler("embedding.scan_user")) {
    registerHandler({
      type: "embedding.scan_user",
      queue: "ai",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        if (!ctx.userId) throw new PermanentError("A scan needs a person.");
        ctx.log("embedding scan done", await scanUser(ctx.userId));
      },
    });
  }

  if (!findHandler("embedding.index")) {
    registerHandler({
      type: "embedding.index",
      queue: "ai",
      schema: z.object({ entityType: z.enum(SEARCH_ENTITY_TYPES), entityId: z.uuid() }).strict(),
      run: async (ctx, payload) => {
        if (!ctx.userId) throw new PermanentError("Indexing needs a person.");
        try {
          const outcome = await indexEntity(
            ctx.userId,
            payload.entityType,
            payload.entityId,
            ctx.signal,
          );
          ctx.log("embedding index", { outcome, entityType: payload.entityType });
        } catch (error) {
          if (ctx.attempt >= INDEX_MAX_ATTEMPTS) {
            const code = (error as { code?: string } | null)?.code ?? "INDEX_FAILED";
            await markFailed(ctx.userId, payload.entityType, payload.entityId, String(code));
            throw new PermanentError("Indexing failed after the last attempt.");
          }
          throw error;
        }
      },
    });
  }
}

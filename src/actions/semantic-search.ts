"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { userPreferences } from "@/db/schema";
import { runAction, type ActionResult } from "@/lib/actions";
import { areEmbeddingsAvailable } from "@/lib/ai";
import { AppError } from "@/lib/errors";
import { getPreferences } from "@/lib/preferences";
import { enqueueUserScan } from "@/lib/search/semantic/handlers";
import { indexStatus } from "@/lib/search/semantic/status";
import { deleteIndex, markAllStale, type IndexStatus } from "@/lib/search/semantic/store";
import { requireUser } from "@/lib/session";
import { setSemanticSearchSchema } from "@/lib/validations/semantic-search";

// Server Actions of meaning-based search (V2 feature 10 §6). Each starts with who is asking and is scoped
// to that person. Turning it on only saves the choice: the scheduled scan (or Start now) builds the index.

export async function setSemanticSearch(input: unknown): Promise<ActionResult<IndexStatus>> {
  return runAction("search.setSemantic", async () => {
    const user = await requireUser();
    const { enabled } = setSemanticSearchSchema.parse(input);
    const prefs = await getPreferences(user.id);
    if (enabled && (!prefs.aiEnabled || !areEmbeddingsAvailable())) {
      throw new AppError(
        "AI_DISABLED",
        "Turn on AI features first, and use a provider that can index.",
      );
    }
    await db
      .update(userPreferences)
      .set({ semanticSearchEnabled: enabled })
      .where(eq(userPreferences.userId, user.id));
    // Off deletes the whole index: the person's text is not kept for a feature that is switched off.
    if (!enabled) await deleteIndex(user.id);
    revalidatePath("/settings/ai");
    return indexStatus(user.id);
  });
}

/** "Start now": queue a scan for this person instead of waiting for the next one. */
export async function startSemanticIndexing(): Promise<ActionResult<IndexStatus>> {
  return runAction("search.startIndexing", async () => {
    const user = await requireUser();
    const prefs = await getPreferences(user.id);
    if (!prefs.semanticSearchEnabled || !prefs.aiEnabled || !areEmbeddingsAvailable()) {
      throw new AppError("AI_DISABLED");
    }
    await enqueueUserScan(user.id);
    return indexStatus(user.id);
  });
}

export async function getSearchIndexStatus(): Promise<ActionResult<IndexStatus>> {
  return runAction("search.indexStatus", async () => {
    const user = await requireUser();
    return indexStatus(user.id);
  });
}

/** Re-embeds everything (after a model change, or if something looks missing). */
export async function reindexSearch(): Promise<ActionResult<IndexStatus>> {
  return runAction("search.reindex", async () => {
    const user = await requireUser();
    const prefs = await getPreferences(user.id);
    if (!prefs.semanticSearchEnabled || !prefs.aiEnabled || !areEmbeddingsAvailable()) {
      throw new AppError("AI_DISABLED");
    }
    await markAllStale(user.id, true);
    await enqueueUserScan(user.id);
    return indexStatus(user.id);
  });
}

import "server-only";
import { areEmbeddingsAvailable } from "@/lib/ai";
import { currentModelLabel } from "./indexer";
import {
  countChanged,
  countEligible,
  documentCounts,
  isOptedIn,
  remainingToday,
  type IndexStatus,
} from "./store";

/** Counts only, for Settings. Never any text from an item. */
export async function indexStatus(userId: string): Promise<IndexStatus> {
  const available = areEmbeddingsAvailable();
  const enabled = await isOptedIn(userId);
  const model = currentModelLabel();
  if (!available || !enabled) {
    return {
      enabled,
      available,
      eligible: 0,
      indexed: 0,
      backlog: 0,
      failed: 0,
      lastIndexedAt: null,
      paused: false,
      model,
    };
  }
  const [eligible, docs, backlog, remaining] = await Promise.all([
    countEligible(userId),
    documentCounts(userId),
    countChanged(userId, model),
    remainingToday(userId),
  ]);
  return {
    enabled,
    available,
    eligible,
    indexed: docs.indexed,
    backlog,
    failed: docs.failed,
    lastIndexedAt: docs.lastIndexedAt?.toISOString() ?? null,
    paused: remaining <= 0 && backlog > 0,
    model,
  };
}

import "server-only";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { pruneJobs, pruneSync } from "./maintenance";
import { findHandler, registerHandler } from "./registry";
import { ensureEmbeddingHandlers } from "@/lib/search/semantic/handlers";
import { ensureCalendarHandlers } from "@/lib/calendar/handlers";
import { ensureVoiceHandlers } from "@/lib/voice/handlers";
import { ensureReviewHandlers } from "@/lib/review/handlers";

// The job types this release ships (V2 feature 08 §5). Later features register theirs in their own modules.
// Each entry point calls `ensureBuiltinHandlers` once before it runs jobs.

let registered = false;

export function ensureBuiltinHandlers(): void {
  if (registered) return;
  registered = true;
  // The search index jobs (V2 feature 10) live in their own module.
  ensureEmbeddingHandlers();
  // The calendar sync jobs (V2 feature 12) live in their own module.
  ensureCalendarHandlers();
  // The voice capture jobs (V2 feature 13) live in their own module.
  ensureVoiceHandlers();
  // The weekly review jobs (V2 feature 15) live in their own module.
  ensureReviewHandlers();
  if (!findHandler("system.ping")) {
    registerHandler({
      type: "system.ping",
      queue: "default",
      schema: z.object({ message: z.string().max(200).optional() }).strict(),
      run: async (ctx, payload) => {
        ctx.log("ping", { message: payload.message ?? null });
      },
    });
  }
  if (!findHandler("maintenance.prune_jobs")) {
    registerHandler({
      type: "maintenance.prune_jobs",
      queue: "default",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        const removed = await pruneJobs();
        ctx.log("pruned finished jobs", removed);
      },
    });
  }
  if (!findHandler("maintenance.prune_sync")) {
    registerHandler({
      type: "maintenance.prune_sync",
      queue: "default",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        const removed = await pruneSync();
        ctx.log("pruned sync log", removed);
        logger.info("sync log pruned", removed);
      },
    });
  }
}

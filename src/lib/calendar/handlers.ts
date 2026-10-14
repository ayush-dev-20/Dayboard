import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { calendarAccounts } from "@/db/schema";
import { env } from "@/lib/env";
import { findHandler, registerHandler } from "@/lib/jobs/registry";
import { PermanentError, RetryAfter } from "@/lib/jobs/types";
import { enqueueAccountSync, getAccount } from "./store";
import { syncAccount } from "./sync";
import { CalendarProviderError } from "./types";

// The calendar's jobs (V2 feature 12 §5), registered by `ensureCalendarHandlers` from `ensureBuiltinHandlers`.
// A schedule fires `calendar.sync_all` every 15 minutes; it queues one `calendar.sync` per connected account.
// Both are safe to run twice, take the person from the job row, and log counts only.

const WINDOW_MS = 15 * 60 * 1000;

export function ensureCalendarHandlers(): void {
  if (!findHandler("calendar.sync")) {
    registerHandler({
      type: "calendar.sync",
      queue: "default",
      schema: z.object({ accountId: z.uuid() }).strict(),
      run: async (ctx, payload) => {
        if (!env.calendarAvailable) return;
        if (!ctx.userId) throw new PermanentError("A calendar sync needs a person.");
        // The account comes from the job's own person, never from the payload alone. A disconnected account is done.
        const account = await getAccount(ctx.userId, payload.accountId).catch(() => null);
        if (!account) return;
        try {
          const outcome = await syncAccount(account.id);
          ctx.log("calendar sync", { status: outcome.status });
        } catch (error) {
          if (error instanceof CalendarProviderError) {
            if (error.code === "RATE_LIMITED")
              throw new RetryAfter(error.retryAfterMs ?? 60_000, "Google is limiting requests");
            if (error.code === "FORBIDDEN") throw new PermanentError("Google refused the request.");
          }
          throw error;
        }
      },
    });
  }

  if (!findHandler("calendar.sync_all")) {
    registerHandler({
      type: "calendar.sync_all",
      queue: "default",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        if (!env.calendarAvailable) return;
        const accounts = await db
          .select({ id: calendarAccounts.id, userId: calendarAccounts.userId })
          .from(calendarAccounts)
          .where(eq(calendarAccounts.status, "ACTIVE"));
        const window = String(Math.floor(Date.now() / WINDOW_MS));
        for (const account of accounts)
          await enqueueAccountSync(account.userId, account.id, window);
        ctx.log("calendar accounts queued", { accounts: accounts.length });
      },
    });
  }
}

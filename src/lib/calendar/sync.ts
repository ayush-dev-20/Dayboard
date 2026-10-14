import "server-only";
import { and, eq, isNull, lt, or, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  calendarAccounts,
  calendarEvents,
  calendarSources,
  type CalendarSource,
} from "@/db/schema";
import { logger } from "@/lib/logger";
import { accessTokenFor, refreshCalendars } from "./store";
import { getCalendarProvider } from "./providers";
import { CalendarProviderError, type NormalizedEvent } from "./types";

// Reading a person's calendars into the cache (V2 feature 12 §5). Safe to run twice, and safe with several
// workers: an account is leased first. Logs carry account ids and counts, never titles or tokens.

const DAY_MS = 24 * 60 * 60 * 1000;
export const PAST_DAYS = 30;
export const FUTURE_DAYS = 90;
const LEASE_MS = 5 * 60 * 1000;
const UPSERT_CHUNK = 200;

export type SyncOutcome =
  | { status: "synced"; upserted: number; removed: number }
  | { status: "busy" }
  | { status: "needs_reconnect" };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Must run on the sync transaction's own connection: another one would wait on rows this one deleted. */
async function upsertEvents(tx: Tx, sourceId: string, userId: string, events: NormalizedEvent[]) {
  for (let i = 0; i < events.length; i += UPSERT_CHUNK) {
    const chunk = events.slice(i, i + UPSERT_CHUNK);
    await tx
      .insert(calendarEvents)
      .values(
        chunk.map((e) => ({
          userId,
          sourceId,
          providerEventId: e.providerEventId,
          icalUid: e.icalUid,
          title: e.title,
          location: e.location,
          startAt: e.startAt,
          endAt: e.endAt,
          allDay: e.allDay,
          timeZone: e.timeZone,
          busy: e.busy,
          status: e.status,
          htmlLink: e.htmlLink,
          recurringEventId: e.recurringEventId,
          updatedAt: e.updatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [calendarEvents.sourceId, calendarEvents.providerEventId],
        set: {
          icalUid: sql`excluded.ical_uid`,
          title: sql`excluded.title`,
          location: sql`excluded.location`,
          startAt: sql`excluded.start_at`,
          endAt: sql`excluded.end_at`,
          allDay: sql`excluded.all_day`,
          timeZone: sql`excluded.time_zone`,
          busy: sql`excluded.busy`,
          status: sql`excluded.status`,
          htmlLink: sql`excluded.html_link`,
          recurringEventId: sql`excluded.recurring_event_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

async function syncSource(
  userId: string,
  accessToken: string,
  source: CalendarSource,
  now: Date,
): Promise<{ upserted: number; removed: number }> {
  const provider = getCalendarProvider();
  const range = {
    from: new Date(now.getTime() - PAST_DAYS * DAY_MS),
    to: new Date(now.getTime() + FUTURE_DAYS * DAY_MS),
  };
  const credentials = { accessToken };

  let result;
  try {
    result = await provider.listEvents(
      credentials,
      source.providerCalendarId,
      range,
      source.syncToken ?? undefined,
    );
  } catch (error) {
    // The sync token expired (Google's 410): read the whole window again.
    if (error instanceof CalendarProviderError && error.code === "SYNC_TOKEN_EXPIRED") {
      result = await provider.listEvents(credentials, source.providerCalendarId, range);
    } else {
      throw error;
    }
  }

  let removed = 0;
  await db.transaction(async (tx) => {
    if (result.fullSync) {
      // A full read is the truth for the window: what is not in it is gone.
      const keep = result.events.map((e) => e.providerEventId);
      const gone = await tx
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.sourceId, source.id),
            keep.length > 0 ? sql`${calendarEvents.providerEventId} not in ${keep}` : undefined,
          ),
        )
        .returning({ id: calendarEvents.id });
      removed += gone.length;
    } else if (result.removedIds.length > 0) {
      const gone = await tx
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.sourceId, source.id),
            inArray(calendarEvents.providerEventId, result.removedIds),
          ),
        )
        .returning({ id: calendarEvents.id });
      removed += gone.length;
    }
    await upsertEvents(tx, source.id, userId, result.events);

    // Nothing outside the window is kept (30 days back to 90 ahead).
    const stale = await tx
      .delete(calendarEvents)
      .where(
        and(
          eq(calendarEvents.sourceId, source.id),
          or(lt(calendarEvents.endAt, range.from), gt(calendarEvents.startAt, range.to)),
        ),
      )
      .returning({ id: calendarEvents.id });
    removed += stale.length;

    await tx
      .update(calendarSources)
      .set({ syncToken: result.nextSyncToken ?? null, lastSyncedAt: now })
      .where(eq(calendarSources.id, source.id));
  });
  return { upserted: result.events.length, removed };
}

/** Reads every selected calendar of one account. `busy` means another sync holds the account. */
export async function syncAccount(accountId: string, now: Date = new Date()): Promise<SyncOutcome> {
  const [account] = await db
    .update(calendarAccounts)
    .set({ syncLeaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(calendarAccounts.id, accountId),
        eq(calendarAccounts.status, "ACTIVE"),
        or(isNull(calendarAccounts.syncLeaseUntil), lt(calendarAccounts.syncLeaseUntil, now)),
      ),
    )
    .returning();
  if (!account) return { status: "busy" };

  const started = Date.now();
  try {
    const token = await accessTokenFor(account);
    if (!token.ok) return { status: "needs_reconnect" };

    await refreshCalendars(account, token.accessToken);
    const sources = await db
      .select()
      .from(calendarSources)
      .where(and(eq(calendarSources.accountId, account.id), eq(calendarSources.selected, true)));

    let upserted = 0;
    let removed = 0;
    for (const source of sources) {
      const counts = await syncSource(account.userId, token.accessToken, source, now);
      upserted += counts.upserted;
      removed += counts.removed;
    }
    await db
      .update(calendarAccounts)
      .set({ lastSyncedAt: now, lastError: null })
      .where(eq(calendarAccounts.id, account.id));
    logger.info("calendar synced", {
      accountId,
      calendars: sources.length,
      upserted,
      removed,
      durationMs: Date.now() - started,
    });
    return { status: "synced", upserted, removed };
  } catch (error) {
    const code = error instanceof CalendarProviderError ? error.code : "ERROR";
    if (code === "INVALID_GRANT") {
      // Google no longer accepts the connection. That is normal in Testing mode (tokens last 7 days).
      const { markNeedsReconnect } = await import("./store");
      await markNeedsReconnect(account.id);
      return { status: "needs_reconnect" };
    }
    await db
      .update(calendarAccounts)
      .set({ lastError: code })
      .where(eq(calendarAccounts.id, account.id));
    logger.warn("calendar sync failed", { accountId, errorCode: code });
    throw error;
  } finally {
    await db
      .update(calendarAccounts)
      .set({ syncLeaseUntil: null })
      .where(eq(calendarAccounts.id, accountId));
  }
}

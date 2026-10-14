import "server-only";
import { and, eq, gt, inArray, like, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  calendarAccounts,
  calendarEvents,
  calendarSources,
  jobs,
  type CalendarAccount,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enqueue } from "@/lib/jobs/enqueue";
import { hasWriteScope } from "./oauth";
import type { CalendarAccountDTO, CalendarStatusDTO, EventDTO } from "./dto";
import { openToken, sealToken } from "./crypto";
import { calendarKeys } from "./keyring";
import { getCalendarProvider } from "./providers";
import type { TokenSet } from "./types";

// Accounts, calendars and the event cache for one person (V2 feature 12 §2, §8). Every query carries the
// person's id. Tokens are sealed here and opened only in `accessTokenFor`; nothing in this file logs them.

const tokenContext = (userId: string, providerAccountId: string) =>
  `${userId}:${providerAccountId}`;

/** Queues a sync of one account (the scheduled path). A sync already waiting or running is reused. */
export function enqueueAccountSync(userId: string, accountId: string, window?: string) {
  return enqueue(db, {
    type: "calendar.sync",
    payload: { accountId },
    userId,
    dedupeKey: `calendar.sync:${accountId}:${window ?? "now"}`,
  });
}

/**
 * Saves a connection that Google just approved: the account (refresh token sealed), its calendars (the primary
 * one selected on a first connect), and a first sync.
 */
export async function connectAccount(userId: string, tokens: TokenSet): Promise<string> {
  if (!tokens.account)
    throw new AppError("VALIDATION_ERROR", "Google didn't say which account that was.");
  const providerAccountId = tokens.account.id;

  const [existing] = await db
    .select()
    .from(calendarAccounts)
    .where(
      and(
        eq(calendarAccounts.userId, userId),
        eq(calendarAccounts.provider, "GOOGLE"),
        eq(calendarAccounts.providerAccountId, providerAccountId),
      ),
    );
  // Google sends a refresh token only on a consent screen. Without one, the old token has to do.
  if (!tokens.refreshToken && !existing) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Google didn't give access that lasts. Try connecting again.",
    );
  }
  const refreshTokenEnc = tokens.refreshToken
    ? sealToken(tokens.refreshToken, calendarKeys(), tokenContext(userId, providerAccountId))
    : existing!.refreshTokenEnc;

  const [account] = await db
    .insert(calendarAccounts)
    .values({
      userId,
      provider: "GOOGLE",
      providerAccountId,
      email: tokens.account.email,
      refreshTokenEnc,
      scopes: tokens.scopes,
      status: "ACTIVE",
    })
    .onConflictDoUpdate({
      target: [
        calendarAccounts.userId,
        calendarAccounts.provider,
        calendarAccounts.providerAccountId,
      ],
      set: {
        email: tokens.account.email,
        refreshTokenEnc,
        scopes: tokens.scopes,
        status: "ACTIVE",
        lastError: null,
        connectedAt: new Date(),
      },
    })
    .returning();
  if (!account) throw new AppError("INTERNAL_ERROR");

  await refreshCalendars(account, tokens.accessToken, !existing);
  await enqueueAccountSync(userId, account.id);
  return account.id;
}

/** Reads the account's calendar list and keeps the sources in step. A first connect selects the primary one. */
export async function refreshCalendars(
  account: CalendarAccount,
  accessToken: string,
  selectPrimary = false,
) {
  const listed = await getCalendarProvider().listCalendars({ accessToken });
  const known = await db
    .select()
    .from(calendarSources)
    .where(eq(calendarSources.accountId, account.id));
  const knownIds = new Map(known.map((s) => [s.providerCalendarId, s]));

  for (const calendar of listed) {
    const have = knownIds.get(calendar.id);
    if (have) {
      await db
        .update(calendarSources)
        .set({ name: calendar.name, color: calendar.color, timeZone: calendar.timeZone })
        .where(eq(calendarSources.id, have.id));
    } else {
      await db.insert(calendarSources).values({
        userId: account.userId,
        accountId: account.id,
        providerCalendarId: calendar.id,
        name: calendar.name,
        color: calendar.color,
        timeZone: calendar.timeZone,
        selected: selectPrimary && calendar.primary,
      });
    }
  }
  // A calendar the person removed in Google goes away here, with its cached events.
  const listedIds = new Set(listed.map((c) => c.id));
  const gone = known.filter((s) => !listedIds.has(s.providerCalendarId)).map((s) => s.id);
  if (gone.length > 0) await db.delete(calendarSources).where(inArray(calendarSources.id, gone));
}

/** A fresh access token for an account, or the status it was moved to when Google refused. */
export async function accessTokenFor(
  account: CalendarAccount,
): Promise<{ ok: true; accessToken: string } | { ok: false; status: "NEEDS_RECONNECT" }> {
  const keys = calendarKeys();
  const refresh = openToken(
    account.refreshTokenEnc,
    keys,
    tokenContext(account.userId, account.providerAccountId),
  );
  try {
    const tokens = await getCalendarProvider().refreshAccessToken(refresh);
    return { ok: true, accessToken: tokens.accessToken };
  } catch (error) {
    if ((error as { code?: string }).code === "INVALID_GRANT") {
      await markNeedsReconnect(account.id);
      return { ok: false, status: "NEEDS_RECONNECT" };
    }
    throw error;
  }
}

export async function markNeedsReconnect(accountId: string) {
  await db
    .update(calendarAccounts)
    .set({ status: "NEEDS_RECONNECT", lastError: "INVALID_GRANT", syncLeaseUntil: null })
    .where(eq(calendarAccounts.id, accountId));
  logger.warn("calendar needs reconnect", { accountId });
}

export async function getAccount(userId: string, accountId: string): Promise<CalendarAccount> {
  const [account] = await db
    .select()
    .from(calendarAccounts)
    .where(and(eq(calendarAccounts.id, accountId), eq(calendarAccounts.userId, userId)));
  if (!account) throw new AppError("NOT_FOUND");
  return account;
}

export async function getStatus(userId: string): Promise<CalendarStatusDTO> {
  const accounts = await db
    .select()
    .from(calendarAccounts)
    .where(eq(calendarAccounts.userId, userId))
    .orderBy(calendarAccounts.connectedAt);
  const sources = accounts.length
    ? await db
        .select()
        .from(calendarSources)
        .where(eq(calendarSources.userId, userId))
        .orderBy(calendarSources.name)
    : [];
  return {
    accounts: accounts.map((a): CalendarAccountDTO => ({
      id: a.id,
      email: a.email,
      status: a.status as CalendarAccountDTO["status"],
      canCreateEvents: hasWriteScope(a.scopes),
      lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      calendars: sources
        .filter((s) => s.accountId === a.id)
        .map((s) => ({ id: s.id, name: s.name, color: s.color, selected: s.selected })),
    })),
  };
}

/** Turns a calendar on or off. Off removes its cached events at once; on queues a sync. */
export async function setCalendarSelected(userId: string, sourceId: string, selected: boolean) {
  const [source] = await db
    .select()
    .from(calendarSources)
    .where(and(eq(calendarSources.id, sourceId), eq(calendarSources.userId, userId)));
  if (!source) throw new AppError("NOT_FOUND");
  await db
    .update(calendarSources)
    .set({ selected, syncToken: null })
    .where(eq(calendarSources.id, sourceId));
  if (!selected) {
    await db.delete(calendarEvents).where(eq(calendarEvents.sourceId, sourceId));
  } else {
    await enqueueAccountSync(userId, source.accountId);
  }
}

/**
 * Cached events between two instants, from the person's selected calendars. Cancelled events are never cached.
 * A connection that needs reconnecting still shows what it last synced.
 */
export async function eventsBetween(userId: string, from: Date, to: Date): Promise<EventDTO[]> {
  const rows = await db
    .select({ event: calendarEvents, name: calendarSources.name, color: calendarSources.color })
    .from(calendarEvents)
    .innerJoin(calendarSources, eq(calendarSources.id, calendarEvents.sourceId))
    .innerJoin(calendarAccounts, eq(calendarAccounts.id, calendarSources.accountId))
    .where(
      and(
        eq(calendarEvents.userId, userId),
        eq(calendarSources.selected, true),
        ne(calendarAccounts.status, "REVOKED"),
        ne(calendarEvents.status, "cancelled"),
        lt(calendarEvents.startAt, to),
        gt(calendarEvents.endAt, from),
      ),
    )
    .orderBy(calendarEvents.startAt)
    .limit(1000);
  return rows.map(({ event, name, color }) => ({
    id: event.id,
    title: event.title,
    location: event.location,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    allDay: event.allDay,
    busy: event.busy,
    status: event.status === "tentative" ? "tentative" : "confirmed",
    htmlLink: event.htmlLink,
    calendar: { name, color },
  }));
}

/**
 * Disconnects an account: best-effort revoke at Google, then everything of it goes (sources, events, links) and
 * its waiting jobs are cancelled. It takes effect at once, whatever Google answers.
 */
export async function disconnectAccount(userId: string, accountId: string) {
  const account = await getAccount(userId, accountId);
  try {
    const refresh = openToken(
      account.refreshTokenEnc,
      calendarKeys(),
      tokenContext(userId, account.providerAccountId),
    );
    await getCalendarProvider().revoke(refresh);
  } catch {
    // The token may already be unreadable or revoked. Deleting our copy is what matters.
  }
  await db.transaction(async (tx) => {
    await tx
      .update(jobs)
      .set({ status: "CANCELLED", finishedAt: new Date(), lockedBy: null, lockedUntil: null })
      .where(
        and(
          eq(jobs.userId, userId),
          like(jobs.type, "calendar.%"),
          inArray(jobs.status, ["QUEUED", "FAILED"]),
        ),
      );
    await tx
      .delete(calendarAccounts)
      .where(and(eq(calendarAccounts.id, accountId), eq(calendarAccounts.userId, userId)));
  });
}

/** The person's accounts that are connected and due a refresh (older than `maxAgeMs`, or never synced). */
export async function staleAccounts(userId: string, maxAgeMs: number, now = new Date()) {
  return db
    .select()
    .from(calendarAccounts)
    .where(
      and(
        eq(calendarAccounts.userId, userId),
        eq(calendarAccounts.status, "ACTIVE"),
        sql`(${calendarAccounts.lastSyncedAt} is null or ${calendarAccounts.lastSyncedAt} < ${new Date(now.getTime() - maxAgeMs)})`,
      ),
    );
}

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";
import { tasks } from "./tasks";

// Google Calendar (V2 feature 12 §2). Refresh tokens are stored encrypted (AES-256-GCM); access tokens are
// never stored. Event titles are private data, like notes: never logged.

export const CALENDAR_ACCOUNT_STATUSES = ["ACTIVE", "NEEDS_RECONNECT", "REVOKED"] as const;
export type CalendarAccountStatus = (typeof CALENDAR_ACCOUNT_STATUSES)[number];

export const calendarAccounts = pgTable(
  "calendar_accounts",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("GOOGLE"),
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email").notNull(),
    // `v1.<keyId>.<iv>.<ciphertext>.<tag>`, see src/lib/calendar/crypto.ts.
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scopes: text("scopes").array().notNull(),
    status: text("status").notNull().default("ACTIVE"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    // A sync takes this lease first, so two workers never sync one account at once.
    syncLeaseUntil: timestamp("sync_lease_until", { withTimezone: true }),
  },
  (t) => [
    check("calendar_accounts_provider", sql`${t.provider} in ('GOOGLE')`),
    check("calendar_accounts_status", sql`${t.status} in ('ACTIVE','NEEDS_RECONNECT','REVOKED')`),
    uniqueIndex("calendar_accounts_provider_account_idx").on(
      t.userId,
      t.provider,
      t.providerAccountId,
    ),
  ],
);

export const calendarSources = pgTable(
  "calendar_sources",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    providerCalendarId: text("provider_calendar_id").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    timeZone: text("time_zone"),
    selected: boolean("selected").notNull().default(false),
    // Google's incremental sync token. Cleared when Google answers 410.
    syncToken: text("sync_token"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("calendar_sources_account_calendar_idx").on(t.accountId, t.providerCalendarId),
    index("calendar_sources_user_idx").on(t.userId),
  ],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => calendarSources.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id").notNull(),
    icalUid: text("ical_uid"),
    title: text("title").notNull(),
    location: text("location"),
    // An all-day event is stored as midnight UTC of its first day to midnight UTC after its last, and read
    // by its UTC date: Google's all-day dates have no time zone.
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    timeZone: text("time_zone"),
    busy: boolean("busy").notNull().default(true),
    status: text("status").notNull().default("confirmed"),
    htmlLink: text("html_link"),
    recurringEventId: text("recurring_event_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("calendar_events_status", sql`${t.status} in ('confirmed','tentative','cancelled')`),
    uniqueIndex("calendar_events_source_event_idx").on(t.sourceId, t.providerEventId),
    index("calendar_events_user_start_idx").on(t.userId, t.startAt),
  ],
);

/** An event made from a task (feature 12 §7). Used to show "Calendar event" and to warn about a changed time. */
export const calendarTaskLinks = pgTable(
  "calendar_task_links",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => calendarSources.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.providerEventId] })],
);

export type CalendarAccount = typeof calendarAccounts.$inferSelect;
export type CalendarSource = typeof calendarSources.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

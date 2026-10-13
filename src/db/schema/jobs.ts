import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";

// Background jobs (V2 feature 08, docs/decisions/0009). Payloads hold ids and parameters only, never note
// text or transcripts. Written through src/lib/jobs/enqueue.ts and the runner.

export const JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
  "CANCELLED",
] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    queue: text("queue").notNull().default("default"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    payloadVersion: integer("payload_version").notNull().default(1),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("QUEUED"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    dedupeKey: text("dedupe_key"),
    correlationId: text("correlation_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "jobs_status",
      sql`${t.status} in ('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD','CANCELLED')`,
    ),
    check("jobs_attempts", sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
    index("jobs_claim_idx").on(t.queue, t.status, t.runAt),
    index("jobs_user_type_status_idx").on(t.userId, t.type, t.status),
    // At most one job that has not finished per key (a scheduled slot, or a caller's own key).
    uniqueIndex("jobs_active_dedupe_key_idx")
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('QUEUED','RUNNING') and ${t.dedupeKey} is not null`),
  ],
);

/** One row per worker process, refreshed every 10 seconds. Read by /api/health (informational). */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  version: text("version").notNull(),
  queues: text("queues").array().notNull(),
  currentJobId: uuid("current_job_id"),
  hostname: text("hostname").notNull(),
});

/** Recurring jobs. `cron` is a small fixed form: `every 60s`, `every 5m`, `daily 03:00 UTC`. */
export const jobSchedules = pgTable(
  "job_schedules",
  {
    name: text("name").primaryKey(),
    cron: text("cron").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    queue: text("queue").notNull().default("default"),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("job_schedules_due_idx").on(t.enabled, t.nextRunAt)],
);

export type Job = typeof jobs.$inferSelect;

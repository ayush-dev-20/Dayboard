import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";
import { aiFeatureEnum, aiUsageStatusEnum } from "./enums";

// One row per AI attempt, for limits and the usage count in Settings. It never holds a prompt or
// an answer: only which feature ran, how it ended and how long it took.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    feature: aiFeatureEnum("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: aiUsageStatusEnum("status").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms").notNull().default(0),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_user_created_idx").on(t.userId, t.createdAt.desc())],
);

// The "daily suggestion" card. Stored so a refresh of Today does not spend quota again.
export const aiDailySuggestions = pgTable(
  "ai_daily_suggestions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    text: text("text").notNull(),
    // How many times it was regenerated today. The Refresh control allows one.
    refreshCount: integer("refresh_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.localDate] }),
    check("ai_daily_suggestions_text_length", sql`char_length(${t.text}) between 1 and 280`),
  ],
);

// A record of every change an AI proposal made once the person confirmed it (V2 feature 11 §3).
// It holds ids and a short summary of counts and kinds ("Created 3 tasks"), never note content, task
// titles or prompts. `(user_id, proposal_id)` is unique, so a proposal can be applied only once.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    action: text("action").notNull(),
    entityRefs: jsonb("entity_refs").$type<{ type: string; id: string }[]>().notNull().default([]),
    proposalId: text("proposal_id").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_user_created_idx").on(t.userId, t.createdAt.desc()),
    uniqueIndex("audit_log_user_proposal_idx").on(t.userId, t.proposalId),
    check("audit_log_summary_length", sql`char_length(${t.summary}) between 1 and 200`),
    check("audit_log_source", sql`${t.source} in ('ASSISTANT', 'WEEKLY_REVIEW', 'VOICE')`),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
export type AiDailySuggestion = typeof aiDailySuggestions.$inferSelect;

import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
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

export type AiUsage = typeof aiUsage.$inferSelect;
export type AiDailySuggestion = typeof aiDailySuggestions.$inferSelect;

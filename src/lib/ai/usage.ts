import "server-only";
import { and, count, eq, gte, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { aiUsage } from "@/db/schema";
import { env } from "@/lib/env";
import { localDay } from "@/lib/dates/today";
import { AppError } from "@/lib/errors";
import { evaluateLimits, rateLimitMessage, type Limits } from "./limits";
import type { AIFeature, TokenUsage } from "./types";

export function getLimits(): Limits {
  return { perMinute: env.AI_LIMIT_PER_MINUTE, perDay: env.AI_LIMIT_PER_DAY };
}

// Rate-limited attempts are written down too, but they never count toward a limit: otherwise
// pressing the button again while waiting would make the wait longer.
const counted = ne(aiUsage.status, "RATE_LIMITED");

export async function countToday(userId: string, timezone: string, now = new Date()) {
  const { start } = localDay(timezone, now);
  const [row] = await db
    .select({ n: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), counted, gte(aiUsage.createdAt, start)));
  return row?.n ?? 0;
}

export type UsageRecord = {
  userId: string;
  feature: AIFeature;
  provider: string;
  model: string;
  status: "SUCCESS" | "PROVIDER_ERROR" | "VALIDATION_ERROR" | "RATE_LIMITED";
  promptVersion: string;
  latencyMs?: number;
  tokens?: TokenUsage;
};

/** Never stores a prompt or an answer: only what ran and how it ended. */
export async function recordUsage(record: UsageRecord): Promise<void> {
  await db.insert(aiUsage).values({
    userId: record.userId,
    feature: record.feature,
    provider: record.provider,
    model: record.model,
    status: record.status,
    promptVersion: record.promptVersion,
    latencyMs: Math.max(0, Math.round(record.latencyMs ?? 0)),
    inputTokens: record.tokens?.inputTokens ?? null,
    outputTokens: record.tokens?.outputTokens ?? null,
  });
}

/**
 * Throws `RATE_LIMITED` (with `retryAfterSeconds`) when the person is over a limit, after
 * recording the blocked attempt. Called by the request pipeline before any provider work.
 */
export async function checkLimits(
  userId: string,
  timezone: string,
  info: { feature: AIFeature; provider: string; model: string; promptVersion: string },
  now: Date = new Date(),
): Promise<void> {
  const limits = getLimits();
  const { start, nextMidnight } = localDay(timezone, now);
  const windowStart = new Date(now.getTime() - 60_000);

  const [recent, day] = await Promise.all([
    db
      .select({ at: aiUsage.createdAt })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), counted, gte(aiUsage.createdAt, windowStart))),
    db
      .select({ n: count() })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), counted, gte(aiUsage.createdAt, start))),
  ]);

  const check = evaluateLimits({
    recentAttempts: recent.map((r) => r.at),
    dayCount: day[0]?.n ?? 0,
    now,
    nextMidnight,
    limits,
  });
  if (check.ok) return;

  await recordUsage({ userId, status: "RATE_LIMITED", ...info });
  throw new AppError("RATE_LIMITED", rateLimitMessage(check), {
    retryAfterSeconds: check.retryAfterSeconds,
  });
}

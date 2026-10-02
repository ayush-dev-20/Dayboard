// Per-minute and per-day limits, as pure functions so the boundaries can be tested exactly. The
// database reads that feed them live in `usage.ts`.

export type Limits = { perMinute: number; perDay: number };

export type LimitCheck =
  { ok: true } | { ok: false; scope: "minute" | "day"; retryAfterSeconds: number };

export type LimitInput = {
  /** When each counted attempt in the last minute happened, any order. */
  recentAttempts: Date[];
  /** Counted attempts since the start of the person's local day. */
  dayCount: number;
  now: Date;
  /** The next local midnight, when the daily count resets. */
  nextMidnight: Date;
  limits: Limits;
};

const MINUTE_MS = 60_000;

/**
 * Over the per-minute limit: wait until the oldest attempt in the window falls out of it.
 * Over the per-day limit: wait until local midnight. The longer wait is reported when both apply.
 */
export function evaluateLimits(input: LimitInput): LimitCheck {
  const { recentAttempts, dayCount, now, nextMidnight, limits } = input;

  const dayRetry =
    dayCount >= limits.perDay
      ? Math.max(1, Math.ceil((nextMidnight.getTime() - now.getTime()) / 1000))
      : null;

  const inWindow = recentAttempts
    .map((d) => d.getTime())
    .filter((t) => t > now.getTime() - MINUTE_MS)
    .sort((a, b) => a - b);
  let minuteRetry: number | null = null;
  if (inWindow.length >= limits.perMinute) {
    // The attempt that must expire for a slot to open is the one `perMinute` places from the end.
    const blocking = inWindow[inWindow.length - limits.perMinute]!;
    minuteRetry = Math.max(1, Math.ceil((blocking + MINUTE_MS - now.getTime()) / 1000));
  }

  if (dayRetry !== null && (minuteRetry === null || dayRetry >= minuteRetry)) {
    return { ok: false, scope: "day", retryAfterSeconds: dayRetry };
  }
  if (minuteRetry !== null) return { ok: false, scope: "minute", retryAfterSeconds: minuteRetry };
  return { ok: true };
}

export function rateLimitMessage(check: Extract<LimitCheck, { ok: false }>): string {
  if (check.scope === "day") {
    return "You've used today's AI actions. They reset at midnight.";
  }
  const s = check.retryAfterSeconds;
  return `That’s a lot of questions at once. Try again in ${s} ${s === 1 ? "second" : "seconds"}.`;
}

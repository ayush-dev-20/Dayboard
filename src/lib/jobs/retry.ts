// Retry timing (V2 feature 08 §3). Pure, so the bounds are unit-tested.

export const BASE_RETRY_MS = 30_000;
export const MAX_RETRY_MS = 60 * 60 * 1000;

/**
 * How long to wait before attempt `attempts + 1`: 30 s, then 60 s, 2 min … capped at one hour, with up to 10%
 * jitter so many failed jobs do not all come back at the same moment.
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(base + base * 0.1 * random());
}

/** Lock time for a claimed job. A handler that runs longer must call `extendLock`. */
export const LOCK_MS = 2 * 60 * 1000;

/** Redacts what a stored error may hold: no email addresses, no links, capped length. */
export function redactError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "The job failed.").slice(0, 500);
}

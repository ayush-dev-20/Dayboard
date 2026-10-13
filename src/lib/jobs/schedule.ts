// The small cadence language for recurring jobs (V2 feature 08 §2): `every 60s`, `every 5m`, `every 2h`,
// `daily 03:00 UTC`. Anything else is refused, so a typo cannot silently stop a schedule.

export type Cadence =
  { kind: "every"; ms: number } | { kind: "daily"; hour: number; minute: number };

const EVERY = /^every (\d+)(s|m|h)$/;
const DAILY = /^daily ([01]\d|2[0-3]):([0-5]\d) UTC$/;

export function parseCadence(text: string): Cadence {
  const every = EVERY.exec(text.trim());
  if (every) {
    const n = Number(every[1]);
    const unit = { s: 1000, m: 60_000, h: 3_600_000 }[every[2] as "s" | "m" | "h"];
    if (n < 1) throw new Error(`Invalid cadence: ${text}`);
    return { kind: "every", ms: n * unit };
  }
  const daily = DAILY.exec(text.trim());
  if (daily) return { kind: "daily", hour: Number(daily[1]), minute: Number(daily[2]) };
  throw new Error(`Invalid cadence: ${text}`);
}

/** The first slot strictly after `after`. */
export function nextSlot(cadence: Cadence, after: Date): Date {
  if (cadence.kind === "every") return new Date(after.getTime() + cadence.ms);
  const next = new Date(
    Date.UTC(
      after.getUTCFullYear(),
      after.getUTCMonth(),
      after.getUTCDate(),
      cadence.hour,
      cadence.minute,
    ),
  );
  return next.getTime() > after.getTime() ? next : new Date(next.getTime() + 24 * 3_600_000);
}

/**
 * Moves a schedule past `now`, skipping slots that were missed while no worker was running. A missed slot
 * is not replayed: the job runs once, now, and the schedule resumes at the next slot.
 */
export function advancePast(cadence: Cadence, slot: Date, now: Date): Date {
  let next = nextSlot(cadence, slot);
  while (next.getTime() <= now.getTime()) next = nextSlot(cadence, next);
  return next;
}

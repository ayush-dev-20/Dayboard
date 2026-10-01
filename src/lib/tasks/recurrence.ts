import {
  addDays,
  daysInMonth,
  formatDateString,
  parseDateString,
  weekdayIndex,
} from "../dates/calendar";

// Repeat rules are a small subset of RFC 5545. Only the presets the app offers are accepted, so
// no general-purpose rule library is needed and anything unexpected is rejected.

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MAX_INTERVAL = 30;

export type Recurrence =
  | { freq: "DAILY"; interval: number }
  | { freq: "WEEKLY"; days: Weekday[]; interval: number }
  | { freq: "MONTHLY"; monthDay: number }
  | { freq: "YEARLY" };

const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

function parseInterval(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_INTERVAL ? n : null;
}

/** Strict parser. Returns null for anything that isn't one of the supported rules. */
export function parseRule(rule: string): Recurrence | null {
  const pairs = rule.split(";");
  const fields = new Map<string, string>();
  for (const pair of pairs) {
    const [key, value, ...rest] = pair.split("=");
    if (!key || value === undefined || rest.length > 0 || fields.has(key)) return null;
    if (!["FREQ", "BYDAY", "INTERVAL", "BYMONTHDAY"].includes(key)) return null;
    fields.set(key, value);
  }

  const freq = fields.get("FREQ");
  const allowed = (...keys: string[]) =>
    [...fields.keys()].every((k) => k === "FREQ" || keys.includes(k));

  if (freq === "DAILY") {
    if (!allowed("INTERVAL")) return null;
    const interval = parseInterval(fields.get("INTERVAL"));
    return interval ? { freq, interval } : null;
  }

  if (freq === "WEEKLY") {
    if (!allowed("BYDAY", "INTERVAL")) return null;
    const byday = fields.get("BYDAY");
    const interval = parseInterval(fields.get("INTERVAL"));
    if (!byday || !interval) return null;
    const days = byday.split(",");
    const valid = days.every((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d));
    if (!valid || new Set(days).size !== days.length) return null;
    return {
      freq,
      days: [...(days as Weekday[])].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)),
      interval,
    };
  }

  if (freq === "MONTHLY") {
    if (!allowed("BYMONTHDAY")) return null;
    const raw = fields.get("BYMONTHDAY");
    if (!raw || !/^\d{1,2}$/.test(raw)) return null;
    const monthDay = Number(raw);
    return monthDay >= 1 && monthDay <= 31 ? { freq, monthDay } : null;
  }

  if (freq === "YEARLY") return allowed() ? { freq } : null;

  return null;
}

export function isValidRule(rule: string): boolean {
  return parseRule(rule) !== null;
}

/** The canonical text form. `parseRule(serializeRule(r))` returns `r`. */
export function serializeRule(recurrence: Recurrence): string {
  switch (recurrence.freq) {
    case "DAILY":
      return recurrence.interval === 1
        ? "FREQ=DAILY"
        : `FREQ=DAILY;INTERVAL=${recurrence.interval}`;
    case "WEEKLY": {
      const base = `FREQ=WEEKLY;BYDAY=${recurrence.days.join(",")}`;
      return recurrence.interval === 1 ? base : `${base};INTERVAL=${recurrence.interval}`;
    }
    case "MONTHLY":
      return `FREQ=MONTHLY;BYMONTHDAY=${recurrence.monthDay}`;
    case "YEARLY":
      return "FREQ=YEARLY";
  }
}

function isWeekdaysRule(r: Recurrence): boolean {
  return (
    r.freq === "WEEKLY" &&
    r.interval === 1 &&
    r.days.length === 5 &&
    r.days.join(",") === "MO,TU,WE,TH,FR"
  );
}

export type RepeatPreset =
  "never" | "daily" | "weekdays" | "weekly" | "every-n-weeks" | "monthly" | "yearly";

/** Which row of the repeat menu a stored rule belongs to. */
export function presetOf(rule: string | null): RepeatPreset {
  if (!rule) return "never";
  const r = parseRule(rule);
  if (!r) return "never";
  if (isWeekdaysRule(r)) return "weekdays";
  if (r.freq === "DAILY") return "daily";
  if (r.freq === "WEEKLY") return r.interval === 1 ? "weekly" : "every-n-weeks";
  if (r.freq === "MONTHLY") return "monthly";
  return "yearly";
}

/** Plain words for a rule, as shown on the Repeat picker. */
export function describeRule(rule: string | null): string {
  if (!rule) return "Never";
  const r = parseRule(rule);
  if (!r) return "Never";
  if (isWeekdaysRule(r)) return "Weekdays";

  switch (r.freq) {
    case "DAILY":
      return r.interval === 1 ? "Daily" : `Every ${r.interval} days`;
    case "WEEKLY": {
      const days = r.days.map((d) => WEEKDAY_NAMES[d]).join(", ");
      return r.interval === 1 ? `Weekly on ${days}` : `Every ${r.interval} weeks on ${days}`;
    }
    case "MONTHLY":
      return `Monthly on day ${r.monthDay}`;
    case "YEARLY":
      return "Yearly";
  }
}

/** Short value for a picker button: "Weekly", "Every 2 weeks", "Never". */
export function describeRuleShort(rule: string | null): string {
  if (!rule) return "Never";
  const r = parseRule(rule);
  if (!r) return "Never";
  if (isWeekdaysRule(r)) return "Weekdays";
  switch (r.freq) {
    case "DAILY":
      return r.interval === 1 ? "Daily" : `Every ${r.interval} days`;
    case "WEEKLY":
      return r.interval === 1 ? "Weekly" : `Every ${r.interval} weeks`;
    case "MONTHLY":
      return "Monthly";
    case "YEARLY":
      return "Yearly";
  }
}

/** Monday-based weekday code for a calendar date. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[weekdayIndex(date)] as Weekday;
}

/**
 * The next due date, always strictly after `previousDue` (the previous *due date*, not today, so a
 * late completion doesn't shift the schedule).
 */
export function nextOccurrence(rule: string, previousDue: string): string {
  const recurrence = parseRule(rule);
  if (!recurrence) throw new RangeError(`Unsupported repeat rule: ${rule}`);
  const prev = parseDateString(previousDue);
  if (!prev) throw new RangeError(`Not a calendar date: ${previousDue}`);

  switch (recurrence.freq) {
    case "DAILY":
      return addDays(previousDue, recurrence.interval);

    case "WEEKLY": {
      const todayIndex = weekdayIndex(previousDue);
      const indexes = recurrence.days.map((d) => WEEKDAYS.indexOf(d));
      const laterThisWeek = indexes.find((i) => i > todayIndex);
      if (laterThisWeek !== undefined) return addDays(previousDue, laterThisWeek - todayIndex);
      // Otherwise: the first chosen day, `interval` weeks after the week we are in.
      const mondayThisWeek = addDays(previousDue, -todayIndex);
      return addDays(mondayThisWeek, recurrence.interval * 7 + (indexes[0] as number));
    }

    case "MONTHLY": {
      // Day 31 means "last day" in shorter months. Compute from the rule, not from the previous
      // clamped date, so Jan 31 -> Feb 28 -> Mar 31 doesn't drift to the 28th.
      const sameMonth = Math.min(recurrence.monthDay, daysInMonth(prev.y, prev.m));
      if (sameMonth > prev.d) return formatDateString(prev.y, prev.m, sameMonth);
      const nextY = prev.m === 12 ? prev.y + 1 : prev.y;
      const nextM = prev.m === 12 ? 1 : prev.m + 1;
      return formatDateString(
        nextY,
        nextM,
        Math.min(recurrence.monthDay, daysInMonth(nextY, nextM)),
      );
    }

    case "YEARLY": {
      const y = prev.y + 1;
      return formatDateString(y, prev.m, Math.min(prev.d, daysInMonth(y, prev.m)));
    }
  }
}

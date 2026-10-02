import { format, formatDistanceStrict, isSameYear } from "date-fns";

/** "active now", "2 hours ago", "Sep 24" (or "Sep 24, 2025" from an earlier year). */
export function describeActivity(at: Date, now: Date = new Date()): string {
  const seconds = (now.getTime() - at.getTime()) / 1000;
  if (seconds < 5 * 60) return "active now";
  if (seconds < 7 * 24 * 60 * 60) return `${formatDistanceStrict(at, now)} ago`;
  return isSameYear(at, now) ? format(at, "MMM d") : format(at, "MMM d, yyyy");
}

export function formatShortDate(at: Date, now: Date = new Date()): string {
  return isSameYear(at, now) ? format(at, "MMM d") : format(at, "MMM d, yyyy");
}

const localDay = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

/**
 * Short times for dense lists: "now", "12m", "2h", "Yesterday", "Mon" (within the last week),
 * then "Sep 24" ("Sep 24, 2025" from an earlier year). Days are the person's own, in `timeZone`.
 */
export function formatCompact(at: Date, now: Date, timeZone: string): string {
  const seconds = (now.getTime() - at.getTime()) / 1000;
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;

  const today = localDay(now, timeZone);
  const thatDay = localDay(at, timeZone);
  if (thatDay === today) return `${Math.floor(seconds / 3600)}h`;

  const dayGap = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${thatDay}T00:00:00Z`)) / 86_400_000,
  );
  if (dayGap === 1) return "Yesterday";
  const options: Intl.DateTimeFormatOptions = { timeZone };
  if (dayGap < 7)
    return new Intl.DateTimeFormat("en-US", { ...options, weekday: "short" }).format(at);
  const sameYear = thatDay.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
}

/** "just now", "12 min ago", "3 hours ago", "Yesterday", "3 days ago", then "Sep 24". */
export function formatAgo(at: Date, now: Date, timeZone: string): string {
  const seconds = (now.getTime() - at.getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  const compact = formatCompact(at, now, timeZone);
  if (/^\d+h$/.test(compact)) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (compact === "Yesterday") return compact;
  const days = Math.floor(seconds / 86_400);
  if (days < 7) return `${days} days ago`;
  return compact;
}

/** "Today", "Yesterday", "Sep 27" (with the year from an earlier year): the person's own days. */
export function formatDayWord(at: Date, now: Date, timeZone: string): string {
  const compact = formatCompact(at, now, timeZone);
  if (compact === "Yesterday") return compact;
  if (/^(now|\d+[mh])$/.test(compact)) return "Today";
  // Within the last week the compact form is a weekday name; a date reads better in a list of deletions.
  if (
    /^[A-Z][a-z]{2}$/.test(compact) &&
    !/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(compact)
  ) {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(
      at,
    );
  }
  return compact;
}

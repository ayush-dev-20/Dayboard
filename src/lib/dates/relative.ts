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

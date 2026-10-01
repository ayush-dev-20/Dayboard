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

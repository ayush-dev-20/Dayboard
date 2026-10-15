import { formatDay } from "@/lib/dates/calendar";
import type { FactKey } from "./types";

// Words for the weekly review (V2 feature 15 §6). Pure and client-safe. Neutral wording: a quiet week is a valid week.

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const utc = (day: string) => new Date(`${day}T12:00:00Z`);

/** "Oct 12 – 18", or "Oct 28 – Nov 3" across a month, or with years across a year. */
export function formatWeekRange(start: string, end: string): string {
  if (start.slice(0, 4) !== end.slice(0, 4)) {
    return `${formatDay(start, "0000-01-01")} – ${formatDay(end, "0000-01-01")}`;
  }
  const sameMonth = start.slice(5, 7) === end.slice(5, 7);
  const first = `${MONTH.format(utc(start))} ${Number(start.slice(8))}`;
  const last = sameMonth
    ? String(Number(end.slice(8)))
    : `${MONTH.format(utc(end))} ${Number(end.slice(8))}`;
  return `${first} – ${last}`;
}

export const weekdayName = (day: string) => WEEKDAY.format(utc(day));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const countOf = plural;

/** "3 hours", "1.5 hours", "1 hour". */
export function formatHours(hours: number): string {
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export const FACT_LABELS: Record<FactKey, string> = {
  completed: "Completed",
  overdue: "Overdue and carry-forward",
  notes: "Notes",
  projects: "Projects",
  calendar: "Calendar load",
  postponements: "Postponements",
  inbox: "Inbox",
};

/** Why a review has no suggestions, in one plain line. */
export function noSuggestionsReason(
  status: "NONE" | "GENERATED" | "UNAVAILABLE" | "OFF",
  error: "AI_OFF" | "RATE_LIMITED" | "AI_PROVIDER_ERROR" | "EMPTY" | null,
): string | null {
  if (status === "GENERATED") return null;
  if (status === "OFF" || error === "AI_OFF") return "AI is off, so this review has facts only.";
  if (error === "RATE_LIMITED")
    return "You've reached today's AI limit, so this review has facts only for now.";
  if (error === "EMPTY") return "There was nothing useful to suggest this time.";
  if (error === "AI_PROVIDER_ERROR")
    return "Suggestions aren't available right now, so this review has facts only.";
  return "This review has facts only.";
}

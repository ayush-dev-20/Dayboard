import type { NormalizedEvent } from "./types";

// Google's event shape into the one the cache stores (V2 feature 12 §5). Pure, and tolerant: an event that
// cannot be read is skipped, never an error that stops the sync.

export type GoogleEventTime = { date?: string; dateTime?: string; timeZone?: string };

export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  iCalUID?: string;
  recurringEventId?: string;
  transparency?: string;
  updated?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  attendees?: { self?: boolean; responseStatus?: string }[];
};

export type Normalized =
  | { kind: "upsert"; event: NormalizedEvent }
  /** Cancelled, or declined by the person: it should not be in the cache. */
  | { kind: "remove"; providerEventId: string }
  | { kind: "skip" };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcMidnight(date: string): Date | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(value.getTime()) ? null : value;
}

export function normalizeGoogleEvent(event: GoogleEvent): Normalized {
  const id = event.id;
  if (!id) return { kind: "skip" };

  const mine = event.attendees?.find((a) => a.self);
  if (event.status === "cancelled" || mine?.responseStatus === "declined") {
    return { kind: "remove", providerEventId: id };
  }

  const allDay = Boolean(event.start?.date && !event.start.dateTime);
  const startAt = allDay
    ? utcMidnight(event.start?.date ?? "")
    : event.start?.dateTime
      ? new Date(event.start.dateTime)
      : null;
  const endAt = allDay
    ? utcMidnight(event.end?.date ?? "")
    : event.end?.dateTime
      ? new Date(event.end.dateTime)
      : null;
  if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { kind: "skip" };
  }
  if (endAt.getTime() < startAt.getTime()) return { kind: "skip" };

  const tentative = event.status === "tentative" || mine?.responseStatus === "tentative";
  const updated = event.updated ? new Date(event.updated) : new Date();

  return {
    kind: "upsert",
    event: {
      providerEventId: id,
      icalUid: event.iCalUID ?? null,
      title: (event.summary ?? "").trim() || "(No title)",
      location: event.location?.trim() || null,
      startAt,
      endAt,
      allDay,
      timeZone: event.start?.timeZone ?? null,
      // "Show as: Free" is `transparent`. Everything else blocks time.
      busy: event.transparency !== "transparent",
      status: tentative ? "tentative" : "confirmed",
      htmlLink: event.htmlLink ?? null,
      recurringEventId: event.recurringEventId ?? null,
      updatedAt: Number.isNaN(updated.getTime()) ? new Date() : updated,
    },
  };
}

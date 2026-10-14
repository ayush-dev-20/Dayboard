// What crosses from the server to the browser for the calendar (V2 feature 12 §8). No tokens, ever.

export type EventDTO = {
  id: string;
  title: string;
  location: string | null;
  /** ISO instants. An all-day event is midnight UTC of its first day to midnight UTC after its last. */
  startAt: string;
  endAt: string;
  allDay: boolean;
  busy: boolean;
  status: "confirmed" | "tentative";
  htmlLink: string | null;
  calendar: { name: string; color: string | null };
};

/** An event as the events route sends it: with the person's days it falls on, worked out on the server. */
export type EventsResponseEvent = EventDTO & {
  /** "YYYY-MM-DD" days in the person's time zone. */
  days: string[];
  /** "HH:MM" in the person's time zone, or null for an all-day event. */
  localStart: string | null;
};

export type CalendarSourceDTO = {
  id: string;
  name: string;
  color: string | null;
  selected: boolean;
};

export type CalendarAccountDTO = {
  id: string;
  email: string;
  status: "ACTIVE" | "NEEDS_RECONNECT" | "REVOKED";
  canCreateEvents: boolean;
  lastSyncedAt: string | null;
  calendars: CalendarSourceDTO[];
};

export type CalendarStatusDTO = { accounts: CalendarAccountDTO[] };

/** Days of an event list that the calendar draws: all-day events by their UTC dates, timed ones by the person's day. */
export const MAX_EVENT_RANGE_DAYS = 62;

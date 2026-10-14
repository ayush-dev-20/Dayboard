// The calendar adapter (V2 feature 12 §4). Domain code depends on these types only; Google's REST code stays
// in providers/. A mock provider implements the same interface for tests.

export type Credentials = { accessToken: string };

export type TokenSet = {
  accessToken: string;
  /** Present on the first exchange (`access_type=offline`); a refresh normally has none. */
  refreshToken?: string;
  /** Scopes Google actually granted. */
  scopes: string[];
  /** From the ID token, on the first exchange. */
  account?: { id: string; email: string };
};

export type ProviderCalendar = {
  id: string;
  name: string;
  color: string | null;
  timeZone: string | null;
  primary: boolean;
};

export type NormalizedEvent = {
  providerEventId: string;
  icalUid: string | null;
  title: string;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timeZone: string | null;
  busy: boolean;
  status: "confirmed" | "tentative";
  htmlLink: string | null;
  recurringEventId: string | null;
  updatedAt: Date;
};

export type DateRange = { from: Date; to: Date };

export type ListEventsResult = {
  events: NormalizedEvent[];
  /** Events that were cancelled or declined: remove them from the cache. */
  removedIds: string[];
  nextSyncToken?: string;
  /** True when the whole window was read (no sync token, or Google asked for a fresh start). */
  fullSync: boolean;
};

export type CreateEventInput = {
  /** A stable id for the event, so a retry cannot make a second one (Google rejects a repeated id). */
  eventId: string;
  title: string;
  description?: string;
  start: Date;
  end: Date;
  timeZone: string;
  reminderMinutes?: number;
};

/** Errors the sync layer reacts to. Anything else is treated as a temporary failure and retried. */
export class CalendarProviderError extends Error {
  constructor(
    readonly code:
      "INVALID_GRANT" | "SYNC_TOKEN_EXPIRED" | "RATE_LIMITED" | "UNAVAILABLE" | "FORBIDDEN",
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CalendarProviderError";
  }
}

export interface CalendarProvider {
  /** Where to send the person to approve access. `verifier` is not needed here, only the PKCE challenge. */
  authorizationUrl(input: {
    state: string;
    challenge: string;
    scopes: string[];
    loginHint?: string;
  }): string;
  exchangeCode(input: { code: string; verifier: string }): Promise<TokenSet>;
  refreshAccessToken(refreshToken: string): Promise<TokenSet>;
  listCalendars(credentials: Credentials): Promise<ProviderCalendar[]>;
  listEvents(
    credentials: Credentials,
    calendarId: string,
    range: DateRange,
    syncToken?: string,
  ): Promise<ListEventsResult>;
  createEvent(
    credentials: Credentials,
    calendarId: string,
    input: CreateEventInput,
  ): Promise<{ providerEventId: string; htmlLink: string | null }>;
  revoke(token: string): Promise<void>;
}

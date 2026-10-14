import { CalendarProviderError } from "../types";
import type { CalendarProvider, NormalizedEvent, ProviderCalendar } from "../types";
import { READ_SCOPES, WRITE_SCOPE } from "../oauth";

// A calendar that needs no Google (V2 feature 12 §4): fixture events around "now" that cover all-day, timed,
// tentative, free, recurring and cross-time-zone cases, plus scripted failures. Used by tests and by E2E runs.
// In a test, `mockCalendar` changes what the next calls do; in an E2E server the fixtures are fixed.

export type MockBehaviour = {
  /** The next token refresh fails as if the connection was revoked. */
  invalidGrant?: boolean;
  /** The next incremental sync is answered with 410 (the sync token expired). */
  expireSyncToken?: boolean;
  /** Every event call fails with this. */
  failWith?: "RATE_LIMITED" | "UNAVAILABLE";
  /** Replaces the fixture events (by calendar id). */
  events?: Record<string, NormalizedEvent[]>;
  /** Ids an incremental sync reports as removed (cancelled or declined). */
  removedIds?: string[];
};

export const mockCalendar = {
  behaviour: {} as MockBehaviour,
  /** Calls made, so a test can check what was (not) asked for. */
  calls: [] as { method: string; calendarId?: string; syncToken?: string }[],
  created: [] as { calendarId: string; title: string }[],
  reset() {
    this.behaviour = {};
    this.calls = [];
    this.created = [];
  },
};

export const MOCK_ACCOUNT = { id: "mock-google-sub-1", email: "mock.person@example.com" };
const CALENDARS: ProviderCalendar[] = [
  { id: "primary", name: "Personal", color: "#3b82f6", timeZone: "Asia/Kolkata", primary: true },
  { id: "work", name: "Work", color: "#16a34a", timeZone: "Europe/London", primary: false },
];

const hour = 3_600_000;
const at = (base: Date, offsetHours: number) => new Date(base.getTime() + offsetHours * hour);
// Events sit at fixed times of day (UTC), so a test on any day, at any hour, sees them on the same days.
function startOfDayUtc(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function event(
  partial: Partial<NormalizedEvent> &
    Pick<NormalizedEvent, "providerEventId" | "title" | "startAt" | "endAt">,
): NormalizedEvent {
  return {
    icalUid: `${partial.providerEventId}@mock`,
    location: null,
    allDay: false,
    timeZone: null,
    busy: true,
    status: "confirmed",
    htmlLink: `https://calendar.example.com/event/${partial.providerEventId}`,
    recurringEventId: null,
    updatedAt: new Date(),
    ...partial,
  };
}

export function fixtureEvents(calendarId: string, now: Date = new Date()): NormalizedEvent[] {
  const today = startOfDayUtc(now);
  if (calendarId === "work") {
    return [
      event({
        providerEventId: "work-1",
        title: "Roadmap sync",
        startAt: at(today, 15),
        endAt: at(today, 16),
        timeZone: "Europe/London",
      }),
    ];
  }
  return [
    event({
      providerEventId: "p-1",
      title: "Design review",
      startAt: at(today, 10),
      endAt: at(today, 11),
      location: "Room 4",
    }),
    event({
      providerEventId: "p-2",
      title: "Maybe: coffee with Sam",
      startAt: at(today, 14),
      endAt: at(today, 15),
      status: "tentative",
    }),
    event({
      providerEventId: "p-3",
      title: "Team offsite",
      startAt: at(today, 24),
      endAt: at(today, 48),
      allDay: true,
      busy: false,
    }),
    event({
      providerEventId: "p-4",
      title: "Standup",
      startAt: at(today, 33),
      endAt: at(today, 33.5),
      recurringEventId: "p-4-series",
    }),
    event({
      providerEventId: "p-5",
      title: "Standup",
      startAt: at(today, 57),
      endAt: at(today, 57.5),
      recurringEventId: "p-4-series",
    }),
  ];
}

export function createMockProvider(options: { callbackUrl: string }): CalendarProvider {
  const sessions = new Map<string, true>();

  return {
    authorizationUrl({ state, scopes }) {
      // No Google: the "consent screen" is our own callback, with a code that the mock accepts.
      const wantsWrite = scopes.includes(WRITE_SCOPE);
      const url = new URL(options.callbackUrl);
      url.searchParams.set("code", wantsWrite ? "mock-code-write" : "mock-code");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode({ code, verifier }) {
      if (!code.startsWith("mock-code") || !verifier) {
        throw new CalendarProviderError("INVALID_GRANT", "That code is not valid.");
      }
      // A code works once, like Google's.
      if (sessions.has(code + verifier))
        throw new CalendarProviderError("INVALID_GRANT", "That code was already used.");
      sessions.set(code + verifier, true);
      const write = code === "mock-code-write";
      return {
        accessToken: "mock-access",
        refreshToken: `mock-refresh${mockCalendar.behaviour.invalidGrant ? "-revoked" : ""}`,
        scopes: write ? [READ_SCOPES[0], WRITE_SCOPE] : [...READ_SCOPES],
        account: MOCK_ACCOUNT,
      };
    },

    async refreshAccessToken(refreshToken) {
      mockCalendar.calls.push({ method: "refresh" });
      if (mockCalendar.behaviour.invalidGrant || refreshToken.includes("revoked")) {
        throw new CalendarProviderError(
          "INVALID_GRANT",
          "Google no longer accepts this connection.",
        );
      }
      return { accessToken: "mock-access", scopes: [...READ_SCOPES] };
    },

    async listCalendars() {
      mockCalendar.calls.push({ method: "listCalendars" });
      return CALENDARS;
    },

    async listEvents(_credentials, calendarId, range, syncToken) {
      mockCalendar.calls.push({ method: "listEvents", calendarId, syncToken });
      const b = mockCalendar.behaviour;
      if (b.failWith === "RATE_LIMITED")
        throw new CalendarProviderError("RATE_LIMITED", "Slow down.", 1000);
      if (b.failWith === "UNAVAILABLE") throw new CalendarProviderError("UNAVAILABLE", "Down.");
      if (syncToken && b.expireSyncToken) {
        b.expireSyncToken = false;
        throw new CalendarProviderError("SYNC_TOKEN_EXPIRED", "Start over.");
      }
      const all = b.events?.[calendarId] ?? fixtureEvents(calendarId);
      const inWindow = all.filter((e) => e.endAt >= range.from && e.startAt <= range.to);
      // An incremental sync answers with what changed; the mock has no change history, so it answers the window.
      return {
        events: inWindow,
        removedIds: syncToken ? (b.removedIds ?? []) : [],
        nextSyncToken: `mock-sync-${Date.now()}`,
        fullSync: !syncToken,
      };
    },

    async createEvent(_credentials, calendarId, input) {
      mockCalendar.calls.push({ method: "createEvent", calendarId });
      mockCalendar.created.push({ calendarId, title: input.title });
      return {
        providerEventId: input.eventId,
        htmlLink: "https://calendar.example.com/event/created",
      };
    },

    async revoke() {
      mockCalendar.calls.push({ method: "revoke" });
    },
  };
}

import { CalendarProviderError } from "../types";
import type {
  CalendarProvider,
  Credentials,
  CreateEventInput,
  DateRange,
  ListEventsResult,
  ProviderCalendar,
  TokenSet,
} from "../types";
import { normalizeGoogleEvent, type GoogleEvent } from "../normalize";

// Google Calendar over its REST API with `fetch` (V2 feature 12 §4). No Google SDK. This is the only file that
// knows Google's URLs and response shapes. NOT yet exercised against the real service: tests use the mock.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
const MAX_PAGES = 20;

type Config = { clientId: string; clientSecret: string; redirectUri: string; fetch?: typeof fetch };

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
};

/** The claims in an ID token that came straight from Google's token endpoint over TLS. */
function idTokenClaims(idToken: string | undefined): {
  sub?: string;
  email?: string;
  aud?: string;
} {
  if (!idToken) return {};
  try {
    const body = idToken.split(".")[1] ?? "";
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export function createGoogleProvider(config: Config): CalendarProvider {
  const http = config.fetch ?? fetch;

  async function token(params: Record<string, string>): Promise<TokenSet> {
    const response = await http(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...params,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !body.access_token) {
      if (body.error === "invalid_grant") {
        throw new CalendarProviderError(
          "INVALID_GRANT",
          "Google no longer accepts this connection.",
        );
      }
      throw new CalendarProviderError(
        "UNAVAILABLE",
        `Google's token endpoint answered ${response.status}.`,
      );
    }
    const claims = idTokenClaims(body.id_token);
    if (claims.aud && claims.aud !== config.clientId) {
      throw new CalendarProviderError("FORBIDDEN", "That sign-in was not made for this app.");
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      scopes: (body.scope ?? "").split(" ").filter(Boolean),
      account: claims.sub && claims.email ? { id: claims.sub, email: claims.email } : undefined,
    };
  }

  async function api<T>(
    path: string,
    credentials: Credentials,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await http(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    if (response.ok) return (await response.json()) as T;

    if (response.status === 410) {
      throw new CalendarProviderError("SYNC_TOKEN_EXPIRED", "Google asked for a fresh start.");
    }
    if (response.status === 401) {
      throw new CalendarProviderError("INVALID_GRANT", "Google no longer accepts this connection.");
    }
    if (response.status === 429 || response.status === 403) {
      const retry = Number(response.headers.get("retry-after"));
      const body = (await response.json().catch(() => ({}))) as {
        error?: { errors?: { reason?: string }[] };
      };
      const reason = body.error?.errors?.[0]?.reason ?? "";
      if (response.status === 429 || /rateLimit|quota/i.test(reason)) {
        throw new CalendarProviderError(
          "RATE_LIMITED",
          "Google is limiting requests.",
          Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined,
        );
      }
      throw new CalendarProviderError("FORBIDDEN", "Google refused that request.");
    }
    throw new CalendarProviderError("UNAVAILABLE", `Google answered ${response.status}.`);
  }

  return {
    authorizationUrl({ state, challenge, scopes, loginHint }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: ["openid", "email", ...scopes].join(" "),
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        // The refresh token is only sent on a consent screen, and a reconnect needs a new one.
        prompt: "consent",
        include_granted_scopes: "true",
      });
      if (loginHint) params.set("login_hint", loginHint);
      return `${AUTH_URL}?${params.toString()}`;
    },

    exchangeCode: ({ code, verifier }) =>
      token({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: config.redirectUri,
      }),

    refreshAccessToken: (refreshToken) =>
      token({ grant_type: "refresh_token", refresh_token: refreshToken }),

    async listCalendars(credentials) {
      const out: ProviderCalendar[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ maxResults: "250" });
        if (pageToken) query.set("pageToken", pageToken);
        const result = await api<{
          items?: {
            id: string;
            summary?: string;
            summaryOverride?: string;
            backgroundColor?: string;
            timeZone?: string;
            primary?: boolean;
            hidden?: boolean;
          }[];
          nextPageToken?: string;
        }>(`/users/me/calendarList?${query.toString()}`, credentials);
        for (const item of result.items ?? []) {
          if (item.hidden) continue;
          out.push({
            id: item.id,
            name: item.summaryOverride ?? item.summary ?? item.id,
            color: item.backgroundColor ?? null,
            timeZone: item.timeZone ?? null,
            primary: Boolean(item.primary),
          });
        }
        pageToken = result.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },

    async listEvents(
      credentials,
      calendarId,
      range: DateRange,
      syncToken,
    ): Promise<ListEventsResult> {
      const events: ListEventsResult["events"] = [];
      const removedIds: string[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        // Google does not allow a time window together with a sync token: the token already carries it.
        const query = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
        if (syncToken) {
          query.set("syncToken", syncToken);
          query.set("showDeleted", "true");
        } else {
          query.set("timeMin", range.from.toISOString());
          query.set("timeMax", range.to.toISOString());
        }
        if (pageToken) query.set("pageToken", pageToken);

        const result = await api<{
          items?: GoogleEvent[];
          nextPageToken?: string;
          nextSyncToken?: string;
        }>(`/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`, credentials);
        for (const item of result.items ?? []) {
          const normalized = normalizeGoogleEvent(item);
          if (normalized.kind === "upsert") events.push(normalized.event);
          if (normalized.kind === "remove") removedIds.push(normalized.providerEventId);
        }
        pageToken = result.nextPageToken;
        nextSyncToken = result.nextSyncToken ?? nextSyncToken;
        if (!pageToken) break;
      }
      return { events, removedIds, nextSyncToken, fullSync: !syncToken };
    },

    async createEvent(credentials, calendarId, input: CreateEventInput) {
      let created: { id: string; htmlLink?: string };
      try {
        created = await api<{ id: string; htmlLink?: string }>(
          `/calendars/${encodeURIComponent(calendarId)}/events`,
          credentials,
          {
            method: "POST",
            body: JSON.stringify({
              id: input.eventId,
              summary: input.title,
              description: input.description,
              start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
              end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
              reminders:
                input.reminderMinutes === undefined
                  ? { useDefault: true }
                  : {
                      useDefault: false,
                      overrides: [{ method: "popup", minutes: input.reminderMinutes }],
                    },
            }),
          },
        );
      } catch (error) {
        // 409: this id was already used, so an earlier try went through. The event exists.
        if (
          error instanceof CalendarProviderError &&
          error.code === "UNAVAILABLE" &&
          /409/.test(error.message)
        ) {
          return { providerEventId: input.eventId, htmlLink: null };
        }
        throw error;
      }
      return { providerEventId: created.id, htmlLink: created.htmlLink ?? null };
    },

    async revoke(tokenToRevoke) {
      // Best effort: a failure here must not stop a disconnect.
      await http(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokenToRevoke }),
      }).catch(() => undefined);
    },
  };
}

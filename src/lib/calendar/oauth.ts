import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The pieces of the Google connection flow (V2 feature 12 §3) that can be tested without Google: PKCE, the
// signed state cookie, and the scopes. Nothing here talks to the network.

/** Read access to the calendar list and to events. Requested first. */
export const READ_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;
/** Needed only to create events, and requested later, on its own (incremental consent). */
export const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** The httpOnly cookie that carries the flow's secrets from the connect step to the callback. */
export const OAUTH_COOKIE = "dayboard_calendar_oauth";

export const STATE_TTL_MS = 10 * 60 * 1000;

export function scopesFor(wantsWrite: boolean): string[] {
  // `calendar.events` already includes read access to events, but the list scope is still needed.
  return wantsWrite
    ? ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", WRITE_SCOPE]
    : [...READ_SCOPES];
}

export const hasWriteScope = (granted: readonly string[]) => granted.includes(WRITE_SCOPE);

export const hasReadScopes = (granted: readonly string[]) =>
  granted.includes(READ_SCOPES[0]) && (granted.includes(READ_SCOPES[1]) || hasWriteScope(granted));

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");

export type OauthPayload = {
  userId: string;
  state: string;
  verifier: string;
  wantsWrite: boolean;
  exp: number;
};

/**
 * The httpOnly cookie that carries the flow's secrets from the connect step to the callback. It is signed, so
 * the browser cannot change it, and it names the user and an expiry. The `state` also goes to Google and must
 * come back unchanged.
 */
export function createOauthCookie(
  input: { userId: string; wantsWrite: boolean },
  secret: string,
  now: number = Date.now(),
): { cookie: string; state: string; challenge: string } {
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(24).toString("base64url");
  const payload: OauthPayload = { ...input, state, verifier, exp: now + STATE_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { cookie: `${body}.${sign(body, secret)}`, state, challenge };
}

export class OauthStateError extends Error {
  constructor(message = "That sign-in didn't match. Start again.") {
    super(message);
    this.name = "OauthStateError";
  }
}

/** Opens the cookie and checks it against the state Google sent back and the signed-in person. */
export function readOauthCookie(
  cookie: string | undefined,
  expected: { state: string | null; userId: string },
  secret: string,
  now: number = Date.now(),
): OauthPayload {
  if (!cookie || !expected.state) throw new OauthStateError();
  const [body, signature] = cookie.split(".");
  if (!body || !signature) throw new OauthStateError();

  const wanted = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (wanted.length !== given.length || !timingSafeEqual(wanted, given))
    throw new OauthStateError();

  let payload: OauthPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OauthPayload;
  } catch {
    throw new OauthStateError();
  }
  const sameState = Buffer.from(payload.state ?? "");
  const returned = Buffer.from(expected.state);
  if (sameState.length !== returned.length || !timingSafeEqual(sameState, returned)) {
    throw new OauthStateError();
  }
  // The callback uses the session's person. A cookie made for someone else is refused.
  if (payload.userId !== expected.userId) throw new OauthStateError();
  if (typeof payload.exp !== "number" || payload.exp < now)
    throw new OauthStateError("That sign-in took too long. Start again.");
  return payload;
}

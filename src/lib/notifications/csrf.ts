import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Protection for the subscribe route (V2 feature 14 §6): a request must come from our own origin and carry a
// double-submit token, a cookie and a header that match. A page on another site cannot read our cookie, so it cannot
// make the header. The cookie is signed so a value the server did not issue is refused.

export const CSRF_COOKIE = "dayboard_push_csrf";
export const CSRF_HEADER = "x-csrf-token";

function mac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(`dayboard.push.csrf.v1:${value}`).digest("base64url");
}

/** A new token: random bytes and their signature. */
export function issueCsrfToken(secret: string): string {
  const value = randomBytes(18).toString("base64url");
  return `${value}.${mac(value, secret)}`;
}

function validToken(token: string | null | undefined, secret: string): boolean {
  if (!token) return false;
  const [value, signature, ...rest] = token.split(".");
  if (!value || !signature || rest.length > 0) return false;
  const expected = Buffer.from(mac(value, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The cookie and the header carry the same token, and it is one we issued. */
export function csrfTokenMatches(
  cookie: string | null | undefined,
  header: string | null | undefined,
  secret: string,
): boolean {
  if (!cookie || !header || cookie.length !== header.length) return false;
  if (!timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) return false;
  return validToken(cookie, secret);
}

/** The request came from this site: the Origin header (or Referer) names our own origin. */
export function isSameOrigin(
  origin: string | null,
  referer: string | null,
  appOrigin: string,
): boolean {
  const claimed = origin ?? (referer ? safeOrigin(referer) : null);
  return claimed !== null && claimed === appOrigin;
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

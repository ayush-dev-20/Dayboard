import { createHmac, timingSafeEqual } from "node:crypto";

// The short-lived token that opens one collaboration socket (V3 feature 05 §3). Signed with COLLAB_TOKEN_SECRET by the app,
// verified by the service. It says who, which note and what role; it lives 60 seconds and is used once to connect.

export const TOKEN_TTL_MS = 60_000;

export type CollabRole = "edit" | "read";
export type CollabClaims = { userId: string; noteId: string; role: CollabRole; exp: number };

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64url");

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signCollabToken(
  claims: Omit<CollabClaims, "exp">,
  secret: string,
  now = Date.now(),
): string {
  const payload = b64(JSON.stringify({ ...claims, exp: now + TOKEN_TTL_MS }));
  return `${payload}.${sign(payload, secret)}`;
}

/** The claims, or null for anything wrong: a bad shape, signature, expiry, or a token for another note. */
export function verifyCollabToken(
  token: string,
  secret: string,
  options: { noteId?: string; now?: number } = {},
): CollabClaims | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: CollabClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CollabClaims;
  } catch {
    return null;
  }
  if (
    typeof claims.userId !== "string" ||
    typeof claims.noteId !== "string" ||
    (claims.role !== "edit" && claims.role !== "read") ||
    typeof claims.exp !== "number"
  )
    return null;
  if (claims.exp <= (options.now ?? Date.now())) return null;
  if (options.noteId !== undefined && claims.noteId !== options.noteId) return null;
  return claims;
}

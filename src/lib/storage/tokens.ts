import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, expiring tokens for the `memory` and `disk` drivers (V2 feature 09 §3): they play the part
// of a presigned URL, so tests and local development run the same intent, upload, finalize and
// download flow with no bucket. The token says what may be done to which key until when, and the
// upload token also signs the `Content-Type` (as S3 does), so a different type is refused.

export type TokenClaims = {
  op: "put" | "get";
  key: string;
  mime: string;
  /** Seconds since the epoch. */
  exp: number;
  /** For a download: the file name and whether it opens inline. */
  filename?: string;
  disposition?: "inline" | "attachment";
};

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

const mac = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export function signToken(claims: TokenClaims, secret: string): string {
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${mac(payload, secret)}`;
}

/** The claims, or null when the token is malformed, forged or expired. */
export function verifyToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): TokenClaims | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
    if (typeof claims.exp !== "number" || claims.exp < nowSeconds) return null;
    if (claims.op !== "put" && claims.op !== "get") return null;
    if (typeof claims.key !== "string" || typeof claims.mime !== "string") return null;
    return claims;
  } catch {
    return null;
  }
}

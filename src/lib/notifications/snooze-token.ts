import { createHmac, timingSafeEqual } from "node:crypto";

// The token in a notification that lets "Snooze" work without opening the app (V2 feature 14 §4, §7). It names the
// reminder, the person and the moment that notification was sent (`stamp`), and is signed and valid for an hour.
// A snooze changes the reminder's state and the next notification has a new stamp, so a token works once.

export const SNOOZE_TOKEN_MINUTES = 60;

export type SnoozeClaim = { reminderId: string; userId: string; stamp: number };

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function sign(body: string, secret: string): string {
  // A key of its own, derived from the app secret, so the token cannot be used where the secret itself is.
  const key = createHmac("sha256", secret).update("dayboard.snooze.v1").digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function signSnoozeToken(
  claim: SnoozeClaim,
  secret: string,
  now: Date = new Date(),
): string {
  const body = b64(
    JSON.stringify({
      r: claim.reminderId,
      u: claim.userId,
      t: claim.stamp,
      e: now.getTime() + SNOOZE_TOKEN_MINUTES * 60_000,
    }),
  );
  return `v1.${body}.${sign(body, secret)}`;
}

/** The claim, or null for anything wrong with the token: shape, signature or age. */
export function verifySnoozeToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): SnoozeClaim | null {
  const [version, body, signature, ...rest] = token.split(".");
  if (version !== "v1" || !body || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      r?: unknown;
      u?: unknown;
      t?: unknown;
      e?: unknown;
    };
    if (
      typeof data.r !== "string" ||
      typeof data.u !== "string" ||
      typeof data.t !== "number" ||
      typeof data.e !== "number"
    ) {
      return null;
    }
    if (data.e <= now.getTime()) return null;
    return { reminderId: data.r, userId: data.u, stamp: data.t };
  } catch {
    return null;
  }
}

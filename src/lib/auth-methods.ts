export type SignInProvider = "credential" | "google" | "github";

export const LAST_METHOD_MESSAGE =
  "You can't remove your last sign-in method. Add another one first.";

/**
 * A user must always keep at least one linked sign-in method. `linked` lists the provider ids on
 * their account (`credential` is the password). Magic link isn't a row: it works for any verified
 * email, so it doesn't count toward this rule.
 */
export function canUnlink(linked: readonly string[], target: string): boolean {
  if (!linked.includes(target)) return false;
  return linked.some((provider) => provider !== target);
}

/** A session counts as fresh when the person signed in within the last `maxAgeSeconds`. */
export function isSessionFresh(
  sessionCreatedAt: Date,
  maxAgeSeconds: number,
  now: Date = new Date(),
): boolean {
  return now.getTime() - sessionCreatedAt.getTime() <= maxAgeSeconds * 1000;
}

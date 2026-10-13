// Who was signed in, and until when, kept where the offline app can read it (V2 feature 04 §0).
// The session cookie is httpOnly, so the page cannot read it. The server page writes this hint on every
// online load. Nothing secret is in it: a user id and an expiry time.

export const SESSION_HINT_KEY = "dayboard:session-hint";

export type SessionHint = { userId: string; expiresAt: string };

export function writeSessionHint(hint: SessionHint): void {
  try {
    window.localStorage.setItem(SESSION_HINT_KEY, JSON.stringify(hint));
  } catch {
    // Storage is blocked. Offline data stays locked until the next online visit.
  }
}

export function readSessionHint(): SessionHint | null {
  try {
    const raw = window.localStorage.getItem(SESSION_HINT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SessionHint>;
    if (typeof value.userId !== "string" || typeof value.expiresAt !== "string") return null;
    return { userId: value.userId, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

export function clearSessionHint(): void {
  try {
    window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Local data opens only while the session it was started with has not expired. Once it has, the
 * offline app asks for a sign-in instead (feature 04 §0: lock on expiry).
 */
export function sessionState(
  hint: SessionHint | null,
  now: number = Date.now(),
): "none" | "expired" | "active" {
  if (!hint) return "none";
  const expires = Date.parse(hint.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) return "expired";
  return "active";
}

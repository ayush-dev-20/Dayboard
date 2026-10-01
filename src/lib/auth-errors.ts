export type AuthErrorLike =
  | {
      status?: number;
      code?: string;
      message?: string;
    }
  | null
  | undefined;

export type AuthFailure =
  | { kind: "invalid-credentials"; message: string }
  | { kind: "email-not-verified"; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "cannot-create"; message: string }
  | { kind: "invalid-token"; message: string }
  | { kind: "network"; message: string }
  | { kind: "unknown"; message: string };

const GENERIC = "Something went wrong. Try again.";

/**
 * Turns a Better Auth client error into plain-language copy. Wording never reveals whether an
 * email address has an account (DESIGN.md: authentication), and no technical term reaches the user.
 */
export function describeAuthError(error: AuthErrorLike): AuthFailure {
  if (!error) return { kind: "unknown", message: GENERIC };

  const code = (error.code ?? "").toUpperCase();
  const message = (error.message ?? "").toLowerCase();

  if (error.status === 429 || code.includes("RATE_LIMIT")) {
    return { kind: "rate-limited", message: "Too many attempts. Try again in a minute." };
  }
  if (code === "EMAIL_NOT_VERIFIED" || message.includes("not verified")) {
    return { kind: "email-not-verified", message: "Confirm your email first. We sent you a link." };
  }
  if (
    code.includes("INVALID_EMAIL_OR_PASSWORD") ||
    code.includes("INVALID_PASSWORD") ||
    error.status === 401
  ) {
    return { kind: "invalid-credentials", message: "Email or password is incorrect." };
  }
  if (code.includes("USER_ALREADY_EXISTS") || code.includes("EXISTS") || error.status === 422) {
    return {
      kind: "cannot-create",
      message:
        "We couldn't create an account with those details. If you already have one, sign in instead.",
    };
  }
  if (
    code.includes("INVALID_TOKEN") ||
    code.includes("TOKEN_EXPIRED") ||
    message.includes("invalid token")
  ) {
    return { kind: "invalid-token", message: "That link has expired or was already used." };
  }
  if (error.status === undefined || error.status === 0) {
    return {
      kind: "network",
      message: "We couldn't reach Dayboard. Check your connection and try again.",
    };
  }
  return { kind: "unknown", message: GENERIC };
}

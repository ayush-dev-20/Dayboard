import "server-only";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { CSRF_COOKIE, CSRF_HEADER, csrfTokenMatches, isSameOrigin } from "./csrf";

// What the subscribe route checks before it touches anything (V2 feature 14 §6): the request is from our own site,
// and it carries the double-submit token that `GET /api/notifications/vapid-key` handed out.

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function requireSameSiteWithToken(request: Request): void {
  const appOrigin = new URL(env.BETTER_AUTH_URL).origin;
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("referer"), appOrigin)) {
    throw new AppError("UNAUTHORIZED", "That request didn't come from Dayboard.");
  }
  if (
    !csrfTokenMatches(
      cookieValue(request, CSRF_COOKIE),
      request.headers.get(CSRF_HEADER),
      env.BETTER_AUTH_SECRET,
    )
  ) {
    throw new AppError("UNAUTHORIZED", "That request couldn't be checked. Reload and try again.");
  }
}

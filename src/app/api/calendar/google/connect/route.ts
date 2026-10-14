import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { OAUTH_COOKIE, createOauthCookie, scopesFor } from "@/lib/calendar/oauth";
import { getCalendarProvider } from "@/lib/calendar/providers";
import { requireUser } from "@/lib/session";
import { handle } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// Starts the Google connection (V2 feature 12 §3). Separate from sign-in. The state and the PKCE secret travel in a
// signed httpOnly cookie, and `?write=1` asks for the write scope on its own (incremental consent).
export async function GET(request: Request) {
  return handle("calendar.connect", async () => {
    if (!env.calendarAvailable) throw new AppError("NOT_FOUND");
    let user;
    try {
      user = await requireUser();
    } catch {
      return NextResponse.redirect(
        new URL("/sign-in?next=/settings/calendar", env.NEXT_PUBLIC_APP_URL),
      );
    }

    const wantsWrite = new URL(request.url).searchParams.get("write") === "1";
    const { cookie, state, challenge } = createOauthCookie(
      { userId: user.id, wantsWrite },
      env.BETTER_AUTH_SECRET,
    );
    const target = getCalendarProvider().authorizationUrl({
      state,
      challenge,
      scopes: scopesFor(wantsWrite),
      loginHint: user.email,
    });

    const response = NextResponse.redirect(target);
    response.cookies.set(OAUTH_COOKIE, cookie, {
      httpOnly: true,
      secure: env.isProduction,
      // The way back from Google is a top-level navigation, which Lax allows.
      sameSite: "lax",
      path: "/api/calendar/google",
      maxAge: 10 * 60,
    });
    return response;
  });
}

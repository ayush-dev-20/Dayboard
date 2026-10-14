import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { OAUTH_COOKIE, hasReadScopes, readOauthCookie } from "@/lib/calendar/oauth";
import { getCalendarProvider } from "@/lib/calendar/providers";
import { connectAccount } from "@/lib/calendar/store";
import { requireUser } from "@/lib/session";
import { handle } from "@/lib/api-route";

export const dynamic = "force-dynamic";

function back(result: string) {
  const url = new URL("/settings/calendar", env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set("calendar", result);
  const response = NextResponse.redirect(url);
  // The cookie has done its job whatever happened.
  response.cookies.set(OAUTH_COOKIE, "", { path: "/api/calendar/google", maxAge: 0 });
  return response;
}

// Finishes the connection (V2 feature 12 §3). The person is the signed-in one, never anything the browser sends.
export async function GET(request: Request) {
  return handle("calendar.callback", async () => {
    if (!env.calendarAvailable) throw new AppError("NOT_FOUND");
    let user;
    try {
      user = await requireUser();
    } catch {
      return NextResponse.redirect(
        new URL("/sign-in?next=/settings/calendar", env.NEXT_PUBLIC_APP_URL),
      );
    }

    const url = new URL(request.url);
    if (url.searchParams.get("error")) return back("denied");
    const code = url.searchParams.get("code");
    const cookie = request.headers
      .get("cookie")
      ?.split(/;\s*/)
      .find((part) => part.startsWith(`${OAUTH_COOKIE}=`))
      ?.slice(OAUTH_COOKIE.length + 1);

    try {
      const flow = readOauthCookie(
        cookie,
        { state: url.searchParams.get("state"), userId: user.id },
        env.BETTER_AUTH_SECRET,
      );
      if (!code) return back("failed");
      const tokens = await getCalendarProvider().exchangeCode({ code, verifier: flow.verifier });
      if (!hasReadScopes(tokens.scopes)) return back("scopes");
      await connectAccount(user.id, tokens);
      return back("connected");
    } catch (error) {
      // A bad state, a reused or expired code and a Google error all end the same way: start again.
      logger.warn("calendar connect failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return back("failed");
    }
  });
}

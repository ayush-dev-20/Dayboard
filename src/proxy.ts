import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PROTECTED_PREFIXES = [
  "/today",
  "/inbox",
  "/tasks",
  "/notes",
  "/projects",
  "/search",
  "/trash",
  "/settings",
  "/more",
  "/onboarding",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Optimistic check only: no session cookie on a private page means "go sign in". It never decides
 * access. Real authorization is `requireUser()` in every page, action and route handler, because
 * a cookie can be present but expired or revoked.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;

  // The landing page is for visitors. Someone who (probably) has a session goes straight to Today;
  // a stale cookie just means Today sends them on to sign in, as for any private page.
  if (pathname === "/" && getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/today", request.url));
  }

  if (isProtected(pathname) && !getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-next-path", path);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};

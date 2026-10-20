import { handle } from "@/lib/api-route";
import { env } from "@/lib/env";
import { CSRF_COOKIE, issueCsrfToken } from "@/lib/notifications/csrf";
import { vapidPublicKey } from "@/lib/notifications";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * What a browser needs before it subscribes: the public VAPID key (public by design) and a fresh token for the
 * subscribe request. The token comes back in the body and in an httpOnly cookie; the request must carry both.
 */
export async function GET() {
  return handle("notifications.vapidKey", async () => {
    await requireUser();
    const publicKey = vapidPublicKey();
    const token = issueCsrfToken(env.BETTER_AUTH_SECRET);
    const secure = env.isProduction ? "; Secure" : "";
    return Response.json(
      { available: publicKey !== null, publicKey, csrf: token },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/api/notifications; HttpOnly; SameSite=Strict; Max-Age=3600${secure}`,
        },
      },
    );
  });
}

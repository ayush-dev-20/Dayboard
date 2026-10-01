import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { safeNextPath } from "@/lib/redirects";

/** Resolved once per request, however many components ask for it. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  sessionId: string;
  sessionCreatedAt: Date;
};

/**
 * The only way to learn who is signed in. Every page, layout, Server Action and Route Handler
 * that touches user data starts here, and every query takes `user.id` from the result, never from
 * the client.
 *
 * - Actions and Route Handlers: `await requireUser()` throws `UNAUTHENTICATED`.
 * - Pages and layouts: `await requireUser({ redirect: true })` sends the visitor to sign in and
 *   brings them back afterwards.
 */
export async function requireUser(options: { redirect?: boolean } = {}): Promise<CurrentUser> {
  const session = await getSession();

  if (!session) {
    if (options.redirect) {
      const next = safeNextPath((await headers()).get("x-next-path"), "");
      redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
    }
    throw new AppError("UNAUTHENTICATED");
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    emailVerified: session.user.emailVerified,
    sessionId: session.session.id,
    sessionCreatedAt: new Date(session.session.createdAt),
  };
}

import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { session } from "@/db/schema";

// Better Auth's own `listSessions` demands a session under ten minutes old, which would break
// the Settings page for anyone who has been signed in a while. These read the same table directly,
// always scoped to the signed-in user, and never select the token.

export async function listUserSessions(userId: string) {
  return db
    .select({ id: session.id, userAgent: session.userAgent, updatedAt: session.updatedAt })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .orderBy(desc(session.updatedAt));
}

/** The token is needed once, server-side, to revoke. It is looked up by id AND owner. */
export async function findUserSessionToken(
  userId: string,
  sessionId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ token: session.token })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .limit(1);
  return row?.token ?? null;
}

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { userPreferences, type UserPreferences } from "@/db/schema";

/** Creates the row every user has. Idempotent, so it is safe to call from a hook and from reads. */
export async function createDefaultPreferences(userId: string): Promise<void> {
  await db.insert(userPreferences).values({ userId }).onConflictDoNothing();
}

/** Always scoped by the caller's own user id, never a client-supplied one. */
export async function getPreferences(userId: string): Promise<UserPreferences> {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  if (row) return row;

  await createDefaultPreferences(userId);
  const [created] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  if (!created) throw new Error("Could not create default preferences");
  return created;
}

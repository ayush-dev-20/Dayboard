import { eq, inArray } from "drizzle-orm";
import { afterAll } from "vitest";
import { db, sql } from "@/db/client";
import { user, userPreferences } from "@/db/schema";
import { uuidv7 } from "@/lib/ids";

export type TestUser = {
  id: string;
  email: string;
  name: string;
  image: null;
  emailVerified: true;
  sessionId: string;
  sessionCreatedAt: Date;
};

const created: string[] = [];

/** A real user row (with preferences), removed again when the file finishes. */
export async function createTestUser(label = "user"): Promise<TestUser> {
  const id = uuidv7();
  const email = `${label}-${id.slice(-12)}@integration.test`;
  await db.insert(user).values({ id, name: label, email, emailVerified: true });
  await db.insert(userPreferences).values({ userId: id, onboardedAt: new Date() });
  created.push(id);
  return {
    id,
    email,
    name: label,
    image: null,
    emailVerified: true,
    sessionId: uuidv7(),
    sessionCreatedAt: new Date(),
  };
}

/** Makes the next action calls act as this person (or as nobody). */
export function actAs(person: TestUser | null) {
  (globalThis as { __testUser?: TestUser | null }).__testUser = person;
}

export async function setPreferences(
  userId: string,
  values: Partial<typeof userPreferences.$inferInsert>,
) {
  await db.update(userPreferences).set(values).where(eq(userPreferences.userId, userId));
}

afterAll(async () => {
  actAs(null);
  if (created.length > 0) await db.delete(user).where(inArray(user.id, created)); // cascades
  await sql.end();
});

/** Unwraps an ActionResult, failing the test with the error if it wasn't ok. */
export function ok<T>(
  result: { ok: true; data: T } | { ok: false; error: { code: string; message: string } },
): T {
  if (!result.ok)
    throw new Error(`Expected success, got ${result.error.code}: ${result.error.message}`);
  return result.data;
}

export function errorOf(result: {
  ok: boolean;
  error?: { code: string; message: string; fieldErrors?: Record<string, string> };
}) {
  if (result.ok || !result.error) throw new Error("Expected an error result");
  return result.error;
}

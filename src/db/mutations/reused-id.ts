import "server-only";
import { AppError } from "@/lib/errors";

/**
 * Runs an insert that uses a device-made id. If the id is already taken (by anyone), the answer is
 * CONFLICT, not a database error (V2 feature 04 §2). Inside a transaction, the throw rolls it back.
 */
export async function rejectReusedId<T>(insert: () => Promise<T>): Promise<T> {
  try {
    return await insert();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT");
    throw error;
  }
}

// The driver may wrap the database error, so look a few levels down for Postgres' code 23505.
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

import { db } from "@/db/client";

/** Either the database or a transaction: lets a helper run inside or outside one. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = Tx | typeof db;

/**
 * Runs `fn` inside the caller's transaction when there is one, otherwise in a new one. Lets a
 * create function be used on its own and as one step of a bigger all-or-nothing change.
 */
export async function inTransaction<T>(
  outer: Tx | undefined,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return outer ? fn(outer) : db.transaction(fn);
}

import { randomBytes } from "node:crypto";

// Object keys (V2 feature 09 §2): `u/{userId}/{yyyy}/{mm}/{attachmentId}/{128-bit random hex}`. The
// file name is never in a key, so a key reveals nothing, cannot be guessed and is unique per
// upload. One prefix per person, so a mistake in a storage policy cannot cross people by accident.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createStorageKey(
  userId: string,
  attachmentId: string,
  now: Date = new Date(),
  random: () => string = () => randomBytes(16).toString("hex"),
): string {
  if (!UUID.test(userId) || !UUID.test(attachmentId)) throw new Error("Ids must be UUIDs.");
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `u/${userId}/${yyyy}/${mm}/${attachmentId}/${random()}`;
}

/** Whether a key sits under this person's prefix (a second check beside the database row). */
export function isKeyOf(userId: string, key: string): boolean {
  return key.startsWith(`u/${userId}/`) && !key.includes("..");
}

/** Keys are only ever made by `createStorageKey`; anything else is refused by the local drivers. */
export const KEY_PATTERN = /^u\/[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}\/[0-9a-f]{32}$/;

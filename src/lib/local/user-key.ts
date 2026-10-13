// The name of one person's local database (V2 feature 04 §2). A hash of the user id, so a different
// person on the same browser opens a different database, and the id itself is not in browser storage.

const PREFIX = "dayboard-local-";

export async function localDbName(userId: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // Browsers only offer SHA-256 in secure contexts (https or localhost). Without it, offline use is off.
    throw new Error("Offline storage needs a secure connection.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${PREFIX}${hex.slice(0, 16)}`;
}

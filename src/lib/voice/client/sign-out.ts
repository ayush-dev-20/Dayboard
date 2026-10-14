import { countRecordings, wipeRecordings } from "./local-store";

/**
 * Signing out takes the person's recordings off this device (V2 feature 13 §9): audio is more private than a
 * task, and a shared browser must not keep it. If one is still waiting for a connection, the person is told
 * first, because it would be lost. Returns false when they choose to stay signed in.
 */
export async function confirmAndWipeRecordings(userId: string): Promise<boolean> {
  if (!userId) return true;
  const waiting = await countRecordings(userId);
  if (waiting > 0) {
    const message =
      waiting === 1
        ? "A voice recording on this device hasn't been uploaded yet. Signing out will delete it. Sign out anyway?"
        : `${waiting} voice recordings on this device haven't been uploaded yet. Signing out will delete them. Sign out anyway?`;
    if (!window.confirm(message)) return false;
  }
  await wipeRecordings(userId);
  return true;
}

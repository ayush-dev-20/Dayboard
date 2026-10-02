import { captureInboxItem } from "@/actions/inbox";

/**
 * Saves a thought to the Inbox. Never throws: a dropped connection (the request itself failing)
 * counts as a failed save like any other, so every caller can keep the text and offer Retry.
 */
export async function saveToInbox(
  text: string,
): Promise<{ ok: true } | { ok: false; message: string | null }> {
  try {
    const result = await captureInboxItem({ text });
    return result.ok
      ? { ok: true }
      : { ok: false, message: result.error.fieldErrors?.text ?? null };
  } catch {
    return { ok: false, message: null };
  }
}

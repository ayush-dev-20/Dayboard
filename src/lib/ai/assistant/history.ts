import { MAX_HISTORY, MESSAGE_MAX, type ChatTurnMessage } from "../assistant-types";

/**
 * The messages to send with a turn (feature 11 §3): the last ten, each cut to the limit, starting
 * with a person's message and ending with one. Used by the browser before sending; the server
 * refuses anything over the limits instead of trimming. Pure.
 */
export function trimHistory(messages: ChatTurnMessage[]): ChatTurnMessage[] {
  const recent = messages
    .filter((m) => m.text.trim() !== "")
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m.role,
      text: m.text.length > MESSAGE_MAX ? m.text.slice(0, MESSAGE_MAX) : m.text,
    }));
  // A turn has to open with the person's words.
  while (recent.length > 0 && recent[0]!.role !== "user") recent.shift();
  return recent;
}

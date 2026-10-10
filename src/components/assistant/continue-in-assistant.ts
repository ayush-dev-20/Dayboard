"use client";

import { addChips } from "./chips";
import { setLauncherOpen } from "./launcher-state";
import { createThread, titleFrom, type StoredMessage } from "./threads";

/**
 * "Continue in assistant" from Ask AI on a selection (V2 feature 11 §6B): the question, the answer and
 * the selected text become the start of a conversation about the note or task it came from, which
 * then has the assistant's tools. The selection travels as the first message (the person's own text,
 * sent by the browser), and the note or task becomes the chat's chip.
 */
export async function continueInAssistant(input: {
  owner: { type: "note" | "task"; id: string };
  selection: string;
  question: string;
  answer: string;
  /** Open the floating panel (true) or the Assistant page (false: the caller navigates). */
  panel: boolean;
}): Promise<string> {
  const at = Date.now();
  const quoted =
    input.selection.length > 600 ? `${input.selection.slice(0, 599)}…` : input.selection;
  const messages: StoredMessage[] = [
    {
      id: crypto.randomUUID(),
      role: "user",
      text: `About this text: “${quoted}”\n\n${input.question}`,
      at,
    },
    { id: crypto.randomUUID(), role: "assistant", text: input.answer, at: at + 1 },
  ];
  const id = createThread({ title: titleFrom(input.question), messages });
  await addChips(id, [input.owner]);
  if (input.panel) setLauncherOpen(true);
  return id;
}

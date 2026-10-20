// The two ways Ask AI on selected text can answer (V2 feature 11 §6B, revised 2026-10-20).
//
//   note  Only the selection and the text around it. If they do not hold the answer it says so.
//   open  The selection and the text around it as context, and the model's own knowledge as well. The answer is
//         labelled as a suggestion, so it is never mistaken for something the note says.
//
// Pure and free of secrets, so the browser and the server share the names, and the guess below can be tested.

export const ASK_MODES = ["note", "open"] as const;
export type AskMode = (typeof ASK_MODES)[number];

export const ASK_MODE_LABELS: Record<AskMode, string> = {
  note: "Use only my note",
  open: "Use general knowledge too",
};

/** The line shown above an answer, so a guess from the model is never read as the person's own words. */
export const ASK_ANSWER_LABELS: Record<AskMode, string> = {
  note: "From your note",
  open: "AI suggestion, not from your notes",
};

const QUESTION_WORDS = ["how", "what", "why", "which", "when", "where", "who", "can", "could"];
const REQUEST_WORDS = [
  "should",
  "would",
  "think",
  "suggest",
  "explain",
  "find",
  "brainstorm",
  "propose",
  "recommend",
  "figure",
  "come",
  "give",
  "list",
  "write",
  "draft",
  "design",
  "help",
  "ideas",
];
const OPENERS = new Set([...QUESTION_WORDS, ...REQUEST_WORDS]);

/**
 * Which mode to start in for this selection. A selection that is itself a question or a request ("Think of a
 * way to add modules to the app ?") starts in `open`, because the person wants it answered and a note rarely
 * holds the answer to its own question. Anything else starts in `note`. It is only the starting point: the
 * person can change it before asking.
 */
export function suggestAskMode(selection: string): AskMode {
  // Leave out list markers and checkboxes ("- ", "1. ", "[ ] ", "• ") before reading the first word.
  const text = selection
    .trim()
    .replace(/^(?:[-*•]\s+|\d+[.)]\s+|\[[ xX]?\]\s+)+/, "")
    .trim();
  if (text === "") return "note";
  if (/[?？]\s*$/.test(text)) return "open";
  const first =
    text
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^\p{L}]/gu, "") ?? "";
  return OPENERS.has(first) ? "open" : "note";
}

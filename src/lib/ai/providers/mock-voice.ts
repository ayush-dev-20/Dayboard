// The voice half of the mock provider (V2 feature 13): no network, no key, no cost, and the same answer
// every time. A real recording cannot be understood here, so the transcript comes from the bytes:
// a test uploads bytes that contain `mock-transcript:` followed by the words and gets that text back. Any other bytes (a
// real recording from a fake microphone in a browser test) get a fixed sentence.

const PREFIX = "mock-transcript:";
export const MOCK_DEFAULT_TRANSCRIPT =
  "Remind me to call the dentist tomorrow. Buy milk. Send the Acme report on Friday for the Acme project.";

export function mockTranscript(bytes: Uint8Array): string {
  // The words may follow a container header (a test's bytes must look like a real recording to pass the
  // server's type check), so look for the marker in the first part of the file.
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 64 * 1024));
  const at = head.indexOf(PREFIX);
  if (at >= 0) return new TextDecoder().decode(bytes.slice(at + PREFIX.length)).trim();
  return MOCK_DEFAULT_TRANSCRIPT;
}

const sentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

const WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const DUE = new RegExp(
  `\\b(?:by|before|on|due|this|next)?\\s*(today|tomorrow|${WEEKDAY}|next week)\\b`,
  "i",
);
const ERRAND = /^(?:remind me to\s+)?(buy|pick up|grab|get|pay|print)\b/i;
const ACTION =
  /\b(call|email|send|review|prepare|finish|write|book|schedule|ask|tell|fix|update|remind me to|need to|have to|should)\b/i;
const PROJECT = /\b(?:for|in|on) the ([A-Z][\w-]*(?: [A-Z][\w-]*)*) project\b/;
const PEOPLE = /\b(?:call|email|ask|tell|with|text) ([A-Z][a-z]+)\b/g;
const UNSURE = /\b(maybe|i think|not sure|probably|perhaps)\b/i;
const URGENT = /\b(urgent|asap|important)\b/i;

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * What a careful model would return for a transcript, built from simple cues so a test can predict it:
 * errands are todos, sentences with an action word are tasks, the rest are notes; a spoken day becomes a
 * `dueDate` phrase; "maybe" and "I think" make the item low confidence.
 */
export function mockVoiceParse(transcript: string) {
  const clean = transcript.replaceAll(/\[mock:\w+\]/g, "").trim();
  const items = sentences(clean).map((sentence) => {
    const due = DUE.exec(sentence)?.[1]?.toLowerCase() ?? null;
    const project = PROJECT.exec(sentence)?.[1] ?? null;
    const people = [...sentence.matchAll(PEOPLE)].map((m) => m[1]!);
    const isErrand = ERRAND.test(sentence);
    const isAction = ACTION.test(sentence) || Boolean(due);
    const kind = isErrand ? "TODO" : isAction ? "TASK" : "NOTE";
    let title = sentence
      .replace(/^remind me to\s+/i, "")
      .replace(DUE, "")
      .replace(/\s+for the [A-Z][\w-]*(?: [A-Z][\w-]*)* project\b/, "")
      .replace(/\s+/g, " ")
      .replace(/[.!?\s,]+$/, "")
      .trim();
    title = cap(title).slice(0, 200) || cap(sentence).slice(0, 200);
    return {
      kind,
      title,
      body: kind === "NOTE" ? sentence : null,
      dueDate: due,
      priority: URGENT.test(sentence) ? "HIGH" : null,
      projectMention: project,
      people,
      confidence: UNSURE.test(sentence) ? "low" : due && kind === "NOTE" ? "medium" : "high",
    };
  });
  return {
    language: "en",
    suggestedNoteTitle: clean
      ? cap(sentences(clean)[0]!.replace(/[.!?]+$/, "")).slice(0, 60)
      : null,
    items: items.slice(0, 30),
  };
}

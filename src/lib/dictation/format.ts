// Turns what the speech recogniser hears into text that reads properly (dictation into the editors). Pure: the caller
// says what is already in front of the cursor (`before`) and applies the pieces it gets back. The recogniser is
// bad at punctuation and capital letters on desktop, so this adds the capital letters and understands a few spoken
// marks ("comma", "full stop", "new paragraph"). Commands are English only: other languages are left as heard.

export type DictationOp =
  | { type: "text"; text: string }
  /** A new paragraph (or list item). */
  | { type: "paragraph" }
  /** A line break inside the paragraph. */
  | { type: "line" };

export type DictationContext = {
  /** The text of the current block before the cursor ("" at the start of a block). */
  before: string;
  /** Understand spoken marks and breaks. Off for languages other than English. */
  commands?: boolean;
};

type Command = { mark: string } | { op: "paragraph" | "line" };

const COMMANDS: Record<string, Command> = {
  "new paragraph": { op: "paragraph" },
  "new line": { op: "line" },
  "full stop": { mark: "." },
  period: { mark: "." },
  comma: { mark: "," },
  "question mark": { mark: "?" },
  "exclamation mark": { mark: "!" },
  "exclamation point": { mark: "!" },
  colon: { mark: ":" },
  semicolon: { mark: ";" },
};

const COMMAND_PATTERN = new RegExp(`\\b(${Object.keys(COMMANDS).join("|")})\\b`, "gi");

/** "i", "i'm", "i'll", "i've", "i'd" as a word of its own. */
const pronoun = (s: string) => s.replace(/\bi\b(?=$|[\s',.;:!?])/g, "I");

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether a sentence starts here: the start of a block, or after . ! ? (spaces ignored). */
const startsSentence = (tail: string) => tail.trim() === "" || /[.!?]\s*$/.test(tail);

export function formatDictation(raw: string, context: DictationContext): DictationOp[] {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return [];

  const parts = context.commands === false ? [text] : text.split(COMMAND_PATTERN);
  const ops: DictationOp[] = [];
  let tail = context.before;

  const push = (value: string) => {
    const last = ops[ops.length - 1];
    if (last?.type === "text") last.text += value;
    else ops.push({ type: "text", text: value });
    tail += value;
  };

  for (const [index, part] of parts.entries()) {
    // Odd entries are the commands the split captured.
    if (index % 2 === 1) {
      const command = COMMANDS[part.toLowerCase()]!;
      if ("mark" in command) {
        push(command.mark);
      } else {
        ops.push({ type: command.op });
        tail = "";
      }
      continue;
    }
    const words = part.trim();
    if (!words) continue;
    let piece = pronoun(words);
    if (startsSentence(tail)) piece = capitalise(piece);
    const needsSpace = tail !== "" && !/\s$/.test(tail) && !/^[,.;:!?)\]]/.test(piece);
    push(needsSpace ? ` ${piece}` : piece);
  }
  return ops;
}

/** The pieces as plain text, for a text box: a paragraph is a blank line, a line break a newline. */
export function opsToText(ops: DictationOp[]): string {
  return ops
    .map((op) => (op.type === "text" ? op.text : op.type === "paragraph" ? "\n\n" : "\n"))
    .join("");
}

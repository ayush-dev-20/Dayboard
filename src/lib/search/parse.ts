// Reads what the person typed into the search box: plain words and "quoted phrases" (V2 feature 10 §5).
// Pure, so it can be tested exactly. The 2 to 200 character rule is still `parseQuery` in `query.ts`.

export const MAX_PHRASES = 3;

export type ParsedSearch = {
  /** The words outside quotes, joined with single spaces. This is what meaning-based search embeds. */
  text: string;
  /** Each quoted phrase, trimmed. A phrase must appear exactly (any letter case) for a result to match it. */
  phrases: string[];
  /** True when the box holds only quoted phrases, so there is nothing to search by meaning. */
  onlyPhrases: boolean;
};

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * `"exact words" other words` gives one phrase and the text "other words". Curly quotes count as quotes.
 * A quote that never closes is dropped and its words are kept as plain text, so a half-typed phrase still
 * searches. Empty phrases (`""`) are ignored, and only the first three phrases are used.
 */
export function parseSearchText(raw: string): ParsedSearch {
  const input = raw.replace(/[“”„‟]/g, '"');
  const phrases: string[] = [];
  let text = "";
  let index = 0;

  while (index < input.length) {
    const open = input.indexOf('"', index);
    if (open === -1) {
      text += input.slice(index);
      break;
    }
    const close = input.indexOf('"', open + 1);
    if (close === -1) {
      // Unbalanced: keep the words, lose the stray quote.
      text += `${input.slice(index, open)} ${input.slice(open + 1)}`;
      break;
    }
    text += `${input.slice(index, open)} `;
    const phrase = collapse(input.slice(open + 1, close));
    if (phrase && phrases.length < MAX_PHRASES) phrases.push(phrase);
    index = close + 1;
  }

  const rest = collapse(text);
  return { text: rest, phrases, onlyPhrases: phrases.length > 0 && rest === "" };
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

// One emoji: a flag, a keycap, a subdivision flag (England), or a pictograph with optional variation
// selector or skin tone, joined with zero-width joiners (family, profession, couple sequences).
const ONE_EMOJI = new RegExp(
  "^(?:" +
    "\\p{Regional_Indicator}{2}" +
    "|[#*0-9]\\uFE0F?\\u20E3" +
    "|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]+\\u{E007F}" +
    "|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?" +
    "(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*" +
    ")$",
  "u",
);

function graphemeCount(value: string): number {
  if (segmenter) return [...segmenter.segment(value)].length;
  return [...value].length;
}

/** True for exactly one visible emoji. Rejects letters, digits, two emojis and empty text. */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 32) return false;
  return graphemeCount(value) === 1 && ONE_EMOJI.test(value);
}

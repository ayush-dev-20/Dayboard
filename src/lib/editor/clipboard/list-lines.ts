import type { ListKind } from "./lists";

// Recognises a list marker at the start of a line of text: bullets in many glyphs, numbers, letters
// and roman numerals, checkbox glyphs. Shared by the plain-text and HTML readers. Pure.

export type LineMarker = {
  kind: ListKind;
  /** Width of the leading whitespace (a tab counts as four). */
  indent: number;
  /** A bullet glyph that is not ordinary punctuation (•, ◦, ▪…): clear enough on its own. */
  glyph: boolean;
  /** A single letter or roman numeral: only believed next to other list lines. */
  ambiguous: boolean;
  start?: number;
  checked?: boolean;
  /** The text after the marker. */
  rest: string;
};

const GLYPHS = "•◦▪▫‣·●○■□";
const BULLET = new RegExp(`^([ \\t]*)([${GLYPHS}–—\\-*+])[ \\t]+(\\S.*)$`);
const TASK_GLYPH = /^([ \t]*)([☐☑☒✓✔])[ \t]+(\S.*)$/;
const NUMBER = /^([ \t]*)(\d{1,7})[.)][ \t]+(\S.*)$/;
const PAREN_NUMBER = /^([ \t]*)\((\d{1,3})\)[ \t]+(\S.*)$/;
const LETTER = /^([ \t]*)\(?([a-z]|[ivx]{2,5})[.)][ \t]+(\S.*)$/;
const MARKDOWN_TASK = /^\[([ xX])\][ \t]+(\S.*)$/;

export function indentWidth(spaces: string): number {
  return spaces.replace(/\t/g, "    ").length;
}

export function classifyLine(line: string): LineMarker | null {
  let m = TASK_GLYPH.exec(line);
  if (m) {
    return {
      kind: "task",
      indent: indentWidth(m[1]!),
      glyph: true,
      ambiguous: false,
      checked: m[2] !== "☐",
      rest: m[3]!,
    };
  }

  m = BULLET.exec(line);
  if (m) {
    const marker = m[2]!;
    const task = MARKDOWN_TASK.exec(m[3]!);
    return {
      kind: task ? "task" : "bullet",
      indent: indentWidth(m[1]!),
      glyph: GLYPHS.includes(marker),
      ambiguous: false,
      ...(task ? { checked: task[1] !== " " } : {}),
      rest: task ? task[2]! : m[3]!,
    };
  }

  m = NUMBER.exec(line) ?? PAREN_NUMBER.exec(line);
  if (m) {
    const start = Number.parseInt(m[2]!, 10);
    return {
      kind: "ordered",
      indent: indentWidth(m[1]!),
      glyph: false,
      ambiguous: false,
      ...(start > 1 ? { start } : {}),
      rest: m[3]!,
    };
  }

  m = LETTER.exec(line);
  if (m) {
    return {
      kind: "ordered",
      indent: indentWidth(m[1]!),
      glyph: false,
      ambiguous: true,
      rest: m[3]!,
    };
  }
  return null;
}

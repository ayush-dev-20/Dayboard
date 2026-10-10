import type { AskSource } from "./types";

// Turns a streamed answer into what the Ask panel shows. Pure, so the rules are testable: which
// quotes may be called "From your workspace", and which citations may be shown at all.

export type AnswerPart = { kind: "text"; text: string } | { kind: "quote"; text: string };

const CITATION = /\s?\[(S\d{1,2}(?:\s*,\s*S\d{1,2})*)\]/g;

/**
 * "[S1]" becomes "[1]". Once the sources are final (`final`), a citation of a label that was never
 * provided is removed instead of shown: the panel never points at something that isn't there.
 */
export function cleanCitations(text: string, sources: AskSource[], final: boolean): string {
  const known = new Set(sources.map((s) => s.label));
  return text.replace(CITATION, (_match, group: string) => {
    const labels = group.split(",").map((l) => l.trim());
    const kept = final ? labels.filter((l) => known.has(l)) : labels;
    if (kept.length === 0) return "";
    return ` [${kept.map((l) => l.slice(1)).join(", ")}]`;
  });
}

const norm = (s: string) => s.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();

/**
 * Splits an answer into text and quotes. A line starting with "> " is a quote only when the server
 * verified it appears in the workspace (`verified`); otherwise it is shown as ordinary text.
 */
export function splitAnswer(
  text: string,
  sources: AskSource[],
  verified: string[],
  final: boolean,
): AnswerPart[] {
  const ok = new Set(verified.map(norm));
  const parts: AnswerPart[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    if (raw.startsWith(">")) {
      const quote = raw.replace(/^>\s*/, "").trim();
      if (final && ok.has(norm(quote))) {
        parts.push({ kind: "quote", text: norm(quote) });
      } else if (final) {
        parts.push({ kind: "text", text: cleanCitations(quote, sources, final) });
      }
      // While streaming, a quote line is held back until it can be checked.
      continue;
    }
    parts.push({ kind: "text", text: cleanCitations(raw.trim(), sources, final) });
  }
  return parts;
}

// ---- Formatting -------------------------------------------------------------------------------
// Models answer in light Markdown (**bold**, "* " bullets, "1." lists). The panel shows it as
// formatting instead of raw symbols. Pure and small on purpose: it understands only what an answer
// needs, never builds HTML, and anything it does not recognise stays as the plain text it was.

export type Inline = { kind: "text" | "bold" | "italic" | "code"; text: string };

const INLINE = /`([^`\n]+)`|\*\*(\S(?:[^\n]*?\S)?)\*\*|\*(\S(?:[^*\n]*?\S)?)\*/g;

/**
 * Splits one line into plain, bold, italic and code runs. While the answer is still arriving
 * (`streaming`), a marker that is opened but not yet closed is closed for display, and a marker that
 * has only just been typed is held back, so half-written `**Purp` never flashes as symbols.
 */
export function parseInline(text: string, streaming = false): Inline[] {
  let src = text;
  if (streaming) {
    for (const marker of ["**", "`"]) {
      const count = src.split(marker).length - 1;
      if (count % 2 === 1) src = src.endsWith(marker) ? src.slice(0, -marker.length) : src + marker;
    }
  }
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: src.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "bold", text: m[2] });
    else out.push({ kind: "italic", text: m[3] ?? "" });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}

export type AnswerBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; start: number; items: string[] }
  | { kind: "quote"; text: string };

const BULLET = /^[-*•]\s+(.*)$/;
const ORDERED = /^(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
// A list marker that has arrived without its text yet.
const BARE_MARKER = /^(?:[-*•]|\d{1,3}[.)]|#{1,6})$/;

/** Groups the lines of an answer into paragraphs, headings, lists and verified quotes. */
export function answerBlocks(parts: AnswerPart[]): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const part of parts) {
    if (part.kind === "quote") {
      blocks.push({ kind: "quote", text: part.text });
      continue;
    }
    const line = part.text.trim();
    if (!line || RULE.test(line) || BARE_MARKER.test(line)) continue;

    const bullet = BULLET.exec(line);
    if (bullet) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(bullet[1] ?? "");
      else blocks.push({ kind: "ul", items: [bullet[1] ?? ""] });
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ol") last.items.push(ordered[2] ?? "");
      else blocks.push({ kind: "ol", start: Number(ordered[1]), items: [ordered[2] ?? ""] });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "h", text: heading[1] ?? "" });
      continue;
    }
    blocks.push({ kind: "p", text: line });
  }
  return blocks;
}

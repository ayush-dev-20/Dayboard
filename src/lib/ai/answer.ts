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

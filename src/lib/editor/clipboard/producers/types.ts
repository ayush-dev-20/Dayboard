import type { TiptapNode } from "../../types";
import type { FlatItem } from "../lists";

export type ProducerName =
  "google-docs" | "word" | "notion" | "slack" | "apple" | "gmail" | "github" | "vscode" | "generic";

/** What a producer's hooks may ask the parser to do. */
export type ProducerApi = {
  /** The inline content of an element, with the formatting the page gives it. */
  inline(el: Element): TiptapNode[];
  /** The blocks inside an element. */
  blocks(el: Element): TiptapNode[];
  /** The text of an element with its line breaks kept (code). */
  code(el: Element): string;
  /** The language VS Code reports for the copied code, when it did. */
  vscodeMode?: string;
};

/**
 * What one source tool needs on top of the common mapping (V2 feature 02 §5). Most tools need
 * nothing: their markup is ordinary and the generic rules read it. A producer only names itself
 * (so tests and the matrix can say what was detected) and adds the few things that are its own.
 */
export type Producer = {
  name: ProducerName;
  detect(doc: Document, html: string): boolean;
  /** Removes markup that is noise in this tool (anchors, toolbars, spacer elements). */
  prepare?(root: HTMLElement): void;
  /** Blocks to use instead of the generic reading of this element, or null to decline. */
  block?(el: Element, api: ProducerApi): TiptapNode[] | null;
  /** A paragraph that is really a list item (Word writes lists as styled paragraphs). */
  listParagraph?(el: Element, api: ProducerApi): FlatItem | null;
  /** The nesting level (0 is the outermost) of a list element, when markup alone does not say. */
  level?(el: Element): number | null;
  /** The language of a code block, when the tool writes it somewhere the generic rules miss. */
  codeLanguage?(el: Element): string | null;
};

export const MONOSPACE =
  /\b(monospace|courier|consolas|menlo|monaco|sf mono|source code|fira code|lucida console)\b/i;

export function styleOf(el: Element): Record<string, string> {
  const raw = el.getAttribute("style");
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const declaration of raw.split(";")) {
    const at = declaration.indexOf(":");
    if (at < 0) continue;
    out[declaration.slice(0, at).trim().toLowerCase()] = declaration
      .slice(at + 1)
      .trim()
      .toLowerCase();
  }
  return out;
}

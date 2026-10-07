import type { TiptapDoc } from "../types";
export { fitToBudget } from "./budget";
import { parseHtml } from "./parse-html";
import { parseText, plainParagraphs } from "./parse-text";
import type { ParsedClipboard } from "./rules";
import type { InternalSlice } from "./slice";
import type { ProducerName } from "./producers";

// Decides how a paste is read, in the order of the spec (V2 feature 02 §5): Dayboard's own flavour,
// then HTML, then plain text. Rules and the Shift (plain) case are handled before this. Pure apart
// from the DOM parser the HTML reader needs.

export type PastePlan =
  | { kind: "internal"; slice: InternalSlice }
  | {
      kind: "doc";
      source: "html" | "markdown" | "text";
      doc: TiptapDoc;
      notices: string[];
      producer?: ProducerName;
    }
  | { kind: "none" };

export type PasteInput = ParsedClipboard & {
  /** The language VS Code reported, from its `vscode-editor-data` flavour. */
  vscodeMode?: string;
};

const hasContent = (doc: TiptapDoc) => (doc.content?.length ?? 0) > 0;

export function planPaste(data: PasteInput): PastePlan {
  if (data.internal) return { kind: "internal", slice: data.internal };

  // VS Code with Markdown open sends the Markdown as code HTML; the text is what the person means.
  const preferText = data.vscodeMode === "markdown";
  if (data.html.trim() !== "" && !preferText) {
    let parsed: ReturnType<typeof parseHtml> = null;
    try {
      parsed = parseHtml(data.html, { vscodeMode: data.vscodeMode });
    } catch {
      // Markup the reader cannot take: the plain text is still there.
    }
    if (parsed && hasContent(parsed.doc)) {
      return {
        kind: "doc",
        source: "html",
        doc: parsed.doc,
        notices: parsed.notices,
        producer: parsed.producer,
      };
    }
  }

  if (data.text.trim() !== "") {
    const parsed = parseText(data.text);
    if (hasContent(parsed.doc)) {
      return {
        kind: "doc",
        source: parsed.kind === "markdown" ? "markdown" : "text",
        doc: parsed.doc,
        notices: parsed.notices,
      };
    }
  }
  return { kind: "none" };
}

/** Cmd/Ctrl+Shift+V: the text only, one paragraph per line, no detection of any kind. */
export function planPlainPaste(text: string): TiptapDoc {
  return { type: "doc", content: plainParagraphs(text) };
}

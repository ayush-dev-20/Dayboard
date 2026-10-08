import type { TiptapDoc } from "@/lib/editor/types";
import { flavoursFor, type Flavours } from "@/lib/editor/clipboard/copy";
import type { NoteRefReader } from "@/lib/editor/clipboard/note-refs";
import { INTERNAL_MIME } from "@/lib/editor/clipboard/slice";

// "Copy note" and "Copy as Markdown" (V2 feature 02 §4): the whole document through the same
// serialisers as a selection, so what lands is what a selection would give.

export type CopyKind = "note" | "markdown";

/** The note's text as it will be copied (for tests and the toast). */
export function copyFlavours(doc: TiptapDoc, title?: string, noteRefs?: NoteRefReader): Flavours {
  const flavours = flavoursFor(doc.content ?? [], 0, 0, noteRefs);
  if (!title?.trim()) return flavours;
  // The title leads the copy: a heading in the rich flavours, a `#` line in Markdown.
  const heading = title.trim();
  const escaped = heading.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    ...flavours,
    html: `<h1>${escaped}</h1>${flavours.html}`,
    text: `# ${heading}${flavours.text ? `\n\n${flavours.text}` : ""}`,
  };
}

/**
 * Writes with a `copy` event, which carries every flavour (including the Dayboard one) in every
 * browser. Where that is refused, the async clipboard with HTML and text; then text alone.
 */
export async function copyToClipboard(flavours: Flavours, kind: CopyKind): Promise<boolean> {
  const text = flavours.text;
  const rich = kind === "note";

  if (typeof document !== "undefined" && typeof document.execCommand === "function") {
    let wrote = false;
    const onCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", text);
      if (rich) {
        event.clipboardData.setData("text/html", flavours.html);
        event.clipboardData.setData(INTERNAL_MIME, flavours.internal);
      }
      event.preventDefault();
      wrote = true;
    };
    document.addEventListener("copy", onCopy);
    try {
      document.execCommand("copy");
    } catch {
      // Falls through to the async clipboard.
    } finally {
      document.removeEventListener("copy", onCopy);
    }
    if (wrote) return true;
  }

  try {
    if (rich && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([flavours.html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

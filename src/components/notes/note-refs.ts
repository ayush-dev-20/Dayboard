import type { NoteRefReader } from "@/lib/editor/clipboard/note-refs";
import { displayTitle } from "@/lib/notes/links";
import { peekNoteMeta } from "./note-meta-store";

/**
 * What the clipboard code needs to write a note link as an ordinary link, and to recognise a pasted
 * note address as this app's own: this page's address, plus the configured one (they differ behind
 * a proxy), and the titles the page already knows.
 */
export function clientNoteRefs(): NoteRefReader & { origins: readonly string[] } {
  const here = window.location.origin;
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return {
    origin: here,
    origins: [...new Set([here, ...(configured ? [configured] : [])])],
    label: (id) => {
      const meta = peekNoteMeta(id);
      return meta ? displayTitle(meta) : "Note";
    },
  };
}

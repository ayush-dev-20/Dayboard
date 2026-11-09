import { EditorDocError, sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// What a template may contain (V3 feature 03 §3): everything a note may, except blocks that point at stored content. An
// image or a file would make a note and its template share one stored file, so deleting it from one would break the
// other; a sub-note block would create sub-notes by surprise each time the template is used. They are refused with a
// plain message, never quietly removed.

const FORBIDDEN = new Set(["image", "file", "subNote"]);
export const FORBIDDEN_MESSAGE = "Templates can't contain images, files or sub-notes.";

function walk(nodes: TiptapNode[] | undefined): boolean {
  return (nodes ?? []).some((node) => FORBIDDEN.has(node.type) || walk(node.content));
}

/** Checks and cleans a template's document. Throws `EditorDocError` with a plain message. */
export function sanitizeTemplateDoc(input: unknown): TiptapDoc {
  // `allowSubNotes: false` already refuses a sub-note block; images and files are refused here.
  let doc: TiptapDoc;
  try {
    doc = sanitizeDoc(input, { allowSubNotes: false });
  } catch (error) {
    if (error instanceof EditorDocError && /sub-?note/i.test(error.message)) {
      throw new EditorDocError(FORBIDDEN_MESSAGE);
    }
    throw error;
  }
  if (walk(doc.content)) throw new EditorDocError(FORBIDDEN_MESSAGE);
  return doc;
}

/** Whether a stored document is still acceptable as a template (it may have been saved under older rules). */
export function isUsableTemplateDoc(input: unknown): boolean {
  try {
    sanitizeTemplateDoc(input);
    return true;
  } catch {
    return false;
  }
}

import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import type { Schema } from "@tiptap/pm/model";
import * as Y from "yjs";
import { createExtensions } from "@/components/editor/extensions";
import { sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc } from "@/lib/editor/types";

// The shared document and the note's ordinary columns, in both directions (V3 feature 05 §4, docs/decisions/0019).
// The body is the Y.XmlFragment "default" (what the Collaboration extension edits); the title and emoji are in the
// Y.Map "meta". Seeding is done here, on the server, never by a client.

export const BODY_FIELD = "default";
export const META_FIELD = "meta";

let schema: Schema | null = null;

/** The editor's ProseMirror schema, built without node views, so it works in the service. */
export function noteSchema(): Schema {
  schema ??= getSchema(createExtensions("", { interactive: false }));
  return schema;
}

/** A new shared document holding the note as it is now. */
export function seedYDoc(note: {
  contentJson: TiptapDoc;
  title: string;
  emoji: string | null;
}): Y.Doc {
  const ydoc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(noteSchema(), note.contentJson, ydoc.getXmlFragment(BODY_FIELD));
  const meta = ydoc.getMap<string | null>(META_FIELD);
  meta.set("title", note.title);
  meta.set("emoji", note.emoji);
  return ydoc;
}

export type LiveNote = { doc: TiptapDoc; title: string; emoji: string | null };

/**
 * What the shared document says now, cleaned: the body goes through `sanitizeDoc` (so a forged update cannot put a
 * forbidden node in `content_json`), the title and emoji are clipped to their column rules. Throws when the body cannot
 * be cleaned; the caller keeps the last good projection.
 */
export function readLive(ydoc: Y.Doc): LiveNote {
  const json = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(BODY_FIELD));
  const doc = sanitizeDoc(json, { allowSubNotes: true });
  const meta = ydoc.getMap<unknown>(META_FIELD);
  const title =
    typeof meta.get("title") === "string" ? (meta.get("title") as string).slice(0, 300) : "";
  const rawEmoji = meta.get("emoji");
  const emoji =
    typeof rawEmoji === "string" && rawEmoji.length > 0 && rawEmoji.length <= 16 ? rawEmoji : null;
  return { doc, title: title.replace(/[\r\n]+/g, " "), emoji };
}

/** Whether the document has changed from `before` (state vectors differ): used to skip empty projections. */
export function stateOf(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

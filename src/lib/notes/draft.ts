import type { TiptapDoc } from "@/lib/editor/types";

// A local copy of the latest unsaved content, so a failed save or a closed tab never loses text.
// Browser storage can be missing or blocked, so every call is wrapped and failures are ignored.

export type NoteDraft = { doc: TiptapDoc; title: string; savedAt: number; baseVersion: number };

const key = (id: string) => `draft:note:${id}`;

export function writeDraft(id: string, draft: NoteDraft): void {
  try {
    window.localStorage.setItem(key(id), JSON.stringify(draft));
  } catch {
    // storage unavailable or full: the in-memory copy still protects the session
  }
}

export function readDraft(id: string): NoteDraft | null {
  try {
    const raw = window.localStorage.getItem(key(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoteDraft>;
    if (!parsed.doc || typeof parsed.savedAt !== "number") return null;
    return {
      doc: parsed.doc,
      title: typeof parsed.title === "string" ? parsed.title : "",
      savedAt: parsed.savedAt,
      baseVersion: typeof parsed.baseVersion === "number" ? parsed.baseVersion : 0,
    };
  } catch {
    return null;
  }
}

export function clearDraft(id: string): void {
  try {
    window.localStorage.removeItem(key(id));
  } catch {
    // ignore
  }
}

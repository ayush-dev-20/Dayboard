import { closeHistory } from "@tiptap/pm/history";
import type { EditorView } from "@tiptap/pm/view";
import { isAllowedLink } from "../schema";
import type { InternalSlice } from "./slice";

// The paste rule registry (V2 feature 02 §5). A later feature that wants to claim a paste (a note
// address becomes a note link, an image file is uploaded, a bare URL offers a bookmark) registers a
// rule here; the paste code never changes. Rules run in `priority` order (lower first), before any
// of the editor's own handling, and the first one whose `apply` returns true wins.

/** Where the editor is used; the same shape as the slash menu's context. */
export type PasteContext = { surface: "note" | "task"; ownerId: string | null; offline: boolean };

export type ParsedClipboard = {
  types: readonly string[];
  html: string;
  text: string;
  files: File[];
  /** The Dayboard flavour, when present and readable. */
  internal: InternalSlice | null;
};

export type PasteRule = {
  id: string;
  /** Lower runs first. */
  priority: number;
  test(data: ParsedClipboard, ctx: PasteContext): boolean;
  apply(view: EditorView, data: ParsedClipboard, ctx: PasteContext): boolean;
};

const rules = new Map<string, PasteRule>();

export function registerPasteRule(rule: PasteRule): void {
  if (rules.has(rule.id)) throw new Error(`The paste rule "${rule.id}" is already registered.`);
  rules.set(rule.id, rule);
}

export const hasPasteRule = (id: string) => rules.has(id);

/** For tests only. */
export function clearPasteRules(): void {
  rules.clear();
}

export function getPasteRules(): PasteRule[] {
  return [...rules.values()].sort((a, b) => a.priority - b.priority);
}

/** Runs the rules; true when one handled the paste. */
export function runPasteRules(view: EditorView, data: ParsedClipboard, ctx: PasteContext): boolean {
  for (const rule of getPasteRules()) {
    if (rule.test(data, ctx) && rule.apply(view, data, ctx)) return true;
  }
  return false;
}

// ---- The one rule that ships with this feature ------------------------------------------------

const URL_ONLY = /^https?:\/\/\S+$/i;

/** A web address pasted over selected text makes the selection a link and changes nothing else. */
export const urlOverSelection: PasteRule = {
  id: "url-over-selection",
  priority: 100,
  test: (data) =>
    !data.internal && URL_ONLY.test(data.text.trim()) && isAllowedLink(data.text.trim()),
  apply(view, data) {
    const { state } = view;
    const { from, to, empty } = state.selection;
    const link = state.schema.marks.link;
    if (empty || !link) return false;
    // Inside a code block there is nothing to link.
    if (state.selection.$from.parent.type.spec.code) return false;
    if (!state.doc.textBetween(from, to).trim()) return false;
    const tr = state.tr
      .addMark(from, to, link.create({ href: data.text.trim() }))
      .setMeta("paste", true)
      .setMeta("preventAutolink", true);
    view.dispatch(closeHistory(tr));
    return true;
  },
};

export function registerCorePasteRules(): void {
  if (!rules.has(urlOverSelection.id)) registerPasteRule(urlOverSelection);
}

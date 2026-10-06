import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import type { EditorContextValue } from "./context";

// The one place a block is added to the slash menu (V2 feature 01 §4). Core blocks register here
// and so do later features (sub-note, new linked note, image, file, bookmark): they call
// `registerBlock` and the menu shows them where `surfaces` and `available` allow, with no change
// to the menu code.

export type EditorContext = EditorContextValue;

export const BLOCK_GROUPS = ["Basic", "Lists", "Layout", "Insert", "Links"] as const;
export type BlockGroup = (typeof BLOCK_GROUPS)[number];

export type BlockItem = {
  /** Unique: "table", "callout", "toggle-h1". */
  id: string;
  title: string;
  /** Extra words that find it: ["grid", "rows"]. */
  keywords: string[];
  group: BlockGroup;
  icon: LucideIcon;
  /** Where it is offered. */
  surfaces: ("note" | "task")[];
  insert(editor: Editor, ctx: EditorContext): void;
  available?(ctx: EditorContext): boolean;
};

const items = new Map<string, BlockItem>();

export function registerBlock(item: BlockItem): void {
  if (items.has(item.id)) throw new Error(`The block "${item.id}" is already registered.`);
  items.set(item.id, item);
}

export const hasBlock = (id: string) => items.has(id);

/** For tests only. */
export function clearBlocks(): void {
  items.clear();
}

/** The blocks to offer here, in group order and then in the order they were registered. */
export function getBlocks(ctx: EditorContext): BlockItem[] {
  return [...items.values()]
    .filter((item) => item.surfaces.includes(ctx.surface) && (item.available?.(ctx) ?? true))
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        BLOCK_GROUPS.indexOf(a.item.group) - BLOCK_GROUPS.indexOf(b.item.group) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

/** How well a block matches what was typed after the `/`; lower is better, null is no match. */
function rank(item: BlockItem, query: string): number | null {
  const title = item.title.toLowerCase();
  if (title.startsWith(query)) return 0;
  if (title.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (item.keywords.some((keyword) => keyword.toLowerCase().startsWith(query))) return 2;
  if (title.includes(query)) return 3;
  if (item.keywords.some((keyword) => keyword.toLowerCase().includes(query))) return 4;
  return null;
}

/** Fuzzy-prefix filter: title start, word start, keyword start, then contains. Stable. */
export function filterBlocks(list: BlockItem[], rawQuery: string): BlockItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return list;
  return list
    .map((item, index) => ({ item, index, score: rank(item, query) }))
    .filter(
      (entry): entry is { item: BlockItem; index: number; score: number } => entry.score !== null,
    )
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ item }) => item);
}

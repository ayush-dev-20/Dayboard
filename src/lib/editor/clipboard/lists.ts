import { LIST_MAX_DEPTH } from "../limits";
import type { TiptapNode } from "../types";
import { fitInner } from "./fit";
import { blocksToInline, paragraphOf } from "./inline";

// Builds nested lists from a flat run of items, each with a depth. Every source arrives this way in
// the end (Google Docs and Word flatten levels into attributes, Slack gives one list per level,
// plain text has only indentation), so one builder serves them all. Pure.

export type ListKind = "bullet" | "ordered" | "task";

export type FlatItem = {
  /** 0 is the outermost level. Gaps are closed: a level is at most one deeper than the one above. */
  depth: number;
  kind: ListKind;
  /** The number the first item of a new ordered list starts at. */
  start?: number;
  checked?: boolean;
  /** The item's blocks: usually one paragraph. */
  content: TiptapNode[];
};

const MAX_INDEX = LIST_MAX_DEPTH - 1;

/** Item content that fits a list item: a paragraph first, then plain blocks. */
function itemBlocks(content: TiptapNode[]): TiptapNode[] {
  const blocks = fitInner(content);
  const first = blocks[0];
  if (!first) return [{ type: "paragraph" }];
  if (first.type === "paragraph") return blocks;
  if (first.type === "heading") return [paragraphOf(first.content ?? []), ...blocks.slice(1)];
  return [{ type: "paragraph" }, ...blocks];
}

/** A task item holds paragraphs only; anything else becomes a paragraph of its text. */
function taskBlocks(content: TiptapNode[]): TiptapNode[] {
  const paragraphs = fitInner(content).flatMap((block) =>
    block.type === "paragraph"
      ? [block]
      : [paragraphOf(blocksToInline([block]))].filter((p) => p.content),
  );
  return paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }];
}

function newList(item: FlatItem): TiptapNode {
  if (item.kind === "task") return { type: "taskList", content: [] };
  if (item.kind === "ordered") {
    return item.start && item.start > 1 && item.start <= 1_000_000
      ? { type: "orderedList", attrs: { start: item.start }, content: [] }
      : { type: "orderedList", content: [] };
  }
  return { type: "bulletList", content: [] };
}

function itemNode(item: FlatItem): TiptapNode {
  return item.kind === "task"
    ? {
        type: "taskItem",
        attrs: { checked: item.checked === true },
        content: taskBlocks(item.content),
      }
    : { type: "listItem", content: itemBlocks(item.content) };
}

type Frame = { kind: ListKind; list: TiptapNode };

/** Items in, top-level lists out. Never nests deeper than the editor allows. */
export function buildNestedLists(items: FlatItem[]): TiptapNode[] {
  if (items.length === 0) return [];
  const lowest = Math.min(...items.map((item) => item.depth));
  const roots: TiptapNode[] = [];
  const stack: Frame[] = [];

  for (const item of items) {
    let depth = Math.min(Math.max(item.depth - lowest, 0), MAX_INDEX);
    // A level is at most one deeper than the one above it.
    if (depth > stack.length) depth = stack.length;
    // Checklist items cannot hold a list, so a deeper item stays at the checklist's own level.
    if (depth === stack.length && depth > 0 && stack[depth - 1]!.kind === "task") depth -= 1;
    stack.length = Math.min(stack.length, depth + 1);

    const existing = stack[depth];
    if (existing && existing.kind !== item.kind) stack.length = depth;

    if (!stack[depth]) {
      const list = newList(item);
      if (depth === 0) {
        roots.push(list);
      } else {
        const parent = stack[depth - 1]!.list.content!.at(-1)!;
        parent.content = [...(parent.content ?? []), list];
      }
      stack[depth] = { kind: item.kind, list };
    }
    stack[depth]!.list.content!.push(itemNode(item));
  }
  return roots;
}

import { orderBetween } from "../tasks/ordering";

// The note hierarchy as plain data (V2 feature 07 §2, §5). Everything that decides what a tree
// looks like, whether a move is allowed and what a breadcrumb says is here, with no database and no
// React, so it is tested on its own and used by the server, the sidebar and the Tree view alike.

/** Notes nest this many levels (a top-level note is level 1). */
export const MAX_NOTE_DEPTH = 5;

export const DEPTH_MESSAGE = "Notes can be nested five levels deep.";
export const CYCLE_MESSAGE = "A note can't be moved into itself or into one of its own sub-notes.";

/** What the tree needs to know about a note. */
export type TreeNote = {
  id: string;
  parentId: string | null;
  title: string;
  emoji: string | null;
  sortOrder: number;
};

export type OutlineNode<T extends TreeNote = TreeNote> = T & {
  /** 1 for a top-level note. */
  level: number;
  children: OutlineNode<T>[];
};

const byOrder = <T extends TreeNote>(a: T, b: T) => a.sortOrder - b.sortOrder;

/**
 * The notes as a forest. Siblings are in manual order (`sortOrder`, ties keep input order). A note
 * whose parent is not in the list (a parent that is archived or in Trash, or past the cut-off) is
 * shown at the top, so no note disappears from a tree just because its parent is not in it.
 */
export function buildOutline<T extends TreeNote>(notes: readonly T[]): OutlineNode<T>[] {
  const ids = new Set(notes.map((n) => n.id));
  const childrenOf = new Map<string | null, T[]>();
  for (const note of notes) {
    const key = note.parentId !== null && ids.has(note.parentId) ? note.parentId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(note);
    childrenOf.set(key, list);
  }
  const seen = new Set<string>();
  const build = (parent: string | null, level: number): OutlineNode<T>[] =>
    [...(childrenOf.get(parent) ?? [])].sort(byOrder).flatMap((note) => {
      // A loop in bad data must not hang the page.
      if (seen.has(note.id)) return [];
      seen.add(note.id);
      return [{ ...note, level, children: build(note.id, level + 1) }];
    });
  return build(null, 1);
}

/** The outline as one list in reading order (parents before their children). */
export function flattenOutline<T extends TreeNote>(
  nodes: readonly OutlineNode<T>[],
  isOpen: (node: OutlineNode<T>) => boolean = () => true,
): OutlineNode<T>[] {
  const out: OutlineNode<T>[] = [];
  const walk = (list: readonly OutlineNode<T>[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0 && isOpen(node)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Ids of every note below `id`, at any depth (not `id` itself). */
export function descendantIds(
  notes: readonly Pick<TreeNote, "id" | "parentId">[],
  id: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const note of notes) {
    if (note.parentId === null) continue;
    childrenOf.set(note.parentId, [...(childrenOf.get(note.parentId) ?? []), note.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const queue = [...(childrenOf.get(id) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    queue.push(...(childrenOf.get(next) ?? []));
  }
  return out;
}

/** The ancestors of `id`, from the top-level note down to its parent. Stops at a loop. */
export function ancestorsOf<T extends Pick<TreeNote, "id" | "parentId">>(
  byId: ReadonlyMap<string, T>,
  id: string,
): T[] {
  const chain: T[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id)?.parentId ?? null;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const note = byId.get(current);
    if (!note) break;
    chain.unshift(note);
    current = note.parentId;
  }
  return chain;
}

/** How many levels are below `id` (0 for a note with no sub-notes), given each note's `depth`. */
export function subtreeHeight(
  notes: readonly (Pick<TreeNote, "id" | "parentId"> & { depth: number })[],
  id: string,
): number {
  const self = notes.find((n) => n.id === id);
  if (!self) return 0;
  const below = new Set(descendantIds(notes, id));
  let deepest = self.depth;
  for (const note of notes) if (below.has(note.id)) deepest = Math.max(deepest, note.depth);
  return deepest - self.depth;
}

/** Whether moving `id` under `newParentId` would put it inside its own subtree. */
export function wouldCycle(
  notes: readonly Pick<TreeNote, "id" | "parentId">[],
  id: string,
  newParentId: string | null,
) {
  if (newParentId === null) return false;
  if (newParentId === id) return true;
  return descendantIds(notes, id).includes(newParentId);
}

export type MoveCheck = { ok: true; depth: number } | { ok: false; reason: string };

/**
 * Whether a note whose own subtree is `height` levels tall may sit under a parent at `parentDepth`
 * (0 for the top level). The note's new depth is returned so descendants can be shifted by the same
 * amount.
 */
export function checkDepth(parentDepth: number, height: number): MoveCheck {
  const depth = parentDepth + 1;
  if (depth + height > MAX_NOTE_DEPTH) return { ok: false, reason: DEPTH_MESSAGE };
  return { ok: true, depth };
}

/** Can a new sub-note be made under a note at `parentDepth`? */
export function canHaveSubNote(parentDepth: number): boolean {
  return parentDepth < MAX_NOTE_DEPTH;
}

/** The sort order for a note placed between two siblings (`above` just before, `below` just after). */
export function siblingOrder(above: number | null, below: number | null) {
  return orderBetween(above, below);
}

/** One part of a breadcrumb. */
export type Crumb = { id: string; title: string; emoji: string | null };

export type CrumbPart = { kind: "note"; crumb: Crumb } | { kind: "more"; hidden: Crumb[] };

/**
 * The ancestors for a breadcrumb. Up to `max` are shown; a longer chain keeps the top-level note
 * and the nearest parents, and folds the middle into one "…" entry that opens a menu.
 */
export function breadcrumbParts(ancestors: readonly Crumb[], max = 3): CrumbPart[] {
  if (ancestors.length <= max) return ancestors.map((crumb) => ({ kind: "note", crumb }));
  const head = ancestors[0]!;
  const tail = ancestors.slice(ancestors.length - (max - 1));
  const hidden = ancestors.slice(1, ancestors.length - (max - 1));
  return [
    { kind: "note", crumb: head },
    { kind: "more", hidden },
    ...tail.map((crumb): CrumbPart => ({ kind: "note", crumb })),
  ];
}

/** "Parent / Child" for search results and pickers. */
export function pathLabel(titles: readonly string[]): string {
  return titles.map((t) => t.trim() || "Untitled").join(" / ");
}

import { describe, expect, it } from "vitest";
import {
  cascadeSet,
  needsTopLevel,
  restoreSet,
  subNoteCount,
  subNotesWord,
  type CascadeRow,
} from "@/lib/notes/cascade";
import type { NoteTreeRow } from "@/lib/notes/dto";
import { canAddSubNote, planDrop, planDropToTop, planReorder, zoneAt } from "@/lib/notes/tree-drop";
import {
  CYCLE_MESSAGE,
  DEPTH_MESSAGE,
  MAX_NOTE_DEPTH,
  ancestorsOf,
  breadcrumbParts,
  buildOutline,
  canHaveSubNote,
  checkDepth,
  descendantIds,
  flattenOutline,
  pathLabel,
  siblingOrder,
  subtreeHeight,
  wouldCycle,
  type TreeNote,
} from "@/lib/notes/tree";

// V2 feature 07: the hierarchy rules, with no database. The server loads a subtree and asks these
// functions what to change.

const note = (id: string, parentId: string | null, sortOrder = 0, title = id): TreeNote => ({
  id,
  parentId,
  title,
  emoji: null,
  sortOrder,
});

describe("outline", () => {
  const notes = [
    note("b", null, 2048),
    note("a", null, 1024),
    note("a2", "a", 2048),
    note("a1", "a", 1024),
    note("a1x", "a1", 0),
  ];

  it("orders siblings by manual order and nests children", () => {
    const outline = buildOutline(notes);
    expect(outline.map((n) => n.id)).toEqual(["a", "b"]);
    expect(outline[0]!.children.map((n) => n.id)).toEqual(["a1", "a2"]);
    expect(outline[0]!.children[0]!.children[0]).toMatchObject({ id: "a1x", level: 3 });
  });

  it("flattens in reading order, honouring which branches are open", () => {
    const outline = buildOutline(notes);
    expect(flattenOutline(outline).map((n) => n.id)).toEqual(["a", "a1", "a1x", "a2", "b"]);
    expect(flattenOutline(outline, (n) => n.id !== "a").map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("shows a note whose parent is not in the list at the top, so none disappears", () => {
    const outline = buildOutline([note("child", "missing-parent"), note("top", null)]);
    expect(outline.map((n) => n.id).sort()).toEqual(["child", "top"]);
  });

  it("does not hang on a loop in bad data", () => {
    const outline = buildOutline([note("x", "y"), note("y", "x")]);
    expect(outline.length).toBeLessThanOrEqual(2);
  });

  it("finds descendants at any depth, never the note itself", () => {
    expect(descendantIds(notes, "a").sort()).toEqual(["a1", "a1x", "a2"]);
    expect(descendantIds(notes, "b")).toEqual([]);
  });

  it("walks up to the ancestors, top-level first", () => {
    const byId = new Map(notes.map((n) => [n.id, n]));
    expect(ancestorsOf(byId, "a1x").map((n) => n.id)).toEqual(["a", "a1"]);
    expect(ancestorsOf(byId, "a")).toEqual([]);
  });
});

describe("depth and moves", () => {
  const rows = [
    { id: "r", parentId: null, depth: 1 },
    { id: "c", parentId: "r", depth: 2 },
    { id: "g", parentId: "c", depth: 3 },
    { id: "other", parentId: null, depth: 1 },
  ];

  it("measures how tall a subtree is", () => {
    expect(subtreeHeight(rows, "r")).toBe(2);
    expect(subtreeHeight(rows, "c")).toBe(1);
    expect(subtreeHeight(rows, "g")).toBe(0);
    expect(subtreeHeight(rows, "missing")).toBe(0);
  });

  it("allows five levels and refuses a sixth, counting the note's own sub-notes", () => {
    expect(MAX_NOTE_DEPTH).toBe(5);
    expect(checkDepth(0, 0)).toEqual({ ok: true, depth: 1 });
    expect(checkDepth(4, 0)).toEqual({ ok: true, depth: 5 });
    expect(checkDepth(5, 0)).toEqual({ ok: false, reason: DEPTH_MESSAGE });
    // A note with two levels below it cannot go under a level-3 parent: it would end at level 6.
    expect(checkDepth(3, 2)).toEqual({ ok: false, reason: DEPTH_MESSAGE });
    expect(checkDepth(2, 2)).toEqual({ ok: true, depth: 3 });
  });

  it("a note at the deepest level cannot have a sub-note", () => {
    expect(canHaveSubNote(4)).toBe(true);
    expect(canHaveSubNote(5)).toBe(false);
  });

  it("detects a move into itself or into its own subtree", () => {
    expect(wouldCycle(rows, "r", "r")).toBe(true);
    expect(wouldCycle(rows, "r", "g")).toBe(true);
    expect(wouldCycle(rows, "c", "g")).toBe(true);
    expect(wouldCycle(rows, "g", "r")).toBe(false);
    expect(wouldCycle(rows, "r", "other")).toBe(false);
    expect(wouldCycle(rows, "r", null)).toBe(false);
  });

  it("places a note between two siblings, or at either end", () => {
    expect(siblingOrder(1024, 2048).order).toBe(1536);
    expect(siblingOrder(null, 1024).order).toBe(0);
    expect(siblingOrder(1024, null).order).toBe(2048);
    expect(siblingOrder(1, 1 + 1e-12).needsRenumber).toBe(true);
  });
});

describe("breadcrumbs and paths", () => {
  const crumb = (id: string) => ({ id, title: id, emoji: null });

  it("shows a short chain in full", () => {
    const parts = breadcrumbParts([crumb("a"), crumb("b")]);
    expect(parts.map((p) => (p.kind === "note" ? p.crumb.id : "…"))).toEqual(["a", "b"]);
  });

  it("folds the middle of a long chain into one entry that keeps what it hides", () => {
    const parts = breadcrumbParts([crumb("a"), crumb("b"), crumb("c"), crumb("d")]);
    expect(parts.map((p) => (p.kind === "note" ? p.crumb.id : "…"))).toEqual(["a", "…", "c", "d"]);
    const more = parts.find((p) => p.kind === "more");
    expect(more && more.kind === "more" ? more.hidden.map((c) => c.id) : []).toEqual(["b"]);
  });

  it("writes a path, naming untitled notes", () => {
    expect(pathLabel(["Work", "", "Plan"])).toBe("Work / Untitled / Plan");
  });
});

describe("which notes Trash and archive reach", () => {
  const row = (
    id: string,
    parentId: string | null,
    state: Partial<Omit<CascadeRow, "id" | "parentId">> = {},
  ): CascadeRow => ({
    id,
    parentId,
    deletedAt: null,
    deletedCascadeId: null,
    archivedAt: null,
    archivedCascadeId: null,
    ...state,
  });
  const trashed = (cascade: string) => ({
    deletedAt: new Date("2026-01-01"),
    deletedCascadeId: cascade,
  });

  // p
  // ├── a
  // │   └── a1
  // └── b
  const tree = [row("p", null), row("a", "p"), row("a1", "a"), row("b", "p")];

  it("trashing a parent takes every live sub-note, at any depth", () => {
    expect(cascadeSet(tree, "p", "deleted").sort()).toEqual(["a", "a1", "b", "p"]);
    expect(cascadeSet(tree, "a", "deleted").sort()).toEqual(["a", "a1"]);
    expect(cascadeSet(tree, "b", "deleted")).toEqual(["b"]);
  });

  it("a sub-note already in Trash keeps its own state", () => {
    const rows = [
      row("p", null),
      row("a", "p", trashed("old")),
      row("a1", "a", trashed("old")),
      row("b", "p"),
    ];
    expect(cascadeSet(rows, "p", "deleted").sort()).toEqual(["b", "p"]);
  });

  it("restoring brings back exactly the notes that went with the parent", () => {
    const rows = [
      row("p", null, trashed("c2")),
      row("a", "p", trashed("c1")), // trashed on its own earlier
      row("a1", "a", trashed("c1")),
      row("b", "p", trashed("c2")),
    ];
    expect(restoreSet(rows, "p", "deleted").sort()).toEqual(["b", "p"]);
    expect(restoreSet(rows, "a", "deleted").sort()).toEqual(["a", "a1"]);
  });

  it("restoring a sub-note alone takes its own subtree and nothing beside it", () => {
    const rows = [
      row("p", null, trashed("c")),
      row("a", "p", trashed("c")),
      row("a1", "a", trashed("c")),
      row("b", "p", trashed("c")),
    ];
    expect(restoreSet(rows, "a", "deleted").sort()).toEqual(["a", "a1"]);
  });

  it("a note with no cascade id (trashed before sub-notes existed) restores alone", () => {
    const rows = [row("p", null, { deletedAt: new Date() }), row("a", "p")];
    expect(restoreSet(rows, "p", "deleted")).toEqual(["p"]);
  });

  it("archiving mirrors trashing, and skips notes that are in Trash", () => {
    const rows = [
      row("p", null),
      row("a", "p"),
      row("gone", "p", trashed("x")),
      row("b", "p", { archivedAt: new Date(), archivedCascadeId: "earlier" }),
    ];
    expect(cascadeSet(rows, "p", "archived").sort()).toEqual(["a", "p"]);
  });

  it("unarchiving restores the set that was archived together", () => {
    const archived = (c: string) => ({ archivedAt: new Date(), archivedCascadeId: c });
    const rows = [
      row("p", null, archived("c2")),
      row("a", "p", archived("c2")),
      row("b", "p", archived("c1")),
    ];
    expect(restoreSet(rows, "p", "archived").sort()).toEqual(["a", "p"]);
  });

  it("asks about top level only when the parent is still in that state", () => {
    expect(needsTopLevel(null)).toBe(false);
    expect(needsTopLevel({ at: null })).toBe(false);
    expect(needsTopLevel({ at: new Date() })).toBe(true);
  });

  it("counts and names the sub-notes that went along", () => {
    expect(subNoteCount(["p", "a", "b"])).toBe(2);
    expect(subNoteCount(["p"])).toBe(0);
    expect(subNotesWord(1)).toBe("1 sub-note");
    expect(subNotesWord(4)).toBe("4 sub-notes");
  });
});

describe("dragging a note in a tree", () => {
  // top1 (depth 1): a (2) → a1 (3); b (2)
  // top2 (depth 1)
  const row = (
    id: string,
    parentId: string | null,
    depth: number,
    sortOrder: number,
  ): NoteTreeRow => ({
    id,
    parentId,
    title: id,
    emoji: null,
    sortOrder,
    depth,
  });
  const rows = [
    row("top1", null, 1, 0),
    row("a", "top1", 2, 0),
    row("a1", "a", 3, 0),
    row("b", "top1", 2, 1024),
    row("top2", null, 1, 1024),
  ];

  it("works out which part of a row the pointer is on", () => {
    expect(zoneAt(100, 100, 32)).toBe("before");
    expect(zoneAt(116, 100, 32)).toBe("inside");
    expect(zoneAt(130, 100, 32)).toBe("after");
    expect(zoneAt(5, 0, 0)).toBe("inside");
  });

  it("dropping onto a row makes the note its sub-note", () => {
    expect(planDrop(rows, "top2", "b", "inside")).toEqual({
      ok: true,
      parentId: "b",
      beforeId: null,
      afterId: null,
    });
  });

  it("dropping above or below a row puts the note beside it, with its neighbours named", () => {
    expect(planDrop(rows, "top2", "b", "before")).toEqual({
      ok: true,
      parentId: "top1",
      beforeId: "a",
      afterId: "b",
    });
    expect(planDrop(rows, "top2", "a", "after")).toEqual({
      ok: true,
      parentId: "top1",
      beforeId: "a",
      afterId: "b",
    });
    expect(planDrop(rows, "top2", "top1", "before")).toEqual({
      ok: true,
      parentId: null,
      beforeId: null,
      afterId: "top1",
    });
  });

  it("refuses a drop into itself or into its own sub-notes, with the same message as the server", () => {
    expect(planDrop(rows, "top1", "a1", "inside")).toEqual({ ok: false, reason: CYCLE_MESSAGE });
    // Beside its own child is still inside itself.
    expect(planDrop(rows, "top1", "a", "before")).toEqual({ ok: false, reason: CYCLE_MESSAGE });
    expect(planDrop(rows, "a", "a1", "inside")).toEqual({ ok: false, reason: CYCLE_MESSAGE });
    expect(planDrop(rows, "top1", "top1", "inside")).toBeNull();
  });

  it("refuses a drop that would end deeper than five levels", () => {
    const deep = [...rows, row("d4", "a1", 4, 0), row("d5", "d4", 5, 0)];
    // top2 under d5 would be level 6.
    expect(planDrop(deep, "top2", "d5", "inside")).toEqual({ ok: false, reason: DEPTH_MESSAGE });
    // `a` has two levels below it (a1, d4, d5 = three): under b (level 2) it would reach level 6.
    expect(planDrop(deep, "a", "b", "inside")).toEqual({ ok: false, reason: DEPTH_MESSAGE });
  });

  it("dropping below the tree sends a note to the end of the top level", () => {
    expect(planDropToTop(rows, "a")).toEqual({
      ok: true,
      parentId: null,
      beforeId: "top2",
      afterId: null,
    });
  });

  it("Alt+Up and Alt+Down move a note one step among its siblings, and stop at the ends", () => {
    expect(planReorder(rows, "b", "up")).toEqual({
      ok: true,
      parentId: "top1",
      beforeId: null,
      afterId: "a",
    });
    expect(planReorder(rows, "a", "down")).toEqual({
      ok: true,
      parentId: "top1",
      beforeId: "b",
      afterId: null,
    });
    expect(planReorder(rows, "a", "up")).toBeNull();
    expect(planReorder(rows, "b", "down")).toBeNull();
    expect(planReorder(rows, "top1", "down")).toMatchObject({ beforeId: "top2" });
  });

  it("a sub-note can be added only above the deepest level", () => {
    expect(canAddSubNote(rows, "a1")).toBe(true);
    expect(canAddSubNote([row("x", null, 5, 0)], "x")).toBe(false);
    expect(canAddSubNote(rows, "missing")).toBe(false);
  });
});

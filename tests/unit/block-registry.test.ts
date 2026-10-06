import { Table2 } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerCoreBlocks } from "@/components/editor/blocks/core-blocks";
import {
  clearBlocks,
  filterBlocks,
  getBlocks,
  registerBlock,
  type BlockItem,
} from "@/components/editor/blocks/registry";
import { DEFAULT_EDITOR_CONTEXT } from "@/components/editor/blocks/context";

const note = { ...DEFAULT_EDITOR_CONTEXT, surface: "note" as const };
const task = { ...DEFAULT_EDITOR_CONTEXT, surface: "task" as const };

const item = (overrides: Partial<BlockItem> & { id: string }): BlockItem => ({
  title: overrides.id,
  keywords: [],
  group: "Basic",
  icon: Table2,
  surfaces: ["note", "task"],
  insert: () => undefined,
  ...overrides,
});

beforeEach(() => clearBlocks());
afterEach(() => clearBlocks());

describe("block registry", () => {
  it("refuses a duplicate id", () => {
    registerBlock(item({ id: "a" }));
    expect(() => registerBlock(item({ id: "a" }))).toThrow(/already registered/);
  });

  it("offers a block only on the surfaces it names, and only when it is available", () => {
    registerBlock(item({ id: "notes-only", surfaces: ["note"] }));
    registerBlock(item({ id: "online-only", available: (ctx) => !ctx.offline }));
    expect(getBlocks(note).map((b) => b.id)).toEqual(["notes-only", "online-only"]);
    expect(getBlocks(task).map((b) => b.id)).toEqual(["online-only"]);
    expect(getBlocks({ ...note, offline: true }).map((b) => b.id)).toEqual(["notes-only"]);
  });

  it("orders by group, then by registration", () => {
    registerBlock(item({ id: "layout-1", group: "Layout" }));
    registerBlock(item({ id: "basic-1", group: "Basic" }));
    registerBlock(item({ id: "layout-2", group: "Layout" }));
    registerBlock(item({ id: "basic-2", group: "Basic" }));
    expect(getBlocks(note).map((b) => b.id)).toEqual([
      "basic-1",
      "basic-2",
      "layout-1",
      "layout-2",
    ]);
  });

  it("lets a later feature add an item without touching the menu code", () => {
    registerCoreBlocks();
    const before = getBlocks(note).length;
    registerBlock(item({ id: "sub-note", title: "Sub-note", group: "Links", surfaces: ["note"] }));
    expect(getBlocks(note)).toHaveLength(before + 1);
    expect(getBlocks(task).some((b) => b.id === "sub-note")).toBe(false);
  });
});

describe("slash filter", () => {
  const list = [
    item({ id: "table", title: "Table", keywords: ["grid", "rows"] }),
    item({ id: "toc", title: "Table of contents", keywords: ["outline"] }),
    item({ id: "h1", title: "Heading 1", keywords: ["title", "h1"] }),
    item({ id: "callout", title: "Callout", keywords: ["note", "info"] }),
  ];

  it("returns everything for an empty query", () => {
    expect(filterBlocks(list, "").map((b) => b.id)).toEqual(["table", "toc", "h1", "callout"]);
  });

  it("matches title start, then word start, then keywords, then contains", () => {
    expect(filterBlocks(list, "tab").map((b) => b.id)).toEqual(["table", "toc"]);
    expect(filterBlocks(list, "cont").map((b) => b.id)).toEqual(["toc"]);
    expect(filterBlocks(list, "grid").map((b) => b.id)).toEqual(["table"]);
    expect(filterBlocks(list, "ead").map((b) => b.id)).toEqual(["h1"]);
  });

  it("is case-insensitive, ignores surrounding spaces and returns nothing for no match", () => {
    expect(filterBlocks(list, " CALL ").map((b) => b.id)).toEqual(["callout"]);
    expect(filterBlocks(list, "zzz")).toEqual([]);
  });

  it("ranks a title match above a keyword match", () => {
    const ranked = filterBlocks(
      [
        item({ id: "x", title: "Other", keywords: ["table"] }),
        item({ id: "table", title: "Table" }),
      ],
      "table",
    );
    expect(ranked.map((b) => b.id)).toEqual(["table", "x"]);
  });
});

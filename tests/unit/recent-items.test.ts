// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetRecentItems,
  MAX_RECENT_ITEMS,
  openParam,
  parseOpenParam,
  pruneRecentItems,
  readRecentItems,
  rememberOpened,
} from "@/lib/search/recent-items";

// The items the person opened last live in this browser only (V2 feature 10 §2).

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => window.localStorage.clear());

describe("recent items store", () => {
  it("lists the newest first and moves a reopened item to the top", () => {
    rememberOpened("note", id(1), 1);
    rememberOpened("task", id(2), 2);
    rememberOpened("note", id(1), 3);
    expect(readRecentItems().map((r) => `${r.type}:${r.id}`)).toEqual([
      `note:${id(1)}`,
      `task:${id(2)}`,
    ]);
  });

  it("keeps at most eight", () => {
    for (let i = 1; i <= MAX_RECENT_ITEMS + 4; i += 1) rememberOpened("task", id(i), i);
    const items = readRecentItems();
    expect(items).toHaveLength(MAX_RECENT_ITEMS);
    expect(items[0]!.id).toBe(id(MAX_RECENT_ITEMS + 4));
  });

  it("ignores malformed storage", () => {
    window.localStorage.setItem("dayboard:recent-items", "{not json");
    expect(readRecentItems()).toEqual([]);
    window.localStorage.setItem(
      "dayboard:recent-items",
      JSON.stringify([{ type: "todo", id: id(1) }, { type: "note", id: "nope" }, 5, null]),
    );
    expect(readRecentItems()).toEqual([]);
  });

  it("drops items the server did not confirm", () => {
    rememberOpened("note", id(1));
    rememberOpened("task", id(2));
    pruneRecentItems([{ type: "task", id: id(2) }]);
    expect(readRecentItems().map((r) => r.id)).toEqual([id(2)]);
  });

  it("stores only types and ids", () => {
    rememberOpened("project", id(3), 7);
    expect(JSON.parse(window.localStorage.getItem("dayboard:recent-items")!)).toEqual([
      { type: "project", id: id(3), openedAt: 7 },
    ]);
  });

  it("forgets everything", () => {
    rememberOpened("note", id(1));
    forgetRecentItems();
    expect(readRecentItems()).toEqual([]);
  });

  it("survives storage that throws", () => {
    const real = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(readRecentItems()).toEqual([]);
      expect(() => rememberOpened("note", id(1))).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: real });
    }
  });
});

describe("open parameter", () => {
  it("round-trips", () => {
    rememberOpened("task", id(1), 1);
    rememberOpened("note", id(2), 2);
    expect(parseOpenParam(openParam(readRecentItems()))).toEqual([
      { type: "note", id: id(2) },
      { type: "task", id: id(1) },
    ]);
  });

  it("ignores malformed refs, unknown types, repeats and extras", () => {
    const many = Array.from({ length: 12 }, (_, i) => `note:${id(i + 1)}`).join(",");
    expect(parseOpenParam(`todo:${id(1)},note:bad,,:,note:${id(1)},note:${id(1)}`)).toEqual([
      { type: "note", id: id(1) },
    ]);
    expect(parseOpenParam(many)).toHaveLength(MAX_RECENT_ITEMS);
    expect(parseOpenParam(null)).toEqual([]);
  });
});

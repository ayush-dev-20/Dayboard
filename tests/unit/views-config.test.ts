import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createViewSchema,
  isViewTypeAllowed,
  readViewConfig,
  updateViewSchema,
  viewConfigSchema,
} from "@/lib/validations/views";
import { defaultConfig, defaultViewSet, newViewStart, readyMadeStarts } from "@/lib/views/defaults";
import { lastViewCookie, parseViewParam, pickView } from "@/lib/views/legacy";
import { quickFilters, withQuickFilters } from "@/lib/views/quick";
import {
  COLLECTIONS,
  MAX_FILTERS,
  MAX_SORTS,
  VIEW_TYPES,
  VIEW_TYPES_BY_COLLECTION,
  type Collection,
  type ViewDTO,
} from "@/lib/views/types";

// V2 feature 06 §8: the view config rules, defaults and URL resolution.

const ID = "00000000-0000-4000-8000-000000000001";
const valid = (collection: Collection, config: unknown) =>
  viewConfigSchema(collection).safeParse(config).success;
const base = () => defaultConfig("TASKS", "TABLE");

describe("viewConfigSchema", () => {
  it("accepts every default config for every collection and type", () => {
    for (const collection of COLLECTIONS) {
      for (const type of VIEW_TYPES) {
        expect(valid(collection, defaultConfig(collection, type)), `${collection} ${type}`).toBe(
          true,
        );
      }
    }
  });

  it("accepts the filter shapes each property type allows", () => {
    const filters = [
      { property: "status", op: "isAnyOf", value: ["PLANNED", "DONE"] },
      { property: "priority", op: "is", value: "HIGH" },
      { property: "project", op: "is", value: ID },
      { property: "project", op: "isEmpty" },
      { property: "tags", op: "isNoneOf", value: [ID] },
      { property: "title", op: "contains", value: "report" },
      { property: "dueDate", op: "before", value: "@today" },
      { property: "dueDate", op: "between", value: ["2026-10-01", "2026-10-31"] },
      { property: "dueDate", op: "inBucket", value: "overdue" },
      { property: "subtasks", op: "after", value: 2 },
      { property: "archived", op: "is", value: true },
    ];
    expect(valid("TASKS", { ...base(), filters })).toBe(true);
  });

  it.each([
    ["an unknown property", { property: "colour", op: "is", value: "red" }],
    ["a property of another collection", { property: "done", op: "is", value: true }],
    ["an operator that does not fit", { property: "status", op: "contains", value: "x" }],
    ["inBucket on a text property", { property: "title", op: "inBucket", value: "today" }],
    ["a status that does not exist", { property: "status", op: "is", value: "SOMEDAY" }],
    ["a priority that does not exist", { property: "priority", op: "isAnyOf", value: ["URGENT"] }],
    ["a project that is not an id", { property: "project", op: "is", value: "alpha" }],
    ["a missing value", { property: "status", op: "is" }],
    ["a value on isEmpty", { property: "project", op: "isEmpty", value: "x" }],
    ["a bad bucket", { property: "dueDate", op: "inBucket", value: "someday" }],
    ["a bad date", { property: "dueDate", op: "is", value: "2026-13-40" }],
    ["between with one date", { property: "dueDate", op: "between", value: ["2026-10-01"] }],
    ["a number for a text filter", { property: "title", op: "contains", value: 5 }],
    ["text for a number filter", { property: "subtasks", op: "is", value: "two" }],
    ["a string for a boolean", { property: "archived", op: "is", value: "yes" }],
    [
      "too many values",
      { property: "status", op: "isAnyOf", value: Array.from({ length: 51 }, () => "DONE") },
    ],
  ])("refuses %s", (_name, filter) => {
    expect(valid("TASKS", { ...base(), filters: [filter] })).toBe(false);
  });

  it("limits the number of filters and sorts", () => {
    const filter = { property: "title", op: "contains", value: "x" };
    expect(
      valid("TASKS", { ...base(), filters: Array.from({ length: MAX_FILTERS }, () => filter) }),
    ).toBe(true);
    expect(
      valid("TASKS", { ...base(), filters: Array.from({ length: MAX_FILTERS + 1 }, () => filter) }),
    ).toBe(false);
    const sorts = ["title", "status", "priority", "dueDate", "created"].map((property) => ({
      property,
      dir: "asc" as const,
    }));
    expect(valid("TASKS", { ...base(), sorts: sorts.slice(0, MAX_SORTS) })).toBe(true);
    expect(valid("TASKS", { ...base(), sorts: sorts.slice(0, MAX_SORTS + 1) })).toBe(false);
  });

  it("sorts: known sortable properties only, each once", () => {
    expect(valid("TASKS", { ...base(), sorts: [{ property: "archived", dir: "asc" }] })).toBe(
      false,
    );
    expect(valid("TASKS", { ...base(), sorts: [{ property: "nope", dir: "asc" }] })).toBe(false);
    expect(
      valid("TASKS", {
        ...base(),
        sorts: [
          { property: "title", dir: "asc" },
          { property: "title", dir: "desc" },
        ],
      }),
    ).toBe(false);
    expect(valid("TASKS", { ...base(), sorts: [{ property: "title", dir: "up" }] })).toBe(false);
  });

  it("group by: only what the collection offers", () => {
    expect(valid("TASKS", { ...base(), groupBy: "tag" })).toBe(true);
    expect(valid("TASKS", { ...base(), groupBy: "dueList" })).toBe(true);
    expect(valid("TODOS", { ...defaultConfig("TODOS", "TABLE"), groupBy: "priority" })).toBe(false);
    expect(valid("NOTES", { ...defaultConfig("NOTES", "TABLE"), groupBy: "status" })).toBe(false);
    expect(valid("NOTES", { ...defaultConfig("NOTES", "TABLE"), groupBy: "tag" })).toBe(true);
  });

  it("columns must be properties of the collection and cannot be the filter-only one", () => {
    expect(
      valid("TASKS", {
        ...base(),
        visibleProperties: ["title", "status"],
        columnOrder: ["status", "title"],
      }),
    ).toBe(true);
    expect(valid("TASKS", { ...base(), visibleProperties: ["archived"] })).toBe(false);
    expect(valid("TASKS", { ...base(), visibleProperties: ["done"] })).toBe(false);
    expect(valid("TASKS", { ...base(), columnWidths: { title: 300 } })).toBe(true);
    expect(valid("TASKS", { ...base(), columnWidths: { title: 10 } })).toBe(false);
    expect(valid("TASKS", { ...base(), columnWidths: { nope: 200 } })).toBe(false);
  });

  it("notes always open as a page", () => {
    expect(valid("NOTES", { ...defaultConfig("NOTES", "LIST"), openIn: "panel" })).toBe(false);
    expect(valid("TASKS", { ...base(), openIn: "page" })).toBe(true);
  });

  it("refuses keys it does not know", () => {
    expect(valid("TASKS", { ...base(), userId: ID })).toBe(false);
    expect(valid("TASKS", { ...base(), calendar: { mode: "year", showCompleted: false } })).toBe(
      false,
    );
    expect(valid("TASKS", { ...base(), boardColumnOrder: { project: ["not-an-id"] } })).toBe(false);
  });
});

describe("view types", () => {
  it("calendar is for dated things, gallery and tree for notes", () => {
    expect(isViewTypeAllowed("TASKS", "CALENDAR")).toBe(true);
    expect(isViewTypeAllowed("NOTES", "CALENDAR")).toBe(false);
    expect(isViewTypeAllowed("NOTES", "GALLERY")).toBe(true);
    expect(isViewTypeAllowed("TASKS", "GALLERY")).toBe(false);
  });

  it("Tree is in the vocabulary but not available until feature 07", () => {
    expect(VIEW_TYPES_BY_COLLECTION.NOTES).toContain("TREE");
    expect(isViewTypeAllowed("NOTES", "TREE")).toBe(false);
  });
});

describe("create and update inputs", () => {
  it("checks the config against the collection and the type against the collection", () => {
    const ok = createViewSchema.safeParse({
      collection: "TASKS",
      name: "Board",
      type: "BOARD",
      config: defaultConfig("TASKS", "BOARD"),
    });
    expect(ok.success).toBe(true);
    expect(
      createViewSchema.safeParse({
        collection: "NOTES",
        name: "Cal",
        type: "CALENDAR",
        config: defaultConfig("NOTES", "LIST"),
      }).success,
    ).toBe(false);
    expect(
      createViewSchema.safeParse({
        collection: "TASKS",
        name: "x",
        type: "LIST",
        config: { filters: "all" },
      }).success,
    ).toBe(false);
  });

  it("names are 1 to 60 characters, emoji a single emoji, and unknown keys are refused", () => {
    const input = (extra: object) => ({
      collection: "TASKS",
      type: "LIST",
      config: defaultConfig("TASKS", "LIST"),
      name: "ok",
      ...extra,
    });
    expect(createViewSchema.safeParse(input({ name: "   " })).success).toBe(false);
    expect(createViewSchema.safeParse(input({ name: "x".repeat(61) })).success).toBe(false);
    expect(createViewSchema.safeParse(input({ emoji: "📋" })).success).toBe(true);
    expect(createViewSchema.safeParse(input({ emoji: "ab" })).success).toBe(false);
    expect(createViewSchema.safeParse(input({ userId: ID })).success).toBe(false);
    expect(updateViewSchema.safeParse({ id: ID, name: "New", userId: ID }).success).toBe(false);
    expect(updateViewSchema.safeParse({ id: ID, name: "New", emoji: null }).success).toBe(true);
  });
});

describe("readViewConfig", () => {
  it("returns a valid config as it is", () => {
    const config = defaultConfig("TASKS", "BOARD");
    expect(readViewConfig("TASKS", "BOARD", config)).toEqual({ config, reset: false });
  });

  it("falls back to the type's default, and says so, when a saved config no longer passes", () => {
    const result = readViewConfig("TASKS", "BOARD", {
      filters: [{ property: "colour", op: "is" }],
    });
    expect(result.reset).toBe(true);
    expect(result.config).toEqual(defaultConfig("TASKS", "BOARD"));
    expect(readViewConfig("TASKS", "TABLE", null).reset).toBe(true);
  });
});

describe("defaults", () => {
  it("every default is a fresh object", () => {
    const a = defaultConfig("TASKS", "LIST");
    a.filters.push({ property: "title", op: "isNotEmpty" });
    expect(defaultConfig("TASKS", "LIST").filters).toEqual([]);
  });

  it("the migration's backfill writes exactly the List defaults", () => {
    const sql = fs.readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "..",
        "drizzle",
        "migrations",
        "0007_collection-views.sql",
      ),
      "utf8",
    );
    for (const { collection, config } of defaultViewSet()) {
      const row = new RegExp(
        `\\('${collection}'::"view_collection", '[^']+', '(\\{.*?\\})'\\)`,
      ).exec(sql);
      expect(row, collection).not.toBeNull();
      expect(JSON.parse(row![1]!), collection).toEqual(config);
    }
  });

  it("a new view starts from the current filters, else from its own defaults", () => {
    const current = [{ property: "tags", op: "is" as const, value: ID }];
    expect(newViewStart("TASKS", "BOARD", current).filters).toEqual(current);
    expect(newViewStart("TASKS", "TABLE", []).filters).toEqual(
      defaultConfig("TASKS", "TABLE").filters,
    );
    // The copy is independent of the original.
    newViewStart("TASKS", "BOARD", current).filters[0]!.value = "x";
    expect(current[0]!.value).toBe(ID);
  });

  it("offers ready-made starts that are real types for the collection", () => {
    for (const collection of COLLECTIONS) {
      for (const start of readyMadeStarts(collection)) {
        expect(isViewTypeAllowed(collection, start.type), `${collection} ${start.id}`).toBe(true);
      }
    }
  });
});

describe("the view parameter", () => {
  const view = (id: string, type: ViewDTO["type"]): ViewDTO => ({
    id,
    collection: "NOTES",
    name: id,
    emoji: null,
    type,
    position: 0,
    config: defaultConfig("NOTES", "LIST"),
    version: 1,
    updatedAt: "2026-10-07T00:00:00Z",
  });
  const list = view(ID, "LIST");
  const gallery = view("00000000-0000-4000-8000-000000000002", "GALLERY");

  it("reads an id, the old switches, and ignores the rest", () => {
    expect(parseViewParam(gallery.id)).toEqual({ kind: "id", id: gallery.id });
    expect(parseViewParam("grid")).toEqual({ kind: "legacy", name: "grid" });
    expect(parseViewParam("todos")).toEqual({ kind: "legacy", name: "todos" });
    expect(parseViewParam(["list", "x"])).toEqual({ kind: "legacy", name: "list" });
    expect(parseViewParam("whatever")).toEqual({ kind: "none" });
    expect(parseViewParam(undefined)).toEqual({ kind: "none" });
  });

  it("picks the named view, else the last one used, else the first", () => {
    const views = [list, gallery];
    expect(pickView(views, parseViewParam(gallery.id), null).view).toBe(gallery);
    expect(pickView(views, { kind: "none" }, gallery.id).view).toBe(gallery);
    expect(pickView(views, { kind: "none" }, null).view).toBe(list);
    // An id that no longer exists, or a last view that was deleted, falls back to the first.
    expect(
      pickView(views, { kind: "id", id: "00000000-0000-4000-8000-0000000000ff" }, null).view,
    ).toBe(list);
    expect(pickView(views, { kind: "none" }, "00000000-0000-4000-8000-0000000000ff").view).toBe(
      list,
    );
  });

  it("legacy grid picks the first Gallery, or asks for one to be made", () => {
    expect(pickView([list, gallery], { kind: "legacy", name: "grid" }, null)).toEqual({
      view: gallery,
      needs: null,
    });
    expect(pickView([list], { kind: "legacy", name: "grid" }, null)).toEqual({
      view: list,
      needs: "gallery",
    });
    expect(pickView([gallery, list], { kind: "legacy", name: "list" }, null).view).toBe(list);
  });

  it("names the remembered-view cookie per collection", () => {
    expect(lastViewCookie("TASKS")).toBe("last_view_tasks");
  });
});

describe("quick filters (the URL chips over a view)", () => {
  it("nothing in the URL adds nothing, and the default status set is no filter", () => {
    expect(quickFilters({})).toEqual([]);
    expect(
      quickFilters({
        statuses: ["INBOX", "PLANNED", "IN_PROGRESS", "WAITING"],
        due: "any",
        archived: false,
      }),
    ).toEqual([]);
  });

  it("maps V1's chips to filters", () => {
    expect(
      quickFilters({
        statuses: ["DONE"],
        due: "overdue",
        archived: true,
        projectId: ID,
        tagId: ID,
      }),
    ).toEqual([
      { property: "status", op: "isAnyOf", value: ["DONE"] },
      { property: "dueDate", op: "inBucket", value: "overdue" },
      { property: "archived", op: "is", value: true },
      { property: "project", op: "is", value: ID },
      { property: "tags", op: "is", value: ID },
    ]);
    expect(quickFilters({ projectId: "none" })).toEqual([{ property: "project", op: "isEmpty" }]);
  });

  it("a quick filter replaces the view's own filter on the same property and keeps the others", () => {
    const config = {
      ...base(),
      filters: [
        { property: "project", op: "is" as const, value: ID },
        { property: "priority", op: "is" as const, value: "HIGH" },
      ],
    };
    const merged = withQuickFilters(config, [{ property: "project", op: "isEmpty" }]);
    expect(merged.filters).toEqual([
      { property: "priority", op: "is", value: "HIGH" },
      { property: "project", op: "isEmpty" },
    ]);
    expect(withQuickFilters(config, [])).toBe(config);
  });
});

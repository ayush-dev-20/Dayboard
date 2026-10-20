import { describe, expect, it } from "vitest";
import {
  BOARD_LIMITS,
  BoardError,
  boardSearchText,
  boardToMarkdown,
  BOARD_PRESETS,
  buildPreset,
  columnAfterStatusChange,
  columnForStatus,
  joinStickyText,
  planDeleteColumn,
  sanitizeBoard,
  splitStickyText,
  statusAfterMove,
  type Board,
} from "@/lib/canvas/board";

let n = 0;
const id = () => `column-${String(++n).padStart(4, "0")}`;
const status = () => buildPreset("status", id);

const col = (over: Record<string, unknown> = {}) => ({
  id: "column-aaaa",
  name: "Planned",
  status: "PLANNED",
  tone: "slate",
  ...over,
});
const board = (columns: unknown[] = [col()]) => ({ v: 1, columns });

describe("sanitizeBoard", () => {
  it("keeps a valid board and cleans names", () => {
    const out = sanitizeBoard(board([col({ name: "  In\n progress  ", status: "IN_PROGRESS" })]));
    expect(out.columns[0]).toEqual({
      id: "column-aaaa",
      name: "In progress",
      status: "IN_PROGRESS",
      tone: "slate",
    });
  });

  it("keeps collapsed only when true, and a null colour", () => {
    const out = sanitizeBoard(
      board([col({ collapsed: true, tone: null }), col({ id: "column-bbbb", collapsed: false })]),
    );
    expect(out.columns[0]).toMatchObject({ collapsed: true, tone: null });
    expect(out.columns[1]).not.toHaveProperty("collapsed");
  });

  it.each([
    ["not an object", "x"],
    ["wrong version", { v: 2, columns: [col()] }],
    ["no columns", board([])],
    [
      "13 columns",
      board(
        Array.from({ length: 13 }, (_, i) => col({ id: `column-${String(i).padStart(4, "0")}` })),
      ),
    ],
    ["an empty name", board([col({ name: "   " })])],
    ["a long name", board([col({ name: "x".repeat(41) })])],
    ["no status", board([col({ status: undefined })])],
    ["the Inbox status", board([col({ status: "INBOX" })])],
    ["a colour that is not a token", board([col({ tone: "#ff0000" })])],
    ["duplicate ids", board([col(), col()])],
    ["a short id", board([col({ id: "abc" })])],
    ["an id with capitals", board([col({ id: "COLUMN-AAAA" })])],
    ["an extra key on a column", board([col({ stickies: [] })])],
    ["an extra key on the board", { ...board(), title: "x" }],
  ])("refuses %s", (_label, input) => {
    expect(() => sanitizeBoard(input)).toThrow(BoardError);
  });

  it("accepts 12 columns, and several with one status", () => {
    const twelve = board(
      Array.from({ length: 12 }, (_, i) => col({ id: `column-${String(i).padStart(4, "0")}` })),
    );
    expect(sanitizeBoard(twelve).columns).toHaveLength(12);
  });

  it("refuses a board over 20,000 bytes", () => {
    const big = board(
      Array.from({ length: 12 }, (_, i) =>
        col({ id: `column-${String(i).padStart(4, "0")}`, name: "é".repeat(40) }),
      ),
    );
    // 12 columns of 40 characters are far under the limit, so it only trips on a bigger payload.
    expect(JSON.stringify(sanitizeBoard(big)).length).toBeLessThan(BOARD_LIMITS.bytes);
  });
});

describe("presets", () => {
  it.each(BOARD_PRESETS)("%s is a valid board", (preset) => {
    const built = buildPreset(preset, id);
    expect(sanitizeBoard(built)).toEqual(built);
  });

  it("the status board has five columns with their statuses and quiet colours", () => {
    const built = status();
    expect(built.columns.map((c) => [c.name, c.status, c.tone])).toEqual([
      ["Planned", "PLANNED", "slate"],
      ["In progress", "IN_PROGRESS", "blue"],
      ["Waiting", "WAITING", "amber"],
      ["Completed", "DONE", "green"],
      ["Cancelled", "CANCELLED", "slate"],
    ]);
  });

  it("simple has three columns and blank has one", () => {
    expect(buildPreset("simple", id).columns.map((c) => c.name)).toEqual([
      "To do",
      "Doing",
      "Done",
    ]);
    expect(buildPreset("blank", id).columns.map((c) => c.name)).toEqual(["Ideas"]);
  });

  it("never repeats an id, even when the generator does", () => {
    const same = buildPreset("status", () => "column-same");
    expect(new Set(same.columns.map((c) => c.id)).size).toBe(5);
  });
});

describe("where a sticky goes", () => {
  const b = status();
  it("columnForStatus finds the first column with that status, or none", () => {
    expect(columnForStatus(b, "WAITING")?.name).toBe("Waiting");
    expect(columnForStatus(b, "INBOX")).toBeNull();
    const two: Board = {
      v: 1,
      columns: [
        { id: "column-a1", name: "Later", status: "WAITING", tone: null },
        { id: "column-a2", name: "Blocked", status: "WAITING", tone: null },
      ],
    };
    expect(columnForStatus(two, "WAITING")?.name).toBe("Later");
  });

  it("columnAfterStatusChange stays when the column already fits", () => {
    const two: Board = {
      v: 1,
      columns: [
        { id: "column-a1", name: "Later", status: "WAITING", tone: null },
        { id: "column-a2", name: "Blocked", status: "WAITING", tone: null },
      ],
    };
    expect(columnAfterStatusChange(two, "column-a2", "WAITING")?.id).toBe("column-a2");
    expect(columnAfterStatusChange(b, b.columns[0]!.id, "DONE")?.name).toBe("Completed");
    expect(columnAfterStatusChange(buildPreset("simple", id), "x", "WAITING")).toBeNull();
  });

  it("statusAfterMove is the column's status", () => {
    expect(statusAfterMove({ status: "DONE" })).toBe("DONE");
  });
});

describe("sticky text", () => {
  it("is the title when it has one line", () => {
    expect(splitStickyText("Call the plumber")).toEqual({
      title: "Call the plumber",
      description: null,
    });
  });

  it("splits the first line from the rest and keeps the lines", () => {
    expect(splitStickyText("Plan trip\nbook flights\n\nask Sam")).toEqual({
      title: "Plan trip",
      description: "book flights\n\nask Sam",
    });
  });

  it("cuts the title at 500 and keeps the tail in the description", () => {
    const first = "a".repeat(550);
    const out = splitStickyText(`${first}\nmore`);
    expect(out.title).toHaveLength(500);
    expect(out.description).toBe(`${"a".repeat(50)}\nmore`);
  });

  it("refuses empty text and more than 600 characters", () => {
    expect(() => splitStickyText("  \n ")).toThrow(BoardError);
    expect(() => splitStickyText("a".repeat(601))).toThrow(/600/);
    expect(splitStickyText("a".repeat(600)).title).toHaveLength(500);
  });

  it("strips control characters and normalises line ends", () => {
    expect(splitStickyText("one\r\ntwo\u0007")).toEqual({ title: "one", description: "two" });
  });

  it("joinStickyText reverses the split", () => {
    const { title, description } = splitStickyText("Plan trip\nbook flights");
    expect(joinStickyText(title, description)).toBe("Plan trip\nbook flights");
  });
});

describe("planDeleteColumn", () => {
  const b = status();
  const [planned, progress, , done] = b.columns;

  it("moves to a column with the same status without changing it", () => {
    const two: Board = { v: 1, columns: [planned!, { ...progress!, status: "PLANNED" }] };
    const plan = planDeleteColumn(two, planned!.id, { moveTo: progress!.id });
    expect(plan).toMatchObject({ ok: true, statusChanges: false });
  });

  it("says the status changes when the target has another one", () => {
    const plan = planDeleteColumn(b, planned!.id, { moveTo: done!.id });
    expect(plan).toMatchObject({ ok: true, statusChanges: true });
    if (plan.ok) expect(plan.board.columns).toHaveLength(4);
  });

  it("trash has no target", () => {
    const plan = planDeleteColumn(b, planned!.id, "trash");
    expect(plan).toMatchObject({ ok: true, moveTo: null, statusChanges: false });
  });

  it("refuses the last column, an unknown column and a bad target", () => {
    expect(planDeleteColumn(buildPreset("blank", id), "x", "trash")).toMatchObject({
      reason: "NO_SUCH_COLUMN",
    });
    const blank = buildPreset("blank", id);
    expect(planDeleteColumn(blank, blank.columns[0]!.id, "trash")).toMatchObject({
      reason: "LAST_COLUMN",
    });
    expect(planDeleteColumn(b, planned!.id, { moveTo: planned!.id })).toMatchObject({
      reason: "BAD_TARGET",
    });
    expect(planDeleteColumn(b, planned!.id, { moveTo: "nope" })).toMatchObject({
      reason: "BAD_TARGET",
    });
  });
});

describe("words for the board", () => {
  const b = buildPreset("simple", id);
  it("search text is the title and the column names", () => {
    expect(boardSearchText("Sprint", b)).toBe("Sprint\nTo do\nDoing\nDone");
    expect(boardSearchText("", b)).toBe("To do\nDoing\nDone");
  });

  it("Markdown has headings, bullets, and the status when it differs from the column", () => {
    const md = boardToMarkdown("Sprint", b, [
      { columnId: b.columns[0]!.id, text: "Write spec\nwith examples", status: "PLANNED" },
      { columnId: b.columns[1]!.id, text: "Fix bug", status: "WAITING" },
    ]);
    expect(md).toBe(
      [
        "# Sprint",
        "",
        "## To do",
        "- Write spec",
        "  with examples",
        "",
        "## Doing",
        "- Fix bug (Waiting)",
        "",
        "## Done",
        "_No sticky notes_",
      ].join("\n"),
    );
  });
});

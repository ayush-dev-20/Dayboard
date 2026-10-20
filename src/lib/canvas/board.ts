import { COLOR_TOKENS, type ColorToken } from "@/lib/colors";
import { STATUS_LABELS, type TaskStatus } from "@/lib/tasks/status";

// A sticky board (V3 feature 01 §13). The board holds only its columns; the sticky notes are task rows (kind STICKY), and
// the column a sticky sits in decides its status. Pure and shared by the browser and the server: `sanitizeBoard` is the one
// way columns reach the database, the same way `sanitizeScene` is for a drawing.

/** The statuses a column may stand for. Inbox is not one: a sticky always belongs to a column on a board. */
export const COLUMN_STATUSES = ["PLANNED", "IN_PROGRESS", "WAITING", "DONE", "CANCELLED"] as const;
export type ColumnStatus = (typeof COLUMN_STATUSES)[number];

export type Column = {
  id: string;
  name: string;
  status: ColumnStatus;
  tone: ColorToken | null;
  collapsed?: boolean;
};
export type Board = { v: 1; columns: Column[] };

export const BOARD_LIMITS = {
  columns: 12,
  columnName: 40,
  bytes: 20_000,
  stickiesPerBoard: 500,
  stickiesPerColumn: 200,
  stickyText: 600,
  stickyTitle: 500,
} as const;

export const COLUMN_ID = /^[a-z0-9-]{8,40}$/;

export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const COLUMN_KEYS = new Set(["id", "name", "status", "tone", "collapsed"]);

/** Plain text for a column name: control characters out, spaces collapsed. */
function cleanName(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

/**
 * Checks columns coming from the browser. Refuses (with a plain message) more than 12 columns or none, an empty or long
 * name, a missing or unknown status (Inbox is not one), a colour that is not one of the eight, a repeated or badly made
 * id, any other key, and a board over 20,000 bytes. Several columns may share a status.
 */
export function sanitizeBoard(input: unknown): Board {
  if (!isRecord(input) || input.v !== 1 || !Array.isArray(input.columns)) {
    throw new BoardError("That board could not be read.");
  }
  if (Object.keys(input).some((k) => k !== "v" && k !== "columns")) {
    throw new BoardError("That board has something we don't keep.");
  }
  if (input.columns.length === 0) throw new BoardError("A board needs at least one column.");
  if (input.columns.length > BOARD_LIMITS.columns) {
    throw new BoardError(`A board can have at most ${BOARD_LIMITS.columns} columns.`);
  }
  const ids = new Set<string>();
  const columns: Column[] = input.columns.map((raw) => {
    if (!isRecord(raw)) throw new BoardError("A column could not be read.");
    if (Object.keys(raw).some((k) => !COLUMN_KEYS.has(k))) {
      throw new BoardError("A column has something we don't keep.");
    }
    const id = raw.id;
    if (typeof id !== "string" || !COLUMN_ID.test(id))
      throw new BoardError("A column has a bad id.");
    if (ids.has(id)) throw new BoardError("Two columns share an id.");
    ids.add(id);
    const name = cleanName(raw.name);
    if (!name) throw new BoardError("Give every column a name.");
    if ([...name].length > BOARD_LIMITS.columnName) {
      throw new BoardError(`Column names can have ${BOARD_LIMITS.columnName} characters at most.`);
    }
    if (!(COLUMN_STATUSES as readonly string[]).includes(raw.status as string)) {
      throw new BoardError("Every column needs a status.");
    }
    const tone = raw.tone ?? null;
    if (tone !== null && !(COLOR_TOKENS as readonly unknown[]).includes(tone)) {
      throw new BoardError("That colour isn't available.");
    }
    if (raw.collapsed !== undefined && typeof raw.collapsed !== "boolean") {
      throw new BoardError("A column could not be read.");
    }
    return {
      id,
      name,
      status: raw.status as ColumnStatus,
      tone: tone as ColorToken | null,
      ...(raw.collapsed ? { collapsed: true } : {}),
    };
  });
  const board: Board = { v: 1, columns };
  if (JSON.stringify(board).length > BOARD_LIMITS.bytes) {
    throw new BoardError("This board is too big to save.");
  }
  return board;
}

// ---- Presets -----------------------------------------------------------------------------------------------------------

export const BOARD_PRESETS = ["status", "simple", "blank"] as const;
export type BoardPreset = (typeof BOARD_PRESETS)[number];

/** The default colour of a column by its status. Red stays rare, so Cancelled is slate. */
export const COLUMN_TONES: Record<ColumnStatus, ColorToken> = {
  PLANNED: "slate",
  IN_PROGRESS: "blue",
  WAITING: "amber",
  DONE: "green",
  CANCELLED: "slate",
};

const PRESET_COLUMNS: Record<BoardPreset, { name: string; status: ColumnStatus }[]> = {
  status: [
    { name: "Planned", status: "PLANNED" },
    { name: "In progress", status: "IN_PROGRESS" },
    { name: "Waiting", status: "WAITING" },
    { name: "Completed", status: "DONE" },
    { name: "Cancelled", status: "CANCELLED" },
  ],
  simple: [
    { name: "To do", status: "PLANNED" },
    { name: "Doing", status: "IN_PROGRESS" },
    { name: "Done", status: "DONE" },
  ],
  blank: [{ name: "Ideas", status: "PLANNED" }],
};

export const PRESET_LABELS: Record<BoardPreset, string> = {
  status: "Status board",
  simple: "Simple",
  blank: "Blank",
};

/** A new column id: lower case letters and digits, long enough to be unique within a board. */
export function newColumnId(random: () => string = () => crypto.randomUUID()): string {
  return random()
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 12)
    .padEnd(8, "0");
}

export function buildPreset(preset: BoardPreset, makeId: () => string = newColumnId): Board {
  const used = new Set<string>();
  return {
    v: 1,
    columns: PRESET_COLUMNS[preset].map(({ name, status }) => {
      const wanted = makeId();
      // A generator that repeats itself still gives each column its own id.
      let id = wanted;
      for (let n = 2; used.has(id); n += 1) id = `${wanted.slice(0, 36)}-${n}`;
      used.add(id);
      return { id, name, status, tone: COLUMN_TONES[status] };
    }),
  };
}

// ---- Small rules -------------------------------------------------------------------------------------------------------

/** The first column that stands for `status`, or null when the board has none. */
export function columnForStatus(board: Board, status: TaskStatus): Column | null {
  return board.columns.find((c) => c.status === status) ?? null;
}

/** Where a sticky goes when its status changed somewhere else: stay if its column already fits, else the first that does. */
export function columnAfterStatusChange(
  board: Board,
  currentColumnId: string,
  status: TaskStatus,
): Column | null {
  const current = board.columns.find((c) => c.id === currentColumnId);
  if (current && current.status === status) return current;
  return columnForStatus(board, status);
}

export const columnById = (board: Board, id: string): Column | null =>
  board.columns.find((c) => c.id === id) ?? null;

/** The status a sticky takes when it lands in `column`. */
export function statusAfterMove(column: Pick<Column, "status">): ColumnStatus {
  return column.status;
}

/** A sticky's text, split the way a task holds it: the first line is the title, the rest the description. */
export function splitStickyText(raw: string): { title: string; description: string | null } {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!text) throw new BoardError("Write something on the sticky note.");
  if ([...text].length > BOARD_LIMITS.stickyText) {
    throw new BoardError(`A sticky note can have ${BOARD_LIMITS.stickyText} characters at most.`);
  }
  const newline = text.indexOf("\n");
  const first = (newline === -1 ? text : text.slice(0, newline)).trim();
  const rest = newline === -1 ? "" : text.slice(newline + 1).trim();
  const title = [...first].slice(0, BOARD_LIMITS.stickyTitle).join("");
  // A first line cut at 500 keeps its tail, so nothing typed is lost.
  const overflow = [...first].slice(BOARD_LIMITS.stickyTitle).join("");
  const description = [overflow, rest].filter(Boolean).join("\n");
  return { title, description: description || null };
}

/** The sticky's text again, from the task's title and description. */
export function joinStickyText(title: string, description: string | null): string {
  return description ? `${title}\n${description}` : title;
}

// ---- Deleting a column ------------------------------------------------------------------------------------------------

export type DeleteColumnPlan =
  | { ok: false; reason: "LAST_COLUMN" | "NO_SUCH_COLUMN" | "BAD_TARGET" }
  | {
      ok: true;
      board: Board;
      /** Where the stickies go, or null when they go to Trash. */
      moveTo: Column | null;
      /** True when the target has another status, so the stickies' status changes with the move. */
      statusChanges: boolean;
    };

/** What deleting a column does: the board without it, and where its stickies go. The last column cannot be deleted. */
export function planDeleteColumn(
  board: Board,
  columnId: string,
  target: { moveTo: string } | "trash",
): DeleteColumnPlan {
  const column = columnById(board, columnId);
  if (!column) return { ok: false, reason: "NO_SUCH_COLUMN" };
  if (board.columns.length <= 1) return { ok: false, reason: "LAST_COLUMN" };
  const remaining = { v: 1 as const, columns: board.columns.filter((c) => c.id !== columnId) };
  if (target === "trash") return { ok: true, board: remaining, moveTo: null, statusChanges: false };
  const moveTo = columnById(remaining, target.moveTo);
  if (!moveTo) return { ok: false, reason: "BAD_TARGET" };
  return { ok: true, board: remaining, moveTo, statusChanges: moveTo.status !== column.status };
}

// ---- Words for the board ------------------------------------------------------------------------------------------------

/** The search text of a board: its title and its column names (sticky text is found through the tasks). */
export function boardSearchText(title: string, board: Board): string {
  return [title, ...board.columns.map((c) => c.name)].filter(Boolean).join("\n");
}

/** "Copy as Markdown": columns as headings, stickies as bullets with their status. */
export function boardToMarkdown(
  title: string,
  board: Board,
  stickies: { columnId: string; text: string; status: TaskStatus }[],
): string {
  const lines: string[] = [`# ${title.trim() || "Untitled board"}`];
  for (const column of board.columns) {
    lines.push("", `## ${column.name}`);
    const inColumn = stickies.filter((s) => s.columnId === column.id);
    if (inColumn.length === 0) lines.push("_No sticky notes_");
    for (const s of inColumn) {
      const [first, ...rest] = s.text.split("\n");
      const status = s.status === column.status ? "" : ` (${STATUS_LABELS[s.status]})`;
      lines.push(`- ${first}${status}`);
      for (const more of rest) if (more.trim()) lines.push(`  ${more.trim()}`);
    }
  }
  return lines.join("\n");
}

import type { ColorToken } from "@/lib/colors";
import type { ProjectRef } from "@/lib/projects/dto";
import type { TaskPriority, TaskStatus } from "@/lib/tasks/status";
import type { Board } from "./board";
import type { CanvasKind, Scene } from "./types";

// What the browser gets for a canvas (V3 feature 01 §6). The server builds these; nothing here is trusted back.

export type CanvasListItemDTO = {
  id: string;
  title: string;
  emoji: string | null;
  kind: CanvasKind;
  /** Elements on a drawing. */
  elementCount: number;
  /** Sticky notes on a board (slice D); null for a drawing. */
  stickyCount: number | null;
  project: ProjectRef | null;
  archived: boolean;
  updatedAt: string;
};

export type CanvasDTO = CanvasListItemDTO & {
  version: number;
  scene: Scene;
  createdAt: string;
};

/** A sticky note on a board: a task of its own kind (V3 feature 01 §13). The task holds the truth; the column is where it sits. */
export type StickyDTO = {
  id: string;
  /** The whole text: the task's title, then its description. */
  text: string;
  columnId: string;
  tone: ColorToken | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: string | null;
  sortOrder: number;
  updatedAt: string;
};

/** A sticky board and everything on it. */
export type BoardDTO = CanvasListItemDTO & {
  version: number;
  createdAt: string;
  board: Board;
  stickies: StickyDTO[];
};

/** A row of Today's "Sticky notes" section. */
export type TodayStickyDTO = {
  id: string;
  title: string;
  tone: ColorToken | null;
  status: TaskStatus;
  dueDate: string | null;
  dueTime: string | null;
  boardId: string;
  boardTitle: string;
  boardEmoji: string | null;
};

/** A task shown under a canvas (and a canvas under a task): open ones first. */
export type CanvasTaskDTO = {
  id: string;
  title: string;
  emoji: string | null;
  status: string;
  isDone: boolean;
  dueDate: string | null;
};

/** A canvas shown under a task. */
export type LinkedCanvasDTO = {
  id: string;
  title: string;
  emoji: string | null;
  kind: CanvasKind;
  archived: boolean;
};

/** What a card on the drawing points at, resolved from the person's own items. */
export type CardTargetDTO = {
  type: "note" | "task" | "project";
  id: string;
  title: string;
  emoji: string | null;
  /** The in-app address the card links to. */
  href: string;
};

export type CanvasSaveResult =
  | { outcome: "saved"; version: number; updatedAt: string }
  /** Another window saved first. `version` is the latest on the server. */
  | { outcome: "conflict"; version: number };

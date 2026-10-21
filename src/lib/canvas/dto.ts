import type { ColorToken } from "@/lib/colors";
import type { ProjectRef } from "@/lib/projects/dto";
import type { TaskPriority, TaskStatus } from "@/lib/tasks/status";
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

/** A sticky note's task, as the badges on the drawing and the note toolbar need it. The words and colour are on the drawing. */
export type StickyInfoDTO = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: string | null;
  /** The words as the task holds them (the page puts them on the note when the task was edited elsewhere). */
  text: string;
};

/** A row of Today's "Sticky notes" section. */
export type TodayStickyDTO = {
  id: string;
  title: string;
  tone: ColorToken | null;
  status: TaskStatus;
  dueDate: string | null;
  dueTime: string | null;
  canvasId: string;
  canvasTitle: string;
  canvasEmoji: string | null;
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
  | {
      outcome: "saved";
      version: number;
      updatedAt: string;
      /** Sticky notes given a task of their own because their id belonged to something else (a paste): by element id. */
      remap?: { element: string; id: string }[];
    }
  /** Another window saved first. `version` is the latest on the server. */
  | { outcome: "conflict"; version: number };

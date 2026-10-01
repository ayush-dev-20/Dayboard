import type { TiptapDoc } from "../editor/types";
import { trimTime } from "../dates/calendar";
import type { TaskPriority, TaskStatus } from "./status";

// What crosses from the server to the browser: plain, serialisable values with no Date objects and
// no internals such as user ids.

export type TaskDTO = {
  id: string;
  parentTaskId: string | null;
  title: string;
  emoji: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null; // "HH:MM"
  startDate: string | null;
  startTime: string | null;
  recurrenceRule: string | null;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  subtaskTotal: number;
  subtaskDone: number;
};

export type TaskDetailDTO = TaskDTO & { descriptionJson: TiptapDoc | null; subtasks: TaskDTO[] };

export type TodoDTO = {
  id: string;
  title: string;
  emoji: string | null;
  isComplete: boolean;
  completedAt: string | null;
  dueDate: string | null;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

type TaskRowLike = {
  id: string;
  parentTaskId: string | null;
  title: string;
  emoji: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  startTime: string | null;
  recurrenceRule: string | null;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export function toTaskDTO(row: TaskRowLike, counts?: { total: number; done: number }): TaskDTO {
  return {
    id: row.id,
    parentTaskId: row.parentTaskId,
    title: row.title,
    emoji: row.emoji,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    dueTime: trimTime(row.dueTime),
    startDate: row.startDate,
    startTime: trimTime(row.startTime),
    recurrenceRule: row.recurrenceRule,
    sortOrder: row.sortOrder,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    subtaskTotal: counts?.total ?? 0,
    subtaskDone: counts?.done ?? 0,
  };
}

type TodoRowLike = {
  id: string;
  title: string;
  emoji: string | null;
  isComplete: boolean;
  completedAt: Date | null;
  dueDate: string | null;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toTodoDTO(row: TodoRowLike): TodoDTO {
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    isComplete: row.isComplete,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    dueDate: row.dueDate,
    sortOrder: row.sortOrder,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

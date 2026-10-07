import type { NoteListItemDTO } from "../notes/dto";
import type { TaskDTO, TodoDTO } from "../tasks/dto";
import type { Collection } from "./types";

// The rows views work on: the V1 list DTOs plus the few fields only views need. Nothing here is
// new data: the queries that build them are in `src/db/queries/views.ts`.

/** A task with how many notes are linked to it. */
export type ViewTask = TaskDTO & { noteCount: number };
export type ViewTodo = TodoDTO;
/** A note with its manual order, creation time and linked-task count. */
export type ViewNote = NoteListItemDTO & {
  sortOrder: number;
  createdAt: string;
  taskCount: number;
  /** The version a title edit starts from (a stale save is refused, never overwritten). */
  version: number;
};

export type ItemOf<C extends Collection> = C extends "TASKS"
  ? ViewTask
  : C extends "TODOS"
    ? ViewTodo
    : ViewNote;

export type AnyItem = ViewTask | ViewTodo | ViewNote;

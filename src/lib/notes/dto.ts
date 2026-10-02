import type { ProjectRef } from "../projects/dto";
import type { TagDTO } from "../tags";
import type { TiptapDoc } from "../editor/types";

/** A row in the notes list. Never carries the document itself, only a short snippet. */
export type NoteListItemDTO = {
  id: string;
  title: string;
  emoji: string | null;
  snippet: string;
  updatedAt: string;
  archived: boolean;
  project: ProjectRef | null;
  tags: TagDTO[];
};

export type LinkedTaskDTO = {
  id: string;
  title: string;
  emoji: string | null;
  isDone: boolean;
  dueDate: string | null;
};

export type NoteDTO = {
  id: string;
  title: string;
  emoji: string | null;
  contentJson: TiptapDoc;
  version: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  project: ProjectRef | null;
  tags: TagDTO[];
  /** Linked tasks, open ones first. */
  tasks: LinkedTaskDTO[];
};

export const SNIPPET_LENGTH = 160;

/** The first stretch of a note's text on one line, for the list. */
export function makeSnippet(contentText: string): string {
  const flat = contentText.replace(/\s+/g, " ").trim();
  return flat.length <= SNIPPET_LENGTH ? flat : `${flat.slice(0, SNIPPET_LENGTH).trimEnd()}…`;
}

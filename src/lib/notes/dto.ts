import type { ProjectRef } from "../projects/dto";
import type { TagDTO } from "../tags";
import type { TiptapDoc } from "../editor/types";

/** A row in the notes list. Never carries the document itself, only a short snippet. */
export type NoteListItemDTO = {
  id: string;
  title: string;
  emoji: string | null;
  snippet: string;
  /** The attachment id of the first picture block in the text, for the gallery cover (feature 09). */
  cover?: string | null;
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

/** A note in the tree: just what the sidebar, the Tree view and the Move-to picker need. */
export type NoteTreeRow = {
  id: string;
  parentId: string | null;
  title: string;
  emoji: string | null;
  sortOrder: number;
  /** 1 for a top-level note. */
  depth: number;
};

/** A sub-note of the note being read, for the automatic "Sub-notes" section. */
export type NoteChildDTO = { id: string; title: string; emoji: string | null; archived: boolean };

/** One part of a breadcrumb (an ancestor of the note being read). */
export type NoteCrumbDTO = { id: string; title: string; emoji: string | null };

/** Something that links to a note, for "Linked from". */
export type BacklinkDTO = {
  kind: "note" | "task";
  id: string;
  title: string;
  emoji: string | null;
  snippet: string;
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
  /** The notes this one sits under, top-level first (V2 feature 07). Empty for a top-level note. */
  breadcrumb: NoteCrumbDTO[];
  /** Its sub-notes in manual order, in every state but Trash. */
  children: NoteChildDTO[];
  /** 1 for a top-level note. */
  depth: number;
};

export const SNIPPET_LENGTH = 160;

/** The first stretch of a note's text on one line, for the list. */
export function makeSnippet(contentText: string): string {
  const flat = contentText.replace(/\s+/g, " ").trim();
  return flat.length <= SNIPPET_LENGTH ? flat : `${flat.slice(0, SNIPPET_LENGTH).trimEnd()}…`;
}

// Templates (V3 feature 03). Client-safe constants and shapes.

/** Live templates per person. Over it, a new or duplicated one is `QUOTA_EXCEEDED`. */
export const TEMPLATE_LIMIT = 50;
export const TEMPLATE_NAME_MAX = 120;
export const TITLE_PATTERN_MAX = 300;
export const DEFAULT_TEMPLATE_NAME = "Untitled template";

/** What a person sees of a template in the list and in the picker. */
export type TemplateListItem = {
  id: string;
  name: string;
  emoji: string | null;
  titlePattern: string;
  /** The first line of the text, for the list. */
  preview: string;
  updatedAt: string;
  /** The template that starts new journal entries. */
  isJournal: boolean;
  /** Set on the copy of a starter. */
  starterKey: string | null;
};

export type TemplateDTO = TemplateListItem & {
  contentJson: import("../editor/types").TiptapDoc;
  version: number;
};

export type TemplateSaveResult =
  | { outcome: "saved"; version: number; updatedAt: string }
  /** Someone (another tab) saved first. `version` is the latest on the server. */
  | { outcome: "conflict"; version: number };

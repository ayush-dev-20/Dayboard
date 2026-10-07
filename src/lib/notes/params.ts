const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NotesParams = {
  /** A project id, "none" for notes without one, or null for any. */
  projectId: string | null;
  tagId: string | null;
  /** A saved view chosen in the URL (`?view=<id>`); the old `?view=grid` is read by `parseNotesView`. */
  viewId?: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Reads the /notes URL. Anything unrecognised falls back to "any" instead of failing. */
export function parseNotesParams(raw: RawParams): NotesParams {
  const project = first(raw.project);
  const tag = first(raw.tag);
  const view = first(raw.view);
  return {
    projectId: project === "none" ? "none" : project && UUID.test(project) ? project : null,
    tagId: tag && UUID.test(tag) ? tag : null,
    viewId: view && UUID.test(view) ? view.toLowerCase() : null,
  };
}

export type NotesView = "list" | "grid";

/** `?view=grid` shows cards; anything else is the list (the default). */
export function parseNotesView(raw: RawParams): NotesView {
  return first(raw.view) === "grid" ? "grid" : "list";
}

export function buildNotesQuery(params: Partial<NotesParams> & { view?: NotesView }): string {
  const q = new URLSearchParams();
  if (params.viewId) q.set("view", params.viewId);
  else if (params.view === "grid") q.set("view", "grid");
  if (params.projectId) q.set("project", params.projectId);
  if (params.tagId) q.set("tag", params.tagId);
  const text = q.toString();
  return text ? `?${text}` : "";
}

export function hasNoteFilters(params: NotesParams): boolean {
  return params.projectId !== null || params.tagId !== null;
}

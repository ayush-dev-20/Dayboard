// Every query that reads the `notes` table, and what it does about journal entries (V3 feature 02 §3).
//
//   plain     lists notes as the Notes collection, so it leaves journal entries out (`plainNotes`, or
//             `journal_date is null` in raw SQL).
//   includes  reaches a note by id, by a link or by search, so entries are part of the answer.
//
// `tests/unit/note-query-classes.test.ts` reads the query files and fails when a function that reads `notes` is not
// listed here, so a new query cannot forget to make the choice.

export type NoteQueryClass = "plain" | "includes";

export const NOTE_QUERY_CLASSES: Record<string, NoteQueryClass> = {
  // The Notes collection.
  "src/db/queries/notes.ts:listNotes": "plain",
  "src/db/queries/notes.ts:countNotes": "plain",
  "src/db/queries/views.ts:listNotesForViews": "plain",
  "src/db/queries/note-tree.ts:getNoteTree": "plain",
  "src/db/queries/note-tree.ts:getOutline": "plain",
  "src/db/queries/onboarding.ts:checklistCounts": "plain",
  "src/lib/review/load.ts:loadFactsInput": "plain",
  // Fed by `listNotes`: Today's "Recently updated notes" and a project page's notes.
  "src/db/queries/today.ts:getTodayData": "plain",
  "src/db/queries/projects.ts:getProjectDetail": "plain",

  // By id, link, relationship or search.
  "src/db/queries/notes.ts:getNote": "includes",
  "src/db/queries/notes.ts:searchNotesForLinking": "includes",
  "src/db/queries/note-tree.ts:ancestorsFor": "includes",
  "src/db/queries/note-tree.ts:getChildren": "includes",
  "src/db/queries/note-tree.ts:getBacklinks": "includes",
  "src/db/queries/note-tree.ts:getNoteMeta": "includes",
  "src/db/queries/note-tree.ts:searchNotesForNoteLink": "includes",
  "src/db/queries/search.ts:searchWorkspace": "includes",
  "src/db/queries/search.ts:searchByIds": "includes",
  "src/db/queries/search.ts:recentItems": "includes",
  "src/db/queries/trash.ts:listTrash": "includes",
  "src/db/queries/trash.ts:trashCounts": "includes",
  "src/db/queries/trash.ts:trashedSubNoteCount": "includes",
  "src/db/queries/tags.ts:listTagsWithUsage": "includes",
  "src/db/queries/tasks.ts:getTaskDetail": "includes",
  "src/db/queries/ai.ts:loadNote": "includes",
  "src/db/queries/ai.ts:loadContextItems": "includes",
  "src/db/queries/assistant.ts:readItem": "includes",
  "src/db/queries/assistant.ts:describeItems": "includes",
  "src/db/queries/assistant.ts:findPickerItems": "includes",
  "src/db/queries/assistant.ts:buildProposal": "includes",
  "src/db/queries/canvases.ts:getCardTarget": "includes",
  "src/lib/search/semantic/store.ts:loadSource": "includes",
  // The journal's own reads select entries on purpose.
  "src/db/queries/journal.ts:listJournalEntries": "includes",
  "src/db/queries/journal.ts:listSidebarEntries": "includes",
  "src/db/queries/journal.ts:getJournalTarget": "includes",
};

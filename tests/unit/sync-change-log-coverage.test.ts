import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// V2 feature 05 §10: every mutation that writes a syncable row must record it in the change log, in the same
// transaction (ADR 0007). This reads the mutation modules and checks each exported function that writes.
// A function that writes but does not log yet must be listed in GAPS, and the list must match exactly, so
// adding a write without logging fails here, and fixing a gap also fails until its entry is removed.

const DIR = path.resolve(__dirname, "../../src/db/mutations");

/** Writers that do not record a change yet. Each is removed when its module is covered (feature 05 slices). */
const GAPS = new Set([
  "assistant.ts:applyProposal",
  // Canvases (V3 feature 01) are server-backed like notes and are not in the sync protocol.
  "canvases.ts:createCanvas",
  "canvases.ts:saveCanvas",
  "canvases.ts:updateCanvasMeta",
  "canvases.ts:archiveCanvas",
  "canvases.ts:deleteCanvas",
  "canvases.ts:restoreCanvas",
  "canvases.ts:permanentlyDeleteCanvas",
  "canvases.ts:linkTaskCanvas",
  "canvases.ts:unlinkTaskCanvas",
  // The journal (V3 feature 02) creates notes that carry a date; notes are not in the sync protocol.
  "journal.ts:createJournalEntry",
  "attachments.ts:createIntent",
  "attachments.ts:finalizeAttachment",
  "attachments.ts:deleteAttachment",
  "inbox.ts:captureInboxItem",
  "inbox.ts:setInboxSuggestion",
  "inbox.ts:updateInboxItem",
  "inbox.ts:setInboxArchived",
  "inbox.ts:deleteInboxItem",
  "inbox.ts:restoreInboxItem",
  "inbox.ts:permanentlyDeleteInboxItem",
  "inbox.ts:convertInboxItem",
  "link-previews.ts:getLinkPreview",
  "link-previews.ts:pruneLinkPreviews",
  "note-links.ts:syncNoteLinks",
  "note-tree.ts:createSubNote",
  "note-tree.ts:moveNote",
  "note-tree.ts:deleteNote",
  "note-tree.ts:restoreNote",
  "note-tree.ts:restoreNoteAsTopLevel",
  "note-tree.ts:archiveNote",
  "note-tree.ts:permanentlyDeleteNote",
  "notes.ts:createNote",
  "notes.ts:saveNoteContent",
  "notes.ts:saveNoteTitle",
  "notes.ts:updateNoteEmoji",
  "notes.ts:linkTaskNote",
  "notes.ts:unlinkTaskNote",
  "notes.ts:reorderNote",
  "projects.ts:createProject",
  "projects.ts:updateProject",
  "projects.ts:deleteProject",
  "projects.ts:restoreProject",
  "projects.ts:permanentlyDeleteProject",
  "projects.ts:assignToProject",
  "tags.ts:createTag",
  "tags.ts:renameTag",
  "tags.ts:setTagColor",
  "tags.ts:deleteTag",
  "tags.ts:setTaskTags",
  "tags.ts:setNoteTags",
  // Writes its task through createTask (logged), but also writes the inbox row and the task-note link.
  "tasks.ts:createTasksBatch",
  "today.ts:setFocusTask",
  "todos.ts:createTodo",
  "todos.ts:updateTodo",
  "todos.ts:setTodoComplete",
  "todos.ts:reorderTodo",
  "todos.ts:archiveTodo",
  "todos.ts:deleteTodo",
  "todos.ts:restoreTodo",
  "todos.ts:permanentlyDeleteTodo",
  "trash.ts:emptyTrash",
  "views.ts:ensureDefaultViews",
  "views.ts:createView",
  "views.ts:updateView",
  "views.ts:reorderView",
  "views.ts:deleteView",
  "views.ts:restoreView",
]);

/** Every exported function in the mutation modules that writes, with whether its body records a change. */
function writers(): { key: string; logs: boolean }[] {
  const found: { key: string; logs: boolean }[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(path.join(DIR, file), "utf8");
    const starts = [...src.matchAll(/^export (?:async )?function /gm)].map((m) => m.index ?? 0);
    starts.forEach((start, i) => {
      const body = src.slice(start, starts[i + 1] ?? src.length);
      const name = /export (?:async )?function (\w+)/.exec(body)?.[1];
      if (!name || !/\.(insert|update|delete)\(/.test(body)) return;
      found.push({ key: `${file}:${name}`, logs: /logTask(Upserts|Deletes)\(/.test(body) });
    });
  }
  return found;
}

describe("the change log covers every mutation that writes (ADR 0007)", () => {
  const all = writers();

  it("finds the mutation modules at all", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it("every writer that does not log is a known gap, and nothing else", () => {
    const unlogged = new Set(all.filter((w) => !w.logs).map((w) => w.key));
    const unexpected = [...unlogged].filter((key) => !GAPS.has(key));
    const fixedButListed = [...GAPS].filter((key) => !unlogged.has(key));
    expect(unexpected, "new writes that do not log a change").toEqual([]);
    expect(fixedButListed, "gaps that now log: remove them from GAPS").toEqual([]);
  });

  it("the task mutations are all covered except the batch's inbox and link writes", () => {
    const tasksWriters = all.filter((w) => w.key.startsWith("tasks.ts:"));
    const uncovered = tasksWriters.filter((w) => !w.logs).map((w) => w.key);
    expect(uncovered).toEqual(["tasks.ts:createTasksBatch"]);
  });
});

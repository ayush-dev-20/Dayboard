import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// V3 feature 04 §10: every action that targets a task, todo, note or project says whose rows it works on. It either
// asks the access check (`ownerFor`, `ownerForNew`, `requireOwner`) or is listed here as personal on purpose, with the reason.

const ROOT = path.resolve(__dirname, "../..");
const FILES = ["tasks", "todos", "notes", "projects"];

const PERSONAL: Record<string, string> = {
  "tasks.ts:createTasksBatch":
    "AI previews create the person's own tasks; a collaborator cannot batch-create",
  "tasks.ts:restoreTask": "restore is the owner's (Trash is personal)",
  "tasks.ts:permanentlyDeleteTask": "owner only",
  "todos.ts:restoreTodo": "restore is the owner's (Trash is personal)",
  "todos.ts:permanentlyDeleteTodo": "owner only",
  "notes.ts:restoreNote": "restore is the owner's (Trash is personal)",
  "notes.ts:restoreNoteAsTopLevel": "restore is the owner's",
  "notes.ts:permanentlyDeleteNote": "owner only",
  "notes.ts:createLinkedNoteForTask": "links the person's own task to a new note of theirs",
  "notes.ts:getNoteMetas":
    "titles of the person's own notes (links); a link to a note that is not theirs reveals nothing",
  "notes.ts:findNotesForLink": "the picker lists the person's own notes",
  "notes.ts:loadBacklinks": "backlinks may sit in notes nobody shared: the owner's own",
  "notes.ts:loadBacklinkCount": "same",
  "notes.ts:loadNoteOutline": "the person's own tree",
  "notes.ts:linkTaskNote": "both sides must be the person's own (guards.ts)",
  "notes.ts:unlinkTaskNote": "both sides must be the person's own",
  "notes.ts:findNotesToLink": "the person's own notes",
  "notes.ts:findTasksToLink": "the person's own tasks",
  "notes.ts:loadNoteTree": "the person's own sidebar tree",
  "projects.ts:createProject": "a new project is the person's own",
  "projects.ts:restoreProject": "restore is the owner's",
  "projects.ts:permanentlyDeleteProject": "owner only",
  "projects.ts:assignToProject":
    "moving between projects is the owner's (confirmation flow in feature 04 slice B)",
};

const CHECKS = /\b(ownerFor|ownerForNew|requireOwner|readAccessFor|requireAccess)\(/;

describe("actions that target projects, tasks, todos or notes", () => {
  for (const file of FILES) {
    const source = readFileSync(path.join(ROOT, `src/actions/${file}.ts`), "utf8");
    const parts = source
      .split(/^(?=export async function )/m)
      .filter((p) => p.startsWith("export"));
    for (const part of parts) {
      const name = /^export async function (\w+)/.exec(part)![1]!;
      it(`${file}:${name} asks who owns the rows or is personal on purpose`, () => {
        const key = `${file}.ts:${name}`;
        if (key in PERSONAL) {
          expect(CHECKS.test(part), `${key} is listed as personal but checks access`).toBe(false);
        } else {
          expect(
            CHECKS.test(part),
            `${key} must call ownerFor/requireOwner, or be listed with a reason`,
          ).toBe(true);
        }
      });
    }
  }
});

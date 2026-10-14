import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createNote } from "@/db/mutations/notes";
import { deleteNote } from "@/db/mutations/note-tree";
import { createTask, deleteTask } from "@/db/mutations/tasks";
import { createTodo, deleteTodo } from "@/db/mutations/todos";
import { auditLog, voiceCaptures } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { textToDoc } from "@/lib/inbox/convert";
import { logger } from "@/lib/logger";
import { getPreferences } from "@/lib/preferences";
import { getStorage } from "@/lib/storage";
import type { ConfirmVoiceInput, UndoVoiceInput } from "@/lib/validations/voice";
import { keepRecording } from "./keep";
import { summaryOf } from "./summary";

// The confirm step (V2 feature 13 §6): what the person ticked and edited becomes real tasks, todos and
// notes, in one all-or-nothing step, through the same mutations as everything else. Nothing is created
// before this, and what is created is the reviewed input, never the model's answer. One `audit_log` row
// records counts only. Then the transcript, the parsed result and (unless kept) the recording go.
//
// This is a server step rather than device commands (the spec's wording): only tasks have offline
// commands so far, review needs the server anyway, and one transaction is simpler to undo and audit.
// Feature 11's "apply a proposal" works the same way.

export type VoiceCreated = {
  tasks: string[];
  todos: string[];
  notes: string[];
  /** Whether the recording was attached (null when it was not asked for). */
  kept: boolean | null;
};

export async function confirmVoiceCapture(
  userId: string,
  input: ConfirmVoiceInput,
): Promise<VoiceCreated> {
  const prefs = await getPreferences(userId);
  const proposalId = `voice:${input.captureId}`;

  const created = await db.transaction(async (tx) => {
    // Lock the row: two confirms at once (a double click, a second tab) cannot both create.
    const [capture] = await tx
      .select()
      .from(voiceCaptures)
      .where(and(eq(voiceCaptures.id, input.captureId), eq(voiceCaptures.userId, userId)))
      .for("update")
      .limit(1);
    if (!capture) throw new AppError("NOT_FOUND");
    if (capture.status !== "READY") {
      throw new AppError("CONFLICT", "That recording was already used.");
    }

    const [claim] = await tx
      .insert(auditLog)
      .values({
        userId,
        source: "VOICE",
        action: "voice.create",
        entityRefs: [],
        proposalId,
        summary: "Creating from a voice capture",
      })
      .onConflictDoNothing()
      .returning({ id: auditLog.id });
    if (!claim) throw new AppError("CONFLICT", "That recording was already used.");

    const out = { tasks: [] as string[], todos: [] as string[], notes: [] as string[] };
    for (const item of input.items) {
      if (item.kind === "TASK") {
        const task = await createTask(
          userId,
          {
            title: item.title,
            projectId: item.projectId ?? null,
            dueDate: item.dueDate ?? null,
            ...(item.priority && item.priority !== "NONE" ? { priority: item.priority } : {}),
          },
          { priority: prefs.defaultTaskPriority },
          tx,
        );
        out.tasks.push(task.id);
      } else if (item.kind === "TODO") {
        const todo = await createTodo(
          userId,
          {
            title: item.title.slice(0, 300),
            projectId: item.projectId ?? null,
            dueDate: item.dueDate ?? null,
          },
          tx,
        );
        out.todos.push(todo.id);
      } else {
        const note = await createNote(
          userId,
          {
            title: item.title,
            projectId: item.projectId ?? null,
            contentJson: textToDoc(item.body?.trim() || item.title),
          },
          tx,
        );
        out.notes.push(note.id);
      }
    }
    if (input.transcriptNote) {
      const note = await createNote(
        userId,
        { title: input.transcriptNote.title, contentJson: textToDoc(input.transcriptNote.text) },
        tx,
      );
      out.notes.push(note.id);
    }

    await tx
      .update(auditLog)
      .set({
        entityRefs: [
          ...out.tasks.map((id) => ({ type: "TASK", id })),
          ...out.todos.map((id) => ({ type: "TODO", id })),
          ...out.notes.map((id) => ({ type: "NOTE", id })),
        ],
        summary: summaryOf({
          tasks: out.tasks.length,
          todos: out.todos.length,
          notes: out.notes.length,
        }),
      })
      .where(eq(auditLog.id, claim.id));

    // Consumed: the words are gone from here on. The recording goes after this commits.
    await tx
      .update(voiceCaptures)
      .set({
        status: "CONSUMED",
        transcript: null,
        parsed: null,
        keepAudio: input.keepAudio,
        errorCode: null,
      })
      .where(eq(voiceCaptures.id, capture.id));
    return { ...out, capture };
  });

  // The recording: attached to the first note, else the first task, when asked; deleted either way.
  let kept: boolean | null = null;
  const { capture, ...ids } = created;
  if (input.keepAudio) {
    const target = ids.notes[0]
      ? ({ ownerType: "NOTE", ownerId: ids.notes[0] } as const)
      : ids.tasks[0]
        ? ({ ownerType: "TASK", ownerId: ids.tasks[0] } as const)
        : null;
    kept = target ? await keepRecording(userId, capture, target) : false;
  }
  const storage = getStorage();
  if (capture.storageKey && storage) {
    try {
      await storage.delete(capture.storageKey);
      await db
        .update(voiceCaptures)
        .set({ storageKey: null })
        .where(eq(voiceCaptures.id, capture.id));
    } catch (error) {
      // The row stays CONSUMED with its key, so the hourly cleanup tries again.
      logger.warn("could not delete a recording", { captureId: capture.id, error });
    }
  }
  return { ...ids, kept };
}

/** Undo: the items just created go to Trash (the person can still restore them from there). */
export async function undoVoiceCreate(userId: string, input: UndoVoiceInput): Promise<number> {
  let removed = 0;
  const each = async (ids: string[], remove: (id: string) => Promise<unknown>) => {
    for (const id of ids) {
      try {
        await remove(id);
        removed += 1;
      } catch (error) {
        if (!(error instanceof AppError && error.code === "NOT_FOUND")) throw error;
      }
    }
  };
  await each(input.tasks, (id) => deleteTask(userId, id));
  await each(input.todos, (id) => deleteTodo(userId, id));
  await each(input.notes, (id) => deleteNote(userId, id));
  return removed;
}

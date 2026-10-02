import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { assertOwnedNote, assertOwnedTags, assertOwnedTask } from "@/db/mutations/guards";
import { noteTags, tags, taskTags } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { normalizeTagName, type TagDTO } from "@/lib/tags";
import type { ColorToken } from "@/lib/colors";

// Tags belong to one person. They don't go to Trash: deleting one is final (after a confirmation in
// the UI) and its links to tasks and notes go with it, while the tasks and notes stay.

const pick = { id: tags.id, name: tags.name, color: tags.color };

/** Creates a tag, or returns the existing one with the same normalized name (so it is safe to repeat). */
export async function createTag(
  userId: string,
  input: { name: string; color?: ColorToken | null },
): Promise<TagDTO> {
  const normalizedName = normalizeTagName(input.name);
  const find = async () => {
    const [row] = await db
      .select(pick)
      .from(tags)
      .where(and(eq(tags.userId, userId), eq(tags.normalizedName, normalizedName)))
      .limit(1);
    return row;
  };

  const existing = await find();
  if (existing) return existing;

  const [created] = await db
    .insert(tags)
    .values({ userId, name: input.name, normalizedName, color: input.color ?? null })
    .onConflictDoNothing()
    .returning(pick);
  // Two requests created it at once: the other one won, so return that one.
  const result = created ?? (await find());
  if (!result) throw new AppError("INTERNAL_ERROR");
  return result;
}

export async function renameTag(userId: string, id: string, name: string): Promise<TagDTO> {
  const normalizedName = normalizeTagName(name);
  const [clash] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.normalizedName, normalizedName), ne(tags.id, id)))
    .limit(1);
  if (clash) {
    throw new AppError("CONFLICT", "A tag with that name already exists.", {
      fieldErrors: { name: "A tag with that name already exists." },
    });
  }
  const [row] = await db
    .update(tags)
    .set({ name, normalizedName })
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .returning(pick);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function setTagColor(
  userId: string,
  id: string,
  color: ColorToken | null,
): Promise<TagDTO> {
  const [row] = await db
    .update(tags)
    .set({ color })
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .returning(pick);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function deleteTag(userId: string, id: string): Promise<void> {
  const [row] = await db
    .delete(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .returning({ id: tags.id });
  if (!row) throw new AppError("NOT_FOUND");
}

async function tagsOf(executor: typeof db, userId: string, ids: string[]): Promise<TagDTO[]> {
  const rows = await executor.select(pick).from(tags).where(eq(tags.userId, userId));
  const wanted = new Set(ids);
  return rows.filter((t) => wanted.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Replaces the whole set of tags on a task in one step. Every tag and the task must be the person's. */
export async function setTaskTags(
  userId: string,
  taskId: string,
  tagIds: string[],
): Promise<TagDTO[]> {
  await db.transaction(async (tx) => {
    await assertOwnedTask(tx, userId, taskId);
    await assertOwnedTags(tx, userId, tagIds);
    await tx.delete(taskTags).where(and(eq(taskTags.taskId, taskId), eq(taskTags.userId, userId)));
    if (tagIds.length > 0) {
      await tx.insert(taskTags).values(tagIds.map((tagId) => ({ taskId, tagId, userId })));
    }
  });
  return tagsOf(db, userId, tagIds);
}

export async function setNoteTags(
  userId: string,
  noteId: string,
  tagIds: string[],
): Promise<TagDTO[]> {
  await db.transaction(async (tx) => {
    await assertOwnedNote(tx, userId, noteId);
    await assertOwnedTags(tx, userId, tagIds);
    await tx.delete(noteTags).where(and(eq(noteTags.noteId, noteId), eq(noteTags.userId, userId)));
    if (tagIds.length > 0) {
      await tx.insert(noteTags).values(tagIds.map((tagId) => ({ noteId, tagId, userId })));
    }
  });
  return tagsOf(db, userId, tagIds);
}

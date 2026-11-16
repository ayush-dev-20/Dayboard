import "server-only";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import type { Executor } from "@/db/executor";
import { notes, projects, resourceGrants } from "@/db/schema";
import { ancestorsOf } from "./access";

// "Who, other than the owner, may edit this note?" (V3 feature 05 §2). The reverse of `resolveAccess`: the grantees with the
// EDITOR role on the note, on a note above it, or on its project. A note is live only while this list is not empty. A
// journal entry, a note in Trash and a note in a project in Trash have none.

export async function noteEditorIds(noteId: string, executor: Executor = db): Promise<string[]> {
  const [note] = await executor
    .select({
      ownerId: notes.userId,
      projectId: notes.projectId,
      deletedAt: notes.deletedAt,
      journalDate: notes.journalDate,
    })
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);
  if (!note || note.deletedAt || note.journalDate) return [];

  const reach: SQL[] = [];
  if (note.projectId) {
    const [project] = await executor
      .select({ deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, note.projectId))
      .limit(1);
    if (project && !project.deletedAt)
      reach.push(
        and(
          eq(resourceGrants.resourceType, "PROJECT"),
          eq(resourceGrants.resourceId, note.projectId),
        )!,
      );
  }
  const chain = await ancestorsOf(executor, noteId);
  reach.push(
    and(eq(resourceGrants.resourceType, "NOTE"), inArray(resourceGrants.resourceId, chain))!,
  );

  const rows = await executor
    .select({ granteeId: resourceGrants.granteeId })
    .from(resourceGrants)
    .where(
      and(
        eq(resourceGrants.role, "EDITOR"),
        eq(resourceGrants.ownerId, note.ownerId),
        or(...reach),
      ),
    );
  return [...new Set(rows.map((r) => r.granteeId))];
}

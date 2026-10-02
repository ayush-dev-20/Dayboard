import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Executor } from "@/db/executor";
import { noteTags, projects, tags, taskTags } from "@/db/schema";
import type { ProjectRef } from "@/lib/projects/dto";
import type { TagDTO } from "@/lib/tags";
import type { RowMeta } from "@/lib/tasks/dto";

// Lists show each row's project and tags. They are fetched in two small batched queries for the
// whole page rather than one per row. A project that is in Trash is left out, so its items read as
// "No project" until it is restored (feature doc §3).

const unique = <T>(values: (T | null | undefined)[]): T[] => [
  ...new Set(values.filter((v): v is T => v != null)),
];

export async function projectRefsFor(
  executor: Executor,
  userId: string,
  projectIds: (string | null | undefined)[],
): Promise<Map<string, ProjectRef>> {
  const ids = unique(projectIds);
  if (ids.length === 0) return new Map();
  const rows = await executor
    .select({
      id: projects.id,
      name: projects.name,
      color: projects.color,
      status: projects.status,
    })
    .from(projects)
    .where(and(eq(projects.userId, userId), inArray(projects.id, ids), isNull(projects.deletedAt)));
  return new Map(rows.map((r) => [r.id, r]));
}

function groupTags(rows: { ownerId: string; id: string; name: string; color: TagDTO["color"] }[]) {
  const map = new Map<string, TagDTO[]>();
  for (const { ownerId, ...tag } of rows) {
    const list = map.get(ownerId) ?? [];
    list.push(tag);
    map.set(ownerId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

export async function tagsForTasks(executor: Executor, userId: string, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, TagDTO[]>();
  const rows = await executor
    .select({ ownerId: taskTags.taskId, id: tags.id, name: tags.name, color: tags.color })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(
      and(eq(taskTags.userId, userId), eq(tags.userId, userId), inArray(taskTags.taskId, taskIds)),
    );
  return groupTags(rows);
}

export async function tagsForNotes(executor: Executor, userId: string, noteIds: string[]) {
  if (noteIds.length === 0) return new Map<string, TagDTO[]>();
  const rows = await executor
    .select({ ownerId: noteTags.noteId, id: tags.id, name: tags.name, color: tags.color })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(
      and(eq(noteTags.userId, userId), eq(tags.userId, userId), inArray(noteTags.noteId, noteIds)),
    );
  return groupTags(rows);
}

/** Project and tags for a batch of task rows, keyed by task id. */
export async function taskMetaFor(
  executor: Executor,
  userId: string,
  rows: { id: string; projectId: string | null }[],
): Promise<Map<string, RowMeta>> {
  const [refs, tagMap] = await Promise.all([
    projectRefsFor(
      executor,
      userId,
      rows.map((r) => r.projectId),
    ),
    tagsForTasks(
      executor,
      userId,
      rows.map((r) => r.id),
    ),
  ]);
  return new Map(
    rows.map((r) => [
      r.id,
      { project: (r.projectId && refs.get(r.projectId)) || null, tags: tagMap.get(r.id) ?? [] },
    ]),
  );
}

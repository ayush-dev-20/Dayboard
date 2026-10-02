import "server-only";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  inboxItems,
  notes,
  projects,
  tasks,
  todos,
  type ConvertedRef,
  type InboxItem,
} from "@/db/schema";
import type { ConvertedLink, InboxItemDTO } from "@/lib/inbox/dto";

const RECENT_DAYS = 7;

function toDTO(row: InboxItem, links: Map<string, ConvertedLink>): InboxItemDTO {
  const refs: ConvertedRef[] = row.convertedRefs ?? [];
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    convertedAt: row.convertedAt ? row.convertedAt.toISOString() : null,
    // Records that have since been deleted are left out rather than linking to nothing.
    converted: refs.flatMap((r) => links.get(`${r.type}:${r.id}`) ?? []),
  };
}

/** The current titles and addresses of what converted items became. */
async function resolveLinks(
  userId: string,
  rows: InboxItem[],
): Promise<Map<string, ConvertedLink>> {
  const wanted: Record<ConvertedRef["type"], string[]> = {
    task: [],
    todo: [],
    note: [],
    project: [],
  };
  for (const row of rows) for (const ref of row.convertedRefs ?? []) wanted[ref.type].push(ref.id);

  const out = new Map<string, ConvertedLink>();
  const add = (type: ConvertedRef["type"], id: string, title: string, href: string) =>
    out.set(`${type}:${id}`, { type, id, title: title || "Untitled", href });

  const [t, d, n, p] = await Promise.all([
    wanted.task.length
      ? db
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(
            and(eq(tasks.userId, userId), isNull(tasks.deletedAt), inArray(tasks.id, wanted.task)),
          )
      : [],
    wanted.todo.length
      ? db
          .select({ id: todos.id, title: todos.title })
          .from(todos)
          .where(
            and(eq(todos.userId, userId), isNull(todos.deletedAt), inArray(todos.id, wanted.todo)),
          )
      : [],
    wanted.note.length
      ? db
          .select({ id: notes.id, title: notes.title })
          .from(notes)
          .where(
            and(eq(notes.userId, userId), isNull(notes.deletedAt), inArray(notes.id, wanted.note)),
          )
      : [],
    wanted.project.length
      ? db
          .select({ id: projects.id, title: projects.name })
          .from(projects)
          .where(
            and(
              eq(projects.userId, userId),
              isNull(projects.deletedAt),
              inArray(projects.id, wanted.project),
            ),
          )
      : [],
  ]);
  for (const r of t) add("task", r.id, r.title, `/tasks/${r.id}`);
  for (const r of d) add("todo", r.id, r.title, "/tasks?view=todos");
  for (const r of n) add("note", r.id, r.title, `/notes/${r.id}`);
  for (const r of p) add("project", r.id, r.title, `/projects/${r.id}`);
  return out;
}

export type InboxData = {
  open: InboxItemDTO[];
  archived: InboxItemDTO[];
  converted: InboxItemDTO[];
};

/** Open items newest first, archived ones, and what was converted in the last 7 days. */
export async function getInbox(userId: string, now: Date = new Date()): Promise<InboxData> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const base = and(eq(inboxItems.userId, userId), isNull(inboxItems.deletedAt));

  const [open, archived, converted] = await Promise.all([
    db
      .select()
      .from(inboxItems)
      .where(and(base, eq(inboxItems.status, "OPEN")))
      .orderBy(desc(inboxItems.createdAt))
      .limit(200),
    db
      .select()
      .from(inboxItems)
      .where(and(base, eq(inboxItems.status, "ARCHIVED")))
      .orderBy(desc(inboxItems.updatedAt))
      .limit(100),
    db
      .select()
      .from(inboxItems)
      .where(and(base, eq(inboxItems.status, "CONVERTED"), gte(inboxItems.convertedAt, since)))
      .orderBy(desc(inboxItems.convertedAt))
      .limit(50),
  ]);
  const links = await resolveLinks(userId, converted);
  const empty = new Map<string, ConvertedLink>();
  return {
    open: open.map((r) => toDTO(r, empty)),
    archived: archived.map((r) => toDTO(r, empty)),
    converted: converted.map((r) => toDTO(r, links)),
  };
}

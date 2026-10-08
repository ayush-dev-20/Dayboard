import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  TRASH_PAGE,
  TRASH_TYPES,
  type TrashCounts,
  type TrashItemDTO,
  type TrashType,
} from "@/lib/trash";

// One place for everything soft-deleted. A task deleted together with its parent travels with it
// (restore brings both back), so only the top of such a group is listed; a subtask deleted on its
// own while its parent is alive is listed itself.
function union(userId: string) {
  return sql`
    select 'task'::text as type, t.id, t.title, t.emoji, t.deleted_at, 0::int as sub_notes, 0::int as descendants from tasks t
      where t.user_id = ${userId} and t.deleted_at is not null
        and (t.parent_task_id is null or not exists (
          select 1 from tasks p where p.id = t.parent_task_id and p.deleted_at is not null))
    union all
    select 'todo', d.id, d.title, d.emoji, d.deleted_at, 0, 0 from todos d
      where d.user_id = ${userId} and d.deleted_at is not null
    union all
    -- A note trashed together with its parent travels with it: only the top of such a group is
    -- listed ("Includes N sub-notes"), and restoring it brings back exactly that group.
    select 'note', n.id, case when n.title = '' then 'Untitled' else n.title end, n.emoji, n.deleted_at,
      case when n.deleted_cascade_id is null then 0 else (
        select count(*)::int - 1 from notes g
        where g.user_id = ${userId} and g.deleted_cascade_id = n.deleted_cascade_id) end,
      (with recursive sub as (
          select id from notes where id = n.id
          union all
          select c.id from notes c join sub s on c.parent_note_id = s.id)
        select count(*)::int - 1 from sub)
      from notes n
      where n.user_id = ${userId} and n.deleted_at is not null
        and (n.parent_note_id is null or n.deleted_cascade_id is null or not exists (
          select 1 from notes p where p.id = n.parent_note_id and p.deleted_at is not null
            and p.deleted_cascade_id = n.deleted_cascade_id))
    union all
    select 'project', p.id, p.name, null, p.deleted_at, 0, 0 from projects p
      where p.user_id = ${userId} and p.deleted_at is not null
    union all
    select 'inbox', i.id, left(split_part(i.text, E'\\n', 1), 200), null, i.deleted_at, 0, 0 from inbox_items i
      where i.user_id = ${userId} and i.deleted_at is not null`;
}

type Row = {
  type: TrashType;
  id: string;
  title: string;
  emoji: string | null;
  deleted_at: Date;
  sub_notes: number;
  descendants: number;
};

export type TrashCursor = { at: string; id: string };

export function parseCursor(raw: string | undefined): TrashCursor | null {
  const [at, id] = (raw ?? "").split("_");
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}

/** Newest deletion first. Returns one more than a page so the caller knows whether there is more. */
export async function listTrash(
  userId: string,
  options: { type?: TrashType | null; cursor?: TrashCursor | null } = {},
): Promise<{ items: TrashItemDTO[]; next: TrashCursor | null }> {
  const typeCond = options.type ? sql`u.type = ${options.type}` : sql`true`;
  const cursorCond = options.cursor
    ? sql`(u.deleted_at, u.id) < (${options.cursor.at}::timestamptz, ${options.cursor.id}::uuid)`
    : sql`true`;

  const rows = (await db.execute(sql`
    select u.type, u.id, u.title, u.emoji, u.deleted_at, u.sub_notes, u.descendants from (${union(userId)}) u
    where ${typeCond} and ${cursorCond}
    order by u.deleted_at desc, u.id desc
    limit ${TRASH_PAGE + 1}`)) as unknown as Row[];

  const page = rows.slice(0, TRASH_PAGE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      type: r.type,
      id: r.id,
      title: r.title,
      emoji: r.emoji,
      deletedAt: new Date(r.deleted_at).toISOString(),
      subNotes: r.sub_notes,
      descendants: r.descendants,
    })),
    next:
      rows.length > TRASH_PAGE && last
        ? { at: new Date(last.deleted_at).toISOString(), id: last.id }
        : null,
  };
}

export async function trashCounts(userId: string): Promise<TrashCounts> {
  const rows = (await db.execute(
    sql`select u.type, count(*)::int as n from (${union(userId)}) u group by u.type`,
  )) as unknown as { type: TrashType; n: number }[];
  const counts = { task: 0, todo: 0, note: 0, project: 0, inbox: 0, total: 0 } as TrashCounts;
  for (const type of TRASH_TYPES) counts[type] = rows.find((r) => r.type === type)?.n ?? 0;
  counts.total = TRASH_TYPES.reduce((sum, t) => sum + counts[t], 0);
  return counts;
}

/**
 * Notes in Trash that are not listed on their own because they went with a parent. The Empty trash
 * confirm adds them to its count, so the number it names is the number that is deleted.
 */
export async function trashedSubNoteCount(userId: string): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(*)::int as n from notes n
    where n.user_id = ${userId} and n.deleted_at is not null and n.parent_note_id is not null
      and n.deleted_cascade_id is not null and exists (
        select 1 from notes p where p.id = n.parent_note_id and p.deleted_at is not null
          and p.deleted_cascade_id = n.deleted_cascade_id)`)) as unknown as { n: number }[];
  return row?.n ?? 0;
}

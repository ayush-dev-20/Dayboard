import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { tags } from "@/db/schema";
import type { TagDTO, TagWithUsageDTO } from "@/lib/tags";

export async function listTags(userId: string): Promise<TagDTO[]> {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(asc(sql`lower(${tags.name})`));
}

// How many live tasks and notes use each tag (the ones in Trash don't count). The outer table is
// spelled out, as in the other correlated subqueries.
export async function listTagsWithUsage(userId: string): Promise<TagWithUsageDTO[]> {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      taskCount: sql<number>`(select count(*)::int from task_tags tt join tasks t on t.id = tt.task_id where tt.tag_id = "tags"."id" and t.deleted_at is null and t.user_id = ${userId})`,
      noteCount: sql<number>`(select count(*)::int from note_tags nt join notes n on n.id = nt.note_id where nt.tag_id = "tags"."id" and n.deleted_at is null and n.user_id = ${userId})`,
    })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(asc(sql`lower(${tags.name})`));
}

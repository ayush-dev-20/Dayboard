import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { ChecklistCounts } from "@/lib/onboarding/checklist";

/** What the checklist is derived from. One round trip, always the caller's own rows. */
export async function checklistCounts(userId: string): Promise<ChecklistCounts> {
  const [row] = await db.execute<{
    inbox: number;
    tasks: number;
    notes: number;
    links: number;
  }>(sql`
    select
      (select count(*)::int from inbox_items where user_id = ${userId} and deleted_at is null) as inbox,
      (select count(*)::int from tasks where user_id = ${userId} and deleted_at is null) as tasks,
      (select count(*)::int from notes where user_id = ${userId} and deleted_at is null) as notes,
      (select count(*)::int from task_notes where user_id = ${userId}) as links`);
  return row ?? { inbox: 0, tasks: 0, notes: 0, links: 0 };
}

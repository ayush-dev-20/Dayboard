import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// Snapshots of live notes (V3 feature 05 §4) are a safety net: the newest 30 per note are kept.
export const SNAPSHOTS_KEPT = 30;

/** Removes snapshots beyond the newest `SNAPSHOTS_KEPT` per note (the daily prune). Returns how many went. */
export async function pruneSnapshots(): Promise<number> {
  const rows = (await db.execute(sql`
    delete from note_snapshots s where s.id in (
      select id from (
        select id, row_number() over (partition by note_id order by created_at desc, id desc) as n from note_snapshots
      ) t where t.n > ${SNAPSHOTS_KEPT}) returning 1`)) as unknown as unknown[];
  return rows.length;
}

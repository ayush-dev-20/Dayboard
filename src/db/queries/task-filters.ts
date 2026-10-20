import { eq } from "drizzle-orm";
import { tasks } from "@/db/schema";

// A sticky note is a task of its own kind (V3 feature 01 §13). Every list, count and view of tasks leaves stickies out
// through `plainTasks`; the places that reach a task by id, by search or by Trash include them. The choice for every
// query that reads `tasks` is written down in `src/lib/tasks/query-classes.ts`, and a test fails when one is missing.

/** Ordinary tasks only: not a sticky note. */
export const plainTasks = eq(tasks.kind, "TASK");

/** Sticky notes only. */
export const stickyTasks = eq(tasks.kind, "STICKY");

/** The same condition for raw SQL, written against an alias or the table name (`t.kind = 'TASK'`). */
export const PLAIN_TASKS_SQL = "kind = 'TASK'";

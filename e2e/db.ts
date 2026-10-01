import postgres from "postgres";
import { E2E_DATABASE_URL } from "./env";

// Direct access to the test database, so tests can assert what really happened to the data.
const sql = postgres(E2E_DATABASE_URL, { max: 2 });

export async function findUser(email: string) {
  const [row] = await sql<{ id: string; email_verified: boolean; name: string }[]>`
    select id, email_verified, name from "user" where lower(email) = lower(${email})`;
  return row ?? null;
}

export async function preferencesFor(userId: string) {
  const [row] = await sql<
    {
      theme: string;
      timezone: string;
      default_task_priority: string;
      start_of_day: string;
      week_start: number;
      ai_enabled: boolean;
      onboarded_at: Date | null;
    }[]
  >`select theme, timezone, default_task_priority, start_of_day, week_start, ai_enabled, onboarded_at
    from user_preferences where user_id = ${userId}`;
  return row ?? null;
}

/** How many rows of each auth/app table still belong to this user. */
export async function rowCountsFor(userId: string) {
  const [row] = await sql<{ users: number; sessions: number; accounts: number; prefs: number }[]>`
    select
      (select count(*)::int from "user" where id = ${userId}) as users,
      (select count(*)::int from session where user_id = ${userId}) as sessions,
      (select count(*)::int from account where user_id = ${userId}) as accounts,
      (select count(*)::int from user_preferences where user_id = ${userId}) as prefs`;
  return row!;
}

/** Makes every session of this user look like it was created `minutes` ago. */
export async function ageSessions(userId: string, minutes: number) {
  await sql`update session set created_at = now() - make_interval(mins => ${minutes}) where user_id = ${userId}`;
}

export async function closeDb() {
  await sql.end();
}

type TaskSeed = {
  title: string;
  status?: "INBOX" | "PLANNED" | "IN_PROGRESS" | "WAITING" | "DONE" | "CANCELLED";
  priority?: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  emoji?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrenceRule?: string | null;
  parentTaskId?: string | null;
  sortOrder?: number;
};

let seedOrder = 0;

/** Inserts a task directly, for tests that need specific dates or states without clicking through the UI. */
export async function insertTask(userId: string, seed: TaskSeed) {
  seedOrder += 1;
  const done = seed.status === "DONE";
  const [row] = await sql<{ id: string }[]>`
    insert into tasks (id, user_id, title, status, priority, emoji, due_date, due_time, recurrence_rule,
                       parent_task_id, completed_at, sort_order)
    values (gen_random_uuid(), ${userId}, ${seed.title}, ${seed.status ?? "PLANNED"}, ${seed.priority ?? "NONE"},
            ${seed.emoji ?? null}, ${seed.dueDate ?? null}, ${seed.dueTime ?? null}, ${seed.recurrenceRule ?? null},
            ${seed.parentTaskId ?? null}, ${done ? sql`now()` : null}, ${seed.sortOrder ?? seedOrder * 1024})
    returning id`;
  return row!.id;
}

export async function taskByTitle(userId: string, title: string) {
  const rows = await sql<
    {
      id: string;
      status: string;
      priority: string;
      emoji: string | null;
      due_date: string | null;
      due_time: string | null;
      recurrence_rule: string | null;
      description_text: string | null;
      description_json: unknown;
      deleted_at: Date | null;
      archived_at: Date | null;
      parent_task_id: string | null;
      completed_at: Date | null;
    }[]
  >`select id, status, priority, emoji, to_char(due_date, 'YYYY-MM-DD') as due_date, due_time::text as due_time,
           recurrence_rule, description_text, description_json, deleted_at, archived_at, parent_task_id, completed_at
    from tasks where user_id = ${userId} and title = ${title} order by created_at`;
  return rows;
}

export async function insertTodo(
  userId: string,
  seed: { title: string; emoji?: string; dueDate?: string; isComplete?: boolean },
) {
  seedOrder += 1;
  const [row] = await sql<{ id: string }[]>`
    insert into todos (id, user_id, title, emoji, due_date, is_complete, completed_at, sort_order)
    values (gen_random_uuid(), ${userId}, ${seed.title}, ${seed.emoji ?? null}, ${seed.dueDate ?? null},
            ${seed.isComplete ?? false}, ${seed.isComplete ? sql`now()` : null}, ${seedOrder * 1024})
    returning id`;
  return row!.id;
}

export async function todoByTitle(userId: string, title: string) {
  const rows = await sql<
    {
      id: string;
      emoji: string | null;
      is_complete: boolean;
      deleted_at: Date | null;
      due_date: string | null;
    }[]
  >`select id, emoji, is_complete, deleted_at, to_char(due_date, 'YYYY-MM-DD') as due_date
    from todos where user_id = ${userId} and title = ${title} order by created_at`;
  return rows;
}

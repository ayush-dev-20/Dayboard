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

// ---- Projects, notes and tags (feature 03) --------------------------------------------------

type ProjectSeed = {
  name: string;
  color?: string;
  status?: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
};

export async function insertProject(userId: string, seed: ProjectSeed) {
  const status = seed.status ?? "ACTIVE";
  const [row] = await sql<{ id: string }[]>`
    insert into projects (id, user_id, name, color, status, archived_at)
    values (gen_random_uuid(), ${userId}, ${seed.name}, ${seed.color ?? "slate"}::color_token, ${status}::project_status,
            ${status === "ARCHIVED" ? sql`now()` : null})
    returning id`;
  return row!.id;
}

export async function projectByName(userId: string, name: string) {
  const [row] = await sql<
    {
      id: string;
      status: string;
      color: string;
      description: string | null;
      deleted_at: Date | null;
    }[]
  >`select id, status::text, color::text, description, deleted_at from projects where user_id = ${userId} and name = ${name} order by created_at`;
  return row ?? null;
}

const docOf = (text: string) => ({
  type: "doc",
  content: text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [],
});

export async function insertNote(
  userId: string,
  seed: {
    title: string;
    text?: string;
    projectId?: string | null;
    emoji?: string;
    archived?: boolean;
  },
) {
  const text = seed.text ?? "";
  const [row] = await sql<{ id: string }[]>`
    insert into notes (id, user_id, title, emoji, project_id, content_json, content_text, archived_at)
    values (gen_random_uuid(), ${userId}, ${seed.title}, ${seed.emoji ?? null}, ${seed.projectId ?? null},
            ${sql.json(docOf(text))}, ${text}, ${seed.archived ? sql`now()` : null})
    returning id`;
  return row!.id;
}

export async function noteByTitle(userId: string, title: string) {
  const [row] = await sql<
    {
      id: string;
      title: string;
      content_text: string;
      content_json: { content?: { type: string }[] };
      version: number;
      emoji: string | null;
      project_id: string | null;
      deleted_at: Date | null;
      archived_at: Date | null;
    }[]
  >`select id, title, content_text, content_json, version, emoji, project_id, deleted_at, archived_at
    from notes where user_id = ${userId} and title = ${title} order by created_at`;
  return row ?? null;
}

export async function notesOf(userId: string) {
  return sql<{ id: string; title: string; content_text: string; version: number }[]>`
    select id, title, content_text, version from notes where user_id = ${userId} and deleted_at is null order by created_at`;
}

/** Simulates another tab or device saving the note: new text, version bumped. */
export async function saveNoteElsewhere(noteId: string, text: string) {
  await sql`update notes set content_json = ${sql.json(docOf(text))}, content_text = ${text},
            version = version + 1, updated_at = now() where id = ${noteId}`;
}

export async function insertTag(userId: string, name: string, color?: string) {
  const [row] = await sql<{ id: string }[]>`
    insert into tags (id, user_id, name, normalized_name, color)
    values (gen_random_uuid(), ${userId}, ${name}, ${name.toLowerCase()}, ${color ?? null}::color_token)
    returning id`;
  return row!.id;
}

export async function tagByName(userId: string, name: string) {
  const [row] = await sql<{ id: string; name: string; color: string | null }[]>`
    select id, name, color::text from tags where user_id = ${userId} and lower(name) = lower(${name})`;
  return row ?? null;
}

export async function tagCount(userId: string) {
  const [row] = await sql<
    { n: number }[]
  >`select count(*)::int n from tags where user_id = ${userId}`;
  return row!.n;
}

export async function tagTask(taskId: string, tagId: string, userId: string) {
  await sql`insert into task_tags (task_id, tag_id, user_id) values (${taskId}, ${tagId}, ${userId})`;
}

export async function tagNote(noteId: string, tagId: string, userId: string) {
  await sql`insert into note_tags (note_id, tag_id, user_id) values (${noteId}, ${tagId}, ${userId})`;
}

export async function tagsOfTask(taskId: string) {
  return sql<{ name: string }[]>`
    select t.name from task_tags tt join tags t on t.id = tt.tag_id where tt.task_id = ${taskId} order by t.name`;
}

export async function setTaskProject(taskId: string, projectId: string | null) {
  await sql`update tasks set project_id = ${projectId} where id = ${taskId}`;
}

export async function linkTaskToNote(taskId: string, noteId: string, userId: string) {
  await sql`insert into task_notes (task_id, note_id, user_id) values (${taskId}, ${noteId}, ${userId})`;
}

export async function linkedNoteIds(taskId: string) {
  const rows = await sql<
    { note_id: string }[]
  >`select note_id from task_notes where task_id = ${taskId}`;
  return rows.map((r) => r.note_id);
}

export async function taskProject(taskId: string) {
  const [row] = await sql<
    { project_id: string | null }[]
  >`select project_id from tasks where id = ${taskId}`;
  return row?.project_id ?? null;
}

export async function todoProject(todoId: string) {
  const [row] = await sql<
    { project_id: string | null }[]
  >`select project_id from todos where id = ${todoId}`;
  return row?.project_id ?? null;
}

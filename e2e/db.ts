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
    /** A sub-note: its parent (the depth follows the parent's) and its place among siblings. */
    parentId?: string | null;
    sortOrder?: number;
  },
) {
  const text = seed.text ?? "";
  const [parent] = seed.parentId
    ? await sql<{ depth: number }[]>`select depth from notes where id = ${seed.parentId}`
    : [];
  const [row] = await sql<{ id: string }[]>`
    insert into notes (id, user_id, title, emoji, project_id, content_json, content_text, archived_at,
                       parent_note_id, depth, sort_order)
    values (gen_random_uuid(), ${userId}, ${seed.title}, ${seed.emoji ?? null}, ${seed.projectId ?? null},
            ${sql.json(docOf(text))}, ${text}, ${seed.archived ? sql`now()` : null},
            ${seed.parentId ?? null}, ${(parent?.depth ?? 0) + 1}, ${seed.sortOrder ?? 0})
    returning id`;
  return row!.id;
}

/** Many top-level notes at once, ordered as given (the first is first in the tree). */
export async function insertManyNotes(userId: string, count: number, prefix = "Bulk note") {
  await sql`
    insert into notes (id, user_id, title, content_json, content_text, sort_order)
    select gen_random_uuid(), ${userId}, ${prefix} || ' ' || lpad(g::text, 3, '0'),
           ${sql.json(docOf(""))}, '', g * 1024
    from generate_series(1, ${count}) g`;
}

/** A note whose text is exactly this document (links and sub-note blocks). */
export async function setNoteDoc(noteId: string, doc: unknown, text = "") {
  await sql`update notes set content_json = ${sql.json(doc as never)}, content_text = ${text},
            version = version + 1 where id = ${noteId}`;
}

export async function noteTreeInfo(noteId: string) {
  const [row] = await sql<
    {
      parent_note_id: string | null;
      depth: number;
      deleted_at: Date | null;
      archived_at: Date | null;
      deleted_cascade_id: string | null;
      content_text: string;
      sort_order: number;
    }[]
  >`select parent_note_id, depth, deleted_at, archived_at, deleted_cascade_id, content_text, sort_order
    from notes where id = ${noteId}`;
  return row ?? null;
}

/** The note's own text blocks and links, from the saved document. */
export async function noteDoc(noteId: string) {
  const [row] = await sql<{ content_json: { content?: unknown[] } }[]>`
    select content_json from notes where id = ${noteId}`;
  return row?.content_json ?? null;
}

export async function backlinkRows(targetNoteId: string) {
  return sql<{ source_type: string; source_id: string; snippet: string }[]>`
    select source_type, source_id, snippet from note_links where target_note_id = ${targetNoteId}`;
}

export async function childNoteIds(parentId: string) {
  const rows = await sql<{ id: string }[]>`
    select id from notes where parent_note_id = ${parentId} and deleted_at is null
    order by sort_order, created_at desc`;
  return rows.map((r) => r.id);
}

/** A note with an exact document, for tests that need specific formatting (a bold list item, a link). */
export async function insertNoteDoc(userId: string, title: string, doc: unknown, text: string) {
  const [row] = await sql<{ id: string }[]>`
    insert into notes (id, user_id, title, content_json, content_text)
    values (gen_random_uuid(), ${userId}, ${title}, ${sql.json(doc as never)}, ${text})
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

// ---- Inbox, Today, Search and Trash (feature 04) --------------------------------------------

export async function insertInboxItem(
  userId: string,
  text: string,
  status: "OPEN" | "ARCHIVED" = "OPEN",
) {
  const [row] = await sql<{ id: string }[]>`
    insert into inbox_items (id, user_id, text, status) values (gen_random_uuid(), ${userId}, ${text}, ${status}::inbox_status)
    returning id`;
  return row!.id;
}

export async function inboxItemsOf(userId: string) {
  return sql<
    {
      id: string;
      text: string;
      status: string;
      deleted_at: Date | null;
      converted_refs: { type: string; id: string }[] | null;
    }[]
  >`
    select id, text, status::text, deleted_at, converted_refs from inbox_items where user_id = ${userId} order by created_at`;
}

export async function focusTaskOf(userId: string) {
  const [row] = await sql<
    { focus_task_id: string | null }[]
  >`select focus_task_id from user_preferences where user_id = ${userId}`;
  return row?.focus_task_id ?? null;
}

type Table = "tasks" | "todos" | "notes" | "projects" | "inbox_items";

/** Moves a row to Trash directly, for tests that need many trashed items without clicking through the UI. */
export async function trashRow(table: Table, id: string) {
  await sql`update ${sql(table)} set deleted_at = now() where id = ${id}`;
}

export async function rowExists(table: Table, id: string) {
  const [row] = await sql<
    { n: number }[]
  >`select count(*)::int n from ${sql(table)} where id = ${id}`;
  return row!.n > 0;
}

export async function taskDeletedAt(id: string) {
  const [row] = await sql<
    { deleted_at: Date | null }[]
  >`select deleted_at from tasks where id = ${id}`;
  return row?.deleted_at ?? null;
}

export async function setTaskDescription(taskId: string, text: string) {
  await sql`update tasks set description_text = ${text} where id = ${taskId}`;
}

export async function tasksCreatedFor(userId: string) {
  return sql<{ id: string; title: string; status: string; due_date: string | null }[]>`
    select id, title, status::text, to_char(due_date, 'YYYY-MM-DD') as due_date from tasks where user_id = ${userId} order by created_at`;
}

// ---- AI assistant (feature 05) ----------------------------------------------------------------

export async function aiUsageOf(userId: string) {
  return sql<{ feature: string; status: string; provider: string }[]>`
    select feature::text, status::text, provider from ai_usage where user_id = ${userId} order by created_at`;
}

/** Fills the per-minute window with `count` successful calls, so the next one is rate-limited. */
export async function fillAiMinute(userId: string, count: number) {
  await sql`
    insert into ai_usage (id, user_id, feature, provider, model, status, prompt_version, created_at)
    select gen_random_uuid(), ${userId}, 'ASK'::ai_feature, 'mock', 'mock', 'SUCCESS'::ai_usage_status, 'ASK_V1',
           now() - make_interval(secs => g)
    from generate_series(1, ${count}) as g`;
}

export async function inboxSuggestionOf(id: string) {
  const [row] = await sql<
    { ai_suggestion: unknown }[]
  >`select ai_suggestion from inbox_items where id = ${id}`;
  return row?.ai_suggestion ?? null;
}

export async function dailySuggestionsOf(userId: string) {
  return sql<{ local_date: string; text: string; refresh_count: number }[]>`
    select local_date::text, text, refresh_count from ai_daily_suggestions where user_id = ${userId}`;
}

export async function taskDescriptionText(taskId: string) {
  const [row] = await sql<{ description_text: string | null }[]>`
    select description_text from tasks where id = ${taskId}`;
  return row?.description_text ?? null;
}

export async function clearDailySuggestions(userId: string) {
  await sql`delete from ai_daily_suggestions where user_id = ${userId}`;
}

/** Switches the person's AI preference without going through Settings. */
export async function setAiEnabled(userId: string, enabled: boolean) {
  await sql`update user_preferences set ai_enabled = ${enabled} where user_id = ${userId}`;
}

// ---- Views (feature 06) ----------------------------------------------------------------------

/** The person's live views of a collection, in tab order, with their saved config. */
export async function viewsOf(userId: string, collection: "TASKS" | "TODOS" | "NOTES") {
  return sql<
    {
      id: string;
      name: string;
      type: string;
      emoji: string | null;
      config: Record<string, unknown>;
    }[]
  >`select id, name, type::text, emoji, config from collection_views
    where user_id = ${userId} and collection = ${collection}::view_collection and deleted_at is null
    order by position`;
}

/** Many tasks at once, for tests of how a long list behaves. */
export async function insertManyTasks(userId: string, count: number, prefix = "Bulk") {
  await sql`
    insert into tasks (id, user_id, title, status, priority, sort_order, due_date)
    select gen_random_uuid(), ${userId}, ${prefix} || ' ' || g, (array['INBOX','PLANNED','IN_PROGRESS','WAITING'])[1 + g % 4]::task_status,
           (array['NONE','LOW','MEDIUM','HIGH'])[1 + g % 4]::task_priority, g * 1024,
           case when g % 3 = 0 then null else current_date + (g % 20) end
    from generate_series(1, ${count}) g`;
}

export async function todoDueDate(todoId: string) {
  const [row] = await sql<
    { d: string | null }[]
  >`select to_char(due_date, 'YYYY-MM-DD') d from todos where id = ${todoId}`;
  return row?.d ?? null;
}

export async function taskDueDate(taskId: string) {
  const [row] = await sql<
    { d: string | null }[]
  >`select to_char(due_date, 'YYYY-MM-DD') d from tasks where id = ${taskId}`;
  return row?.d ?? null;
}

/** Changes made behind the app's back, as another window or device would. */
export async function trashNoteElsewhere(noteId: string) {
  await sql`update notes set deleted_at = now() where id = ${noteId}`;
}

export async function purgeNoteElsewhere(noteId: string) {
  await sql`delete from notes where id = ${noteId}`;
}

/** A backlink row, as the app writes when a document with a link is saved. */
export async function insertBacklink(
  userId: string,
  sourceType: "NOTE" | "TASK",
  sourceId: string,
  targetNoteId: string,
  snippet = "",
) {
  await sql`insert into note_links (source_type, source_id, target_note_id, user_id, snippet)
            values (${sourceType}, ${sourceId}, ${targetNoteId}, ${userId}, ${snippet})`;
}

export async function restoreNoteElsewhere(noteId: string) {
  await sql`update notes set deleted_at = null, deleted_cascade_id = null where id = ${noteId}`;
}

// ---- Files (V2 feature 09) -------------------------------------------------------------------

export async function attachmentsOf(ownerId: string) {
  return sql<
    {
      id: string;
      original_name: string;
      mime_type: string;
      size_bytes: number;
      status: string;
      storage_key: string;
      width: number | null;
      height: number | null;
    }[]
  >`select id, original_name, mime_type, size_bytes, status, storage_key, width, height
    from attachments where owner_id = ${ownerId} order by created_at`;
}

export async function attachmentStatus(id: string) {
  const [row] = await sql<{ status: string }[]>`select status from attachments where id = ${id}`;
  return row?.status ?? null;
}

/** A ready file of this size, so a quota can be filled without uploading. */
export async function insertReadyAttachment(
  userId: string,
  ownerId: string,
  sizeBytes: number,
  ownerType: "NOTE" | "TASK" | "PROJECT" = "NOTE",
) {
  const [row] = await sql<{ id: string }[]>`
    insert into attachments (id, user_id, owner_type, owner_id, storage_key, original_name, mime_type,
                             size_bytes, status, finalized_at)
    values (gen_random_uuid(), ${userId}, ${ownerType}, ${ownerId}, 'e2e/' || gen_random_uuid()::text,
            'filler.pdf', 'application/pdf', ${sizeBytes}, 'READY', now())
    returning id`;
  return row!.id;
}

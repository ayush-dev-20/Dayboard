import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { projects } from "@/db/schema";
import { listNotes } from "@/db/queries/notes";
import { listClosedTasks, listTasks } from "@/db/queries/tasks";
import { listOpenTodos } from "@/db/queries/todos";
import type { NoteListItemDTO } from "@/lib/notes/dto";
import type { ProjectDTO, ProjectRef, ProjectSummaryDTO } from "@/lib/projects/dto";
import { pickerRank } from "@/lib/projects/status";
import type { TaskDTO, TodoDTO } from "@/lib/tasks/dto";

// Progress counts top-level tasks and todos that are neither archived nor deleted. Written with the
// outer table spelled out ("projects"."id"), like the subtask counts in queries/tasks.ts.
const NOT_GONE_TASK = sql`t.user_id = "projects"."user_id" and t.deleted_at is null and t.archived_at is null and t.parent_task_id is null`;
const NOT_GONE_TODO = sql`d.user_id = "projects"."user_id" and d.deleted_at is null and d.archived_at is null`;

const taskTotal = sql<number>`(select count(*)::int from tasks t where t.project_id = "projects"."id" and ${NOT_GONE_TASK})`;
const taskDone = sql<number>`(select count(*)::int from tasks t where t.project_id = "projects"."id" and ${NOT_GONE_TASK} and t.status = 'DONE')`;
const taskCancelled = sql<number>`(select count(*)::int from tasks t where t.project_id = "projects"."id" and ${NOT_GONE_TASK} and t.status = 'CANCELLED')`;
const todoTotal = sql<number>`(select count(*)::int from todos d where d.project_id = "projects"."id" and ${NOT_GONE_TODO})`;
const todoDone = sql<number>`(select count(*)::int from todos d where d.project_id = "projects"."id" and ${NOT_GONE_TODO} and d.is_complete)`;

const baseSelect = {
  project: projects,
  taskTotal,
  taskDone,
  taskCancelled,
  todoTotal,
  todoDone,
};

type CountRow = {
  taskTotal: number;
  taskDone: number;
  taskCancelled: number;
  todoTotal: number;
  todoDone: number;
};

function counts(r: CountRow) {
  const total = r.taskTotal + r.todoTotal;
  const done = r.taskDone + r.todoDone;
  return {
    totalCount: total,
    doneCount: done,
    cancelledCount: r.taskCancelled,
    openCount: Math.max(0, total - done - r.taskCancelled),
  };
}

function toDTO(p: typeof projects.$inferSelect): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    status: p.status,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Every project that isn't in Trash, with its numbers, newest first within a status. */
export async function listProjects(userId: string): Promise<ProjectSummaryDTO[]> {
  const rows = await db
    .select(baseSelect)
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .orderBy(asc(sql`lower(${projects.name})`));
  return rows.map((r) => ({ ...toDTO(r.project), ...counts(r) }));
}

export type NextDueTask = { id: string; title: string; emoji: string | null; dueDate: string };

/**
 * For the project cards: each project's open task with the nearest due date (top-level, not
 * archived or deleted). One query for all projects; owner-scoped like everything else.
 */
export async function nextDueTasks(userId: string): Promise<Map<string, NextDueTask>> {
  const rows = await db.execute<{
    project_id: string;
    id: string;
    title: string;
    emoji: string | null;
    due_date: string;
  }>(sql`
    select distinct on (t.project_id) t.project_id, t.id, t.title, t.emoji, to_char(t.due_date, 'YYYY-MM-DD') as due_date
    from tasks t
    where t.user_id = ${userId} and t.project_id is not null and t.deleted_at is null
      and t.archived_at is null and t.parent_task_id is null and t.due_date is not null
      and t.status not in ('DONE', 'CANCELLED')
    order by t.project_id, t.due_date asc, t.due_time asc nulls last, t.sort_order asc`);
  return new Map(
    [...rows].map((r) => [
      r.project_id,
      { id: r.id, title: r.title, emoji: r.emoji, dueDate: r.due_date },
    ]),
  );
}

/** For pickers: active first, then on hold, then the rest; alphabetical within each. */
export async function listProjectRefs(userId: string): Promise<ProjectRef[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      color: projects.color,
      status: projects.status,
    })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .orderBy(asc(sql`lower(${projects.name})`));
  return rows.sort((a, b) => pickerRank(a.status) - pickerRank(b.status));
}

export type ProjectDetail = {
  project: ProjectSummaryDTO;
  openTasks: TaskDTO[];
  completedTasks: TaskDTO[];
  completedTaskCount: number;
  openTodos: TodoDTO[];
  notes: NoteListItemDTO[];
};

export async function getProjectDetail(userId: string, id: string): Promise<ProjectDetail | null> {
  const [row] = await db
    .select(baseSelect)
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) return null;

  const [openTasks, completedTasks, openTodos, notes] = await Promise.all([
    listTasks(userId, { projectId: id }),
    listClosedTasks(userId, { projectId: id, statuses: ["DONE"], limit: 20 }),
    listOpenTodos(userId, { projectId: id }),
    listNotes(userId, { projectId: id }),
  ]);

  return {
    project: { ...toDTO(row.project), ...counts(row) },
    openTasks,
    completedTasks,
    completedTaskCount: row.taskDone,
    openTodos,
    notes,
  };
}

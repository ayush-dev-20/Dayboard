import "server-only";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import type { Executor } from "@/db/executor";
import { notes, projects, resourceGrants, tasks, todos } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { allowed } from "./policy";
import { highestRole, type Access, type Action, type ResourceType, type Role } from "./types";

// "May this person do this to this item?" (V3 feature 04 §4, docs/decisions/0018). One answer for every read and write.
//
//   resolveAccess   the person's role on one item, and whose row it is. Owner first (the row's own `user_id`), then a
//                   grant on the item, on its project (tasks, todos, notes) or on a note above it. The highest role wins.
//   requireAccess   resolveAccess plus the policy: NOT_FOUND when the person has no access at all (so the existence of an
//                   item is never revealed), UNAUTHORIZED when they can see it but not do that.
//   accessibleWhere a SQL condition for lists, so rows the person may not read are never selected.
//
// Never reachable by a grant, however the item is placed: journal entries (`notes.journal_date`), sticky notes
// (`tasks.kind = 'STICKY'`), and anything in Trash. With sharing off (`SHARING_ENABLED`), only the owner has access, which
// is exactly how the app behaved before this feature.

export type AccessOptions = {
  /** Defaults to `SHARING_ENABLED`. Tests and callers that must not depend on the environment pass it. */
  enabled?: boolean;
};

const sharingOn = (options: AccessOptions) => options.enabled ?? env.sharingEnabled;

type Found = {
  ownerId: string;
  /** The project a grant on the project would reach, when the item is in one (a project is its own). */
  projectId: string | null;
  deleted: boolean;
  /** An item no grant may reach: a journal entry, a sticky note. */
  private: boolean;
  /** For a note: the id, so the chain above it can be read when (and only when) it is needed. */
  noteId: string | null;
};

async function ancestorsOf(executor: Executor, noteId: string): Promise<string[]> {
  const rows = (await executor.execute(sql`
    with recursive up(id, parent_id) as (
      select id, parent_note_id from notes where id = ${noteId}
      union all
      select n.id, n.parent_note_id from notes n join up on n.id = up.parent_id
    )
    select id from up`)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

async function load(executor: Executor, type: ResourceType, id: string): Promise<Found | null> {
  switch (type) {
    case "PROJECT": {
      const [row] = await executor
        .select({ userId: projects.userId, deletedAt: projects.deletedAt })
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);
      return row
        ? {
            ownerId: row.userId,
            projectId: id,
            deleted: row.deletedAt !== null,
            private: false,
            noteId: null,
          }
        : null;
    }
    case "TASK": {
      const [row] = await executor
        .select({
          userId: tasks.userId,
          projectId: tasks.projectId,
          deletedAt: tasks.deletedAt,
          kind: tasks.kind,
        })
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      return row
        ? {
            ownerId: row.userId,
            projectId: row.projectId,
            deleted: row.deletedAt !== null,
            private: row.kind === "STICKY",
            noteId: null,
          }
        : null;
    }
    case "TODO": {
      const [row] = await executor
        .select({ userId: todos.userId, projectId: todos.projectId, deletedAt: todos.deletedAt })
        .from(todos)
        .where(eq(todos.id, id))
        .limit(1);
      return row
        ? {
            ownerId: row.userId,
            projectId: row.projectId,
            deleted: row.deletedAt !== null,
            private: false,
            noteId: null,
          }
        : null;
    }
    case "NOTE": {
      const [row] = await executor
        .select({
          userId: notes.userId,
          projectId: notes.projectId,
          deletedAt: notes.deletedAt,
          journalDate: notes.journalDate,
        })
        .from(notes)
        .where(eq(notes.id, id))
        .limit(1);
      if (!row) return null;
      return {
        ownerId: row.userId,
        projectId: row.projectId,
        deleted: row.deletedAt !== null,
        private: row.journalDate !== null,
        noteId: id,
      };
    }
  }
}

/** The person's role on one item. `{ role: null }` for a missing item and for one they may not know exists. */
export async function resolveAccess(
  actorId: string,
  type: ResourceType,
  id: string,
  options: AccessOptions & { executor?: Executor } = {},
): Promise<Access> {
  const executor = options.executor ?? db;
  const found = await load(executor, type, id);
  if (!found) return { role: null, ownerId: null };
  // The owner is the row's own `user_id`: never stored in a grant, and unaffected by the flag.
  if (found.ownerId === actorId) return { role: "OWNER", ownerId: found.ownerId };
  if (!sharingOn(options) || found.deleted || found.private) return { role: null, ownerId: null };

  const reach: SQL[] = [];
  if (found.projectId) {
    // A project in Trash gives its collaborators nothing.
    const [project] = await executor
      .select({ deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, found.projectId))
      .limit(1);
    if (project && project.deletedAt === null) {
      reach.push(
        and(
          eq(resourceGrants.resourceType, "PROJECT"),
          eq(resourceGrants.resourceId, found.projectId),
        )!,
      );
    }
  }
  if (found.noteId) {
    // The note and every note above it: a grant on a note reaches what is under it, never what is above.
    const chain = await ancestorsOf(executor, found.noteId);
    reach.push(
      and(eq(resourceGrants.resourceType, "NOTE"), inArray(resourceGrants.resourceId, chain))!,
    );
  }
  if (reach.length === 0) return { role: null, ownerId: null };

  const grants = await executor
    .select({ role: resourceGrants.role })
    .from(resourceGrants)
    .where(
      and(
        eq(resourceGrants.granteeId, actorId),
        // A grant made by someone who does not own the item is not a grant.
        eq(resourceGrants.ownerId, found.ownerId),
        or(...reach),
      ),
    );
  const role = highestRole(grants.map((g) => g.role as Role));
  return role ? { role, ownerId: found.ownerId } : { role: null, ownerId: null };
}

/** Whether an answer from `resolveAccess` allows the action. */
export function can(access: Access, type: ResourceType, action: Action): boolean {
  return allowed(access.role, type, action);
}

export const NOT_VISIBLE_MESSAGE = "This isn't available anymore.";
export const READ_ONLY_MESSAGE = "You can view this, but not change it.";

/**
 * The check every command makes: NOT_FOUND when the person has no access at all (identical to a missing id), UNAUTHORIZED
 * when they can see it but not do that. Returns the access, whose `ownerId` is what the command's queries then scope by.
 */
export async function requireAccess(
  actorId: string,
  type: ResourceType,
  id: string,
  action: Action,
  options: AccessOptions & { executor?: Executor } = {},
): Promise<Access & { role: Role; ownerId: string }> {
  const access = await resolveAccess(actorId, type, id, options);
  if (access.role === null || access.ownerId === null)
    throw new AppError("NOT_FOUND", NOT_VISIBLE_MESSAGE);
  if (!can(access, type, action)) throw new AppError("UNAUTHORIZED", READ_ONLY_MESSAGE);
  return { role: access.role, ownerId: access.ownerId };
}

// --- lists ---------------------------------------------------------------------------------------------------------

/** Projects the person has a live grant on. */
const grantedProjects = (actorId: string) =>
  sql`(select g.resource_id from resource_grants g join projects gp on gp.id = g.resource_id
        where g.grantee_id = ${actorId} and g.resource_type = 'PROJECT' and g.owner_id = gp.user_id
          and gp.deleted_at is null)`;

/** Notes the person has a grant on, and every live note under them. */
const grantedNotes = (actorId: string) =>
  sql`(with recursive shared(id) as (
         select g.resource_id from resource_grants g join notes gn on gn.id = g.resource_id
           where g.grantee_id = ${actorId} and g.resource_type = 'NOTE' and g.owner_id = gn.user_id
             and gn.deleted_at is null and gn.journal_date is null
         union
         select c.id from notes c join shared s on c.parent_note_id = s.id
           where c.deleted_at is null and c.journal_date is null
       ) select id from shared)`;

/**
 * A condition for a list query: the person's own rows, and (with sharing on) the live rows they may read through a grant.
 * Rows they may not read are never selected, so counts and search cannot leak them. The personal lists (Today, Tasks,
 * counts, reminders) deliberately do not use it: see docs/decisions/0018.
 */
export function accessibleWhere(
  actorId: string,
  type: ResourceType,
  options: AccessOptions = {},
): SQL {
  const mine = (() => {
    switch (type) {
      case "PROJECT":
        return eq(projects.userId, actorId);
      case "TASK":
        return eq(tasks.userId, actorId);
      case "TODO":
        return eq(todos.userId, actorId);
      case "NOTE":
        return eq(notes.userId, actorId);
    }
  })();
  if (!sharingOn(options)) return mine;
  switch (type) {
    case "PROJECT":
      return or(
        mine,
        and(isNull(projects.deletedAt), sql`${projects.id} in ${grantedProjects(actorId)}`),
      )!;
    case "TASK":
      return or(
        mine,
        and(
          isNull(tasks.deletedAt),
          sql`${tasks.kind} <> 'STICKY'`,
          sql`${tasks.projectId} in ${grantedProjects(actorId)}`,
        ),
      )!;
    case "TODO":
      return or(
        mine,
        and(isNull(todos.deletedAt), sql`${todos.projectId} in ${grantedProjects(actorId)}`),
      )!;
    case "NOTE":
      return or(
        mine,
        and(
          isNull(notes.deletedAt),
          isNull(notes.journalDate),
          or(
            sql`${notes.projectId} in ${grantedProjects(actorId)}`,
            sql`${notes.id} in ${grantedNotes(actorId)}`,
          ),
        ),
      )!;
  }
}

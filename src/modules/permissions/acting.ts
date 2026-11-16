import "server-only";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import {
  READ_ONLY_MESSAGE,
  NOT_VISIBLE_MESSAGE,
  requireAccess,
  resolveAccess,
  type AccessOptions,
} from "./access";
import type { Action, ResourceType, Role } from "./types";

// What an action calls (V3 feature 04 §4, docs/decisions/0018). The action checks the **actor**; the existing mutations
// and queries keep scoping by one `userId`, which for a shared item must be the **owner's**. So an action asks
// `ownerFor(...)` and passes the answer where it passed `user.id` before.
//
// With sharing off nothing is looked up: the answer is the actor, and the mutation's own owner scope gives the same
// NOT_FOUND as before. With it on, an owner costs one lookup; a collaborator is checked against the policy.

const sharingOn = (options: AccessOptions) => options.enabled ?? env.sharingEnabled;

/** The owner whose rows the command works on, after the actor may do `action` to the item. */
export async function ownerFor(
  actorId: string,
  type: ResourceType,
  id: string,
  action: Action,
  options: AccessOptions = {},
): Promise<string> {
  if (!sharingOn(options)) return actorId;
  return (await requireAccess(actorId, type, id, action, options)).ownerId;
}

/**
 * The owner for something new made inside a project (a task, todo or note with a `projectId`): the actor needs `create`
 * on the project. With no project it is the actor's own, private by default.
 */
export async function ownerForNew(
  actorId: string,
  projectId: string | null | undefined,
  options: AccessOptions = {},
): Promise<string> {
  if (!projectId) return actorId;
  return ownerFor(actorId, "PROJECT", projectId, "create", options);
}

/** Owner-only commands (sharing, changing a project's settings, deleting for good): a collaborator is told, not hidden from. */
export async function requireOwner(
  actorId: string,
  type: ResourceType,
  id: string,
  options: AccessOptions = {},
): Promise<void> {
  if (!sharingOn(options)) return;
  const access = await resolveAccess(actorId, type, id, options);
  if (access.role === null) throw new AppError("NOT_FOUND", NOT_VISIBLE_MESSAGE);
  if (access.role !== "OWNER") throw new AppError("UNAUTHORIZED", READ_ONLY_MESSAGE);
}

/** What to record as the maker of a new item: null when the owner made it. */
export const createdByFor = (actorId: string, ownerId: string): string | null =>
  actorId === ownerId ? null : actorId;

/**
 * For pages: the owner whose rows to read and the person's role, or null when they may not see the item (the page then
 * shows the ordinary "not found"). Never throws.
 */
export async function readAccessFor(
  actorId: string,
  type: ResourceType,
  id: string,
  options: AccessOptions = {},
): Promise<{ ownerId: string; role: Role } | null> {
  if (!sharingOn(options)) return { ownerId: actorId, role: "OWNER" };
  const access = await resolveAccess(actorId, type, id, options);
  if (access.role === null || access.ownerId === null) return null;
  return { ownerId: access.ownerId, role: access.role };
}

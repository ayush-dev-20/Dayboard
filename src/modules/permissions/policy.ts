import { ACTIONS, RESOURCE_TYPES, ROLES, type Action, type ResourceType, type Role } from "./types";

// The policy table (V3 feature 04 §2): the only place a rule is written. `POLICY[role][resource][action]` is `true` when
// that role may do that to that kind of item. The matrix test is generated from it, and adding a role, a resource or an
// action without a row here fails the build (every cell is required by the type).
//
//   Owner      everything, including sharing, deleting for good and the project's own settings.
//   Editor     read; create, edit, complete, archive and trash items inside the shared scope (the owner restores);
//              comment. Not share, delete for good, or change the project's own settings (its name, colour, status).
//   Commenter  read and comment.
//   Viewer     read.
//
// Tasks and todos are never shared one by one (they are reached through their project), so `share` is false for
// everyone on them; so is `manage_settings` on anything but a project.

type Row = Record<Action, boolean>;
const row = (allowed: readonly Action[]): Row =>
  Object.fromEntries(ACTIONS.map((a) => [a, allowed.includes(a)])) as Row;

const OWNER_ITEM = row([
  "read",
  "comment",
  "create",
  "update",
  "complete",
  "archive",
  "trash",
  "restore",
  "delete_forever",
]);
const EDITOR_ITEM = row(["read", "comment", "create", "update", "complete", "archive", "trash"]);
const COMMENTER = row(["read", "comment"]);
const VIEWER = row(["read"]);

export const POLICY: Record<Role, Record<ResourceType, Row>> = {
  OWNER: {
    PROJECT: row([...ACTIONS]),
    TASK: OWNER_ITEM,
    TODO: OWNER_ITEM,
    // A note can be shared, and has no settings of its own.
    NOTE: row(ACTIONS.filter((a) => a !== "manage_settings")),
  },
  EDITOR: {
    // Adding items to a shared project is `create`; its own name, colour and status are `manage_settings`.
    PROJECT: row(["read", "comment", "create"]),
    TASK: EDITOR_ITEM,
    TODO: EDITOR_ITEM,
    NOTE: EDITOR_ITEM,
  },
  COMMENTER: { PROJECT: COMMENTER, TASK: COMMENTER, TODO: COMMENTER, NOTE: COMMENTER },
  VIEWER: { PROJECT: VIEWER, TASK: VIEWER, TODO: VIEWER, NOTE: VIEWER },
};

/** Sharing is for projects and notes only. */
export const SHAREABLE: readonly ResourceType[] = ["PROJECT", "NOTE"];

/** Whether the role may do the action to that kind of item. A null role (no access at all) may do nothing. */
export function allowed(role: Role | null, type: ResourceType, action: Action): boolean {
  if (role === null) return false;
  return POLICY[role][type][action];
}

// Completeness is a test as well (`tests/unit/permissions-policy.test.ts`), so a hole is caught even if the types are
// widened later.
export const POLICY_SHAPE = { roles: ROLES, resources: RESOURCE_TYPES, actions: ACTIONS } as const;

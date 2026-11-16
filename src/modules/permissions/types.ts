// Permissions (V3 feature 04, docs/decisions/0018). Client-safe: the interface reads the policy to hide controls, and
// hiding is never the check.

export const ROLES = ["OWNER", "EDITOR", "COMMENTER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

/** What an item is. Sub-notes and sub-tasks are `NOTE` and `TASK`: they take their parent's access. */
export const RESOURCE_TYPES = ["PROJECT", "TASK", "TODO", "NOTE"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ACTIONS = [
  "read",
  "comment",
  "create",
  "update",
  "complete",
  "archive",
  "trash",
  "restore",
  "delete_forever",
  "share",
  "manage_settings",
] as const;
export type Action = (typeof ACTIONS)[number];

/** The roles a grant can hold (the owner is whoever's row it is, never stored). */
export const GRANT_ROLES = ["EDITOR", "COMMENTER", "VIEWER"] as const;
export type GrantRole = (typeof GRANT_ROLES)[number];

/** What `resolveAccess` answers: a role (null when the person may not even know it exists) and whose row it is. */
export type Access = { role: Role | null; ownerId: string | null };

/** Higher is more. */
export const ROLE_RANK: Record<Role, number> = { OWNER: 4, EDITOR: 3, COMMENTER: 2, VIEWER: 1 };

export const highestRole = (roles: readonly Role[]): Role | null =>
  roles.reduce<Role | null>(
    (best, role) => (best === null || ROLE_RANK[role] > ROLE_RANK[best] ? role : best),
    null,
  );

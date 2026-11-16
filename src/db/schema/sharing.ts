import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";

// Sharing (V3 feature 04 §3, docs/decisions/0018). Only projects and notes are shared; tasks and todos reach a
// collaborator through their project, sub-notes through their note. The owner of an item is whoever's row it is and is
// never stored here. Access is computed from these rows when it is asked for, never copied.

export const SHARE_RESOURCE_TYPES = ["PROJECT", "NOTE"] as const;
export const SHARE_ROLES = ["EDITOR", "COMMENTER", "VIEWER"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const resourceGrants = pgTable(
  "resource_grants",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    resourceType: text("resource_type").notNull(),
    // Checked by the server. No foreign key: it points at two tables. The delete paths and a repair job clean up.
    resourceId: uuid("resource_id").notNull(),
    // The resource's owner, kept here so a list query needs one join.
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    granteeId: uuid("grantee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("resource_grants_type", sql`${t.resourceType} in (${list(SHARE_RESOURCE_TYPES)})`),
    check("resource_grants_role", sql`${t.role} in (${list(SHARE_ROLES)})`),
    check("resource_grants_not_self", sql`${t.granteeId} <> ${t.ownerId}`),
    uniqueIndex("resource_grants_resource_grantee_idx").on(
      t.resourceType,
      t.resourceId,
      t.granteeId,
    ),
    index("resource_grants_grantee_idx").on(t.granteeId, t.resourceType),
    index("resource_grants_owner_idx").on(t.ownerId, t.resourceType, t.resourceId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Lower-cased. An invitation to an address that has an account is also listed in that person's Shared with me.
    inviteeEmail: text("invitee_email").notNull(),
    role: text("role").notNull(),
    // The token is random, shown once in the email link and kept only as a hash.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("invitations_type", sql`${t.resourceType} in (${list(SHARE_RESOURCE_TYPES)})`),
    check("invitations_role", sql`${t.role} in (${list(SHARE_ROLES)})`),
    check("invitations_email_lower", sql`${t.inviteeEmail} = lower(${t.inviteeEmail})`),
    uniqueIndex("invitations_token_hash_idx").on(t.tokenHash),
    // At most one open invitation per resource and address.
    uniqueIndex("invitations_open_idx")
      .on(t.resourceType, t.resourceId, t.inviteeEmail)
      .where(sql`${t.acceptedAt} is null and ${t.declinedAt} is null and ${t.revokedAt} is null`),
    index("invitations_email_idx").on(t.inviteeEmail),
    index("invitations_owner_idx").on(t.ownerId, t.createdAt.desc()),
  ],
);

export type ResourceGrant = typeof resourceGrants.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;

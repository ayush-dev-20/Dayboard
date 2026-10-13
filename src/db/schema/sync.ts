import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { user } from "./auth";

// Sync bookkeeping (V2 feature 05, docs/decisions/0007). Payloads are never stored here: only ids,
// statuses, versions and a hash, so note text does not end up in a second table.

/**
 * One row for every write to a syncable entity, in the same transaction as the write. Pull reads it
 * after a cursor (`seq`). Written only through `recordChange` in src/lib/sync/change-log.ts.
 */
export const changeLog = pgTable(
  "change_log",
  {
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    op: text("op").notNull(),
    version: integer("version").notNull(),
    deviceId: uuid("device_id"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("change_log_op", sql`${t.op} in ('UPSERT', 'DELETE')`),
    index("change_log_user_seq_idx").on(t.userId, t.seq),
  ],
);

/**
 * The result of every operation a device pushed, keyed by the device's own id for it. A retry with the
 * same `opId` gets the stored answer back and changes nothing.
 */
export const syncOperations = pgTable(
  "sync_operations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    opId: uuid("op_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    resultVersion: integer("result_version"),
    errorCode: text("error_code"),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.opId] }),
    check(
      "sync_operations_status",
      sql`${t.status} in ('APPLIED', 'DUPLICATE_IGNORED', 'REJECTED', 'CONFLICT')`,
    ),
    index("sync_operations_received_idx").on(t.receivedAt),
  ],
);

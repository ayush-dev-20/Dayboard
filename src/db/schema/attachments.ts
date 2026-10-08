import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";
import { attachmentOwnerTypeEnum, attachmentStatusEnum, linkPreviewStatusEnum } from "./enums";

// A file attached to a note, a task or a project (V2 feature 09 §2). The bytes live in object
// storage under `storage_key`; this row is the metadata and the permission. `owner_id` points at a
// note, task or project and has no foreign key (it can be any of three tables): the server checks
// the owner belongs to the person, and a file whose owner is gone for good is purged.
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ownerType: attachmentOwnerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    // `u/{userId}/{yyyy}/{mm}/{attachmentId}/{random}`: never the file name.
    storageKey: text("storage_key").notNull(),
    // For display and the download header only.
    originalName: text("original_name").notNull(),
    // What the browser said, then what the first bytes confirmed.
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    width: integer("width"),
    height: integer("height"),
    status: attachmentStatusEnum("status").notNull().default("PENDING"),
    // Why a REJECTED file was refused (a plain code, never file content).
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    // Soft delete: the object is purged after 30 days.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("attachments_storage_key_idx").on(t.storageKey),
    index("attachments_owner_idx").on(t.userId, t.ownerType, t.ownerId, t.deletedAt),
    index("attachments_user_status_idx").on(t.userId, t.status, t.createdAt),
    check("attachments_name_length", sql`char_length(${t.originalName}) between 1 and 255`),
    check("attachments_size_positive", sql`${t.sizeBytes} > 0`),
  ],
);

// What a web address looked like when it was fetched, for bookmark cards (V2 feature 09 §2). Per
// person on purpose: a shared cache would let one person's fetch hint at another's reading.
export const linkPreviews = pgTable(
  "link_previews",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    urlHash: text("url_hash").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    siteName: text("site_name"),
    // A small data: URI fetched by the server, so the browser never loads a third-party icon.
    faviconDataUri: text("favicon_data_uri"),
    status: linkPreviewStatusEnum("status").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("link_previews_user_url_idx").on(t.userId, t.urlHash),
    index("link_previews_expires_idx").on(t.expiresAt),
    check("link_previews_title_length", sql`${t.title} is null or char_length(${t.title}) <= 200`),
    check(
      "link_previews_description_length",
      sql`${t.description} is null or char_length(${t.description}) <= 400`,
    ),
    check(
      "link_previews_site_name_length",
      sql`${t.siteName} is null or char_length(${t.siteName}) <= 100`,
    ),
    check(
      "link_previews_favicon_size",
      sql`${t.faviconDataUri} is null or char_length(${t.faviconDataUri}) <= 12000`,
    ),
  ],
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type LinkPreview = typeof linkPreviews.$inferSelect;

import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";

// Meaning-based search (V2 feature 10, docs/decisions/0011). These tables are an index built from the
// person's own items: they can be deleted and rebuilt at any time. Nothing here is synced to devices.

export const SEARCH_ENTITY_TYPES = ["TASK", "TODO", "NOTE", "PROJECT"] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export const SEARCH_DOCUMENT_STATUSES = ["INDEXED", "EMPTY", "FAILED"] as const;

/** Must match `EMBED_DIMENSIONS` in src/lib/ai/embedding.ts. Changing it needs a new migration. */
const DIMENSIONS = 768;

// One row per indexed item. It records what was indexed, not the text: titles and text always come from
// the item's own table.
export const searchDocuments = pgTable(
  "search_documents",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: SEARCH_ENTITY_TYPES }).notNull(),
    entityId: uuid("entity_id").notNull(),
    // Hash of the title plus the text when it was indexed.
    contentHash: text("content_hash").notNull(),
    // The item's `updated_at` this index state belongs to. The scan compares against it.
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    chunkCount: integer("chunk_count").notNull().default(0),
    status: text("status", { enum: SEARCH_DOCUMENT_STATUSES }).notNull().default("INDEXED"),
    failureCount: integer("failure_count").notNull().default(0),
    // A code, never text from the item.
    lastErrorCode: text("last_error_code"),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("search_documents_entity_idx").on(t.entityType, t.entityId),
    index("search_documents_user_status_idx").on(t.userId, t.status),
    check("search_documents_entity_type", sql`${t.entityType} in ('TASK','TODO','NOTE','PROJECT')`),
    check("search_documents_status", sql`${t.status} in ('INDEXED','EMPTY','FAILED')`),
  ],
);

// The pieces of text that were embedded, with their vectors. `user_id` is repeated here so every vector
// query filters by person without a join.
export const embeddingChunks = pgTable(
  "embedding_chunks",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => searchDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    embedding: vector("embedding", { dimensions: DIMENSIONS }).notNull(),
    // For example `gemini-embedding-001@768`. Rows from another model are ignored and re-embedded.
    model: text("model").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("embedding_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("embedding_chunks_user_document_idx").on(t.userId, t.documentId),
  ],
);

// How many pieces were sent for indexing per person per day (UTC), for the daily cap. A counter, because
// replaced pieces are deleted and would otherwise not be counted.
export const embeddingUsageDays = pgTable(
  "embedding_usage_days",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    chunks: integer("chunks").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export type SearchDocument = typeof searchDocuments.$inferSelect;
export type EmbeddingChunk = typeof embeddingChunks.$inferSelect;

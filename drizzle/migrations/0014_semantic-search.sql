-- Meaning-based search (V2 feature 10, docs/decisions/0011). pgvector must be installed on the server first.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TYPE "public"."ai_feature" ADD VALUE 'EMBED';--> statement-breakpoint
ALTER TYPE "public"."ai_feature" ADD VALUE 'EMBED_QUERY';--> statement-breakpoint
CREATE TABLE "embedding_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"embedding" vector(768) NOT NULL,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_usage_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"chunks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "embedding_usage_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "search_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'INDEXED' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_documents_entity_type" CHECK ("search_documents"."entity_type" in ('TASK','TODO','NOTE','PROJECT')),
	CONSTRAINT "search_documents_status" CHECK ("search_documents"."status" in ('INDEXED','EMPTY','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "semantic_search_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "embedding_chunks" ADD CONSTRAINT "embedding_chunks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding_chunks" ADD CONSTRAINT "embedding_chunks_document_id_search_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."search_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding_usage_days" ADD CONSTRAINT "embedding_usage_days_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embedding_chunks_embedding_idx" ON "embedding_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "embedding_chunks_user_document_idx" ON "embedding_chunks" USING btree ("user_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_documents_entity_idx" ON "search_documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "search_documents_user_status_idx" ON "search_documents" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "projects_user_updated_at_idx" ON "projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "todos_user_updated_at_idx" ON "todos" USING btree ("user_id","updated_at");--> statement-breakpoint
INSERT INTO "job_schedules" ("name", "cron", "type", "payload", "queue", "enabled", "next_run_at") VALUES
	('embedding.scan', 'every 5m', 'embedding.scan', '{}'::jsonb, 'ai', true, now())
ON CONFLICT ("name") DO NOTHING;

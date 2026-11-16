CREATE TABLE "note_collab_docs" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"ydoc" "bytea" NOT NULL,
	"base_version" integer NOT NULL,
	"projected_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"ydoc" "bytea" NOT NULL,
	"content_json" jsonb NOT NULL,
	"created_by" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_snapshots_reason" CHECK ("note_snapshots"."reason" in ('INTERVAL', 'LAST_DISCONNECT', 'BEFORE_ROLLBACK'))
);
--> statement-breakpoint
ALTER TABLE "note_collab_docs" ADD CONSTRAINT "note_collab_docs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_snapshots" ADD CONSTRAINT "note_snapshots_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_snapshots" ADD CONSTRAINT "note_snapshots_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_snapshots_note_created_idx" ON "note_snapshots" USING btree ("note_id","created_at" DESC NULLS LAST);
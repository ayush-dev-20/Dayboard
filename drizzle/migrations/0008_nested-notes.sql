CREATE TABLE "note_links" (
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"target_note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_links_source_type_source_id_target_note_id_pk" PRIMARY KEY("source_type","source_id","target_note_id"),
	CONSTRAINT "note_links_snippet_length" CHECK (char_length("note_links"."snippet") <= 200)
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "parent_note_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "depth" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "deleted_cascade_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "archived_cascade_id" uuid;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_target_note_id_notes_id_fk" FOREIGN KEY ("target_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_links_target_idx" ON "note_links" USING btree ("target_note_id");--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_note_id_notes_id_fk" FOREIGN KEY ("parent_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_user_parent_order_idx" ON "notes" USING btree ("user_id","parent_note_id","sort_order");--> statement-breakpoint
CREATE INDEX "notes_user_deleted_cascade_idx" ON "notes" USING btree ("user_id","deleted_cascade_id");--> statement-breakpoint
CREATE INDEX "notes_user_archived_cascade_idx" ON "notes" USING btree ("user_id","archived_cascade_id");--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_depth_range" CHECK ("notes"."depth" between 1 and 5);--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_not_own_parent" CHECK ("notes"."parent_note_id" is null or "notes"."parent_note_id" <> "notes"."id");--> statement-breakpoint
-- A link's source is a note or a task, so `source_id` cannot have a foreign key. These triggers
-- remove a source's rows when the source is deleted for good, however it was deleted (permanent
-- delete, a sub-note removed with its parent, an account deleted).
CREATE FUNCTION "note_links_remove_source"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	DELETE FROM "note_links" WHERE "source_type" = TG_ARGV[0] AND "source_id" = OLD."id";
	RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "notes_remove_note_links" AFTER DELETE ON "notes" FOR EACH ROW EXECUTE FUNCTION "note_links_remove_source"('NOTE');
--> statement-breakpoint
CREATE TRIGGER "tasks_remove_note_links" AFTER DELETE ON "tasks" FOR EACH ROW EXECUTE FUNCTION "note_links_remove_source"('TASK');

ALTER TABLE "notes" ADD COLUMN "journal_date" date;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_journal_date_idx" ON "notes" USING btree ("user_id","journal_date") WHERE "notes"."journal_date" is not null and "notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_user_completed_at_idx" ON "tasks" USING btree ("user_id","completed_at") WHERE "tasks"."completed_at" is not null;--> statement-breakpoint
CREATE INDEX "todos_user_completed_at_idx" ON "todos" USING btree ("user_id","completed_at") WHERE "todos"."completed_at" is not null;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_journal_top_level" CHECK ("notes"."journal_date" is null or ("notes"."parent_note_id" is null and "notes"."depth" = 1));
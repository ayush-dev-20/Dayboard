CREATE TYPE "public"."inbox_status" AS ENUM('OPEN', 'CONVERTED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" "inbox_status" DEFAULT 'OPEN' NOT NULL,
	"converted_at" timestamp with time zone,
	"converted_refs" jsonb,
	"ai_suggestion" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "inbox_items_text_length" CHECK (char_length("inbox_items"."text") between 1 and 5000),
	CONSTRAINT "inbox_items_converted_has_time" CHECK (("inbox_items"."status" = 'CONVERTED') = ("inbox_items"."converted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_items_user_status_created_idx" ON "inbox_items" USING btree ("user_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inbox_items_user_deleted_at_idx" ON "inbox_items" USING btree ("user_id","deleted_at");--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_focus_task_id_tasks_id_fk" FOREIGN KEY ("focus_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
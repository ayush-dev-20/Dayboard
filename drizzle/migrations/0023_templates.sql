-- Templates (V3 feature 03): a table of saved starting shapes, and the template that starts new journal entries.
-- Expand-only. (The sticky-note changes to `tasks` are in 0022; the snapshot already includes them.)
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"title_pattern" text DEFAULT '' NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"starter_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "templates_name_length" CHECK (char_length("templates"."name") between 1 and 120),
	CONSTRAINT "templates_title_pattern_length" CHECK (char_length("templates"."title_pattern") <= 300)
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "journal_template_id" uuid;
--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "templates_user_deleted_at_idx" ON "templates" USING btree ("user_id","deleted_at");
--> statement-breakpoint
CREATE INDEX "templates_user_updated_at_idx" ON "templates" USING btree ("user_id","updated_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "templates_user_starter_key_idx" ON "templates" USING btree ("user_id","starter_key") WHERE "templates"."starter_key" is not null and "templates"."deleted_at" is null;
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_journal_template_id_templates_id_fk" FOREIGN KEY ("journal_template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;

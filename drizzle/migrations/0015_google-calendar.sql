CREATE TABLE "calendar_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'GOOGLE' NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text[] NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"sync_lease_until" timestamp with time zone,
	CONSTRAINT "calendar_accounts_provider" CHECK ("calendar_accounts"."provider" in ('GOOGLE')),
	CONSTRAINT "calendar_accounts_status" CHECK ("calendar_accounts"."status" in ('ACTIVE','NEEDS_RECONNECT','REVOKED'))
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"ical_uid" text,
	"title" text NOT NULL,
	"location" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"time_zone" text,
	"busy" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"html_link" text,
	"recurring_event_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_status" CHECK ("calendar_events"."status" in ('confirmed','tentative','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "calendar_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_calendar_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"time_zone" text,
	"selected" boolean DEFAULT false NOT NULL,
	"sync_token" text,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_task_links" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_task_links_task_id_provider_event_id_pk" PRIMARY KEY("task_id","provider_event_id")
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "work_start" time DEFAULT '09:00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "work_end" time DEFAULT '18:00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "planning_sees_titles" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_source_id_calendar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_account_id_calendar_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_task_links" ADD CONSTRAINT "calendar_task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_task_links" ADD CONSTRAINT "calendar_task_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_task_links" ADD CONSTRAINT "calendar_task_links_source_id_calendar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_accounts_provider_account_idx" ON "calendar_accounts" USING btree ("user_id","provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_source_event_idx" ON "calendar_events" USING btree ("source_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "calendar_events_user_start_idx" ON "calendar_events" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_sources_account_calendar_idx" ON "calendar_sources" USING btree ("account_id","provider_calendar_id");--> statement-breakpoint
CREATE INDEX "calendar_sources_user_idx" ON "calendar_sources" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "job_schedules" ("name", "cron", "type", "payload", "queue", "enabled", "next_run_at") VALUES
	('calendar.sync_all', 'every 15m', 'calendar.sync_all', '{}'::jsonb, 'default', true, now())
ON CONFLICT ("name") DO NOTHING;

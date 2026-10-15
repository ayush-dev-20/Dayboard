ALTER TYPE "public"."ai_feature" ADD VALUE 'WEEKLY_REVIEW';--> statement-breakpoint
CREATE TABLE "feature_epochs" (
	"name" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_schedule_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"from_date" date,
	"to_date" date,
	"reason" text DEFAULT 'MANUAL' NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_schedule_history_reason" CHECK ("task_schedule_history"."reason" in ('MANUAL','PLAN_DAY','OVERDUE_CLEANUP','BOARD_DRAG','CALENDAR_DRAG','REVIEW'))
);
--> statement-breakpoint
CREATE TABLE "weekly_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"facts" jsonb,
	"facts_version" integer DEFAULT 1 NOT NULL,
	"suggestions" jsonb,
	"suggestions_status" text DEFAULT 'NONE' NOT NULL,
	"suggestions_error" text,
	"suggestions_at" timestamp with time zone,
	"partial" boolean DEFAULT false NOT NULL,
	"model" text,
	"prompt_version" text,
	"carry_applied_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reviews_status" CHECK ("weekly_reviews"."status" in ('PENDING','READY','FAILED')),
	CONSTRAINT "weekly_reviews_suggestions_status" CHECK ("weekly_reviews"."suggestions_status" in ('NONE','GENERATED','UNAVAILABLE','OFF')),
	CONSTRAINT "weekly_reviews_week_order" CHECK ("weekly_reviews"."week_end" >= "weekly_reviews"."week_start")
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "weekly_review_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "weekly_review_day" smallint;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "weekly_review_hour" smallint DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_schedule_history" ADD CONSTRAINT "task_schedule_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedule_history" ADD CONSTRAINT "task_schedule_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_schedule_history_user_changed_idx" ON "task_schedule_history" USING btree ("user_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "task_schedule_history_task_idx" ON "task_schedule_history" USING btree ("task_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_reviews_user_week_idx" ON "weekly_reviews" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "weekly_reviews_user_generated_idx" ON "weekly_reviews" USING btree ("user_id","week_start" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_review_day_range" CHECK ("user_preferences"."weekly_review_day" is null or "user_preferences"."weekly_review_day" between 0 and 6);--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_review_hour_range" CHECK ("user_preferences"."weekly_review_hour" between 0 and 23);--> statement-breakpoint
INSERT INTO "feature_epochs" ("name", "started_at") VALUES ('task_schedule_history', now())
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "job_schedules" ("name", "cron", "type", "payload", "queue", "enabled", "next_run_at") VALUES
	('review.scan', 'every 1h', 'review.scan', '{}'::jsonb, 'ai', true, now()),
	('review.prune_history', 'daily 03:30 UTC', 'review.prune_history', '{}'::jsonb, 'default', true, now())
ON CONFLICT ("name") DO NOTHING;

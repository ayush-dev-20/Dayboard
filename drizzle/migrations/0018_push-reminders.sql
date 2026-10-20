CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"subscription_id" uuid,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_category" CHECK ("notification_log"."category" in ('TASK_REMINDER', 'CALENDAR_REMINDER', 'SYNC_FAILURE', 'WEEKLY_REVIEW_READY', 'OVERDUE_SUMMARY')),
	CONSTRAINT "notification_log_status" CHECK ("notification_log"."status" in ('SENT', 'FAILED', 'SUPPRESSED_QUIET', 'SUPPRESSED_PREF', 'SUPPRESSED_OPEN', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_category_pk" PRIMARY KEY("user_id","category"),
	CONSTRAINT "notification_preferences_category" CHECK ("notification_preferences"."category" in ('TASK_REMINDER', 'CALENDAR_REMINDER', 'SYNC_FAILURE', 'WEEKLY_REVIEW_READY', 'OVERDUE_SUMMARY'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"spec" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"sent_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reminders_kind" CHECK ("task_reminders"."kind" in ('DEFAULT_LEAD', 'CUSTOM', 'CALENDAR_START')),
	CONSTRAINT "task_reminders_status" CHECK ("task_reminders"."status" in ('PENDING', 'SENT', 'SNOOZED', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "quiet_hours_start" time;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "quiet_hours_end" time;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "default_reminder_lead_minutes" smallint DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notify_show_titles" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_user_dedupe_idx" ON "notification_log" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_log_created_idx" ON "notification_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_user_device_live_idx" ON "push_subscriptions" USING btree ("user_id","device_id") WHERE "push_subscriptions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_reminders_status_remind_at_idx" ON "task_reminders" USING btree ("status","remind_at");--> statement-breakpoint
CREATE INDEX "task_reminders_task_idx" ON "task_reminders" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_reminders_task_kind_idx" ON "task_reminders" USING btree ("task_id","kind") WHERE "task_reminders"."kind" <> 'CUSTOM';--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_quiet_hours_pair" CHECK (("user_preferences"."quiet_hours_start" is null) = ("user_preferences"."quiet_hours_end" is null));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_reminder_lead_range" CHECK ("user_preferences"."default_reminder_lead_minutes" between 0 and 1440);--> statement-breakpoint
INSERT INTO "job_schedules" ("name", "cron", "type", "payload", "queue", "enabled", "next_run_at") VALUES
	('reminders.scan', 'every 60s', 'reminders.scan', '{}'::jsonb, 'notifications', true, now()),
	('overdue.scan', 'every 15m', 'overdue.scan', '{}'::jsonb, 'notifications', true, now()),
	('notifications.prune', 'daily 03:45 UTC', 'notifications.prune', '{}'::jsonb, 'default', true, now())
ON CONFLICT ("name") DO NOTHING;

CREATE TABLE "job_schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"cron" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"dedupe_key" text,
	"correlation_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_status" CHECK ("jobs"."status" in ('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD','CANCELLED')),
	CONSTRAINT "jobs_attempts" CHECK ("jobs"."attempts" >= 0 and "jobs"."max_attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" text NOT NULL,
	"queues" text[] NOT NULL,
	"current_job_id" uuid,
	"hostname" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_schedules_due_idx" ON "job_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_user_type_status_idx" ON "jobs" USING btree ("user_id","type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_dedupe_key_idx" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."status" in ('QUEUED','RUNNING') and "jobs"."dedupe_key" is not null;--> statement-breakpoint
INSERT INTO "job_schedules" ("name", "cron", "type", "payload", "queue", "enabled", "next_run_at") VALUES
	('maintenance.prune_jobs', 'daily 03:00 UTC', 'maintenance.prune_jobs', '{}'::jsonb, 'default', true, now()),
	('maintenance.prune_sync', 'daily 03:15 UTC', 'maintenance.prune_sync', '{}'::jsonb, 'default', true, now())
ON CONFLICT ("name") DO NOTHING;

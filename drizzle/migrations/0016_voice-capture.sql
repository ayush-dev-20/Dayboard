ALTER TYPE "public"."ai_feature" ADD VALUE 'TRANSCRIBE';--> statement-breakpoint
ALTER TYPE "public"."ai_feature" ADD VALUE 'VOICE_PARSE';--> statement-breakpoint
CREATE TABLE "voice_captures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'UPLOADING' NOT NULL,
	"storage_key" text,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"duration_ms" integer NOT NULL,
	"language" text,
	"transcript" text,
	"parsed" jsonb,
	"keep_audio" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "voice_captures_status" CHECK ("voice_captures"."status" in ('UPLOADING','QUEUED','TRANSCRIBING','READY','FAILED','CONSUMED','DISCARDED')),
	CONSTRAINT "voice_captures_size_positive" CHECK ("voice_captures"."size_bytes" > 0),
	CONSTRAINT "voice_captures_duration_range" CHECK ("voice_captures"."duration_ms" between 0 and 600000)
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "voice_capture_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_captures" ADD CONSTRAINT "voice_captures_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_captures_user_status_idx" ON "voice_captures" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "voice_captures_expires_idx" ON "voice_captures" USING btree ("expires_at");--> statement-breakpoint
INSERT INTO "job_schedules" ("name", "cron", "type", "payload", "queue", "enabled", "next_run_at") VALUES
	('voice.cleanup', 'every 1h', 'voice.cleanup', '{}'::jsonb, 'default', true, now())
ON CONFLICT ("name") DO NOTHING;

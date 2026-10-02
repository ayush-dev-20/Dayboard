CREATE TYPE "public"."ai_feature" AS ENUM('EXTRACT_TASKS', 'SUBTASKS', 'SUMMARIZE_NOTE', 'ACTION_ITEMS', 'ASK', 'DAILY', 'OVERDUE_CLEANUP', 'TASK_ASSIST', 'CLASSIFY_INBOX');--> statement-breakpoint
CREATE TYPE "public"."ai_usage_status" AS ENUM('SUCCESS', 'PROVIDER_ERROR', 'VALIDATION_ERROR', 'RATE_LIMITED');--> statement-breakpoint
CREATE TABLE "ai_daily_suggestions" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"text" text NOT NULL,
	"refresh_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_daily_suggestions_user_id_local_date_pk" PRIMARY KEY("user_id","local_date"),
	CONSTRAINT "ai_daily_suggestions_text_length" CHECK (char_length("ai_daily_suggestions"."text") between 1 and 280)
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" "ai_feature" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "ai_usage_status" NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_daily_suggestions" ADD CONSTRAINT "ai_daily_suggestions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage" USING btree ("user_id","created_at" DESC NULLS LAST);
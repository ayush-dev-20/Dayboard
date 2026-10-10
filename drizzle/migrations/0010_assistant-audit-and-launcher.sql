ALTER TYPE "public"."ai_feature" ADD VALUE 'ASSISTANT';--> statement-breakpoint
ALTER TYPE "public"."ai_feature" ADD VALUE 'ASK_SELECTION';--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"entity_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposal_id" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_summary_length" CHECK (char_length("audit_log"."summary") between 1 and 200),
	CONSTRAINT "audit_log_source" CHECK ("audit_log"."source" in ('ASSISTANT', 'WEEKLY_REVIEW', 'VOICE'))
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "assistant_launcher" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_user_created_idx" ON "audit_log" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_user_proposal_idx" ON "audit_log" USING btree ("user_id","proposal_id");
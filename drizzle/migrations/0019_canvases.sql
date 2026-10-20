ALTER TYPE "public"."ai_feature" ADD VALUE 'GENERATE_DIAGRAM';--> statement-breakpoint
ALTER TYPE "public"."ai_feature" ADD VALUE 'REFINE_DIAGRAM';--> statement-breakpoint
CREATE TABLE "canvases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"emoji" text,
	"kind" text DEFAULT 'DRAWING' NOT NULL,
	"scene_json" jsonb NOT NULL,
	"board_json" jsonb,
	"scene_text" text DEFAULT '' NOT NULL,
	"element_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_modified_by_device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "canvases_title_length" CHECK (char_length("canvases"."title") <= 300),
	CONSTRAINT "canvases_kind" CHECK ("canvases"."kind" in ('DRAWING', 'BOARD')),
	CONSTRAINT "canvases_board_matches_kind" CHECK (("canvases"."kind" = 'BOARD') = ("canvases"."board_json" is not null)),
	CONSTRAINT "canvases_scene_text_length" CHECK (char_length("canvases"."scene_text") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "task_canvases" (
	"task_id" uuid NOT NULL,
	"canvas_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_canvases_task_id_canvas_id_pk" PRIMARY KEY("task_id","canvas_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_source";--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_canvases" ADD CONSTRAINT "task_canvases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_canvases" ADD CONSTRAINT "task_canvases_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_canvases" ADD CONSTRAINT "task_canvases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvases_user_updated_idx" ON "canvases" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "canvases_user_deleted_idx" ON "canvases" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "canvases_user_project_idx" ON "canvases" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "task_canvases_canvas_idx" ON "task_canvases" USING btree ("canvas_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_source" CHECK ("audit_log"."source" in ('ASSISTANT', 'WEEKLY_REVIEW', 'VOICE', 'CANVAS'));
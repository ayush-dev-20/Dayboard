CREATE TYPE "public"."task_status" AS ENUM('INBOX', 'PLANNED', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"parent_task_id" uuid,
	"title" text NOT NULL,
	"emoji" text,
	"description_json" jsonb,
	"description_text" text,
	"status" "task_status" DEFAULT 'PLANNED' NOT NULL,
	"priority" "task_priority" DEFAULT 'NONE' NOT NULL,
	"due_date" date,
	"due_time" time,
	"start_date" date,
	"start_time" time,
	"completed_at" timestamp with time zone,
	"recurrence_rule" text,
	"recurrence_parent_id" uuid,
	"sort_order" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tasks_title_length" CHECK (char_length("tasks"."title") between 1 and 500),
	CONSTRAINT "tasks_done_has_completed_at" CHECK (("tasks"."status" = 'DONE') = ("tasks"."completed_at" is not null)),
	CONSTRAINT "tasks_due_time_needs_date" CHECK ("tasks"."due_time" is null or "tasks"."due_date" is not null),
	CONSTRAINT "tasks_start_time_needs_date" CHECK ("tasks"."start_time" is null or "tasks"."start_date" is not null),
	CONSTRAINT "tasks_not_own_parent" CHECK ("tasks"."parent_task_id" <> "tasks"."id"),
	CONSTRAINT "tasks_recurring_needs_due_date" CHECK ("tasks"."recurrence_rule" is null or "tasks"."due_date" is not null),
	CONSTRAINT "tasks_subtask_does_not_recur" CHECK ("tasks"."parent_task_id" is null or "tasks"."recurrence_rule" is null)
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"emoji" text,
	"is_complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"due_date" date,
	"sort_order" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "todos_title_length" CHECK (char_length("todos"."title") between 1 and 300),
	CONSTRAINT "todos_complete_has_completed_at" CHECK ("todos"."is_complete" = ("todos"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_user_due_date_idx" ON "tasks" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_user_updated_at_idx" ON "tasks" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "tasks_user_deleted_at_idx" ON "tasks" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "tasks_user_project_idx" ON "tasks" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "todos_user_open_order_idx" ON "todos" USING btree ("user_id","is_complete","sort_order");--> statement-breakpoint
CREATE INDEX "todos_user_due_date_idx" ON "todos" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "todos_user_project_idx" ON "todos" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "todos_user_deleted_at_idx" ON "todos" USING btree ("user_id","deleted_at");
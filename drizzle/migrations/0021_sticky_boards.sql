ALTER TABLE "tasks" ADD COLUMN "kind" text DEFAULT 'TASK' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "board_canvas_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "board_column_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sticky_tone" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_canvas_id_canvases_id_fk" FOREIGN KEY ("board_canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_board_order_idx" ON "tasks" USING btree ("board_canvas_id","sort_order") WHERE "tasks"."kind" = 'STICKY';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_kind" CHECK ("tasks"."kind" in ('TASK', 'STICKY'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sticky_has_place" CHECK (("tasks"."kind" = 'STICKY') = ("tasks"."board_canvas_id" is not null and "tasks"."board_column_id" is not null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sticky_is_plain" CHECK ("tasks"."kind" <> 'STICKY' or ("tasks"."recurrence_rule" is null and "tasks"."parent_task_id" is null));
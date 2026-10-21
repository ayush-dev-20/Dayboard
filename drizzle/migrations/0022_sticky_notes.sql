-- Sticky notes are Miro-style notes on a drawing, not cards in board columns (V3 feature 01 §13). The column board built
-- by 0021 is removed: any board becomes an empty drawing, the column is dropped, and the link to the canvas is renamed.
UPDATE "canvases" SET "kind" = 'DRAWING', "board_json" = NULL WHERE "kind" = 'BOARD';--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_sticky_has_place";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "board_column_id";--> statement-breakpoint
ALTER TABLE "tasks" RENAME COLUMN "board_canvas_id" TO "sticky_canvas_id";--> statement-breakpoint
ALTER TABLE "tasks" RENAME CONSTRAINT "tasks_board_canvas_id_canvases_id_fk" TO "tasks_sticky_canvas_id_canvases_id_fk";--> statement-breakpoint
ALTER INDEX "tasks_board_order_idx" RENAME TO "tasks_sticky_order_idx";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sticky_has_canvas" CHECK (("tasks"."kind" = 'STICKY') = ("tasks"."sticky_canvas_id" is not null));

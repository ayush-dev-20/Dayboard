CREATE TYPE "public"."view_collection" AS ENUM('TASKS', 'TODOS', 'NOTES');--> statement-breakpoint
CREATE TYPE "public"."view_type" AS ENUM('LIST', 'TABLE', 'BOARD', 'CALENDAR', 'GALLERY', 'TREE');--> statement-breakpoint
CREATE TABLE "collection_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"collection" "view_collection" NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"type" "view_type" NOT NULL,
	"position" double precision NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_modified_by_device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collection_views_name_length" CHECK (char_length("collection_views"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "sort_order" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_views_user_collection_idx" ON "collection_views" USING btree ("user_id","collection","deleted_at","position");--> statement-breakpoint
CREATE INDEX "notes_user_sort_order_idx" ON "notes" USING btree ("user_id","sort_order");--> statement-breakpoint
-- Notes keep the order they have today (most recently updated first) as their manual order.
UPDATE "notes" SET "sort_order" = ranked.rn * 1024.0
FROM (
	SELECT "id", (row_number() OVER (PARTITION BY "user_id" ORDER BY "updated_at" DESC, "id") - 1) AS rn
	FROM "notes"
) AS ranked
WHERE "notes"."id" = ranked."id";--> statement-breakpoint
-- Every existing account gets one List view per collection (feature 06 §2). The JSON is the
-- List default in src/lib/views/defaults.ts; tests/unit/views-defaults.test.ts keeps the two equal.
INSERT INTO "collection_views" ("id", "user_id", "collection", "name", "type", "position", "config")
SELECT gen_random_uuid(), u."id", d."collection", d."name", 'LIST', 1024, d."config"::jsonb
FROM "user" u
CROSS JOIN (VALUES
	('TASKS'::"view_collection", 'All tasks', '{"filters":[],"sorts":[],"groupBy":"dueList","hideEmptyGroups":true,"visibleProperties":[],"openIn":"panel"}'),
	('TODOS'::"view_collection", 'All todos', '{"filters":[],"sorts":[],"groupBy":null,"hideEmptyGroups":false,"visibleProperties":[],"openIn":"panel"}'),
	('NOTES'::"view_collection", 'All notes', '{"filters":[],"sorts":[{"property":"updated","dir":"desc"}],"groupBy":null,"hideEmptyGroups":false,"visibleProperties":[],"openIn":"page"}')
) AS d("collection", "name", "config");

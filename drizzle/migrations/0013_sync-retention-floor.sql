CREATE TABLE "sync_retention" (
	"key" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO "sync_retention" ("key", "value") VALUES ('change_log', 0) ON CONFLICT ("key") DO NOTHING;

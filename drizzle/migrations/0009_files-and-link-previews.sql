CREATE TYPE "public"."attachment_owner_type" AS ENUM('NOTE', 'TASK', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."attachment_status" AS ENUM('PENDING', 'READY', 'REJECTED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."link_preview_status" AS ENUM('OK', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"owner_type" "attachment_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"width" integer,
	"height" integer,
	"status" "attachment_status" DEFAULT 'PENDING' NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attachments_name_length" CHECK (char_length("attachments"."original_name") between 1 and 255),
	CONSTRAINT "attachments_size_positive" CHECK ("attachments"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "link_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"favicon_data_uri" text,
	"status" "link_preview_status" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "link_previews_title_length" CHECK ("link_previews"."title" is null or char_length("link_previews"."title") <= 200),
	CONSTRAINT "link_previews_description_length" CHECK ("link_previews"."description" is null or char_length("link_previews"."description") <= 400),
	CONSTRAINT "link_previews_site_name_length" CHECK ("link_previews"."site_name" is null or char_length("link_previews"."site_name") <= 100),
	CONSTRAINT "link_previews_favicon_size" CHECK ("link_previews"."favicon_data_uri" is null or char_length("link_previews"."favicon_data_uri") <= 12000)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_previews" ADD CONSTRAINT "link_previews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_idx" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("user_id","owner_type","owner_id","deleted_at");--> statement-breakpoint
CREATE INDEX "attachments_user_status_idx" ON "attachments" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "link_previews_user_url_idx" ON "link_previews" USING btree ("user_id","url_hash");--> statement-breakpoint
CREATE INDEX "link_previews_expires_idx" ON "link_previews" USING btree ("expires_at");
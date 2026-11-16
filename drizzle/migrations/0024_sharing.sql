CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"invitee_email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_type" CHECK ("invitations"."resource_type" in ('PROJECT', 'NOTE')),
	CONSTRAINT "invitations_role" CHECK ("invitations"."role" in ('EDITOR', 'COMMENTER', 'VIEWER')),
	CONSTRAINT "invitations_email_lower" CHECK ("invitations"."invitee_email" = lower("invitations"."invitee_email"))
);
--> statement-breakpoint
CREATE TABLE "resource_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"grantee_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_grants_type" CHECK ("resource_grants"."resource_type" in ('PROJECT', 'NOTE')),
	CONSTRAINT "resource_grants_role" CHECK ("resource_grants"."role" in ('EDITOR', 'COMMENTER', 'VIEWER')),
	CONSTRAINT "resource_grants_not_self" CHECK ("resource_grants"."grantee_id" <> "resource_grants"."owner_id")
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_grantee_id_user_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_idx" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_open_idx" ON "invitations" USING btree ("resource_type","resource_id","invitee_email") WHERE "invitations"."accepted_at" is null and "invitations"."declined_at" is null and "invitations"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("invitee_email");--> statement-breakpoint
CREATE INDEX "invitations_owner_idx" ON "invitations" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "resource_grants_resource_grantee_idx" ON "resource_grants" USING btree ("resource_type","resource_id","grantee_id");--> statement-breakpoint
CREATE INDEX "resource_grants_grantee_idx" ON "resource_grants" USING btree ("grantee_id","resource_type");--> statement-breakpoint
CREATE INDEX "resource_grants_owner_idx" ON "resource_grants" USING btree ("owner_id","resource_type","resource_id");--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
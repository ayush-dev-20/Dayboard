CREATE TABLE "change_log" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "change_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"version" integer NOT NULL,
	"device_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_log_op" CHECK ("change_log"."op" in ('UPSERT', 'DELETE'))
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"user_id" uuid NOT NULL,
	"op_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"result_version" integer,
	"error_code" text,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "sync_operations_user_id_op_id_pk" PRIMARY KEY("user_id","op_id"),
	CONSTRAINT "sync_operations_status" CHECK ("sync_operations"."status" in ('APPLIED', 'DUPLICATE_IGNORED', 'REJECTED', 'CONFLICT'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_modified_by_device_id" uuid;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_user_seq_idx" ON "change_log" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "sync_operations_received_idx" ON "sync_operations" USING btree ("received_at");
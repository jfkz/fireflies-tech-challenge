CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "audio_bytes" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_granted_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recording_limit_minutes" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
-- The recording limit the apps enforce unless an admin sets one per user (DEFAULT_RECORDING_LIMIT_MINUTES).
INSERT INTO "app_settings" ("key", "value") VALUES ('recording.limitMinutes', '120'::jsonb) ON CONFLICT ("key") DO NOTHING;

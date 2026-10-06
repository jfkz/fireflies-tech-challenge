ALTER TABLE "meetings" ADD COLUMN "bot_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "bot_status" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "bot_meeting_url" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "bot_join_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_bot_id_idx" ON "meetings" USING btree ("bot_id");
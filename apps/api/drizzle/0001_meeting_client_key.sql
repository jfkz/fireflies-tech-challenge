ALTER TABLE "meetings" ADD COLUMN "client_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_user_client_key_idx" ON "meetings" USING btree ("user_id","client_key");
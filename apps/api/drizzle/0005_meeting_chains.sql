ALTER TABLE "meetings" ADD COLUMN "chain_id" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "chain_reason" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "chain_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "meetings_user_chain_idx" ON "meetings" USING btree ("user_id","chain_id");
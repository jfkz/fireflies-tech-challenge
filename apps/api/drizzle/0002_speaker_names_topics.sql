ALTER TABLE "meetings" ADD COLUMN "speaker_names" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "topics" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "meetings_speakers_idx" ON "meetings" USING gin ("speakers");--> statement-breakpoint
CREATE INDEX "meetings_topics_idx" ON "meetings" USING gin ("topics");--> statement-breakpoint
-- Meetings summarized before topics existed: start them off with their first key topics.
UPDATE "meetings" m SET "topics" = ARRAY(
  SELECT t FROM jsonb_array_elements_text(s."key_topics") WITH ORDINALITY AS k(t, i) WHERE i <= 4 ORDER BY i
)
FROM "summaries" s
WHERE s."meeting_id" = m."id" AND m."topics" = '{}';

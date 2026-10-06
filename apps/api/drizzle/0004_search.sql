ALTER TABLE "summaries" ADD COLUMN "search" "tsvector";--> statement-breakpoint
CREATE INDEX "summaries_search_idx" ON "summaries" USING gin ("search");--> statement-breakpoint
-- Index the notes of meetings summarized before this: summary, key topics, decisions, action items.
UPDATE "summaries" s SET "search" = to_tsvector('simple', concat_ws(' ',
  s."summary",
  (SELECT string_agg(t, ' ') FROM jsonb_array_elements_text(s."key_topics") AS t),
  (SELECT string_agg(t, ' ') FROM jsonb_array_elements_text(s."decisions") AS t),
  (SELECT string_agg(concat_ws(' ', a."text", a."owner"), ' ') FROM "action_items" a WHERE a."meeting_id" = s."meeting_id")
));

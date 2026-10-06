CREATE TABLE "action_items" (
	"meeting_id" uuid NOT NULL,
	"id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"text" text NOT NULL,
	"owner" text,
	"due" text,
	"due_date" date,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_items_meeting_id_id_pk" PRIMARY KEY("meeting_id","id")
);
--> statement-breakpoint
ALTER TABLE "summaries" ALTER COLUMN "action_items" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_items_user_due_idx" ON "action_items" USING btree ("user_id","done","due_date");--> statement-breakpoint
-- Copy existing action items out of the summaries' JSON, in their order. Due dates were only ever
-- free text before, so due_date starts empty; reprocessing a meeting fills it.
INSERT INTO "action_items" ("meeting_id", "id", "user_id", "idx", "text", "owner", "due", "done")
SELECT s."meeting_id", e->>'id', m."user_id", (i - 1)::int, e->>'text', e->>'owner', e->>'due', coalesce((e->>'done')::boolean, false)
FROM "summaries" s
JOIN "meetings" m ON m."id" = s."meeting_id"
CROSS JOIN LATERAL jsonb_array_elements(coalesce(s."action_items", '[]'::jsonb)) WITH ORDINALITY AS x(e, i)
WHERE e->>'id' IS NOT NULL AND coalesce(e->>'text', '') <> ''
ON CONFLICT DO NOTHING;

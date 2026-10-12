CREATE TABLE "problem_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"kind" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"app_version" text NOT NULL,
	"app_build" text DEFAULT '' NOT NULL,
	"flavor" text NOT NULL,
	"os" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "problem_reports_created_idx" ON "problem_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "problem_reports_user_idx" ON "problem_reports" USING btree ("user_id");
CREATE TYPE "public"."feedback_kind" AS ENUM('up', 'down', 'copy');--> statement-breakpoint
CREATE TABLE "feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"kind" "feedback_kind" NOT NULL,
	"model_id" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_events_message_idx" ON "feedback_events" USING btree ("message_id");
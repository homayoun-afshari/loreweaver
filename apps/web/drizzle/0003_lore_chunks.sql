CREATE TYPE "public"."lore_doc_type" AS ENUM('rule', 'location', 'history', 'character');--> statement-breakpoint
CREATE TABLE "lore_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" text NOT NULL,
	"chunking" text NOT NULL,
	"source_path" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"doc_type" "lore_doc_type" NOT NULL,
	"heading_path" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedding_model" text NOT NULL,
	"token_estimate" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lore_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "lore_chunks_position_uq" ON "lore_chunks" USING btree ("world_id","chunking","source_path","chunk_index");--> statement-breakpoint
CREATE INDEX "lore_chunks_world_idx" ON "lore_chunks" USING btree ("world_id","chunking");